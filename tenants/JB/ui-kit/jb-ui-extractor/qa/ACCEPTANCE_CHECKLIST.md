# JB wallet acceptance checklist

- [x] `내 계좌`, `내 카드`, and `내 지갑` render once in the host. Enter activates the focused `내 지갑` button at 320, 360, 390, and 430px.
- [x] The wallet tab uses the WSS runtime and `jb-mobile-wallet-v1` manifest. The account/card preview cards contain no sample account balance or card number.
- [x] Entering wallet creation hides the host header and bottom navigation. Secure operation UI remains host-owned by contract.
- [x] `/jb/app` returns HTTP 200 and automatically creates a JB preview session (201); the JB WebView bootstraps (200). The manifest and 192px icon return 200. The supplied logo was used for generated PWA icons; actual device installation remains to be checked.
- [x] Browser checks at 320, 360, 390, and 430px found no horizontal overflow in the page or tab row. The 390px screenshot was visually reviewed against the supplied SVGs.
- [x] `npm run check` passed: 25 test files, 104 tests, all workspace typechecks and builds. Production alias checks returned 200 for JB host, WebView, manifest, icon, and BFF health.
- [x] Revised `/jb/app` install entry renders JB 월렛 / JB, 월렛을 품다 / 편리한 송금과 환전을 경험하세요. at 320/390/430 px with JB blue, loaded icon, and no horizontal overflow. Android non-Chrome shows a Chrome intent link; iPhone shows Share → Add to Home Screen steps. Browser emulation does not verify physical installation.

Remaining visual validation: production Paperlogy font, official interactive assets, and actual JB device comparison were not available. Do not claim pixel-perfect or native app approval.
