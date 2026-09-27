# Kiwoom Digital Wallet product profile

- Profile: `kiwoom-simple-mode-v1`
- Status: development contract
- Updated: 2026-09-27
- Design authority: `ui-kit/kiwoom-wallet-ui-guide/`

## 1. Core product model

Kiwoom Digital Wallet is the first tenant presentation of the reusable took WSS Super Wallet.

The word **slot** always means one independently managed wallet. A chain or network is not a slot.

```text
Super Wallet
├── Wallet slot A — took SAR — Ethereum, Polygon, Solana, Bitcoin, ...
├── Wallet slot B — FSL MPC — Ethereum, XRP, ...
└── Wallet slot C — Thirdweb MPC — supported networks by provider policy
```

Each wallet slot has its own `walletId`, label, key adapter, origin, recovery policy, addresses, assets, and network capabilities. Assets are scoped to a `walletId` and network. Adding a network capability to a wallet does not create another wallet slot.

## 2. Kiwoom root experience

The wallet follows the interaction model of selecting a securities account:

1. The customer selects one wallet from the wallet selector.
2. WSS fetches and renders only that selected wallet's total KRW valuation and assets.
3. `채우기`, `보내기`, `환전하기`, `툭받기`, and `툭주기` are all scoped to the selected wallet.
4. The root shows the selected wallet's public address groups even when it owns no assets. Ethereum, Polygon, Arbitrum, Base, and BNB Chain are grouped as one EVM address; Solana, Bitcoin, TRON, and XRP remain separate.
5. Network selection inside a wallet action is capability metadata for the selected wallet, not a list of wallet slots.
6. `지갑 추가하기` creates another independent wallet slot in the same Super Wallet container.

The host owns the root Kiwoom header and five-tab navigation. Provisioning, recovery, wallet selection sheets, and transfer sheets use focused mode according to ADR-0004.

### Initial identity path

The target Kiwoom WSS path does not silently skip profile creation. Before the first wallet slot is provisioned it performs:

1. name and birth-date entry;
2. carrier selection and mobile-number entry;
3. WSS-issued SMS possession verification;
4. creation of a random WSS `user_profile_id` UUID;
5. session-bound issuance of a one-time Kiwoom wallet-provisioning proof without
   a duplicate customer-confirmation screen;
6. wallet start-method selection;
7. for a new SAR wallet, host-only display and confirmation of the actual
   12-word recovery phrase; and
8. wallet provisioning with one-time host proofs.

Name and birth date remain self-asserted in this flow; WSS SMS proves possession of the entered number, not carrier-backed legal identity. The short-lived WSS session already carries the versioned Kiwoom subject HMAC, so successful phone verification links that subject to the new profile. The host still issues the required short-lived, one-time wallet-provisioning proof, but the Reference Host derives it from the already active customer session without displaying a second confirmation screen. A production host may require PIN or biometric step-up when its institution policy calls for it. If a pre-existing standalone WSS profile and institution profile must be combined later, that remains the explicit high-assurance linking/merge ceremony in ADR-0002. Adding another wallet slot to an already verified profile must not repeat the full registration flow.

Other tenants may choose the institution-first path when their authenticated host assertion meets policy. The onboarding mode is a project policy choice, not tenant-specific branching in the shared runtime.

## 3. Wallet-slot creation options

| Customer choice | Slot adapter | Origin | Result |
| --- | --- | --- | --- |
| 새 지갑 만들기 | took SAR | `created` | A new non-custodial wallet slot protected by SAR |
| 니모닉으로 가져오기 | took SAR | `imported` | An existing non-custodial wallet becomes a new SAR-protected slot |
| 개인키로 가져오기 | took SAR | `imported` | A key-scoped wallet becomes a new SAR-protected slot; only compatible networks may be enabled |
| Thirdweb MPC 지갑 | Thirdweb User Wallet | `created` | A new provider-controlled non-custodial slot |
| FSL MPC 지갑 | FSL MPC | `created` | A new FSL MPC slot |

SAR is the tenant default, not a universal requirement. Kiwoom may allow SAR, Thirdweb MPC, and FSL MPC together. The selected key-management policy is pinned per wallet slot so a later tenant-policy change does not silently change existing wallets.

## 4. Secure import boundary

Mnemonic and private-key text must never be entered into or passed through the WSS WebView, Institution BFF, analytics, logs, or tenant database.

