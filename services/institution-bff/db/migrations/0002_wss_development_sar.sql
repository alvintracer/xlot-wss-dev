BEGIN;

-- Hard marker used by runtime checks and operators. This schema is for proposal
-- and early-function development only and must never be promoted as production.
CREATE TABLE wss_deployment_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  project_name text NOT NULL,
  environment text NOT NULL CHECK (environment = 'development'),
  purpose text NOT NULL CHECK (purpose = 'proposal-and-early-function-sandbox'),
  sar_storage_mode text NOT NULL CHECK (sar_storage_mode = 'single-project-encrypted'),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO wss_deployment_metadata (
  singleton,
  project_name,
  environment,
  purpose,
  sar_storage_mode
) VALUES (
  true,
  'xlot-wss-dev',
  'development',
  'proposal-and-early-function-sandbox',
  'single-project-encrypted'
) ON CONFLICT (singleton) DO NOTHING;

-- Never relabel an existing database as the WSS development project. If a
-- singleton marker already exists with any other value, abort this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM wss_deployment_metadata
    WHERE singleton = true
      AND project_name = 'xlot-wss-dev'
      AND environment = 'development'
      AND purpose = 'proposal-and-early-function-sandbox'
      AND sar_storage_mode = 'single-project-encrypted'
  ) THEN
    RAISE EXCEPTION 'WSS development deployment marker mismatch';
  END IF;
END $$;

-- Ciphertext-only development storage. Encryption happens in the customer-side
-- key core. The wrapping key, mnemonic, entropy, private keys, and plaintext
-- Shamir shares are forbidden from this table and from Edge Functions.
CREATE TABLE wss_dev_sar_envelopes (
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  share_index smallint NOT NULL CHECK (share_index BETWEEN 1 AND 3),
  envelope_version smallint NOT NULL DEFAULT 1 CHECK (envelope_version = 1),
  algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  iv_base64 text NOT NULL CHECK (length(iv_base64) BETWEEN 16 AND 64),
  ciphertext_base64 text NOT NULL CHECK (length(ciphertext_base64) BETWEEN 24 AND 4096),
  aad text NOT NULL CHECK (length(aad) BETWEEN 16 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wallet_id, share_index),
  FOREIGN KEY (tenant_id, wallet_id)
    REFERENCES wss_wallets (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX wss_dev_sar_envelopes_wallet_idx
  ON wss_dev_sar_envelopes (tenant_id, wallet_id);

ALTER TABLE wss_deployment_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_sar_envelopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_deployment_metadata, wss_dev_sar_envelopes FROM anon, authenticated;

COMMIT;
