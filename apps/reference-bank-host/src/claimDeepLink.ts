const claimPattern = /^[A-Za-z0-9_-]{12}$/;
const lifetimeMs = 30 * 60 * 1000;

function key(tenantId: string): string { return `took-wss:${tenantId}:pending-claim`; }

export function readIncomingClaimCode(tenantId: string): string | null {
  const hashCode = new URLSearchParams(window.location.hash.slice(1)).get('claim');
  if (hashCode && claimPattern.test(hashCode)) {
    try { window.sessionStorage.setItem(key(tenantId), JSON.stringify({ code: hashCode, savedAt: Date.now() })); }
    catch { /* The current navigation still works without storage. */ }
    return hashCode;
  }
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key(tenantId)) || 'null') as { code?: unknown; savedAt?: unknown } | null;
    if (stored && typeof stored.code === 'string' && claimPattern.test(stored.code)
      && typeof stored.savedAt === 'number' && Date.now() - stored.savedAt < lifetimeMs) return stored.code;
  } catch { /* Storage may be unavailable. */ }
  return null;
}

export function clearIncomingClaimCode(tenantId: string): void {
  try { window.sessionStorage.removeItem(key(tenantId)); } catch { /* Ignore storage restrictions. */ }
  if (new URLSearchParams(window.location.hash.slice(1)).has('claim')) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }
}
