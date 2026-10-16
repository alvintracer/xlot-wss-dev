export interface PwaWalletCreationResume {
  tenantId: string;
  mode: 'initial' | 'add';
  entryIntent: 'create' | 'import' | 'recover';
  walletLabel: string;
  startedAt: number;
}

function key(tenantId: string): string { return `took-wss:pwa-thirdweb-resume:${tenantId}`; }

export function savePwaWalletCreationResume(input: Omit<PwaWalletCreationResume, 'startedAt'>): void {
  try { window.localStorage.setItem(key(input.tenantId), JSON.stringify({ ...input, startedAt: Date.now() })); }
  catch { /* The login can still finish if storage is unavailable. */ }
}

export function clearPwaWalletCreationResume(tenantId: string): void {
  try { window.localStorage.removeItem(key(tenantId)); } catch { /* no-op */ }
}

export function readPwaWalletCreationResume(tenantId: string): PwaWalletCreationResume | null {
  try {
    const value = window.localStorage.getItem(key(tenantId));
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const resume = parsed as Partial<PwaWalletCreationResume>;
    if (resume.tenantId !== tenantId || (resume.mode !== 'initial' && resume.mode !== 'add')
      || resume.entryIntent !== 'create' || typeof resume.walletLabel !== 'string'
      || resume.walletLabel.length > 30 || typeof resume.startedAt !== 'number'
      || Date.now() - resume.startedAt > 10 * 60_000) {
      clearPwaWalletCreationResume(tenantId);
      return null;
    }
    return resume as PwaWalletCreationResume;
  } catch { return null; }
}
