import { randomUUID } from 'node:crypto';
import { ethers, type TransactionReceipt } from 'ethers';
import { Connection } from '@solana/web3.js';
import type {
  PrepareTransferRequest,
  PreparedTransfer,
  ReadyWalletHomePayload,
  SubmitTransferRequest,
  TransferExecutionResult,
  TransferActivityItem,
  EvmTransactionSigningPayload,
  SecureTransactionSigningRequest,
  WssSessionClaims,
} from '@took-wss/contracts';
import { formatUnits, nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';
import { claimRelayTransfer, getTransferActivity, listTransferActivity, loadPreparedTransfer, loadSubmittedTransfer, recordAuthorizedTransfer, recordPreparedTransfer, recordSubmittedTransfer, recordTransferReconciliation, reserveSolanaSponsor } from './transferAuditStore.js';
import { prepareTookRelay, quoteTookRelay, readTookRelayStatus, submitTookRelay, tookRelayConfigured, tookRelayRoute, type TookRelayQuote } from './tookPermitRelay.js';
import { stablecoinByAssetId } from './stablecoinRegistry.js';
import { cosignSponsoredSolana, solanaSponsorConfigured, solanaSponsorFeePayer } from './solanaSponsor.js';
import { getPhoneRefundStatus } from './phoneEscrowRefundService.js';
import {
  prepareSolanaNativeTransfer,
  prepareSolanaSplTransfer,
  prepareTronNativeTransfer,
  prepareTronTrc20Transfer,
  prepareXrplNativeTransfer,
  prepareXrplIssuedTransfer,
  submitSolanaNativeTransfer,
  submitSolanaSplTransfer,
  submitTronNativeTransfer,
  submitTronTrc20Transfer,
  submitXrplNativeTransfer,
  submitXrplIssuedTransfer,
} from './nonEvmTransfer.js';
import { prepareBitcoinNativeTransfer, submitBitcoinNativeTransfer } from './bitcoinTransfer.js';
import {
  isMatchingPhoneEscrowReceipt,
  notifyFundedPhoneEscrow,
  preparePhoneEscrow,
  quotePhoneEscrow,
  recordPreparedPhoneEscrow,
  type PhoneEscrowIntentReference,
} from './phoneEscrowService.js';

type Session = Omit<WssSessionClaims, 'nonce'>;

interface StoredIntent {
  sessionId: string;
  subject: string;
  prepared: PreparedTransfer;
  expiresAt: number;
  submitted?: TransferExecutionResult;
  authorizationId?: string;
  phoneEscrow?: PhoneEscrowIntentReference;
}

interface KytResponse {
  riskScore?: number;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  isBlocked?: boolean;
  isSanctioned?: boolean;
  kytAvailable?: boolean;
  flags?: Array<{ description?: string }>;
  identifiedAt?: string;
  riskCategory?: string;
}

const intents = new Map<string, StoredIntent>();
const submissions = new Map<string, TransferExecutionResult>();

export function isComplianceReviewSatisfied(
  compliance: PreparedTransfer['compliance'],
  reason?: string,
): boolean {
  return compliance.status !== 'review'
    || !compliance.reasonRequired
    || (reason?.trim().length ?? 0) >= 5;
}

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

export async function getPhoneEscrowQuote(input: {
  home: ReadyWalletHomePayload;
  walletId: string;
  assetId: string;
  chainId: string;
  amountAtomic: string;
}) {
  if (input.home.wallet.walletId !== input.walletId) throw new Error('wallet_not_found');
  const asset = input.home.receiveAssets.find((candidate) => candidate.assetId === input.assetId && candidate.chainId === input.chainId);
  const config = nativeAssetConfig(input.chainId);
  const rpcUrl = nativeAssetRpcUrl(input.chainId);
  if (!asset || !config?.evmChainId || !rpcUrl || asset.balanceStatus !== 'ready'
    || asset.transferStatus !== 'enabled') throw new Error('asset_not_available');
  return quotePhoneEscrow({
    asset,
    recipientAmount: parseAtomic(input.amountAtomic),
    available: BigInt(asset.availableAtomic ?? asset.balanceAtomic),
    rpcUrl,
    evmChainId: config.evmChainId,
  });
}

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(value))}원`;
}

function estimatedFiatFromReference(
  atomic: bigint,
  decimals: number,
  referencePrice: { decimal: string; stale: boolean } | undefined,
): string | undefined {
  if (!referencePrice || referencePrice.stale) return undefined;
  const amount = Number(formatUnits(atomic, decimals, decimals));
  const price = Number(referencePrice.decimal);
  return Number.isFinite(amount) && Number.isFinite(price) && price > 0 ? formatKrw(amount * price) : undefined;
}

export async function screenRecipient(chainId: string, recipient: string, amountUsd: number): Promise<PreparedTransfer['compliance']> {
  const traceId = crypto.randomUUID();
  const startedAt = Date.now();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const url = process.env.WSS_TOOK_KYT_URL?.trim()
    || (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/kyt-screen` : '');
  if (!url) {
    return {
      status: 'unavailable',
      traceId,
      reasonRequired: false,
      message: '주소 위험도 조회를 완료하지 못했어요. 다시 확인해 주세요.',
    };
  }
  let target = 'shared-infra';
  let failure = 'request_failed';
  try {
    const sameSupabaseProject = Boolean(supabaseUrl && new URL(url).origin === new URL(supabaseUrl).origin);
    target = sameSupabaseProject ? 'wss-supabase' : 'shared-infra';
    const apiKey = sameSupabaseProject
      ? process.env.SUPABASE_ANON_KEY?.trim()
      : process.env.WSS_TOOK_INFRA_ANON_KEY?.trim();
    if (!apiKey) {
      failure = 'missing_api_key';
      throw new Error('KYT API key missing');
    }
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WSS-KYT-Trace': traceId,
        ...(apiKey ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ address: recipient, network: chainId, direction: 'out', amount_usd: amountUsd }),
    });
    if (!response.ok) {
      failure = `http_${response.status}`;
      throw new Error('KYT request rejected');
    }
    const result = await response.json() as KytResponse;
    if (!result.kytAvailable || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(result.riskLevel ?? '')) {
      failure = result.kytAvailable ? 'invalid_response' : 'provider_unavailable';
      throw new Error('KYT unavailable');
    }
    const blocked = result.isBlocked || result.isSanctioned || result.riskLevel === 'CRITICAL';
    const review = result.riskLevel === 'MEDIUM' || result.riskLevel === 'HIGH';
    console.info('wss_kyt_screened', { traceId, chainId, status: blocked ? 'block' : review ? 'review' : 'allow', durationMs: Date.now() - startedAt });
    return {
      status: blocked ? 'block' : review ? 'review' : 'allow',
      ...(result.riskLevel ? { riskLevel: result.riskLevel } : {}),
      ...(Number.isFinite(result.riskScore) ? { riskScore: result.riskScore } : {}),
      ...((blocked || review) && typeof result.identifiedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.identifiedAt)
        ? { identifiedAt: result.identifiedAt } : {}),
      ...((blocked || review) && typeof result.riskCategory === 'string' && result.riskCategory.trim().length > 0 && result.riskCategory.length <= 80
        ? { riskCategory: result.riskCategory.trim() } : {}),
      reasonRequired: review,
      message: blocked
        ? result.flags?.[0]?.description || '정책상 보낼 수 없는 주소입니다.'
        : review
          ? '주소 위험 신호가 확인되어 보내는 이유가 필요합니다.'
          : '받는 주소의 위험도 확인을 마쳤어요.',
    };
  } catch (error) {
    console.warn('wss_kyt_unavailable', { traceId, target, chainId, durationMs: Date.now() - startedAt, failure: failure === 'request_failed' && error instanceof Error ? error.name : failure });
    return {
      status: 'unavailable',
      traceId,
      reasonRequired: false,
      message: '주소 위험도 조회를 완료하지 못했어요. 다시 확인해 주세요.',
    };
  }
}

