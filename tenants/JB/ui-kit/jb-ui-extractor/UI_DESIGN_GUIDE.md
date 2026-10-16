# JB screenshot-derived UI guide

## Observed

- `홈 계좌 보유.svg` shows a pale gray-blue root canvas, a name/search/notification row, account/card underlined tabs, a settings action, white rounded cards, blue primary actions, a purple promotional banner, and a five-item bottom navigation. Its screen artboard is 392 × 849.
- `홈 계좌 안내.svg` and `홈 내 카드.svg` show the same top and bottom structure with account or card guidance cards.
- The repository handoff defines `#0874e8` blue, `#202428` text, `#747c83` muted text, `#e1e5e9` rules, and Paperlogy as a preferred display font. `representative.css` approximates a 392 × 849 viewport.

## Estimated implementation values

- Root background `#f0f3f8`, card radius 16px, horizontal gutter 16–22px, primary blue `#0874e8`.
- Header and tab block about 128px including the top name row; bottom navigation about 64px in a WebView host without the native OS bars.
- Fallback font stack uses local Paperlogy, Noto Sans KR, and system Korean fonts. The repository does not include the Paperlogy webfont file.

## New wallet extension

- Add `내 지갑` as a third underlined host tab. The active tab opens the WSS WebView. WSS screens use JB blue, restrained white cards, and the same root canvas.
- Focused wallet procedures hide the host header/navigation as declared by the tenant manifest; host-owned secure approval overlays remain outside the WebView.
- Account and card tabs in the web preview are navigation examples. They do not show a customer's actual bank-account or card data. A real JB host supplies those views.

## Boundaries

No bank credentials, authentication keypad, mnemonic, private key, or completed signing material enters WSS server requests. Avoid presenting the screenshot's sample account/name/balance as real customer information. Keep accessible buttons and visible focus states.

## User-directed PWA entry · 2026-10-09

The `/jb/app` browser entry uses the shared install interaction with a JB-specific blue palette, Paperlogy title, and JB icon. Its copy is **JB 월렛**, **JB, 월렛을 품다**, and **편리한 송금과 환전을 경험하세요.** Android Chrome opens its install prompt when available; other Android browsers offer a user-tapped Chrome link. iPhone shows Share → Add to Home Screen steps. A side-by-side button continues in the mobile browser, and standalone launches bypass the entry. The service worker passes requests to the network without caching wallet or API responses. The app-only host keeps a single **안전한 지갑을 준비하고 있어요** layer visible until the wallet presentation mounts.
