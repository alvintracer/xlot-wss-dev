import { getLocalDeviceKey } from './localSarVault';

interface AppPinRecord {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

const marker = new TextEncoder().encode('took-wss:tenant-app-pin:v1');
const pinPattern = /^\d{6}$/;
function source(value: Uint8Array): BufferSource { return value as unknown as BufferSource; }

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}
function keyFor(scope: string): string {
  return `took-wss:app-pin-v1:${scope}`;
}
function read(scope: string): AppPinRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    return raw ? JSON.parse(raw) as AppPinRecord : null;
  } catch { return null; }
}
async function encryptionKey(scope: string, pin: string, salt: Uint8Array, create: boolean): Promise<CryptoKey> {
  const deviceKey = await getLocalDeviceKey(scope, '__app_pin__', create);
  if (!deviceKey) throw new Error('app_pin_unavailable');
  const peppered = new Uint8Array(await crypto.subtle.sign('HMAC', deviceKey,
    source(new TextEncoder().encode(`took-wss:app-pin-v1:${scope}:${pin}`))));
  try {
    const input = await crypto.subtle.importKey('raw', source(peppered), 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 250_000, salt: source(salt) }, input,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { peppered.fill(0); }
}

export function appPinScope(tenantId: string, sessionToken: string | null): string {
  try {
    const payload = JSON.parse(atob((sessionToken ?? '').split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { tenantId?: string; subject?: string };
    if (payload.tenantId === tenantId && typeof payload.subject === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(payload.subject)) {
      return `${tenantId}:${payload.subject}`;
    }
  } catch { /* The host only namespaces local data from its signed session. */ }
  throw new Error('app_pin_session_unavailable');
}

export function hasAppPin(scope: string): boolean { return read(scope)?.version === 1; }

export async function verifyAppPin(scope: string, pin: string): Promise<boolean> {
  if (!pinPattern.test(pin)) return false;
  const record = read(scope);
  if (!record || record.version !== 1) return false;
  try {
    const salt = decode(record.salt); const iv = decode(record.iv);
    if (salt.length !== 32 || iv.length !== 12) return false;
    const key = await encryptionKey(scope, pin, salt, false);
    const opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: source(iv) }, key, source(decode(record.ciphertext))));
    const matches = opened.length === marker.length && opened.every((byte, index) => byte === marker[index]);
    opened.fill(0);
    return matches;
  } catch { return false; }
}

export async function ensureAppPin(scope: string, pin: string): Promise<void> {
  if (!pinPattern.test(pin)) throw new Error('app_pin_invalid');
  if (hasAppPin(scope)) {
    if (!await verifyAppPin(scope, pin)) throw new Error('app_pin_invalid');
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await encryptionKey(scope, pin, salt, true);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: source(iv) }, key, source(marker)));
    localStorage.setItem(keyFor(scope), JSON.stringify({ version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(encrypted) } satisfies AppPinRecord));
  } finally { salt.fill(0); iv.fill(0); }
}
