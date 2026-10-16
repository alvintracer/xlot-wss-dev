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

For a direct denylist match, the gateway now forwards only the validated
`added_date` (normalized to `YYYY-MM-DD`) and `ra_code2_kor` category label
from the provider detail. The Edge function validates the gateway envelope and
passes these as `identifiedAt` and `riskCategory` to WSS. The send review shows
the date as the **risk-address registration date**, not the date of a customer
transaction. Missing fields are omitted; malformed or unavailable provider
responses block sending. The old development-only fixed-address warning was
removed from the send path.

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

On 2026-10-02, after deploying the evidence mapping, the production-host
gateway and WSS Edge function again returned `A0000` and a low-risk result for
the non-customer zero address. A live direct denylist match carrying both
evidence fields was not available for this smoke; the field path is covered by
gateway, Edge, and BFF contract tests.

On 2026-10-05, a send failure was traced to intermittent HTTP 403 responses
from TranSight's wallet screening endpoint. The gateway health check and OAuth
endpoint worked, and the fixed outbound IP remained `49.247.139.241`; the same
non-customer zero-address request later returned `A0000` through both the
gateway and Edge function. The gateway now retries one HTTP 403 with a fresh
OAuth token, then fails closed if screening still cannot complete. The wallet
UI distinguishes an unavailable screening result from a confirmed risky address
and lets the customer retry the check without authorizing a transfer. The
provider-side reason for intermittent 403 responses remains unconfirmed.

On 2026-10-06, production BFF logs showed alternating successful preparations
and `provider_unavailable` results. The gateway's recent PM2 error log contained
repeated `HTTP_403` failures. These are failures at TranSight's wallet screening
endpoint after the gateway's one fresh-token retry, not confirmed risky-address
results. The upstream reason for HTTP 403 remains a provider question; do not
weaken the fail-closed gate or classify the address as risky from this error.

## Diagnose one failed screening attempt

1. Copy the `문의 코드` shown on the unavailable-risk screen. It is a random
   trace ID, not the wallet address. Record the approximate Korea time too.
2. Search Vercel production logs for `wss_kyt_unavailable` and the trace ID.
   `http_401` means the BFF request was rejected before screening; a
   `provider_unavailable` result means the Edge function returned a fail-closed
   result and the next boundary must be inspected.
3. In the xlot-wss-dev Supabase dashboard, open Edge Function `kyt-screen`
   logs and search the same trace ID. `wss_kyt_gateway_failure` includes the
   gateway HTTP status and a sanitized gateway code; `request_failed` identifies
   a timeout or transport/parse failure. Neither log contains the address.
4. On iwlnv, search `pm2 logs took-wss-kyt-gateway --nostream --lines 500`
   for the trace ID. `HTTP_403` here means TranSight rejected the wallet API
   call after one fresh-token retry. Supply TranSight support with the Korea
   timestamp, `/ts/api/denylist/wallet`, fixed egress `49.247.139.241`, and
   HTTP 403. Keep credentials and customer addresses out of support tickets
   unless a separate approved channel is provided.

The BFF, Edge function, and gateway all log the same trace ID after their
corresponding deployments. A mismatch in which stage has the trace identifies
the failed network boundary.

The production BFF did not have an explicit `WSS_TOOK_KYT_URL`, so it fell back
to `SUPABASE_URL/functions/v1/kyt-screen`. Its previous key selection still
preferred `WSS_TOOK_INFRA_ANON_KEY`, which is intended for a separate provider
project. This URL/key pairing could make the Edge request fail before reaching
the gateway. The BFF now chooses the anon key for the project named by the KYT
URL and records only the upstream HTTP status or failure class when screening
fails. The earlier direct Edge smoke used the local `SUPABASE_ANON_KEY`; it did
not test the production BFF's former key choice. Because that response was
swallowed without logging, the exact HTTP status of prior customer requests
cannot be recovered from the existing logs.

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
