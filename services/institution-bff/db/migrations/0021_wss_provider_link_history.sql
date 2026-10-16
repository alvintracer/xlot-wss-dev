-- A removed provider wallet may be linked again after a fresh verified login.
-- Preserve the previous link row for audit while allowing one active link.
ALTER TABLE wss_provider_wallet_links
  DROP CONSTRAINT wss_provider_wallet_links_tenant_id_provider_provider_subje_key;

CREATE UNIQUE INDEX wss_provider_wallet_links_active_subject_key
  ON wss_provider_wallet_links (tenant_id, provider, provider_subject_hash)
  WHERE status = 'active';
