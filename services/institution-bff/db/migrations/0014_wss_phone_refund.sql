BEGIN;

ALTER TABLE wss_phone_escrows
  DROP CONSTRAINT wss_phone_escrows_status_check;
ALTER TABLE wss_phone_escrows
  ADD CONSTRAINT wss_phone_escrows_status_check
  CHECK (status IN ('prepared', 'submitted', 'funded', 'notified', 'claiming', 'claimed', 'refunding', 'refunded', 'failed', 'expired'));

ALTER TABLE wss_phone_escrows
  ADD COLUMN refund_intent_id uuid UNIQUE,
  ADD COLUMN refund_signing_request jsonb,
  ADD COLUMN refund_expires_at timestamptz,
  ADD COLUMN refund_transaction_hash text
    CHECK (refund_transaction_hash IS NULL OR refund_transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  ADD COLUMN refund_started_at timestamptz;

CREATE INDEX wss_phone_escrows_refund_reconcile_idx
  ON wss_phone_escrows (status, refund_started_at)
  WHERE status = 'refunding';

COMMIT;
