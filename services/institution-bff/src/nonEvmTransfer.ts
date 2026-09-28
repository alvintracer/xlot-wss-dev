import { verifyAsync } from '@noble/ed25519';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TronWeb, utils as tronUtils } from 'tronweb';
import {
  decode,
  deriveAddress,
  encodeForSigning,
  hashes,
  isValidClassicAddress,
  verifyKeypairSignature,
  type Payment,
} from 'xrpl';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';
import type { StablecoinDeployment } from './stablecoinRegistry.js';

type SolanaSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'solana-spl' }>;
type SolanaNativeSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'solana-native' }>;
type TronSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'tron-trc20' }>;
type TronNativeSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'tron-native' }>;
type XrplSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'xrpl-issued' }>;
type XrplNativeSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'xrpl-native' }>;

const SOLANA_TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SOLANA_TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SOLANA_ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SOLANA_SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const XRPL_FULLY_CANONICAL_SIGNATURE_FLAG = 0x8000_0000;
const XRPL_LAST_LEDGER_OFFSET = 4;
const XRPL_MAX_FEE_DROPS = 100n;
const XRPL_REQUIRE_DESTINATION_TAG_FLAG = 0x0002_0000;
const TRON_FEE_LIMIT_SUN = 100_000_000;
const TRON_NATIVE_MAX_FEE_SUN = 1_100_000;

