import type { SarVaultShares } from '@took-wss/sar-key-core';

const iterations = 600_000;
const encoder = new TextEncoder();

export interface EncryptedSarVaultShare {
  version: 1;
  factorIndex: 1 | 2 | 3;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  aad: string;
}

function buffer(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 8) throw new Error('vault_password_too_short');
  const material = await crypto.subtle.importKey('raw', buffer(encoder.encode(password.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buffer(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aad(tenantId: string, walletId: string, factorIndex: number): string {
  return `took-wss:sar-vault-v1:${tenantId}:${walletId}:factor-${factorIndex}`;
}

export async function encryptSarVaultShares(
  tenantId: string,
  walletId: string,
  password: string,
  material: SarVaultShares,
): Promise<readonly [EncryptedSarVaultShare, EncryptedSarVaultShare, EncryptedSarVaultShare]> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const key = await passwordKey(password, salt);
  try {
    const encrypted = await Promise.all(material.shares.map(async (share, index) => {
      const factorIndex = (index + 1) as 1 | 2 | 3;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const associatedData = aad(tenantId, walletId, factorIndex);
      const payload = new Uint8Array(1 + share.length);
      payload[0] = material.kind === 'mnemonic-entropy' ? 1 : 2;
      payload.set(share, 1);
      try {
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(encoder.encode(associatedData)) },
          key,
          buffer(payload),
        ));
        return {
          version: 1,
          factorIndex,
          kdf: 'PBKDF2-SHA256',
          iterations,
          saltBase64: base64(salt),
          ivBase64: base64(iv),
          ciphertextBase64: base64(ciphertext),
          aad: associatedData,
        } as const;
      } finally {
        payload.fill(0);
        iv.fill(0);
      }
    }));
    return encrypted as [EncryptedSarVaultShare, EncryptedSarVaultShare, EncryptedSarVaultShare];
  } finally {
    salt.fill(0);
  }
}

export async function decryptSarVaultShares(
  tenantId: string,
  walletId: string,
  password: string,
  encrypted: readonly [EncryptedSarVaultShare, EncryptedSarVaultShare],
): Promise<{ kind: SarVaultShares['kind']; shares: [Uint8Array, Uint8Array] }> {
  if (encrypted[0].factorIndex === encrypted[1].factorIndex
    || encrypted.some((share) => share.version !== 1
      || share.kdf !== 'PBKDF2-SHA256'
      || share.iterations !== iterations
      || share.aad !== aad(tenantId, walletId, share.factorIndex))
    || encrypted[0].saltBase64 !== encrypted[1].saltBase64) throw new Error('vault_envelope_mismatch');
  const salt = bytes(encrypted[0].saltBase64);
  if (salt.length !== 32) throw new Error('vault_envelope_mismatch');
  const key = await passwordKey(password, salt);
  salt.fill(0);
  const plaintexts: Uint8Array[] = [];
  try {
    for (const share of encrypted) {
      const iv = bytes(share.ivBase64);
      if (iv.length !== 12) throw new Error('vault_envelope_mismatch');
      const plaintext = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(encoder.encode(share.aad)) },
        key,
        buffer(bytes(share.ciphertextBase64)),
      ));
      plaintexts.push(plaintext);
      iv.fill(0);
    }
    const kindCode = plaintexts[0]?.[0];
    if ((kindCode !== 1 && kindCode !== 2) || plaintexts[1]?.[0] !== kindCode) throw new Error('vault_envelope_mismatch');
    return {
      kind: kindCode === 1 ? 'mnemonic-entropy' : 'evm-private-key',
      shares: [plaintexts[0]!.slice(1), plaintexts[1]!.slice(1)],
    };
  } catch {
    throw new Error('vault_password_or_envelope_invalid');
  } finally {
    for (const plaintext of plaintexts) plaintext.fill(0);
  }
}
