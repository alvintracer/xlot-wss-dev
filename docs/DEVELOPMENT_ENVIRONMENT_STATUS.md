# xlot-wss-dev environment status

- Last verified: 2026-09-27
- Supabase project: `xlot-wss-dev`
- Project ref: `opgtfobitjrmujlpfhtd`
- GitHub: `https://github.com/alvintracer/xlot-wss-dev`

## Applied backend

- `0001_wss_identity.sql` applied and checksum recorded
- `0002_wss_development_sar.sql` applied and checksum recorded
- `0003_wss_phone_registration.sql` applied and checksum recorded
- `0004_wss_supabase_phone_auth.sql` applied and checksum recorded
- `0005_wss_wallet_host_proofs.sql` applied and checksum recorded
- `0006_wss_transfer_lifecycle.sql` applied and checksum recorded
- 20 `public.wss_%` tables present, including the migration ledger
- Row Level Security enabled on every WSS table
- zero table grants to `anon` and `authenticated`
- deployment marker verified as `proposal-and-early-function-sandbox`
- `wss-dev-sar-vault` Edge Function deployed and active with gateway JWT
  verification disabled intentionally; the function verifies the custom WSS
  session itself
- exact local development origin allowlist and `development` deployment mode
  configured as Function secrets
- randomly generated local WSS session and subject-HMAC secrets stored only in
  `.env.local`; the session secret is synchronized to the Edge Function
- separate randomly generated PII-encryption, phone-lookup-HMAC, and OTP-MAC
  secrets stored only in the mode-0600 `.env.local`
- `wss-auth-send-sms` deployed with gateway JWT verification disabled so that
  Supabase Auth can invoke the Standard Webhooks-verified endpoint
- a generated Auth Hook signing secret stored only in `.env.local` and
  synchronized to the Edge Function
- all three SOLAPI credentials synchronized as Edge Function secrets and the
  remote Supabase Auth Send SMS Hook activated
- hosted Auth settings returned phone-provider enabled, and the deployed Hook
  was verified `ACTIVE` at version 4 without exposing a credential value
- Session pooler runtime connection verified from the Institution BFF
- wallet authorization and SAR key-core proof UUIDs are stored under
  tenant-scoped unique indexes; signed proof strings are not persisted
- `wallet-price-quote` and fail-closed `kyt-screen` Edge Functions deployed;
  their gateway JWT checks remain enabled and the BFF calls them server-side
- the updated `wallet-price-quote` deployment returned a fresh labeled
  market-reference quote for all 14 configured Kiwoom stablecoin symbols with
  no unavailable asset on 2026-09-27
- transfer intent and execution tables deployed with RLS and no browser-role
  grants; raw signatures, signed transactions, proof tokens, and key material
  are not columns in either table

## Verified persistent vertical slice

- actual customer-side SAR wallet derivation and all-pairs Shamir 2-of-3
  verification completed through the Kiwoom browser flow;
- one WSS profile and institution identity persisted;
- two independent wallet slots persisted: one took SAR and one FSL MPC;
- nine network account rows persisted for the SAR wallet, grouped as five
  customer-visible address groups;
- one SAR recovery profile and three distinct AES-256-GCM ciphertext envelopes
  persisted;
- two wallet-provisioned audit events persisted;
- after an Institution BFF restart, bootstrap restored both wallet slots and
  selected-wallet queries restored all five SAR public-address groups;
- the deployed Edge Function returned factors 1, 2, and 3 for the owned SAR
  wallet and rejected the owned FSL wallet with `wallet_not_found`;
- allowed preflight returned 204, an untrusted origin returned 403, and an
  unauthenticated request returned 401.
- a new Kiwoom customer session returned `registration-required`, completed the
  encrypted phone-possession path, then returned `established`; the completed
  intent had all transient PII purged, the durable private attributes remained
  encrypted, and the sandbox-fallback challenge retained only a 32-byte OTP
  MAC;
- the headless browser completed registration, session-bound wallet authorization, real SAR
  creation, nine-network registration, a second FSL wallet slot, wallet
  selection, actual QR receive-address display, asset-first/network-second
  receive, and a zero-balance-visible send amount screen.

The current asset adapter queries native balances on all nine configured chains
and tenant-enabled stablecoin balances across EVM, Solana, TRON, and XRP Ledger.
The curated registry contains 14 symbols and 45 chain-specific deployments.
The receive and send flows now group the 54 deployment rows into 21 asset
symbols before showing the selected asset's networks. The action catalog carries
chain-specific balances, send capability, and optional KRW unit price; a failed
balance query is distinguished from a real zero. The send amount form remains
visible at zero balance and switches between KRW and token units, while its CTA
stays disabled. Address/phone route selection is implemented after a valid
amount, but phone execution remains fail-closed until the dedicated took
phone-escrow adapter is connected. The execution slice supports EVM native and
allowlisted ERC-20 tokens plus allowlisted Solana SPL, TRON TRC-20, and XRPL
issued tokens, including chain-native fee preparation, KYT, host confirmation,
SAR key-core signing, exact signed-payload verification, broadcast, and
intent/execution audit. XRP destination tags, trust-line checks, Solana ATA
creation rent, and TRON maximum fee limits are handled explicitly. A
funded development wallet plus configured TranSight credentials are required
for a live-send smoke test; without KYT credentials the flow intentionally
blocks. Token inventory, price coverage, and direct ERC-20 execution are
implemented. Permit/Solana/TRON relay execution, phone-escrow execution,
native non-EVM coin sends, and confirmation reconciliation remain open. Every
direct token send still requires the chain's native fee asset even when a relay
quote reports that the asset is eligible.

The non-EVM SDK addition currently leaves four moderate production-dependency
audit findings in the `@solana/web3.js` 1.x → `jayson` tree (`stream-json` and
legacy `uuid`). npm offers only an invalid major downgrade as an automatic
fix. This is recorded rather than force-fixed; migration to the maintained
Solana client stack or a compatible upstream remediation is required before a
production dependency sign-off. No high or critical finding was reported.

The current code silently exchanges the already active Reference Host customer
session for a one-time, purpose-bound wallet-authorization proof after initial
phone verification. It then shows the real 12-word BIP-39 phrase only in the
host security surface, verifies three randomly selected words, and binds
provisioning to short-lived host and key-core proofs. A fresh browser
verification of this updated ceremony is recorded separately by the repository
checks rather than by sending an automated SMS to a synthetic phone number.

## Deliberate development limitation

The Reference Host still uses the loopback-only development
institution key compiled into its local browser demo. That key is not an
institution integration credential and must never be deployed. A real tenant
host backend supplies its private institution credential and creates the WSS
session server-to-server. The development host's silent session assertion is
not real Kiwoom PIN or biometric authentication; a production host must issue
the same contract from its approved customer session and invoke its
authentication SDK whenever policy requires step-up.

The Kiwoom manifest now selects `supabase-auth-solapi`. Supabase Auth owns OTP
generation and verification, while the deployed Send SMS Hook delivers the
code through SOLAPI and never stores it. The linked development project has the
Hook and provider secrets activated. If delivery is unavailable, the sandbox
makes that failure explicit and falls back to `development-sms`, which reveals
a test code only to an allowed loopback WebView origin. Production never falls
back. Broader network/device abuse controls, approved copy, retention policy,
and operational monitoring remain production gates. Automated checks do not
send to a synthetic phone number; live receipt should be verified through the
Kiwoom onboarding screen with an authorized test handset.

No secret value belongs in this document, Git, a browser bundle, or chat.
