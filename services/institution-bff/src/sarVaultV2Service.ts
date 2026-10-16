import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import type { WssSessionClaims } from '@took-wss/contracts';
import {
  decryptPrivateAttribute,
  encryptPrivateAttribute,
  encryptionKeyFromHex,
  koreanPhoneE164,
  phoneLookupHash,
} from './phoneRegistration.js';
import { SupabasePhoneAuthClient } from './supabasePhoneAuth.js';
import { requestBrandedPhoneOtp } from './smsDeliveryContext.js';
import { smsBrandForTenant } from './smsTenantBrand.js';
import { SupabaseEmailAuthClient } from './supabaseEmailAuth.js';

type Session = Omit<WssSessionClaims, 'nonce'>;
type Factor = 'phone' | 'email';
type ShareFactor = 'password' | Factor;
type Pair = 'password-phone' | 'password-email' | 'phone-email';
type Kind = 'mnemonic-entropy' | 'evm-private-key';
type Purpose = 'enroll' | 'unlock';

const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST
  ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 })
  : null;
const walletIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pairFactors: Record<Pair, readonly ShareFactor[]> = {
  'password-phone': ['password', 'phone'],
  'password-email': ['password', 'email'],
  'phone-email': ['phone', 'email'],
};

export class SarVaultV2Error extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SarVaultV2Error('vault_unavailable', 503);
  return value;
}

function database() {
  if (process.env.WSS_DEPLOYMENT_MODE !== 'development-preview' || !sql) {
    throw new SarVaultV2Error('vault_unavailable', 503);
  }
  return sql;
}

function piiKey(): Buffer {
  return encryptionKeyFromHex(required('WSS_PII_ENCRYPTION_KEY'));
}

function shareKey(factor: Factor): Buffer {
  return encryptionKeyFromHex(required(factor === 'phone'
    ? 'WSS_SAR_V2_PHONE_SHARE_KEY' : 'WSS_SAR_V2_EMAIL_SHARE_KEY'));
}

function scopeHash(session: Session): string {
  return createHmac('sha256', required('WSS_OTP_MAC_SECRET'))
    .update(`${session.tenantId}\u0000${session.sessionId}`).digest('hex');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeHashEquals(left: string | null, token: string): boolean {
  const right = tokenHash(token);
  return Boolean(left && left.length === 64 && token.length >= 30
    && timingSafeEqual(Buffer.from(left), Buffer.from(right)));
}

function emailLookupHash(tenantId: string, email: string): Buffer {
  return createHmac('sha256', required('WSS_PHONE_LOOKUP_SECRET'))
    .update(`${tenantId}\u0000vault-email\u0000${email}`).digest();
}

function contactAad(session: Session, walletId: string, factor: Factor): string {
  return `${session.tenantId}:${walletId}:sar-vault-v2:${factor}`;
}

function shareAad(session: Session, walletId: string, factor: Factor): Buffer {
  return Buffer.from(`took-wss:sar-vault-v2:${session.tenantId}:${walletId}:${factor}`, 'utf8');
}

function normalizeContacts(phone: unknown, email: unknown): { phone: string; email: string } {
  const normalizedPhone = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  const normalizedEmail = typeof email === 'string' ? email.normalize('NFC').trim().toLowerCase() : '';
  if (!/^010\d{8}$/.test(normalizedPhone)) throw new SarVaultV2Error('invalid_vault_phone');
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new SarVaultV2Error('invalid_vault_email');
  }
  return { phone: normalizedPhone, email: normalizedEmail };
}

function maskedPhone(phone: string): string { return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`; }
function maskedEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 2) || '*'}***@${domain}`;
}

async function assertBoundary(): Promise<void> {
  const rows = await database()<{ project_name: string; environment: string; sar_storage_mode: string }[]>`
    SELECT project_name, environment, sar_storage_mode
    FROM wss_deployment_metadata WHERE singleton = true
  `;
  if (rows[0]?.project_name !== 'xlot-wss-dev'
    || rows[0].environment !== 'development'
    || rows[0].sar_storage_mode !== 'single-project-encrypted') {
    throw new SarVaultV2Error('development_boundary_mismatch', 503);
  }
}

