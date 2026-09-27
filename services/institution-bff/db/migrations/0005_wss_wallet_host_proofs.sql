BEGIN;

-- These identifiers refer only to short-lived, signed host proofs. The proof
-- tokens themselves are never persisted. Unique indexes make a successful
-- wallet authorization and key-core attestation one-time across idempotency
-- keys while allowing pre-migration development wallets to remain nullable.
ALTER TABLE wss_wallets
  ADD COLUMN host_authorization_id uuid,
  ADD COLUMN key_core_attestation_id uuid;

CREATE UNIQUE INDEX wss_wallets_host_authorization_once_idx
  ON wss_wallets (tenant_id, host_authorization_id)
  WHERE host_authorization_id IS NOT NULL;

CREATE UNIQUE INDEX wss_wallets_key_core_attestation_once_idx
  ON wss_wallets (tenant_id, key_core_attestation_id)
  WHERE key_core_attestation_id IS NOT NULL;

COMMIT;
