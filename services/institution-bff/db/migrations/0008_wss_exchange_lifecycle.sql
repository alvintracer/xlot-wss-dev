BEGIN;

-- Executable DEX routing payloads, signatures and provider credentials are
-- deliberately excluded. Only the customer-approved economic intent and its
-- transaction identifier are retained for audit and reconciliation.
CREATE TABLE wss_exchange_intents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  wallet_id uuid NOT NULL,
  session_id_hash text NOT NULL,
  subject_hash text NOT NULL,
  quote_id uuid NOT NULL,
  provider text NOT NULL,
  chain_id text NOT NULL,
  quote_mode text NOT NULL CHECK (quote_mode IN ('exact-in', 'exact-out')),
  sell_asset_id text NOT NULL,
  sell_asset_symbol text NOT NULL,
  sell_amount_atomic text NOT NULL CHECK (sell_amount_atomic ~ '^[0-9]+$'),
  buy_asset_id text NOT NULL,
  buy_asset_symbol text NOT NULL,
  buy_amount_atomic text NOT NULL CHECK (buy_amount_atomic ~ '^[0-9]+$'),
  minimum_buy_amount_atomic text CHECK (minimum_buy_amount_atomic ~ '^[0-9]+$'),
  maximum_sell_amount_atomic text CHECK (maximum_sell_amount_atomic ~ '^[0-9]+$'),
  network_fee_atomic text NOT NULL CHECK (network_fee_atomic ~ '^[0-9]+$'),
  signing_payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('approval-required', 'submitted', 'confirmed', 'failed', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_id),
  FOREIGN KEY (tenant_id, wallet_id)
    REFERENCES wss_wallets (tenant_id, id)
);

CREATE INDEX wss_exchange_intents_wallet_created_idx
  ON wss_exchange_intents (tenant_id, wallet_id, created_at DESC);

CREATE TABLE wss_exchange_executions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  exchange_intent_id uuid NOT NULL,
  host_authorization_id uuid NOT NULL,
  idempotency_key_hash text NOT NULL,
  transaction_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('approved', 'submitted', 'confirmed', 'failed')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (tenant_id, exchange_intent_id),
  UNIQUE (tenant_id, host_authorization_id),
  UNIQUE (tenant_id, idempotency_key_hash),
  FOREIGN KEY (tenant_id, exchange_intent_id)
    REFERENCES wss_exchange_intents (tenant_id, id)
);

ALTER TABLE wss_exchange_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE wss_exchange_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_exchange_intents FROM anon, authenticated;
REVOKE ALL ON TABLE wss_exchange_executions FROM anon, authenticated;

COMMIT;
