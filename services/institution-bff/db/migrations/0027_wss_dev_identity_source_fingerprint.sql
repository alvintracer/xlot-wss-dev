BEGIN;

-- A keyed fingerprint invalidates a credential after verified profile data changes
-- without retaining name, date of birth, or phone in credential metadata.
ALTER TABLE wss_dev_identity_credentials ADD COLUMN source_fingerprint text;

COMMIT;
