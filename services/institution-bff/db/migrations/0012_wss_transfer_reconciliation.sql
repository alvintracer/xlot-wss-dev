BEGIN;

ALTER TABLE wss_transfer_intents
  DROP CONSTRAINT wss_transfer_intents_status_check;
ALTER TABLE wss_transfer_intents
  ADD CONSTRAINT wss_transfer_intents_status_check
  CHECK (status IN ('prepared', 'approval-required', 'processing', 'blocked', 'submitted', 'confirmed', 'failed', 'expired'));
ALTER TABLE wss_transfer_intents
  ADD COLUMN reconciled_transaction_hash text
  CHECK (reconciled_transaction_hash IS NULL OR reconciled_transaction_hash ~ '^0x[0-9a-fA-F]{64}$');

ALTER TABLE wss_transfer_executions
  DROP CONSTRAINT wss_transfer_executions_status_check;
ALTER TABLE wss_transfer_executions
  ADD CONSTRAINT wss_transfer_executions_status_check
  CHECK (status IN ('approved', 'processing', 'submitted', 'confirmed', 'failed'));
ALTER TABLE wss_transfer_executions
  ALTER COLUMN transaction_hash DROP NOT NULL;

CREATE INDEX wss_transfer_intents_subject_activity_idx
  ON wss_transfer_intents (tenant_id, subject_hash, wallet_id, created_at DESC);

COMMIT;
