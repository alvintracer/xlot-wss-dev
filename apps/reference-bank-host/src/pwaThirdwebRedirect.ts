const pendingPrefix = 'took-wss:pwa-thirdweb-redirect:';

export interface PendingPwaThirdwebRedirect { clientId: string; startedAt: number }

function key(tenantId: string): string { return `${pendingPrefix}${tenantId}`; }

export function clearPendingPwaThirdwebRedirect(tenantId: string): void {
  try { window.localStorage.removeItem(key(tenantId)); } catch { /* no-op */ }
}

export function readPendingPwaThirdwebRedirect(tenantId: string): PendingPwaThirdwebRedirect | null {
  try {
    const raw = window.localStorage.getItem(key(tenantId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const pending = parsed as Partial<PendingPwaThirdwebRedirect>;
    if (typeof pending.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(pending.clientId)
      || typeof pending.startedAt !== 'number' || Date.now() - pending.startedAt > 10 * 60_000) {
      clearPendingPwaThirdwebRedirect(tenantId);
      return null;
    }
    return pending as PendingPwaThirdwebRedirect;
  } catch { return null; }
}

export function hasPwaThirdwebReturn(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('authResult') || params.has('authCookie');
}

export function hasPendingPwaWalletCreation(tenantId: string): boolean {
  try {
    const raw = window.localStorage.getItem(`took-wss:pwa-thirdweb-resume:${tenantId}`);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const resume = parsed as { tenantId?: unknown; startedAt?: unknown };
    return resume.tenantId === tenantId && typeof resume.startedAt === 'number'
      && Date.now() - resume.startedAt <= 10 * 60_000;
  } catch { return false; }
}

export function clearPendingPwaWalletCreation(tenantId: string): void {
  try { window.localStorage.removeItem(`took-wss:pwa-thirdweb-resume:${tenantId}`); }
  catch { /* Private browsing may block storage. */ }
}

export function clearPwaThirdwebReturnUrl(): void {
  const url = new URL(window.location.href);
  for (const key of ['authResult', 'authCookie', 'walletId', 'authProvider', 'authFlow', 'state']) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export async function startPwaThirdwebRedirect(input: {
  tenantId: string;
  clientId: string;
  strategy: 'google' | 'apple';
}): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(input.clientId)) throw new Error('thirdweb_not_configured');
  const [{ createThirdwebClient }, { inAppWallet }] = await Promise.all([
    import('thirdweb'), import('thirdweb/wallets'),
  ]);
  const client = createThirdwebClient({ clientId: input.clientId });
  const returnUrl = `${window.location.origin}${window.location.pathname}`;
  window.localStorage.setItem(key(input.tenantId), JSON.stringify({ clientId: input.clientId, startedAt: Date.now() }));
  const wallet = inAppWallet({
    auth: { mode: 'redirect', options: ['google', 'apple', 'email'], redirectUrl: returnUrl },
    hidePrivateKeyExport: true,
  });
  try { await wallet.connect({ client, strategy: input.strategy }); }
  catch (error) { clearPendingPwaThirdwebRedirect(input.tenantId); throw error; }
}