function atomicToDecimal(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function decimalToAtomic(value: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('invalid_decimal_amount');
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) throw new Error('invalid_decimal_precision');
  return BigInt(match[1]!) * 10n ** BigInt(decimals)
    + BigInt(fraction.padEnd(decimals, '0') || '0');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    SOLANA_ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function createAssociatedTokenInstruction(input: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  associatedAccount: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOLANA_ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.associatedAccount, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: SOLANA_SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function createTransferCheckedInstruction(input: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(input.amount, 1);
  data.writeUInt8(input.decimals, 9);
  return new TransactionInstruction({
    programId: input.tokenProgram,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export async function prepareSolanaSplTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  amountAtomic: bigint;
  deployment: StablecoinDeployment;
}): Promise<{ transaction: SolanaSigningTransaction; feeAtomic: bigint }> {
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const owner = new PublicKey(input.fromAddress);
  const recipient = new PublicKey(input.recipient);
  if (owner.equals(recipient)) throw new Error('self_transfer_not_allowed');
  const mint = new PublicKey(input.deployment.tokenAddress);
  const mintInfo = await connection.getAccountInfo(mint, 'confirmed');
  if (!mintInfo) throw new Error('solana_mint_not_found');
  const tokenProgram = mintInfo.owner;
  if (!tokenProgram.equals(SOLANA_TOKEN_PROGRAM) && !tokenProgram.equals(SOLANA_TOKEN_2022_PROGRAM)) {
    throw new Error('unsupported_solana_token_program');
  }
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed');
  const source = tokenAccounts.value
    .map(({ pubkey, account }) => ({
      pubkey,
      amount: BigInt(String((account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount ?? '0')),
    }))
    .filter(({ amount }) => amount >= input.amountAtomic)
    .sort((left, right) => left.amount > right.amount ? -1 : left.amount < right.amount ? 1 : 0)[0];
  if (!source) throw new Error('solana_source_token_account_unavailable');
  const destination = associatedTokenAddress(recipient, mint, tokenProgram);
  const destinationInfo = await connection.getAccountInfo(destination, 'confirmed');
  const instructions: TransactionInstruction[] = [];
  if (!destinationInfo) {
    instructions.push(createAssociatedTokenInstruction({
      payer: owner,
      owner: recipient,
      mint,
      tokenProgram,
      associatedAccount: destination,
    }));
  } else if (!destinationInfo.owner.equals(tokenProgram)) {
    throw new Error('solana_destination_token_account_invalid');
  }
  instructions.push(createTransferCheckedInstruction({
    source: source.pubkey,
    mint,
    destination,
    owner,
    amount: input.amountAtomic,
    decimals: input.deployment.decimals,
    tokenProgram,
  }));
  const latest = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message();
  const [fee, rent, nativeBalance] = await Promise.all([
    connection.getFeeForMessage(message, 'confirmed'),
    destinationInfo ? Promise.resolve(0) : connection.getMinimumBalanceForRentExemption(165, 'confirmed'),
    connection.getBalance(owner, 'confirmed'),
  ]);
  if (fee.value === null) throw new Error('solana_network_fee_unavailable');
  const feeAtomic = BigInt(fee.value + rent);
  if (BigInt(nativeBalance) < feeAtomic) throw new Error('insufficient_balance_for_fee');
  const unsignedTransaction = new VersionedTransaction(message);
  return {
    transaction: {
      type: 'solana-spl',
      unsignedTransactionBase64: Buffer.from(unsignedTransaction.serialize()).toString('base64'),
      recentBlockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      mintAddress: mint.toBase58(),
      sourceTokenAccount: source.pubkey.toBase58(),
      destinationTokenAccount: destination.toBase58(),
      amountAtomic: input.amountAtomic.toString(),
      feeLamports: feeAtomic.toString(),
    },
    feeAtomic,
  };
}

export async function prepareSolanaNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  amountAtomic: bigint;
}): Promise<{ transaction: SolanaNativeSigningTransaction; feeAtomic: bigint }> {
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const owner = new PublicKey(input.fromAddress);
  const recipient = new PublicKey(input.recipient);
  if (owner.equals(recipient)) throw new Error('self_transfer_not_allowed');
  const latest = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: latest.blockhash,
    instructions: [SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: recipient,
      lamports: input.amountAtomic,
    })],
  }).compileToV0Message();
  const [fee, nativeBalance] = await Promise.all([
    connection.getFeeForMessage(message, 'confirmed'),
    connection.getBalance(owner, 'confirmed'),
  ]);
  if (fee.value === null) throw new Error('solana_network_fee_unavailable');
  const feeAtomic = BigInt(fee.value);
  if (input.amountAtomic + feeAtomic > BigInt(nativeBalance)) throw new Error('insufficient_balance_for_fee');
  const unsignedTransaction = new VersionedTransaction(message);
  return {
    transaction: {
      type: 'solana-native',
      unsignedTransactionBase64: Buffer.from(unsignedTransaction.serialize()).toString('base64'),
      recentBlockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      amountLamports: input.amountAtomic.toString(),
      feeLamports: feeAtomic.toString(),
    },
    feeAtomic,
  };
}

export async function submitSolanaSplTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  signedTransactionBase64: string;
  expected: SolanaSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const verified = await verifySolanaSplTransfer(input);
  await input.authorize(verified.transactionHash);
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const broadcastHash = await connection.sendRawTransaction(verified.serialized, { skipPreflight: false, preflightCommitment: 'confirmed' });
  if (broadcastHash !== verified.transactionHash) throw new Error('solana_transaction_hash_mismatch');
  return verified.transactionHash;
}

export async function submitSolanaNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  signedTransactionBase64: string;
  expected: SolanaNativeSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const verified = await verifySolanaNativeTransfer(input);
  await input.authorize(verified.transactionHash);
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const broadcastHash = await connection.sendRawTransaction(verified.serialized, { skipPreflight: false, preflightCommitment: 'confirmed' });
  if (broadcastHash !== verified.transactionHash) throw new Error('solana_transaction_hash_mismatch');
  return verified.transactionHash;
}

