import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ethers, type TransactionReceipt } from 'ethers';
import postgres from 'postgres';
import type {
  EvmTransactionSigningPayload,
  SecureTransactionSigningRequest,
  WalletNetworkView,
  WalletReceiveAssetView,
  WssSessionClaims,
} from '@took-wss/contracts';
import {
  decryptPrivateAttribute,
  encryptPrivateAttribute,
  encryptionKeyFromHex,
  koreanPhoneE164,
  koreanPhoneNational,
  phoneLookupHash,
} from './phoneRegistration.js';

type Session = Omit<WssSessionClaims, 'nonce'>;

const ZERO_ADDRESS = ethers.ZeroAddress;
const ESCROW_ABI = [
  'function deposit(bytes32 commitment, address token, uint256 amount, uint64 expiry) payable',
  'function feeRate() view returns (uint256)',
  'function minFee() view returns (uint256)',
  'function fixedFee() view returns (uint256)',
  'function serverSigner() view returns (address)',
  'event Deposited(bytes32 indexed commitment,address indexed sender,uint256 amount,address token)',
] as const;
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;
const escrowInterface = new ethers.Interface(ESCROW_ABI);
const erc20Interface = new ethers.Interface(ERC20_ABI);
const expirySeconds = 7 * 24 * 60 * 60;

const defaultEscrowAddresses: Readonly<Record<string, string>> = {
  ethereum: '0x9eA2344023224015bA530DF91910dD8bb131aD49',
  polygon: '0x7482f2b8d5c85de8037145a6b0282be66163ae8a',
  arbitrum: '0xbf28dBdABE2f08E736FBdeA33b74D925D3e8D573',
  base: '0xA119D5128480B3084356ed665c2B936ee0032Ef3',
};

const addressEnvironment: Readonly<Record<string, string>> = {
  ethereum: 'WSS_PHONE_ESCROW_ETHEREUM_ADDRESS',
  polygon: 'WSS_PHONE_ESCROW_POLYGON_ADDRESS',
  arbitrum: 'WSS_PHONE_ESCROW_ARBITRUM_ADDRESS',
  base: 'WSS_PHONE_ESCROW_BASE_ADDRESS',
};

const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST
  ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 })
  : null;

interface PhoneEscrowDatabaseRow {
  claim_code: string;
  recipient_ciphertext: Buffer | null;
  chain_id: string;
  commitment: string;
  escrow_contract_address: string;
  recipient_amount_atomic: string;
  escrow_amount_atomic: string;
  claim_fee_atomic: string;
  sms_status: string;
}

export interface PhoneEscrowPreparation {
  transaction: SecureTransactionSigningRequest['transaction'];
  escrowAddress: string;
  commitment: string;
  claimCode: string;
  normalizedPhone: string;
  recipientDisplay: string;
  recipientAmountAtomic: string;
  escrowAmountAtomic: string;
  claimFeeAtomic: string;
  networkFeeAtomic: string;
  expiresAt: string;
}

export interface PhoneEscrowIntentReference {
  commitment: string;
  escrowAddress: string;
}

export interface PhoneEscrowDeliveryResult {
  status: 'pending' | 'sent' | 'failed';
  recipientDisplay: string;
}

