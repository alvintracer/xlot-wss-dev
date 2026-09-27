import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { WSS_PROTOCOL_VERSION, type KeyAdapterId, type WssSessionClaims } from '@took-wss/contracts';

const TOKEN_HEADER = { alg: 'HS256', typ: 'JWT' } as const;

function encode(value: object | string): string {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(source).toString('base64url');
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function signature(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function hashCustomerReference(tenantId: string, customerRef: string, subjectHashSecret: string): string {
  return createHmac('sha256', subjectHashSecret).update(`wss-subject:v1:${tenantId}:${customerRef}`).digest('base64url');
}

export function issueSessionToken(input: {
  tenantId: string;
  customerRef: string;
  keyAdapter: KeyAdapterId;
  secret: string;
  subjectHashSecret: string;
  now?: number;
  ttlSeconds?: number;
}): { token: string; claims: WssSessionClaims } {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000);
  const claims: WssSessionClaims = {
    protocolVersion: WSS_PROTOCOL_VERSION,
    sessionId: randomUUID(),
    tenantId: input.tenantId,
    subject: hashCustomerReference(input.tenantId, input.customerRef, input.subjectHashSecret),
    subjectVersion: 1,
    keyAdapter: input.keyAdapter,
    issuedAt,
    expiresAt: issuedAt + (input.ttlSeconds ?? 300),
    nonce: randomUUID(),
  };
  const unsigned = `${encode(TOKEN_HEADER)}.${encode(claims)}`;
  return { token: `${unsigned}.${signature(unsigned, input.secret)}`, claims };
}

export function verifySessionToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): WssSessionClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed session token.');
  const [headerPart, claimsPart, providedSignature] = parts;
  if (!headerPart || !claimsPart || !providedSignature) throw new Error('Malformed session token.');

  const expectedSignature = signature(`${headerPart}.${claimsPart}`, secret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error('Invalid session signature.');
  }

  const header = decodeJson<typeof TOKEN_HEADER>(headerPart);
  if (header.alg !== TOKEN_HEADER.alg || header.typ !== TOKEN_HEADER.typ) throw new Error('Unsupported session token.');
  const claims = decodeJson<WssSessionClaims>(claimsPart);
  if (claims.protocolVersion !== WSS_PROTOCOL_VERSION) throw new Error('Unsupported session protocol.');
  if (claims.expiresAt <= now) throw new Error('Session expired.');
  if (claims.issuedAt > now + 30) throw new Error('Session issued in the future.');
  return claims;
}