export async function verifySolanaSplTransfer(input: {
  fromAddress: string;
  signedTransactionBase64: string;
  expected: SolanaSigningTransaction;
}): Promise<{ serialized: Uint8Array; transactionHash: string }> {
  const signed = VersionedTransaction.deserialize(Buffer.from(input.signedTransactionBase64, 'base64'));
  const unsigned = VersionedTransaction.deserialize(Buffer.from(input.expected.unsignedTransactionBase64, 'base64'));
  if (!equalBytes(signed.message.serialize(), unsigned.message.serialize())) throw new Error('signed_transaction_mismatch');
  const payer = signed.message.staticAccountKeys[0];
  if (!payer || payer.toBase58() !== input.fromAddress) throw new Error('signed_transaction_mismatch');
  const signature = signed.signatures[0];
  if (!signature || !await verifyAsync(signature, signed.message.serialize(), payer.toBytes())) {
    throw new Error('invalid_solana_signature');
  }
  const transactionHash = base58Encode(signature);
  return { serialized: signed.serialize(), transactionHash };
}

export async function verifySolanaNativeTransfer(input: {
  fromAddress: string;
  signedTransactionBase64: string;
  expected: SolanaNativeSigningTransaction;
}): Promise<{ serialized: Uint8Array; transactionHash: string }> {
  const signed = VersionedTransaction.deserialize(Buffer.from(input.signedTransactionBase64, 'base64'));
  const unsigned = VersionedTransaction.deserialize(Buffer.from(input.expected.unsignedTransactionBase64, 'base64'));
  if (!equalBytes(signed.message.serialize(), unsigned.message.serialize())) throw new Error('signed_transaction_mismatch');
  const payer = signed.message.staticAccountKeys[0];
  if (!payer || payer.toBase58() !== input.fromAddress) throw new Error('signed_transaction_mismatch');
  const signature = signed.signatures[0];
  if (!signature || !await verifyAsync(signature, signed.message.serialize(), payer.toBytes())) {
    throw new Error('invalid_solana_signature');
  }
  const transactionHash = base58Encode(signature);
  return { serialized: signed.serialize(), transactionHash };
}

export async function prepareTronTrc20Transfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  amountAtomic: bigint;
  deployment: StablecoinDeployment;
}): Promise<{ transaction: TronSigningTransaction; feeAtomic: bigint }> {
  if (!TronWeb.isAddress(input.fromAddress) || !TronWeb.isAddress(input.recipient)) throw new Error('invalid_recipient');
  if (input.fromAddress === input.recipient) throw new Error('self_transfer_not_allowed');
  const tronWeb = new TronWeb({ fullHost: input.rpcUrl });
  const result = await tronWeb.transactionBuilder.triggerSmartContract(
    input.deployment.tokenAddress,
    'transfer(address,uint256)',
    { feeLimit: TRON_FEE_LIMIT_SUN, callValue: 0 },
    [
      { type: 'address', value: input.recipient },
      { type: 'uint256', value: input.amountAtomic.toString() },
    ],
    input.fromAddress,
  );
  if (!result.result?.result || !result.transaction?.txID) throw new Error('tron_transaction_build_failed');
  const transactionJson = JSON.stringify(result.transaction);
  return {
    transaction: {
      type: 'tron-trc20',
      unsignedTransactionJson: transactionJson,
      transactionId: result.transaction.txID,
      tokenAddress: input.deployment.tokenAddress,
      amountAtomic: input.amountAtomic.toString(),
      feeLimitSun: String(TRON_FEE_LIMIT_SUN),
    },
    feeAtomic: BigInt(TRON_FEE_LIMIT_SUN),
  };
}