The import sequence is:

1. WSS asks the host for `mnemonic` or `private-key` secure import.
2. The native host opens its approved key-core input surface.
3. The key core validates and imports the secret locally.
4. The host returns only an opaque, short-lived `secureImportRef`.
5. WSS uses that reference to request creation of one imported SAR wallet slot.

The current Reference Host keeps this route fail-closed and never asks for a secret; it does not simulate a successful import. Production must bind the opaque reference to tenant, customer, device, import method, expiry, nonce, and one-time consumption. For a private-key import, compatible network capabilities must be derived by the trusted key core rather than accepted from browser input.

## 5. Runtime and API shape

The ready wallet-home payload contains:

- `wallets`: lightweight summaries for every wallet slot in the Super Wallet;
- `wallet`: the currently selected wallet slot;
- `assets`: assets belonging only to the selected wallet;
- `receiveAssets`: protocol-v1 name for the zero-balance-inclusive action catalog. Each row carries the chain-specific asset identity, decimals, balance state, available amount, send capability, and optional KRW reference price used by both receive and send;
- `networks`: network capabilities belonging only to the selected wallet;
- `totalFiat`, `valuation`, and `recovery`: selected-wallet state only.

Switching wallets calls `GET /v1/wallets/:walletId/home`. The server resolves wallet ownership from the authenticated WSS session and returns the selected wallet details plus the wallet-slot summary index. A client-provided wallet ID is never sufficient authorization.

The development query adapter reads each registered address from its real chain endpoint and returns positive native or configured stablecoin balances. The action catalog remains separate so a supported zero-balance asset can still be selected without adding zero rows to the home portfolio. A failed chain scan is marked `balanceStatus: unavailable`; it is not silently turned into zero. KRW valuation and per-asset reference prices call the server-side `wallet-price-quote` gateway: Bonanza K-VWAP is preferred when configured, followed by CoinGecko and CoinMarketCap market-reference fallbacks for symbols still missing. Neither fallback is presented as K-VWAP.

The Kiwoom manifest currently enables USDC, USDT, RLUSD, PYUSD, USDG, DAI,
USDS, FDUSD, USDP, GUSD, XUSD, EURC, JPYC, and XSGD. The shared registry
resolves those symbols to 45 chain-specific mainnet deployments and marks issuer-native versus
bridge/exchange-wrapped forms. EVM stablecoins can use the direct ERC-20 send
path. Allowlisted Solana SPL, TRON TRC-20, and XRP Ledger issued assets use
their chain-native prepare, host-sign, exact-payload verification, and broadcast
paths. XRP Ledger issued assets such as RLUSD, USDC, and XSGD require a trust
line before receipt or transfer.

Provisioning calls `POST /v1/wallets/provision` with a key adapter and a provider-new, host-secure-new, or opaque secure-import source. A host-secure-new source contains only the public address groups, an opaque key-core reference, and non-secret SAR setup metadata. Every successful call adds one wallet slot; it does not add one slot per network.

The call also carries a short-lived host-authorization proof bound to the
current session and `wallet-provisioning` purpose. A host-secure-new source
adds a key-core attestation bound to the canonical hash of the public
registration. The BFF persists only the proof UUIDs and rejects reuse for a
different wallet operation.

## 6. Shared WSS versus Kiwoom customization

Reusable WSS responsibilities:

- wallet-slot identity and selected-wallet query contract;
- SAR, Thirdweb, and FSL key-adapter boundaries;
- secure host bridge and secret-exclusion rules;
- module, recovery-policy, provider, audit, and execution contracts;
- Super Wallet orchestration without tenant-specific branching.

Kiwoom tenant responsibilities:

- account-like wallet selector and wording;
- Kiwoom asset-tab layout, typography, sheets, and host chrome;
- tenant-only customer branding: internal `took` package, protocol, and platform
  identifiers must never render in Kiwoom customer-facing WSS screens;
- Kiwoom customer authentication SDK integration;
- approved FSL, K-VWAP, TranSight, and host-app handoff configuration.

Kiwoom behavior stays under `tenants/kiwoom` or provider adapter packages. The shared WebView runtime must select the presentation from the signed manifest and must not branch on `tenantId`.

## 7. Current development boundary

