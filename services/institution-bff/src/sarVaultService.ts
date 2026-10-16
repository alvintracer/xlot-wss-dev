import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
type Purpose = 'enroll' | 'unlock';

export interface EncryptedShareEnvelope {
  version: 1;
  factorIndex: 2 | 3;
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  aad: string;
}

export class SarVaultError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST
  ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 })
  : null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SarVaultError('vault_unavailable', 503);
  return value;
}

function database() {
  if (process.env.WSS_DEPLOYMENT_MODE !== 'development-preview' || !sql) {
    throw new SarVaultError('vault_unavailable', 503);
  }
  return sql;
}

function piiKey(): Buffer {
  return encryptionKeyFromHex(required('WSS_PII_ENCRYPTION_KEY'));
}

function scopeHash(session: Session): string {
  return createHmac('sha256', required('WSS_OTP_MAC_SECRET'))
    .update(`${session.tenantId}\u0000${session.sessionId}`).digest('hex');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function emailLookupHash(tenantId: string, email: string): Buffer {
  return createHmac('sha256', required('WSS_PHONE_LOOKUP_SECRET'))
    .update(`${tenantId}\u0000vault-email\u0000${email}`).digest();
}

function contactAad(session: Session, walletId: string, factor: Factor): string {
  return `${session.tenantId}:${walletId}:sar-vault:${factor}`;
}

function normalizeContacts(phone: unknown, email: unknown): { phone: string; email: string } {
  const normalizedPhone = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  const normalizedEmail = typeof email === 'string' ? email.normalize('NFC').trim().toLowerCase() : '';
  if (!/^010\d{8}$/.test(normalizedPhone)) throw new SarVaultError('invalid_vault_phone');
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new SarVaultError('invalid_vault_email');
  }
  return { phone: normalizedPhone, email: normalizedEmail };
}

function maskedPhone(phone: string): string {
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}

function maskedEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 2) || '*'}***@${domain}`;
}

async function assertOwner(session: Session, walletId: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(walletId)) {
    throw new SarVaultError('invalid_wallet_id');
  }
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
  if (!rows[0]) throw new SarVaultError('wallet_not_found', 404);
  return rows[0].phone_lookup_hash;
}

async function assertBoundary(): Promise<void> {
  const rows = await database()<{ project_name: string; environment: string; sar_storage_mode: string }[]>`
    SELECT project_name, environment, sar_storage_mode
    FROM wss_deployment_metadata WHERE singleton = true
  `;
  if (rows[0]?.project_name !== 'xlot-wss-dev'
    || rows[0].environment !== 'development'
    || rows[0].sar_storage_mode !== 'single-project-encrypted') {
    throw new SarVaultError('development_boundary_mismatch', 503);
  }
}

interface BindingRow {
  phone_ciphertext: Buffer;
  email_ciphertext: Buffer;
}

async function binding(session: Session, walletId: string): Promise<BindingRow | null> {
  const rows = await database()<BindingRow[]>`
    SELECT binding.phone_ciphertext, binding.email_ciphertext
    FROM wss_dev_sar_vault_bindings binding
    JOIN wss_dev_sar_share_b share_b
      ON share_b.tenant_id = binding.tenant_id AND share_b.wallet_id = binding.wallet_id
    JOIN wss_dev_sar_share_c share_c
      ON share_c.tenant_id = binding.tenant_id AND share_c.wallet_id = binding.wallet_id
    WHERE binding.tenant_id = ${session.tenantId} AND binding.wallet_id = ${walletId}
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
  } finally {
    key.fill(0);
  }
}

export async function sarVaultStatus(session: Session, walletId: string) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const existing = await binding(session, walletId);
  if (!existing) return { enrolled: false } as const;
  const contacts = decryptContacts(session, walletId, existing);
  return { enrolled: true, phoneMasked: maskedPhone(contacts.phone), emailMasked: maskedEmail(contacts.email) } as const;
}

