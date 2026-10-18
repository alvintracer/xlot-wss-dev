BEGIN;

-- Development issuer metadata only. The signed credential is held by the Host.
CREATE TABLE wss_dev_identity_credentials (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_profile_id uuid NOT NULL,
  holder_did text NOT NULL,
  issuer_did text NOT NULL,
  credential_sha256 text NOT NULL,
  assurance text NOT NULL CHECK (assurance = 'DEV_ASSUMED'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_profile_id) REFERENCES wss_user_profiles (tenant_id, id)
);
CREATE INDEX wss_dev_identity_credentials_owner_idx
  ON wss_dev_identity_credentials (tenant_id, user_profile_id, issued_at DESC);

CREATE TABLE wss_dev_identity_wallet_bindings (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  credential_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  address_normalized text NOT NULL,
  wallet_signature text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, credential_id, wallet_id),
  FOREIGN KEY (tenant_id, credential_id) REFERENCES wss_dev_identity_credentials (tenant_id, id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id)
);

CREATE TABLE wss_dev_identity_challenges (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  credential_id uuid NOT NULL,
  wallet_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('wallet-binding', 'presentation')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, credential_id) REFERENCES wss_dev_identity_credentials (tenant_id, id),
  FOREIGN KEY (tenant_id, wallet_id) REFERENCES wss_wallets (tenant_id, id)
);
CREATE INDEX wss_dev_identity_challenges_expiry_idx ON wss_dev_identity_challenges (expires_at);

ALTER TABLE wss_dev_identity_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_identity_wallet_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_dev_identity_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_dev_identity_credentials, wss_dev_identity_wallet_bindings,
  wss_dev_identity_challenges FROM PUBLIC, anon, authenticated;

COMMIT;
