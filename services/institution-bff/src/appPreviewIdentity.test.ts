import { describe, expect, it } from 'vitest';
import { APP_PREVIEW_COOKIE_NAME, resolveAppPreviewIdentity } from './appPreviewIdentity';

const secret = 'test-preview-cookie-secret-long-enough-for-hmac';
const now = 1_790_000_000;

describe('app-only preview identity', () => {
  it('keeps one private customer reference across visits with a signed cookie', () => {
    const first = resolveAppPreviewIdentity(undefined, secret, now);
    expect(first.setCookie).toContain(`${APP_PREVIEW_COOKIE_NAME}=`);
    expect(first.setCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    const second = resolveAppPreviewIdentity(first.setCookie?.split(';')[0], secret, now + 60);
    expect(second.customerRef).toBe(first.customerRef);
    expect(second.setCookie).toBeNull();
  });

  it('does not accept modified or expired customer cookies', () => {
    const first = resolveAppPreviewIdentity(undefined, secret, now);
    const cookie = first.setCookie?.split(';')[0] || '';
    const tampered = cookie.replace(/.$/, (last) => last === 'a' ? 'b' : 'a');
    expect(resolveAppPreviewIdentity(tampered, secret, now).customerRef).not.toBe(first.customerRef);
    expect(resolveAppPreviewIdentity(cookie, secret, now + 60 * 60 * 24 * 366).customerRef).not.toBe(first.customerRef);
  });
});
