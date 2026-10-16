# JB WSS tenant profile

- Tenant ID: `jb`; presentation: `jb-mobile-wallet-v1`.
- Visual authority: [`ui-kit/README.md`](ui-kit/README.md), the supplied JB SVG screens, and the copied [`alvintracer/ui-extractor`](https://github.com/alvintracer/ui-extractor) handoff at commit `13739924f6c785464c9037015a08c33827c702d0`.
- Entry: the JB host adds `내 지갑` beside `내 계좌` and `내 카드` in the home header. The reference host owns this navigation and the bottom five-item menu. The WSS WebView owns wallet content and focused flows.
- WSS capabilities, chains, supported assets, identity flow, provider contracts, key policies, and secure host ceremonies match the Kiwoom tenant manifest. The tenant ID and presentation profile keep sessions, wallet records, and branding separate.
- Preview routes: `/jb`, `/jb/app`, and `/jb/wallet`. The PWA preserves `app-logo-jb.webp` as read-only source and uses versioned, rounded-square 180/192/512px install icons with transparent outer margins.

The web reference host's account/card views are navigation examples without customer account or card data. In a JB production host, those views and all native security controls must come from the institution app. The extracted package does not include a production font file or the PNG files referenced by its static gallery. Compare on the target device before making a pixel-perfect claim.
