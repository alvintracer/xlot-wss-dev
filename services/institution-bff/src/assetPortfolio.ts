import type {
  WalletAssetView,
  WalletNetworkView,
  WalletReceiveAssetView,
  WalletValuationView,
} from '@took-wss/contracts';
import { stablecoinsForPolicy, type StablecoinDeployment } from './stablecoinRegistry.js';
import { phoneEscrowUnavailableReason, supportsPhoneEscrow } from './phoneEscrowService.js';

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

const SOLANA_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOLANA_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

interface PriceSnapshot {
  krw: number;
  provider: string;
  asOf: string;
}

function iconAssetId(symbol: string): string {
  return `coin:${symbol.toLowerCase()}`;
}

interface ScannedBalance {
  network: WalletNetworkView;
  config: NativeAssetConfig;
  deployment?: StablecoinDeployment;
  balance: bigint;
}

interface NetworkScan {
  balances: ScannedBalance[];
  complete: boolean;
}

export interface WalletPortfolioResult {
  assets: WalletAssetView[];
  receiveAssets: WalletReceiveAssetView[];
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
  const embeddedError = payload.result && typeof payload.result === 'object' && 'error' in payload.result
    ? (payload.result as { error?: unknown }).error
    : undefined;
  if (payload.error !== undefined || embeddedError !== undefined || payload.result === undefined) {
    const error = payload.error ?? embeddedError;
    const detail = typeof error === 'string' ? error : JSON.stringify(error ?? {});
    throw new Error(`RPC result unavailable: ${detail}`);
  }
  return payload.result;
}