The Reference Host now creates a real random SAR wallet in its
customer-side development key core. It shows the actual 12-word phrase only
in a host-owned security overlay and requires three random word positions to
be confirmed before registration. It derives the EVM, Solana, Bitcoin, TRON,
and XRP public addresses, performs an actual Shamir GF(256) 2-of-3 split,
verifies every valid two-share reconstruction, and registers only public
addresses with the BFF. Address rows and address-based receive are therefore
usable in the development flow. The Reference Host silently exchanges its
already active customer session for the same one-time wallet-provisioning proof,
so initial phone onboarding proceeds directly to the wallet start-method screen.
This development session assertion must not be treated as production identity
assurance; a production host can invoke its PIN/biometric SDK when policy
requires step-up.

When the development database is connected, the BFF persists the Kiwoom WSS profile, wallet slot, public address rows, audit event, three customer-side AES-GCM recovery-envelope ciphertexts, and only the UUIDs of the consumed host proofs in `xlot-wss-dev`. The plaintext shares, recovery phrase, proof strings, signed raw transactions, and envelope key are not persisted; key material remains in volatile Reference Host memory and is lost on reload. This is therefore a real wallet/address, ceremony, proof-binding, ciphertext-persistence, and EVM-native transfer path, but not production storage or durable device-loss recovery. Production remains fail-closed without an approved native key core, independently controlled encrypted factor stores, institution/native device attestation, recovery-factor providers, and security review. The current A/B/C recovery screen records acknowledgement but does not yet enroll three independent durable factors.

The selected wallet now queries real native balances for Ethereum, Polygon, Arbitrum, Base, BNB Chain, Solana, Bitcoin, TRON, and XRP plus tenant-enabled stablecoins on EVM, Solana, TRON, and XRP Ledger. Receive and send both use `asset → network`: the first screen groups all deployments of the same symbol, and the next screen keeps the chain-specific asset ID distinct. Receive then renders an actual QR from the registered address and supports copy/share. Send keeps the asset/network/amount controls visible at zero balance, clearly reports an available amount of zero, and blocks progression rather than replacing the flow with an empty state. The amount field switches between exact token-unit input and KRW input using the catalog reference price without floating-point atomic-amount conversion.

After a valid amount, send offers a wallet-address route and a phone-number route. The address route is executable for EVM native, allowlisted ERC-20, Solana SPL, TRON TRC-20, and XRPL issued assets: actual fee preparation, expiring preparation, fail-closed KYT, a host-owned customer confirmation, SAR key-core signing, exact signed-payload verification, broadcast, and persisted intent/execution audit. XRPL address entry also accepts and reviews an optional destination tag. Solana includes destination associated-token-account creation rent when needed, while TRON labels its fee limit as a maximum rather than an exact charge. The phone route now has a WSS-native sender implementation for Ethereum, Polygon, Arbitrum, and Base: live sender-pays fee calculation, native or ordered ERC-20 approve/deposit signing, exact payload verification, confirmed `Deposited` event matching, encrypted recipient handling, and tenant-branded SOLAPI delivery. It remains unavailable until the WSS claim URL and matching contract signer are explicitly configured, preventing funds from being deposited into an escrow that WSS cannot release. The route is never passed to the ordinary address-transfer endpoint. The deployed price gateway prefers Bonanza K-VWAP and otherwise labels CoinGecko or CoinMarketCap output as a market reference. The deployed KYT gateway blocks address sending when TranSight is unavailable.

Remaining development gaps are explicit: the phone recipient-claim/OTP/KYT/relay and refund gateway with its matching signer, phone-delivery retry, permit/Solana/TRON sponsorship execution, XRP trust-line setup, durable transfer resumption after a BFF restart, general transaction confirmation/reconciliation, native non-EVM coin sends, and production provider secrets. The gas-support sheet therefore distinguishes relay eligibility from sponsorship actually applied and does not claim sponsorship for a direct transfer.

The Kiwoom phone-first profile path is implemented against `xlot-wss-dev` and selects `supabase-auth-solapi`. Registration PII is AES-256-GCM encrypted before persistence, the phone lookup uses a separate keyed digest, Supabase Auth owns code generation and verification, and the activated SOLAPI Send SMS Hook only delivers the Auth-owned code. WSS keeps neither the code nor its MAC on that path. The BFF matches the Auth-verified number to the tenant-scoped lookup digest, persists only a domain-separated keyed Auth-subject digest, and then atomically creates the random profile UUID, encrypted private attributes, consent, external institution link, and audit event before purging the intent PII. If delivery is unavailable, the isolated sandbox visibly falls back to the loopback-only MAC-based development code; production never falls back. This still proves phone possession, not carrier-backed legal identity.