export async function prepareTronNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  amountAtomic: bigint;
}): Promise<{ transaction: TronNativeSigningTransaction; feeAtomic: bigint }> {
  if (!TronWeb.isAddress(input.fromAddress) || !TronWeb.isAddress(input.recipient)) throw new Error('invalid_recipient');
  if (input.fromAddress === input.recipient) throw new Error('self_transfer_not_allowed');
  if (input.amountAtomic > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid_transfer_amount');
  const tronWeb = new TronWeb({ fullHost: input.rpcUrl });
  const [transaction, balance] = await Promise.all([
    tronWeb.transactionBuilder.sendTrx(input.recipient, Number(input.amountAtomic), input.fromAddress),
    tronWeb.trx.getBalance(input.fromAddress),
  ]);
  if (!transaction.txID) throw new Error('tron_transaction_build_failed');
  const feeAtomic = BigInt(TRON_NATIVE_MAX_FEE_SUN);
  if (input.amountAtomic + feeAtomic > BigInt(balance)) throw new Error('insufficient_balance_for_fee');
  return {
    transaction: {
      type: 'tron-native',
      unsignedTransactionJson: JSON.stringify(transaction),
      transactionId: transaction.txID,
      amountSun: input.amountAtomic.toString(),
      feeLimitSun: feeAtomic.toString(),
    },
    feeAtomic,
  };
}

export async function submitTronTrc20Transfer(input: {
  rpcUrl: string;
  fromAddress: string;
  signedTransactionJson: string;
  expected: TronSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const verified = verifyTronTrc20Transfer(input);
  await input.authorize(verified.transactionHash);
  const tronWeb = new TronWeb({ fullHost: input.rpcUrl });
  const result = await tronWeb.trx.sendRawTransaction(verified.signed as never);
  if (!result.result) throw new Error('tron_broadcast_failed');
  const broadcastHash = String(result.txid || verified.signed.txID);
  if (broadcastHash.toLowerCase() !== verified.transactionHash.toLowerCase()) throw new Error('tron_transaction_hash_mismatch');
  return verified.transactionHash;
}

export async function submitTronNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  signedTransactionJson: string;
  expected: TronNativeSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const verified = verifyTronNativeTransfer(input);
  await input.authorize(verified.transactionHash);
  const tronWeb = new TronWeb({ fullHost: input.rpcUrl });
  const result = await tronWeb.trx.sendRawTransaction(verified.signed as never);
  if (!result.result) throw new Error('tron_broadcast_failed');
  const broadcastHash = String(result.txid || verified.signed.txID);
  if (broadcastHash.toLowerCase() !== verified.transactionHash.toLowerCase()) throw new Error('tron_transaction_hash_mismatch');
  return verified.transactionHash;
}

export function verifyTronTrc20Transfer(input: {
  fromAddress: string;
  signedTransactionJson: string;
  expected: TronSigningTransaction;
}): {
  signed: { txID?: string; raw_data_hex?: string; signature?: string[] };
  transactionHash: string;
} {
  const signed = JSON.parse(input.signedTransactionJson) as {
    txID?: string;
    raw_data_hex?: string;
    signature?: string[];
  };
  const unsigned = JSON.parse(input.expected.unsignedTransactionJson) as { txID?: string; raw_data_hex?: string };
  if (signed.txID !== input.expected.transactionId
    || signed.txID !== unsigned.txID
    || signed.raw_data_hex !== unsigned.raw_data_hex
    || !Array.isArray(signed.signature)
    || signed.signature.length !== 1) throw new Error('signed_transaction_mismatch');
  const transactionHash = input.expected.transactionId;
  const recoveredHex = tronUtils.crypto.ecRecover(transactionHash, signed.signature[0]!);
  if (TronWeb.address.fromHex(recoveredHex) !== input.fromAddress) throw new Error('invalid_tron_signature');
  return { signed, transactionHash };
}

export function verifyTronNativeTransfer(input: {
  fromAddress: string;
  signedTransactionJson: string;
  expected: TronNativeSigningTransaction;
}): {
  signed: { txID?: string; raw_data_hex?: string; signature?: string[] };
  transactionHash: string;
} {
  const signed = JSON.parse(input.signedTransactionJson) as {
    txID?: string;
    raw_data_hex?: string;
    signature?: string[];
  };
  const unsigned = JSON.parse(input.expected.unsignedTransactionJson) as { txID?: string; raw_data_hex?: string };
  if (signed.txID !== input.expected.transactionId
    || signed.txID !== unsigned.txID
    || signed.raw_data_hex !== unsigned.raw_data_hex
    || !Array.isArray(signed.signature)
    || signed.signature.length !== 1) throw new Error('signed_transaction_mismatch');
  const transactionHash = input.expected.transactionId;
  const recoveredHex = tronUtils.crypto.ecRecover(transactionHash, signed.signature[0]!);
  if (TronWeb.address.fromHex(recoveredHex) !== input.fromAddress) throw new Error('invalid_tron_signature');
  return { signed, transactionHash };
}

async function xrplRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`XRPL RPC ${response.status}`);
    const payload = await response.json() as { result?: T & { error?: string; error_message?: string } };
    if (!payload.result || payload.result.error) throw new Error(payload.result?.error_message || payload.result?.error || 'xrpl_rpc_failed');
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