function erc20BalanceOfData(address: string): string {
  return `0x70a08231${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

async function scanEvm(
  network: WalletNetworkView,
  config: NativeAssetConfig,
  deployments: StablecoinDeployment[],
): Promise<NetworkScan> {
  const requests = [
    { jsonrpc: '2.0', id: 0, method: 'eth_getBalance', params: [network.address, 'latest'] },
    ...deployments.map((item, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'eth_call',
      params: [{ to: item.tokenAddress, data: erc20BalanceOfData(network.address!) }, 'latest'],
    })),
  ];
  const response = await fetchWithTimeout(endpoint(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
  });
  if (!response.ok) throw new Error(`RPC ${response.status}`);
  const payload = await response.json() as Array<{ id?: number; result?: string; error?: unknown }>;
  if (!Array.isArray(payload)) throw new Error('Invalid EVM batch result');
  const byId = new Map(payload.map((item) => [item.id, item]));
  const native = byId.get(0);
  if (!native?.result || native.error) throw new Error('EVM native balance unavailable');
  const balances: ScannedBalance[] = [{ network, config, balance: BigInt(native.result) }];
  let complete = true;
  deployments.forEach((deployment, index) => {
    const item = byId.get(index + 1);
    if (!item?.result || item.error) {
      complete = false;
      return;
    }
    balances.push({ network, config, deployment, balance: BigInt(item.result) });
  });
  return { balances, complete };
}

async function scanSolana(
  network: WalletNetworkView,
  config: NativeAssetConfig,
  deployments: StablecoinDeployment[],
): Promise<NetworkScan> {
  const [nativeResult, classicTokenResult, token2022Result] = await Promise.allSettled([
    jsonRpc(endpoint(config), 'getBalance', [network.address, { commitment: 'confirmed' }]),
    jsonRpc(endpoint(config), 'getTokenAccountsByOwner', [
      network.address,
      { programId: SOLANA_TOKEN_PROGRAM },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
    jsonRpc(endpoint(config), 'getTokenAccountsByOwner', [
      network.address,
      { programId: SOLANA_TOKEN_2022_PROGRAM },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
  ]);
  if (nativeResult.status === 'rejected') throw nativeResult.reason;
  if (!nativeResult.value || typeof nativeResult.value !== 'object' || !('value' in nativeResult.value)) {
    throw new Error('Invalid Solana balance');
  }
  const balances: ScannedBalance[] = [{
    network,
    config,
    balance: BigInt(String((nativeResult.value as { value: unknown }).value)),
  }];
  const tokenResults = [classicTokenResult, token2022Result];
  const accounts = tokenResults.flatMap((result) => result.status === 'fulfilled'
    ? ((result.value as {
        value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } } }>;
      }).value ?? [])
    : []);
  const totals = new Map<string, bigint>();
  for (const account of accounts) {
    const info = account.account?.data?.parsed?.info;
    if (!info?.mint || !/^\d+$/.test(info.tokenAmount?.amount ?? '')) continue;
    totals.set(info.mint, (totals.get(info.mint) ?? 0n) + BigInt(info.tokenAmount!.amount!));
  }
  for (const deployment of deployments) {
    balances.push({ network, config, deployment, balance: totals.get(deployment.tokenAddress) ?? 0n });
  }
  return { balances, complete: tokenResults.every((result) => result.status === 'fulfilled') };
}

async function scanBitcoin(network: WalletNetworkView, config: NativeAssetConfig): Promise<NetworkScan> {
  const url = endpoint(config);
  const response = await fetchWithTimeout(`${url.replace(/\/$/, '')}/address/${encodeURIComponent(network.address!)}`);
  if (!response.ok) throw new Error(`Bitcoin API ${response.status}`);
  const result = await response.json() as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const confirmed = BigInt(result.chain_stats?.funded_txo_sum ?? 0) - BigInt(result.chain_stats?.spent_txo_sum ?? 0);
  const pending = BigInt(result.mempool_stats?.funded_txo_sum ?? 0) - BigInt(result.mempool_stats?.spent_txo_sum ?? 0);
  return { balances: [{ network, config, balance: confirmed + pending }], complete: true };
}

async function scanTron(
  network: WalletNetworkView,
  config: NativeAssetConfig,
  deployments: StablecoinDeployment[],
): Promise<NetworkScan> {
  const url = endpoint(config);
  const response = await fetchWithTimeout(`${url.replace(/\/$/, '')}/v1/accounts/${encodeURIComponent(network.address!)}`);
  if (!response.ok) throw new Error(`TRON API ${response.status}`);
  const result = await response.json() as {
    data?: Array<{ balance?: number; trc20?: Array<Record<string, string>> }>;
  };
  const account = result.data?.[0];
  const tokenBalances = new Map<string, bigint>();
  for (const entry of account?.trc20 ?? []) {
    for (const [address, amount] of Object.entries(entry)) {
      if (/^\d+$/.test(amount)) tokenBalances.set(address, BigInt(amount));
    }
  }
  return {
    balances: [
      { network, config, balance: BigInt(account?.balance ?? 0) },
      ...deployments.map((deployment) => ({
        network,
        config,
        deployment,
        balance: tokenBalances.get(deployment.tokenAddress) ?? 0n,
      })),
    ],
    complete: true,
  };
}

function decimalToAtomic(value: string, decimals: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = (match[3] ?? '').padEnd(decimals, '0').slice(0, decimals);
  return sign * (BigInt(match[2]!) * (10n ** BigInt(decimals)) + BigInt(fraction || '0'));
}

async function scanXrp(
  network: WalletNetworkView,
  config: NativeAssetConfig,
  deployments: StablecoinDeployment[],
): Promise<NetworkScan> {
  const url = endpoint(config);
  const [accountResult, linesResult] = await Promise.allSettled([
    jsonRpc(url, 'account_info', [{ account: network.address, ledger_index: 'validated' }]),
    jsonRpc(url, 'account_lines', [{ account: network.address, ledger_index: 'validated' }]),
  ]);
  const accountNotFound = [accountResult, linesResult].every((result) => (
    result.status === 'rejected'
    && result.reason instanceof Error
    && result.reason.message.includes('actNotFound')
  ));
  if (accountNotFound) {
    return {
      balances: [
        { network, config, balance: 0n },
        ...deployments.map((deployment) => ({ network, config, deployment, balance: 0n })),
      ],
      complete: true,
    };
  }
  const nativeBalance = accountResult.status === 'fulfilled'
    ? BigInt((accountResult.value as { account_data?: { Balance?: string } }).account_data?.Balance ?? 0)
    : 0n;
  const balances: ScannedBalance[] = [{ network, config, balance: nativeBalance }];
  if (linesResult.status === 'rejected') {
    return { balances, complete: accountResult.status === 'fulfilled' };
  }
  const lines = (linesResult.value as { lines?: Array<{ account?: string; currency?: string; balance?: string }> }).lines ?? [];
  for (const deployment of deployments) {
    const line = lines.find((candidate) => (
      candidate.account === deployment.issuerAddress
      && (candidate.currency === deployment.currencyCode || candidate.currency === deployment.symbol)
    ));
    balances.push({
      network,
      config,
      deployment,
      balance: decimalToAtomic(line?.balance ?? '0', deployment.decimals),
    });
  }
  return { balances, complete: accountResult.status === 'fulfilled' };
}

async function scanNetwork(
  network: WalletNetworkView,
  deployments: StablecoinDeployment[],
): Promise<NetworkScan> {
  const config = nativeAssets[network.chainId];
  if (!config || !network.address || network.addressStatus !== 'ready') return { balances: [], complete: true };
  if (config.evmChainId) return scanEvm(network, config, deployments);
  if (network.chainId === 'solana') return scanSolana(network, config, deployments);
  if (network.chainId === 'bitcoin') return scanBitcoin(network, config);
  if (network.chainId === 'tron') return scanTron(network, config, deployments);
  if (network.chainId === 'xrp') return scanXrp(network, config, deployments);
  return { balances: [], complete: true };
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
      provider: price.providerKrw || 'market-reference',
      asOf: price.sourceUpdatedAtKrw || new Date().toISOString(),
    }] as const];
  }));
}

export function supportedReceiveAssets(
  networks: WalletNetworkView[],
  enabledStablecoins: readonly string[],
): WalletReceiveAssetView[] {
  const deployments = stablecoinsForPolicy(networks.map(({ chainId }) => chainId), enabledStablecoins);
  return networks.flatMap((network) => {
    if (network.addressStatus !== 'ready' || !nativeAssets[network.chainId]) return [];
    const config = nativeAssets[network.chainId]!;
    const native: WalletReceiveAssetView = {
      assetId: `${network.chainId}:native`,
      iconAssetId: iconAssetId(config.symbol),
      chainId: network.chainId,
      addressGroupId: network.addressGroupId,
      symbol: config.symbol,
      name: config.name,
      network: network.network,
      decimals: config.decimals,
      canonical: true,
      balanceStatus: 'sandbox',
      balanceAtomic: '0',
      balanceDisplay: '0',
      availableAtomic: '0',
      transferStatus: config.evmChainId ? 'enabled' : 'unavailable',
      phoneTransferStatus: supportsPhoneEscrow(network.chainId) ? 'enabled' : 'unavailable',
      ...(phoneEscrowUnavailableReason(network.chainId) ? { phoneTransferUnavailableReason: phoneEscrowUnavailableReason(network.chainId) } : {}),
      ...(!config.evmChainId ? { transferUnavailableReason: '이 네트워크의 보내기 서명 연동을 준비하고 있어요.' } : {}),
    };
    return [native, ...deployments.filter(({ chainId }) => chainId === network.chainId).map((deployment) => {
      const canTransfer = deployment.transport === 'evm-erc20'
        || deployment.transport === 'solana-spl'
        || deployment.transport === 'tron-trc20'
        || deployment.transport === 'xrpl-issued';
      return {
        assetId: deployment.assetId,
        iconAssetId: iconAssetId(deployment.symbol),
        chainId: deployment.chainId,
        addressGroupId: network.addressGroupId,
        symbol: deployment.symbol,
        name: deployment.name,
        network: network.network,
        decimals: deployment.decimals,
        tokenAddress: deployment.tokenAddress,
        canonical: deployment.canonical,
        balanceStatus: 'sandbox' as const,
        balanceAtomic: '0',
        balanceDisplay: '0',
        availableAtomic: '0',
        transferStatus: canTransfer ? 'enabled' as const : 'unavailable' as const,
        phoneTransferStatus: supportsPhoneEscrow(network.chainId) && deployment.transport === 'evm-erc20' ? 'enabled' as const : 'unavailable' as const,
        ...(!(supportsPhoneEscrow(network.chainId) && deployment.transport === 'evm-erc20') ? {
          phoneTransferUnavailableReason: deployment.transport === 'evm-erc20'
            ? phoneEscrowUnavailableReason(network.chainId)
            : '이 네트워크에서는 아직 휴대폰 번호로 보낼 수 없어요.',
        } : {}),
        ...(!canTransfer ? { transferUnavailableReason: '이 네트워크의 보내기 서명 연동을 준비하고 있어요.' } : {}),
      };
    })];
  });
}

export async function queryWalletPortfolio(
  networks: WalletNetworkView[],
  enabledStablecoins: readonly string[],
): Promise<WalletPortfolioResult> {
  const asOf = new Date().toISOString();
  const deployments = stablecoinsForPolicy(networks.map(({ chainId }) => chainId), enabledStablecoins);
  const receiveAssets = supportedReceiveAssets(networks, enabledStablecoins);
  const settled = await Promise.allSettled(networks.map((network) => (
    scanNetwork(network, deployments.filter(({ chainId }) => chainId === network.chainId))
  )));
  const scans = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const holdings = scans.flatMap(({ balances }) => balances.filter(({ balance }) => balance > 0n));
  const balanceQueriesComplete = settled.every((result) => result.status === 'fulfilled' && result.value.complete);
  const prices = await priceSnapshots(receiveAssets.map(({ symbol }) => symbol))
    .catch(() => new Map<string, PriceSnapshot>());
  const assets = holdings.map(({ network, config, deployment, balance }): WalletAssetView => {
    const decimals = deployment?.decimals ?? config.decimals;
    const symbol = deployment?.symbol ?? config.symbol;
    const displayBalance = formatUnits(balance, decimals);
    const price = prices.get(symbol);
    const numericBalance = Number(displayBalance.replaceAll(',', ''));
    const canTransfer = deployment
      ? deployment.transport === 'evm-erc20'
        || deployment.transport === 'solana-spl'
        || deployment.transport === 'tron-trc20'
        || deployment.transport === 'xrpl-issued'
      : Boolean(config.evmChainId);
    return {
      assetId: deployment?.assetId ?? `${network.chainId}:native`,
      iconAssetId: iconAssetId(symbol),
      chainId: network.chainId,
      addressGroupId: network.addressGroupId,
      symbol,
      name: deployment?.name ?? config.name,
      network: network.network,
      decimals,
      availableAtomic: balance.toString(),
      ...(deployment ? { tokenAddress: deployment.tokenAddress } : {}),
      transferStatus: canTransfer ? 'enabled' : 'unavailable',
      ...(!canTransfer ? { transferUnavailableReason: '이 네트워크의 보내기 서명 연동을 준비하고 있어요.' } : {}),
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
  const completeChains = new Set(settled.flatMap((result, index) => (
    result.status === 'fulfilled' && result.value.complete ? [networks[index]!.chainId] : []
  )));
  const scannedBalances = new Map(scans.flatMap(({ balances }) => balances.map(({ network, deployment, balance }) => (
    [deployment?.assetId ?? `${network.chainId}:native`, balance] as const
  ))));
  const catalog = receiveAssets.map((asset): WalletReceiveAssetView => {
    const balance = completeChains.has(asset.chainId) ? scannedBalances.get(asset.assetId) : undefined;
    const price = prices.get(asset.symbol);
    return {
      ...asset,
      balanceStatus: balance === undefined ? 'unavailable' : 'ready',
      balanceAtomic: balance?.toString() ?? '0',
      balanceDisplay: balance === undefined ? '-' : formatUnits(balance, asset.decimals),
      availableAtomic: balance?.toString() ?? '0',
      ...(price ? {
        referencePrice: {
          currency: 'KRW' as const,
          decimal: String(price.krw),
          display: formatKrw(price.krw),
          asOf: price.asOf,
          stale: Date.now() - Date.parse(price.asOf) > 5 * 60_000,
        },
      } : {}),
    };
  });
  return {
    assets,
    receiveAssets: catalog,
    ...(balanceQueriesComplete && allPriced ? {
      totalFiat: { currency: 'KRW' as const, display: formatKrw(total), asOf, stale: assets.some((asset) => asset.fiat?.stale) },
    } : {}),
    valuation: {
      currency: 'KRW',
      provider: providers.length === 1 ? providers[0]! : providers.length > 1 ? 'hybrid' : 'unavailable',
      status: balanceQueriesComplete && assets.length > 0 && allPriced && prices.size > 0 ? 'live' : 'unavailable',
      asOf,
    },
  };
}
