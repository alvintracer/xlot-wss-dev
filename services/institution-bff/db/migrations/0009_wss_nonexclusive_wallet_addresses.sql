-- xlot-wss-dev only: a noncustodial address may be imported independently by
-- more than one customer profile. This does not merge or transfer profile data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM wss_deployment_metadata
    WHERE singleton = true
      AND project_name = 'xlot-wss-dev'
      AND environment = 'development'
      AND purpose = 'proposal-and-early-function-sandbox'
      AND sar_storage_mode = 'single-project-encrypted'
  ) THEN
    RAISE EXCEPTION 'Nonexclusive wallet-address migration is development-only';
  END IF;
END
$$;

ALTER TABLE wss_wallet_accounts
  DROP CONSTRAINT wss_wallet_accounts_tenant_id_chain_id_address_normalized_key;

ALTER TABLE wss_wallet_accounts
  ADD CONSTRAINT wss_wallet_accounts_tenant_wallet_chain_key
  UNIQUE (tenant_id, wallet_id, chain_id);

CREATE INDEX wss_wallet_accounts_address_lookup_idx
  ON wss_wallet_accounts (tenant_id, chain_id, address_normalized);