interface XrplAccountInfo {
  account_data: { Account: string; Balance: string; Sequence: number; Flags?: number; OwnerCount?: number };
  ledger_index: number;
}

interface XrplServerState {
  state: { validated_ledger?: { reserve_base?: number | string; reserve_inc?: number | string } };
}

interface XrplLine {
  account?: string;
  currency?: string;
  balance?: string;
  freeze?: boolean;
  freeze_peer?: boolean;
}

function findXrplLine(lines: XrplLine[], deployment: StablecoinDeployment): XrplLine | undefined {
  return lines.find((line) => line.account === deployment.issuerAddress
    && (line.currency === deployment.currencyCode || line.currency === deployment.symbol));
}

function equalXrplPayment(expected: XrplSigningTransaction['payment'], actual: Record<string, unknown>): boolean {
  const amount = actual.Amount as Record<string, unknown> | undefined;
  const expectedKeys = new Set([
    'TransactionType', 'Account', 'Destination', 'Amount', 'Flags', 'Sequence',
    'Fee', 'LastLedgerSequence', 'SigningPubKey', 'TxnSignature',
    ...(expected.DestinationTag === undefined ? [] : ['DestinationTag']),
  ]);
  return Object.keys(actual).every((key) => expectedKeys.has(key))
    && amount !== undefined
    && Object.keys(amount).every((key) => key === 'currency' || key === 'issuer' || key === 'value')
    && Object.keys(amount).length === 3
    && actual.TransactionType === expected.TransactionType
    && actual.Account === expected.Account
    && actual.Destination === expected.Destination
    && amount?.currency === expected.Amount.currency
    && amount?.issuer === expected.Amount.issuer
    && amount?.value === expected.Amount.value
    && actual.DestinationTag === expected.DestinationTag
    && actual.Flags === expected.Flags
    && actual.Sequence === expected.Sequence
    && actual.Fee === expected.Fee
    && actual.LastLedgerSequence === expected.LastLedgerSequence;
}

function equalXrplNativePayment(expected: XrplNativeSigningTransaction['payment'], actual: Record<string, unknown>): boolean {
  const expectedKeys = new Set([
    'TransactionType', 'Account', 'Destination', 'Amount', 'Flags', 'Sequence',
    'Fee', 'LastLedgerSequence', 'SigningPubKey', 'TxnSignature',
    ...(expected.DestinationTag === undefined ? [] : ['DestinationTag']),
  ]);
  return Object.keys(actual).every((key) => expectedKeys.has(key))
    && actual.TransactionType === expected.TransactionType
    && actual.Account === expected.Account
    && actual.Destination === expected.Destination
    && actual.Amount === expected.Amount
    && actual.DestinationTag === expected.DestinationTag
    && actual.Flags === expected.Flags
    && actual.Sequence === expected.Sequence
    && actual.Fee === expected.Fee
    && actual.LastLedgerSequence === expected.LastLedgerSequence;
}

