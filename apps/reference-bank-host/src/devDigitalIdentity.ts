import { ed25519DidKey, type DigitalIdentityHostRequest, type DigitalIdentityHostResult, type DigitalIdentitySummary } from '@took-wss/contracts';

interface VaultEntry {
  scope: string;
  holderKey: CryptoKeyPair;
  holderDid: string;
  credential?: string;
  credentialId?: string;
  opening?: string;
}

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('took-wss-development-identity-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('identities', { keyPath: 'scope' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('identity_vault_unavailable'));
  });
}

function usesCurrentProofScheme(credential: string): boolean {
  try {
    const payload = JSON.parse(atob(credential.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      vc?: { credentialSubject?: { identityProofScheme?: string } };
    };
    return payload.vc?.credentialSubject?.identityProofScheme === 'noir-ultrahonk-v1';
  } catch { return false; }
}

async function readVault(scope: string): Promise<VaultEntry | null> {
  const database = await openVault();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('identities', 'readonly').objectStore('identities').get(scope);
      request.onsuccess = () => resolve((request.result as VaultEntry | undefined) ?? null);
      request.onerror = () => reject(new Error('identity_vault_unavailable'));
    });
  } finally { database.close(); }
}

async function writeVault(entry: VaultEntry): Promise<void> {
  const database = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('identities', 'readwrite');
      transaction.objectStore('identities').put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('identity_vault_unavailable'));
      transaction.onabort = () => reject(new Error('identity_vault_unavailable'));
    });
  } finally { database.close(); }
}

async function holder(scope: string): Promise<VaultEntry> {
  const existing = await readVault(scope);
  if (existing) return existing;
  const holderKey = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', holderKey.publicKey));
  const entry = { scope, holderKey, holderDid: ed25519DidKey(publicKey) };
  await writeVault(entry);
  return entry;
}

async function holderSign(entry: VaultEntry, message: string): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', entry.holderKey.privateKey, new TextEncoder().encode(message)));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function api<T>(bffUrl: string, token: string, path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${bffUrl}${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || 'identity_service_unavailable');
  }
  return await response.json() as T;
}

export async function handleDevDigitalIdentity(input: {
  request: DigitalIdentityHostRequest;
  tenantId: string;
  customerRef: string;
  sessionToken: string;
  bffUrl: string;
  signWallet: (request: { walletId: string; address: string; message: string }) => Promise<string>;
}): Promise<DigitalIdentityHostResult> {
  const { request, tenantId, customerRef, sessionToken, bffUrl, signWallet } = input;
  const base: DigitalIdentityHostResult = { type: 'took-wss:digital-identity-result', protocolVersion: 1, requestId: request.requestId, ok: false };
  if (!(import.meta.env.DEV || import.meta.env.VITE_WSS_PUBLIC_PREVIEW === 'true') || tenantId !== 'shinhan') {
    return { ...base, error: 'identity_unavailable' };
  }
  try {
    const scope = `${tenantId}:${customerRef}`;
    if (request.action === 'status') {
      const entry = await readVault(scope);
      if (!entry?.credentialId || !entry.credential) return { ...base, ok: true, summary: null };
      if (!usesCurrentProofScheme(entry.credential)) {
        await writeVault({ scope, holderKey: entry.holderKey, holderDid: entry.holderDid });
        return { ...base, ok: true, summary: null };
      }
      let summary: DigitalIdentitySummary;
      try {
        summary = await api<DigitalIdentitySummary>(bffUrl, sessionToken,
          `/v1/digital-identity/credentials/${entry.credentialId}`, 'GET');
      } catch (error) {
        if (error instanceof Error && error.message === 'credential_not_active') {
          await writeVault({ scope, holderKey: entry.holderKey, holderDid: entry.holderDid });
          return { ...base, ok: true, summary: null };
        }
        throw error;
      }
      return { ...base, ok: true, summary };
    }
    const entry = await holder(scope);
    if (request.action === 'issue') {
      if (entry.credentialId && entry.credential) throw new Error('credential_already_issued');
      const issued = await api<{ credential: string; opening: string; summary: DigitalIdentitySummary }>(bffUrl, sessionToken,
        '/v1/digital-identity/credentials', 'POST', { holderDid: entry.holderDid, accepted: true });
      await writeVault({ ...entry, credential: issued.credential, credentialId: issued.summary.credentialId, opening: issued.opening });
      return { ...base, ok: true, summary: issued.summary };
    }
    if (!entry.credentialId || !entry.credential) throw new Error('credential_not_found');
    const path = `/v1/digital-identity/credentials/${entry.credentialId}`;
    if (request.action === 'bind-wallet') {
      if (!request.walletId || !/^[0-9a-f-]{36}$/i.test(request.walletId)) throw new Error('wallet_not_eligible');
      const challenge = await api<{ challengeId: string; message: string; address: string }>(bffUrl, sessionToken,
        `${path}/wallet-challenges`, 'POST', { walletId: request.walletId });
      const walletSignature = await signWallet({ walletId: request.walletId, address: challenge.address, message: challenge.message });
      const holderSignature = await holderSign(entry, challenge.message);
      const summary = await api<DigitalIdentitySummary>(bffUrl, sessionToken, `${path}/wallet-bindings`, 'POST',
        { challengeId: challenge.challengeId, walletSignature, holderSignature });
      return { ...base, ok: true, summary };
    }
    if (request.action === 'verify') {
      if (!entry.opening) throw new Error('identity_opening_unavailable');
      const challenge = await api<{ challengeId: string; message: string }>(bffUrl, sessionToken,
        `${path}/presentation-challenges`, 'POST');
      const holderSignature = await holderSign(entry, challenge.message);
      const summary = await api<DigitalIdentitySummary>(bffUrl, sessionToken, path, 'GET');
      const payload = JSON.parse(atob(entry.credential.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
        vc?: { credentialSubject?: { identityCommitment?: string } };
      };
      const commitment = payload.vc?.credentialSubject?.identityCommitment;
      if (!commitment) throw new Error('credential_invalid');
      const { createIdentityEqualityProof } = await import('@took-wss/identity-proof/browser');
      const proof = await createIdentityEqualityProof({ credentialId: entry.credentialId,
        nonce: challenge.challengeId, commitment, opening: entry.opening,
        expectedName: summary.name, expectedBirthDate: summary.birthDate });
      const verified = await api<{ verified: boolean }>(bffUrl, sessionToken, `${path}/presentations`, 'POST',
        { challengeId: challenge.challengeId, credential: entry.credential, holderSignature,
          expectedName: summary.name, expectedBirthDate: summary.birthDate, proof });
      return { ...base, ok: true, verified: verified.verified };
    }
    throw new Error('identity_action_invalid');
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : 'identity_service_unavailable' };
  }
}