## 8. Change record

- 2026-09-27: Defined `wallet = slot`; removed the earlier interpretation of a chain as a slot.
- 2026-09-27: Added secure mnemonic/private-key import into a new SAR wallet slot.
- 2026-09-27: Added independent SAR, Thirdweb MPC, and FSL MPC wallet-slot creation and selected-wallet querying.
- 2026-09-27: Added an always-visible five-row address view: one shared EVM address group plus Solana, Bitcoin, TRON, and XRP.
- 2026-09-27: Added actual Reference Host SAR creation, five-chain address derivation, all-pairs 2-of-3 recovery verification, and public-address registration. Production storage and attestation remain gated.
- 2026-09-27: Added the `xlot-wss-dev` persistence contract for WSS UUIDs, wallet slots, public addresses, audit events, and customer-side encrypted SAR envelopes. Production SAR remains a separate deployment and architecture.
- 2026-09-27: Implemented manifest-selectable `phone-first` and `institution-first` onboarding, with the Kiwoom development profile using encrypted phone-possession registration before its first wallet slot.
- 2026-09-27: Switched the Kiwoom phone-verification preference to Supabase Auth with a Standard Webhooks-verified SOLAPI Send SMS Hook, retaining only an explicit sandbox fallback until provider secrets are activated.
- 2026-09-27: Activated the SOLAPI secrets and Supabase Auth Send SMS Hook in `xlot-wss-dev`; live message receipt remains a handset-level smoke test.
- 2026-09-27: Added explicit host customer confirmation, real 12-word host-only backup and three-word verification, payload-bound SAR attestation, and one-time wallet authorization proof enforcement.
- 2026-09-27: Removed the redundant post-SMS host-confirmation UI from initial wallet onboarding. The Reference Host now issues the same session/purpose-bound one-time proof in the background and opens the wallet start-method screen directly; proof enforcement remains unchanged.
- 2026-09-27: Rewrote recovery and secure-import copy in customer language and removed visible `took` branding from WSS customer surfaces. Internal package and bridge identifiers remain implementation-only.
- 2026-09-27: Replaced the placeholder action sheet with Kiwoom-style focused `채우기` and `보내기` flows, including actual address QR/copy/share, balance-backed asset selection, KRW display, gas-support detail, KYT state, host confirmation, and receipt UI.
- 2026-09-27: Added real nine-network native-balance reads, provider-aware KRW valuation, and an EVM-native prepare/sign/broadcast path. Transfer intent and execution audit tables were applied to `xlot-wss-dev`; secrets and raw signed transactions are excluded.
- 2026-09-27: Deployed `wallet-price-quote` and fail-closed `kyt-screen` to `xlot-wss-dev`. Bonanza and TranSight production credentials remain an explicit configuration gate.
- 2026-09-27: Added a tenant-selectable registry of 14 stablecoins across 45 mainnet deployments, token-aware balance discovery and receive selection, expanded KRW market-reference coverage, and actual allowlisted EVM ERC-20 prepare/sign/verify/broadcast support. Non-EVM token signing and relay execution remain gated.
- 2026-09-27: Changed receive and send selection to asset-first then network, enriched the zero-balance action catalog with exact amounts, capability state, and KRW reference price, kept the send amount form visible at zero balance, and added token/KRW plus address/phone route selection. Phone escrow execution remains fail-closed pending its dedicated adapter.
- 2026-09-27: Enabled allowlisted Solana SPL, TRON TRC-20, and XRPL issued-token prepare/sign/verify/broadcast paths. Added chain-specific address validation, optional XRP destination tags, Solana ATA-rent accounting, TRON maximum-fee labeling, and host-key-core Solana/XRPL signing tests.
- 2026-09-28: Added the local 21-symbol coin/stablecoin icon catalog and a Bonanza K-VWAP → CoinGecko → CoinMarketCap KRW fallback chain using stable provider IDs.
- 2026-09-28: Added the WSS phone-escrow sender path, encrypted recipient table, ordered EVM batch signing, receipt/event verification, and tenant-branded SOLAPI delivery. Real-value activation remains fail-closed until the WSS claim gateway and matching signer are configured.
