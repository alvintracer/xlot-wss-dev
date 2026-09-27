import type { WalletAssetView, WalletNetworkView, WalletValuationView } from '@took-wss/contracts';

export interface NativeAssetConfig {
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
  rpcEnvironment: string;
  evmChainId?: number;
}

const nativeAssets: Readonly<Record<string, NativeAssetConfig>> = {
  ethereum: { name: '이더리움', symbol: 'ETH', decimals: 18, rpcUrl: 'https://ethereum-rpc.publicnode.com', rpcEnvironment: 'WSS_ETHEREUM_RPC_URL', evmChainId: 1 },
  polygon: { name: '폴리곤', symbol: 'POL', decimals: 18, rpcUrl: 'https://polygon-bor-rpc.publicnode.com', rpcEnvironment: 'WSS_POLYGON_RPC_URL', evmChainId: 137 },
  arbitrum: { name: '이더리움', symbol: 'ETH', decimals: 18, rpcUrl: 'https://arbitrum-one-rpc.publicnode.com', rpcEnvironment: 'WSS_ARBITRUM_RPC_URL', evmChainId: 42161 },
  base: { name: '이더리움', symbol: 'ETH', decimals: 18, rpcUrl: 'https://base-rpc.publicnode.com', rpcEnvironment: 'WSS_BASE_RPC_URL', evmChainId: 8453 },
  bnb: { name: '비앤비', symbol: 'BNB', decimals: 18, rpcUrl: 'https://bsc-rpc.publicnode.com', rpcEnvironment: 'WSS_BNB_RPC_URL', evmChainId: 56 },
  solana: { name: '솔라나', symbol: 'SOL', decimals: 9, rpcUrl: 'https://api.mainnet-beta.solana.com', rpcEnvironment: 'WSS_SOLANA_RPC_URL' },
  bitcoin: { name: '비트코인', symbol: 'BTC', decimals: 8, rpcUrl: 'https://blockstream.info/api', rpcEnvironment: 'WSS_BITCOIN_API_URL' },
  tron: { name: '트론', symbol: 'TRX', decimals: 6, rpcUrl: 'https://api.trongrid.io', rpcEnvironment: 'WSS_TRON_API_URL' },
  xrp: { name: '엑스알피', symbol: 'XRP', decimals: 6, rpcUrl: 'https://s1.ripple.com:51234', rpcEnvironment: 'WSS_XRP_RPC_URL' },
};

interface PriceSnapshot {
  krw: number;
  provider: string;
  asOf: string;
}

export interface WalletPortfolioResult {
  assets: WalletAssetView[];
  totalFiat?: { currency: 'KRW'; display: string; asOf: string; stale: boolean };
  valuation: WalletValuationView;
}

export function nativeAssetConfig(chainId: string): NativeAssetConfig | undefined {
  return nativeAssets[chainId];
}

export function nativeAssetRpcUrl(chainId: string): string | undefined {
  const config = nativeAssets[chainId];
  return config ? endpoint(config) : undefined;
}

function endpoint(config: NativeAssetConfig): string {
  return process.env[config.rpcEnvironment]?.trim() || config.rpcUrl;
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 4_500): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error !== undefined || payload.result === undefined) throw new Error('RPC result unavailable');
  return payload.result;
}

async function nativeBalance(network: WalletNetworkView, config: NativeAssetConfig): Promise<bigint> {
  if (!network.address) return 0n;
  const url = endpoint(config);
  if (config.evmChainId) {
    const result = await jsonRpc(url, 'eth_getBalance', [network.address, 'latest']);
    if (typeof result !== 'string') throw new Error('Invalid EVM balance');
    return BigInt(result);
  }
  if (network.chainId === 'solana') {
    const result = await jsonRpc(url, 'getBalance', [network.address, { commitment: 'confirmed' }]);
    if (!result || typeof result !== 'object' || !('value' in result)) throw new Error('Invalid Solana balance');
    return BigInt(String((result as { value: unknown }).value));
  }
  if (network.chainId === 'bitcoin') {
    const response = await fetchWithTimeout(`${url.replace(/\/$/, '')}/address/${encodeURIComponent(network.address)}`);
    if (!response.ok) throw new Error(`Bitcoin API ${response.status}`);
    const result = await response.json() as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    };
    const confirmed = BigInt(result.chain_stats?.funded_txo_sum ?? 0) - BigInt(result.chain_stats?.spent_txo_sum ?? 0);
    const pending = BigInt(result.mempool_stats?.funded_txo_sum ?? 0) - BigInt(result.mempool_stats?.spent_txo_sum ?? 0);
    return confirmed + pending;
  }
  if (network.chainId === 'tron') {
    const response = await fetchWithTimeout(`${url.replace(/\/$/, '')}/v1/accounts/${encodeURIComponent(network.address)}`);
    if (!response.ok) throw new Error(`TRON API ${response.status}`);
    const result = await response.json() as { data?: Array<{ balance?: number }> };
    return BigInt(result.data?.[0]?.balance ?? 0);
  }
  if (network.chainId === 'xrp') {
    try {
      const result = await jsonRpc(url, 'account_info', [{ account: network.address, ledger_index: 'validated' }]);
      if (!result || typeof result !== 'object' || !('account_data' in result)) return 0n;
      const balance = (result as { account_data?: { Balance?: string } }).account_data?.Balance;
      return balance ? BigInt(balance) : 0n;
    } catch {
      return 0n;
    }
  }
  return 0n;
}

