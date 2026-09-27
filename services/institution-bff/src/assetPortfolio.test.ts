import { describe, expect, it } from 'vitest';
import type { WalletNetworkView } from '@took-wss/contracts';
import { supportedReceiveAssets } from './assetPortfolio';

const networks: WalletNetworkView[] = [
  {
    chainId: 'ethereum',
    addressGroupId: 'evm',
    network: 'Ethereum',
    nativeSymbol: 'ETH',
    status: 'registered',
    addressStatus: 'ready',
    address: '0x0000000000000000000000000000000000000001',
  },
  {
    chainId: 'xrp',
    addressGroupId: 'xrp',
    network: 'XRP Ledger',
    nativeSymbol: 'XRP',
    status: 'registered',
    addressStatus: 'ready',
    address: 'rEXAMPLE',
  },
  {
    chainId: 'solana',
    addressGroupId: 'solana',
    network: 'Solana',
    nativeSymbol: 'SOL',
    status: 'registered',
    addressStatus: 'pending-core',
  },
];

describe('supported receive assets', () => {
  it('includes native assets and policy-enabled stablecoins for ready networks', () => {
    const assets = supportedReceiveAssets(networks, ['USDC', 'RLUSD']);

    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'ethereum:native', symbol: 'ETH', canonical: true }),
      expect.objectContaining({ chainId: 'ethereum', symbol: 'USDC', tokenAddress: expect.any(String) }),
      expect.objectContaining({ chainId: 'ethereum', symbol: 'RLUSD', tokenAddress: expect.any(String) }),
      expect.objectContaining({ chainId: 'xrp', symbol: 'RLUSD', tokenAddress: expect.any(String) }),
      expect.objectContaining({ assetId: 'xrp:native', symbol: 'XRP' }),
    ]));
    expect(assets.some(({ chainId }) => chainId === 'solana')).toBe(false);
    expect(assets.some(({ symbol }) => symbol === 'USDT')).toBe(false);
  });
});
