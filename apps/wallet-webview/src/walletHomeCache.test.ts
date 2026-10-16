import { describe, expect, it, vi } from 'vitest';
import type { ReadyWalletHomePayload } from '@took-wss/contracts';
import { WalletHomeCache } from './walletHomeCache';

function home(walletId: string, label = walletId): ReadyWalletHomePayload {
  return { status: 'ready', wallet: { walletId, label, keyAdapter: 'took-sar', origin: 'created' },
    wallets: [{ walletId, label, keyAdapter: 'took-sar', origin: 'created' }],
    assets: [], receiveAssets: [], networks: [],
    valuation: { status: 'unavailable', asOf: new Date(0).toISOString() },
    recovery: { profile: 'sar-2-of-3' }, source: 'wallet-query' } as unknown as ReadyWalletHomePayload;
}

describe('WalletHomeCache', () => {
  it('reuses a loaded slot, but fetches again after explicit refresh', async () => {
    const cache = new WalletHomeCache();
    const fetchHome = vi.fn().mockResolvedValueOnce(home('a', '처음')).mockResolvedValueOnce(home('a', '새 잔액'));
    expect((await cache.load('a', fetchHome)).wallet.label).toBe('처음');
    expect((await cache.load('a', fetchHome)).wallet.label).toBe('처음');
    expect(fetchHome).toHaveBeenCalledTimes(1);
    expect((await cache.load('a', fetchHome, true)).wallet.label).toBe('새 잔액');
    expect(fetchHome).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a result that was invalidated during a pending lookup', async () => {
    const cache = new WalletHomeCache();
    let resolveOld!: (value: ReadyWalletHomePayload) => void;
    const oldRequest = cache.load('a', () => new Promise((resolve) => { resolveOld = resolve; }));
    cache.invalidate(['a']);
    const refreshed = await cache.load('a', async () => home('a', '최신'));
    resolveOld(home('a', '이전'));
    await oldRequest;
    expect((await cache.load('a', async () => { throw new Error('Unexpected request'); })).wallet.label).toBe(refreshed.wallet.label);
  });
});