export async function prepareXrplIssuedTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  destinationTag?: string;
  amountAtomic: bigint;
  deployment: StablecoinDeployment;
}): Promise<{ transaction: XrplSigningTransaction; feeAtomic: bigint }> {
  if (!input.deployment.issuerAddress || !input.deployment.currencyCode) throw new Error('xrpl_asset_metadata_unavailable');
  if (!isValidClassicAddress(input.fromAddress) || !isValidClassicAddress(input.recipient)) throw new Error('invalid_recipient');
  if (input.fromAddress === input.recipient) throw new Error('self_transfer_not_allowed');
  const destinationTag = input.destinationTag?.trim()
    ? Number(input.destinationTag.trim())
    : undefined;
  if (destinationTag !== undefined && (!Number.isSafeInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffff_ffff)) {
    throw new Error('invalid_destination_tag');
  }
  const [source, destination, feeResult, ledger, sourceLines, destinationLines] = await Promise.all([
    xrplRpc<XrplAccountInfo>(input.rpcUrl, 'account_info', [{ account: input.fromAddress, ledger_index: 'validated' }]),
    xrplRpc<XrplAccountInfo>(input.rpcUrl, 'account_info', [{ account: input.recipient, ledger_index: 'validated' }]),
    xrplRpc<{ drops: { open_ledger_fee: string; minimum_fee: string } }>(input.rpcUrl, 'fee', [{}]),
    xrplRpc<{ ledger_index: number }>(input.rpcUrl, 'ledger', [{ ledger_index: 'validated', transactions: false, expand: false }]),
    xrplRpc<{ lines?: XrplLine[] }>(input.rpcUrl, 'account_lines', [{ account: input.fromAddress, ledger_index: 'validated' }]),
    input.recipient === input.deployment.issuerAddress
      ? Promise.resolve({ lines: [] as XrplLine[] })
      : xrplRpc<{ lines?: XrplLine[] }>(input.rpcUrl, 'account_lines', [{ account: input.recipient, ledger_index: 'validated' }]),
  ]);
  if ((destination.account_data.Flags ?? 0) & XRPL_REQUIRE_DESTINATION_TAG_FLAG && destinationTag === undefined) {
    throw new Error('destination_tag_required');
  }
  const feeAtomic = BigInt(feeResult.drops.open_ledger_fee || feeResult.drops.minimum_fee);
  if (feeAtomic <= 0n || feeAtomic > XRPL_MAX_FEE_DROPS) throw new Error('xrpl_network_fee_unavailable');
  if (BigInt(source.account_data.Balance) <= feeAtomic) throw new Error('insufficient_balance_for_fee');
  const sourceLine = findXrplLine(sourceLines.lines ?? [], input.deployment);
  const destinationLine = input.recipient === input.deployment.issuerAddress
    ? undefined
    : findXrplLine(destinationLines.lines ?? [], input.deployment);
  if (!sourceLine || (input.recipient !== input.deployment.issuerAddress && !destinationLine)) throw new Error('xrpl_trustline_required');
  if (sourceLine.freeze || sourceLine.freeze_peer || destinationLine?.freeze || destinationLine?.freeze_peer) {
    throw new Error('xrpl_trustline_frozen');
  }
  if (decimalToAtomic(sourceLine.balance ?? '0', input.deployment.decimals) < input.amountAtomic) {
    throw new Error('insufficient_balance');
  }
  const snapshotLedgerIndex = Number(ledger.ledger_index || source.ledger_index);
  if (!Number.isSafeInteger(snapshotLedgerIndex) || snapshotLedgerIndex <= 0) throw new Error('xrpl_ledger_unavailable');
  const payment: XrplSigningTransaction['payment'] = {
    TransactionType: 'Payment',
    Account: input.fromAddress,
    Destination: input.recipient,
    Amount: {
      currency: input.deployment.currencyCode,
      issuer: input.deployment.issuerAddress,
      value: atomicToDecimal(input.amountAtomic, input.deployment.decimals),
    },
    ...(destinationTag === undefined ? {} : { DestinationTag: destinationTag }),
    Flags: XRPL_FULLY_CANONICAL_SIGNATURE_FLAG,
    Sequence: source.account_data.Sequence,
    Fee: feeAtomic.toString(),
    LastLedgerSequence: snapshotLedgerIndex + XRPL_LAST_LEDGER_OFFSET,
  };
  return {
    transaction: { type: 'xrpl-issued', payment, snapshotLedgerIndex },
    feeAtomic,
  };
}

