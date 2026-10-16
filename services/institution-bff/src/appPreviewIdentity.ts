import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const APP_PREVIEW_COOKIE_NAME = '__Host-wss-app-preview';
const cookieLifetimeSeconds = 60 * 60 * 24 * 365;
const cookiePattern = /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9]{10})\.([A-Za-z0-9_-]{43})$/;

function signature(id: string, issuedAt: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`wss-app-preview:v1:${id}:${issuedAt}`)
    .digest('base64url');
}

function signedCookieValue(id: string, issuedAt: number, secret: string): string {
  return `v1.${id}.${issuedAt}.${signature(id, issuedAt, secret)}`;
}

function cookieValue(header: string | undefined): string | null {
  const prefix = `${APP_PREVIEW_COOKIE_NAME}=`;
  const entry = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry?.slice(prefix.length) || null;
}

export function resolveAppPreviewIdentity(
  cookieHeader: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): { customerRef: string; setCookie: string | null } {
  const match = cookieValue(cookieHeader)?.match(cookiePattern);
  if (match) {
    const [, id, issuedAtText, providedSignature] = match;
    const issuedAt = Number(issuedAtText);
    if (id && providedSignature && Number.isSafeInteger(issuedAt)
      && issuedAt <= now && issuedAt + cookieLifetimeSeconds > now) {
      const expected = Buffer.from(signature(id, issuedAt, secret));
      const provided = Buffer.from(providedSignature);
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
        return { customerRef: `app-preview-${id}`, setCookie: null };
      }
    }
  }

  const id = randomUUID();
  return {
    customerRef: `app-preview-${id}`,
    setCookie: `${APP_PREVIEW_COOKIE_NAME}=${signedCookieValue(id, now, secret)}; Path=/; Max-Age=${cookieLifetimeSeconds}; HttpOnly; Secure; SameSite=Lax`,
  };
}
