import { describe, expect, it } from 'vitest';
import { stablecoinByAssetId, stablecoinDeployments, stablecoinsForPolicy } from './stablecoinRegistry';

describe('stablecoin registry', () => {
  it('keeps chain-specific identifiers unique and resolves every deployment', () => {
    expect(new Set(stablecoinDeployments.map(({ assetId }) => assetId)).size).toBe(stablecoinDeployments.length);
    expect(stablecoinDeployments.every(({ assetId }) => stablecoinByAssetId(assetId))).toBe(true);
  });

  it('covers the priority stablecoins across issuer-supported networks', () => {
    const symbols = new Set(stablecoinDeployments.map(({ symbol }) => symbol));
    expect([...symbols]).toEqual(expect.arrayContaining([
      'USDC', 'USDT', 'RLUSD', 'EURC', 'JPYC', 'PYUSD', 'USDG', 'DAI', 'USDS', 'FDUSD', 'USDP', 'GUSD', 'XUSD', 'XSGD',
    ]));
    expect(stablecoinDeployments).toEqual(expect.arrayContaining([
      expect.objectContaining({ chainId: 'xrp', symbol: 'RLUSD', transport: 'xrpl-issued' }),
      expect.objectContaining({ chainId: 'tron', symbol: 'USDT', transport: 'tron-trc20' }),
      expect.objectContaining({ chainId: 'solana', symbol: 'USDC', transport: 'solana-spl' }),
      expect.objectContaining({ chainId: 'xrp', symbol: 'USDC', transport: 'xrpl-issued' }),
      expect.objectContaining({ chainId: 'solana', symbol: 'XUSD', transport: 'solana-spl' }),
      expect.objectContaining({ chainId: 'xrp', symbol: 'XSGD', transport: 'xrpl-issued' }),
    ]));
  });

  it('applies tenant chain and symbol policy without symbol-only asset IDs', () => {
    const result = stablecoinsForPolicy(['ethereum', 'base'], ['USDC', 'RLUSD']);
    expect(result).toHaveLength(4);
    expect(result.every(({ assetId }) => assetId.includes(':'))).toBe(true);
    expect(result.map(({ chainId, symbol }) => `${chainId}:${symbol}`)).toEqual([
      'ethereum:USDC', 'base:USDC', 'ethereum:RLUSD', 'base:RLUSD',
    ]);
  });
});
