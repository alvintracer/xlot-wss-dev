# ADR-0005: Host-owned SAR key core boundary

- Status: accepted for the development vertical slice
- Date: 2026-09-27

## Decision

New took SAR wallets are created by a host-owned key core, never by the WSS WebView or Institution BFF.

The development Reference Host uses `@took-wss/sar-key-core` to:

1. generate 128 bits of cryptographically random entropy on the customer side;
2. derive the took-compatible EVM, Solana, Bitcoin, TRON, and XRP accounts;
3. split the entropy into three Shamir GF(256) shares with a threshold of two;
4. reconstruct and byte-compare all three valid two-share combinations before registration;
5. keep the plaintext shares in three separate key-core store instances;
6. encrypt each share in the customer-side key core with AES-256-GCM; and
7. return only an opaque key handle, public addresses, encrypted recovery envelopes, and non-secret setup metadata.

The EVM address is registered once and reused by Ethereum, Polygon, Arbitrum, Base, and BNB Chain. Solana, Bitcoin, TRON, and XRP each have their own address group.

The WSS bridge message `took-wss:secure-sar-create-request` has no secret-bearing request fields. Its response and the BFF `secure-new` provisioning source may contain public addresses, an opaque key-core reference, customer-side encrypted recovery envelopes, and SAR threshold metadata. They must never contain entropy, a mnemonic, a private key, a plaintext recovery share, or the envelope decryption key.

## Development versus production

The Reference Host performs real key derivation, real Shamir reconstruction, and real AES-GCM envelope encryption. Its plaintext share stores and non-exportable envelope key are volatile JavaScript memory. When `xlot-wss-dev` persistence is enabled, the BFF stores the three opaque ciphertext envelopes in the same development Supabase project. This proves the persistence and ownership path but is not an approved production custody boundary. The current envelope key does not survive reload, so this slice does not yet provide device-loss recovery.

The development ciphertext exception is defined in ADR-0006. It does not relax the invariant that the WSS WebView, BFF, Edge Function, logs, and database never receive a mnemonic, private key, plaintext Shamir share, completed SAR secret, or decryption key.

Production builds remain fail-closed until all of the following are supplied:

- an approved native or hardware-backed customer-device key core;
- independently controlled, durable, encrypted stores for the three recovery factors or shares;
- a host attestation that binds the public registration to tenant, customer, device, session, nonce, expiry, and one-time use;
- an integrity check during reconstruction against the registered public wallet identity;
- reviewed recovery authentication, rate limits, audit evidence, and compromise procedures.

The sandbox BFF is disabled in production. It must not be promoted by changing the response mode or environment flag.

## Consequences

- A took SAR wallet cannot use the generic `{ type: "new" }` provisioning source. It must arrive as `secure-new` after host key-core completion.
- MPC adapters retain their provider-owned `{ type: "new" }` flow.
- The development BFF can persist public addresses and opaque encrypted recovery envelopes without ever receiving signing material or a decryption key.
- Secure mnemonic/private-key import remains unavailable in the Reference Host until an approved host-only input surface is implemented; it no longer returns a simulated success.
