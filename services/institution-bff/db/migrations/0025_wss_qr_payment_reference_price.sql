BEGIN;

ALTER TABLE wss_qr_payment_requests
  ADD COLUMN reference_price_krw text,
  ADD COLUMN reference_price_as_of timestamptz,
  ADD COLUMN reference_amount_krw text,
  ADD COLUMN confirmed_at timestamptz;

UPDATE wss_qr_payment_requests
SET confirmed_at = updated_at
WHERE status = 'confirmed';

ALTER TABLE wss_qr_payment_requests
  ADD CONSTRAINT wss_qr_payment_reference_price_format
  CHECK (reference_price_krw IS NULL OR reference_price_krw ~ '^[0-9]+(\.[0-9]+)?$'),
  ADD CONSTRAINT wss_qr_payment_reference_amount_format
  CHECK (reference_amount_krw IS NULL OR reference_amount_krw ~ '^[0-9]+$');

COMMIT;
