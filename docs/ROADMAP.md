# took WSS implementation roadmap

## Foundation — completed in this bootstrap

- Independent workspace, build, and dependency boundary
- Versioned tenant, session, and WebView bridge contracts
- Short-lived signed institution session and runtime bootstrap
- Generic Reference Bank host and independent wallet WebView
- Product Composer with module dependency validation
- Key adapter descriptors for took SAR, Thirdweb User Wallet, and FSL MPC
- First `kiwoom` profile with SAR as default plus FSL WIS, TranSight, and K-VWAP
- WSS-owned identity/account-linking schema with separate institution subjects and wallet ownership
- New-project recovery policy presets with immutable policy versions and explicit wallet migration records
- Provider adapter and policy-first transfer state contracts
- Manifest-driven host/root/focused-flow navigation policy with a versioned shell bridge

## Phase 1 — generic WSS vertical slice

1. ✅ Replace sample balances with a tenant-scoped Wallet Query adapter.
   - Runtime bootstrap now carries explicit `absent`, `empty`, `ready`, or `unavailable` wallet-home state.
   - Sandbox defaults to W00 `absent`; it never fabricates balances or assets.
   - Host capabilities and presentation ownership are validated before tenant UI renders.
2. ◐ Implement wallet provisioning through a client-side key adapter. Production hardening remains the immediate release gate before executable transfer UI.
   - SAR is the current default; Thirdweb User Wallet and FSL MPC are selectable alternatives.
   - Studio offers `sar-required`, `sar-preferred`, and `provider-recovery-accepted` at project creation.
   - Existing wallets pin their creation-time policy; later changes create a new policy version and migration flow.
   - Identity, registration, wallet, SAR policy, provider-link, consent, and audit table boundaries are defined.
   - The Reference Host now performs actual random took SAR creation, took-compatible EVM/Solana/Bitcoin/TRON/XRP address derivation, Shamir GF(256) 2-of-3 splitting, all-pairs reconstruction checks, and public-address registration.
   - Secret entropy, plaintext recovery shares, and the envelope key stay inside the host key core. The WSS WebView and BFF receive an opaque handle, public addresses, customer-side encrypted recovery envelopes, and non-secret recovery metadata.
   - The isolated `xlot-wss-dev` project now has the remotely applied, hard-marked WSS schema, persistent UUID/profile/wallet/address/audit repositories, and development-only encrypted-envelope storage. All WSS tables have RLS enabled and no `anon`/`authenticated` table grants.
   - The deployed, read-only development SAR Edge Function verifies the WSS session and wallet ownership before returning ciphertext. It has no plaintext-share, decryption-key, or reconstruction API.
   - The Kiwoom browser vertical slice has persisted a real SAR wallet plus an FSL MPC slot, survived a BFF restart, restored nine network rows/five address groups, and retrieved the three encrypted SAR envelopes through the deployed ownership-checked Edge Function.
   - The generic manifest now selects `phone-first` or `institution-first`, plus a phone-verification provider. The Kiwoom profile prefers Supabase Auth with the activated SOLAPI Send SMS Hook: Auth owns the OTP, WSS verifies the Auth-returned phone against its keyed lookup, and only a domain-separated keyed provider-subject digest is retained. The isolated sandbox visibly falls back to MAC-only loopback verification only when delivery is unavailable; production fails closed. Broader abuse controls, retention approval, monitoring, and explicit institution-subject linking/merge ceremonies remain production work.
   - Next key-core slice: durable device-key protection for development recovery, followed by native/hardware-backed storage, independently controlled durable factor stores, signed one-time host attestation, and an end-to-end recovery ceremony.
   - The Kiwoom development slice covers host authentication, actual new-SAR creation, a fail-closed secure-import entry path, idempotent sandbox registration, and independent wallet slots with per-wallet network capabilities.
   - The development BFF never receives a seed, private key, plaintext recovery share, completed SAR secret, or envelope key and remains unavailable in production. It does not fabricate balances.
3. ◐ Add receive/send flows, KRW input, quote expiry, KYT decision, customer approval, and receipt screens.
   - Address-based receive exposes the selected wallet's real public address after key-core registration.
   - Send network selection fails closed until balance, quote, KYT, and approval are available.
4. Add audit event references without storing signing material.
5. Add Android/iOS native WebView wrappers using the same bridge contract.
6. Add browser and native end-to-end tests for origin, nonce, expiry, and replay rejection.

Current browser coverage includes Reference Host session issuance, signed bootstrap, encrypted phone-first registration and possession verification, profile-based Kiwoom presentation loading, root/focus shell delivery, host authentication, actual host-key-core SAR creation, multi-wallet-slot provisioning and selection, real receive-address display, send gates, and 320/360/390/430 overflow checks. Unit coverage verifies registration normalization/cryptographic boundaries, distinct wallet generation, and every 2-of-3 share pair. Security lifecycle cases in item 6 remain open.

## Phase 2 — took SAR production hardening

1. Independently review and harden the complete customer-device SAR backup and recovery ceremony delivered in Phase 1.
2. Physically separate share services and bind every operation to tenant, user, wallet, device, and challenge.
3. Add recovery rate limits, independent factor verification, and audit evidence.
4. Add Super Wallet connect/import/migrate flows without exposing key material to WSS servers.

## Phase 3 — institutional providers

1. TranSight KYT adapter with fail-closed policy and contract tests.
2. Bonanza K-VWAP adapter with source count, freshness, TTL, and receipt evidence.
3. Generic execution adapter for chain capability and fee abstraction.
4. Webhook signing, delivery retries, reconciliation, and operations console.

## Phase 4 — Kiwoom × FSL branch

1. Bind the Kiwoom host session and customer reference contract.
2. Implement the FSL MPC and FSL WIS adapters behind the generic contracts.
3. Map FSL chain/fee capabilities into the WSS capability registry.
4. ◐ Apply the approved Kiwoom bank-app design system and accessibility requirements.
   - W00/W01 state presentation is isolated in `tenants/kiwoom/presentation` and directly consumes the supplied guide tokens/CSS.
   - The host-owned 60px root header and five-item 54px root navigation are isolated in `tenants/kiwoom/host-chrome` and selected by presentation profile.
   - Browser verification asserts exactly five host tabs, `자산` as the active root tab, no sixth wallet tab, and the measured header/navigation heights.
   - Root screens retain host navigation; wallet creation, authentication, recovery, receive, and send use focused mode without host chrome.
   - The wallet home treats one independent wallet as one slot, renders only the selected wallet's assets, and exposes its EVM, Solana, Bitcoin, TRON, and XRP support as network capabilities inside wallet actions.
   - Official font/assets and device-level comparison remain required before pixel-perfect sign-off.
5. Run the full flow: session → wallet → K-VWAP → KYT → approval → FSL execution → receipt → recovery.

Kiwoom-specific behavior must remain in `tenants/kiwoom` or an FSL adapter package. It must not create a fork of the wallet WebView.
