BEGIN;

-- The Auth Send SMS Hook receives only the Auth user and OTP. Keep the
-- institution selected by the signed WSS session in a short-lived, one-use
-- server-side record. The phone is HMACed; neither phone nor OTP is stored.
CREATE TABLE wss_sms_delivery_contexts (
  phone_key text PRIMARY KEY CHECK (phone_key ~ '^[0-9a-f]{64}$'),
  context_id uuid NOT NULL,
  brand_name text NOT NULL CHECK (length(brand_name) BETWEEN 1 AND 40),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wss_sms_delivery_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_sms_delivery_contexts FROM anon, authenticated;
GRANT SELECT, DELETE ON TABLE wss_sms_delivery_contexts TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
