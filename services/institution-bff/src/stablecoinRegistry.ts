export type StablecoinTransport = 'evm-erc20' | 'solana-spl' | 'tron-trc20' | 'xrpl-issued';

export interface StablecoinDeployment {
  assetId: string;
  chainId: string;
  symbol: string;
  name: string;
  decimals: number;
  transport: StablecoinTransport;
  tokenAddress: string;
  canonical: boolean;
  issuerAddress?: string;
  currencyCode?: string;
}

function deployment(input: Omit<StablecoinDeployment, 'assetId'>): StablecoinDeployment {
  const identifier = input.transport === 'xrpl-issued'
    ? `${input.issuerAddress}:${input.currencyCode}`
    : input.tokenAddress.toLowerCase();
  return { ...input, assetId: `${input.chainId}:${input.transport}:${identifier}` };
}

/**
 * Curated mainnet inventory. Issuer-native deployments are preferred. Widely
 * used bridge or exchange-wrapped deployments are explicitly named and marked
 * non-canonical so tenant policy and customer copy never confuse them with an
 * issuer-native token.
 *
 * Primary address authorities:
 * - Circle: https://developers.circle.com/stablecoins/usdc-contract-addresses
 * - Ripple: https://docs.ripple.com/products/stablecoin/overview/token-addresses
 * - Paxos: https://docs.paxos.com/guides/stablecoin
 * - JPYC: https://github.com/jpycoin
 * - First Digital: https://www.firstdigitallabs.com/fdusd
 * - Tether: https://tether.to/en/supported-protocols/
 * - StraitsX: https://www.straitsx.com/xsgd and https://www.straitsx.com/xusd
 */
