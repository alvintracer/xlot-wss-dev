BEGIN;

-- Public unsigned transfer terms are needed across stateless BFF invocations.
-- Signing secrets, host proofs, signatures, and signed transactions stay out of this table.
ALTER TABLE wss_transfer_intents
  ADD COLUMN prepared_payload jsonb,
  ADD COLUMN phone_escrow_reference jsonb;

COMMIT;
