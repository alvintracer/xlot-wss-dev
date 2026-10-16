import { describe, expect, it } from 'vitest';
import { planVerifiedProfileMerge, type VerifiedProfileMatch } from './identityProfileMerge.js';

const verifiedSubject = 'same-verified-phone-account';

function profile(profileId: string, activeWalletCount: number, createdAt: string,
  providerSubjectHash: string | null = verifiedSubject): VerifiedProfileMatch {
  return { profileId, activeWalletCount, createdAt: new Date(createdAt), providerSubjectHash };
}

describe('verified customer profile reconciliation', () => {
  it('keeps the wallet-richest profile and preserves every other matching profile as a merge source', () => {
    expect(planVerifiedProfileMerge([
      profile('older', 2, '2026-01-01'),
      profile('newer', 1, '2026-02-01'),
      profile('empty', 0, '2026-03-01'),
    ], verifiedSubject)).toEqual({ canonicalProfileId: 'older', sourceProfileIds: ['newer', 'empty'] });
  });

  it('allows an unambiguous legacy profile without a stored provider subject', () => {
    expect(planVerifiedProfileMerge([
      profile('legacy', 1, '2026-01-01', null),
    ], verifiedSubject)).toEqual({ canonicalProfileId: 'legacy', sourceProfileIds: [] });
  });

  it('rejects duplicate matches without the same verified phone provider identity', () => {
    expect(() => planVerifiedProfileMerge([
      profile('first', 1, '2026-01-01'),
      profile('other', 1, '2026-02-01', 'different-phone-account'),
    ], verifiedSubject)).toThrow('identity_details_mismatch');
    expect(() => planVerifiedProfileMerge([
      profile('first', 1, '2026-01-01'),
      profile('legacy', 1, '2026-02-01', null),
    ], verifiedSubject)).toThrow('identity_details_mismatch');
  });
});
