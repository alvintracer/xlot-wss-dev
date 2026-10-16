BEGIN;

ALTER TABLE wss_phone_escrows
  DROP CONSTRAINT wss_phone_escrows_status_check;
ALTER TABLE wss_phone_escrows
  ADD CONSTRAINT wss_phone_escrows_status_check
  CHECK (status IN ('prepared', 'submitted', 'funded', 'notified', 'claiming', 'claimed', 'refunded', 'failed', 'expired'));

ALTER TABLE wss_phone_escrows
  ADD COLUMN claim_recipient_address text
    CHECK (claim_recipient_address IS NULL OR claim_recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  ADD COLUMN claim_transaction_hash text
    CHECK (claim_transaction_hash IS NULL OR claim_transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  ADD COLUMN claim_started_at timestamptz,
  ADD COLUMN otp_request_count integer NOT NULL DEFAULT 0 CHECK (otp_request_count BETWEEN 0 AND 5),
  ADD COLUMN otp_last_requested_at timestamptz;

CREATE INDEX wss_phone_escrows_claim_reconcile_idx
  ON wss_phone_escrows (status, claim_started_at)
  WHERE status = 'claiming';

COMMIT;
