# Vercel mobile preview

The isolated WSS proposal environment is deployed as one Vercel project:

- Kiwoom mobile host: `https://took-wss.vercel.app/kiwoom`
- app-only mobile view: `https://took-wss.vercel.app/kiwoom/app`
- same-origin WSS WebView: `https://took-wss.vercel.app/kiwoom/wallet`
- JB mobile host: `https://took-wss.vercel.app/jb`
- JB app-only view: `https://took-wss.vercel.app/jb/app`
- JB same-origin WebView: `https://took-wss.vercel.app/jb/wallet`
- Namu mobile host: `https://took-wss.vercel.app/namu`
- Namu app-only view: `https://took-wss.vercel.app/namu/app`
- Namu same-origin WebView: `https://took-wss.vercel.app/namu/wallet`
- Shinhan mobile host (configured for next deployment): `/shinhan`
- Shinhan app-only view (configured for next deployment): `/shinhan/app`
- Shinhan same-origin WebView (configured for next deployment): `/shinhan/wallet`
- same-origin Institution BFF: `https://took-wss.vercel.app/api/v1/*`
- reserved phone-escrow claimant surface: `https://took-wss.vercel.app/c/{claimCode}`

JB was added to the production alias on 2026-09-30. The `/jb/app` browser check at 390×844 and 1440×900 returned a JB app session (201) and runtime bootstrap (200), with the `jb-mobile-wallet-v1` presentation and no page errors or horizontal overflow. The account/card/wallet tabs, wallet creation entry, and host-chrome hiding were checked in Chrome. The JB manifest and icon URLs returned HTTP 200. The original Kiwoom app URL still returned HTTP 200. Actual device installation and bank-host integration remain separate validation steps.

Namu was added to the same development preview alias on 2026-10-07. At 390×844, `/namu/app` returned a Namu app session (201) and runtime bootstrap (200). Chrome rendered the empty-wallet state, the seven-button black bottom bar, the mint host and wallet canvas, and a green primary action without page errors. The first-wallet action opened a focused onboarding flow with the host chrome hidden; its carrier selection sheet opened. The manifest and wallet URL returned HTTP 200. The sandbox manifest uses the Kiwoom/JB WSS capability baseline at the user's direction. These checks do not represent NH투자증권 policy approval, funded-wallet testing, or real device and host integration.

Shinhan was added to the build configuration on 2026-10-18 and has not been deployed to the alias yet. The local preview build produced `/shinhan/app` and `/shinhan/wallet`, and a local browser session returned preview-session 201 and runtime-bootstrap 200. The finance root opened by default; its wallet action opened the shared WSS empty-wallet state with the host bottom navigation hidden. The Android debug APK built successfully, but installation on a physical device and institution-approved secure input remain unverified. The host-account transfer screens and photographed simple-password pad are local visual previews, while the WSS manifest uses the common sandbox capability baseline.

At the user's 2026-10-09 direction, `/namu/app`, `/jb/app`, and `/kiwoom/app` open tenant-colored install landing screens before requesting a wallet session. Their copy follows “나무/JB/키움 월렛”, “나무/JB/키움, 월렛을 품다”, and “편리한 송금과 환전을 경험하세요.” Android Chrome uses `beforeinstallprompt` when Chrome exposes it; other Android browsers offer a user-tapped Chrome intent link to the same URL. The install prompt cannot be called automatically after changing browsers and might not be available on a first visit. iPhone uses the browser Share → Add to Home Screen flow; page code cannot directly open the iOS installation ceremony. The side-by-side “모바일 웹으로 이용하기” button starts the existing web host, and installed standalone launches bypass the landing. A network-pass-through service worker scoped to each tenant stores no wallet or API responses. The host keeps one “안전한 지갑을 준비하고 있어요” loading layer until the wallet presentation mounts and emits its initial shell state, instead of exposing a second WebView loading page.

The claimant page is only a domain-separated holding surface. Keep
`WSS_PHONE_ESCROW_EXECUTION_ENABLED=false` until recipient OTP, recipient KYT,
claim resolution, authenticated signer relay, and refund have passed an
end-to-end smoke test.

`/kiwoom/app` uses the same reference host, wallet WebView, session API, and
host security screens as `/kiwoom`. It removes the simulator controls and
device frame. Desktop browsers keep a centered mobile aspect ratio; phone
browsers use the available viewport. The app opens automatically without a
preview code. The BFF assigns a random, signed, HttpOnly cookie to keep each
browser's sandbox customer separate across visits. If a valid code is already
stored in the tab from the original simulator, the app reuses that customer's
existing session instead.

## Deployed status

The Vercel project `took-wss` is linked to
`alvintracer/xlot-wss-dev`. The production alias was promoted from the verified
preview deployment on 2026-09-29. Remote smoke checks returned HTTP 200 for the
host, wallet, claimant surface, and BFF health endpoint; preview-session
creation returned HTTP 201 and runtime bootstrap returned HTTP 200 with the
Kiwoom tenant, `took-sar` default adapter, `registration-required` identity,
and an absent initial wallet.

The app-only route was also checked in Chrome at 1440×900 and 390×844. Both
rendered the wallet without the simulator panel or mock status bar. The desktop
wallet viewport measured about 415×900, the phone viewport filled 390×844,
and both completed session creation (201) and wallet bootstrap (200) without
browser errors. Reloading with a session-stored access code reopened the app.

