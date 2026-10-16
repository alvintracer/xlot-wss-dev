# Namu visual guide · draft 1

## Observed

- `R033`: a pale blue-mint canvas (`#D3E9EA` sampled from an interior flat area), white rounded cards, bold black totals, light gray secondary rows, red positive P&L, minimal shadows. The header has a dark Namu mark, utility icons, then **내 투자 / 발견 / 피드** tabs.
- `R032`: the scrolled investment page uses a compact header and a white holdings card. Rows have a small left asset mark, a two-line name/quantity block, and a right aligned amount/return block. Thin separators preserve density.
- `R003`, `R019`, `R020`, `R032`: persistent near-black (`#222`) bottom bar with a hamburger, text destinations separated by fine dark rules, and a layered icon at the far right. It belongs to the host. The last destination is partially clipped in some captures; do not infer its full label from the crop.
- `R018`: a right-side quote panel appears over the stock screen. `R022`: notifications use pale rounded cards. `R035`: light 4-column calculator keys with gray cancel and green confirmation. `R041`: dark 4-column secure keypad with an irregular empty slot and green confirmation. `R037`: iOS Hangul system keyboard, with white keys on a cool gray tray and blue completion key.
- `R033` and `R032` are different scroll positions and app revisions or states; the large logo row and summary card are not always visible together.

## Measured and estimated

The PNGs are 1290 × 2796 physical pixels. Using 430 CSS px gives a **provisional** 3× mapping, not a verified device calibration. Main side inset is about 10–20 CSS px depending on card and page state. The black bottom region in `R032` starts near 830 CSS px and includes navigation plus bottom inset. `R035`–`R042` are lower-resolution JPEG photos or exports (590/591 × 1280); use them for structure, not exact color/typography.

## Proposed wallet extension

Use the `내 투자` card rhythm for `내 지갑`: mint canvas, a wallet total card, a light inset for the selected wallet, compact asset rows, and short action labels **받기 / 보내기 / 바꾸기**. Use real WSS totals and assets only. Empty, unavailable, stale, hidden-balance, and loading states remain visible. Modal and sheet controls use white surfaces over a dim layer, with Namu green as an action accent. This is a design proposal, not a reproduced Namu product screenshot.

## User-directed wallet preview refinements · 2026-10-07

For the wallet PWA preview, omit the layered card icon at the far right of the bottom navigation. Keep the remaining six controls and their intentional two-line labels. Use roughly 1.3× the previous label size (12–14.3 CSS px across 320–430 px), and leave equal 7 px visual padding above and below the 50 px buttons, with additional bottom space only for the device safe area. This is a user decision for the wallet preview, not a measurement from the Namu screenshots. The earlier icon filled its transparent corners with lime `#AFF34D`, producing a sharp square on the installed PWA splash. The user's 2026-10-09 correction supersedes that treatment: generate a rounded square from the supplied mark with transparent outer corners; keep the supplied source unchanged.

## User-directed interactions · 2026-10-09

Namu wallet slots move horizontally like JB. Keep the next card partially visible, select a wallet after a swipe or page-dot action, and update the asset list to the selected wallet. Host secure PIN screens initially show six dots and the bottom action buttons; tapping the dots opens a keypad from the bottom. These interactions are user directions, not behaviors inferred from a still image.

The Namu `/namu/app` browser entry first shows a Namu-styled install screen. Android Chrome uses its install prompt when `beforeinstallprompt` is available; other Android browsers offer a user-initiated Chrome link to the same URL. iPhone shows Share → Add to Home Screen instructions because iOS does not expose that prompt to page code. A neighboring button continues in the browser. Installed standalone launches and the current browser tab after choosing web use bypass the install screen. Its tenant-scoped service worker passes all requests to the network and stores no wallet or API responses.

At the user's 2026-10-09 copy revision, this entry says **나무 월렛**, **나무, 월렛을 품다**, and **편리한 송금과 환전을 경험하세요.** The Namu PWA title and manifest name also use 나무 월렛. The host keeps a single **안전한 지갑을 준비하고 있어요** loading layer visible until the wallet presentation mounts and emits its initial shell state, so the embedded wallet's own loading page does not flash between states. The same install behavior and sentence pattern are used for JB and Kiwoom, with each tenant's own color, type, and icon.

## Type and assets

No institution production font file is supplied. At the user's 2026-10-08 direction, the Namu wallet preview uses bundled Nanum Gothic for its default type, including host chrome and secure UI. This is a user-selected preview font, not a font identified from screenshots or approved by NH Namu. The provided mark may appear in host header; no screenshot crop is shipped as artwork. Missing bottom bar icon artwork is represented with CSS/Phosphor and marked as a placeholder in `asset-map.json`.

At the user's direction, the preview's `내 투자` tab replaces its temporary diamond with the original Tossface v1.6.1 `💸` glyph. The reference's stacked green banknotes and won-marked money bag are not identical to the publicly distributed Tossface money glyphs; this is a user-selected style approximation, not a source-asset match. The font file remains unmodified, is scoped to Namu host chrome, and ships with its copyright notice and license.