export async function prepareXrplNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  destinationTag?: string;
  amountAtomic: bigint;
}): Promise<{ transaction: XrplNativeSigningTransaction; feeAtomic: bigint }> {
  if (!isValidClassicAddress(input.fromAddress) || !isValidClassicAddress(input.recipient)) throw new Error('invalid_recipient');
  if (input.fromAddress === input.recipient) throw new Error('self_transfer_not_allowed');
  const destinationTag = input.destinationTag?.trim()
    ? Number(input.destinationTag.trim())
    : undefined;
  if (destinationTag !== undefined && (!Number.isSafeInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffff_ffff)) {
    throw new Error('invalid_destination_tag');
  }
  const destinationPromise = xrplRpc<XrplAccountInfo>(
    input.rpcUrl,
    'account_info',
    [{ account: input.recipient, ledger_index: 'validated' }],
  ).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes('actNotFound')) return null;
    throw error;
  });
  const [source, destination, feeResult, ledger, serverState] = await Promise.all([
    xrplRpc<XrplAccountInfo>(input.rpcUrl, 'account_info', [{ account: input.fromAddress, ledger_index: 'validated' }]),
    destinationPromise,
    xrplRpc<{ drops: { open_ledger_fee: string; minimum_fee: string } }>(input.rpcUrl, 'fee', [{}]),
    xrplRpc<{ ledger_index: number }>(input.rpcUrl, 'ledger', [{ ledger_index: 'validated', transactions: false, expand: false }]),
    xrplRpc<XrplServerState>(input.rpcUrl, 'server_state', [{}]),
  ]);
  if (destination && (destination.account_data.Flags ?? 0) & XRPL_REQUIRE_DESTINATION_TAG_FLAG && destinationTag === undefined) {
    throw new Error('destination_tag_required');
  }
  const feeAtomic = BigInt(feeResult.drops.open_ledger_fee || feeResult.drops.minimum_fee);
  if (feeAtomic <= 0n || feeAtomic > XRPL_MAX_FEE_DROPS) throw new Error('xrpl_network_fee_unavailable');
  const validatedLedger = serverState.state.validated_ledger;
  const reserveBase = BigInt(String(validatedLedger?.reserve_base ?? '0'));
  const reserveIncrement = BigInt(String(validatedLedger?.reserve_inc ?? '0'));
  if (reserveBase <= 0n || reserveIncrement < 0n) throw new Error('xrpl_reserve_unavailable');
  if (!destination && input.amountAtomic < reserveBase) throw new Error('xrpl_destination_activation_minimum');
  const sourceReserve = reserveBase + reserveIncrement * BigInt(source.account_data.OwnerCount ?? 0);
  if (input.amountAtomic + feeAtomic + sourceReserve > BigInt(source.account_data.Balance)) {
    throw new Error('insufficient_balance_for_fee');
  }
  const snapshotLedgerIndex = Number(ledger.ledger_index || source.ledger_index);
  if (!Number.isSafeInteger(snapshotLedgerIndex) || snapshotLedgerIndex <= 0) throw new Error('xrpl_ledger_unavailable');
  const payment: XrplNativeSigningTransaction['payment'] = {
    TransactionType: 'Payment',
    Account: input.fromAddress,
    Destination: input.recipient,
    Amount: input.amountAtomic.toString(),
    ...(destinationTag === undefined ? {} : { DestinationTag: destinationTag }),
    Flags: XRPL_FULLY_CANONICAL_SIGNATURE_FLAG,
    Sequence: source.account_data.Sequence,
    Fee: feeAtomic.toString(),
    LastLedgerSequence: snapshotLedgerIndex + XRPL_LAST_LEDGER_OFFSET,
  };
  return {
    transaction: { type: 'xrpl-native', payment, snapshotLedgerIndex },
    feeAtomic,
  };
}

