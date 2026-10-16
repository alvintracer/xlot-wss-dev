import type { SarVaultShares } from '@took-wss/sar-key-core';

type LocalVaultMaterial = {
  kind: SarVaultShares['kind'];
  shares: readonly [Uint8Array, Uint8Array] | readonly [Uint8Array, Uint8Array, Uint8Array];
};

const encoder = new TextEncoder();
const iterations = 600_000;

interface CipherEnvelope {
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
}

export interface LocalSarVaultRecord {
  version: 1;
  tenantId: string;
  walletId: string;
  master: CipherEnvelope;
  pin: CipherEnvelope;
}

function source(value: Uint8Array): BufferSource {
  return value as unknown as BufferSource;
}

function base64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function recordKey(tenantId: string, walletId: string): string {
  return `took-wss:local-sar-v1:${tenantId}:${walletId}`;
}

function aad(tenantId: string, walletId: string, factor: 'master' | 'pin'): Uint8Array {
  return encoder.encode(`took-wss:local-sar-v1:${tenantId}:${walletId}:${factor}`);
}

async function masterKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  if (masterPassword.length < 8) throw new Error('vault_password_too_short');
  const input = await crypto.subtle.importKey(
    'raw', source(encoder.encode(masterPassword.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: source(salt) },
    input,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pinKey(
  tenantId: string,
  walletId: string,
  pin: string,
  salt: Uint8Array,
  deviceKey: CryptoKey,
): Promise<CryptoKey> {
  if (!/^\d{6}$/.test(pin)) throw new Error('vault_pin_invalid');
  const material = new Uint8Array(await crypto.subtle.sign(
    'HMAC', deviceKey,
    source(encoder.encode(`took-wss:local-sar-v1:${tenantId}:${walletId}:${base64(salt)}:${pin}`)),
  ));
  try {
    return await crypto.subtle.importKey('raw', source(material), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    material.fill(0);
  }
}

async function seal(key: CryptoKey, data: Uint8Array, associatedData: Uint8Array, salt: Uint8Array): Promise<CipherEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: source(iv), additionalData: source(associatedData) }, key, source(data),
    ));
    return { saltBase64: base64(salt), ivBase64: base64(iv), ciphertextBase64: base64(ciphertext) };
  } finally {
    iv.fill(0);
  }
}

async function open(key: CryptoKey, envelope: CipherEnvelope, associatedData: Uint8Array): Promise<Uint8Array> {
  const iv = bytes(envelope.ivBase64);
  const ciphertext = bytes(envelope.ciphertextBase64);
  if (iv.length !== 12 || ciphertext.length < 52 || ciphertext.length > 290) {
    throw new Error('local_vault_invalid');
  }
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: source(iv), additionalData: source(associatedData) }, key, source(ciphertext),
    ));
  } finally {
    iv.fill(0);
    ciphertext.fill(0);
  }
}

function pack(material: LocalVaultMaterial): Uint8Array {
  const [first, second] = material.shares;
  if (first.length !== second.length || first.length > 128 || first.length < 17) throw new Error('local_vault_invalid');
  const packed = new Uint8Array(2 + first.length + second.length);
  packed[0] = material.kind === 'mnemonic-entropy' ? 1 : 2;
  packed[1] = first.length;
  packed.set(first, 2);
  packed.set(second, 2 + first.length);
  return packed;
}

function unpack(packed: Uint8Array): { kind: SarVaultShares['kind']; shares: [Uint8Array, Uint8Array] } {
  const length = packed[1] ?? 0;
  if (![1, 2].includes(packed[0] ?? 0) || length < 17 || length > 128 || packed.length !== 2 + length * 2) {
    throw new Error('local_vault_invalid');
  }
  return {
    kind: packed[0] === 1 ? 'mnemonic-entropy' : 'evm-private-key',
    shares: [packed.slice(2, 2 + length), packed.slice(2 + length)],
  };
}

export async function createLocalSarVault(
  tenantId: string,
  walletId: string,
  masterPassword: string,
  pin: string,
  material: LocalVaultMaterial,
  deviceKey: CryptoKey,
): Promise<LocalSarVaultRecord> {
  const packed = pack(material);
  const masterSalt = crypto.getRandomValues(new Uint8Array(32));
  const pinSalt = crypto.getRandomValues(new Uint8Array(32));
  try {
    const [master, localPin] = await Promise.all([
      masterKey(masterPassword, masterSalt),
      pinKey(tenantId, walletId, pin, pinSalt, deviceKey),
    ]);
    return {
      version: 1,
      tenantId,
      walletId,
      master: await seal(master, packed, aad(tenantId, walletId, 'master'), masterSalt),
      pin: await seal(localPin, packed, aad(tenantId, walletId, 'pin'), pinSalt),
    };
  } finally {
    packed.fill(0);
    masterSalt.fill(0);
    pinSalt.fill(0);
  }
}

