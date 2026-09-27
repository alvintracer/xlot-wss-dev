import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import {
  MOBILE_CARRIER_CODES,
  type CreateRegistrationIntentRequest,
  type MobileCarrierCode,
} from '@took-wss/contracts';

export class RegistrationError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

export interface NormalizedRegistrationInput {
  name: string;
  birthDate: string;
  phone: string;
  carrierCode: MobileCarrierCode;
  consentVersion: string;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

export function normalizeRegistrationInput(
  value: CreateRegistrationIntentRequest,
  expectedConsentVersion: string,
): NormalizedRegistrationInput {
  const name = value.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new RegistrationError('invalid_name');
  }
  if (!validCalendarDate(value.birthDate)) throw new RegistrationError('invalid_birth_date');
  const birthDate = new Date(`${value.birthDate}T00:00:00.000Z`);
  const now = new Date();
  if (birthDate.getUTCFullYear() < 1900 || birthDate >= now) throw new RegistrationError('invalid_birth_date');
  const phone = value.phone.replace(/\D/g, '');
  if (!/^010\d{8}$/.test(phone)) throw new RegistrationError('invalid_phone');
  if (!MOBILE_CARRIER_CODES.includes(value.carrierCode)) throw new RegistrationError('invalid_carrier');
  if (value.consentVersion !== expectedConsentVersion) throw new RegistrationError('consent_version_mismatch');
  return { name, birthDate: value.birthDate, phone, carrierCode: value.carrierCode, consentVersion: value.consentVersion };
}

export function encryptionKeyFromHex(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('WSS_PII_ENCRYPTION_KEY must be a 32-byte hexadecimal key.');
  return Buffer.from(value, 'hex');
}

export function encryptPrivateAttribute(plaintext: string, key: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error('PII encryption key must contain 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]);
}

export function phoneLookupHash(tenantId: string, phone: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${tenantId}\u0000${phone}`).digest();
}

export function sessionIdHash(tenantId: string, sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${tenantId}\u0000${sessionId}`).digest('hex');
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function otpMac(tenantId: string, challengeId: string, code: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${tenantId}\u0000${challengeId}\u0000${code}`).digest();
}

export function verifyOtpMac(expected: Uint8Array, actual: Uint8Array): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function consentEvidenceHash(input: {
  tenantId: string;
  registrationIntentId: string;
  subjectHash: string;
  consentVersion: string;
}): string {
  return createHash('sha256')
    .update(`${input.tenantId}\u0000${input.registrationIntentId}\u0000${input.subjectHash}\u0000${input.consentVersion}`)
    .digest('hex');
}