function environment(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function configuredClaimBaseUrl(): string | undefined {
  const value = environment('WSS_PHONE_CLAIM_BASE_URL');
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const developmentLoopback = process.env.NODE_ENV !== 'production'
      && url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if ((url.protocol !== 'https:' && !developmentLoopback)
      || url.username
      || url.password
      || url.search
      || url.hash) return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function phoneEscrowAddress(chainId: string): string | undefined {
  const explicit = addressEnvironment[chainId] ? environment(addressEnvironment[chainId]!) : undefined;
  const resolved = explicit ?? defaultEscrowAddresses[chainId];
  return resolved && ethers.isAddress(resolved) ? ethers.getAddress(resolved) : undefined;
}

export function supportsPhoneEscrow(chainId: string): boolean {
  const expectedSigner = environment('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS');
  return environment('WSS_PHONE_ESCROW_EXECUTION_ENABLED') === 'true'
    && Boolean(configuredClaimBaseUrl())
    && Boolean(expectedSigner && ethers.isAddress(expectedSigner) && expectedSigner !== ZERO_ADDRESS)
    && Boolean(phoneEscrowAddress(chainId));
}

export function phoneEscrowUnavailableReason(chainId: string): string | undefined {
  if (supportsPhoneEscrow(chainId)) return undefined;
  if (!phoneEscrowAddress(chainId)) return '이 네트워크에서는 아직 휴대폰 번호로 보낼 수 없어요.';
  return '휴대폰 번호로 보내기는 준비 중이에요.';
}

export function normalizePhoneEscrowRecipient(value: string): string {
  return koreanPhoneNational(value.replace(/[^\d+]/g, ''));
}

export function maskPhoneRecipient(value: string): string {
  const phone = normalizePhoneEscrowRecipient(value);
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}

export function senderPaysEscrowDeposit(
  recipientAmount: bigint,
  feeRate: bigint,
  minFee: bigint,
  fixedFee: bigint,
): { escrowAmount: bigint; claimFee: bigint } {
  if (recipientAmount <= 0n) throw new Error('invalid_transfer_amount');
  let escrowAmount = recipientAmount + minFee + fixedFee;
  for (let index = 0; index < 32; index += 1) {
    const rateFee = escrowAmount * feeRate / 10_000n;
    const claimFee = (rateFee > minFee ? rateFee : minFee) + fixedFee;
    if (claimFee >= escrowAmount) throw new Error('phone_escrow_fee_exceeds_amount');
    const next = recipientAmount + claimFee;
    if (next === escrowAmount) return { escrowAmount, claimFee };
    escrowAmount = next;
  }
  throw new Error('phone_escrow_quote_unavailable');
}

function gasWithMargin(value: bigint, fallback: bigint): bigint {
  const estimate = value > 0n ? value : fallback;
  return estimate * 12n / 10n;
}

async function estimateOrFallback(
  provider: ethers.JsonRpcProvider,
  transaction: ethers.TransactionRequest,
  fallback: bigint,
): Promise<bigint> {
  try {
    return gasWithMargin(await provider.estimateGas(transaction), fallback);
  } catch {
    return fallback;
  }
}

async function readContractUint(
  provider: ethers.JsonRpcProvider,
  to: string,
  contractInterface: ethers.Interface,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<bigint> {
  const data = contractInterface.encodeFunctionData(functionName, args);
  const result = await provider.call({ to, data });
  const decoded = contractInterface.decodeFunctionResult(functionName, result);
  return BigInt(decoded[0]);
}

async function readContractAddress(
  provider: ethers.JsonRpcProvider,
  to: string,
  contractInterface: ethers.Interface,
  functionName: string,
): Promise<string> {
  const data = contractInterface.encodeFunctionData(functionName);
  const result = await provider.call({ to, data });
  const decoded = contractInterface.decodeFunctionResult(functionName, result);
  return ethers.getAddress(String(decoded[0]));
}

function evmPayload(input: {
  type: EvmTransactionSigningPayload['type'];
  purpose: NonNullable<EvmTransactionSigningPayload['purpose']>;
  chainId: number;
  nonce: number;
  to: string;
  value: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
  data: string;
}): EvmTransactionSigningPayload {
  return {
    type: input.type,
    purpose: input.purpose,
    chainId: input.chainId,
    nonce: input.nonce,
    to: input.to,
    value: input.value.toString(),
    gasLimit: input.gasLimit.toString(),
    gasPrice: input.gasPrice.toString(),
    data: input.data,
  };
}

export async function preparePhoneEscrow(input: {
  network: WalletNetworkView;
  asset: WalletReceiveAssetView;
  recipient: string;
  recipientAmount: bigint;
  available: bigint;
  nativeAvailable: bigint;
  rpcUrl: string;
  evmChainId: number;
}): Promise<PhoneEscrowPreparation> {
  const { network, asset } = input;
  if (!network.address || network.addressStatus !== 'ready') throw new Error('asset_not_available');
  if (!supportsPhoneEscrow(asset.chainId)) throw new Error('phone_escrow_not_configured');
  const escrowAddress = phoneEscrowAddress(asset.chainId);
  if (!escrowAddress) throw new Error('phone_escrow_network_not_supported');
  const normalizedPhone = normalizePhoneEscrowRecipient(input.recipient);
  const e164Phone = koreanPhoneE164(normalizedPhone);
  const provider = new ethers.JsonRpcProvider(input.rpcUrl, input.evmChainId, { staticNetwork: true });
  const [feeRateValue, minFeeValue, fixedFeeValue, serverSigner, nonce, feeData] = await Promise.all([
    readContractUint(provider, escrowAddress, escrowInterface, 'feeRate'),
    readContractUint(provider, escrowAddress, escrowInterface, 'minFee'),
    readContractUint(provider, escrowAddress, escrowInterface, 'fixedFee'),
    readContractAddress(provider, escrowAddress, escrowInterface, 'serverSigner'),
    provider.getTransactionCount(network.address, 'pending'),
    provider.getFeeData(),
  ]);
  const expectedSigner = environment('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS');
  if (!expectedSigner || serverSigner !== ethers.getAddress(expectedSigner)) {
    throw new Error('phone_escrow_claim_signer_mismatch');
  }
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error('network_fee_unavailable');
  const { escrowAmount, claimFee } = senderPaysEscrowDeposit(
    input.recipientAmount,
    BigInt(feeRateValue),
    BigInt(minFeeValue),
    BigInt(fixedFeeValue),
  );
  if (escrowAmount > input.available) throw new Error('insufficient_balance');

  const salt = ethers.hexlify(randomBytes(32));
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(['string', 'bytes32'], [e164Phone, salt]),
  ).toLowerCase();
  const claimCode = randomBytes(9).toString('base64url');
  const expiresAtSeconds = Math.floor(Date.now() / 1_000) + expirySeconds;
  const expiresAt = new Date(expiresAtSeconds * 1_000).toISOString();
  const tokenAddress = asset.tokenAddress ? ethers.getAddress(asset.tokenAddress) : ZERO_ADDRESS;
  const depositData = escrowInterface.encodeFunctionData('deposit', [
    commitment,
    tokenAddress,
    escrowAmount,
    expiresAtSeconds,
  ]);
  const transactions: EvmTransactionSigningPayload[] = [];

  if (asset.tokenAddress) {
    const allowance = await readContractUint(
      provider,
      tokenAddress,
      erc20Interface,
      'allowance',
      [network.address, escrowAddress],
    );
    let nextNonce = nonce;
    if (allowance < escrowAmount) {
      if (allowance > 0n) {
        const resetData = erc20Interface.encodeFunctionData('approve', [escrowAddress, 0n]);
        const resetGas = await estimateOrFallback(provider, {
          from: network.address,
          to: tokenAddress,
          data: resetData,
        }, 80_000n);
        transactions.push(evmPayload({
          type: 'evm-erc20', purpose: 'token-approval', chainId: input.evmChainId,
          nonce: nextNonce, to: tokenAddress, value: 0n, gasLimit: resetGas, gasPrice, data: resetData,
        }));
        nextNonce += 1;
      }
      const approvalData = erc20Interface.encodeFunctionData('approve', [escrowAddress, escrowAmount]);
      const approvalGas = await estimateOrFallback(provider, {
        from: network.address,
        to: tokenAddress,
        data: approvalData,
      }, 80_000n);
      transactions.push(evmPayload({
        type: 'evm-erc20', purpose: 'token-approval', chainId: input.evmChainId,
        nonce: nextNonce, to: tokenAddress, value: 0n, gasLimit: approvalGas, gasPrice, data: approvalData,
      }));
      nextNonce += 1;
    }
    const depositGas = allowance >= escrowAmount
      ? await estimateOrFallback(provider, {
          from: network.address,
          to: escrowAddress,
          data: depositData,
        }, 220_000n)
      : 220_000n;
    transactions.push(evmPayload({
      type: 'evm-erc20', purpose: 'phone-escrow-deposit', chainId: input.evmChainId,
      nonce: nextNonce, to: escrowAddress, value: 0n, gasLimit: depositGas, gasPrice, data: depositData,
    }));
  } else {
    const depositGas = await estimateOrFallback(provider, {
      from: network.address,
      to: escrowAddress,
      value: escrowAmount,
      data: depositData,
    }, 160_000n);
    transactions.push(evmPayload({
      type: 'evm-native', purpose: 'phone-escrow-deposit', chainId: input.evmChainId,
      nonce, to: escrowAddress, value: escrowAmount, gasLimit: depositGas, gasPrice, data: depositData,
    }));
  }

  const networkFee = transactions.reduce((total, transaction) => (
    total + BigInt(transaction.gasLimit) * BigInt(transaction.gasPrice)
  ), 0n);
  if ((asset.tokenAddress ? networkFee : escrowAmount + networkFee) > input.nativeAvailable) {
    throw new Error('insufficient_balance_for_fee');
  }
  const transaction: SecureTransactionSigningRequest['transaction'] = transactions.length === 1
    ? transactions[0]!
    : { type: 'evm-batch', chainId: input.evmChainId, transactions };
  return {
    transaction,
    escrowAddress,
    commitment,
    claimCode,
    normalizedPhone,
    recipientDisplay: maskPhoneRecipient(normalizedPhone),
    recipientAmountAtomic: input.recipientAmount.toString(),
    escrowAmountAtomic: escrowAmount.toString(),
    claimFeeAtomic: claimFee.toString(),
    networkFeeAtomic: networkFee.toString(),
    expiresAt,
  };
}

function requiredPhoneSecurity(): { piiKey: Buffer; lookupSecret: string } {
  const key = environment('WSS_PII_ENCRYPTION_KEY');
  const lookupSecret = environment('WSS_PHONE_LOOKUP_SECRET');
  if (!key || !lookupSecret) throw new Error('phone_escrow_security_not_configured');
  return { piiKey: encryptionKeyFromHex(key), lookupSecret };
}

function sessionHash(session: Session): string {
  return createHash('sha256').update(`${session.tenantId}\u0000${session.sessionId}`).digest('hex');
}

export async function recordPreparedPhoneEscrow(input: {
  session: Session;
  transferIntentId: string;
  walletId: string;
  chainId: string;
  evmChainId: number;
  tokenAddress?: string;
  preparation: PhoneEscrowPreparation;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('phone_escrow_store_required');
    return;
  }
  const { piiKey, lookupSecret } = requiredPhoneSecurity();
  const { session, preparation } = input;
  const aad = `${session.tenantId}:${input.transferIntentId}:phone-escrow-recipient`;
  const recipientCiphertext = encryptPrivateAttribute(preparation.normalizedPhone, piiKey, aad);
  const recipientHash = phoneLookupHash(session.tenantId, preparation.normalizedPhone, lookupSecret);
  await sql`
    INSERT INTO wss_phone_escrows (
      id, tenant_id, transfer_intent_id, wallet_id, session_id_hash, subject_hash,
      commitment, claim_code, recipient_ciphertext, recipient_lookup_hash,
      chain_id, evm_chain_id, escrow_contract_address, token_contract_address,
      recipient_amount_atomic, escrow_amount_atomic, claim_fee_atomic,
      status, expires_at
    ) VALUES (
      ${randomUUID()}, ${session.tenantId}, ${input.transferIntentId}, ${input.walletId},
      ${sessionHash(session)}, ${session.subject}, ${preparation.commitment}, ${preparation.claimCode},
      ${recipientCiphertext}, ${recipientHash}, ${input.chainId}, ${input.evmChainId},
      ${preparation.escrowAddress}, ${input.tokenAddress ?? ZERO_ADDRESS},
      ${preparation.recipientAmountAtomic}, ${preparation.escrowAmountAtomic}, ${preparation.claimFeeAtomic},
      'prepared', ${preparation.expiresAt}
    )
  `;
}

function claimUrl(code: string): string | undefined {
  const base = configuredClaimBaseUrl();
  if (!base) return undefined;
  return `${base}/${encodeURIComponent(code)}`;
}

function solapiAuthorization(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomUUID().replaceAll('-', '');
  const signature = createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function senderNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{8,12}$/.test(digits)) throw new Error('invalid_sms_sender');
  return digits;
}

async function sendSolapiClaimSms(input: {
  phone: string;
  text: string;
  commitment: string;
}): Promise<string> {
  const apiKey = environment('WSS_SOLAPI_API_KEY');
  const apiSecret = environment('WSS_SOLAPI_API_SECRET');
  const from = environment('WSS_SOLAPI_SENDER_NUMBER');
  if (!apiKey || !apiSecret || !from) throw new Error('phone_escrow_sms_not_configured');
  const response = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: {
      Authorization: solapiAuthorization(apiKey, apiSecret),
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      messages: [{
        to: input.phone,
        from: senderNumber(from),
        text: input.text,
        autoTypeDetect: true,
        country: '82',
        customFields: { purpose: 'wss-phone-escrow', commitment: input.commitment },
      }],
      showMessageList: true,
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    messageList?: Array<{ messageId?: string; statusCode?: string }>;
  };
  const accepted = payload.messageList?.find((message) => message.statusCode === '2000' && message.messageId);
  if (!response.ok || !accepted?.messageId) throw new Error(`solapi_rejected_${response.status}`);
  return accepted.messageId;
}

export function isMatchingPhoneEscrowReceipt(
  receipt: Pick<TransactionReceipt, 'status' | 'to' | 'logs'>,
  reference: PhoneEscrowIntentReference,
): boolean {
  if (receipt.status !== 1 || receipt.to?.toLowerCase() !== reference.escrowAddress.toLowerCase()) return false;
  return receipt.logs.some((log) => {
    try {
      const parsed = escrowInterface.parseLog(log);
      return parsed?.name === 'Deposited'
        && String(parsed.args.commitment).toLowerCase() === reference.commitment.toLowerCase();
    } catch {
      return false;
    }
  });
}

function safeDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'phone_escrow_sms_not_configured' || message === 'invalid_sms_sender') return message;
  const provider = /^solapi_rejected_\d{3}$/.exec(message);
  return provider?.[0] ?? 'sms_delivery_failed';
}

