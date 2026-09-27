# ADR-0001: Build WSS as an independent multi-tenant platform

Status: Accepted

## Decision

WSS is developed in the independent `took-wss` repository. The consumer `took!` wallet remains in `traverse-wallet`. Kiwoom is implemented as the first tenant profile plus FSL-specific adapters, not as a fork of the WSS application.

## Reasons

- Consumer and institutional products need independent release, security, data, and incident boundaries.
- Financial institutions need server-issued sessions, auditable policy, tenant isolation, and bank-controlled deployment options.
- Copying consumer screens into each bank project would create divergent security behavior and expensive upgrades.
- A manifest and adapter architecture allows SAR, embedded MPC, or institutional MPC without branching the shared UI.

## Guardrails

1. Shared WSS code never imports `traverse-wallet` source.
2. Tenant differences live in signed manifests, presentation packages, themes, and adapters.
3. A query parameter cannot select a production tenant.
4. WebView messages use a versioned contract and explicit origin checks.
5. Key material and customer signing remain in the customer-controlled client or approved signer provider.
6. Institution BFFs handle sessions, policy orchestration, audit references, and webhooks only.
7. The host declares its UI/native capabilities during bridge initialization; the wallet refuses an ownership mismatch.
8. Wallet screens render explicit query states and never infer a zero balance from loading, failure, or an unprovisioned wallet.

## Presentation composition

The shared WebView resolves a lazy presentation package from the signed manifest's `presentation.profileId`. This registry is a deploy-time allowlist, not a tenant-ID condition. Institution-specific UI remains in `tenants/<tenant>/presentation`, while query, key, compliance, quote, and execution behavior stays behind shared contracts and adapters.

Kiwoom's package consumes the read-only extracted guide under `tenants/kiwoom/ui-kit`. The host continues to own its root header, bottom tabs, and safe-area handling, so those elements are not duplicated inside WSS.

## Migration

The existing `traverse-wallet/src/waas` implementation remains a temporary behavior reference. Capabilities move as independently tested headless modules. The old runtime is retired only after the new WebView vertical slice reaches parity.
