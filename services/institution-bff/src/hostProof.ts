import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  WSS_PROTOCOL_VERSION,
  isRecord,
  type HostAuthenticationPurpose,
  type SecureSarWalletPayload,
  type WssSessionClaims,
} from '@took-wss/contracts';

const TOKEN_HEADER = { alg: 'HS256', typ: 'WSS-HOST-PROOF' } as const;
type Session = Omit<WssSessionClaims, 'nonce'>;

interface ProofBase {
  protocolVersion: 1;
  proofId: string;
  sessionId: string;
  tenantId: string;
  subject: string;
  issuedAt: number;
  expiresAt: number;
}

export type HostProofClaims =
  | (ProofBase & {
      kind: 'wallet-authorization';
      purpose: HostAuthenticationPurpose;
      method: 'development-reference-host';
    })
  | (ProofBase & {
      kind: 'sar-key-core';
      payloadHash: string;
    });

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function issue(claims: HostProofClaims, secret: string): string {
  const unsigned = `${encode(TOKEN_HEADER)}.${encode(claims)}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

function proofBase(session: Session, now: number, ttlSeconds: number): ProofBase {
  return {
    protocolVersion: WSS_PROTOCOL_VERSION,
    proofId: randomUUID(),
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    subject: session.subject,
    issuedAt: now,
    expiresAt: Math.min(session.expiresAt, now + ttlSeconds),
  };
}

export function issueWalletAuthorizationProof(input: {
  session: Session;
  purpose: HostAuthenticationPurpose;
  secret: string;
  now?: number;
  ttlSeconds?: number;
}): { proof: string; claims: Extract<HostProofClaims, { kind: 'wallet-authorization' }> } {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const claims = {
    ...proofBase(input.session, now, input.ttlSeconds ?? 600),
    kind: 'wallet-authorization',
    purpose: input.purpose,
    method: 'development-reference-host',
  } as const;
  return { proof: issue(claims, input.secret), claims };
}

export function sarKeyCorePayloadHash(payload: SecureSarWalletPayload): string {
  const canonical = {
    secureProvisionRef: payload.secureProvisionRef,
    addresses: [...payload.addresses]
      .map(({ addressGroupId, address }) => ({ addressGroupId, address }))
      .sort((left, right) => left.addressGroupId.localeCompare(right.addressGroupId)),
    recoveryEnvelopes: [...payload.recoveryEnvelopes]
      .map(({ factorIndex, envelopeVersion, algorithm, ivBase64, ciphertextBase64, aad }) => ({
        factorIndex,
        envelopeVersion,
        algorithm,
        ivBase64,
        ciphertextBase64,
        aad,
      }))
      .sort((left, right) => left.factorIndex - right.factorIndex),
    recovery: {
      scheme: payload.recovery.scheme,
      threshold: payload.recovery.threshold,
      shareCount: payload.recovery.shareCount,
      recombinationVerified: payload.recovery.recombinationVerified,
      keyCoreVersion: payload.recovery.keyCoreVersion,
    },
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('base64url');
}

export function issueSarKeyCoreProof(input: {
  session: Session;
  payload: SecureSarWalletPayload;
  secret: string;
  now?: number;
  ttlSeconds?: number;
}): { proof: string; claims: Extract<HostProofClaims, { kind: 'sar-key-core' }> } {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const claims = {
    ...proofBase(input.session, now, input.ttlSeconds ?? 600),
    kind: 'sar-key-core',
    payloadHash: sarKeyCorePayloadHash(input.payload),
  } as const;
  return { proof: issue(claims, input.secret), claims };
}

export function verifyHostProof(token: string, secret: string, now = Math.floor(Date.now() / 1000)): HostProofClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed host proof.');
  const [headerPart, claimsPart, providedSignature] = parts;
  if (!headerPart || !claimsPart || !providedSignature) throw new Error('Malformed host proof.');
  const expectedSignature = signature(`${headerPart}.${claimsPart}`, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid host proof signature.');
  }
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as unknown;
  const claims = JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8')) as unknown;
  if (!isRecord(header) || header.alg !== TOKEN_HEADER.alg || header.typ !== TOKEN_HEADER.typ) {
    throw new Error('Unsupported host proof.');
  }
  if (!isRecord(claims)
    || claims.protocolVersion !== WSS_PROTOCOL_VERSION
    || typeof claims.proofId !== 'string'
    || typeof claims.sessionId !== 'string'
    || typeof claims.tenantId !== 'string'
    || typeof claims.subject !== 'string'
    || typeof claims.issuedAt !== 'number'
    || typeof claims.expiresAt !== 'number') {
    throw new Error('Malformed host proof claims.');
  }
  if (claims.expiresAt <= now) throw new Error('Host proof expired.');
  if (claims.issuedAt > now + 30) throw new Error('Host proof issued in the future.');
  if (claims.kind === 'wallet-authorization'
    && (claims.purpose === 'wallet-provisioning' || claims.purpose === 'transfer-approval' || claims.purpose === 'wallet-recovery')
    && claims.method === 'development-reference-host') return claims as unknown as HostProofClaims;
  if (claims.kind === 'sar-key-core' && typeof claims.payloadHash === 'string') return claims as unknown as HostProofClaims;
  throw new Error('Unsupported host proof claims.');
}

export function assertProofSession(claims: HostProofClaims, session: Session): void {
  if (claims.sessionId !== session.sessionId
    || claims.tenantId !== session.tenantId
    || claims.subject !== session.subject) {
    throw new Error('Host proof session mismatch.');
  }
}
