BEGIN;

ALTER TABLE wss_transfer_intents
  ADD COLUMN transfer_channel text NOT NULL DEFAULT 'address'
  CHECK (transfer_channel IN ('address', 'phone', 'message'));

COMMENT ON COLUMN wss_transfer_intents.recipient_address IS
  'Public destination address for address transfers; a one-way reference for non-address channels.';

-- Phone escrow is isolated from the generic transfer audit so recipient PII is
-- never written into recipient_address. The number is retained only as an
-- AES-256-GCM envelope until delivery/claim expiry; lookup uses a tenant-bound
-- HMAC. No OTP, seed, private key, signature, or raw signed transaction is
-- stored here.
CREATE TABLE wss_phone_escrows (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  transfer_intent_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  session_id_hash text NOT NULL,
  subject_hash text NOT NULL,
  commitment text NOT NULL CHECK (commitment ~ '^0x[0-9a-f]{64}$'),
  claim_code text NOT NULL CHECK (claim_code ~ '^[A-Za-z0-9_-]{12}$'),
  recipient_ciphertext bytea,
  recipient_lookup_hash bytea NOT NULL,
  recipient_purged_at timestamptz,
  encryption_key_version integer NOT NULL DEFAULT 1 CHECK (encryption_key_version = 1),
  chain_id text NOT NULL,
  evm_chain_id integer NOT NULL CHECK (evm_chain_id > 0),
  escrow_contract_address text NOT NULL CHECK (escrow_contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  token_contract_address text NOT NULL CHECK (token_contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  recipient_amount_atomic text NOT NULL CHECK (recipient_amount_atomic ~ '^[1-9][0-9]*$'),
  escrow_amount_atomic text NOT NULL CHECK (escrow_amount_atomic ~ '^[1-9][0-9]*$'),
  claim_fee_atomic text NOT NULL CHECK (claim_fee_atomic ~ '^[0-9]+$'),
  status text NOT NULL CHECK (status IN ('prepared', 'submitted', 'funded', 'notified', 'claimed', 'refunded', 'failed', 'expired')),
  deposit_transaction_hash text CHECK (deposit_transaction_hash IS NULL OR deposit_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  sms_status text NOT NULL DEFAULT 'pending' CHECK (sms_status IN ('pending', 'sending', 'sent', 'failed', 'not-configured')),
  sms_provider text CHECK (sms_provider IS NULL OR sms_provider IN ('solapi')),
  sms_provider_id text,
  sms_last_error_code text,
  expires_at timestamptz NOT NULL,
  funded_at timestamptz,
  notified_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, transfer_intent_id),
  UNIQUE (tenant_id, commitment),
  UNIQUE (claim_code),
  FOREIGN KEY (tenant_id, transfer_intent_id)
    REFERENCES wss_transfer_intents (tenant_id, id),
  FOREIGN KEY (tenant_id, wallet_id)
    REFERENCES wss_wallets (tenant_id, id),
  CHECK (escrow_amount_atomic::numeric = recipient_amount_atomic::numeric + claim_fee_atomic::numeric),
  CHECK ((recipient_ciphertext IS NOT NULL AND recipient_purged_at IS NULL)
    OR (recipient_ciphertext IS NULL AND recipient_purged_at IS NOT NULL))
);

CREATE INDEX wss_phone_escrows_recipient_lookup_idx
  ON wss_phone_escrows (tenant_id, recipient_lookup_hash, created_at DESC);

CREATE INDEX wss_phone_escrows_delivery_idx
  ON wss_phone_escrows (sms_status, status, created_at)
  WHERE status IN ('submitted', 'funded') AND sms_status IN ('pending', 'failed');

ALTER TABLE wss_phone_escrows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_phone_escrows FROM anon, authenticated;

COMMENT ON TABLE wss_phone_escrows IS
  'WSS server-only phone escrow state. Recipient numbers are encrypted and tenant-bound HMAC indexed.';
COMMENT ON COLUMN wss_phone_escrows.claim_code IS
  'Random bearer routing reference; phone possession is still required before claim authorization.';

COMMIT;
