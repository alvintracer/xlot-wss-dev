import { describe, expect, it } from 'vitest';
import { sarMasterPasswordError, sarMasterPasswordStrength } from './sarMasterPasswordPolicy';

describe('SAR v2 shared master password policy', () => {
  it('requires at least eight characters, uppercase, lowercase, and an ASCII special character', () => {
    for (const value of ['', 'Ab!1234', 'password!1', 'PASSWORD!1', 'Password12']) {
      expect(sarMasterPasswordStrength(value).valid).toBe(false);
      expect(sarMasterPasswordError(value)).not.toBeNull();
    }
    expect(sarMasterPasswordStrength('Password!').valid).toBe(true);
    expect(sarMasterPasswordStrength('Abcdef!1').score).toBe(4);
    expect(sarMasterPasswordError('Abcdef!1')).toBeNull();
  });

  it('does not count letters, whitespace, or emoji as the required special character', () => {
    for (const value of ['Password가', 'Password  ', 'Password💰']) {
      expect(sarMasterPasswordStrength(value).special).toBe(false);
    }
  });
});