export async function submitXrplIssuedTransfer(input: {
  rpcUrl: string;
  signedTransactionBlob: string;
  expected: XrplSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const transactionHash = verifyXrplIssuedTransfer(input);
  await input.authorize(transactionHash);
  const result = await xrplRpc<{ engine_result?: string; tx_json?: { hash?: string } }>(
    input.rpcUrl,
    'submit',
    [{ tx_blob: input.signedTransactionBlob, fail_hard: true }],
  );
  if (result.engine_result !== 'tesSUCCESS' && result.engine_result !== 'terQUEUED') {
    throw new Error('xrpl_broadcast_failed');
  }
  if (result.tx_json?.hash && result.tx_json.hash !== transactionHash) throw new Error('xrpl_transaction_hash_mismatch');
  return transactionHash;
}

export async function submitXrplNativeTransfer(input: {
  rpcUrl: string;
  signedTransactionBlob: string;
  expected: XrplNativeSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const transactionHash = verifyXrplNativeTransfer(input);
  await input.authorize(transactionHash);
  const result = await xrplRpc<{ engine_result?: string; tx_json?: { hash?: string } }>(
    input.rpcUrl,
    'submit',
    [{ tx_blob: input.signedTransactionBlob, fail_hard: true }],
  );
  if (result.engine_result !== 'tesSUCCESS' && result.engine_result !== 'terQUEUED') {
    throw new Error('xrpl_broadcast_failed');
  }
  if (result.tx_json?.hash && result.tx_json.hash !== transactionHash) throw new Error('xrpl_transaction_hash_mismatch');
  return transactionHash;
}

export function verifyXrplIssuedTransfer(input: {
  signedTransactionBlob: string;
  expected: XrplSigningTransaction;
}): string {
  if (!/^[A-F0-9]+$/u.test(input.signedTransactionBlob) || input.signedTransactionBlob.length % 2 !== 0) {
    throw new Error('invalid_xrpl_signed_transaction');
  }
  const decoded = decode(input.signedTransactionBlob) as Payment & { SigningPubKey?: string; TxnSignature?: string };
  if (!equalXrplPayment(input.expected.payment, decoded as unknown as Record<string, unknown>)) {
    throw new Error('signed_transaction_mismatch');
  }
  if (!decoded.SigningPubKey || !decoded.TxnSignature
    || deriveAddress(decoded.SigningPubKey) !== input.expected.payment.Account
    || !verifyKeypairSignature(encodeForSigning(decoded), decoded.TxnSignature, decoded.SigningPubKey)) {
    throw new Error('invalid_xrpl_signature');
  }
  const transactionHash = hashes.hashSignedTx(input.signedTransactionBlob);
  return transactionHash;
}

export function verifyXrplNativeTransfer(input: {
  signedTransactionBlob: string;
  expected: XrplNativeSigningTransaction;
}): string {
  if (!/^[A-F0-9]+$/u.test(input.signedTransactionBlob) || input.signedTransactionBlob.length % 2 !== 0) {
    throw new Error('invalid_xrpl_signed_transaction');
  }
  const decoded = decode(input.signedTransactionBlob) as Payment & { SigningPubKey?: string; TxnSignature?: string };
  if (!equalXrplNativePayment(input.expected.payment, decoded as unknown as Record<string, unknown>)) {
    throw new Error('signed_transaction_mismatch');
  }
  if (!decoded.SigningPubKey || !decoded.TxnSignature
    || deriveAddress(decoded.SigningPubKey) !== input.expected.payment.Account
    || !verifyKeypairSignature(encodeForSigning(decoded), decoded.TxnSignature, decoded.SigningPubKey)) {
    throw new Error('invalid_xrpl_signature');
  }
  return hashes.hashSignedTx(input.signedTransactionBlob);
}
