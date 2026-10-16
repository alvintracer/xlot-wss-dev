BEGIN;

ALTER TABLE wss_phone_escrows
  ADD COLUMN sms_attempts integer NOT NULL DEFAULT 0 CHECK (sms_attempts BETWEEN 0 AND 5),
  ADD COLUMN sms_last_attempt_at timestamptz;

COMMENT ON COLUMN wss_phone_escrows.sms_attempts IS
  'Limits sender-requested claim notice retries after a confirmed deposit.';

COMMIT;
