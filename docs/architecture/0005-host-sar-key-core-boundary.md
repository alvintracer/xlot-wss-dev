# ADR-0005: Host-owned SAR key core boundary

- Status: accepted for the development vertical slice
- Date: 2026-09-27

## Decision

New took SAR wallets are created by a host-owned key core, never by the WSS WebView or Institution BFF.

The development Reference Host uses `@took-wss/sar-key-core` to create a new
wallet or import an existing wallet through a host-owned secure input surface.
For mnemonic wallets it:

1. generate 128 bits of cryptographically random entropy on the customer side;
2. derive the took-compatible EVM, Solana, Bitcoin, TRON, and XRP accounts;
3. split the entropy into three Shamir GF(256) shares with a threshold of two;
4. reconstruct and byte-compare all three valid two-share combinations before registration;
5. keep the plaintext shares in three separate key-core store instances;
6. encrypt each share in the customer-side key core with AES-256-GCM; and
7. return only an opaque key handle, public addresses, encrypted recovery envelopes, and non-secret setup metadata.

Before registration, the host-owned security surface displays the actual
12-word BIP-39 recovery phrase exactly once and requires the customer to
re-enter three randomly selected positions. The phrase is held only by the
Reference Host key-core ceremony; it is never rendered inside the WSS iframe
or included in a bridge message, BFF request, log, or database record.

The EVM address is registered once and reused by Ethereum, Polygon, Arbitrum, Base, and BNB Chain. Solana, Bitcoin, TRON, and XRP each have their own address group.

The secure-import ceremony accepts a valid BIP-39 mnemonic or one EVM private
key only inside the Reference Host. A mnemonic produces the same five public
address groups as a newly created wallet. A raw private key produces one EVM
address group and does not pretend to derive unrelated Solana, Bitcoin, TRON,
or XRP keys. In both cases the imported secret is split into a new SAR 2-of-3
set before registration and remains available to the volatile host key core for
transaction signing during the current page lifetime.

The WSS bridge message `took-wss:secure-sar-create-request` has no secret-bearing request fields. Its response and the BFF `secure-new` provisioning source may contain public addresses, an opaque key-core reference, customer-side encrypted recovery envelopes, and SAR threshold metadata. They must never contain entropy, a mnemonic, a private key, a plaintext recovery share, or the envelope decryption key.

Wallet provisioning also requires two short-lived signed proofs in the
development slice:

- a host authorization bound to session, tenant, subject, purpose, expiry,
  and a unique proof UUID; and
- for `secure-new` and `secure-import`, a key-core attestation bound to the canonical hash of the
  complete public SAR registration payload.

The BFF verifies both signatures and bindings. The database stores only their
UUIDs under tenant-scoped unique indexes, making successful proofs one-time
across different idempotency keys. The signed proof strings are never stored.
The loopback Reference Host issues these proofs only through development-only
endpoints protected by the local institution key; production must replace
that issuer with the institution's approved PIN/biometric and native key-core
attestation SDK.

## Development versus production

The Reference Host performs real key derivation/import, real mnemonic presentation
and confirmation, real Shamir reconstruction, and real AES-GCM envelope
encryption. Its plaintext share stores, recovery phrase, and non-exportable
envelope key are volatile JavaScript memory. JavaScript strings cannot be
reliably zeroized, which is an additional reason this implementation is
development-only. Cancelling an uncommitted ceremony deletes the volatile
share records and key references. When `xlot-wss-dev` persistence is enabled,
the BFF stores the three opaque ciphertext envelopes in the same development
Supabase project. This proves the ceremony, persistence, binding, and ownership
path but is not an approved production custody boundary. The current envelope
key does not survive reload, so this slice does not yet provide device-loss
recovery.

The development ciphertext exception is defined in ADR-0006. It does not relax the invariant that the WSS WebView, BFF, Edge Function, logs, and database never receive a mnemonic, private key, plaintext Shamir share, completed SAR secret, or decryption key.

Production builds remain fail-closed until all of the following are supplied:

- an approved native or hardware-backed customer-device key core;
- independently controlled, durable, encrypted stores for the three recovery factors or shares;
- an institution/native attestation that additionally binds the public
  registration to an approved device and hardware-backed key operation (the
  development proof already covers tenant, subject, session, payload, expiry,
  and one-time use);
- an integrity check during reconstruction against the registered public wallet identity;
- reviewed recovery authentication, rate limits, audit evidence, and compromise procedures.

The sandbox BFF is disabled in production. It must not be promoted by changing the response mode or environment flag.

## Consequences

- A took SAR wallet cannot use the generic `{ type: "new" }` provisioning source. It must arrive as `secure-new` after host key-core completion.
- MPC adapters retain their provider-owned `{ type: "new" }` flow.
- The development BFF can persist public addresses and opaque encrypted recovery envelopes without ever receiving signing material or a decryption key.
- Secure mnemonic/private-key import is enabled only in the development Reference Host. The WSS iframe receives an opaque key handle, public addresses, encrypted recovery envelopes, threshold metadata, and a payload-bound attestation; it never receives the imported secret.
- An imported private key enables only EVM-compatible networks. A mnemonic import enables every address group derived by the took-compatible paths.
- Imported signing material is volatile in this development key core and is lost on page reload. Production requires durable hardware/native key storage and a reviewed re-attachment or recovery ceremony.
- The A/B/C recovery-factor screen is still a policy preview. Durable,
  independently controlled factor enrollment and an end-to-end recovery
  ceremony remain required.
