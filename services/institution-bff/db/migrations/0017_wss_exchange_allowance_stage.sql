BEGIN;

ALTER TABLE wss_exchange_intents
  ADD COLUMN stage text NOT NULL DEFAULT 'swap' CHECK (stage IN ('allowance', 'swap'));

ALTER TABLE wss_exchange_intents DROP CONSTRAINT wss_exchange_intents_status_check;
ALTER TABLE wss_exchange_intents
  ADD CONSTRAINT wss_exchange_intents_status_check
  CHECK (status IN ('approval-required', 'submitted', 'allowance-confirmed', 'confirmed', 'failed', 'expired'));

ALTER TABLE wss_exchange_executions DROP CONSTRAINT wss_exchange_executions_status_check;
ALTER TABLE wss_exchange_executions
  ADD CONSTRAINT wss_exchange_executions_status_check
  CHECK (status IN ('approved', 'submitted', 'allowance-confirmed', 'confirmed', 'failed'));

COMMIT;
