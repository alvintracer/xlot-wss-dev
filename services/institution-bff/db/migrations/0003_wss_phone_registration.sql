BEGIN;

-- Registration remains pre-profile until phone possession is verified. The
-- institution subject is already an HMAC and the session id is additionally
-- hashed so neither the raw customer reference nor bearer token is persisted.
CREATE TABLE wss_registration_session_bindings (
  tenant_id text NOT NULL,
  registration_intent_id uuid NOT NULL,
  institution_subject_hash text NOT NULL,
  subject_version smallint NOT NULL CHECK (subject_version > 0),
  session_id_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, registration_intent_id),
  FOREIGN KEY (tenant_id, registration_intent_id)
    REFERENCES wss_registration_intents (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX wss_registration_session_subject_idx
  ON wss_registration_session_bindings (
    tenant_id,
    subject_version,
    institution_subject_hash,
    created_at DESC
  );

ALTER TABLE wss_phone_challenges
  ADD COLUMN delivery_channel text NOT NULL DEFAULT 'sms'
    CHECK (delivery_channel = 'sms'),
  ADD COLUMN delivery_provider text NOT NULL DEFAULT 'development-console-disabled',
  ADD COLUMN sent_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE wss_registration_session_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wss_registration_session_bindings FROM anon, authenticated;

COMMIT;