export function formatUnits(value: bigint, decimals: number, maximumFractionDigits = 8): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const integer = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').slice(0, maximumFractionDigits).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(value))}원`;
}

async function priceSnapshots(symbols: string[]): Promise<Map<string, PriceSnapshot>> {
  const quoteUrl = process.env.WSS_TOOK_PRICE_QUOTE_URL?.trim()
    || (process.env.SUPABASE_URL?.trim() ? `${process.env.SUPABASE_URL.trim().replace(/\/$/, '')}/functions/v1/wallet-price-quote` : '');
  if (!quoteUrl || symbols.length === 0) return new Map();
  const apiKey = process.env.WSS_TOOK_INFRA_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const response = await fetchWithTimeout(quoteUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ action: 'portfolio', assetKeys: [...new Set(symbols)] }),
  }, 8_000);
  if (!response.ok) return new Map();
  const payload = await response.json() as {
    prices?: Array<{ assetKey?: string; krw?: number; providerKrw?: string; sourceUpdatedAtKrw?: string }>;
  };
  return new Map((payload.prices ?? []).flatMap((price) => {
    if (!price.assetKey || !Number.isFinite(price.krw) || Number(price.krw) <= 0) return [];
    return [[price.assetKey, {
      krw: Number(price.krw),
      provider: price.providerKrw || 'took-market',
      asOf: price.sourceUpdatedAtKrw || new Date().toISOString(),
    }] as const];
  }));
}

export async function queryWalletPortfolio(networks: WalletNetworkView[]): Promise<WalletPortfolioResult> {
  const asOf = new Date().toISOString();
  const settled = await Promise.allSettled(networks.map(async (network) => {
    const config = nativeAssets[network.chainId];
    if (!config || network.addressStatus !== 'ready') return null;
    const balance = await nativeBalance(network, config);
    return { network, config, balance };
  }));
  const holdings = settled.flatMap((result) => (
    result.status === 'fulfilled' && result.value && result.value.balance > 0n ? [result.value] : []
  ));
  const balanceQueriesComplete = settled.every((result) => result.status === 'fulfilled');
  const prices = await priceSnapshots(holdings.map(({ config }) => config.symbol)).catch(() => new Map<string, PriceSnapshot>());
  const assets = holdings.map(({ network, config, balance }): WalletAssetView => {
    const displayBalance = formatUnits(balance, config.decimals);
    const price = prices.get(config.symbol);
    const numericBalance = Number(displayBalance.replaceAll(',', ''));
    return {
      assetId: `${network.chainId}:native`,
      chainId: network.chainId,
      addressGroupId: network.addressGroupId,
      symbol: config.symbol,
      name: config.name,
      network: network.network,
      decimals: config.decimals,
      availableAtomic: balance.toString(),
      transferStatus: config.evmChainId ? 'enabled' : 'unavailable',
      ...(!config.evmChainId ? { transferUnavailableReason: '이 네트워크의 보내기 서명 연동을 준비하고 있어요.' } : {}),
      balanceAtomic: balance.toString(),
      balanceDisplay: displayBalance,
      ...(price && Number.isFinite(numericBalance) ? {
        fiat: {
          currency: 'KRW' as const,
          display: formatKrw(numericBalance * price.krw),
          asOf: price.asOf,
          stale: Date.now() - Date.parse(price.asOf) > 5 * 60_000,
        },
      } : {}),
    };
  });
  const allPriced = assets.length === 0 || assets.every((asset) => asset.fiat);
  const total = assets.reduce((sum, asset) => {
    const numeric = Number(asset.fiat?.display.replace(/[^\d.-]/g, '') ?? '0');
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  const providers = [...new Set([...prices.values()].map((price) => price.provider))];
  return {
    assets,
    ...(balanceQueriesComplete && allPriced ? { totalFiat: { currency: 'KRW' as const, display: formatKrw(total), asOf, stale: assets.some((asset) => asset.fiat?.stale) } } : {}),
    valuation: {
      currency: 'KRW',
      provider: providers.length === 1 ? providers[0]! : providers.length > 1 ? 'hybrid' : 'unavailable',
      status: balanceQueriesComplete && assets.length > 0 && allPriced && prices.size > 0 ? 'live' : 'unavailable',
      asOf,
    },
  };
}
