import type { SarVaultShares } from '@took-wss/sar-key-core';

const encoder = new TextEncoder();
const iterations = 600_000;

export type SarVaultFactor = 'password' | 'phone' | 'email';
export type SarVaultPair = 'password-phone' | 'password-email' | 'phone-email';
export type SarVaultKind = SarVaultShares['kind'];

export interface PasswordShareEnvelope {
  version: 2;
  factor: 'password';
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  aad: string;
}

export interface PlainFactorShare {
  version: 2;
  factor: 'phone' | 'email';
  kind: SarVaultKind;
  shareBase64: string;
}

function source(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export function sarBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function sarBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function shareAad(tenantId: string, walletId: string): string {
  return `took-wss:sar-vault-v2:${tenantId}:${walletId}:password`;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 8) throw new Error('vault_password_too_short');
  const material = await crypto.subtle.importKey(
    'raw', source(encoder.encode(password.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: source(salt) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPasswordShare(
  tenantId: string,
  walletId: string,
  password: string,
  kind: SarVaultKind,
  share: Uint8Array,
): Promise<PasswordShareEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new Uint8Array(share.length + 1);
  payload[0] = kind === 'mnemonic-entropy' ? 1 : 2;
  payload.set(share, 1);
  const aad = shareAad(tenantId, walletId);
  try {
    const key = await deriveKey(password, salt);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: source(iv), additionalData: source(encoder.encode(aad)) },
      key, source(payload),
    ));
    return {
      version: 2,
      factor: 'password',
      kdf: 'PBKDF2-SHA256',
      iterations,
      saltBase64: sarBase64(salt),
      ivBase64: sarBase64(iv),
      ciphertextBase64: sarBase64(ciphertext),
      aad,
    };
  } finally {
    salt.fill(0);
    iv.fill(0);
    payload.fill(0);
  }
}

export async function decryptPasswordShare(
  tenantId: string,
  walletId: string,
  password: string,
  envelope: PasswordShareEnvelope,
): Promise<{ kind: SarVaultKind; share: Uint8Array }> {
  if (envelope.version !== 2 || envelope.factor !== 'password'
    || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== iterations
    || envelope.aad !== shareAad(tenantId, walletId)) throw new Error('vault_envelope_mismatch');
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = sarBytes(envelope.saltBase64);
    iv = sarBytes(envelope.ivBase64);
    ciphertext = sarBytes(envelope.ciphertextBase64);
  } catch {
    throw new Error('vault_envelope_mismatch');
  }
  if (salt.length !== 32 || iv.length !== 12 || ciphertext.length < 34 || ciphertext.length > 145) {
    throw new Error('vault_envelope_mismatch');
  }
  try {
    const key = await deriveKey(password, salt);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: source(iv), additionalData: source(encoder.encode(envelope.aad)) },
      key, source(ciphertext),
    ));
    try {
      if ((plaintext[0] !== 1 && plaintext[0] !== 2) || plaintext.length < 18) {
        throw new Error('vault_envelope_mismatch');
      }
      return { kind: plaintext[0] === 1 ? 'mnemonic-entropy' : 'evm-private-key', share: plaintext.slice(1) };
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error('vault_password_or_envelope_invalid');
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

export function plainFactorShare(factor: 'phone' | 'email', kind: SarVaultKind, share: Uint8Array): PlainFactorShare {
  return { version: 2, factor, kind, shareBase64: sarBase64(share) };
}

export function decodeFactorShare(expected: 'phone' | 'email', value: PlainFactorShare): {
  kind: SarVaultKind; share: Uint8Array;
} {
  if (value.version !== 2 || value.factor !== expected
    || (value.kind !== 'mnemonic-entropy' && value.kind !== 'evm-private-key')) {
    throw new Error('vault_envelope_mismatch');
  }
  const share = sarBytes(value.shareBase64);
  if ((value.kind === 'evm-private-key' && share.length !== 33)
    || (value.kind === 'mnemonic-entropy' && ![17, 21, 25, 29, 33].includes(share.length))) {
    share.fill(0);
    throw new Error('vault_envelope_mismatch');
  }
  return { kind: value.kind, share };
}

export function pairFactors(pair: SarVaultPair): readonly [SarVaultFactor, SarVaultFactor] {
  if (pair === 'password-phone') return ['password', 'phone'];
  if (pair === 'password-email') return ['password', 'email'];
  return ['phone', 'email'];
}
