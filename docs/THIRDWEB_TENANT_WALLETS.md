# Tenant thirdweb wallets

Kiwoom, JB and Namu share one WSS thirdweb project and the same wallet flow.
Each tenant keeps its own customer UUID namespace and provider link. The customer first completes
the tenant's customer information and phone verification. A returning customer's
verified name, date of birth and phone number map the institution session to the
existing tenant UUID. The flow then shows the existing wallet list for review and
loads all linked wallets together. Adding a wallet retains the existing list.

The UI calls this option **MPC 지갑 만들기**, as requested for the tenant preview.
The implementation uses thirdweb's in-app wallet. Its custody and recovery
architecture must be reviewed against the current thirdweb security description
before the label is approved for a production financial service.

## Configuration

Enable Google, Apple and email authentication on the shared WSS thirdweb project and allowlist the
wallet WebView's origin in its domain settings. Set these variables in the BFF
and deployment environment:

| Setting | Use |
| --- | --- |
| `WSS_THIRDWEB_CLIENT_ID` | Public SDK project identifier exposed through the tenant bootstrap response |
| `WSS_THIRDWEB_CLIENT_SECRET` | Server-only key for thirdweb user lookup |
| `WSS_THIRDWEB_WALLET_ADDRESS` | Project wallet address reserved for future server-wallet operations; never assigned to a customer |

The BFF exposes the shared client ID only when the matching server key is set.
Its existing `WSS_SESSION_SECRET` signs the short-lived wallet challenge, and
`WSS_SUBJECT_HASH_SECRET` hashes the verified thirdweb user ID. Both must remain
stable and server-only. A complete pair of
`WSS_THIRDWEB_<TENANT>_CLIENT_ID` and `WSS_THIRDWEB_<TENANT>_SECRET_KEY`
can override the shared project for one tenant later; an incomplete override
disables thirdweb for that tenant. Never put a secret key in a `VITE_` variable.

Apply `0021_wss_provider_link_history.sql` to the isolated WSS development
database before enabling the provider option. The current database provider is
explicitly development-only; production still requires an approved persistent
provider and institutional host.

## Connection and signing boundary

The WebView opens thirdweb's Connect Modal with only Google, Apple and email
for wallet creation, recovery and later signing reauthentication. The modal
owns its own email-code step when the customer chooses email. The WebView uses
the connected thirdweb account for EVM signing.

In an installed PWA, Google and Apple use thirdweb's same-tab redirect from the
top-level reference host instead of a popup from the wallet iframe. The callback
is consumed by thirdweb `AutoConnect` in that same origin, then the host starts a
fresh institution session and resumes the wallet creation screen. The temporary
resume record contains only the wallet label and flow intent, expires after ten
minutes, and never contains a phone code, auth result or signing secret. Email
continues through thirdweb's modal. The installed PWA behavior still needs a
physical Android and iPhone check; browser display-mode emulation cannot prove
how each OS returns from Google or Apple.
It requests a short-lived, session-bound challenge from the BFF, signs that
message in the WebView and submits the signature and public address. The BFF
checks the signature and uses its secret key to find the matching thirdweb
project user with a verified email, Google or Apple profile. It stores only the tenant-scoped hash of the thirdweb
user ID and public EVM addresses. No thirdweb auth token, mnemonic or key is
sent to the BFF.

An existing thirdweb wallet needs the same login method and signed challenge on a
new device. SAR wallets use the existing host-owned recovery route. Thirdweb
wallets expose EVM networks only; other tenant networks show as unavailable
for that wallet. The host still supplies a one-time transaction approval proof.

Useful thirdweb references: [User wallets](https://portal.thirdweb.com/wallets/users),
[Get users](https://portal.thirdweb.com/wallets/get-users),
[In-app wallet TypeScript SDK](https://portal.thirdweb.com/typescript/v5/inAppWallet),
[Security architecture](https://portal.thirdweb.com/wallets/security).
