import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import type {
  ExchangeExecutionResult,
  ExchangeQuote,
  PrepareExchangeRequest,
  PreparedExchange,
  ReadyWalletHomePayload,
  RequestExchangeQuote,
  SecureTransactionSigningRequest,
  SubmitExchangeRequest,
  WalletReceiveAssetView,
  WssSessionClaims,
} from '@took-wss/contracts';
import type { DexQuoteProvider, DexQuoteRequest, DexQuoteResult } from '@took-wss/provider-adapters';
import { formatUnits, nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';
import {
  recordAuthorizedExchange,
  readExchangeExecution,
  recordExchangeReceipt,
  recordPreparedExchange,
  recordSubmittedExchange,
} from './exchangeAuditStore.js';
import { stablecoinByAssetId } from './stablecoinRegistry.js';

type Session = Omit<WssSessionClaims, 'nonce'>;
type FetchLike = typeof fetch;

const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const QUOTE_LIFETIME_MS = 30_000;
const ALLOWANCE_LIFETIME_MS = 5 * 60_000;

interface StoredQuote {
  sessionId: string;
  subject: string;
  response: ExchangeQuote;
  provider: DexQuoteProvider;
  providerQuote: DexQuoteResult;
  fromAddress: string;
  sellAsset: WalletReceiveAssetView;
  buyAsset: WalletReceiveAssetView;
  expiresAt: number;
}

interface StoredIntent {
  sessionId: string;
  subject: string;
  prepared: PreparedExchange;
  expiresAt: number;
  submitted?: ExchangeExecutionResult;
  authorizationId?: string;
}

interface ZeroXQuoteResponse {
  zid?: string;
  liquidityAvailable?: boolean;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  maxSellAmount?: string;
  totalNetworkFee?: string;
  allowanceTarget?: string;
  issues?: {
    allowance?: { actual?: string; spender?: string } | null;
    balance?: unknown;
    simulationIncomplete?: boolean;
  };
  transaction?: {
    to?: string;
    data?: string;
    value?: string;
    gas?: string;
    gasPrice?: string;
  };
}

const quotes = new Map<string, StoredQuote>();
const intents = new Map<string, StoredIntent>();
const submissions = new Map<string, ExchangeExecutionResult>();

function decimalInteger(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  if (/^0x[0-9a-f]+$/i.test(value)) return BigInt(value).toString();
  if (!/^\d+$/.test(value)) throw new Error(`invalid_${field}`);
  return value;
}

function positiveAtomic(value: string, field = 'exchange_amount'): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`invalid_${field}`);
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error(`invalid_${field}`);
  return amount;
}

