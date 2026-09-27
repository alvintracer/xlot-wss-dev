# xlot-wss-dev Supabase boundary

This directory contains the database and Edge Function scaffolding for the
proposal and early-function development environment named `xlot-wss-dev`.
It is not a production backend template.

## Apply locally or to the linked development project

After logging the Supabase CLI into the project-owning account and linking this
directory to `xlot-wss-dev`, apply or verify the migrations with:

```bash
npm run db:apply:development
```

The guarded runner checks that the linked project belongs to `SUPABASE_URL`,
serializes migration execution, records SHA-256 checksums, and verifies the hard
development marker. It uses the Supabase Management API and does not require a
database password. It applies these files in order:

1. `services/institution-bff/db/migrations/0001_wss_identity.sql`
2. `services/institution-bff/db/migrations/0002_wss_development_sar.sql`
3. `services/institution-bff/db/migrations/0003_wss_phone_registration.sql`
4. `services/institution-bff/db/migrations/0004_wss_supabase_phone_auth.sql`
5. `services/institution-bff/db/migrations/0005_wss_wallet_host_proofs.sql`

The running Institution BFF still needs the Supabase **Session pooler**
connection string on IPv4-only developer machines. Keep the actual database
password only in the untracked `.env.local` `DATABASE_URL`; never commit it. The
alternative direct-connection runner is `npm run db:apply:direct`.

The `wss-dev-sar-vault` function is read-only. It returns three opaque,
browser-encrypted AES-GCM envelopes only after verifying a short-lived WSS
institution session and wallet ownership. It cannot accept or reconstruct key
material.

Required deployed function secrets:

- `WSS_SESSION_SECRET`: same signing secret as the development Institution BFF
- `WSS_ALLOWED_ORIGINS`: exact comma-separated development origins, no wildcard
- `WSS_DEPLOYMENT_MODE=development`

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the hosted
Supabase Edge Function environment. Never expose the service role key to a
browser or add it to a `VITE_*` variable.

## Supabase Auth + SOLAPI phone OTP

`wss-auth-send-sms` is an HTTP Send SMS Auth Hook. Supabase Auth owns OTP
generation, expiry, and verification; the hook only verifies the Standard
Webhooks signature and sends the supplied code through SOLAPI. WSS never stores
that code or a second copy of its MAC.

Add these values to the ignored, mode-0600 `.env.local`:

- `WSS_AUTH_SEND_SMS_HOOK_URI`: the deployed function URL;
- `WSS_AUTH_SEND_SMS_HOOK_SECRET`: the generated Auth Hook signing secret;
- `WSS_SOLAPI_API_KEY`;
- `WSS_SOLAPI_API_SECRET`;
- `WSS_SOLAPI_SENDER_NUMBER`: a sender already registered with SOLAPI.

Then activate the linked development project in one guarded command:

```bash
npm run auth:activate:solapi
```

The command verifies the linked project, deploys the hook with gateway JWT
verification disabled, writes the confidential values to Edge Function
secrets, and pushes the checked-in phone Auth/Send SMS Hook configuration. Do
not put SOLAPI credentials in a `VITE_*` value or tenant manifest.

The Kiwoom sandbox shows a clearly labeled loopback development code when the
Auth provider is not yet configured. Once Auth accepts the OTP request, no
fallback code is generated. Production fails closed instead of falling back.

## Deliberate limitations

- all three ciphertext envelopes reside in one development project;
- the encryption key remains in the customer-side development key core and is
  currently volatile;
- this demonstrates persistence and ownership boundaries, not device-loss
  recovery or production SAR factor independence;
- production must replace this function and storage layout with independently
  controlled factor services and an approved native/hardware-backed key core.
