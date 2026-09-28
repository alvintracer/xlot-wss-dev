# TranSight KYT fixed-egress gateway

## Current development state

- Verified: 2026-09-28
- Fixed outbound IPv4: `49.247.139.241/32`
- Runtime host: iwlnv Ubuntu 24.04
- PM2 process: `took-wss-kyt-gateway`
- Loopback listener: `127.0.0.1:3200`
- HTTPS base URL: `https://quote-api.tookpay.xyz/took-wss/kyt`
- WSS provider function: `xlot-wss-dev/functions/v1/kyt-screen`
- Policy: fail closed

The deployed path is:

```text
Institution BFF
  -> authenticated xlot-wss-dev kyt-screen
  -> HTTPS + independent gateway key
iwlnv KYT gateway
  -> OAuth2 client credentials + fixed egress IPv4
TranSight walletTracked API
```

The iwlnv host reports `49.247.139.241` from an external IPv4 echo service.
`quote-api.tookpay.xyz` resolves to the same IPv4. Ports 3000, 3100, and 3200
are not public service endpoints; Caddy exposes only selected paths on 443.

## Provider contract implemented

The implementation follows the supplied Bonanza Factory TranSight Open API
v2.0 guide:

- OAuth `client_credentials` with HTTP Basic client authentication;
- fixed `scope=ORG_CLIENT`;
- token caching based on `expires_in` and a single forced refresh for HTTP 401,
  `A1017`, or `A1018`;
- `POST /ts/api/denylist/walletTracked` with KST `tranDtm`, a daily-unique
  20-character `tranNo`, and `maxHopCount=1`;
- HTTP and provider-code validation, bounded timeouts, response-size limits,
  local request throttling, and fail-closed errors;
- direct and tracked risk normalization into WSS score, sanctions status, and
  minimal RA flags.

The gateway does not relay provider evidence images, free-form customer report
comments, source URLs, OAuth tokens, or the complete provider response. It does
not log screened wallet addresses.

## Encryption boundary

The guide specifies AES-256-CBC, PKCS5 padding, and Base64 encoding. The issued
32-byte key and 16-byte IV are present only in the root-owned mode-0600 server
environment file and pass the deployed codec's startup validation.

The same guide's OAuth and KYT wire examples send JSON directly over HTTPS and
do not define an encrypted request/response envelope or field name. The runtime
therefore uses `documented-json` mode and never guesses a proprietary envelope.
The AES codec is implemented and contract-tested; activating it for provider
payloads requires Bonanza Factory to provide the exact framing and a test
vector. TLS remains mandatory in every mode.

## Secret boundary

- Actual TranSight client credentials and AES material exist only in
  `/etc/took-wss-kyt.env` on iwlnv with `root:root 600` permissions.
- The actual TranSight credentials are not stored in Supabase.
- Supabase holds only the HTTPS gateway base URL and an independent internal
  gateway key.
- No secret value belongs in this document, Git, browser code, logs, or chat.

## Live verification and remaining provider action

Verified on 2026-09-28:

1. SSH deployment key authentication succeeded.
2. Server egress returned `49.247.139.241`.
3. TranSight OAuth returned HTTP 200, `rspCode=A0000`, a bearer token, and a
   valid `expires_in` value.
4. Public gateway health returned HTTP 200.
5. A screening request without the internal gateway key returned HTTP 401.
6. An authenticated screening request reached TranSight, where
   `/ts/api/denylist/walletTracked` returned HTTP 403.
7. The gateway converted that upstream denial to a sanitized HTTP 502.
8. The deployed WSS Edge Function converted the unavailable provider result to
   `riskScore=-1`, `riskLevel=CRITICAL`, `isBlocked=true`, and
   `kytAvailable=false`.

The operator reported the IP allowlist complete on 2026-09-28. A fresh token
and service matrix test immediately afterward produced:

- `/oauth/token`: HTTP 200, `A0000`, bearer token issued;
- `/oauth/check_token`: HTTP 200, `ORG_CLIENT` and client identity present;
- `/ts/api/denylist/wallet`: HTTP 403;
- `/ts/api/denylist/walletList`: HTTP 403;
- `/ts/api/denylist/walletTracked`: HTTP 403;
- common service response: `You do not have access to the service.`

Because every service endpoint rejects the request before parsing its body,
Bonanza Factory must confirm both of the following for the issued client:

- the allowlist for `49.247.139.241/32` was applied specifically to the
  `https://t-api.transight.io` environment used by the issued credentials;
- the client has service entitlement for the denylist APIs, especially
  `/ts/api/denylist/walletTracked`.

This is not an AES payload or WSS normalization failure. OAuth success alone
does not prove service entitlement. After Bonanza Factory corrects the
environment/entitlement assignment, rerun `npm run smoke:live` and verify HTTP
200 plus `rspCode=A0000`; no redeployment should be required.

## Relevant implementation

- `services/kyt-gateway/` — fixed-egress gateway, provider client, tests, and
  deployment templates
- `supabase/functions/kyt-screen/` — authenticated WSS provider function and
  fail-closed normalization
- `services/institution-bff/src/transferService.ts` — send preparation gate