export async function transferRecipientCompliance(
  request: PrepareTransferRequest,
  ownedDestination?: { walletId: string; address: string } | null,
): Promise<PreparedTransfer['compliance']> {
  if (ownedDestination) {
    if (request.channel !== 'address' || request.destinationWalletId !== ownedDestination.walletId) {
      throw new Error('own_wallet_destination_invalid');
    }
    return { status: 'allow', reasonRequired: false, message: '내 지갑의 받는 주소를 확인했어요.' };
  }
  if (request.destinationWalletId) throw new Error('own_wallet_destination_invalid');
  if (request.channel === 'phone') return {
    status: 'allow', reasonRequired: false,
    message: '휴대폰 번호 형식을 확인했어요. 수령 전 본인 확인과 수령 지갑 위험도 확인을 진행해요.',
  };
  return screenRecipient(request.chainId, request.recipient, 0);
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [intentId, intent] of intents) {
    if (intent.expiresAt < now) intents.delete(intentId);
  }
}

async function storedIntent(session: Session, intentId: string): Promise<StoredIntent | null> {
  const cached = intents.get(intentId);
  if (cached) return cached;
  const persisted = await loadPreparedTransfer({ session, intentId });
  if (!persisted) return null;
  const stored: StoredIntent = {
    sessionId: session.sessionId,
    subject: session.subject,
    prepared: persisted.prepared,
    expiresAt: persisted.expiresAt,
    ...(persisted.phoneEscrow ? { phoneEscrow: persisted.phoneEscrow } : {}),
  };
  intents.set(intentId, stored);
  return stored;
}

