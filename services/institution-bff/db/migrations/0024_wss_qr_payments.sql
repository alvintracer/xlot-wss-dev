BEGIN;

CREATE TABLE wss_qr_payment_requests (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_hash text NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id text NOT NULL,
  asset_id text NOT NULL,
  asset_symbol text NOT NULL,
  decimals integer NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  amount_atomic text NOT NULL CHECK (amount_atomic ~ '^[1-9][0-9]*$'),
  recipient_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reserved','submitted','confirmed','failed','expired')),
  payer_tenant_id text,
  payer_subject_hash text,
  transfer_intent_id uuid UNIQUE REFERENCES wss_transfer_intents(id),
  reserved_until timestamptz,
  transaction_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wss_qr_payment_owner_idx ON wss_qr_payment_requests (tenant_id, subject_hash, wallet_id, created_at DESC);
CREATE INDEX wss_qr_payment_status_idx ON wss_qr_payment_requests (status, expires_at);
ALTER TABLE wss_qr_payment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_qr_payment_requests FROM PUBLIC, anon, authenticated;

COMMIT;
