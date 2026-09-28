# took WSS TranSight KYT gateway

This server-only adapter gives the distributed WSS Edge Function a fixed
outbound IPv4 for TranSight allowlisting.

```text
Institution BFF
  -> authenticated xlot-wss-dev kyt-screen
  -> HTTPS + independent X-API-Key
iwlnv 49.247.139.241
  -> OAuth2 client credentials + fixed egress IPv4
TranSight
```

## Security boundary

- Runtime secrets live only in the root-owned mode-0600
  `/etc/took-wss-kyt.env` file.
- The process binds to `127.0.0.1:3200`; Caddy is the only public ingress.
- The provider client accepts only Bonanza Factory-operated HTTPS origins.
- The external route requires an independent 32-byte-or-longer gateway token.
- Wallet addresses, provider evidence images, comments, OAuth tokens, and
  credentials are never written to application logs.
- Timeout, malformed responses, provider errors, and unavailable credentials
  fail closed in the existing WSS Edge Function.

The v2.0 guide specifies AES-256-CBC, PKCS5 padding, and Base64 encoding, but
its OAuth and KYT wire examples send JSON directly over HTTPS and do not define
an encrypted envelope field. The gateway validates the issued 32-byte key and
16-byte IV and carries a tested codec, but intentionally uses
`TRANSIGHT_PAYLOAD_ENCRYPTION_MODE=documented-json`. Do not invent an envelope;
enable payload encryption only after Bonanza Factory supplies its exact request
and response framing.

## Provider contract

- OAuth: `POST /oauth/token`, HTTP Basic client credentials,
  `grant_type=client_credentials`, `scope=ORG_CLIENT`
- Screening: `POST /ts/api/denylist/walletTracked`, `maxHopCount=1`
- Success: HTTP 200 and `rspCode=A0000`
- Auth retry: one token refresh for HTTP 401, `A1017`, or `A1018`
- Allowlist failure: HTTP 403 or `A1015`

The gateway reduces the provider response to score, sanctions status, and
minimal RA flags. It does not forward evidence images, customer-submitted
comments, source URLs, or the complete provider payload to WSS.

## Deployment

```bash
cd /opt/took-wss-kyt-gateway
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:3200/health
```

The current shared HTTPS ingress exposes this loopback service below
`https://quote-api.tookpay.xyz/took-wss/kyt/`. A dedicated hostname can replace
that base URL later without changing the provider adapter contract.

After Bonanza Factory activates the allowlist and endpoint entitlement, run the
non-customer zero-address smoke without printing a credential or token:

```bash
cd /opt/took-wss-kyt-gateway
npm run smoke:live
```