export async function prepareTransfer(input: {
  session: Session;
  home: ReadyWalletHomePayload;
  request: PrepareTransferRequest;
  ownedDestination?: { walletId: string; address: string } | null;
}): Promise<PreparedTransfer> {
  cleanupExpired();
  const { session, home, request, ownedDestination } = input;
  if (request.walletId !== home.wallet.walletId
    || (request.channel !== 'address' && request.channel !== 'phone')) throw new Error('unsupported_transfer_channel');
  if (request.destinationWalletId && (ownedDestination?.walletId !== request.destinationWalletId
    || (request.chainId === 'ethereum' || request.chainId === 'polygon' || request.chainId === 'arbitrum'
      || request.chainId === 'base' || request.chainId === 'bnb'
      ? ownedDestination.address.toLowerCase() !== request.recipient.toLowerCase()
      : ownedDestination.address !== request.recipient))) throw new Error('own_wallet_destination_invalid');
  const asset = home.receiveAssets.find((candidate) => candidate.assetId === request.assetId && candidate.chainId === request.chainId);
  const network = home.networks.find((candidate) => candidate.chainId === request.chainId);
  const config = nativeAssetConfig(request.chainId);
  const rpcUrl = nativeAssetRpcUrl(request.chainId);
  if (!asset || !network?.address || network.addressStatus !== 'ready' || !config || !rpcUrl) throw new Error('asset_not_available');
  if (asset.transferStatus !== 'enabled') throw new Error('secure_signer_not_available_for_asset');
  if (asset.balanceStatus !== 'ready') throw new Error('asset_balance_unavailable');
  const stablecoin = asset.tokenAddress ? stablecoinByAssetId(asset.assetId) : undefined;
  if (asset.tokenAddress && (
    !stablecoin
    || stablecoin.chainId !== request.chainId
    || stablecoin.tokenAddress.toLowerCase() !== asset.tokenAddress.toLowerCase()
  )) throw new Error('unsupported_token_contract');
  if (request.destinationTag !== undefined && (request.chainId !== 'xrp' || request.channel !== 'address')) throw new Error('destination_tag_not_supported');
  const amount = parseAtomic(request.amountAtomic);
  const available = BigInt(asset.availableAtomic ?? asset.balanceAtomic);
  if (amount > available) throw new Error('insufficient_balance');
  // Screening and network fee/nonce preparation are independent remote calls.
  // Start screening after local validation so their latency overlaps.
  const compliancePromise = transferRecipientCompliance(request, ownedDestination);
  const amountDisplay = formatUnits(amount, asset.decimals, asset.decimals);
  const intentId = randomUUID();
  const expiresAtMs = Date.now() + 2 * 60_000;
  let signingTransaction: SecureTransactionSigningRequest['transaction'];
  let feeAtomic: bigint;
  let maximumFee = false;
  let permitQuote: TookRelayQuote | null = null;
  let solanaSponsorPayer: string | null = null;
  let phonePreparation: Awaited<ReturnType<typeof preparePhoneEscrow>> | undefined;

  if (request.channel === 'phone') {
    if (!config.evmChainId || (stablecoin && stablecoin.transport !== 'evm-erc20')) {
      throw new Error('phone_escrow_network_not_supported');
    }
    const nativeAsset = home.receiveAssets.find((candidate) => candidate.assetId === `${request.chainId}:native`);
    phonePreparation = await preparePhoneEscrow({
      network,
      asset,
      recipient: request.recipient,
      recipientAmount: amount,
      available,
      nativeAvailable: stablecoin ? BigInt(nativeAsset?.availableAtomic ?? '0') : available,
      rpcUrl,
      evmChainId: config.evmChainId,
    });
    signingTransaction = phonePreparation.transaction;
    feeAtomic = BigInt(phonePreparation.networkFeeAtomic);
    maximumFee = true;
  } else if (config.evmChainId) {
    if (stablecoin && stablecoin.transport !== 'evm-erc20') throw new Error('unsupported_token_contract');
    if (!ethers.isAddress(request.recipient)) throw new Error('invalid_recipient');
    if (request.recipient.toLowerCase() === network.address.toLowerCase()) throw new Error('self_transfer_not_allowed');
    if (stablecoin?.symbol === 'USDC' && stablecoin.canonical && asset.decimals === 6) {
      permitQuote = await quoteTookRelay({ chainId: request.chainId, tokenAddress: stablecoin.tokenAddress, recipientAmountAtomic: amount, rpcUrl });
    }
    if (permitQuote) {
      if (permitQuote.totalAtomic > available) throw new Error('insufficient_balance_for_relay_fee');
      feeAtomic = 0n;
      signingTransaction = {
        type: 'evm-permit-relay',
        transfer: {
          id: `tr_${intentId}`,
          sender: network.address,
          recipient: request.recipient,
          chainKey: request.chainId as 'ethereum' | 'polygon' | 'arbitrum' | 'base',
          chainId: permitQuote.chainId,
          tokenAddress: stablecoin!.tokenAddress,
          tokenAmount: ethers.formatUnits(amount, 6),
          expiresAt: new Date(expiresAtMs).toISOString(),
        },
        router: permitQuote.router,
        totalAmountAtomic: permitQuote.totalAtomic.toString(),
        feeAmountAtomic: permitQuote.feeAtomic.toString(),
        totalAmountDisplay: ethers.formatUnits(permitQuote.totalAtomic, 6),
        feeAmountDisplay: ethers.formatUnits(permitQuote.feeAtomic, 6),
      };
    } else {
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
    feeAtomic = gasLimit * gasPrice;
    const nativeAsset = home.receiveAssets.find((candidate) => candidate.assetId === `${request.chainId}:native`);
    const nativeAvailable = stablecoin ? BigInt(nativeAsset?.availableAtomic ?? '0') : available;
    if ((stablecoin ? feeAtomic : amount + feeAtomic) > nativeAvailable) throw new Error('insufficient_balance_for_fee');
    signingTransaction = {
      type: stablecoin ? 'evm-erc20' : 'evm-native',
      purpose: 'asset-transfer',
      chainId: config.evmChainId,
      nonce,
      to: transactionTo,
      value: transactionValue.toString(),
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      ...(transactionData ? { data: transactionData } : {}),
    };
    }
  } else if (!stablecoin && request.chainId === 'solana') {
    const prepared = await prepareSolanaNativeTransfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      amountAtomic: amount,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
  } else if (!stablecoin && request.chainId === 'bitcoin') {
    const prepared = await prepareBitcoinNativeTransfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      amountAtomic: amount,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
  } else if (!stablecoin && request.chainId === 'tron') {
    const prepared = await prepareTronNativeTransfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      amountAtomic: amount,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
    maximumFee = true;
  } else if (!stablecoin && request.chainId === 'xrp') {
    const prepared = await prepareXrplNativeTransfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      ...(request.destinationTag ? { destinationTag: request.destinationTag } : {}),
      amountAtomic: amount,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
  } else if (stablecoin?.transport === 'solana-spl') {
    solanaSponsorPayer = stablecoin.symbol === 'USDC' && stablecoin.canonical
      ? await solanaSponsorFeePayer() : null;
    let prepared: Awaited<ReturnType<typeof prepareSolanaSplTransfer>> | null = null;
    if (solanaSponsorPayer) {
      try {
        prepared = await prepareSolanaSplTransfer({
          rpcUrl, fromAddress: network.address, recipient: request.recipient,
          amountAtomic: amount, deployment: stablecoin, sponsorFeePayer: solanaSponsorPayer,
        });
      } catch {
        solanaSponsorPayer = null;
      }
    }
    prepared ??= await prepareSolanaSplTransfer({
      rpcUrl, fromAddress: network.address, recipient: request.recipient,
      amountAtomic: amount, deployment: stablecoin,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = solanaSponsorPayer ? 0n : prepared.feeAtomic;
  } else if (stablecoin?.transport === 'tron-trc20') {
    const prepared = await prepareTronTrc20Transfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      amountAtomic: amount,
      deployment: stablecoin,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
    maximumFee = true;
    const nativeAsset = home.receiveAssets.find((candidate) => candidate.assetId === `${request.chainId}:native`);
    if (BigInt(nativeAsset?.availableAtomic ?? '0') < feeAtomic) throw new Error('insufficient_balance_for_fee');
  } else if (stablecoin?.transport === 'xrpl-issued') {
    const prepared = await prepareXrplIssuedTransfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      ...(request.destinationTag ? { destinationTag: request.destinationTag } : {}),
      amountAtomic: amount,
      deployment: stablecoin,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
  } else {
    throw new Error('secure_signer_not_available_for_asset');
  }

  const feeDisplay = formatUnits(feeAtomic, config.decimals);
  const fiatDisplay = estimatedFiatFromReference(amount, asset.decimals, asset.referencePrice);
  const nativeAsset = home.receiveAssets.find((candidate) => candidate.assetId === `${request.chainId}:native`);
  const feeFiatDisplay = estimatedFiatFromReference(feeAtomic, config.decimals, nativeAsset?.referencePrice);
  const gasSponsorship = permitQuote
    ? {
        status: 'sponsored' as const,
        method: 'evm-permit-relay' as const,
        tokenFeeDisplay: formatUnits(permitQuote.feeAtomic, 6, 6),
        totalDebitDisplay: formatUnits(permitQuote.totalAtomic, 6, 6),
        message: `네트워크 가스비는 서비스가 부담해요. 릴레이 수수료 ${formatUnits(permitQuote.feeAtomic, 6, 6)} USDC를 포함해 총 ${formatUnits(permitQuote.totalAtomic, 6, 6)} USDC가 차감돼요.`,
      }
    : solanaSponsorPayer
    ? { status: 'sponsored' as const, method: 'solana-relay' as const,
        message: '이 송금의 솔라나 네트워크 수수료는 서비스가 부담해요.' }
    : request.channel === 'phone'
    ? { status: 'not-eligible' as const, message: '에스크로 예치 거래의 네트워크 수수료는 고객이 부담해요.' }
    : config.evmChainId && stablecoin?.symbol === 'USDC' && tookRelayRoute(request.chainId, stablecoin.tokenAddress) && tookRelayConfigured()
    ? { status: 'unavailable' as const, message: '가스비 지원 경로를 사용할 수 없어 일반 전송으로 준비했어요. 네트워크 수수료는 고객이 부담해요.' }
    : request.chainId === 'solana' && stablecoin?.symbol === 'USDC' && solanaSponsorConfigured()
    ? { status: 'unavailable' as const, message: '수수료 지원 경로를 사용할 수 없어 일반 전송으로 준비했어요. 네트워크 수수료는 고객이 부담해요.' }
    : { status: 'not-eligible' as const, message: '현재는 네트워크 수수료를 직접 부담해요.' };
  const compliance = await compliancePromise;
  const reviewSatisfied = isComplianceReviewSatisfied(compliance, request.complianceReason);
  const signingRequest = compliance.status === 'allow' || (compliance.status === 'review' && reviewSatisfied)
    ? {
        intentId,
        walletId: request.walletId,
        chainId: request.chainId,
        network: network.network,
        assetSymbol: asset.symbol,
        amountDisplay,
        fromAddress: network.address,
        recipient: phonePreparation?.recipientDisplay ?? request.recipient,
        channel: request.channel,
        ...(request.destinationTag ? { destinationTag: request.destinationTag } : {}),
        transaction: signingTransaction,
      }
    : undefined;
  const prepared: PreparedTransfer = {
    intentId,
    walletId: request.walletId,
    ...(ownedDestination ? { destinationWalletId: ownedDestination.walletId } : {}),
    assetId: request.assetId,
    chainId: request.chainId,
    network: network.network,
    assetSymbol: asset.symbol,
    fromAddress: network.address,
    recipient: phonePreparation?.recipientDisplay ?? request.recipient,
    channel: request.channel,
    ...(request.destinationTag ? { destinationTag: request.destinationTag } : {}),
    amountAtomic: amount.toString(),
    amountDisplay,
    ...(fiatDisplay ? { fiatDisplay } : {}),
    networkFee: {
      symbol: config.symbol,
      amountAtomic: feeAtomic.toString(),
      amountDisplay: feeDisplay,
      ...(maximumFee ? { maximum: true } : {}),
      ...(feeFiatDisplay ? { fiatDisplay: feeFiatDisplay } : {}),
    },
    gasSponsorship,
    compliance,
    ...(phonePreparation ? {
      phoneEscrow: {
        recipientAmountAtomic: phonePreparation.recipientAmountAtomic,
        recipientAmountDisplay: formatUnits(BigInt(phonePreparation.recipientAmountAtomic), asset.decimals, asset.decimals),
        escrowAmountAtomic: phonePreparation.escrowAmountAtomic,
        escrowAmountDisplay: formatUnits(BigInt(phonePreparation.escrowAmountAtomic), asset.decimals, asset.decimals),
        claimFeeAtomic: phonePreparation.claimFeeAtomic,
        claimFeeDisplay: formatUnits(BigInt(phonePreparation.claimFeeAtomic), asset.decimals, asset.decimals),
        expiresAt: phonePreparation.expiresAt,
      },
    } : {}),
    ...(signingRequest ? { signingRequest } : {}),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  await recordPreparedTransfer({
    session,
    request,
    prepared,
    ...(phonePreparation ? { phoneEscrow: {
      commitment: phonePreparation.commitment, escrowAddress: phonePreparation.escrowAddress,
      senderAddress: network.address, tokenAddress: asset.tokenAddress ?? ethers.ZeroAddress,
      amountAtomic: phonePreparation.escrowAmountAtomic,
    } } : {}),
  });
  if (phonePreparation && config.evmChainId) {
    await recordPreparedPhoneEscrow({
      session,
      transferIntentId: intentId,
      walletId: request.walletId,
      chainId: request.chainId,
      evmChainId: config.evmChainId,
      ...(asset.tokenAddress ? { tokenAddress: asset.tokenAddress } : {}),
      preparation: phonePreparation,
    });
  }
  intents.set(intentId, {
    sessionId: session.sessionId,
    subject: session.subject,
    prepared,
    expiresAt: expiresAtMs,
    ...(phonePreparation ? {
      phoneEscrow: {
        commitment: phonePreparation.commitment, escrowAddress: phonePreparation.escrowAddress,
        senderAddress: network.address, tokenAddress: asset.tokenAddress ?? ethers.ZeroAddress,
        amountAtomic: phonePreparation.escrowAmountAtomic,
      },
    } : {}),
  });
  return prepared;
}

export async function getTransferSigningRequest(input: {
  session: Session;
  intentId: string;
}): Promise<SecureTransactionSigningRequest> {
  cleanupExpired();
  const stored = await storedIntent(input.session, input.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) {
    throw new Error('transfer_intent_not_found');
  }
  if (!stored.prepared.signingRequest) throw new Error('transfer_not_approved');
  return stored.prepared.signingRequest;
}

type RelaySigningPayload = Extract<SecureTransactionSigningRequest['transaction'], { type: 'evm-permit-relay' }>;

function relayQuoteFromSigning(transaction: RelaySigningPayload, prepared: PreparedTransfer): TookRelayQuote {
  const route = tookRelayRoute(prepared.chainId, transaction.transfer.tokenAddress);
  const totalAtomic = BigInt(transaction.totalAmountAtomic);
  const feeAtomic = BigInt(transaction.feeAmountAtomic);
  if (!route || route.router.toLowerCase() !== transaction.router.toLowerCase()
    || route.chainId !== transaction.transfer.chainId
    || transaction.transfer.sender.toLowerCase() !== prepared.fromAddress.toLowerCase()
    || transaction.transfer.recipient.toLowerCase() !== prepared.recipient.toLowerCase()
    || transaction.transfer.chainKey !== prepared.chainId
    || transaction.transfer.tokenAmount !== ethers.formatUnits(BigInt(prepared.amountAtomic), 6)
    || transaction.transfer.id !== `tr_${prepared.intentId}`
    || transaction.transfer.expiresAt !== prepared.expiresAt
    || totalAtomic - feeAtomic !== BigInt(prepared.amountAtomic)
    || prepared.gasSponsorship.status !== 'sponsored') throw new Error('relay_intent_mismatch');
  return { chainId: route.chainId, router: route.router, totalAtomic, feeAtomic };
}

export async function prepareTransferRelayForHost(input: {
  session: Session;
  intentId: string;
  walletAuthSignature: string;
}) {
  cleanupExpired();
  const stored = await storedIntent(input.session, input.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject
    || stored.expiresAt <= Date.now()) throw new Error('transfer_intent_not_found');
  const transaction = stored.prepared.signingRequest?.transaction;
  if (transaction?.type !== 'evm-permit-relay') throw new Error('relay_not_prepared');
  const quote = relayQuoteFromSigning(transaction, stored.prepared);
  return prepareTookRelay(transaction.transfer, input.walletAuthSignature, quote);
}

function verifiedSignedEvmTransaction(
  signedTransaction: string,
  fromAddress: string,
  expected: EvmTransactionSigningPayload,
): { hash: string; transaction: ethers.Transaction } {
  const transaction = ethers.Transaction.from(signedTransaction);
  if (!transaction.from
    || transaction.from.toLowerCase() !== fromAddress.toLowerCase()
    || transaction.to?.toLowerCase() !== expected.to.toLowerCase()
    || transaction.chainId !== BigInt(expected.chainId)
    || transaction.nonce !== expected.nonce
    || transaction.value !== BigInt(expected.value)
    || transaction.gasLimit !== BigInt(expected.gasLimit)
    || transaction.gasPrice !== BigInt(expected.gasPrice)
    || transaction.data.toLowerCase() !== (expected.data ?? '0x').toLowerCase()) {
    throw new Error('signed_transaction_mismatch');
  }
  return { hash: ethers.keccak256(signedTransaction), transaction };
}

function signedEvmBatch(value: string, expectedLength: number): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)
      || parsed.length !== expectedLength
      || parsed.some((candidate) => typeof candidate !== 'string' || candidate.length < 8)) {
      throw new Error('signed_transaction_mismatch');
    }
    return parsed;
  } catch {
    throw new Error('signed_transaction_mismatch');
  }
}