export const stablecoinDeployments: readonly StablecoinDeployment[] = [
  deployment({ chainId: 'ethereum', symbol: 'USDC', name: 'USD Coin', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', canonical: true }),
  deployment({ chainId: 'polygon', symbol: 'USDC', name: 'USD Coin', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', canonical: true }),
  deployment({ chainId: 'arbitrum', symbol: 'USDC', name: 'USD Coin', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', canonical: true }),
  deployment({ chainId: 'base', symbol: 'USDC', name: 'USD Coin', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', canonical: true }),
  deployment({ chainId: 'bnb', symbol: 'USDC', name: 'Binance-Peg USD Coin', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', canonical: false }),
  deployment({ chainId: 'solana', symbol: 'USDC', name: 'USD Coin', decimals: 6, transport: 'solana-spl', tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', canonical: true }),
  deployment({ chainId: 'xrp', symbol: 'USDC', name: 'USD Coin', decimals: 6, transport: 'xrpl-issued', tokenAddress: 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE', issuerAddress: 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE', currencyCode: '5553444300000000000000000000000000000000', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'USDT', name: 'Tether USD', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', canonical: true }),
  deployment({ chainId: 'polygon', symbol: 'USDT', name: 'Tether USD (브리지)', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', canonical: false }),
  deployment({ chainId: 'arbitrum', symbol: 'USDT', name: 'Tether USD (브리지)', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', canonical: false }),
  deployment({ chainId: 'bnb', symbol: 'USDT', name: 'Binance-Peg Tether USD', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x55d398326f99059ff775485246999027b3197955', canonical: false }),
  deployment({ chainId: 'solana', symbol: 'USDT', name: 'Tether USD', decimals: 6, transport: 'solana-spl', tokenAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', canonical: true }),
  deployment({ chainId: 'tron', symbol: 'USDT', name: 'Tether USD', decimals: 6, transport: 'tron-trc20', tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'RLUSD', name: 'Ripple USD', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x8292bb45bf1ee4d140127049757c2e0ff06317ed', canonical: true }),
  deployment({ chainId: 'base', symbol: 'RLUSD', name: 'Ripple USD', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x8d58c0c60b8d6b88fa98b291a646db34d0f98258', canonical: true }),
  deployment({ chainId: 'xrp', symbol: 'RLUSD', name: 'Ripple USD', decimals: 6, transport: 'xrpl-issued', tokenAddress: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', issuerAddress: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', currencyCode: '524C555344000000000000000000000000000000', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'EURC', name: 'Euro Coin', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c', canonical: true }),
  deployment({ chainId: 'base', symbol: 'EURC', name: 'Euro Coin', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42', canonical: true }),
  deployment({ chainId: 'solana', symbol: 'EURC', name: 'Euro Coin', decimals: 6, transport: 'solana-spl', tokenAddress: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'JPYC', name: 'JPYC', decimals: 18, transport: 'evm-erc20', tokenAddress: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29', canonical: true }),
  deployment({ chainId: 'polygon', symbol: 'JPYC', name: 'JPYC', decimals: 18, transport: 'evm-erc20', tokenAddress: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'XSGD', name: 'StraitsX Singapore Dollar', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x70e8de73ce538da2beed35d14187f6959a8eca96', canonical: true }),
  deployment({ chainId: 'polygon', symbol: 'XSGD', name: 'StraitsX Singapore Dollar', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xdc3326e71d45186f113a2f448984ca0e8d201995', canonical: true }),
  deployment({ chainId: 'arbitrum', symbol: 'XSGD', name: 'StraitsX Singapore Dollar', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xe333e7754a2dc1e020a162ecab019254b9dab653', canonical: true }),
  deployment({ chainId: 'base', symbol: 'XSGD', name: 'StraitsX Singapore Dollar', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x0a4c9cb2778ab3302996a34befcf9a8bc288c33b', canonical: true }),
  deployment({ chainId: 'solana', symbol: 'XSGD', name: 'StraitsX Singapore Dollar', decimals: 6, transport: 'solana-spl', tokenAddress: '71S9cppWipeUEQDFngYwxjoxB6Sz1MUqX72byLsVYJqy', canonical: true }),
  deployment({ chainId: 'xrp', symbol: 'XSGD', name: 'StraitsX Singapore Dollar', decimals: 6, transport: 'xrpl-issued', tokenAddress: 'rK67JczCpaYXVtfw3qJVmqwpSfa1bYTptw', issuerAddress: 'rK67JczCpaYXVtfw3qJVmqwpSfa1bYTptw', currencyCode: '5853474400000000000000000000000000000000', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'XUSD', name: 'StraitsX USD', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xc08e7e23c235073c6807c2efe7021304cb7c2815', canonical: true }),
  deployment({ chainId: 'bnb', symbol: 'XUSD', name: 'StraitsX USD', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xf81ac2e1a0373dde1bce01e2fe694a9b7e3bfcb9', canonical: true }),
  deployment({ chainId: 'solana', symbol: 'XUSD', name: 'StraitsX USD', decimals: 6, transport: 'solana-spl', tokenAddress: '4UbvZiomFvXDnZSz6vdHiDNiHozH2ykTEqjhhbVHiv9z', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'PYUSD', name: 'PayPal USD', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x6c3ea9036406852006290770bedfcaba0e23a0e8', canonical: true }),
  deployment({ chainId: 'polygon', symbol: 'PYUSD', name: 'PayPal USD', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x99af3eea856556646c98c8b9b2548fe815240750', canonical: true }),
  deployment({ chainId: 'arbitrum', symbol: 'PYUSD', name: 'PayPal USD', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x46850ad61c2b7d64d08c9c754f45254596696984', canonical: true }),
  deployment({ chainId: 'solana', symbol: 'PYUSD', name: 'PayPal USD', decimals: 6, transport: 'solana-spl', tokenAddress: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'USDG', name: 'Global Dollar', decimals: 6, transport: 'evm-erc20', tokenAddress: '0xe343167631d89b6ffc58b88d6b7fb0228795491d', canonical: true }),
  deployment({ chainId: 'arbitrum', symbol: 'USDG', name: 'Global Dollar', decimals: 6, transport: 'evm-erc20', tokenAddress: '0x004b506865409877c9fa29bfb1eba929984b9bbc', canonical: true }),
  deployment({ chainId: 'solana', symbol: 'USDG', name: 'Global Dollar', decimals: 6, transport: 'solana-spl', tokenAddress: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x6b175474e89094c44da98b954eedeac495271d0f', canonical: true }),
  deployment({ chainId: 'ethereum', symbol: 'USDS', name: 'USDS', decimals: 18, transport: 'evm-erc20', tokenAddress: '0xdc035d45d973e3ec169d2276ddab16f1e407384f', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'FDUSD', name: 'First Digital USD', decimals: 18, transport: 'evm-erc20', tokenAddress: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', canonical: true }),
  deployment({ chainId: 'arbitrum', symbol: 'FDUSD', name: 'First Digital USD', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x93c9932e4afa59201f0b5e63f7d816516f1669fe', canonical: true }),
  deployment({ chainId: 'bnb', symbol: 'FDUSD', name: 'First Digital USD', decimals: 18, transport: 'evm-erc20', tokenAddress: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', canonical: true }),
  deployment({ chainId: 'solana', symbol: 'FDUSD', name: 'First Digital USD', decimals: 6, transport: 'solana-spl', tokenAddress: '9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u', canonical: true }),

  deployment({ chainId: 'ethereum', symbol: 'USDP', name: 'Pax Dollar', decimals: 18, transport: 'evm-erc20', tokenAddress: '0x8e870d67f660d95d5be530380d0ec0bd388289e1', canonical: true }),
  deployment({ chainId: 'ethereum', symbol: 'GUSD', name: 'Gemini Dollar', decimals: 2, transport: 'evm-erc20', tokenAddress: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd', canonical: true }),
] as const;

const deploymentByAssetId = new Map(stablecoinDeployments.map((item) => [item.assetId, item]));

export function stablecoinByAssetId(assetId: string): StablecoinDeployment | undefined {
  return deploymentByAssetId.get(assetId);
}

export function stablecoinsForPolicy(chainIds: readonly string[], symbols: readonly string[]): StablecoinDeployment[] {
  const chains = new Set(chainIds);
  const enabled = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  return stablecoinDeployments.filter((item) => chains.has(item.chainId) && enabled.has(item.symbol));
}
