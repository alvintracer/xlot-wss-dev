BEGIN;

ALTER TABLE wss_phone_escrows
  ADD COLUMN claim_payout_atomic text
    CHECK (claim_payout_atomic IS NULL OR claim_payout_atomic ~ '^[0-9]+$'),
  ADD COLUMN claim_fee_atomic_actual text
    CHECK (claim_fee_atomic_actual IS NULL OR claim_fee_atomic_actual ~ '^[0-9]+$');

COMMIT;
