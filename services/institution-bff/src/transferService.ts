import { randomUUID } from 'node:crypto';
import { ethers, type TransactionReceipt } from 'ethers';
import type {
  PrepareTransferRequest,
  PreparedTransfer,
  ReadyWalletHomePayload,
  SubmitTransferRequest,
  TransferExecutionResult,
  EvmTransactionSigningPayload,
  SecureTransactionSigningRequest,
  WssSessionClaims,
} from '@took-wss/contracts';
import { formatUnits, nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';
import { recordAuthorizedTransfer, recordPreparedTransfer, recordSubmittedTransfer } from './transferAuditStore.js';
import { quoteGasSponsorship } from './gasSponsorship.js';
import { stablecoinByAssetId } from './stablecoinRegistry.js';
import {
  prepareSolanaSplTransfer,
  prepareTronTrc20Transfer,
  prepareXrplIssuedTransfer,
  submitSolanaSplTransfer,
  submitTronTrc20Transfer,
  submitXrplIssuedTransfer,
} from './nonEvmTransfer.js';
import {
  isMatchingPhoneEscrowReceipt,
  notifyFundedPhoneEscrow,
  preparePhoneEscrow,
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
  if (request.walletId !== home.wallet.walletId
    || (request.channel !== 'address' && request.channel !== 'phone')) throw new Error('unsupported_transfer_channel');
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
  if (!stablecoin && !config.evmChainId) throw new Error('secure_signer_not_available_for_asset');
  if (request.destinationTag !== undefined && (request.chainId !== 'xrp' || request.channel !== 'address')) throw new Error('destination_tag_not_supported');
  const amount = parseAtomic(request.amountAtomic);
  const available = BigInt(asset.availableAtomic ?? asset.balanceAtomic);
  if (amount > available) throw new Error('insufficient_balance');
  const amountDisplay = formatUnits(amount, asset.decimals, asset.decimals);
  let signingTransaction: SecureTransactionSigningRequest['transaction'];
  let feeAtomic: bigint;
  let maximumFee = false;
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
  } else if (stablecoin?.transport === 'solana-spl') {
    const prepared = await prepareSolanaSplTransfer({
      rpcUrl,
      fromAddress: network.address,
      recipient: request.recipient,
      amountAtomic: amount,
      deployment: stablecoin,
    });
    signingTransaction = prepared.transaction;
    feeAtomic = prepared.feeAtomic;
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
  const gasSponsorship = request.channel === 'phone'
    ? { status: 'not-eligible' as const, message: '에스크로 예치 거래의 네트워크 수수료는 고객이 부담해요.' }
    : config.evmChainId
    ? await quoteGasSponsorship({ asset, network, amountDisplay })
    : { status: 'not-eligible' as const, message: '현재는 네트워크 수수료를 직접 부담해요.' };
  const compliance = request.channel === 'phone'
    ? {
        status: 'allow' as const,
        reasonRequired: false,
        message: '휴대폰 번호 형식을 확인했어요. 수령 전 본인 확인과 수령 지갑 위험도 확인을 진행해요.',
      }
    : await screenRecipient(request.chainId, request.recipient, 0);
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
        recipient: phonePreparation?.recipientDisplay ?? request.recipient,
        channel: request.channel,
        ...(request.destinationTag ? { destinationTag: request.destinationTag } : {}),
        transaction: signingTransaction,
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
  await recordPreparedTransfer({ session, request, prepared });
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
      phoneEscrow: { commitment: phonePreparation.commitment, escrowAddress: phonePreparation.escrowAddress },
    } : {}),
  });
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
  } else if (signing.transaction.type === 'solana-spl') {
    transactionHash = await submitSolanaSplTransfer({
      rpcUrl,
      fromAddress: signing.fromAddress,
      signedTransactionBase64: input.request.signedTransaction,
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
