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
const phoneEscrowMigrationUrl = new URL('../db/migrations/0007_wss_phone_escrow.sql', import.meta.url);
const supabasePhoneAuthMigration = readFileSync(supabasePhoneAuthMigrationUrl, 'utf8');
const phoneEscrowMigration = readFileSync(phoneEscrowMigrationUrl, 'utf8');
const phoneSmsRetryMigration = readFileSync(new URL('../db/migrations/0022_wss_phone_sms_retry.sql', import.meta.url), 'utf8');
const phoneClaimReconciliationMigration = readFileSync(new URL('../db/migrations/0023_wss_phone_claim_reconciliation.sql', import.meta.url), 'utf8');
const exchangeMigrationUrl = new URL('../db/migrations/0008_wss_exchange_lifecycle.sql', import.meta.url);
const exchangeMigration = readFileSync(exchangeMigrationUrl, 'utf8');
const walletHostProofMigrationUrl = new URL('../db/migrations/0005_wss_wallet_host_proofs.sql', import.meta.url);
const walletHostProofMigration = readFileSync(walletHostProofMigrationUrl, 'utf8');
const nonexclusiveAddressMigration = readFileSync(new URL('../db/migrations/0009_wss_nonexclusive_wallet_addresses.sql', import.meta.url), 'utf8');
const sarVaultMigration = readFileSync(new URL('../db/migrations/0011_wss_sar_vault_factors.sql', import.meta.url), 'utf8');
const walletRemovalMigration = readFileSync(new URL('../db/migrations/0019_wss_wallet_removal.sql', import.meta.url), 'utf8');
const qrPaymentMigration = readFileSync(new URL('../db/migrations/0024_wss_qr_payments.sql', import.meta.url), 'utf8');
const qrPaymentReferenceMigration = readFileSync(new URL('../db/migrations/0025_wss_qr_payment_reference_price.sql', import.meta.url), 'utf8');

