BEGIN;

-- Closing a slot preserves public address and transaction audit records while
-- preventing the same short-lived host proof from closing another slot.
ALTER TABLE wss_wallets ADD COLUMN closed_authorization_id uuid;
ALTER TABLE wss_wallets ADD COLUMN closed_at timestamptz;
CREATE UNIQUE INDEX wss_wallets_closed_authorization_once_idx
  ON wss_wallets (tenant_id, closed_authorization_id)
  WHERE closed_authorization_id IS NOT NULL;

COMMIT;
