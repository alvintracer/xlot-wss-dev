import type { ReadyWalletHomePayload, WalletProfileSummary } from '@took-wss/contracts';

/** Lives only as long as the current wallet WebView session. */
export class WalletHomeCache {
  private readonly homes = new Map<string, ReadyWalletHomePayload>();
  private readonly pending = new Map<string, Promise<ReadyWalletHomePayload>>();
  private readonly revisions = new Map<string, number>();

  seed(home: ReadyWalletHomePayload): void {
    this.homes.set(home.wallet.walletId, home);
  }

  invalidate(walletIds: readonly string[]): void {
    for (const walletId of walletIds) {
      this.homes.delete(walletId);
      this.pending.delete(walletId);
      this.revisions.set(walletId, (this.revisions.get(walletId) ?? 0) + 1);
    }
  }

  rename(wallet: WalletProfileSummary): void {
    for (const [walletId, home] of this.homes) {
      this.homes.set(walletId, {
        ...home,
        wallet: home.wallet.walletId === wallet.walletId ? wallet : home.wallet,
        wallets: home.wallets.map((item) => item.walletId === wallet.walletId ? wallet : item),
      });
    }
  }

  async load(walletId: string, fetchHome: () => Promise<ReadyWalletHomePayload>, refresh = false): Promise<ReadyWalletHomePayload> {
    if (refresh) this.invalidate([walletId]);
    const cached = this.homes.get(walletId);
    if (cached) return cached;
    const existing = this.pending.get(walletId);
    if (existing) return existing;
    const revision = this.revisions.get(walletId) ?? 0;
    const request = fetchHome().then((home) => {
      if (home.wallet.walletId !== walletId) throw new Error('Selected wallet does not match the request.');
      if ((this.revisions.get(walletId) ?? 0) === revision) this.homes.set(walletId, home);
      return home;
    }).finally(() => {
      if (this.pending.get(walletId) === request) this.pending.delete(walletId);
    });
    this.pending.set(walletId, request);
    return request;
  }
}
