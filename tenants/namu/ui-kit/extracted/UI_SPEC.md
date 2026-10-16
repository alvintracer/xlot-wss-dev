# Namu UI implementation map

## Scope and authority

42 renamed screenshots are recorded in `reference-manifest.json`; `screen-map.json` classifies each. The supplied PNG captures have the highest visual weight. JPEG keyboard/authentication images have structural weight only. No Figma file or production font was supplied. The Namu wallet is a new WSS extension derived from `R033` and `R032`.

## Main cases

| Case | Evidence | View | Status |
| --- | --- | --- | --- |
| `namu-investment` | R033, R032 | Host header + wallet card and asset rows | Draft |
| `namu-bottom-nav` | R003, R019, R020, R032 | Host-owned persistent navigation | Wallet preview uses six controls; right layered icon omitted per user direction |
| `namu-keypad-light` | R035 | Review-only transaction number pad | Draft |
| `namu-keypad-dark` | R041 | Review-only secure keypad structure | Draft, host SDK required |
| `namu-search-keyboard` | R037 | OS keyboard evidence | Platform-owned |
| `namu-sheet` | R018, R022 | Wallet selector and action sheet language | Proposed extension |

The comparison width of 430 CSS px is estimated from 1290-pixel PNGs. Keep screenshot status bars and host navigation out of wallet-only crops. The production font and exact viewport are unresolved.

## Implementation

Runtime token source: `design/tokens.css`, imported by the Namu presentation and host styles. Components: `tenants/namu/presentation/src/` and `tenants/namu/host-chrome/src/`. Namu remains an opt-in presentation profile; tenant policy and server activation are pending. Review data are synthetic and never enter production packages.

## Interaction

Bottom navigation is host-owned. Sheets belong to the wallet and close on Escape/backdrop/close button with focus return. Host secure input remains host-owned. The visual numeric pads in review do not handle credentials. Namu's green is for action confirmation; positive/negative financial colors stay red/blue as observed.

## User-directed service extension · 2026-10-10

Below the wallet payment section, the Namu draft shows a **서비스** card with Bithumb and Coinone logo tiles. Each tile opens a three-step connection flow for exchange login, wallet address registration, and result confirmation. This is a wallet extension requested by the user, not a screen observed in the Namu references. The two small logo images were copied from the original took! project's `public/icons/exchanges/`; they are not Namu-supplied assets.

## Android device-validation extension · 2026-10-11

The Namu Android shell at `apps/namu-android/` uses the same signed-session host and wallet WebView. On Android, the service flow opens Bithumb/Coinone in a managed browser. A small router panel appears on the exchange with the active tenant's logo and color. Coinone starts directly at `/balance/transfer/withdrawal-address`; an unauthenticated customer can log in and return there without visiting the tax page. After login, the router chooses the selected asset, fills the selected wallet's public EVM address and label, presses Add, opens additional information, selects MetaMask, accepts the registration consent, and starts the connection. Coinone's personal-wallet quick registration is unavailable to mobile web, so the managed browser sends a desktop User-Agent and the address-book page also exposes desktop browser signals. The exchange calls `wallet_requestPermissions` and `personal_sign`; an injected EIP-1193 provider returns the selected public address and forwards the signing challenge to the host. The host rechecks wallet ownership against the signed session and asks the customer to approve before signing locally with SAR or through the matching thirdweb account. The router never receives a mnemonic, private key, or signing material. The address-book page and MetaMask method sequence were observed on a logged-in Android device on 2026-10-11; completion of the signed registration and Bithumb flow still require device verification. The card sheet reads a prepared ISO-DEP card via the original took! native card protocol and stores only its public identity locally. NFC card payment remains unavailable until the card account is cryptographically bound and the WSS payment adapters support it. The PWA keeps its browser-only preview behavior.

## Run and review

Use `npm run ui:tenant -- review --tenant namu` for the development-only entry. `capture --tenant namu --case <id>` saves an actual image, `compare` records metrics without granting approval, and `report` writes `../.artifacts/latest/report.html`. The five registered case IDs and input states are in `../qa/cases.json`. `npm run ui:tenant -- verify --tenant namu` checks source hashes and capture coverage. Production builds contain the Namu presentation profile but no synthetic review entry or reference screenshots.

## Limits

Screenshot-only extraction cannot verify animations, official font metrics, icon vectors, physical safe area, or bank production UI behavior. Do not mark pixel-perfect or approved until device comparison and human review.