export async function openLocalSarVault(
  tenantId: string,
  walletId: string,
  record: LocalSarVaultRecord,
  input: { masterPassword: string } | { pin: string; deviceKey: CryptoKey },
): Promise<{ kind: SarVaultShares['kind']; shares: [Uint8Array, Uint8Array] }> {
  if (record.version !== 1 || record.tenantId !== tenantId || record.walletId !== walletId) {
    throw new Error('local_vault_invalid');
  }
  const factor = 'masterPassword' in input ? 'master' : 'pin';
  const envelope = record[factor];
  const salt = bytes(envelope.saltBase64);
  if (salt.length !== 32) throw new Error('local_vault_invalid');
  try {
    const key = factor === 'master'
      ? await masterKey((input as { masterPassword: string }).masterPassword, salt)
      : await pinKey(tenantId, walletId, (input as { pin: string }).pin, salt, (input as { deviceKey: CryptoKey }).deviceKey);
    const plaintext = await open(key, envelope, aad(tenantId, walletId, factor));
    try {
      return unpack(plaintext);
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error('local_vault_unlock_failed');
  } finally {
    salt.fill(0);
  }
}

export async function replaceLocalSarVaultPin(
  tenantId: string, walletId: string, record: LocalSarVaultRecord,
  material: LocalVaultMaterial, pin: string, deviceKey: CryptoKey,
): Promise<LocalSarVaultRecord> {
  if (record.version !== 1 || record.tenantId !== tenantId || record.walletId !== walletId) throw new Error('local_vault_invalid');
  const packed = pack(material);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  try {
    const key = await pinKey(tenantId, walletId, pin, salt, deviceKey);
    return { ...record, pin: await seal(key, packed, aad(tenantId, walletId, 'pin'), salt) };
  } finally { packed.fill(0); salt.fill(0); }
}

export function readLocalSarVault(tenantId: string, walletId: string): LocalSarVaultRecord | null {
  try {
    const raw = window.localStorage.getItem(recordKey(tenantId, walletId));
    return raw ? JSON.parse(raw) as LocalSarVaultRecord : null;
  } catch {
    return null;
  }
}

export function saveLocalSarVault(record: LocalSarVaultRecord): void {
  window.localStorage.setItem(recordKey(record.tenantId, record.walletId), JSON.stringify(record));
}

export async function removeLocalSarVault(tenantId: string, walletId: string): Promise<void> {
  const id = recordKey(tenantId, walletId);
  window.localStorage.removeItem(id);
  window.localStorage.removeItem(`took-wss:sar-vault-a:${tenantId}:${walletId}`);
  window.localStorage.removeItem(`took-wss:sar-vault-v1:${tenantId}:${walletId}:factor-1`);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('took-wss-local-sar-keys', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onerror = () => reject(new Error('local_vault_unavailable'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('keys', 'readwrite');
      transaction.objectStore('keys').delete(id);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(new Error('local_vault_unavailable')); };
      transaction.onabort = () => { db.close(); reject(new Error('local_vault_unavailable')); };
    };
  });
}

export async function getLocalDeviceKey(tenantId: string, walletId: string, create: boolean): Promise<CryptoKey | null> {
  const id = recordKey(tenantId, walletId);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('took-wss-local-sar-keys', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onerror = () => reject(new Error('local_vault_unavailable'));
    request.onsuccess = async () => {
      const db = request.result;
      try {
        const read = db.transaction('keys', 'readonly').objectStore('keys').get(id);
        read.onerror = () => { db.close(); reject(new Error('local_vault_unavailable')); };
        read.onsuccess = async () => {
          if (read.result) { db.close(); resolve(read.result as CryptoKey); return; }
          if (!create) { db.close(); resolve(null); return; }
          try {
            const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
            const transaction = db.transaction('keys', 'readwrite');
            transaction.objectStore('keys').put(key, id);
            transaction.onerror = () => { db.close(); reject(new Error('local_vault_unavailable')); };
            transaction.onabort = () => { db.close(); reject(new Error('local_vault_unavailable')); };
            transaction.oncomplete = () => { db.close(); resolve(key); };
          } catch { db.close(); reject(new Error('local_vault_unavailable')); }
        };
      } catch { db.close(); reject(new Error('local_vault_unavailable')); }
    };
  });
}
