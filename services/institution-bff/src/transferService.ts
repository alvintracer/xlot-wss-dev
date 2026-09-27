import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import type {
  PrepareTransferRequest,
  PreparedTransfer,
  ReadyWalletHomePayload,
  SubmitTransferRequest,
  TransferExecutionResult,
  SecureTransactionSigningRequest,
  WssSessionClaims,
} from '@took-wss/contracts';
import { formatUnits, nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';
import { recordAuthorizedTransfer, recordPreparedTransfer, recordSubmittedTransfer } from './transferAuditStore.js';
import { quoteGasSponsorship } from './gasSponsorship.js';
import { stablecoinByAssetId } from './stablecoinRegistry.js';

type Session = Omit<WssSessionClaims, 'nonce'>;

interface StoredIntent {
  sessionId: string;
  subject: string;
  prepared: PreparedTransfer;
  expiresAt: number;
  submitted?: TransferExecutionResult;
  authorizationId?: string;
}

interface KytResponse {
  riskScore?: number;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  isBlocked?: boolean;
  isSanctioned?: boolean;
  kytAvailable?: boolean;
  flags?: Array<{ description?: string }>;
}

const intents = new Map<string, StoredIntent>();
const submissions = new Map<string, TransferExecutionResult>();

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function parseAtomic(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('invalid_transfer_amount');
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error('invalid_transfer_amount');
  return amount;
}

function parseKrw(display: string | undefined): number | null {
  if (!display) return null;
  const value = Number(display.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(value))}원`;
}

function estimatedFiat(display: string, totalFiat: string | undefined, balanceDisplay: string): string | undefined {
  const krw = parseKrw(totalFiat);
  const balance = Number(balanceDisplay.replaceAll(',', ''));
  const amount = Number(display.replaceAll(',', ''));
  if (krw === null || !Number.isFinite(balance) || balance <= 0 || !Number.isFinite(amount)) return undefined;
  return formatKrw(krw / balance * amount);
}

async function screenRecipient(chainId: string, recipient: string, amountUsd: number): Promise<PreparedTransfer['compliance']> {
  const url = process.env.WSS_TOOK_KYT_URL?.trim()
    || (process.env.SUPABASE_URL?.trim() ? `${process.env.SUPABASE_URL.trim().replace(/\/$/, '')}/functions/v1/kyt-screen` : '');
  if (!url) {
    return {
      status: 'unavailable',
      reasonRequired: false,
      message: '위험도 분석을 완료할 수 없어 보낼 수 없습니다.',
    };
  }
  const apiKey = process.env.WSS_TOOK_INFRA_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ address: recipient, network: chainId, direction: 'out', amount_usd: amountUsd }),
    });
    if (!response.ok) throw new Error(`KYT ${response.status}`);
    const result = await response.json() as KytResponse;
    if (!result.kytAvailable) throw new Error('KYT unavailable');
    const blocked = result.isBlocked || result.isSanctioned || result.riskLevel === 'CRITICAL';
    const review = result.riskLevel === 'MEDIUM' || result.riskLevel === 'HIGH';
    return {
      status: blocked ? 'block' : review ? 'review' : 'allow',
      ...(result.riskLevel ? { riskLevel: result.riskLevel } : {}),
      ...(Number.isFinite(result.riskScore) ? { riskScore: result.riskScore } : {}),
      reasonRequired: review,
      message: blocked
        ? result.flags?.[0]?.description || '정책상 보낼 수 없는 주소입니다.'
        : review
          ? '주소 위험 신호가 확인되어 보내는 이유가 필요합니다.'
          : '받는 주소의 위험도 확인을 마쳤어요.',
    };
  } catch {
    return {
      status: 'unavailable',
      reasonRequired: false,
      message: '위험도 분석을 완료할 수 없어 보낼 수 없습니다.',
    };
  }
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [intentId, intent] of intents) {
    if (intent.expiresAt < now) intents.delete(intentId);
  }
}

export async function prepareTransfer(input: {
  session: Session;
  home: ReadyWalletHomePayload;
  request: PrepareTransferRequest;
}): Promise<PreparedTransfer> {
  cleanupExpired();
  const { session, home, request } = input;
  if (request.walletId !== home.wallet.walletId || request.channel !== 'address') throw new Error('unsupported_transfer_channel');
  const asset = home.assets.find((candidate) => candidate.assetId === request.assetId && candidate.chainId === request.chainId);
  const network = home.networks.find((candidate) => candidate.chainId === request.chainId);
  const config = nativeAssetConfig(request.chainId);
  const rpcUrl = nativeAssetRpcUrl(request.chainId);
  if (!asset || !network?.address || network.addressStatus !== 'ready' || !config || !rpcUrl) throw new Error('asset_not_available');
  if (!config.evmChainId) throw new Error('secure_signer_not_available_for_asset');
  const stablecoin = asset.tokenAddress ? stablecoinByAssetId(asset.assetId) : undefined;
  if (asset.tokenAddress && (
    !stablecoin
    || stablecoin.transport !== 'evm-erc20'
    || stablecoin.chainId !== request.chainId
    || stablecoin.tokenAddress.toLowerCase() !== asset.tokenAddress.toLowerCase()
  )) throw new Error('unsupported_token_contract');
  if (!ethers.isAddress(request.recipient)) throw new Error('invalid_recipient');
  if (request.recipient.toLowerCase() === network.address.toLowerCase()) throw new Error('self_transfer_not_allowed');
  const amount = parseAtomic(request.amountAtomic);
  const available = BigInt(asset.availableAtomic ?? asset.balanceAtomic);
  if (amount > available) throw new Error('insufficient_balance');

  const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
  const transactionData = stablecoin
    ? new ethers.Interface(['function transfer(address to, uint256 amount)']).encodeFunctionData('transfer', [request.recipient, amount])
    : undefined;
  const transactionTo = stablecoin?.tokenAddress ?? request.recipient;
  const transactionValue = stablecoin ? 0n : amount;
  const [nonce, feeData, gasLimit] = await Promise.all([
    provider.getTransactionCount(network.address, 'pending'),
    provider.getFeeData(),
    provider.estimateGas({
      from: network.address,
      to: transactionTo,
      value: transactionValue,
      ...(transactionData ? { data: transactionData } : {}),
    }),
  ]);
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error('network_fee_unavailable');
  const feeAtomic = gasLimit * gasPrice;
  const nativeAsset = home.assets.find((candidate) => candidate.assetId === `${request.chainId}:native`);
  const nativeAvailable = stablecoin ? BigInt(nativeAsset?.availableAtomic ?? '0') : available;
  if ((stablecoin ? feeAtomic : amount + feeAtomic) > nativeAvailable) throw new Error('insufficient_balance_for_fee');
  const amountDisplay = formatUnits(amount, asset.decimals ?? config.decimals);
  const feeDisplay = formatUnits(feeAtomic, config.decimals);
  const fiatDisplay = estimatedFiat(amountDisplay, asset.fiat?.display, asset.balanceDisplay);
  const feeFiatDisplay = estimatedFiat(feeDisplay, nativeAsset?.fiat?.display, nativeAsset?.balanceDisplay ?? '0');
  const gasSponsorship = await quoteGasSponsorship({ asset, network, amountDisplay });
  const compliance = await screenRecipient(request.chainId, request.recipient, 0);
  const reviewSatisfied = compliance.status !== 'review' || (request.complianceReason?.trim().length ?? 0) >= 5;
  const intentId = randomUUID();
  const expiresAtMs = Date.now() + 2 * 60_000;
  const signingRequest = compliance.status === 'allow' || (compliance.status === 'review' && reviewSatisfied)
    ? {
        intentId,
        walletId: request.walletId,
        chainId: request.chainId,
        network: network.network,
        assetSymbol: asset.symbol,
        amountDisplay,
        fromAddress: network.address,
        recipient: request.recipient,
        transaction: {
          type: stablecoin ? 'evm-erc20' as const : 'evm-native' as const,
          chainId: config.evmChainId,
          nonce,
          to: transactionTo,
          value: transactionValue.toString(),
          gasLimit: gasLimit.toString(),
          gasPrice: gasPrice.toString(),
          ...(transactionData ? { data: transactionData } : {}),
        },
      }
    : undefined;
  const prepared: PreparedTransfer = {
    intentId,
    walletId: request.walletId,
    assetId: request.assetId,
    chainId: request.chainId,
    network: network.network,
    assetSymbol: asset.symbol,
    fromAddress: network.address,
    recipient: request.recipient,
    amountAtomic: amount.toString(),
    amountDisplay,
    ...(fiatDisplay ? { fiatDisplay } : {}),
    networkFee: {
      symbol: config.symbol,
      amountAtomic: feeAtomic.toString(),
      amountDisplay: feeDisplay,
      ...(feeFiatDisplay ? { fiatDisplay: feeFiatDisplay } : {}),
    },
    gasSponsorship,
    compliance,
    ...(signingRequest ? { signingRequest } : {}),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  await recordPreparedTransfer({ session, request, prepared });
  intents.set(intentId, { sessionId: session.sessionId, subject: session.subject, prepared, expiresAt: expiresAtMs });
  return prepared;
}

export function getTransferSigningRequest(input: {
  session: Session;
  intentId: string;
}): SecureTransactionSigningRequest {
  cleanupExpired();
  const stored = intents.get(input.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) {
    throw new Error('transfer_intent_not_found');
  }
  if (!stored.prepared.signingRequest) throw new Error('transfer_not_approved');
  return stored.prepared.signingRequest;
}

export async function submitTransfer(input: {
  session: Session;
  request: SubmitTransferRequest;
  authorizationId: string;
}): Promise<TransferExecutionResult> {
  cleanupExpired();
  const submissionKey = `${input.session.sessionId}:${input.request.intentId}:${input.request.idempotencyKey}`;
  const existing = submissions.get(submissionKey);
  if (existing) return existing;
  const stored = intents.get(input.request.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) throw new Error('transfer_intent_not_found');
  if (stored.submitted) return stored.submitted;
  if (stored.authorizationId && stored.authorizationId !== input.authorizationId) throw new Error('transfer_authorization_consumed');
  const signing = stored.prepared.signingRequest;
  if (!signing) throw new Error('transfer_not_approved');
  const transaction = ethers.Transaction.from(input.request.signedTransaction);
  if (!transaction.from
    || transaction.from.toLowerCase() !== signing.fromAddress.toLowerCase()
    || transaction.to?.toLowerCase() !== signing.transaction.to.toLowerCase()
    || transaction.chainId !== BigInt(signing.transaction.chainId)
    || transaction.nonce !== signing.transaction.nonce
    || transaction.value !== BigInt(signing.transaction.value)
    || transaction.gasLimit !== BigInt(signing.transaction.gasLimit)
    || transaction.gasPrice !== BigInt(signing.transaction.gasPrice)
    || transaction.data.toLowerCase() !== (signing.transaction.data ?? '0x').toLowerCase()) {
    throw new Error('signed_transaction_mismatch');
  }
  const rpcUrl = nativeAssetRpcUrl(stored.prepared.chainId);
  const config = nativeAssetConfig(stored.prepared.chainId);
  if (!rpcUrl || !config?.evmChainId) throw new Error('execution_provider_unavailable');
  const expectedHash = ethers.keccak256(input.request.signedTransaction);
  await recordAuthorizedTransfer({
    session: input.session,
    request: input.request,
    authorizationId: input.authorizationId,
    transactionHash: expectedHash,
  });
  stored.authorizationId = input.authorizationId;
  const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
  const broadcast = await provider.broadcastTransaction(input.request.signedTransaction);
  if (broadcast.hash !== expectedHash) throw new Error('broadcast_transaction_hash_mismatch');
  const result: TransferExecutionResult = {
    intentId: stored.prepared.intentId,
    status: 'submitted',
    transactionHash: broadcast.hash,
  };
  stored.submitted = result;
  submissions.set(submissionKey, result);
  try {
    await recordSubmittedTransfer({ session: input.session, intentId: input.request.intentId, result });
  } catch (error) {
    console.error('wss_transfer_audit_update_failed', error instanceof Error ? error.message : 'unknown');
  }
  return result;
}
