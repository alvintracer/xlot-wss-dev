import { describe, expect, it } from 'vitest';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { jbManifest } from '@took-wss/tenant-jb';
import { namuManifest } from '@took-wss/tenant-namu';
import { smsPhoneKey } from './smsDeliveryContext.js';
import { smsBrandForTenant } from './smsTenantBrand.js';

describe('tenant SMS delivery context', () => {
  it('reads every SMS label from its tenant manifest', () => {
    expect(smsBrandForTenant('kiwoom')).toBe(kiwoomManifest.walletName);
    expect(smsBrandForTenant('jb')).toBe(jbManifest.walletName);
    expect(smsBrandForTenant('namu')).toBe(namuManifest.walletName);
    expect(() => smsBrandForTenant('unknown')).toThrow('unsupported_sms_tenant');
  });

  it('uses a purpose-separated HMAC instead of storing a phone', () => {
    const key = smsPhoneKey('+821012345678', 'test-secret');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('01012345678');
    expect(smsPhoneKey('+821012345678', 'test-secret')).toBe(key);
    expect(smsPhoneKey('+821012345678', 'other-secret')).not.toBe(key);
    expect(() => smsPhoneKey('+14155552671', 'test-secret')).toThrow();
  });
});
