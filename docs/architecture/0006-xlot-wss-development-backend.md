# ADR-0006: Use xlot-wss-dev as a disposable multi-tenant development backend

- Status: accepted for proposal and early-function development
- Date: 2026-09-27

## Decision

`xlot-wss-dev` is the shared Supabase development backend for WSS tenant demos,
initial proposals, UI validation, and early functional vertical slices. Kiwoom is
the first tenant in it, not a separate backend architecture.

The development project may contain:

- random WSS profile UUIDs and tenant-scoped institution subject HMACs;
- wallet slots, public chain addresses, key-policy snapshots, and audit events;
- synthetic or approved test-only registration data;
- customer-side AES-256-GCM recovery-envelope ciphertext for the temporary SAR
  vertical slice.

It must never contain live customer data, production institution identifiers,
mnemonics, entropy, private keys, plaintext Shamir shares, completed SAR
secrets, envelope decryption keys, or provider signing credentials.

## Runtime boundary

The Institution BFF uses a server-only PostgreSQL connection and verifies the
singleton `wss_deployment_metadata` row before performing any query or write.
The required marker is:

| Field | Required value |
| --- | --- |
| `project_name` | `xlot-wss-dev` |
| `environment` | `development` |
| `purpose` | `proposal-and-early-function-sandbox` |
| `sar_storage_mode` | `single-project-encrypted` |

All WSS tables enable Row Level Security and revoke table access from Supabase
`anon` and `authenticated` roles. Browser code never receives a direct table
credential. Tenant and wallet ownership are resolved from a short-lived WSS
institution session, not from a client-provided tenant slug or wallet ID alone.

The `wss-dev-sar-vault` Edge Function is a read-only development adapter. It:

1. rejects every non-development deployment mode;
2. uses an exact origin allowlist;
3. independently verifies the short-lived WSS HS256 session;
4. verifies the hard deployment marker;
5. resolves tenant, institution subject, profile, wallet ownership, active
   state, and `took-sar` adapter; and
6. returns only the three encrypted envelopes.

It has no write or reconstruction API and cannot receive key material.

## SAR development exception

All three encrypted envelopes may reside in this one Supabase project because
the environment is disposable and limited to demos. The customer-side key core
encrypts them before they cross the host boundary. The current non-exportable
envelope key remains volatile in the Reference Host, so the system can prove
creation, ciphertext persistence, and access control but cannot claim durable
device-loss recovery.

This single-project arrangement must not be relabeled or promoted into a real
institution deployment. Production SAR requires independently controlled factor
services, durable customer-side/native key protection, one-time attestation,
factor-specific authorization and rate limits, recovery audit evidence, and an
independent security review.

## Project handoff rule

For a real financial-institution build, reusable source code, contracts, and
reviewed migration concepts may be carried forward. Development rows, secrets,
project references, service-role keys, session keys, test identities, and SAR
ciphertexts are never migrated. The institution receives a separately
provisioned backend and a project-specific threat model, retention policy,
provider configuration, and key ceremony.

The development schema is therefore a prototype accelerator, not a production
database waiting to be renamed.

## Operational note

Developer machines without IPv6 must use the Supabase Session pooler connection
string on port 5432 for `DATABASE_URL`. The direct database hostname is not a
portable local-development default. Secrets stay in untracked `.env.local` and
Supabase function secret storage.
