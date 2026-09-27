# WSS design governance

## Two design authorities

| Surface | Default authority | Rule |
| --- | --- | --- |
| Studio, operations dashboard, developer portal, internal console | tookpay UI / tookpay deck | Use `@took-wss/ops-ui` tokens and editorial layout language. |
| Reference Host outer control area | tookpay UI / tookpay deck | The simulator controls and documentation belong to WSS, not the tenant. |
| Phone frame and host-app chrome inside a tenant preview | Tenant UI-kit | Match the supplied institution screenshots and host ownership contract. |
| Wallet content embedded in the host app | Tenant UI-kit | Read the tenant agent brief and use its tokens, measurements, contract, and QA order. |
| Headless contracts and domain packages | No visual authority | Must not depend on a tenant or presentation package. |

The tookpay reference is a visual authority only. WSS must not import runtime source from the sibling took-pay repository. The normalized WSS tokens live in `packages/ops-ui`.

## Tenant intake workflow

1. Place screenshots and supplied source evidence under `tenants/<tenant>/ui-kit/`.
2. Keep those files unchanged. Derived assets and measurements belong in a clearly named extracted-guide folder.
3. Add `ui-kit/README.md` identifying the authoritative agent brief and guide.
4. Record a `presentation` profile in the tenant manifest: guide ID/version and ownership of header, navigation, and safe area.
5. Before implementation, read the entire agent brief. Then read every file it marks as required.
6. Implement shared behavior headlessly; implement institution-specific composition within the tenant presentation boundary.
7. Compare at every required viewport and record remaining placeholder fonts/assets and unverified behavior.

## Host chrome packages

- Host-owned root headers, root navigation, and preview-safe-area treatment live in `tenants/<tenant>/host-chrome` when an institution supplies its own app shell.
- The Reference Host selects that package by `manifest.presentation.profileId`; shared applications must not branch on `tenantId`.
- Wallet presentations must not repeat host-owned chrome. A root header and root navigation render exactly once around the embedded WebView.
- Screenshot crops and placeholder icons may be used only in the Reference Host when their manifest marks them as preview-only. Production builds require the institution's approved logo, font, and icon assets.

## Embedded navigation policy

- Default to the institution's existing header and bottom navigation on the wallet root.
- Enter manifest-driven `focus` mode for creation, authentication, recovery, receive, and send so the host can hide its chrome.
- Do not add a wallet bottom bar when the host already owns persistent root navigation.
- Keep the wallet hamburger disabled until the wallet has a real secondary navigation hierarchy; enable it through the manifest rather than a tenant-specific component branch.
- Focused flows must provide their own accessible back or close control and return the shell to `root` on completion or cancellation.

## tookpay deck baseline for WSS-owned pages

- Black `#000000`, ink `#0A0A0A`, white `#FFFFFF`, warm paper `#F3F3EE`.
- Signal orange `#FF2B00` is an accent, not a general background wash.
- One-pixel rules, little or no shadow, restrained radii, 72px editorial grid where useful.
- Display copy uses the project display stack; metadata and technical labels use the mono stack.
- Avoid generic SaaS gradients, glass cards, excessive pills, and tenant brand colors in WSS-owned management chrome.

## Kiwoom authority

For `tenants/kiwoom`, the first required file is:

`ui-kit/kiwoom-wallet-ui-guide/AGENT_IMPLEMENTATION_BRIEF.md`

It routes implementation to the screenshot references, design tokens, measurements, UI contract, and acceptance checklist. Its rules override generic WSS wallet styling for Kiwoom-visible screens.
