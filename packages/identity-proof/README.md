# Development identity proof

The issuer signs a VC containing a salted BLAKE2s commitment to the registered name and birth date. VC issuance itself is an Ed25519 signature, not a zero-knowledge proof. The Host stores the VC and the 256-bit commitment salt in its IndexedDB vault.

At presentation, the Host runs `circuit/src/main.nr` with Noir and Aztec Barretenberg UltraHonk in the browser. Private circuit inputs are the normalized name digest, birth-date bytes, and salt. Public inputs are a per-challenge digest of the requested claim pair, the issuer-signed commitment, the one-time challenge, and a challenge binding. The BFF verifies the issuer and holder signatures, credential state, nonce, public signals, and UltraHonk proof. It accepts no custom Schnorr proof. `src/generated/identity_equality.json` is built from the checked-in circuit with `npm run compile -w @took-wss/identity-proof`.

The proof does not reveal the raw name, birth date, or salt. The verifier already knows the requested name and birth date; a party with a small candidate set could guess them from the public digest and nonce. This is an equality proof for a previously registered, self-asserted identity, not anonymous identity verification. The current Shinhan screen compares against the signed-in customer's stored profile. A relying-party presentation API, independently verified source claims, and transfer release policy are separate work.

The development credential is marked `DEV_ASSUMED` and `productionEligible: false`; the service and Host actions are unavailable in production. Before production, review the circuit and proof integration, pin audited dependencies, assess mobile proving performance, and establish the institution's source assurance and issuer key lifecycle.

Focused checks:

```sh
npm run compile -w @took-wss/identity-proof
node --import tsx packages/identity-proof/scripts/smoke.ts
npm run verify:shinhan-identity
node scripts/verify-shinhan-zk-browser.mjs
```

The last command requires the Host dev server on port 5173 and Chrome. The API check requires the linked development database and BFF on port 4100.