async function assertOwner(session: Session, walletId: string): Promise<Buffer | null> {
  if (!walletIdPattern.test(walletId)) throw new SarVaultV2Error('invalid_wallet_id');
  const rows = await database()<{ phone_lookup_hash: Buffer | null }[]>`
    SELECT private.phone_lookup_hash
    FROM wss_wallets wallet
    JOIN wss_external_identities identity
      ON identity.tenant_id = wallet.tenant_id
      AND identity.user_profile_id = wallet.user_profile_id
    LEFT JOIN wss_user_private_attributes private
      ON private.tenant_id = wallet.tenant_id
      AND private.user_profile_id = wallet.user_profile_id
    WHERE wallet.tenant_id = ${session.tenantId}
      AND wallet.id = ${walletId}
      AND wallet.key_adapter = 'took-sar'
      AND wallet.status = 'active'
      AND identity.issuer = 'institution-host'
      AND identity.subject_version = ${session.subjectVersion}
      AND identity.subject_hash = ${session.subject}
      AND identity.revoked_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) throw new SarVaultV2Error('wallet_not_found', 404);
  return rows[0].phone_lookup_hash;
}

interface BindingRow {
  state: 'pending' | 'active';
  phone_ciphertext: Buffer;
  email_ciphertext: Buffer;
}

async function binding(session: Session, walletId: string): Promise<BindingRow | null> {
  const rows = await database()<BindingRow[]>`
    SELECT state, phone_ciphertext, email_ciphertext
    FROM wss_dev_sar_v2_bindings
    WHERE tenant_id = ${session.tenantId} AND wallet_id = ${walletId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function decryptContacts(session: Session, walletId: string, row: BindingRow): { phone: string; email: string } {
  const key = piiKey();
  try {
    return {
      phone: decryptPrivateAttribute(row.phone_ciphertext, key, contactAad(session, walletId, 'phone')),
      email: decryptPrivateAttribute(row.email_ciphertext, key, contactAad(session, walletId, 'email')),
    };
  } finally { key.fill(0); }
}

export async function sarVaultV2Status(session: Session, walletId: string) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const existing = await binding(session, walletId);
  if (!existing || existing.state !== 'active') return { enrolled: false, version: 2 } as const;
  const contacts = decryptContacts(session, walletId, existing);
  return {
    enrolled: true, version: 2,
    phoneMasked: maskedPhone(contacts.phone), emailMasked: maskedEmail(contacts.email),
  } as const;
}

interface ChallengeRow extends BindingRow {
  purpose: Purpose;
  factor_pair: Pair | null;
  phone_verified_at: Date | null;
  email_verified_at: Date | null;
  phone_access_token_hash: string | null;
  email_access_token_hash: string | null;
  phone_access_used_at: Date | null;
  email_access_used_at: Date | null;
  enrollment_token_hash: string | null;
  enrollment_used_at: Date | null;
  attempt_count: number;
}

async function challenge(session: Session, walletId: string, challengeId: string): Promise<ChallengeRow> {
  if (!walletIdPattern.test(challengeId)) throw new SarVaultV2Error('invalid_challenge');
  const rows = await database()<ChallengeRow[]>`
    SELECT purpose, factor_pair, phone_ciphertext, email_ciphertext,
      phone_verified_at, email_verified_at, phone_access_token_hash,
      email_access_token_hash, phone_access_used_at, email_access_used_at,
      enrollment_token_hash, enrollment_used_at, attempt_count,
      'active'::text AS state
    FROM wss_dev_sar_v2_challenges
    WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
      AND wallet_id = ${walletId} AND session_id_hash = ${scopeHash(session)}
      AND subject_hash = ${session.subject} AND expires_at > now()
    LIMIT 1
  `;
  if (!rows[0]) throw new SarVaultV2Error('challenge_expired', 404);
  return rows[0];
}

export async function startSarVaultV2Challenge(
  session: Session, walletId: string,
  supplied: { phone?: unknown; email?: unknown; pair?: unknown },
) {
  await assertBoundary();
  const profilePhoneHash = await assertOwner(session, walletId);
  const existing = await binding(session, walletId);
  const purpose: Purpose = existing?.state === 'active' ? 'unlock' : 'enroll';
  const pair = purpose === 'unlock' && typeof supplied.pair === 'string' && supplied.pair in pairFactors
    ? supplied.pair as Pair : null;
  if (purpose === 'unlock' && !pair) throw new SarVaultV2Error('invalid_factor_pair');
  const contacts = purpose === 'unlock'
    ? decryptContacts(session, walletId, existing!)
    : normalizeContacts(supplied.phone, supplied.email);
  if (purpose === 'enroll' && profilePhoneHash) {
    const candidate = phoneLookupHash(session.tenantId, contacts.phone, required('WSS_PHONE_LOOKUP_SECRET'));
    if (candidate.length !== profilePhoneHash.length || !timingSafeEqual(candidate, profilePhoneHash)) {
      throw new SarVaultV2Error('registered_phone_mismatch', 403);
    }
  }
  await database()`
    DELETE FROM wss_dev_sar_v2_challenges
    WHERE tenant_id = ${session.tenantId} AND wallet_id = ${walletId}
      AND expires_at < now() - interval '1 day'
  `;
  const rateRows = await database()<{ recent_count: string; latest: Date | null }[]>`
    SELECT count(*)::text AS recent_count, max(created_at) AS latest
    FROM wss_dev_sar_v2_challenges
    WHERE tenant_id = ${session.tenantId} AND wallet_id = ${walletId}
      AND created_at > now() - interval '1 hour'
  `;
  if (Number(rateRows[0]?.recent_count ?? 0) >= 5
    || (rateRows[0]?.latest && Date.now() - rateRows[0].latest.getTime() < 60_000)) {
    throw new SarVaultV2Error('challenge_rate_limited', 429);
  }
  const challengeId = randomUUID();
  const key = piiKey();
  let phoneCiphertext: Buffer;
  let emailCiphertext: Buffer;
  try {
    phoneCiphertext = encryptPrivateAttribute(contacts.phone, key, contactAad(session, walletId, 'phone'));
    emailCiphertext = encryptPrivateAttribute(contacts.email, key, contactAad(session, walletId, 'email'));
  } finally { key.fill(0); }
  if (purpose === 'enroll' && existing?.state === 'pending') {
    await database()`
      DELETE FROM wss_dev_sar_v2_bindings
      WHERE tenant_id = ${session.tenantId} AND wallet_id = ${walletId} AND state = 'pending'
    `;
  }
  await database()`
    INSERT INTO wss_dev_sar_v2_challenges (
      id, tenant_id, wallet_id, session_id_hash, subject_hash, purpose, factor_pair,
      phone_ciphertext, email_ciphertext, phone_lookup_hash, email_lookup_hash, expires_at
    ) VALUES (
      ${challengeId}, ${session.tenantId}, ${walletId}, ${scopeHash(session)}, ${session.subject},
      ${purpose}, ${pair}, ${phoneCiphertext}, ${emailCiphertext},
      ${phoneLookupHash(session.tenantId, contacts.phone, required('WSS_PHONE_LOOKUP_SECRET'))},
      ${emailLookupHash(session.tenantId, contacts.email)}, now() + interval '10 minutes'
    )
  `;
  try {
    const authUrl = required('SUPABASE_URL');
    const anonKey = required('SUPABASE_ANON_KEY');
    if (purpose === 'enroll' || pair?.includes('phone')) {
      await requestBrandedPhoneOtp(
        database(),
        new SupabasePhoneAuthClient(authUrl, anonKey),
        koreanPhoneE164(contacts.phone),
        smsBrandForTenant(session.tenantId),
        required('WSS_PHONE_LOOKUP_SECRET'),
      );
    }
    if (purpose === 'enroll' || pair?.includes('email')) {
      await new SupabaseEmailAuthClient(authUrl, anonKey).requestOtp(contacts.email);
    }
  } catch (error) {
    await database()`DELETE FROM wss_dev_sar_v2_challenges WHERE id = ${challengeId}`;
    throw error;
  }
  return {
    challengeId, purpose, pair,
    phoneMasked: maskedPhone(contacts.phone), emailMasked: maskedEmail(contacts.email),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

export async function verifySarVaultV2Factor(
  session: Session, walletId: string, challengeId: string,
  factor: Factor, code: string,
) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const current = await challenge(session, walletId, challengeId);
  if (current.attempt_count >= 5) throw new SarVaultV2Error('challenge_blocked', 429);
  if (factor !== 'phone' && factor !== 'email') throw new SarVaultV2Error('invalid_factor');
  if (current.purpose === 'unlock' && !pairFactors[current.factor_pair!].includes(factor)) {
    throw new SarVaultV2Error('factor_not_selected');
  }
  if (!/^\d{6}$/.test(code)) throw new SarVaultV2Error('invalid_code');
  if (factor === 'phone' ? current.phone_verified_at : current.email_verified_at) {
    throw new SarVaultV2Error('factor_already_verified');
  }
  const contacts = decryptContacts(session, walletId, current);
  try {
    const authUrl = required('SUPABASE_URL');
    const anonKey = required('SUPABASE_ANON_KEY');
    if (factor === 'phone') {
      const client = new SupabasePhoneAuthClient(authUrl, anonKey);
      const verified = await client.verifyOtp(koreanPhoneE164(contacts.phone), code);
      await client.revoke(verified.accessToken);
      if (verified.phone !== contacts.phone) throw new SarVaultV2Error('verified_phone_mismatch', 403);
    } else {
      await new SupabaseEmailAuthClient(authUrl, anonKey).verifyOtp(contacts.email, code);
    }
  } catch (error) {
    await database()`
      UPDATE wss_dev_sar_v2_challenges SET attempt_count = attempt_count + 1
      WHERE id = ${challengeId} AND attempt_count < 5
    `;
    throw error;
  }
  const factorAccessToken = randomBytes(32).toString('base64url');
  const enrollmentToken = randomBytes(32).toString('base64url');
  const result = factor === 'phone'
    ? await database()<{ phone_verified_at: Date | null; email_verified_at: Date | null }[]>`
      UPDATE wss_dev_sar_v2_challenges
      SET phone_verified_at = now(), phone_access_token_hash = ${tokenHash(factorAccessToken)},
        enrollment_token_hash = CASE WHEN purpose = 'enroll' AND email_verified_at IS NOT NULL
          THEN ${tokenHash(enrollmentToken)} ELSE enrollment_token_hash END
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
        AND wallet_id = ${walletId} AND session_id_hash = ${scopeHash(session)}
        AND subject_hash = ${session.subject} AND expires_at > now()
        AND phone_verified_at IS NULL
      RETURNING phone_verified_at, email_verified_at
    `
    : await database()<{ phone_verified_at: Date | null; email_verified_at: Date | null }[]>`
      UPDATE wss_dev_sar_v2_challenges
      SET email_verified_at = now(), email_access_token_hash = ${tokenHash(factorAccessToken)},
        enrollment_token_hash = CASE WHEN purpose = 'enroll' AND phone_verified_at IS NOT NULL
          THEN ${tokenHash(enrollmentToken)} ELSE enrollment_token_hash END
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
        AND wallet_id = ${walletId} AND session_id_hash = ${scopeHash(session)}
        AND subject_hash = ${session.subject} AND expires_at > now()
        AND email_verified_at IS NULL
      RETURNING phone_verified_at, email_verified_at
    `;
  const row = result[0];
  if (!row) throw new SarVaultV2Error('challenge_expired', 404);
  return {
    phoneVerified: Boolean(row.phone_verified_at),
    emailVerified: Boolean(row.email_verified_at),
    factorAccessToken,
    ...(current.purpose === 'enroll' && row.phone_verified_at && row.email_verified_at
      ? { enrollmentToken } : {}),
  };
}

function validPasswordEnvelope(value: unknown, session: Session, walletId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return envelope.version === 2 && envelope.factor === 'password'
    && envelope.kdf === 'PBKDF2-SHA256' && envelope.iterations === 600000
    && envelope.aad === `took-wss:sar-vault-v2:${session.tenantId}:${walletId}:password`
    && typeof envelope.saltBase64 === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(envelope.saltBase64)
    && typeof envelope.ivBase64 === 'string' && /^[A-Za-z0-9+/]{16}$/.test(envelope.ivBase64)
    && typeof envelope.ciphertextBase64 === 'string'
    && envelope.ciphertextBase64.length >= 48 && envelope.ciphertextBase64.length <= 200
    && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertextBase64);
}

function decodePlainShare(value: unknown, expected: Factor): { kind: Kind; bytes: Buffer } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SarVaultV2Error('invalid_vault_share');
  }
  const share = value as Record<string, unknown>;
  if (share.version !== 2 || share.factor !== expected
    || (share.kind !== 'mnemonic-entropy' && share.kind !== 'evm-private-key')
    || typeof share.shareBase64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(share.shareBase64)) {
    throw new SarVaultV2Error('invalid_vault_share');
  }
  const bytes = Buffer.from(share.shareBase64, 'base64');
  if (bytes.toString('base64') !== share.shareBase64
    || (share.kind === 'evm-private-key' ? bytes.length !== 33 : ![17, 21, 25, 29, 33].includes(bytes.length))) {
    bytes.fill(0);
    throw new SarVaultV2Error('invalid_vault_share');
  }
  return { kind: share.kind, bytes };
}

