import { describe, expect, it } from 'vitest';
import { issueSessionToken, verifySessionToken } from './sessionToken';

const secret = 'a-test-secret-that-is-long-enough-for-hmac';
const subjectHashSecret = 'a-separate-subject-secret-that-is-long-enough';

describe('institution session token', () => {
  it('round-trips tenant and key policy claims', () => {
    const issued = issueSessionToken({
      tenantId: 'kiwoom',
      customerRef: 'opaque-customer-1',
      keyAdapter: 'fsl-mpc',
      secret,
      subjectHashSecret,
      now: 100,
      ttlSeconds: 300,
    });
    const verified = verifySessionToken(issued.token, secret, 120);
    expect(verified.tenantId).toBe('kiwoom');
    expect(verified.keyAdapter).toBe('fsl-mpc');
    expect(verified.subjectVersion).toBe(1);
    expect(verified.subject).not.toContain('opaque-customer-1');
  });

  it('keeps the institution subject stable when the session signing key rotates', () => {
    const first = issueSessionToken({
      tenantId: 'kiwoom',
      customerRef: 'opaque-customer-1',
      keyAdapter: 'took-sar',
      secret: 'first-session-secret-that-is-long-enough',
      subjectHashSecret,
      now: 100,
    });
    const second = issueSessionToken({
      tenantId: 'kiwoom',
      customerRef: 'opaque-customer-1',
      keyAdapter: 'took-sar',
      secret: 'second-session-secret-that-is-long-enough',
      subjectHashSecret,
      now: 101,
    });

    expect(first.claims.subject).toBe(second.claims.subject);
    expect(first.token).not.toBe(second.token);
  });

  it('rejects a tampered token', () => {
    const issued = issueSessionToken({ tenantId: 'kiwoom', customerRef: 'opaque-customer-1', keyAdapter: 'took-sar', secret, subjectHashSecret, now: 100 });
    expect(() => verifySessionToken(`${issued.token.slice(0, -1)}x`, secret, 120)).toThrow('Invalid session signature');
  });

  it('rejects an expired token', () => {
    const issued = issueSessionToken({ tenantId: 'kiwoom', customerRef: 'opaque-customer-1', keyAdapter: 'took-sar', secret, subjectHashSecret, now: 100, ttlSeconds: 10 });
    expect(() => verifySessionToken(issued.token, secret, 111)).toThrow('Session expired');
  });
});
