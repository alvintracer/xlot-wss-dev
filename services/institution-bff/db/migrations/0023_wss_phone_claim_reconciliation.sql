BEGIN;

ALTER TABLE wss_phone_escrows
  ADD COLUMN claim_start_block bigint CHECK (claim_start_block IS NULL OR claim_start_block >= 0),
  ADD COLUMN claim_scan_block bigint CHECK (claim_scan_block IS NULL OR claim_scan_block >= 0);

COMMIT;
