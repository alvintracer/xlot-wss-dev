# ADR-0002: Separate WSS identity, institution identity, and wallet ownership

Status: Accepted for implementation scaffold; privacy/legal retention values require project approval before production.

## Decision

WSS owns a random internal `user_profile_id` UUID for each tenant-scoped customer profile. It never derives that UUID from a name, birth date, phone number, wallet address, or institution customer UUID.

Institution identities are links, not primary keys. A host institution's customer reference is converted by the Institution BFF into a versioned, tenant-scoped HMAC subject and stored in `wss_external_identities`. The raw customer reference is not persisted by WSS.

The session-signing key and subject-HMAC key are separate. Rotating a short-lived session key must not change the stable institution identity link.

## Key-adapter policy

- `took-sar` is the default adapter for the current WSS and Kiwoom profiles.
- `thirdweb-user-wallet` and `fsl-mpc` are selectable alternatives.
- SAR is optional per tenant. A tenant that removes SAR must remove both `took-sar` and `sar-recovery`, then select one of the permitted provider adapters as its default.
- A wallet can never be provisioned without a key adapter. “SAR 미선택” means a provider adapter is selected; it does not mean key management is absent.
- The internal Thirdweb adapter name intentionally avoids claiming MPC. Current vendor documentation describes User Wallet security in terms of a secure enclave. Product or regulatory copy may call it MPC only after the contracted architecture is confirmed.

Recovery requirement presets, policy versioning, and existing-wallet migration are defined separately in `0003-key-recovery-policy-lifecycle.md`.

## Two onboarding paths

### Institution-first

1. The institution backend authenticates its customer.
2. It requests a WSS session using its opaque customer reference.
3. The BFF creates a versioned, tenant-scoped subject HMAC.
4. WSS resolves or creates a `wss_user_profiles` row and links it through `wss_external_identities`.
5. WSS does not need to collect name, birth date, or phone when the institution assertion is sufficient for the configured policy.

### WSS phone-first

1. Create a short-lived `wss_registration_intents` row, not a durable user profile.
2. Collect consent and the minimum required fields. Normalize the phone number and encrypt direct identifiers with a KMS-managed application key.
3. Issue a short-lived SMS OTP challenge with resend, attempt, device, and network rate limits.
4. Store only a server-peppered OTP MAC. Never store the OTP itself.
5. After successful OTP verification, create the WSS UUID profile and encrypted private-attribute row in one transaction, record consent, and purge PII from the registration intent.
6. The customer then chooses the permitted key adapter and provisions a wallet linked to that profile.

This means the WSS profile exists before the wallet, while abandoned or unverified form submissions do not become durable users.

## What the phone flow proves

An internally delivered SMS OTP proves possession of the entered phone number at that moment. It does not independently prove that the entered name and birth date match the mobile subscriber or a legal identity. Therefore:

- name and birth date from this flow are `self-asserted` claims;
- the profile assurance level after OTP is `phone-possession`;
- the telecom selection is self-asserted and is not an identity key;
- WSS must not market this flow as carrier-backed legal identity verification;
- a later institution assertion or approved identity provider can raise the assurance level.

Carrier codes, if a project needs them, are:

- `skt`, `kt`, `lgu-plus`
- `skt-mvno`, `kt-mvno`, `lgu-plus-mvno`

An SMS gateway normally routes from the phone number alone. If the carrier value has no fraud, routing, or compliance purpose, omit it under data-minimization rules. If retained for a project, keep it nullable and never use it for matching.

## Linking and merging

PII similarity is discovery evidence only. WSS must never automatically merge profiles because name, birth date, or phone values match.

The safe default is account linking:

1. Authenticate the standalone WSS profile at its existing assurance level.
2. Receive a fresh institution-authenticated session for the institution identity.
3. Obtain explicit customer confirmation for linking.
4. Add the institution subject to the same WSS profile when no conflicting ownership exists.

If two WSS profiles already exist, a merge is a separate high-risk operation. It requires step-up authorization for both sides, an idempotency key, an immutable merge event, conflict checks for wallets/recovery factors, and a canonical target profile. Wallet ownership or SAR recovery capability is never moved based on matching PII alone.

## Persistence boundary

The first schema is in `services/institution-bff/db/migrations/0001_wss_identity.sql` and separates:

- user profile state;
- short-lived registration and phone challenge state;
- encrypted private attributes;
- external institution identities;
- profile merge evidence;
- wallets and chain accounts;
- SAR policy metadata;
- provider wallet references;
- consent and audit records.

The schema must not contain private keys, mnemonics, reconstructed SAR secrets, SAR shares, raw OTP codes, provider secrets, or unencrypted direct identifiers.

## Open production decisions

- PostgreSQL hosting and tenant-isolation enforcement strategy, including whether Row Level Security is required.
- KMS/HSM provider, envelope-encryption format, key rotation, and lookup-HMAC rotation procedure.
- SMS delivery provider, abuse controls, expiry, resend limits, and number-recycling response.
- Exact privacy controller/processor roles, consent language, purpose, and retention periods for each institution deployment.
- Institution assertion contract and assurance mapping.
- Strong proof required for profile linking and the exceptional profile-merge workflow.

## Reference notes

- The KISA identity portal distinguishes identification, authentication, approved identity-verification services, and their result data: <https://identity.kisa.or.kr/web/main/contents/M010-05>
- KISA describes carrier-backed mobile identity verification as a designated identity-verification service; a WSS-originated SMS OTP is not automatically equivalent to that service: <https://identity.kisa.or.kr/web/main/contents/M030-02>
- The Personal Information Protection Act requires collection to be limited to information necessary for the stated purpose: <https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029335671>
- Thirdweb's current wallet security documentation describes User Wallet creation and signing inside a secure enclave: <https://portal.thirdweb.com/wallets/security>
