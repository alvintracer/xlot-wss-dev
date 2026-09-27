# took WSS

Independent, multi-tenant Institutional Wallet Service Layer for embedding non-custodial wallet experiences inside financial applications.

The platform is built once and configured per institution. `kiwoom` is the first tenant profile. took SAR is the default key adapter; Thirdweb User Wallet and FSL MPC are approved alternatives. A tenant can omit SAR by removing both the `took-sar` adapter and `sar-recovery` module from its manifest.

Every project selects a versioned recovery requirement at creation time: `sar-required`, the recommended `sar-preferred`, or `provider-recovery-accepted`. Policy changes apply to newly provisioned wallets. Existing wallets keep their pinned adapter and policy version until an explicit, customer-approved wallet migration completes.

## Workspace

- `apps/wallet-webview` — institution-embedded wallet experience
- `apps/reference-bank-host` — reference financial app hosting the WebView
- `apps/studio` — tenant/module configuration viewer and future control plane
- `services/institution-bff` — short-lived institution sessions and signed runtime bootstrap
- `services/institution-bff/src/stablecoinRegistry.ts` — curated chain-specific stablecoin contracts, mints, issuers, and canonical/bridged classification
- `services/institution-bff/db` — WSS identity, account linking, wallet ownership, encrypted development-envelope, consent, and audit migrations
- `supabase/functions/wss-dev-sar-vault` — read-only, development-only encrypted SAR-envelope retrieval after session and ownership verification
- `supabase/functions/wss-auth-send-sms` — Supabase Auth Send SMS Hook that delivers Auth-owned OTPs through SOLAPI
- `supabase/functions/wallet-price-quote` — server-side Bonanza K-VWAP-first quote gateway with CoinGecko then CoinMarketCap market-reference fallback
- `supabase/functions/kyt-screen` — TranSight KYT gateway that fails closed when the provider is unavailable
- `packages/contracts` — versioned manifests, session, and WebView bridge contracts
- `packages/host-sdk` — host-to-wallet WebView/iframe SDK
- `packages/key-adapters` — SAR/MPC/FSL MPC adapter boundary
- `packages/module-registry` — composable feature catalog and dependency validation
- `packages/ui-kit` — WSS-owned UI primitives
- `packages/ops-ui` — tookpay deck-derived tokens for Studio, dashboards, portals, and outer host frames
- `tenants/kiwoom` — first institutional profile and screenshot-derived UI source of truth
- `tenants/kiwoom/host-chrome` — Kiwoom-owned root header and five-tab app navigation for the Reference Host
- `tenants/kiwoom/presentation` — lazily loaded Kiwoom wallet presentation package
- `tenants/reference-bank` — generic bank reference profile
- `docs/architecture/0004-host-shell-and-focused-wallet-flows.md` — host tab, focused-flow, and future menu policy

## Local start

```bash
npm install
npm run dev
```

- Reference bank host: `http://localhost:5173`
- Wallet WebView: `http://localhost:5174`
- Studio: `http://localhost:5175`
- Institution BFF: `http://localhost:4100`

The host starts with the Kiwoom tenant and can request took SAR, Thirdweb User Wallet, or FSL MPC. The browser-to-BFF session call is a local reference flow only. In production, a financial institution backend creates the session and gives the short-lived token to its native app.

The Kiwoom manifest prefers Supabase Auth phone verification with the SOLAPI
Send SMS Hook. The linked `xlot-wss-dev` project has that path activated;
sandbox mode visibly falls back to the loopback-only development code only when
delivery is unavailable, while production always fails closed. See
`supabase/README.md` for activation and rotation instructions.

When `.env.local` contains the isolated development Session pooler URL plus
independent WSS session and subject-HMAC secrets, the BFF persists profiles,
wallet slots, public address rows, encrypted SAR envelopes, and audit events in
`xlot-wss-dev`. The Reference Host's compiled institution key is deliberately a
loopback-only demo credential; it is never a production integration pattern.

## Verification

```bash
npm run check
```

The boundary check rejects imports or path references to `traverse-wallet`.

With `npm run dev` running, verify the complete Reference Host → session API → bootstrap → Kiwoom WebView → bridge event flow in installed Chrome:

```bash
npm run verify:host
```

Verify the Studio new-project recovery-policy presets and existing-project policy-version transition:

```bash
npm run verify:studio
```

Verify the focused Kiwoom wallet slice—host authentication, actual host-key-core SAR creation, independent wallet-slot selection, selected-wallet network capabilities, provider-aware KRW state, real receive QR, and balance-backed send safety gates:

```bash
npm run verify:kiwoom-wallet
```

Run both browser stories with `npm run verify`.

The browser check also verifies that W00 does not contain a fabricated portfolio, has no horizontal overflow at 320, 360, 390, and 430 CSS pixels, and is wrapped exactly once by the Kiwoom 60px root header and 54px five-item root navigation. Set `WSS_CHROME_PATH` when Chrome is installed elsewhere.

The local Reference Host now creates real random wallet entropy, real multichain addresses, and real Shamir 2-of-3 shares inside a development-only key core. It encrypts every share in the customer-side key core before sending opaque envelopes through WSS/BFF. With `DATABASE_URL` configured, the development BFF persists WSS profiles, wallet slots, public addresses, audit events, and those ciphertext envelopes in the hard-marked `xlot-wss-dev` project. Plaintext shares and the non-exportable envelope key stay in volatile JavaScript memory, so this is not production custody or durable device-loss recovery. The BFF rejects both in-memory and development-database providers in production, and the Reference Host neither creates a wallet nor auto-approves authentication in production. Production operation requires an institution authentication SDK, an approved native key core with independently controlled encrypted factor stores and signed attestation, plus K-VWAP, KYT, quote, approval, and execution adapters.

## Design authority

- WSS management surfaces use the tookpay UI / tookpay deck visual language through `@took-wss/ops-ui`.
- Customer-facing wallet surfaces use the corresponding `tenants/<tenant>/ui-kit` references and agent guide.
- Tenant presentations are selected by `manifest.presentation.profileId`; shared runtime code must not branch on a tenant ID.
- Identity and institution account linkage follow `docs/architecture/0002-wss-identity-and-account-linking.md`.
- Recovery policy versioning and wallet migration follow `docs/architecture/0003-key-recovery-policy-lifecycle.md`.
- Host navigation and focused wallet flows follow `docs/architecture/0004-host-shell-and-focused-wallet-flows.md`.
- Host-owned SAR creation and its production gate follow `docs/architecture/0005-host-sar-key-core-boundary.md`.
- The shared proposal/early-function Supabase boundary follows `docs/architecture/0006-xlot-wss-development-backend.md`.
- Current non-secret development deployment state is recorded in `docs/DEVELOPMENT_ENVIRONMENT_STATUS.md`.
- Stablecoin inventory, tenant policy, and capability levels are recorded in `docs/STABLECOIN_ASSET_POLICY.md`.
- Phone escrow execution, data boundaries, and activation gates are recorded in `docs/PHONE_ESCROW_EXECUTION.md`.
- The Kiwoom Super Wallet product model and customization decisions live in `tenants/kiwoom/KIWOOM_WALLET_PRODUCT_PROFILE.md`.
- For Kiwoom work, begin with `tenants/kiwoom/ui-kit/kiwoom-wallet-ui-guide/AGENT_IMPLEMENTATION_BRIEF.md`.
- See `docs/DESIGN_GOVERNANCE.md` before adding or changing UI.
