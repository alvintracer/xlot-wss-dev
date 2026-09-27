import { describe, expect, it } from 'vitest';
import {
  encryptionKeyFromHex,
  decryptPrivateAttribute,
  encryptPrivateAttribute,
  koreanPhoneE164,
  koreanPhoneNational,
  normalizeRegistrationInput,
  otpMac,
  verifyOtpMac,
} from './phoneRegistration.js';

describe('phone registration security helpers', () => {
  it('normalizes a Korean mobile registration without retaining formatting', () => {
    expect(normalizeRegistrationInput({
      name: '  홍  길동 ',
      birthDate: '1990-01-02',
      phone: '010-1234-5678',
      carrierCode: 'skt',
      consentVersion: 'v1',
    }, 'v1')).toEqual({
      name: '홍 길동',
      birthDate: '1990-01-02',
      phone: '01012345678',
      carrierCode: 'skt',
      consentVersion: 'v1',
    });
  });

  it('rejects malformed dates, mobile numbers, and stale consent', () => {
    const base = { name: '홍길동', birthDate: '1990-01-02', phone: '01012345678', carrierCode: 'kt' as const, consentVersion: 'v1' };
    expect(() => normalizeRegistrationInput({ ...base, birthDate: '1990-02-30' }, 'v1')).toThrow('invalid_birth_date');
    expect(() => normalizeRegistrationInput({ ...base, phone: '0212345678' }, 'v1')).toThrow('invalid_phone');
    expect(() => normalizeRegistrationInput(base, 'v2')).toThrow('consent_version_mismatch');
  });

  it('creates authenticated ciphertext and compares only OTP MAC values', () => {
    const key = encryptionKeyFromHex('ab'.repeat(32));
    const ciphertext = encryptPrivateAttribute('홍길동', key, 'tenant:intent:name');
    expect(ciphertext[0]).toBe(1);
    expect(ciphertext.toString('utf8')).not.toContain('홍길동');
    expect(decryptPrivateAttribute(ciphertext, key, 'tenant:intent:name')).toBe('홍길동');
    const expected = otpMac('tenant', 'challenge', '123456', 'otp-secret');
    expect(verifyOtpMac(expected, otpMac('tenant', 'challenge', '123456', 'otp-secret'))).toBe(true);
    expect(verifyOtpMac(expected, otpMac('tenant', 'challenge', '654321', 'otp-secret'))).toBe(false);
  });

  it('normalizes the Korean phone boundary used by Supabase Auth', () => {
    expect(koreanPhoneE164('01012345678')).toBe('+821012345678');
    expect(koreanPhoneNational('+82 10-1234-5678')).toBe('01012345678');
    expect(() => koreanPhoneNational('+14155552671')).toThrow('verified_phone_mismatch');
  });
});