function executionFromActivity(activity: TransferActivityItem): TransferExecutionResult {
  return {
    intentId: activity.intentId,
    status: activity.status === 'confirmed' || activity.status === 'failed' || activity.status === 'submitted'
      ? activity.status : 'processing',
    ...(activity.transactionHash ? { transactionHash: activity.transactionHash } : {}),
  };
}

export async function getTransferStatus(input: { session: Session; intentId: string }): Promise<TransferActivityItem> {
  const activity = await getTransferActivity(input);
  if (!activity) throw new Error('transfer_intent_not_found');
  if (activity.phoneEscrowStatus === 'refunding') {
    await getPhoneRefundStatus({ session: input.session, transferIntentId: input.intentId });
    return await getTransferActivity(input) ?? activity;
  }
  if (activity.status === 'approval-required' && !activity.transactionHash) return activity;
  if (activity.status === 'confirmed' || activity.status === 'failed' || activity.status === 'expired') return activity;
  if (activity.gasSponsorshipMethod === 'evm-permit-relay') {
    const relay = await readTookRelayStatus(`tr_${input.intentId}`);
    if (relay) {
      const status = relay.status === 'awaiting_permit' ? 'processing' : relay.status;
      await recordTransferReconciliation({
        session: input.session, intentId: input.intentId, status,
        ...(relay.txHash ? { transactionHash: relay.txHash } : {}),
      });
    }
  } else if (activity.status === 'submitted' && activity.transactionHash) {
    const config = nativeAssetConfig(activity.chainId);
    const rpcUrl = nativeAssetRpcUrl(activity.chainId);
    if (config?.evmChainId && rpcUrl) {
      const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
      const receipt = await provider.getTransactionReceipt(activity.transactionHash);
      if (receipt) await recordTransferReconciliation({
        session: input.session, intentId: input.intentId,
        status: receipt.status === 1 ? 'confirmed' : 'failed', transactionHash: activity.transactionHash,
      });
    } else if (activity.chainId === 'solana' && rpcUrl) {
      const statuses = await new Connection(rpcUrl, 'confirmed').getSignatureStatuses(
        [activity.transactionHash], { searchTransactionHistory: true },
      );
      const status = statuses.value[0];
      if (status?.err || status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        await recordTransferReconciliation({
          session: input.session, intentId: input.intentId,
          status: status.err ? 'failed' : 'confirmed', transactionHash: activity.transactionHash,
        });
      }
    }
  }
  return await getTransferActivity(input) ?? activity;
}