describe('WSS QR payment migration', () => {
  it('stores opaque requests and links each to at most one signed transfer', () => {
    expect(qrPaymentMigration).toContain('CREATE TABLE wss_qr_payment_requests');
    expect(qrPaymentMigration).toContain('transfer_intent_id uuid UNIQUE REFERENCES wss_transfer_intents(id)');
    expect(qrPaymentMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(qrPaymentMigration).not.toMatch(/\b(mnemonic|private_key|signed_transaction|otp_code)\b/i);
    expect(qrPaymentReferenceMigration).toContain('reference_price_krw text');
    expect(qrPaymentReferenceMigration).toContain('confirmed_at timestamptz');
  });
});

describe('WSS wallet removal migration', () => {
  it('keeps closed slots for audit and consumes a host proof once', () => {
    expect(parse(walletRemovalMigration).length).toBeGreaterThan(2);
    expect(walletRemovalMigration).toContain('closed_authorization_id uuid');
    expect(walletRemovalMigration).toContain('CREATE UNIQUE INDEX wss_wallets_closed_authorization_once_idx');
  });
});

describe('WSS development SAR vault factors', () => {
  it('keeps B and C ciphertext in separate protected stores', () => {
    expect(sarVaultMigration).toContain('CREATE TABLE wss_dev_sar_share_b');
    expect(sarVaultMigration).toContain('CREATE TABLE wss_dev_sar_share_c');
    expect(sarVaultMigration).toContain('wss_dev_sar_share_b ENABLE ROW LEVEL SECURITY');
    expect(sarVaultMigration).toContain('wss_dev_sar_share_c ENABLE ROW LEVEL SECURITY');
    const ddl = sarVaultMigration.replace(/--.*$/gm, '');
    expect(ddl).not.toMatch(/\b(mnemonic|private_key|plaintext_share|password|otp_code)\b/i);
    expect(ddl).toContain('encrypted_envelope jsonb NOT NULL');
  });
});

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

describe('WSS phone escrow migration', () => {
  it('keeps recipient PII encrypted behind a server-only RLS table', () => {
    const parseableMigration = phoneEscrowMigration
      .replace(/^BEGIN;\s*/i, '')
      .replace(/\s*COMMIT;\s*$/i, '')
      .replace(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm, '')
      .replace(/^REVOKE ALL ON TABLE .*;$/gm, '');
    expect(() => parse(parseableMigration)).not.toThrow();
    expect(phoneEscrowMigration).toContain('CREATE TABLE wss_phone_escrows');
    expect(phoneEscrowMigration).toContain('ADD COLUMN transfer_channel');
    expect(phoneEscrowMigration).toContain('recipient_ciphertext bytea');
    expect(phoneEscrowMigration).toContain('recipient_lookup_hash bytea NOT NULL');
    expect(phoneEscrowMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(phoneEscrowMigration).toContain('REVOKE ALL ON TABLE wss_phone_escrows FROM anon, authenticated');
  });

  it('does not add a plaintext phone or signing-material column', () => {
    const ddlWithoutComments = phoneEscrowMigration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(phone_plaintext|recipient_phone|otp_code|private_key|seed|mnemonic|signed_transaction)\b/i);
  });
});

describe('WSS phone notice retry migration', () => {
  it('limits retries without storing a plaintext number', () => {
    expect(parse(phoneSmsRetryMigration).length).toBeGreaterThan(1);
    expect(phoneSmsRetryMigration).toContain('sms_attempts integer NOT NULL DEFAULT 0');
    expect(phoneSmsRetryMigration).toContain('sms_last_attempt_at timestamptz');
    expect(phoneSmsRetryMigration).not.toMatch(/phone_plaintext|otp_plaintext|private_key/i);
  });
});

describe('WSS phone claim reconciliation migration', () => {
  it('records a bounded chain scan cursor without signing material', () => {
    expect(parse(phoneClaimReconciliationMigration).length).toBeGreaterThan(1);
    expect(phoneClaimReconciliationMigration).toContain('claim_start_block bigint');
    expect(phoneClaimReconciliationMigration).toContain('claim_scan_block bigint');
    expect(phoneClaimReconciliationMigration).not.toMatch(/private_key|mnemonic|signed_transaction/i);
  });
});

describe('WSS exchange lifecycle migration', () => {
  it('persists the economic intent and execution identifiers without routing payloads', () => {
    const parseableMigration = exchangeMigration
      .replace(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm, '')
      .replace(/^REVOKE ALL ON TABLE .*;$/gm, '');
    expect(() => parse(parseableMigration)).not.toThrow();
    expect(exchangeMigration).toContain('CREATE TABLE wss_exchange_intents');
    expect(exchangeMigration).toContain("quote_mode IN ('exact-in', 'exact-out')");
    expect(exchangeMigration).toContain('CREATE TABLE wss_exchange_executions');
    expect(exchangeMigration).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('does not persist provider calldata, signatures, or wallet secrets', () => {
    const ddlWithoutComments = exchangeMigration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(calldata|signed_transaction|private_key|seed|mnemonic|api_key)\b/i);
  });
});

describe('WSS wallet host proof migration', () => {
  it('records only one-time proof identifiers with tenant-scoped uniqueness', () => {
    expect(parse(walletHostProofMigration).length).toBeGreaterThan(3);
    expect(walletHostProofMigration).toContain('host_authorization_id uuid');
    expect(walletHostProofMigration).toContain('key_core_attestation_id uuid');
    expect(walletHostProofMigration).toContain('wss_wallets_host_authorization_once_idx');
    expect(walletHostProofMigration).toContain('wss_wallets_key_core_attestation_once_idx');
  });

  it('does not persist a proof token or customer secret', () => {
    const ddlWithoutComments = walletHostProofMigration.replace(/--.*$/gm, '');
    expect(ddlWithoutComments).not.toMatch(/\b(proof_token|mnemonic|seed_phrase|private_key|pin)\b/i);
  });
});

describe('WSS nonexclusive wallet addresses', () => {
  it('keeps wallet-chain uniqueness while allowing independent customer imports in development', () => {
    expect(nonexclusiveAddressMigration).toContain("project_name = 'xlot-wss-dev'");
    expect(nonexclusiveAddressMigration).toContain('DROP CONSTRAINT wss_wallet_accounts_tenant_id_chain_id_address_normalized_key');
    expect(nonexclusiveAddressMigration).toContain('UNIQUE (tenant_id, wallet_id, chain_id)');
    expect(nonexclusiveAddressMigration).toContain('wss_wallet_accounts_address_lookup_idx');
  });
});