function withTimeout(fetcher: FetchLike, url: string, init: RequestInit, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetcher(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export function createZeroXExchangeProvider(input: {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: FetchLike;
} = {}): DexQuoteProvider {
  const apiKey = input.apiKey?.trim() || process.env.WSS_ZEROX_API_KEY?.trim();
  const baseUrl = (input.baseUrl?.trim() || process.env.WSS_ZEROX_API_URL?.trim() || 'https://api.0x.org').replace(/\/$/, '');
  const fetcher = input.fetcher ?? fetch;
  return {
    id: '0x-swap-v2',
    async getFirmQuote(request: DexQuoteRequest): Promise<DexQuoteResult> {
      if (!apiKey) throw new Error('exchange_provider_not_configured');
      const parameters = new URLSearchParams({
        chainId: String(request.chainId),
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        taker: request.taker,
        recipient: request.taker,
        [request.mode === 'exact-in' ? 'sellAmount' : 'buyAmount']: request.amountAtomic,
      });
      const response = await withTimeout(fetcher, `${baseUrl}/swap/allowance-holder/quote?${parameters}`, {
        headers: {
          '0x-api-key': apiKey,
          '0x-version': 'v2',
          Accept: 'application/json',
        },
      });
      if (!response.ok) throw new Error(`exchange_quote_provider_${response.status}`);
      const quote = await response.json() as ZeroXQuoteResponse;
      if (quote.liquidityAvailable === false || !quote.transaction) throw new Error('exchange_liquidity_unavailable');
      if (quote.issues?.simulationIncomplete) throw new Error('exchange_simulation_unavailable');
      const sellAmountAtomic = decimalInteger(quote.sellAmount, 'sell_amount');
      const buyAmountAtomic = decimalInteger(quote.buyAmount, 'buy_amount');
      const transactionValue = decimalInteger(quote.transaction.value ?? '0', 'transaction_value');
      const transactionGas = decimalInteger(quote.transaction.gas, 'transaction_gas');
      const transactionGasPrice = quote.transaction.gasPrice === undefined
        ? undefined
        : decimalInteger(quote.transaction.gasPrice, 'transaction_gas_price');
      const networkFeeAtomic = quote.totalNetworkFee === undefined
        ? transactionGasPrice === undefined ? '0' : (BigInt(transactionGas) * BigInt(transactionGasPrice)).toString()
        : decimalInteger(quote.totalNetworkFee, 'network_fee');
      if (!ethers.isAddress(quote.transaction.to)
        || typeof quote.transaction.data !== 'string'
        || !/^0x(?:[0-9a-f]{2})+$/i.test(quote.transaction.data)) {
        throw new Error('invalid_exchange_transaction');
      }
      const allowance = quote.issues?.allowance;
      const allowanceTarget = allowance?.spender ?? quote.allowanceTarget;
      if (allowanceTarget !== undefined && !ethers.isAddress(allowanceTarget)) {
        throw new Error('invalid_exchange_allowance_target');
      }
      return {
        providerQuoteId: quote.zid ?? randomUUID(),
        sellAmountAtomic,
        buyAmountAtomic,
        ...(quote.minBuyAmount === undefined ? {} : { minimumBuyAmountAtomic: decimalInteger(quote.minBuyAmount, 'minimum_buy_amount') }),
        ...(quote.maxSellAmount === undefined ? {} : { maximumSellAmountAtomic: decimalInteger(quote.maxSellAmount, 'maximum_sell_amount') }),
        ...(allowanceTarget ? { allowanceTarget } : {}),
        allowanceRequired: Boolean(allowance),
        liquidityAvailable: true,
        networkFeeAtomic,
        transaction: {
          to: quote.transaction.to,
          data: quote.transaction.data,
          value: transactionValue,
          gas: transactionGas,
          ...(transactionGasPrice ? { gasPrice: transactionGasPrice } : {}),
        },
      };
    },
  };
}

const defaultProvider = createZeroXExchangeProvider();

function assetToken(asset: WalletReceiveAssetView): string {
  if (!asset.tokenAddress) return NATIVE_TOKEN_ADDRESS;
  const deployment = stablecoinByAssetId(asset.assetId);
  if (!deployment
    || deployment.transport !== 'evm-erc20'
    || deployment.chainId !== asset.chainId
    || deployment.tokenAddress.toLowerCase() !== asset.tokenAddress.toLowerCase()) {
    throw new Error('unsupported_exchange_asset');
  }
  return deployment.tokenAddress;
}

function referenceFiat(asset: WalletReceiveAssetView, atomic: string): string | undefined {
  if (!asset.referencePrice || asset.referencePrice.stale) return undefined;
  const tokenAmount = Number(formatUnits(BigInt(atomic), asset.decimals, asset.decimals));
  const price = Number(asset.referencePrice.decimal);
  if (!Number.isFinite(tokenAmount) || !Number.isFinite(price) || price <= 0) return undefined;
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(tokenAmount * price))}원`;
}

function exchangeRateDisplay(sell: WalletReceiveAssetView, buy: WalletReceiveAssetView, result: DexQuoteResult): string {
  const sellAmount = Number(formatUnits(BigInt(result.sellAmountAtomic), sell.decimals, sell.decimals));
  const buyAmount = Number(formatUnits(BigInt(result.buyAmountAtomic), buy.decimals, buy.decimals));
  if (!Number.isFinite(sellAmount) || !Number.isFinite(buyAmount) || sellAmount <= 0) return '교환 비율 확인';
  const rate = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(buyAmount / sellAmount);
  return `1 ${sell.symbol} ≈ ${rate} ${buy.symbol}`;
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [quoteId, quote] of quotes) if (quote.expiresAt < now) quotes.delete(quoteId);
  for (const [intentId, intent] of intents) if (intent.expiresAt < now) intents.delete(intentId);
}

function findExchangeAssets(home: ReadyWalletHomePayload, request: RequestExchangeQuote) {
  if (request.walletId !== home.wallet.walletId || request.sellAssetId === request.buyAssetId) {
    throw new Error('invalid_exchange_pair');
  }
  const sellAsset = home.receiveAssets.find((asset) => asset.assetId === request.sellAssetId && asset.chainId === request.chainId);
  const buyAsset = home.receiveAssets.find((asset) => asset.assetId === request.buyAssetId && asset.chainId === request.chainId);
  const network = home.networks.find((candidate) => candidate.chainId === request.chainId);
  const config = nativeAssetConfig(request.chainId);
  if (!sellAsset || !buyAsset || !network?.address || network.addressStatus !== 'ready' || !config?.evmChainId) {
    throw new Error('exchange_pair_not_available');
  }
  if (sellAsset.balanceStatus === 'unavailable' || sellAsset.transferStatus !== 'enabled') {
    throw new Error('exchange_sell_asset_unavailable');
  }
  return { sellAsset, buyAsset, network, config };
}

export async function requestExchangeQuote(input: {
  session: Session;
  home: ReadyWalletHomePayload;
  request: RequestExchangeQuote;
  provider?: DexQuoteProvider;
}): Promise<ExchangeQuote> {
  cleanupExpired();
  positiveAtomic(input.request.amountAtomic);
  const { sellAsset, buyAsset, network, config } = findExchangeAssets(input.home, input.request);
  const provider = input.provider ?? defaultProvider;
  const providerQuote = await provider.getFirmQuote({
    chainId: config.evmChainId!,
    taker: network.address!,
    sellToken: assetToken(sellAsset),
    buyToken: assetToken(buyAsset),
    mode: input.request.mode,
    amountAtomic: input.request.amountAtomic,
  });
  const sellCeiling = BigInt(providerQuote.maximumSellAmountAtomic ?? providerQuote.sellAmountAtomic);
  const nativeAsset = input.home.receiveAssets.find((asset) => asset.assetId === `${input.request.chainId}:native`);
  const nativeAvailable = BigInt(nativeAsset?.availableAtomic ?? '0');
  const networkFee = BigInt(providerQuote.networkFeeAtomic);
  const balanceSufficient = sellAsset.tokenAddress
    ? BigInt(sellAsset.availableAtomic) >= sellCeiling && nativeAvailable >= networkFee
    : BigInt(sellAsset.availableAtomic) >= sellCeiling + networkFee;
  const quoteId = randomUUID();
  const expiresAt = Date.now() + QUOTE_LIFETIME_MS;
  const response: ExchangeQuote = {
    quoteId,
    walletId: input.request.walletId,
    chainId: input.request.chainId,
    network: network.network,
    mode: input.request.mode,
    sell: {
      assetId: sellAsset.assetId,
      symbol: sellAsset.symbol,
      name: sellAsset.name,
      decimals: sellAsset.decimals,
      amountAtomic: providerQuote.sellAmountAtomic,
      amountDisplay: formatUnits(BigInt(providerQuote.sellAmountAtomic), sellAsset.decimals, sellAsset.decimals),
      ...(referenceFiat(sellAsset, providerQuote.sellAmountAtomic) ? { fiatDisplay: referenceFiat(sellAsset, providerQuote.sellAmountAtomic) } : {}),
    },
    buy: {
      assetId: buyAsset.assetId,
      symbol: buyAsset.symbol,
      name: buyAsset.name,
      decimals: buyAsset.decimals,
      amountAtomic: providerQuote.buyAmountAtomic,
      amountDisplay: formatUnits(BigInt(providerQuote.buyAmountAtomic), buyAsset.decimals, buyAsset.decimals),
      ...(referenceFiat(buyAsset, providerQuote.buyAmountAtomic) ? { fiatDisplay: referenceFiat(buyAsset, providerQuote.buyAmountAtomic) } : {}),
    },
    ...(providerQuote.minimumBuyAmountAtomic ? { minimumBuyAmountAtomic: providerQuote.minimumBuyAmountAtomic } : {}),
    ...(providerQuote.maximumSellAmountAtomic ? { maximumSellAmountAtomic: providerQuote.maximumSellAmountAtomic } : {}),
    rateDisplay: exchangeRateDisplay(sellAsset, buyAsset, providerQuote),
    balanceSufficient,
    allowanceRequired: providerQuote.allowanceRequired,
    networkFee: {
      symbol: config.symbol,
      amountAtomic: providerQuote.networkFeeAtomic,
      amountDisplay: formatUnits(networkFee, config.decimals, config.decimals),
      ...(nativeAsset && referenceFiat(nativeAsset, providerQuote.networkFeeAtomic)
        ? { fiatDisplay: referenceFiat(nativeAsset, providerQuote.networkFeeAtomic) }
        : {}),
      maximum: true,
    },
    expiresAt: new Date(expiresAt).toISOString(),
  };
  quotes.set(quoteId, {
    sessionId: input.session.sessionId,
    subject: input.session.subject,
    response,
    provider,
    providerQuote,
    fromAddress: network.address!,
    sellAsset,
    buyAsset,
    expiresAt,
  });
  return response;
}

function addGasMargin(value: bigint): bigint {
  return value * 12n / 10n;
}

export async function prepareExchange(input: {
  session: Session;
  request: PrepareExchangeRequest;
}): Promise<PreparedExchange> {
  cleanupExpired();
  const stored = quotes.get(input.request.quoteId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) {
    throw new Error('exchange_quote_not_found');
  }
  if (!stored.response.balanceSufficient) throw new Error('insufficient_exchange_balance');
  const config = nativeAssetConfig(stored.response.chainId);
  const rpcUrl = nativeAssetRpcUrl(stored.response.chainId);
  if (!config?.evmChainId || !rpcUrl) throw new Error('exchange_execution_unavailable');
  const rpc = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
  const [nonce, feeData] = await Promise.all([
    rpc.getTransactionCount(stored.fromAddress, 'pending'),
    stored.providerQuote.transaction.gasPrice ? Promise.resolve(null) : rpc.getFeeData(),
  ]);
  const gasPrice = stored.providerQuote.transaction.gasPrice
    ? BigInt(stored.providerQuote.transaction.gasPrice)
    : feeData?.gasPrice ?? feeData?.maxFeePerGas;
  if (!gasPrice) throw new Error('exchange_network_fee_unavailable');
  const transactions: Array<Extract<SecureTransactionSigningRequest['transaction'], { type: 'evm-batch' }>['transactions'][number]> = [];
  if (stored.providerQuote.allowanceRequired) {
    const allowanceTarget = stored.providerQuote.allowanceTarget;
    if (!stored.sellAsset.tokenAddress || !allowanceTarget) throw new Error('exchange_allowance_target_unavailable');
    const approvalAmount = stored.providerQuote.maximumSellAmountAtomic ?? stored.providerQuote.sellAmountAtomic;
    const data = new ethers.Interface(['function approve(address spender, uint256 amount)'])
      .encodeFunctionData('approve', [allowanceTarget, approvalAmount]);
    const estimatedGas = await rpc.estimateGas({
      from: stored.fromAddress,
      to: stored.sellAsset.tokenAddress,
      data,
      value: 0n,
    });
    transactions.push({
      type: 'evm-erc20',
      purpose: 'token-approval',
      chainId: config.evmChainId,
      nonce,
      to: stored.sellAsset.tokenAddress,
      value: '0',
      gasLimit: addGasMargin(estimatedGas).toString(),
      gasPrice: gasPrice.toString(),
      data,
    });
  }
  if (!stored.providerQuote.allowanceRequired) {
    transactions.push({
      type: stored.sellAsset.tokenAddress ? 'evm-erc20' : 'evm-native',
      purpose: 'asset-swap',
      chainId: config.evmChainId,
      nonce,
      to: stored.providerQuote.transaction.to,
      value: stored.providerQuote.transaction.value,
      gasLimit: stored.providerQuote.transaction.gas,
      gasPrice: gasPrice.toString(),
      data: stored.providerQuote.transaction.data,
    });
  }
  const liveNativeBalance = await rpc.getBalance(stored.fromAddress);
  const networkFee = transactions.reduce((sum, transaction) => (
    sum + BigInt(transaction.gasLimit) * BigInt(transaction.gasPrice)
  ), 0n);
  const quoteNetworkFee = stored.providerQuote.allowanceRequired ? 0n : BigInt(stored.providerQuote.networkFeeAtomic);
  const requiredNativeBalance = (stored.providerQuote.allowanceRequired ? 0n : BigInt(stored.providerQuote.transaction.value))
    + (quoteNetworkFee > networkFee ? quoteNetworkFee : networkFee);
  if (liveNativeBalance < requiredNativeBalance) throw new Error('insufficient_exchange_network_fee');
  const intentId = randomUUID();
  const signingRequest: SecureTransactionSigningRequest = {
    intentId,
    walletId: stored.response.walletId,
    operation: 'exchange',
    chainId: stored.response.chainId,
    network: stored.response.network,
    assetSymbol: stored.response.sell.symbol,
    amountDisplay: stored.response.sell.amountDisplay,
    receiveAssetSymbol: stored.response.buy.symbol,
    receiveAmountDisplay: stored.response.buy.amountDisplay,
    fromAddress: stored.fromAddress,
    recipient: stored.fromAddress,
    channel: 'exchange',
    transaction: transactions[0]!,
  };
  const expiresAt = stored.providerQuote.allowanceRequired
    ? Date.now() + ALLOWANCE_LIFETIME_MS
    : stored.expiresAt;
  const prepared: PreparedExchange = {
    ...stored.response,
    ...(stored.providerQuote.allowanceRequired ? {
      networkFee: {
        symbol: config.symbol,
        amountAtomic: networkFee.toString(),
        amountDisplay: formatUnits(networkFee, config.decimals, config.decimals),
        maximum: true,
      },
    } : {}),
    expiresAt: new Date(expiresAt).toISOString(),
    intentId,
    stage: stored.providerQuote.allowanceRequired ? 'allowance' : 'swap',
    signingRequest,
  };
  await recordPreparedExchange({ session: input.session, prepared, provider: stored.provider.id });
  intents.set(intentId, {
    sessionId: input.session.sessionId,
    subject: input.session.subject,
    prepared,
    expiresAt,
  });
  quotes.delete(input.request.quoteId);
  return prepared;
}

export function getExchangeSigningRequest(input: { session: Session; intentId: string }): SecureTransactionSigningRequest {
  cleanupExpired();
  const stored = intents.get(input.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) {
    throw new Error('exchange_intent_not_found');
  }
  return stored.prepared.signingRequest;
}

function verifySignedTransaction(
  signedTransaction: string,
  fromAddress: string,
  expected: Extract<SecureTransactionSigningRequest['transaction'], { type: 'evm-native' | 'evm-erc20' }>,
) {
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
    throw new Error('signed_exchange_transaction_mismatch');
  }
  return { hash: ethers.keccak256(signedTransaction), signedTransaction };
}

export async function submitExchange(input: {
  session: Session;
  request: SubmitExchangeRequest;
  authorizationId: string;
}): Promise<ExchangeExecutionResult> {
  cleanupExpired();
  const submissionKey = `${input.session.sessionId}:${input.request.intentId}:${input.request.idempotencyKey}`;
  const existing = submissions.get(submissionKey);
  if (existing) return existing;
  const stored = intents.get(input.request.intentId);
  if (!stored || stored.sessionId !== input.session.sessionId || stored.subject !== input.session.subject) {
    throw new Error('exchange_intent_not_found');
  }
  if (stored.submitted) return stored.submitted;
  if (stored.authorizationId && stored.authorizationId !== input.authorizationId) {
    throw new Error('exchange_authorization_consumed');
  }
  const config = nativeAssetConfig(stored.prepared.chainId);
  const rpcUrl = nativeAssetRpcUrl(stored.prepared.chainId);
  if (!config?.evmChainId || !rpcUrl) throw new Error('exchange_execution_unavailable');
  const signing = stored.prepared.signingRequest;
  if (signing.transaction.type !== 'evm-native' && signing.transaction.type !== 'evm-erc20') {
    throw new Error('unsupported_exchange_transaction');
  }
  const finalTransaction = verifySignedTransaction(input.request.signedTransaction, signing.fromAddress, signing.transaction);
  await recordAuthorizedExchange({
    session: input.session,
    request: input.request,
    authorizationId: input.authorizationId,
    transactionHash: finalTransaction.hash,
  });
  stored.authorizationId = input.authorizationId;
  const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
  const broadcast = await provider.broadcastTransaction(finalTransaction.signedTransaction);
  if (broadcast.hash !== finalTransaction.hash) throw new Error('broadcast_exchange_hash_mismatch');
  const result: ExchangeExecutionResult = {
    intentId: input.request.intentId,
    status: 'submitted',
    transactionHash: finalTransaction.hash,
  };
  stored.submitted = result;
  submissions.set(submissionKey, result);
  try {
    await recordSubmittedExchange({ session: input.session, intentId: input.request.intentId, result });
  } catch (error) {
    console.error('wss_exchange_audit_update_failed', error instanceof Error ? error.message : 'unknown');
  }
  return result;
}

export async function getExchangeStatus(input: { session: Session; intentId: string }): Promise<ExchangeExecutionResult> {
  const execution = await readExchangeExecution(input);
  const stored = intents.get(input.intentId);
  if (!execution && (!stored || stored.subject !== input.session.subject || !stored.submitted)) {
    throw new Error('exchange_not_submitted');
  }
  const chainId = execution?.chainId ?? stored!.prepared.chainId;
  const transactionHash = execution?.transactionHash ?? stored!.submitted!.transactionHash;
  if (execution?.status === 'confirmed' || execution?.status === 'failed' || execution?.status === 'allowance-confirmed') {
    return { intentId: input.intentId, status: execution.status, transactionHash };
  }
  const config = nativeAssetConfig(chainId);
  const rpcUrl = nativeAssetRpcUrl(chainId);
  if (!config?.evmChainId || !rpcUrl) throw new Error('exchange_status_unavailable');
  const provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId, { staticNetwork: true });
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (receipt) {
    const stage = execution?.stage ?? stored?.prepared.stage;
    const status = receipt.status === 1
      ? stage === 'allowance' ? 'allowance-confirmed' : 'confirmed'
      : 'failed';
    await recordExchangeReceipt({ ...input, transactionHash, status });
    const result: ExchangeExecutionResult = { intentId: input.intentId, status, transactionHash };
    if (stored) stored.submitted = result;
    return result;
  }
  return {
    intentId: input.intentId,
    status: execution?.status === 'approved' ? 'processing' : 'submitted',
    transactionHash,
  };
}