export async function listWalletTransferActivity(input: { session: Session; walletId: string }): Promise<TransferActivityItem[]> {
  return listTransferActivity(input);
}

async function submitRelayTransfer(input: {
  session: Session;
  request: SubmitTransferRequest;
  authorizationId: string;
  stored: StoredIntent;
  transaction: RelaySigningPayload;
}): Promise<TransferExecutionResult> {
  const quote = relayQuoteFromSigning(input.transaction, input.stored.prepared);
  let signed: { walletAuthSignature?: unknown; permitSignature?: unknown };
  try {
    signed = JSON.parse(input.request.signedTransaction) as typeof signed;
  } catch {
    throw new Error('relay_signature_invalid');
  }
  if (typeof signed.walletAuthSignature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signed.walletAuthSignature)
    || typeof signed.permitSignature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signed.permitSignature)) {
    throw new Error('relay_signature_invalid');
  }
  const existing = await getTransferActivity({ session: input.session, intentId: input.request.intentId });
  if (existing?.status === 'processing') {
    const reconciled = await getTransferStatus({ session: input.session, intentId: input.request.intentId });
    if (reconciled.status !== 'processing') return executionFromActivity(reconciled);
    if (reconciled.transactionHash) return executionFromActivity(reconciled);
  }
  const claimed = await claimRelayTransfer(input);
  if (!claimed) {
    const activity = await getTransferStatus({ session: input.session, intentId: input.request.intentId });
    return executionFromActivity(activity);
  }
  try {
    const transactionHash = await submitTookRelay({
      transfer: input.transaction.transfer,
      quote,
      walletAuthSignature: signed.walletAuthSignature,
      permitSignature: signed.permitSignature,
    });
    await recordTransferReconciliation({
      session: input.session, intentId: input.request.intentId, status: 'confirmed', transactionHash,
    });
    return { intentId: input.request.intentId, status: 'confirmed', transactionHash };
  } catch (error) {
    try {
      return executionFromActivity(await getTransferStatus({ session: input.session, intentId: input.request.intentId }));
    } catch {
      console.warn('wss_relay_status_pending', error instanceof Error ? error.message : 'unknown');
      return { intentId: input.request.intentId, status: 'processing' };
    }
  }
}

