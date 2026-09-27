# xlot-wss-dev Supabase boundary

This directory contains the database and Edge Function scaffolding for the
proposal and early-function development environment named `xlot-wss-dev`.
It is not a production backend template.

## Apply locally or to the linked development project

After copying the dashboard's **Session pooler** URL into the untracked
`.env.local`, apply the migrations with:

```bash
npm run db:apply:development
```

The guarded runner checks that `DATABASE_URL` belongs to the project named by
`SUPABASE_URL`, serializes migration execution, records SHA-256 checksums, and
verifies the hard development marker. It applies these files in order:

1. `services/institution-bff/db/migrations/0001_wss_identity.sql`
2. `services/institution-bff/db/migrations/0002_wss_development_sar.sql`

Use the Supabase **Session pooler** connection string on IPv4-only developer
machines. Keep it only in `.env.local` as `DATABASE_URL`; never commit it.

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

## Deliberate limitations

- all three ciphertext envelopes reside in one development project;
- the encryption key remains in the customer-side development key core and is
  currently volatile;
- this demonstrates persistence and ownership boundaries, not device-loss
  recovery or production SAR factor independence;
- production must replace this function and storage layout with independently
  controlled factor services and an approved native/hardware-backed key core.
