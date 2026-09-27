# ADR-0003: Version recovery policy and migrate wallets explicitly

Status: Accepted

## Decision

Every WSS project selects one recovery requirement when it is created:

| Requirement | New-project preset | Meaning |
| --- | --- | --- |
| `sar-required` | took SAR only | Every new wallet uses the customer-controlled SAR ceremony. |
| `sar-preferred` | took SAR default; Thirdweb and FSL allowed | SAR is the product default while approved provider wallets remain available. |
| `provider-recovery-accepted` | Thirdweb default; FSL allowed | The institution accepts an approved provider's recovery policy. SAR may be added later if desired. |

The recommended WSS default is `sar-preferred`.

## Invariants

- `sar-required` permits only `took-sar`.
- `sar-preferred` must enable and default to `took-sar`; provider options may be enabled or removed.
- `provider-recovery-accepted` must enable at least one provider adapter. SAR can be enabled as an additional option.
- Enabling or disabling `took-sar` automatically enables or disables the `sar-recovery` module.
- Every project must have at least one allowed adapter and one default adapter.

These rules are enforced by the shared manifest contract rather than by Kiwoom-specific code.

## Policy versioning

`keyManagement.policyVersion` starts at `1`. Once a project policy has been deployed, any recovery requirement, allowed-adapter, or default-adapter change creates the next policy version.

`wss_key_policy_versions` stores an immutable snapshot and manifest digest. Every wallet stores both:

- the adapter used to provision it;
- the policy version that authorized that adapter.

A new active policy applies only to wallets provisioned after activation. Existing wallets continue under their pinned policy.

## Existing-wallet migration

Changing SAR, Thirdweb, or FSL is a wallet migration, not a database-field edit. The safe flow is:

1. Create and activate a new key-policy version.
2. Explain the recovery and custody change to the customer.
3. Record explicit consent and step-up authorization.
4. Provision a new target wallet with the new adapter.
5. Transfer assets through the normal quote, KYT, approval, and receipt pipeline.
6. Confirm balances and supported assets on the target wallet.
7. Mark the migration complete and retire—not rewrite—the source wallet.

`wss_wallet_migrations` records that lifecycle and its idempotency key. Key material, SAR shares, provider secrets, and signing authorization are not stored in the migration record.

## Studio behavior

WSS Studio exposes the three requirements when starting a new project. A new project remains at policy version `1` while it is being composed. Editing a deployed tenant template raises the draft to the next version on the first key-policy change; subsequent edits remain in that same draft version until deployment.

Manifest export is blocked whenever the requirement, adapters, SAR module, or default selection violates an invariant.
