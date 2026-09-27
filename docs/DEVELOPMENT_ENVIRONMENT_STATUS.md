# xlot-wss-dev environment status

- Last verified: 2026-09-27
- Supabase project: `xlot-wss-dev`
- Project ref: `opgtfobitjrmujlpfhtd`
- GitHub: `https://github.com/alvintracer/xlot-wss-dev`

## Applied backend

- `0001_wss_identity.sql` applied and checksum recorded
- `0002_wss_development_sar.sql` applied and checksum recorded
- 17 `public.wss_%` tables present, including the migration ledger
- Row Level Security enabled on every WSS table
- zero table grants to `anon` and `authenticated`
- deployment marker verified as `proposal-and-early-function-sandbox`
- `wss-dev-sar-vault` Edge Function deployed and active with gateway JWT
  verification disabled intentionally; the function verifies the custom WSS
  session itself
- exact local development origin allowlist and `development` deployment mode
  configured as Function secrets

## Local-only configuration still required

- replace the placeholder database password in `.env.local` `DATABASE_URL` so
  the Institution BFF can use the Session pooler at runtime;
- add a randomly generated `WSS_SESSION_SECRET` of at least 32 characters and
  set the identical value in the Edge Function secret store;
- add separate random `WSS_SUBJECT_HASH_SECRET` and
  `WSS_INSTITUTION_API_KEY` values to `.env.local`.

No secret value belongs in this document, Git, a browser bundle, or chat.
