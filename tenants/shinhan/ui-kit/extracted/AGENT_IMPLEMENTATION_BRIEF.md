# Shinhan Super SOL implementation brief · draft 1

Read this file, then follow `../README.md`'s reading order. This is a **design and local preview** brief; no institution capability, provider, or policy can be inferred from the captures.

## Evidence and authority

- `reference-manifest.json` inventories 74 images. `R028` is the clearest initial finance/account root; `R031` is exchange; `R048` and `R067` show home; `R049`–`R055` show 쏠지갑 and digital-asset states; `R065`–`R066` show asset detail. `R068` shows a connected account; `R069`–`R073` show recipient, amount, confirmation, and favorite-account transfer surfaces; `R074` shows the six-digit simple-password keypad in a photographed device capture. `R067` is a lower-resolution marketing mockup, not a pixel baseline. `R001`–`R006` include exact duplicate composites.
- `motion-evidence.json` inventories three 1080 × 2340, 30 fps recordings. The tab/navigation clip supports horizontal pane motion; the loading clip supports a small local gray ring spinner; the account-product clip supports a scrolling article with a fixed footer. Exact easing and cycle time remain estimates.
- The source screenshots, videos, and crop candidates are local-only evidence. Supplied transparent icons may be used in the local host preview. The separately supplied app logo is the app identity reference. The splash capture contains Android system UI and a security message: do not render it behind a second status bar or bottom system navigation.
- The default preview typeface is **NanumSquare AC**, by the user's 2026-10-18 decision. Use the bundled Light, Regular, Bold, and ExtraBold files. This is a substitution, not a font identified from the screenshot.

## Ownership and scope

- The Android status bar, system navigation, OS keyboard, identity/consent, and secure input are host/platform-owned. The Super SOL root header, finance tabs, and floating bottom navigation are host chrome. Render each exactly once.
- The linked-account bank transfer sequence is host-app evidence. Its local preview may mimic the screens but cannot represent a real WSS transfer. Every simple-password step must use the same host-owned keypad treatment. The local keypad stores only a count of pressed positions; production input and authorization belong to the institution's native secure surface.
- New wallet balance, asset list, activity, and actions are a **wallet extension** following the observed composition. Account numbers, customer names, balances, product terms, marketing copy, and screenshots are not runtime fixtures.
- `tenants/shinhan/presentation` and `host-chrome` are local preview foundations. A development Shinhan manifest now binds the common WSS sandbox capability baseline and signed preview session. It is not a production institution policy or provider approval. The production integration still requires institution-approved configuration and native secure input.
- Preview cutouts under `.artifacts/preview-assets` were generated from isolated nonpersonal crops; development-only copies are in `presentation/assets/preview`. They can drift from the source and require review. Do not ship them as official Shinhan artwork.

## Pilot target

Start with the finance root at 360 × 780 estimated CSS px and a wallet extension on the same canvas. Match the pale blue-gray field, large white soft cards, blue action controls, subtle card shadow, and stronger floating-navigation shadow. Use the videos for the tab slide and local spinner; keep reduced-motion behavior and stable header/footer. Check the mobile Korean wrapping rule in `guide.md` §8.3.1 at 320, 360, 390, and 430 CSS px.

## Verification status

The source hierarchy and visual categories are established. CSS measurements and motion timings are estimates until the actual device density/viewport and production font/assets can be compared. Automated rendering checks can verify layout, loading, and interactions; human visual approval is a separate state in `qa/status.json`.
