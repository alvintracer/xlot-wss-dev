BEGIN;

-- Development preview: one password share and two separately encrypted
-- OTP-gated shares. Production requires independent factor services/stores.
CREATE TABLE wss_dev_sar_v2_bindings (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active')),
  phone_ciphertext bytea NOT NULL,
  email_ciphertext bytea NOT NULL,
  phone_lookup_hash bytea NOT NULL,
  email_lookup_hash bytea NOT NULL,
  password_envelope jsonb CHECK (password_envelope IS NULL OR jsonb_typeof(password_envelope) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  PRIMARY KEY (tenant_id, wallet_id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE wss_dev_sar_v2_share_phone (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mnemonic-entropy', 'evm-private-key')),
  ciphertext bytea NOT NULL,
  PRIMARY KEY (tenant_id, wallet_id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_dev_sar_v2_bindings (tenant_id, wallet_id) ON DELETE CASCADE
);

CREATE TABLE wss_dev_sar_v2_share_email (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mnemonic-entropy', 'evm-private-key')),
  ciphertext bytea NOT NULL,
  PRIMARY KEY (tenant_id, wallet_id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_dev_sar_v2_bindings (tenant_id, wallet_id) ON DELETE CASCADE
);

CREATE TABLE wss_dev_sar_v2_challenges (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  session_id_hash text NOT NULL,
  subject_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('enroll', 'unlock')),
  factor_pair text CHECK (factor_pair IN ('password-phone', 'password-email', 'phone-email')),
  phone_ciphertext bytea NOT NULL,
  email_ciphertext bytea NOT NULL,
  phone_lookup_hash bytea NOT NULL,
  email_lookup_hash bytea NOT NULL,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  phone_access_token_hash text,
  email_access_token_hash text,
  phone_access_used_at timestamptz,
  email_access_used_at timestamptz,
  enrollment_token_hash text,
  enrollment_used_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX wss_dev_sar_v2_challenges_wallet_time_idx
  ON wss_dev_sar_v2_challenges (tenant_id, wallet_id, created_at DESC);

ALTER TABLE wss_dev_sar_v2_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_v2_share_phone ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_v2_share_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_v2_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_dev_sar_v2_bindings, wss_dev_sar_v2_share_phone,
  wss_dev_sar_v2_share_email, wss_dev_sar_v2_challenges FROM anon, authenticated;

COMMIT;
