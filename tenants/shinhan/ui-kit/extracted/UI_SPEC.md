# Shinhan UI decision summary · draft 1

| Area | Decision | Basis | Status |
| --- | --- | --- | --- |
| Canvas | Cool blue-gray `#F0F3FA` | `R028`, `R031`, `R042` flat pixels | Measured candidate |
| Card | White, ~22px radius, low diffuse elevation | `R028`, `R031` | Estimated geometry/shadow |
| Primary action | Saturated Super SOL blue; pale-blue secondary | `R028`, `R031`, `R043` | Measured candidate |
| Finance floating navigation | Inset white pill, five controls, deeper shadow; ~23px icon art and ~5px icon-label gap | `R028`, `R031`, `R048` | Observed structure, estimated CSS |
| Header utilities | ~22px art against a ~24px finance title; local preview adds a wallet shortcut | `R028`, user request 2026-10-18 | Estimated size; added shortcut is a preview extension |
| 쏠지갑 navigation | Two top tabs; no floating five-item bottom bar; ~20px card inset | `R049`–`R053` | Observed structure, estimated CSS |
| Splash message | Cover the supplied security-message area with the plain blue splash field | User request 2026-10-18 | Explicit preview decision |
| Connected account | White finance card with linked account row, amount, pale-blue transfer action, carousel dots | `R068` | Observed structure, synthetic account data |
| Bank transfer | White focused pages, bordered recipient input, quick amount pills, 3×4 amount keypad, confirmation warning/details, bottom blue action | `R069`–`R073` | Observed host-app structure, preview-only flow |
| Simple password | White host input screen, six circles and a 4×3 keypad | `R074` | Observed from lower-fidelity device photo; local visual only |
| Finance tab motion | Horizontal pane/underline, 280ms ease-out | `이동애니메이션참고영상.mp4` | Observed direction, estimated timing |
| Local loading | Small gray rotating ring, 900ms cycle | `로딩스피젯(가운데)참고영상.mp4` | Observed appearance, estimated cycle |
| Typeface | Bundled NanumSquare AC | User direction, 2026-10-18 | Explicit preview decision |
| Wallet screens | Summary/actions/holdings/activity in Shinhan language | `R028`, `R049`, `R065` | New extension proposal |
| Identity and product policy | Development manifest uses the common WSS sandbox baseline; no institution-approved policy is inferred | WSS boundary | Production approval required |

The CSS token file is the runtime source for preview values. `design/measurements.json` records the evidence and uncertainty; it is not a second live theme.
