import { RegistrationError } from './phoneRegistration.js';

export interface VerifiedProfileMatch {
  profileId: string;
  createdAt: Date;
  activeWalletCount: number;
  providerSubjectHash: string | null;
}

export function planVerifiedProfileMerge(
  matches: VerifiedProfileMatch[],
  verifiedProviderSubjectHash: string | null,
): { canonicalProfileId: string; sourceProfileIds: string[] } | null {
  if (matches.length === 0) return null;
  if (verifiedProviderSubjectHash && matches.some((profile) =>
    profile.providerSubjectHash && profile.providerSubjectHash !== verifiedProviderSubjectHash)) {
    throw new RegistrationError('identity_details_mismatch');
  }
  if (matches.length > 1 && (!verifiedProviderSubjectHash
    || matches.some((profile) => profile.providerSubjectHash !== verifiedProviderSubjectHash))) {
    throw new RegistrationError('identity_details_mismatch');
  }
  const ordered = [...matches].sort((left, right) =>
    right.activeWalletCount - left.activeWalletCount
      || left.createdAt.getTime() - right.createdAt.getTime()
      || left.profileId.localeCompare(right.profileId));
  return {
    canonicalProfileId: ordered[0]!.profileId,
    sourceProfileIds: ordered.slice(1).map((profile) => profile.profileId),
  };
}
