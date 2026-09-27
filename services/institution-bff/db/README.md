# WSS persistence boundary

This directory contains WSS-owned PostgreSQL migrations. The development migrations are applied to the isolated `xlot-wss-dev` Supabase project; they must not be applied to the took/XLOT B2C project.

The schema keeps WSS identity separate from institution customer identity:

- WSS owns a random internal `user_profile_id` UUID.
- An institution customer UUID is stored only as a tenant-scoped, versioned HMAC subject in `wss_external_identities`.
- Raw name, birth date, and phone values are application-encrypted before storage.
- OTP values, private keys, mnemonics, plaintext SAR shares, and signing material must never be stored in these tables.
- Every relationship includes `tenant_id` so a cross-tenant link cannot be created accidentally.
- One row in `wss_wallets` is one wallet slot. `wss_wallet_accounts` contains that wallet's chain/network accounts; chain rows are never wallet slots.
- Imported-wallet rows retain only the non-secret `imported` origin. The import method and opaque one-time import reference must be consumed by the key core and must not be persisted here.
- Key policy snapshots are immutable. Existing wallets retain their creation-time policy version and change adapters only through an explicit wallet migration.
- `wss_dev_sar_envelopes` is an explicit development-only exception for customer-side encrypted share ciphertext. Its wrapping key never enters Supabase; the table is not a production SAR design.

See `docs/architecture/0002-wss-identity-and-account-linking.md`, `docs/architecture/0003-key-recovery-policy-lifecycle.md`, and `docs/architecture/0006-xlot-wss-development-backend.md` before implementing repository code.
