BEGIN;

-- Public addresses and transaction identifiers are retained for operational
-- audit. Session tokens, host proof tokens, signatures, raw transactions,
-- seed material and private keys are deliberately excluded.
CREATE TABLE wss_transfer_intents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  session_id_hash text NOT NULL,
  subject_hash text NOT NULL,
  chain_id text NOT NULL,
  asset_id text NOT NULL,
  asset_symbol text NOT NULL,
  from_address text NOT NULL,
  recipient_address text NOT NULL,
  amount_atomic text NOT NULL CHECK (amount_atomic ~ '^[0-9]+$'),
  network_fee_atomic text NOT NULL CHECK (network_fee_atomic ~ '^[0-9]+$'),
  compliance_status text NOT NULL CHECK (compliance_status IN ('allow', 'review', 'block', 'unavailable')),
  compliance_risk_level text CHECK (compliance_risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  compliance_risk_score integer,
  compliance_reason_recorded boolean NOT NULL DEFAULT false,
  compliance_reason_hash text,
  gas_sponsorship_status text NOT NULL CHECK (gas_sponsorship_status IN ('sponsored', 'eligible', 'not-eligible', 'unavailable')),
  signing_payload_hash text,
  status text NOT NULL CHECK (status IN ('prepared', 'approval-required', 'blocked', 'submitted', 'confirmed', 'failed', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, wallet_id)
    REFERENCES wss_wallets (tenant_id, id),
  CHECK ((compliance_reason_recorded AND compliance_reason_hash IS NOT NULL)
    OR (NOT compliance_reason_recorded AND compliance_reason_hash IS NULL))
);

CREATE INDEX wss_transfer_intents_wallet_created_idx
  ON wss_transfer_intents (tenant_id, wallet_id, created_at DESC);

CREATE TABLE wss_transfer_executions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  transfer_intent_id uuid NOT NULL,
  host_authorization_id uuid NOT NULL,
  idempotency_key_hash text NOT NULL,
  transaction_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('approved', 'submitted', 'confirmed', 'failed')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (tenant_id, transfer_intent_id),
  UNIQUE (tenant_id, host_authorization_id),
  UNIQUE (tenant_id, idempotency_key_hash),
  FOREIGN KEY (tenant_id, transfer_intent_id)
    REFERENCES wss_transfer_intents (tenant_id, id)
);

ALTER TABLE wss_transfer_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_transfer_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_transfer_intents FROM anon, authenticated;
REVOKE ALL ON TABLE wss_transfer_executions FROM anon, authenticated;

COMMIT;
