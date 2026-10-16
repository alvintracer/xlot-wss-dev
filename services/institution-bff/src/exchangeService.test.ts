import { describe, expect, it, vi } from 'vitest';
import type { DexQuoteProvider } from '@took-wss/provider-adapters';
import type { ReadyWalletHomePayload, WssSessionClaims } from '@took-wss/contracts';
import { createZeroXExchangeProvider, requestExchangeQuote } from './exchangeService';

const session: Omit<WssSessionClaims, 'nonce'> = {
  protocolVersion: 1,
  sessionId: 'session-exchange-test',
  tenantId: 'kiwoom',
  subject: 'subject-hash',
  subjectVersion: 1,
  keyAdapter: 'took-sar',
  issuedAt: 1,
  expiresAt: 9_999_999_999,
};

const home: ReadyWalletHomePayload = {
  status: 'ready',
  wallet: { walletId: '11111111-1111-4111-8111-111111111111', label: '내 지갑', keyAdapter: 'took-sar', origin: 'created' },
  wallets: [{ walletId: '11111111-1111-4111-8111-111111111111', label: '내 지갑', keyAdapter: 'took-sar', origin: 'created' }],
  assets: [],
  receiveAssets: [
    {
      assetId: 'base:native', iconAssetId: 'coin:eth', chainId: 'base', addressGroupId: 'evm', symbol: 'ETH', name: '이더리움', network: 'Base', decimals: 18,
      canonical: true, balanceStatus: 'ready', balanceAtomic: '1000000000000000000', balanceDisplay: '1', availableAtomic: '1000000000000000000', transferStatus: 'enabled',
      referencePrice: { currency: 'KRW', decimal: '4000000', display: '4,000,000원', asOf: '2026-09-29T00:00:00.000Z', stale: false },
    },
    {
      assetId: 'base:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', iconAssetId: 'coin:usdc', chainId: 'base', addressGroupId: 'evm', symbol: 'USDC', name: 'USD Coin', network: 'Base', decimals: 6,
      tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', canonical: true, balanceStatus: 'ready', balanceAtomic: '0', balanceDisplay: '0', availableAtomic: '0', transferStatus: 'enabled',
      referencePrice: { currency: 'KRW', decimal: '1350', display: '1,350원', asOf: '2026-09-29T00:00:00.000Z', stale: false },
    },
  ],
  networks: [{ chainId: 'base', addressGroupId: 'evm', network: 'Base', nativeSymbol: 'ETH', status: 'registered', addressStatus: 'ready', address: '0x0000000000000000000000000000000000000001' }],
  valuation: { currency: 'KRW', provider: 'bonanza', status: 'live', asOf: '2026-09-29T00:00:00.000Z' },
  recovery: { profile: 'sar-2-of-3', status: 'ready', policyVersion: 1 },
  source: 'wallet-query',
};

describe('0x exchange provider', () => {
  it('does not prepare an unverified swap simulation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      liquidityAvailable: true,
      issues: { simulationIncomplete: true },
      transaction: { to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0', gas: '180000' },
    }), { status: 200 }));
    const provider = createZeroXExchangeProvider({ apiKey: 'server-secret', fetcher });
    await expect(provider.getFirmQuote({
      chainId: 8453,
      taker: '0x70a9f34f9b34c64957b9c401a97bfed35b95049e',
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      buyToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      mode: 'exact-in', amountAtomic: '1000000000000000',
    })).rejects.toThrow('exchange_simulation_unavailable');
  });

  it('uses buyAmount alone for exact-out and keeps the API key server-side', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, _init) => new Response(JSON.stringify({
      zid: 'provider-quote',
      liquidityAvailable: true,
      sellAmount: '1300000000000000',
      buyAmount: '4000000',
      maxSellAmount: '1320000000000000',
      totalNetworkFee: '10000000000000',
      transaction: {
        to: '0x0000000000000000000000000000000000000002',
        data: '0x1234',
        value: '1320000000000000',
        gas: '180000',
        gasPrice: '1000000000',
      },
      issues: {},
    }), { status: 200 }));
    const provider = createZeroXExchangeProvider({ apiKey: 'server-secret', baseUrl: 'https://api.example.test', fetcher });
    const quote = await provider.getFirmQuote({
      chainId: 8453,
      taker: '0x0000000000000000000000000000000000000001',
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      buyToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      mode: 'exact-out',
      amountAtomic: '4000000',
    });
    const [url, init] = fetcher.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.searchParams.get('buyAmount')).toBe('4000000');
    expect(requestUrl.searchParams.has('sellAmount')).toBe(false);
    expect((init?.headers as Record<string, string>)['0x-api-key']).toBe('server-secret');
    expect(quote.maximumSellAmountAtomic).toBe('1320000000000000');
  });

  it('maps a provider quote to a wallet-bound exact-in quote without inventing a price', async () => {
    const provider: DexQuoteProvider = {
      id: 'test-dex',
      async getFirmQuote() {
        return {
          providerQuoteId: 'provider-quote',
          sellAmountAtomic: '100000000000000000',
          buyAmountAtomic: '300000000',
          minimumBuyAmountAtomic: '297000000',
          allowanceRequired: false,
          liquidityAvailable: true,
          networkFeeAtomic: '10000000000000',
          transaction: {
            to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '100000000000000000', gas: '180000', gasPrice: '1000000000',
          },
        };
      },
    };
    const quote = await requestExchangeQuote({
      session,
      home,
      provider,
      request: {
        walletId: home.wallet.walletId,
        chainId: 'base',
        sellAssetId: 'base:native',
        buyAssetId: 'base:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        mode: 'exact-in',
        amountAtomic: '100000000000000000',
      },
    });
    expect(quote.sell.amountDisplay).toBe('0.1');
    expect(quote.buy.amountDisplay).toBe('300');
    expect(quote.minimumBuyAmountAtomic).toBe('297000000');
    expect(quote.balanceSufficient).toBe(true);
    expect(quote.rateDisplay).toContain('USDC');
  });
});