function sealFactorShare(session: Session, walletId: string, factor: Factor, share: Buffer): Buffer {
  const key = shareKey(factor);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(shareAad(session, walletId, factor));
    const ciphertext = Buffer.concat([cipher.update(share), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  } finally { key.fill(0); iv.fill(0); }
}

function openFactorShare(session: Session, walletId: string, factor: Factor, sealed: Buffer): Buffer {
  if (sealed.length < 45 || sealed.length > 61) throw new SarVaultV2Error('vault_shares_invalid', 503);
  const key = shareKey(factor);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
    decipher.setAAD(shareAad(session, walletId, factor));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  } catch {
    throw new SarVaultV2Error('vault_shares_invalid', 503);
  } finally { key.fill(0); }
}

export async function storeSarVaultV2Share(
  session: Session, walletId: string, challengeId: string,
  enrollmentToken: string, factor: ShareFactor, value: unknown,
) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const current = await challenge(session, walletId, challengeId);
  if (current.purpose !== 'enroll' || !current.phone_verified_at || !current.email_verified_at
    || current.enrollment_used_at || !safeHashEquals(current.enrollment_token_hash, enrollmentToken)) {
    throw new SarVaultV2Error('vault_authorization_required', 403);
  }
  if (factor === 'password') {
    if (!validPasswordEnvelope(value, session, walletId)) throw new SarVaultV2Error('invalid_vault_envelope');
    await database()`
      INSERT INTO wss_dev_sar_v2_bindings (
        tenant_id, wallet_id, state, phone_ciphertext, email_ciphertext,
        phone_lookup_hash, email_lookup_hash, password_envelope
      ) SELECT tenant_id, wallet_id, 'pending', phone_ciphertext, email_ciphertext,
        phone_lookup_hash, email_lookup_hash, ${database().json(value as {
          version: number; factor: string; kdf: string; iterations: number;
          saltBase64: string; ivBase64: string; ciphertextBase64: string; aad: string;
        })}
        FROM wss_dev_sar_v2_challenges WHERE id = ${challengeId}
      ON CONFLICT (tenant_id, wallet_id) DO UPDATE
        SET password_envelope = EXCLUDED.password_envelope
      WHERE wss_dev_sar_v2_bindings.state = 'pending'
    `;
  } else if (factor === 'phone' || factor === 'email') {
    const existing = await binding(session, walletId);
    if (existing?.state !== 'pending') throw new SarVaultV2Error('vault_enrollment_incomplete', 409);
    const share = decodePlainShare(value, factor);
    try {
      const sealed = sealFactorShare(session, walletId, factor, share.bytes);
      if (factor === 'phone') {
        await database()`
          INSERT INTO wss_dev_sar_v2_share_phone (tenant_id, wallet_id, kind, ciphertext)
          VALUES (${session.tenantId}, ${walletId}, ${share.kind}, ${sealed})
          ON CONFLICT (tenant_id, wallet_id) DO UPDATE
            SET kind = EXCLUDED.kind, ciphertext = EXCLUDED.ciphertext
        `;
      } else {
        await database()`
          INSERT INTO wss_dev_sar_v2_share_email (tenant_id, wallet_id, kind, ciphertext)
          VALUES (${session.tenantId}, ${walletId}, ${share.kind}, ${sealed})
          ON CONFLICT (tenant_id, wallet_id) DO UPDATE
            SET kind = EXCLUDED.kind, ciphertext = EXCLUDED.ciphertext
        `;
      }
      sealed.fill(0);
    } finally { share.bytes.fill(0); }
  } else {
    throw new SarVaultV2Error('invalid_factor');
  }
  const complete = await database()<{ wallet_id: string }[]>`
    UPDATE wss_dev_sar_v2_bindings binding SET state = 'active', activated_at = now()
    WHERE binding.tenant_id = ${session.tenantId} AND binding.wallet_id = ${walletId}
      AND binding.state = 'pending' AND binding.password_envelope IS NOT NULL
      AND EXISTS (SELECT 1 FROM wss_dev_sar_v2_share_phone phone
        WHERE phone.tenant_id = binding.tenant_id AND phone.wallet_id = binding.wallet_id)
      AND EXISTS (SELECT 1 FROM wss_dev_sar_v2_share_email email
        WHERE email.tenant_id = binding.tenant_id AND email.wallet_id = binding.wallet_id)
      AND (SELECT phone.kind FROM wss_dev_sar_v2_share_phone phone
        WHERE phone.tenant_id = binding.tenant_id AND phone.wallet_id = binding.wallet_id)
        = (SELECT email.kind FROM wss_dev_sar_v2_share_email email
        WHERE email.tenant_id = binding.tenant_id AND email.wallet_id = binding.wallet_id)
    RETURNING wallet_id
  `;
  if (complete.length) {
    await database()`
      UPDATE wss_dev_sar_v2_challenges SET enrollment_used_at = now()
      WHERE id = ${challengeId} AND enrollment_used_at IS NULL
    `;
  }
  return { enrolled: complete.length === 1 };
}

