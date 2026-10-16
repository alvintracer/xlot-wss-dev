BEGIN;

CREATE TABLE wss_solana_sponsor_reservations (
  tenant_id text NOT NULL,
  transfer_intent_id uuid NOT NULL,
  subject_hash text NOT NULL,
  reserved_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, transfer_intent_id),
  FOREIGN KEY (tenant_id, transfer_intent_id)
    REFERENCES wss_transfer_intents (tenant_id, id)
);

CREATE INDEX wss_solana_sponsor_subject_day_idx
  ON wss_solana_sponsor_reservations (tenant_id, subject_hash, reserved_day);

ALTER TABLE wss_solana_sponsor_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_solana_sponsor_reservations FROM anon, authenticated;

COMMIT;
