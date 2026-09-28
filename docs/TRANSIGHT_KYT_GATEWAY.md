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
TranSight wallet API
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
- `POST /ts/api/denylist/wallet` with KST `tranDtm` and a daily-unique
  20-character `tranNo`;
- HTTP and provider-code validation, bounded timeouts, response-size limits,
  local request throttling, and fail-closed errors;
- direct and tracked risk normalization into WSS score, sanctions status, and
  minimal RA flags.

The gateway does not relay provider evidence images, free-form customer report
comments, source URLs, OAuth tokens, or the complete provider response. It does
not log screened wallet addresses.

## Encryption boundary

The issued 32-byte key and 16-byte IV are present only in the root-owned
mode-0600 server environment file and pass startup validation. The provider
confirmed the service API wire contract on 2026-09-28:

1. Serialize the request as compact JSON without a trailing newline.
2. Encrypt it with AES-256-CBC and PKCS padding.
3. Standard-Base64 encode the ciphertext exactly once.
4. Send that Base64 string as the complete raw HTTP body, without a JSON/form
   wrapper, URL encoding, whitespace, or line breaks.

The gateway uses `TRANSIGHT_PAYLOAD_ENCRYPTION_MODE=aes-256-cbc-base64-raw`
and `text/plain; charset=UTF-8`; standard Base64 `+` characters therefore reach
TranSight unchanged. The encrypted response body is Base64-validated,
decrypted, JSON-parsed, and then minimized. OAuth remains plaintext JSON over
TLS as specified by the guide.

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
6. The vendor-confirmed raw encrypted request removed the prior Base64-space
   failure: `/ts/api/denylist/wallet` returned HTTP 200 and encrypted
   `rspCode=A0000`.
7. The decrypted response normalized to direct denylist, score, sanction, and
   minimal flags without relaying the full upstream payload.
8. The authenticated iwlnv gateway returned HTTP 200 and `provider_code=A0000`.
9. The deployed WSS Edge Function returned `riskScore=0`, `riskLevel=LOW`,
   `isBlocked=false`, and `kytAvailable=true` for the non-customer zero-address
   smoke.

The optional `/ts/api/denylist/walletTracked` 1-hop endpoint accepted the same
encrypted transport but returned encrypted `A1002 BAD REQUEST` with
`INTERNAL_SERVER_ERROR` for both allowed content types. Direct high-risk wallet
screening is therefore the active fail-closed production path. Enabling 1-hop
screening requires Bonanza Factory to clarify the remaining endpoint-specific
request or entitlement requirement; it is not silently substituted today.

## Relevant implementation

- `services/kyt-gateway/` — fixed-egress gateway, provider client, tests, and
  deployment templates
- `supabase/functions/kyt-screen/` — authenticated WSS provider function and
  fail-closed normalization
- `services/institution-bff/src/transferService.ts` — send preparation gate