export async function notifyFundedPhoneEscrow(input: {
  session: Session;
  transferIntentId: string;
  depositTransactionHash: string;
  assetSymbol: string;
  recipientAmountDisplay: string;
}): Promise<PhoneEscrowDeliveryResult> {
  if (!sql) return { status: 'pending', recipientDisplay: '휴대폰 수신자' };
  const rows = await sql<PhoneEscrowDatabaseRow[]>`
    SELECT claim_code, recipient_ciphertext, chain_id, commitment, escrow_contract_address,
      recipient_amount_atomic, escrow_amount_atomic, claim_fee_atomic, sms_status
    FROM wss_phone_escrows
    WHERE tenant_id = ${input.session.tenantId}
      AND transfer_intent_id = ${input.transferIntentId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error('phone_escrow_not_found');
  const { piiKey } = requiredPhoneSecurity();
  const aad = `${input.session.tenantId}:${input.transferIntentId}:phone-escrow-recipient`;
  if (!row.recipient_ciphertext) {
    return { status: row.sms_status === 'sent' ? 'sent' : 'pending', recipientDisplay: '휴대폰 수신자' };
  }
  const phone = decryptPrivateAttribute(row.recipient_ciphertext, piiKey, aad);
  const recipientDisplay = maskPhoneRecipient(phone);
  const url = claimUrl(row.claim_code);
  await sql`
    UPDATE wss_phone_escrows
    SET status = 'funded', deposit_transaction_hash = ${input.depositTransactionHash.toLowerCase()},
      funded_at = now(), updated_at = now()
    WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
  `;
  if (!url) {
    await sql`
      UPDATE wss_phone_escrows SET sms_status = 'not-configured', updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
    `;
    return { status: 'pending', recipientDisplay };
  }
  try {
    await sql`
      UPDATE wss_phone_escrows SET sms_status = 'sending', sms_last_error_code = NULL, updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
    `;
    const providerId = await sendSolapiClaimSms({
      phone,
      commitment: row.commitment,
      text: `[키움 디지털 월렛] ${input.recipientAmountDisplay} ${input.assetSymbol} 수령 안내\n${url}\n본인 확인 후 7일 안에 받아주세요.`,
    });
    await sql`
      UPDATE wss_phone_escrows
      SET status = 'notified', sms_status = 'sent', sms_provider = 'solapi',
        sms_provider_id = ${providerId}, notified_at = now(), recipient_ciphertext = NULL,
        recipient_purged_at = now(), updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
    `;
    return { status: 'sent', recipientDisplay };
  } catch (error) {
    await sql`
      UPDATE wss_phone_escrows
      SET sms_status = 'failed', sms_last_error_code = ${safeDeliveryError(error)}, updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
    `;
    return { status: 'failed', recipientDisplay };
  }
}