export async function startSarVaultChallenge(
  session: Session,
  walletId: string,
  supplied: { phone?: unknown; email?: unknown },
) {
  await assertBoundary();
  const profilePhoneHash = await assertOwner(session, walletId);
  const existing = await binding(session, walletId);
  const purpose: Purpose = existing ? 'unlock' : 'enroll';
  const contacts = existing
    ? decryptContacts(session, walletId, existing)
    : normalizeContacts(supplied.phone, supplied.email);
  if (!existing && profilePhoneHash) {
    const candidate = phoneLookupHash(session.tenantId, contacts.phone, required('WSS_PHONE_LOOKUP_SECRET'));
    if (candidate.length !== profilePhoneHash.length || !timingSafeEqual(candidate, profilePhoneHash)) {
      throw new SarVaultError('registered_phone_mismatch', 403);
    }
  }
  await database()`
    DELETE FROM wss_dev_sar_vault_challenges
    WHERE tenant_id = ${session.tenantId} AND wallet_id = ${walletId}
      AND expires_at < now() - interval '1 day'
  `;
  const rateRows = await database()<{ recent_count: string; latest: Date | null }[]>`
    SELECT count(*)::text AS recent_count, max(created_at) AS latest
    FROM wss_dev_sar_vault_challenges
    WHERE tenant_id = ${session.tenantId}
      AND wallet_id = ${walletId}
      AND created_at > now() - interval '1 hour'
  `;
  if (Number(rateRows[0]?.recent_count ?? 0) >= 5
    || (rateRows[0]?.latest && Date.now() - rateRows[0].latest.getTime() < 60_000)) {
    throw new SarVaultError('challenge_rate_limited', 429);
  }
  const challengeId = randomUUID();
  const key = piiKey();
  const phoneCiphertext = encryptPrivateAttribute(contacts.phone, key, contactAad(session, walletId, 'phone'));
  const emailCiphertext = encryptPrivateAttribute(contacts.email, key, contactAad(session, walletId, 'email'));
  key.fill(0);
  await database()`
    INSERT INTO wss_dev_sar_vault_challenges (
      id, tenant_id, wallet_id, session_id_hash, subject_hash, purpose,
      phone_ciphertext, email_ciphertext, phone_lookup_hash, email_lookup_hash, expires_at
    ) VALUES (
      ${challengeId}, ${session.tenantId}, ${walletId}, ${scopeHash(session)}, ${session.subject}, ${purpose},
      ${phoneCiphertext}, ${emailCiphertext},
      ${phoneLookupHash(session.tenantId, contacts.phone, required('WSS_PHONE_LOOKUP_SECRET'))},
      ${emailLookupHash(session.tenantId, contacts.email)}, now() + interval '10 minutes'
    )
  `;
  try {
    const authUrl = required('SUPABASE_URL');
    const anonKey = required('SUPABASE_ANON_KEY');
    await requestBrandedPhoneOtp(
      database(),
      new SupabasePhoneAuthClient(authUrl, anonKey),
      koreanPhoneE164(contacts.phone),
      smsBrandForTenant(session.tenantId),
      required('WSS_PHONE_LOOKUP_SECRET'),
    );
    await new SupabaseEmailAuthClient(authUrl, anonKey).requestOtp(contacts.email);
  } catch (error) {
    await database()`DELETE FROM wss_dev_sar_vault_challenges WHERE id = ${challengeId}`;
    throw error;
  }
  return {
    challengeId,
    purpose,
    phoneMasked: maskedPhone(contacts.phone),
    emailMasked: maskedEmail(contacts.email),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

interface ChallengeRow extends BindingRow {
  purpose: Purpose;
  phone_verified_at: Date | null;
  email_verified_at: Date | null;
  access_token_hash: string | null;
  attempt_count: number;
}

async function challenge(session: Session, walletId: string, challengeId: string): Promise<ChallengeRow> {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new SarVaultError('invalid_challenge');
  const rows = await database()<ChallengeRow[]>`
    SELECT purpose, phone_ciphertext, email_ciphertext, phone_verified_at,
      email_verified_at, access_token_hash, attempt_count
    FROM wss_dev_sar_vault_challenges
    WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
      AND wallet_id = ${walletId}
      AND session_id_hash = ${scopeHash(session)}
      AND subject_hash = ${session.subject} AND expires_at > now()
      AND access_token_used_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) throw new SarVaultError('challenge_expired', 404);
  return rows[0];
}

export async function verifySarVaultFactor(
  session: Session,
  walletId: string,
  challengeId: string,
  factor: Factor,
  code: string,
) {
  await assertBoundary();
  await assertOwner(session, walletId);
  const current = await challenge(session, walletId, challengeId);
  if (current.attempt_count >= 5) throw new SarVaultError('challenge_blocked', 429);
  if (factor !== 'phone' && factor !== 'email') throw new SarVaultError('invalid_factor');
  if (!/^\d{6}$/.test(code)) throw new SarVaultError('invalid_code');
  if (factor === 'phone' && current.phone_verified_at || factor === 'email' && current.email_verified_at) {
    throw new SarVaultError('factor_already_verified');
  }
  const contacts = decryptContacts(session, walletId, current);
  try {
    const authUrl = required('SUPABASE_URL');
    const anonKey = required('SUPABASE_ANON_KEY');
    if (factor === 'phone') {
      const client = new SupabasePhoneAuthClient(authUrl, anonKey);
      const verified = await client.verifyOtp(koreanPhoneE164(contacts.phone), code);
      await client.revoke(verified.accessToken);
      if (verified.phone !== contacts.phone) throw new SarVaultError('verified_phone_mismatch', 403);
    } else {
      await new SupabaseEmailAuthClient(authUrl, anonKey).verifyOtp(contacts.email, code);
    }
  } catch (error) {
    await database()`
      UPDATE wss_dev_sar_vault_challenges SET attempt_count = attempt_count + 1
      WHERE id = ${challengeId} AND attempt_count < 5
    `;
    throw error;
  }
  const token = randomBytes(32).toString('base64url');
  const updated = await database()<{ phone_verified_at: Date | null; email_verified_at: Date | null }[]>`
    UPDATE wss_dev_sar_vault_challenges
    SET phone_verified_at = CASE WHEN ${factor === 'phone'} THEN now() ELSE phone_verified_at END,
      email_verified_at = CASE WHEN ${factor === 'email'} THEN now() ELSE email_verified_at END,
      access_token_hash = CASE WHEN ${factor === 'phone'}
        THEN CASE WHEN email_verified_at IS NOT NULL THEN ${tokenHash(token)} ELSE access_token_hash END
        ELSE CASE WHEN phone_verified_at IS NOT NULL THEN ${tokenHash(token)} ELSE access_token_hash END
      END
    WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
      AND wallet_id = ${walletId} AND session_id_hash = ${scopeHash(session)}
      AND subject_hash = ${session.subject} AND expires_at > now()
    RETURNING phone_verified_at, email_verified_at
  `;
  const row = updated[0];
  if (!row) throw new SarVaultError('challenge_expired', 404);
  return {
    phoneVerified: Boolean(row.phone_verified_at),
    emailVerified: Boolean(row.email_verified_at),
    ...(row.phone_verified_at && row.email_verified_at ? { accessToken: token, purpose: current.purpose } : {}),
  };
}

function validShareEnvelope(value: unknown, tenantId: string, walletId: string, factorIndex: 2 | 3): value is EncryptedShareEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return envelope.version === 1
    && envelope.factorIndex === factorIndex
    && envelope.kdf === 'PBKDF2-SHA256'
    && envelope.iterations === 600000
    && envelope.aad === `took-wss:sar-vault-v1:${tenantId}:${walletId}:factor-${factorIndex}`
    && typeof envelope.saltBase64 === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(envelope.saltBase64)
    && typeof envelope.ivBase64 === 'string' && /^[A-Za-z0-9+/]{16}$/.test(envelope.ivBase64)
    && typeof envelope.ciphertextBase64 === 'string'
    && envelope.ciphertextBase64.length >= 32 && envelope.ciphertextBase64.length <= 512
    && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertextBase64);
}

async function authorizedChallenge(session: Session, walletId: string, challengeId: string, accessToken: string, purpose: Purpose) {
  const current = await challenge(session, walletId, challengeId);
  if (current.purpose !== purpose || !current.phone_verified_at || !current.email_verified_at
    || !current.access_token_hash || accessToken.length < 30
    || current.access_token_hash.length !== 64
    || !timingSafeEqual(Buffer.from(current.access_token_hash), Buffer.from(tokenHash(accessToken)))) {
    throw new SarVaultError('vault_authorization_required', 403);
  }
  return current;
}

export async function storeSarVaultShares(
  session: Session,
  walletId: string,
  challengeId: string,
  accessToken: string,
  shareB: unknown,
  shareC: unknown,
): Promise<void> {
  await assertBoundary();
  await assertOwner(session, walletId);
  await authorizedChallenge(session, walletId, challengeId, accessToken, 'enroll');
  if (!validShareEnvelope(shareB, session.tenantId, walletId, 2)
    || !validShareEnvelope(shareC, session.tenantId, walletId, 3)
    || shareB.saltBase64 !== shareC.saltBase64) throw new SarVaultError('invalid_vault_envelope');
  await database().begin(async (transaction) => {
    const used = await transaction`
      UPDATE wss_dev_sar_vault_challenges SET access_token_used_at = now()
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
        AND session_id_hash = ${scopeHash(session)} AND subject_hash = ${session.subject}
        AND access_token_hash = ${tokenHash(accessToken)}
        AND access_token_used_at IS NULL AND expires_at > now()
      RETURNING id
    `;
    if (used.length !== 1) throw new SarVaultError('vault_authorization_required', 403);
    const bindingAdded = await transaction`
      INSERT INTO wss_dev_sar_vault_bindings (
        tenant_id, wallet_id, phone_ciphertext, email_ciphertext, phone_lookup_hash, email_lookup_hash
      ) SELECT tenant_id, wallet_id, phone_ciphertext, email_ciphertext, phone_lookup_hash, email_lookup_hash
        FROM wss_dev_sar_vault_challenges WHERE id = ${challengeId}
      ON CONFLICT (tenant_id, wallet_id) DO NOTHING
      RETURNING wallet_id
    `;
    if (bindingAdded.length !== 1) throw new SarVaultError('vault_already_enrolled', 409);
    await transaction`
      INSERT INTO wss_dev_sar_share_b (tenant_id, wallet_id, encrypted_envelope)
      VALUES (${session.tenantId}, ${walletId}, ${transaction.json({ ...shareB })})
    `;
    await transaction`
      INSERT INTO wss_dev_sar_share_c (tenant_id, wallet_id, encrypted_envelope)
      VALUES (${session.tenantId}, ${walletId}, ${transaction.json({ ...shareC })})
    `;
  });
}

export async function loadSarVaultShares(
  session: Session,
  walletId: string,
  challengeId: string,
  accessToken: string,
): Promise<{ shareB: EncryptedShareEnvelope; shareC: EncryptedShareEnvelope }> {
  await assertBoundary();
  await assertOwner(session, walletId);
  await authorizedChallenge(session, walletId, challengeId, accessToken, 'unlock');
  return database().begin(async (transaction) => {
    const used = await transaction`
      UPDATE wss_dev_sar_vault_challenges SET access_token_used_at = now()
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId}
        AND session_id_hash = ${scopeHash(session)} AND subject_hash = ${session.subject}
        AND access_token_hash = ${tokenHash(accessToken)}
        AND access_token_used_at IS NULL AND expires_at > now()
      RETURNING id
    `;
    if (used.length !== 1) throw new SarVaultError('vault_authorization_required', 403);
    const rows = await transaction<{ share_b: EncryptedShareEnvelope; share_c: EncryptedShareEnvelope }[]>`
      SELECT share_b.encrypted_envelope AS share_b, share_c.encrypted_envelope AS share_c
      FROM wss_dev_sar_share_b share_b
      JOIN wss_dev_sar_share_c share_c
        ON share_c.tenant_id = share_b.tenant_id AND share_c.wallet_id = share_b.wallet_id
      WHERE share_b.tenant_id = ${session.tenantId} AND share_b.wallet_id = ${walletId}
      LIMIT 1
    `;
    if (!rows[0]) throw new SarVaultError('vault_shares_missing', 404);
    return { shareB: rows[0].share_b, shareC: rows[0].share_c };
  });
}
