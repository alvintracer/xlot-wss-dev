# took WSS agent rules

This repository is the independent took Institutional Wallet Service Layer.

## Product boundary

- Build reusable WSS capabilities first; represent each institution as a tenant manifest and provider adapters.
- `kiwoom` is the first tenant, not a fork of the application.
- Do not import source from `traverse-wallet` or another product repository.
- Do not add `if (tenant === "kiwoom")` branches to shared runtime code. Put tenant choices in `tenants/*`.
- The server must never receive a mnemonic, private key, completed SAR secret, or customer signing material.

## Runtime boundary

- Production runtime identity comes from a short-lived institution session, never a query-string tenant slug.
- Preview-only behavior must be explicit and unavailable in production builds.
- Compliance, quote, execution, and key-management providers are adapters behind versioned contracts.
- Secrets remain in server environments. Browser packages contain only public configuration.

## UI and quality

- Treat management surfaces and tenant wallet surfaces as two different design authorities.
- Studio, dashboards, developer portals, operations consoles, and the outer frame of reference hosts use the tookpay UI / tookpay deck language by default: black, warm paper, white, signal orange, 1px rules, editorial grids, display typography, and mono metadata. Use `@took-wss/ops-ui` rather than recreating these values per app.
- A tenant wallet never inherits the tookpay deck language unless that tenant explicitly chooses it. Its source of truth is `tenants/<tenant>/ui-kit/`.
- Before changing tenant-visible UI, read the tenant's agent brief completely, then its design guide, tokens, measurements, UI contract, and QA checklist in the order declared by that brief.
- Treat screenshots and extracted reference assets under `tenants/<tenant>/ui-kit/` as read-only evidence. Do not rename, crop, retouch, compress, or overwrite them unless the user explicitly requests source-asset work.
- Keep observations, estimates, and new wallet extensions distinct. Never claim pixel-perfect completion without the tenant's production font, official assets, actual viewport, and device comparison.
- Host-owned chrome and wallet-owned content must render exactly once. Respect each tenant presentation contract for header, navigation, insets, authentication, and secure input.
- Do not expose implementation jargon such as MPC, gas sponsorship, provider names, or internal policy codes as primary customer copy unless the tenant guide explicitly requires it.
- Use `@phosphor-icons/react`; do not add `lucide-react`.
- Preserve keyboard access, visible focus, semantic controls, and reduced-motion behavior.
- Every workspace must typecheck independently.
- Run `npm run check` before handoff.

## Tenant UI-kit convention

Each production tenant uses this layout:

```text
tenants/<tenant>/
├── src/                         runtime manifest and presentation metadata
└── ui-kit/
    ├── README.md                routing note for agents
    ├── references/ or images    source screenshots; read-only
    └── <extracted-guide>/
        ├── AGENT_IMPLEMENTATION_BRIEF.md
        ├── UI_DESIGN_GUIDE.md
        ├── design/tokens.*
        ├── src/*contract*
        └── qa/ACCEPTANCE_CHECKLIST.md
```

If a tenant UI-kit is missing or its source hierarchy is unclear, do not invent a bank design. Continue only with headless/platform work or ask for the missing reference package.
