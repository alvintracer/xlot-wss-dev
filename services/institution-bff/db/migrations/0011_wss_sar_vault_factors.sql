BEGIN;

-- Development preview only. All share payloads are encrypted in the host with
-- a customer password before they reach these logically separate stores.
CREATE TABLE wss_dev_sar_vault_bindings (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  phone_ciphertext bytea NOT NULL,
  email_ciphertext bytea NOT NULL,
  phone_lookup_hash bytea NOT NULL,
  email_lookup_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wallet_id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE wss_dev_sar_share_b (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  encrypted_envelope jsonb NOT NULL CHECK (jsonb_typeof(encrypted_envelope) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wallet_id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE wss_dev_sar_share_c (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  encrypted_envelope jsonb NOT NULL CHECK (jsonb_typeof(encrypted_envelope) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wallet_id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE wss_dev_sar_vault_challenges (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  session_id_hash text NOT NULL,
  subject_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('enroll', 'unlock')),
  phone_ciphertext bytea NOT NULL,
  email_ciphertext bytea NOT NULL,
  phone_lookup_hash bytea NOT NULL,
  email_lookup_hash bytea NOT NULL,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  access_token_hash text,
  access_token_used_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX wss_dev_sar_vault_challenges_wallet_time_idx
  ON wss_dev_sar_vault_challenges (tenant_id, wallet_id, created_at DESC);

ALTER TABLE wss_dev_sar_vault_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_share_b ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_share_c ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_vault_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_dev_sar_vault_bindings, wss_dev_sar_share_b,
  wss_dev_sar_share_c, wss_dev_sar_vault_challenges FROM anon, authenticated;

COMMIT;
