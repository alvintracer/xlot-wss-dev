# Shinhan Super SOL visual guide · draft 1

## Observed identity

The main finance surfaces use a cool near-white blue-gray canvas (`R028`, `R031`, `R042`) with white floating cards. Active actions are saturated blue; secondary actions sit on very pale blue. Ink is dark navy-charcoal, with slate secondary labels. This is not the tookpay management language. The separate splash is a more intense royal blue field with a white `super SOL` mark, while some campaign pages use their own color and illustration system.

The finance header has a bold left title, right utility icons, a four-tab row, and a short dark underline. The root bottom bar is a white inset pill with five icons and short labels. Its shadow is materially stronger than a content card's shadow. The centered icon/label groups, generous white space, 20–24 CSS px card rounding, and broad 12–20 CSS px insets make the interface feel soft despite dense financial data. `R028` suggests approximately 21–22 CSS px upper utility art and 23 CSS px bottom tab art, with about 5 CSS px between tab art and label under the provisional 1.8× scale. The wallet shortcut added to the finance preview is a requested extension; it is not present in `R028`.

`R028` has a large white account card with a quiet divider, left bank mark, amount, and a full-width pale-blue action. `R031` uses separated white exchange promotion, rate, recent-history, and vault cards. `R065` switches to a flatter white detail page with pale section gutters: use the correct page family rather than making every screen a card grid. `R049`–`R055` show that 쏠지갑 has its own payment and digital-asset content under the same host title/utility pattern. Those wallet captures have no floating five-item bottom navigation. `R052` shows a roughly 20 CSS px card side inset, a selected two-tab underline, and a pale blue-gray card canvas; the connected-balance content in our preview is a new wallet extension.

`R068` updates the finance card to a connected-account state: the same white rounded card, bank mark and two-line account row, larger available amount, pale-blue transfer button, and a multi-dot carousel indicator. The first card edge remains near 12 CSS px from the sides; the captured card height is about 335 CSS px at the provisional 1.8× scale. The account holder, bank identifier, account number, and balance in this screenshot are private source data; use synthetic preview fixtures.

`R069`–`R073` introduce a flatter transfer family. The recipient page has a white field, a compact back/close header, large question, bordered account input, pale search tile, section dividers, and bank/account rows. The amount page keeps account context high, centers the amount question, and anchors quick-amount pills, a 3×4 keypad, and a wide bottom action. The confirmation page uses a centered blue symbol and two-line question, a warm warning strip, a pale details panel, and a saturated-blue bottom action. These focused pages do not use the finance bottom tabs. `R074` is a photographed secure-input screen: white background, close control, centered prompt, six circular indicators, and a 4×3 number grid low in the viewport. Its pixel/color precision is lower than the direct captures, so match structure and spacing without treating photo artifacts as design tokens.

## Measured versus estimated

- Source captures are 648 × 1404 pixels; recordings are 1080 × 2340 pixels, both aspect ratio 6:13. A 360 × 780 CSS px comparison gives factors 1.8 and 3 respectively, but the device CSS viewport has not been verified.
- Flat interior JPEG samples: `R028` canvas near `(300,270)` ≈ `#F0F3FA`, white card near `(300,400)` ≈ `#FFFFFF`, pale action near `(270,736)` ≈ `#EAF0FE`; `R043` saturated illustration hero near `(300,180)` ≈ `#1179EB`. JPEG noise and surrounding pixels mean these are token candidates.
- The root account card begins around source `x=22`, `y=373`, corresponding to ~12 CSS px side inset and ~207 CSS px from the top under the provisional scale. Large card radius appears ~22 CSS px. The floating navigation appears ~20 CSS px inset and sits above the Android system navigation region.
- Content-card shadow candidate: `0 5px 16px rgba(29, 49, 85, .05)`; floating-nav candidate: `0 7px 18px rgba(34, 45, 70, .17)`. The source shows diffusion and elevation, but JPEG pixels do not establish the original blur/spread values.
- Body text in captures appears 12–15 CSS px; major titles 20–24 CSS px; large totals around 24–28 CSS px under the provisional scale. Use actual 320/360/390/430 rendering to finalize line height and width.

## Motion from the recordings

In `이동애니메이션참고영상`, changing finance tabs briefly exposes the incoming pane from the side while the bottom navigation stays fixed. The proposed implementation uses a 280 ms eased horizontal translation and a moving underline. This duration is an estimate from a 30 fps user recording, not an extracted product specification.

In `로딩스피젯(가운데)참고영상`, a neutral ring appears centered across the boundary between the exchange rate card and the next history card. The flags and currency labels stay visible while the numeric rates temporarily disappear. Use a ~32 CSS px gray ring, ~4 CSS px stroke, and a provisional 900 ms linear cycle. Announce loading through an accessible status. In `계좌개설애니메이션참고영상`, the article scrolls underneath a persistent two-button footer; no special illustrated transition has been confirmed there.

## Wallet extension proposal

The new wallet uses the finance card rhythm: root chrome outside the WebView, a concise wallet total card, a pale-blue primary action, short rows for holdings, and separate recent activity. The first screen uses synthetic review data; real WSS data and action callbacks belong to the presentation contract. A focused send/receive/authentication flow hides root chrome through the host contract and restores it on exit. Do not present provider names, signing jargon, or inferred bank services as customer copy.

## Type and artwork

Use bundled NanumSquare AC 400 for body and labels, 700 for card headings/actions, and 800 for large headings or totals. The screenshots suggest tight Korean heading tracking and modestly open body line height, but the actual production font is unknown. Transparent icons in `icons_transparent/` are supplied preview assets. `app-logo.jpg` is supplied. Three isolated-crop transparent images and a separately extracted white wordmark have development-only copies in `presentation/assets/preview/`. They are unapproved candidates; their original and generated hashes are recorded in `asset-map.json`.