The app-only host now publishes an install manifest with the name **키움 월렛**
and 192/512 px icons generated from the screenshot-derived Kiwoom logo crop.
This is a proposal preview asset, not an approved official brand file. Android Chrome can offer **Install app** from its browser menu. On
iPhone, open the URL in Safari and use **Share → Add to Home Screen**; iOS does
not expose the Chromium `beforeinstallprompt` event. The installed app starts
at `/kiwoom/app`. This is an installation shell, not an offline wallet: it
does not cache authenticated wallet/API responses or persist the development
Reference Host's in-memory SAR signing shares. Do not import a funded wallet
or rely on the preview PWA for durable recovery.

Coin and chain logos are served from the wallet WebView base
`/kiwoom/wallet/assets/`, not the domain root `/assets/`. The host and wallet
have separate build base paths, so UI asset URLs must resolve from the wallet
base declared in the wallet document rather than an origin-root constant.
After the 2026-09-29 promotion, the production alias returned HTTP 200 for the
manifest, both install icons, and representative coin/chain logos. A browser
smoke test confirmed that the displayed address, asset-selection, and
network-selection logos loaded from the wallet base. A separate secure-import
test completed mnemonic and EVM private-key imports, Ethereum receive QR and
address copy, and exact test-fixture cleanup; it found no raw imported secret
in the attestation or provisioning requests. This confirms the tested path,
not every possible mobile keyboard or paste format.

Provisioning now reopens the existing slot when the same customer's secure
mnemonic import resolves to the identical registered address set. The
development database also permits a separate customer profile to import the
same public address into its own independent wallet slot. This does not merge
identities, transfer history, or unlock another profile's SAR recovery data.
Rebinding profiles requires institution-backed identity confirmation, not a
preview cookie or phone number alone. The final registration step also
refreshes an expiring host proof and distinguishes expired import proof from a
general service failure.
The production alias was verified again on 2026-09-30 with a disposable
mnemonic: first import, same-mnemonic reimport, EVM private-key import, receive
QR, and exact fixture cleanup all completed. The reimport returned the existing
wallet slot instead of inserting another account.
Migration `0009_wss_nonexclusive_wallet_addresses.sql` was applied only to the
marked `xlot-wss-dev` database. A separate-profile duplicate-address insert
was verified inside a transaction and rolled back; the replacement uniqueness
constraint is tenant + wallet + chain, while address lookups retain an index.
The final production deployment was rechecked after this migration.

The direct-open route was checked again in fresh Chrome profiles at 1440×900
and 390×844. No preview-code input appeared. Each profile received a separate
HttpOnly cookie; reload reused that cookie, and both the initial and reloaded
flows returned session HTTP 201 and bootstrap HTTP 200 without browser errors.

The original `/kiwoom` simulator still requires an application preview code.
The code is not committed or written to this document. On the provisioned
development Mac, retrieve it from Keychain with:

```sh
security find-generic-password -a "$USER" -s took-wss-vercel-preview -w
```

## Required Vercel configuration

Set the project root to the repository root. `vercel.json` runs
`npm run build:vercel-preview`, which assembles the host and wallet under
separate base paths and exposes the BFF through a catch-all Node.js Function.

The following server-only variables are required in Preview and Production.
Copy values from the isolated `xlot-wss-dev` environment without printing or
committing them:

- `WSS_DEPLOYMENT_MODE=development-preview`
- `WSS_PREVIEW_ACCESS_CODE`
- `WSS_SESSION_SECRET`
- `WSS_SUBJECT_HASH_SECRET`
- `WSS_INSTITUTION_API_KEY`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `WSS_PII_ENCRYPTION_KEY`
- `WSS_SAR_V2_PHONE_SHARE_KEY`
- `WSS_SAR_V2_EMAIL_SHARE_KEY`
- `WSS_PHONE_LOOKUP_SECRET`
- `WSS_OTP_MAC_SECRET`
- server-side price, KYT, RPC, and 0x variables used by the enabled modules

Do not configure `WSS_WALLET_URL` for this combined deployment. The BFF derives
the same-origin `/<tenant>/wallet` URL from the trusted Vercel forwarding headers,
which also keeps branch preview deployments self-contained.

The public mobile host never receives the institution API key. A private
preview access code is exchanged server-side for a short-lived, tenant-bound
WSS session. The code is held only in browser session storage and must be
rotated if shared outside the intended review group.

## Limitations

This remains an `xlot-wss-dev` proposal sandbox, not a production financial
institution deployment. The Reference Host key core is browser-memory-only.
The SAR v2 PWA vault stores two encrypted shares in browser storage and uses
the master password or a device-bound PIN key to open them. Browser storage can
be cleared. New SAR enrollments use one master password for the local vault and
the password share used with phone or email verification in two-of-three recovery.
Wallets enrolled during the brief separate-password period still use their
distinct recovery password for the remote password share. See
[`SAR_V2_PASSWORD_DECISION.md`](SAR_V2_PASSWORD_DECISION.md) for the 2026-10-10 decision.
The phone and email stores
currently share this one development BFF and Supabase project, with separate
encryption keys and tables;
move them to independent factor services and stores before real-value use.
If remote enrollment is interrupted after the wallet is registered, the
`자가복구 관리` action reopens the encrypted local vault using the existing PIN or
master password, reconstructs the missing third share, and resumes enrollment. If
local browser storage is gone before remote enrollment finishes, the customer
must reimport the separately recorded recovery phrase or private key.
Transfer and exchange preparation state still has an in-process execution
component, so a serverless cold-instance change can interrupt a prepared action;
durable signed-intent reconstruction is required before treating Vercel as a
real-value execution runtime.
