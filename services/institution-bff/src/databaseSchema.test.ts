import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'pgsql-ast-parser';

const migrationUrl = new URL('../db/migrations/0001_wss_identity.sql', import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const developmentSarMigrationUrl = new URL('../db/migrations/0002_wss_development_sar.sql', import.meta.url);
const developmentSarMigration = readFileSync(developmentSarMigrationUrl, 'utf8');
const phoneRegistrationMigrationUrl = new URL('../db/migrations/0003_wss_phone_registration.sql', import.meta.url);
const phoneRegistrationMigration = readFileSync(phoneRegistrationMigrationUrl, 'utf8');
const supabasePhoneAuthMigrationUrl = new URL('../db/migrations/0004_wss_supabase_phone_auth.sql', import.meta.url);
const supabasePhoneAuthMigration = readFileSync(supabasePhoneAuthMigrationUrl, 'utf8');

describe('WSS identity migration', () => {
  it('parses as PostgreSQL and contains the required identity boundaries', () => {
    const statements = parse(migration);
    expect(statements.length).toBeGreaterThan(10);
    expect(migration).toContain('CREATE TABLE wss_user_profiles');
    expect(migration).toContain('CREATE TABLE wss_external_identities');
    expect(migration).toContain('CREATE TABLE wss_wallets');
    expect(migration).toContain('CREATE TABLE wss_sar_recovery_profiles');
    expect(migration).toContain('CREATE TABLE wss_key_policy_versions');
    expect(migration).toContain('CREATE TABLE wss_wallet_migrations');
    expect(migration).toContain('provisioning_idempotency_key text NOT NULL');
    expect(migration).toContain('address_group_id text NOT NULL');
    expect(migration).toContain("'single-project-development'");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE');
  });

  it('does not define storage columns for key material or plaintext OTP values', () => {
    const ddlWithoutComments = migration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(private_key|mnemonic|seed_phrase|sar_share|otp_code|otp_plaintext)\b/i);
    expect(ddlWithoutComments).toContain('otp_mac bytea NOT NULL');
  });
});

describe('WSS development SAR migration', () => {
  it('parses as PostgreSQL and marks the database as a development-only ciphertext store', () => {
    // pgsql-ast-parser does not implement PostgreSQL's ENABLE ROW LEVEL SECURITY
    // clause. Keep asserting the clauses below, and parse the remaining DDL.
    const parseableMigration = developmentSarMigration
      .replace(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm, '')
      .replace(/^REVOKE ALL ON TABLE .*;$/gm, '');
    const statements = parse(parseableMigration);
    expect(statements.length).toBeGreaterThan(5);
    expect(developmentSarMigration).toContain('CREATE TABLE wss_deployment_metadata');
    expect(developmentSarMigration).toContain("'xlot-wss-dev'");
    expect(developmentSarMigration).toContain("'proposal-and-early-function-sandbox'");
    expect(developmentSarMigration).toContain("'single-project-encrypted'");
    expect(developmentSarMigration).toContain('CREATE TABLE wss_dev_sar_envelopes');
    expect(developmentSarMigration).toContain("algorithm = 'AES-256-GCM'");
    expect(developmentSarMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(developmentSarMigration).toContain('REVOKE ALL ON TABLE');
  });

  it('never defines server-side recovery plaintext or decryption-key columns', () => {
    const ddlWithoutComments = developmentSarMigration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(mnemonic|seed_phrase|private_key|plaintext_share|vault_key|wrapping_key|decryption_key)\b/i);
    expect(ddlWithoutComments).toContain('ciphertext_base64 text NOT NULL');
  });
});

describe('WSS phone registration migration', () => {
  it('binds registration intents to an institution session without plaintext identifiers', () => {
    const parseableMigration = phoneRegistrationMigration
      .replace(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm, '')
      .replace(/^REVOKE ALL ON TABLE .*;$/gm, '');
    expect(parse(parseableMigration).length).toBeGreaterThan(4);
    expect(phoneRegistrationMigration).toContain('CREATE TABLE wss_registration_session_bindings');
    expect(phoneRegistrationMigration).toContain('institution_subject_hash text NOT NULL');
    expect(phoneRegistrationMigration).toContain('session_id_hash text NOT NULL');
    expect(phoneRegistrationMigration).toContain("delivery_channel = 'sms'");
    expect(phoneRegistrationMigration).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('never adds raw customer, phone, or OTP columns', () => {
    const ddlWithoutComments = phoneRegistrationMigration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(customer_ref|phone_plaintext|otp_code|otp_plaintext)\b/i);
  });
});

describe('WSS Supabase phone Auth migration', () => {
  it('separates Auth-owned OTP verification from the legacy development MAC', () => {
    expect(parse(supabasePhoneAuthMigration).length).toBeGreaterThan(3);
    expect(supabasePhoneAuthMigration).toContain("verification_provider IN ('wss-mac', 'supabase-auth')");
    expect(supabasePhoneAuthMigration).toContain("verification_provider = 'supabase-auth' AND otp_mac IS NULL");
    expect(supabasePhoneAuthMigration).toContain('provider_subject_hash text');
  });

  it('does not add an OTP plaintext column', () => {
    const ddlWithoutComments = supabasePhoneAuthMigration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(otp_code|otp_plaintext|verified_phone)\b/i);
  });
});