async function confirmedEvmBroadcast(
  provider: ethers.JsonRpcProvider,
  signedTransaction: string,
  expectedHash: string,
): Promise<TransactionReceipt> {
  const broadcast = await provider.broadcastTransaction(signedTransaction);
  if (broadcast.hash !== expectedHash) throw new Error('broadcast_transaction_hash_mismatch');
  const receipt = await broadcast.wait(1, 120_000);
  if (!receipt || receipt.status !== 1) throw new Error('phone_escrow_transaction_failed');
  return receipt;
}

export async function submitTransfer(input: {
  session: Session;
  request: SubmitTransferRequest;
  authorizationId: string;
  assertOwnedDestination: (walletId: string, chainId: PreparedTransfer['chainId'], recipient: string) => Promise<void>;
}): Promise<TransferExecutionResult> {
  cleanupExpired();
  const submissionKey = `${input.session.sessionId}:${input.request.intentId}:${input.request.idempotencyKey}`;
  const existing = submissions.get(submissionKey);
  if (existing) return existing;
  const alreadySubmitted = await loadSubmittedTransfer({ session: input.session, intentId: input.request.intentId });
  if (alreadySubmitted) return alreadySubmitted;
  const stored = await storedIntent(input.session, input.request.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) throw new Error('transfer_intent_not_found');
  if (stored.submitted) return stored.submitted;
  if (stored.authorizationId && stored.authorizationId !== input.authorizationId) throw new Error('transfer_authorization_consumed');
  if (stored.prepared.destinationWalletId) {
    await input.assertOwnedDestination(
      stored.prepared.destinationWalletId,
      stored.prepared.chainId,
      stored.prepared.recipient,
    );
  }
  const signing = stored.prepared.signingRequest;
  if (!signing) throw new Error('transfer_not_approved');
  if (signing.transaction.type === 'evm-permit-relay') {
    const result = await submitRelayTransfer({ ...input, stored, transaction: signing.transaction });
    if (result.status === 'confirmed' || result.status === 'failed') {
      stored.submitted = result;
      submissions.set(submissionKey, result);
    }
    return result;
  }
  const rpcUrl = nativeAssetRpcUrl(stored.prepared.chainId);
  const config = nativeAssetConfig(stored.prepared.chainId);
  if (!rpcUrl || !config) throw new Error('execution_provider_unavailable');
  const authorize = async (transactionHash: string) => {
    await recordAuthorizedTransfer({
      session: input.session,
      request: input.request,
      authorizationId: input.authorizationId,
      transactionHash,
    });
    stored.authorizationId = input.authorizationId;
  };
  let transactionHash: string;
  let phoneDelivery: Awaited<ReturnType<typeof notifyFundedPhoneEscrow>> | undefined;
  let phoneConfirmed = false;
  if (signing.transaction.type === 'evm-native' || signing.transaction.type === 'evm-erc20') {
    if (!config.evmChainId) throw new Error('execution_provider_unavailable');
    const verified = verifiedSignedEvmTransaction(
      input.request.signedTransaction,
      signing.fromAddress,
      signing.transaction,
    );
    transactionHash = verified.hash;
    await authorize(transactionHash);
    const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
    if (stored.phoneEscrow) {
      const receipt = await confirmedEvmBroadcast(provider, input.request.signedTransaction, transactionHash);
      if (!isMatchingPhoneEscrowReceipt(receipt, stored.phoneEscrow)) throw new Error('phone_escrow_receipt_mismatch');
      const escrow = stored.prepared.phoneEscrow;
      if (!escrow) throw new Error('phone_escrow_intent_mismatch');
      phoneConfirmed = true;
      phoneDelivery = await notifyFundedPhoneEscrow({
        session: input.session,
        transferIntentId: input.request.intentId,
        depositTransactionHash: transactionHash,
        assetSymbol: stored.prepared.assetSymbol,
        recipientAmountDisplay: escrow.recipientAmountDisplay,
      });
    } else {
      const broadcast = await provider.broadcastTransaction(input.request.signedTransaction);
      if (broadcast.hash !== transactionHash) throw new Error('broadcast_transaction_hash_mismatch');
    }
  } else if (signing.transaction.type === 'evm-batch') {
    if (!config.evmChainId || !stored.phoneEscrow || !stored.prepared.phoneEscrow) {
      throw new Error('unsupported_signed_transaction');
    }
    const signedTransactions = signedEvmBatch(
      input.request.signedTransaction,
      signing.transaction.transactions.length,
    );
    const verified = signing.transaction.transactions.map((transaction, index) => (
      verifiedSignedEvmTransaction(signedTransactions[index]!, signing.fromAddress, transaction)
    ));
    transactionHash = verified.at(-1)!.hash;
    await authorize(transactionHash);
    const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
    let depositReceipt: TransactionReceipt | null = null;
    for (const [index, transaction] of signedTransactions.entries()) {
      depositReceipt = await confirmedEvmBroadcast(provider, transaction, verified[index]!.hash);
    }
    if (!depositReceipt || !isMatchingPhoneEscrowReceipt(depositReceipt, stored.phoneEscrow)) {
      throw new Error('phone_escrow_receipt_mismatch');
    }
    phoneConfirmed = true;
    phoneDelivery = await notifyFundedPhoneEscrow({
      session: input.session,
      transferIntentId: input.request.intentId,
      depositTransactionHash: transactionHash,
      assetSymbol: stored.prepared.assetSymbol,
      recipientAmountDisplay: stored.prepared.phoneEscrow.recipientAmountDisplay,
    });
  } else if (signing.transaction.type === 'solana-native') {
    transactionHash = await submitSolanaNativeTransfer({
      rpcUrl,
      fromAddress: signing.fromAddress,
      signedTransactionBase64: input.request.signedTransaction,
      expected: signing.transaction,
      authorize,
    });
  } else if (signing.transaction.type === 'solana-spl') {
    transactionHash = await submitSolanaSplTransfer({
      rpcUrl,
      fromAddress: signing.fromAddress,
      signedTransactionBase64: input.request.signedTransaction,
      expected: signing.transaction,
      recipient: signing.recipient,
      ...(signing.transaction.sponsorFeePayer ? {
        cosignSponsored: cosignSponsoredSolana,
        reserveSponsor: () => reserveSolanaSponsor({ session: input.session, intentId: input.request.intentId }),
      } : {}),
      authorize,
    });
  } else if (signing.transaction.type === 'bitcoin-native') {
    transactionHash = await submitBitcoinNativeTransfer({
      rpcUrl,
      fromAddress: signing.fromAddress,
      recipient: signing.recipient,
      signedTransactionHex: input.request.signedTransaction,
      expected: signing.transaction,
      authorize,
    });
  } else if (signing.transaction.type === 'tron-native') {
    transactionHash = await submitTronNativeTransfer({
      rpcUrl,
      fromAddress: signing.fromAddress,
      signedTransactionJson: input.request.signedTransaction,
      expected: signing.transaction,
      authorize,
    });
  } else if (signing.transaction.type === 'tron-trc20') {
    transactionHash = await submitTronTrc20Transfer({
      rpcUrl,
      fromAddress: signing.fromAddress,
      signedTransactionJson: input.request.signedTransaction,
      expected: signing.transaction,
      authorize,
    });
  } else if (signing.transaction.type === 'xrpl-native') {
    transactionHash = await submitXrplNativeTransfer({
      rpcUrl,
      signedTransactionBlob: input.request.signedTransaction,
      expected: signing.transaction,
      authorize,
    });
  } else if (signing.transaction.type === 'xrpl-issued') {
    transactionHash = await submitXrplIssuedTransfer({
      rpcUrl,
      signedTransactionBlob: input.request.signedTransaction,
      expected: signing.transaction,
      authorize,
    });
  } else {
    throw new Error('unsupported_signed_transaction');
  }
  const result: TransferExecutionResult = {
    intentId: stored.prepared.intentId,
    status: phoneConfirmed ? 'confirmed' : 'submitted',
    transactionHash,
    ...(phoneDelivery ? {
      delivery: {
        channel: 'phone',
        status: phoneDelivery.status,
        recipientDisplay: phoneDelivery.recipientDisplay,
        ...(phoneDelivery.claimUrl ? { claimUrl: phoneDelivery.claimUrl } : {}),
      },
    } : {}),
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
