BEGIN;

-- Supabase Auth owns OTP generation and verification for this provider. WSS
-- stores only challenge lifecycle metadata and a keyed provider subject after
-- successful verification; it never receives or persists the Auth OTP secret.
ALTER TABLE wss_phone_challenges
  ALTER COLUMN otp_mac DROP NOT NULL,
  ALTER COLUMN mac_key_version DROP NOT NULL,
  ADD COLUMN verification_provider text NOT NULL DEFAULT 'wss-mac'
    CHECK (verification_provider IN ('wss-mac', 'supabase-auth')),
  ADD COLUMN provider_subject_hash text;

ALTER TABLE wss_phone_challenges
  ADD CONSTRAINT wss_phone_challenges_verification_material_check
  CHECK (
    (verification_provider = 'wss-mac' AND otp_mac IS NOT NULL AND mac_key_version IS NOT NULL)
    OR
    (verification_provider = 'supabase-auth' AND otp_mac IS NULL AND mac_key_version IS NULL)
  );

CREATE INDEX wss_phone_challenges_provider_subject_idx
  ON wss_phone_challenges (tenant_id, provider_subject_hash)
  WHERE provider_subject_hash IS NOT NULL;

COMMIT;
