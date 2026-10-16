import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { smsBrandForTenant } from './smsTenantBrand.js';
import { ethers, type TransactionReceipt } from 'ethers';
import postgres from 'postgres';
import type {
  EvmTransactionSigningPayload,
  SecureTransactionSigningRequest,
  WalletNetworkView,
  WalletReceiveAssetView,
  WssSessionClaims,
} from '@took-wss/contracts';
import { stablecoinByAssetId } from './stablecoinRegistry.js';
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
  commitment: string;
  status: string;
  sms_status: string;
  deposit_transaction_hash: string | null;
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
  senderAddress: string;
  tokenAddress: string;
  amountAtomic: string;
}

export interface PhoneEscrowDeliveryResult {
  status: 'pending' | 'sent' | 'failed';
  recipientDisplay: string;
  claimUrl?: string;
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

const phoneUsdcChains = new Set(['ethereum', 'polygon', 'arbitrum', 'base']);
const phoneNativeAssets: Record<string, { symbol: string; limit: bigint }> = {
  ethereum: { symbol: 'ETH', limit: 100_000_000_000_000_000n }, // 0.1 ETH
  arbitrum: { symbol: 'ETH', limit: 100_000_000_000_000_000n },
  base: { symbol: 'ETH', limit: 100_000_000_000_000_000n },
  polygon: { symbol: 'POL', limit: 100_000_000_000_000_000_000n }, // 100 POL
};

/** Customer payout cap, in the selected asset's smallest unit. */
export function phoneEscrowAssetLimit(chainId: string, assetId: string): bigint | undefined {
  if (assetId === `${chainId}:native`) return phoneNativeAssets[chainId]?.limit;
  if (!phoneUsdcChains.has(chainId)) return undefined;
  const coin = stablecoinByAssetId(assetId);
  return coin?.chainId === chainId && coin.symbol === 'USDC' && coin.canonical
    && coin.transport === 'evm-erc20' && coin.decimals === 6 ? 100_000_000n : undefined; // 100 USDC
}

function expectedPhoneEscrowAsset(asset: WalletReceiveAssetView): boolean {
  if (!phoneEscrowAssetLimit(asset.chainId, asset.assetId)) return false;
  if (asset.assetId === `${asset.chainId}:native`) {
    return !asset.tokenAddress && asset.symbol === phoneNativeAssets[asset.chainId]?.symbol && asset.decimals === 18;
  }
  const coin = stablecoinByAssetId(asset.assetId);
  return Boolean(coin && asset.tokenAddress?.toLowerCase() === coin.tokenAddress.toLowerCase()
    && asset.symbol === coin.symbol && asset.decimals === coin.decimals);
}

function allowedPilotAsset(chainId: string, assetId?: string): boolean {
  if (!assetId || !phoneEscrowAssetLimit(chainId, assetId)) return false;
  const allowed = environment('WSS_PHONE_ESCROW_ALLOWED_ASSET_IDS');
  // Production requires an explicit deployment allowlist in addition to the code policy.
  if (!allowed) return process.env.NODE_ENV !== 'production';
  return allowed.split(',').map((item) => item.trim().toLowerCase()).includes(assetId.toLowerCase());
}

export function supportsPhoneEscrow(chainId: string, assetId?: string): boolean {
  const expectedSigner = environment('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS');
  return environment('WSS_PHONE_ESCROW_EXECUTION_ENABLED') === 'true'
    && allowedPilotAsset(chainId, assetId)
    && Boolean(configuredClaimBaseUrl())
    && Boolean(expectedSigner && ethers.isAddress(expectedSigner) && expectedSigner !== ZERO_ADDRESS)
    && Boolean(phoneEscrowAddress(chainId));
}

export function phoneEscrowUnavailableReason(chainId: string, assetId?: string): string | undefined {
  if (supportsPhoneEscrow(chainId, assetId)) return undefined;
  if (!phoneEscrowAddress(chainId)) return '이 네트워크에서는 아직 휴대폰 번호로 보낼 수 없어요.';
  if (!allowedPilotAsset(chainId, assetId)) return '현재 이 자산은 휴대폰 번호 송금 대상이 아니에요.';
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

export function maximumPhoneEscrowRecipient(
  available: bigint,
  feeRate: bigint,
  minFee: bigint,
  fixedFee: bigint,
  cap?: bigint,
): bigint {
  if (available <= 0n) return 0n;
  let low = 0n;
  let high = cap && cap < available ? cap : available;
  while (low < high) {
    const candidate = (low + high + 1n) / 2n;
    const { escrowAmount } = senderPaysEscrowDeposit(candidate, feeRate, minFee, fixedFee);
    if (escrowAmount <= available) low = candidate;
    else high = candidate - 1n;
  }
  return low;
}

export async function quotePhoneEscrow(input: {
  asset: WalletReceiveAssetView;
  recipientAmount: bigint;
  available: bigint;
  rpcUrl: string;
  evmChainId: number;
}): Promise<{
  recipientAmountAtomic: string;
  escrowAmountAtomic: string;
  claimFeeAtomic: string;
  maximumRecipientAtomic: string;
}> {
  const { asset } = input;
  if (!supportsPhoneEscrow(asset.chainId, asset.assetId)) throw new Error('phone_escrow_not_configured');
  if (!expectedPhoneEscrowAsset(asset)) throw new Error('phone_escrow_asset_mismatch');
  if (input.recipientAmount <= 0n || input.available < 0n) throw new Error('invalid_transfer_amount');
  const address = phoneEscrowAddress(asset.chainId);
  if (!address) throw new Error('phone_escrow_network_not_supported');
  const provider = new ethers.JsonRpcProvider(input.rpcUrl, input.evmChainId, { staticNetwork: true });
  const [feeRate, minFee, fixedFee, signer] = await Promise.all([
    readContractUint(provider, address, escrowInterface, 'feeRate'),
    readContractUint(provider, address, escrowInterface, 'minFee'),
    readContractUint(provider, address, escrowInterface, 'fixedFee'),
    readContractAddress(provider, address, escrowInterface, 'serverSigner'),
  ]);
  const expectedSigner = environment('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS');
  if (!expectedSigner || signer !== ethers.getAddress(expectedSigner)) throw new Error('phone_escrow_claim_signer_mismatch');
  const maximumByPolicy = phoneEscrowAssetLimit(asset.chainId, asset.assetId)!;
  const maximumRecipient = maximumPhoneEscrowRecipient(
    input.available, feeRate, minFee, fixedFee,
    maximumByPolicy,
  );
  const { escrowAmount, claimFee } = senderPaysEscrowDeposit(input.recipientAmount, feeRate, minFee, fixedFee);
  return {
    recipientAmountAtomic: input.recipientAmount.toString(),
    escrowAmountAtomic: escrowAmount.toString(),
    claimFeeAtomic: claimFee.toString(),
    maximumRecipientAtomic: maximumRecipient.toString(),
  };
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
  if (!supportsPhoneEscrow(asset.chainId, asset.assetId)) throw new Error('phone_escrow_not_configured');
  if (!expectedPhoneEscrowAsset(asset)) throw new Error('phone_escrow_asset_mismatch');
  if (input.recipientAmount > phoneEscrowAssetLimit(asset.chainId, asset.assetId)!) throw new Error('phone_escrow_pilot_limit');
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

export function phoneEscrowClaimUrl(code: string): string | undefined {
  return /^[A-Za-z0-9_-]{12}$/.test(code) ? claimUrl(code) : undefined;
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
    if (log.address.toLowerCase() !== reference.escrowAddress.toLowerCase()) return false;
    try {
      const parsed = escrowInterface.parseLog(log);
      return parsed?.name === 'Deposited'
        && String(parsed.args.commitment).toLowerCase() === reference.commitment.toLowerCase()
        && String(parsed.args.sender).toLowerCase() === reference.senderAddress.toLowerCase()
        && String(parsed.args.token).toLowerCase() === reference.tokenAddress.toLowerCase()
        && BigInt(parsed.args.amount) === BigInt(reference.amountAtomic);
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
  const db = sql;
  const depositHash = input.depositTransactionHash.toLowerCase();
  const funded = await db<PhoneEscrowDatabaseRow[]>`
    UPDATE wss_phone_escrows escrow
    SET status = CASE WHEN escrow.status IN ('prepared', 'submitted') THEN 'funded' ELSE escrow.status END,
      deposit_transaction_hash = COALESCE(escrow.deposit_transaction_hash, ${depositHash}),
      funded_at = COALESCE(escrow.funded_at, now()), updated_at = now()
    FROM wss_transfer_intents intent
    WHERE escrow.tenant_id = ${input.session.tenantId}
      AND escrow.transfer_intent_id = ${input.transferIntentId}
      AND intent.tenant_id = escrow.tenant_id AND intent.id = escrow.transfer_intent_id
      AND intent.subject_hash = ${input.session.subject}
      AND escrow.status IN ('prepared', 'submitted', 'funded', 'notified')
      AND (escrow.deposit_transaction_hash IS NULL OR escrow.deposit_transaction_hash = ${depositHash})
    RETURNING escrow.claim_code, escrow.recipient_ciphertext, escrow.commitment,
      escrow.status, escrow.sms_status, escrow.deposit_transaction_hash
  `;
  const row = funded[0];
  if (!row) throw new Error('phone_escrow_not_found');
  const url = claimUrl(row.claim_code);
  if (!url) {
    await db`
      UPDATE wss_phone_escrows SET sms_status = 'not-configured', updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
        AND sms_status = 'pending'
    `;
    return { status: 'pending', recipientDisplay: '휴대폰 수신자' };
  }
  if (row.sms_status === 'sent') return { status: 'sent', recipientDisplay: '휴대폰 수신자', claimUrl: url };
  const claimed = await db<PhoneEscrowDatabaseRow[]>`
    UPDATE wss_phone_escrows escrow
    SET sms_status = 'sending', sms_attempts = escrow.sms_attempts + 1,
      sms_last_attempt_at = now(), sms_last_error_code = NULL, updated_at = now()
    WHERE escrow.tenant_id = ${input.session.tenantId}
      AND escrow.transfer_intent_id = ${input.transferIntentId}
      AND escrow.status IN ('funded', 'notified') AND escrow.expires_at > now()
      AND escrow.recipient_ciphertext IS NOT NULL
      AND escrow.sms_attempts < 5
      AND (escrow.sms_status IN ('pending', 'failed', 'not-configured')
        OR (escrow.sms_status = 'sending' AND escrow.sms_last_attempt_at < now() - interval '2 minutes'))
      AND (escrow.sms_last_attempt_at IS NULL OR escrow.sms_last_attempt_at < now() - interval '60 seconds')
    RETURNING escrow.claim_code, escrow.recipient_ciphertext, escrow.commitment,
      escrow.status, escrow.sms_status, escrow.deposit_transaction_hash
  `;
  const sending = claimed[0];
  if (!sending?.recipient_ciphertext) {
    return { status: row.sms_status === 'failed' ? 'failed' : 'pending', recipientDisplay: '휴대폰 수신자', claimUrl: url };
  }
  const { piiKey } = requiredPhoneSecurity();
  const aad = `${input.session.tenantId}:${input.transferIntentId}:phone-escrow-recipient`;
  const phone = decryptPrivateAttribute(sending.recipient_ciphertext, piiKey, aad);
  const recipientDisplay = maskPhoneRecipient(phone);
  try {
    const providerId = await sendSolapiClaimSms({
      phone,
      commitment: sending.commitment,
      text: `[${smsBrandForTenant(input.session.tenantId)}] ${input.recipientAmountDisplay} ${input.assetSymbol} 수령 안내\n${url}\n본인 확인 후 7일 안에 받아주세요.`,
    });
    await db`
      UPDATE wss_phone_escrows
      SET status = CASE WHEN status = 'funded' THEN 'notified' ELSE status END,
        sms_status = 'sent', sms_provider = 'solapi',
        sms_provider_id = ${providerId}, notified_at = now(), recipient_ciphertext = NULL,
        recipient_purged_at = now(), updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
        AND sms_status = 'sending'
    `;
    return { status: 'sent', recipientDisplay, claimUrl: url };
  } catch (error) {
    await db`
      UPDATE wss_phone_escrows
      SET sms_status = 'failed', sms_last_error_code = ${safeDeliveryError(error)}, updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.transferIntentId}
        AND sms_status = 'sending'
    `;
    return { status: 'failed', recipientDisplay, claimUrl: url };
  }
}

export async function retryPhoneEscrowNotification(input: { session: Session; transferIntentId: string }): Promise<PhoneEscrowDeliveryResult> {
  if (!sql) throw new Error('phone_escrow_store_required');
  const rows = await sql<{
    deposit_transaction_hash: string | null;
    status: string;
    sms_status: string;
    sms_attempts: number;
    sms_last_attempt_at: Date | null;
    expires_at: Date;
    asset_symbol: string;
    prepared_payload: { phoneEscrow?: { recipientAmountDisplay?: string }; recipient?: string } | null;
  }[]>`
    SELECT escrow.deposit_transaction_hash, escrow.status, escrow.sms_status,
      escrow.sms_attempts, escrow.sms_last_attempt_at, escrow.expires_at,
      intent.asset_symbol, intent.prepared_payload
    FROM wss_phone_escrows escrow
    JOIN wss_transfer_intents intent ON intent.tenant_id = escrow.tenant_id
      AND intent.id = escrow.transfer_intent_id
    WHERE escrow.tenant_id = ${input.session.tenantId}
      AND escrow.transfer_intent_id = ${input.transferIntentId}
      AND intent.subject_hash = ${input.session.subject}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.deposit_transaction_hash || !['funded', 'notified'].includes(row.status)
    || row.expires_at.getTime() <= Date.now()) throw new Error('phone_escrow_not_ready');
  if (row.sms_status === 'sent') throw new Error('phone_escrow_sms_already_sent');
  if (row.sms_attempts >= 5) throw new Error('phone_escrow_sms_limit_reached');
  if (row.sms_last_attempt_at && Date.now() - row.sms_last_attempt_at.getTime() < 60_000) throw new Error('phone_escrow_sms_rate_limited');
  const recipientAmountDisplay = row.prepared_payload?.phoneEscrow?.recipientAmountDisplay;
  if (!recipientAmountDisplay) throw new Error('phone_escrow_intent_mismatch');
  const delivery = await notifyFundedPhoneEscrow({
    session: input.session, transferIntentId: input.transferIntentId,
    depositTransactionHash: row.deposit_transaction_hash,
    assetSymbol: row.asset_symbol, recipientAmountDisplay,
  });
  return { ...delivery, recipientDisplay: row.prepared_payload?.recipient ?? delivery.recipientDisplay };
}
