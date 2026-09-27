import { describe, expect, it } from 'vitest';
import { quoteGasSponsorship } from './gasSponsorship';

describe('gas sponsorship policy', () => {
  it('does not claim sponsorship for a native-coin transfer', async () => {
    const quote = await quoteGasSponsorship({
      asset: {
        assetId: 'ethereum:native',
        chainId: 'ethereum',
        symbol: 'ETH',
        name: '이더리움',
        network: 'Ethereum',
        decimals: 18,
        balanceAtomic: '1000000000000000000',
        availableAtomic: '1000000000000000000',
        balanceDisplay: '1',
      },
      network: {
        chainId: 'ethereum',
        addressGroupId: 'evm',
        network: 'Ethereum',
        nativeSymbol: 'ETH',
        status: 'registered',
        addressStatus: 'ready',
        address: '0x0000000000000000000000000000000000000001',
      },
      amountDisplay: '0.1',
    });

    expect(quote.status).toBe('not-eligible');
    expect(quote.message).toContain('네트워크 수수료');
  });
});
