import { describe, expect, it } from 'vitest';
import {
  assertProofSession,
  issueSarKeyCoreProof,
  issueWalletAuthorizationProof,
  sarKeyCorePayloadHash,
  verifyHostProof,
} from './hostProof.js';

const secret = 'host-proof-test-secret-that-is-long-enough';
const session = {
  protocolVersion: 1,
  sessionId: 'session-1',
  tenantId: 'kiwoom',
  subject: 'subject-1',
  subjectVersion: 1,
  keyAdapter: 'took-sar',
  issuedAt: 100,
  expiresAt: 1_000,
} as const;

const sarPayload = {
  secureProvisionRef: 'sar-key-reference-123456',
  addresses: [{ addressGroupId: 'evm', address: '0x0000000000000000000000000000000000000001' }],
  recoveryEnvelopes: [1, 2, 3].map((factorIndex) => ({
    factorIndex: factorIndex as 1 | 2 | 3,
    envelopeVersion: 1 as const,
    algorithm: 'AES-256-GCM' as const,
    ivBase64: 'AAAAAAAAAAAAAAAA',
    ciphertextBase64: 'AAAAAAAAAAAAAAAAAAAAAAAA',
    aad: `sar-key-core-v1:sar-key-reference-123456:factor-${factorIndex}`,
  })),
  recovery: {
    scheme: 'shamir-gf256' as const,
    threshold: 2 as const,
    shareCount: 3 as const,
    recombinationVerified: true as const,
    keyCoreVersion: 'sar-key-core-v1',
  },
};

describe('one-time host proof boundary', () => {
  it('issues a short-lived wallet authorization bound to the institution session', () => {
    const issued = issueWalletAuthorizationProof({
      session,
      purpose: 'wallet-provisioning',
      secret,
      now: 200,
      ttlSeconds: 120,
    });
    const verified = verifyHostProof(issued.proof, secret, 250);
    expect(verified).toMatchObject({
      kind: 'wallet-authorization',
      purpose: 'wallet-provisioning',
      sessionId: session.sessionId,
      expiresAt: 320,
    });
    expect(() => assertProofSession(verified, session)).not.toThrow();
  });

  it('binds a key-core proof to every public registration field', () => {
    const issued = issueSarKeyCoreProof({ session, payload: sarPayload, secret, now: 200 });
    const verified = verifyHostProof(issued.proof, secret, 250);
    expect(verified.kind).toBe('sar-key-core');
    if (verified.kind !== 'sar-key-core') throw new Error('Expected SAR proof.');
    expect(verified.payloadHash).toBe(sarKeyCorePayloadHash(sarPayload));
    expect(verified.payloadHash).not.toBe(sarKeyCorePayloadHash({
      ...sarPayload,
      secureProvisionRef: 'sar-key-reference-tampered',
    }));
  });

  it('rejects tampering, expiry, and a different session', () => {
    const issued = issueWalletAuthorizationProof({ session, purpose: 'wallet-provisioning', secret, now: 200, ttlSeconds: 20 });
    expect(() => verifyHostProof(`${issued.proof.slice(0, -1)}x`, secret, 205)).toThrow('signature');
    expect(() => verifyHostProof(issued.proof, secret, 220)).toThrow('expired');
    expect(() => assertProofSession(issued.claims, { ...session, sessionId: 'session-2' })).toThrow('session mismatch');
  });
});
