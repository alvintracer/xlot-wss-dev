const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return '1'.repeat(bytes.findIndex((byte) => byte !== 0) === -1 ? bytes.length : bytes.findIndex((byte) => byte !== 0)) + encoded;
}

export function decodeBase58(value: string): Uint8Array {
  if (!value || [...value].some((character) => !alphabet.includes(character))) throw new Error('invalid_did_key');
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes: number[] = [];
  while (number > 0n) { bytes.unshift(Number(number % 256n)); number /= 256n; }
  return Uint8Array.from([...Array.from({ length: value.match(/^1*/)?.[0].length ?? 0 }, () => 0), ...bytes]);
}

export function ed25519DidKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('invalid_ed25519_public_key');
  return `did:key:z${encodeBase58(Uint8Array.from([0xed, 0x01, ...publicKey]))}`;
}

export function publicKeyFromEd25519Did(did: string): Uint8Array {
  if (!did.startsWith('did:key:z')) throw new Error('invalid_did_key');
  const bytes = decodeBase58(did.slice('did:key:z'.length));
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error('invalid_did_key');
  return bytes.slice(2);
}

export interface DigitalIdentitySummary {
  credentialId: string;
  holderDid: string;
  issuerDid: string;
  name: string;
  birthDate: string;
  phoneMasked: string;
  issuedAt: string;
  expiresAt: string;
  assurance: 'DEV_ASSUMED';
  connectedWallets: Array<{ walletId: string; label: string; address: string }>;
}

export type DigitalIdentityHostAction = 'status' | 'issue' | 'bind-wallet' | 'verify';

export interface DigitalIdentityHostRequest {
  type: 'took-wss:digital-identity-request';
  protocolVersion: 1;
  requestId: string;
  action: DigitalIdentityHostAction;
  walletId?: string;
}

export interface DigitalIdentityHostResult {
  type: 'took-wss:digital-identity-result';
  protocolVersion: 1;
  requestId: string;
  ok: boolean;
  summary?: DigitalIdentitySummary | null;
  verified?: boolean;
  error?: string;
}