export async function loadSarVaultV2PasswordShare(session: Session, walletId: string) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const rows = await database()<{ password_envelope: unknown }[]>`
    SELECT password_envelope FROM wss_dev_sar_v2_bindings
    WHERE tenant_id = ${session.tenantId} AND wallet_id = ${walletId} AND state = 'active'
    LIMIT 1
  `;
  if (!rows[0]?.password_envelope) throw new SarVaultV2Error('vault_shares_missing', 404);
  return { envelope: rows[0].password_envelope };
}

export async function loadSarVaultV2FactorShare(
  session: Session, walletId: string, challengeId: string,
  factor: Factor, factorAccessToken: string,
) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const current = await challenge(session, walletId, challengeId);
  if (current.purpose !== 'unlock' || !current.factor_pair
    || !pairFactors[current.factor_pair].includes(factor)
    || !(factor === 'phone' ? current.phone_verified_at : current.email_verified_at)
    || (factor === 'phone' ? current.phone_access_used_at : current.email_access_used_at)
    || !safeHashEquals(factor === 'phone'
      ? current.phone_access_token_hash : current.email_access_token_hash, factorAccessToken)) {
    throw new SarVaultV2Error('vault_authorization_required', 403);
  }
  const used = factor === 'phone'
    ? await database()<{ id: string }[]>`
      UPDATE wss_dev_sar_v2_challenges SET phone_access_used_at = now()
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
        AND session_id_hash = ${scopeHash(session)} AND subject_hash = ${session.subject}
        AND phone_access_token_hash = ${tokenHash(factorAccessToken)}
        AND phone_access_used_at IS NULL AND expires_at > now()
      RETURNING id
    `
    : await database()<{ id: string }[]>`
      UPDATE wss_dev_sar_v2_challenges SET email_access_used_at = now()
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
        AND session_id_hash = ${scopeHash(session)} AND subject_hash = ${session.subject}
        AND email_access_token_hash = ${tokenHash(factorAccessToken)}
        AND email_access_used_at IS NULL AND expires_at > now()
      RETURNING id
    `;
  if (used.length !== 1) throw new SarVaultV2Error('vault_authorization_required', 403);
  const rows = factor === 'phone'
    ? await database()<{ kind: Kind; ciphertext: Buffer }[]>`
      SELECT share.kind, share.ciphertext FROM wss_dev_sar_v2_share_phone share
      JOIN wss_dev_sar_v2_bindings binding
        ON binding.tenant_id = share.tenant_id AND binding.wallet_id = share.wallet_id
      WHERE share.tenant_id = ${session.tenantId} AND share.wallet_id = ${walletId}
        AND binding.state = 'active' LIMIT 1
    `
    : await database()<{ kind: Kind; ciphertext: Buffer }[]>`
      SELECT share.kind, share.ciphertext FROM wss_dev_sar_v2_share_email share
      JOIN wss_dev_sar_v2_bindings binding
        ON binding.tenant_id = share.tenant_id AND binding.wallet_id = share.wallet_id
      WHERE share.tenant_id = ${session.tenantId} AND share.wallet_id = ${walletId}
        AND binding.state = 'active' LIMIT 1
    `;
  if (!rows[0]) throw new SarVaultV2Error('vault_shares_missing', 404);
  const opened = openFactorShare(session, walletId, factor, rows[0].ciphertext);
  try {
    if (rows[0].kind === 'evm-private-key' ? opened.length !== 33 : ![17, 21, 25, 29, 33].includes(opened.length)) {
      throw new SarVaultV2Error('vault_shares_invalid', 503);
    }
    return { version: 2 as const, factor, kind: rows[0].kind, shareBase64: opened.toString('base64') };
  } finally { opened.fill(0); }
}
