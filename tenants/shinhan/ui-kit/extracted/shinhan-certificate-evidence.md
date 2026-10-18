# Additional Shinhan certificate and identity-payment evidence · 2026-10-18

The source captures in `../additional/` are local, read-only evidence. Photographed HEIC screens include personal information and surrounding device/background. The implementation uses their **screen region only as visual evidence** and recreates controls in CSS/React; no photographed pixels, names, account numbers, or ID images enter the app bundle.

| Source group | Observed screen or motion | Applied treatment |
| --- | --- | --- |
| `신한인증서/…001–003.jpeg` | ShinhanSIGN landing, blue certificate card, issuance consent and large title | DID uses the supplied SuperSOL app logo, white issuance canvas, large title, blue fixed action, and a distinct blue DID card. It does not copy the Shinhan certificate issuer claim. |
| `…004–006.jpeg` | Six-box OTP, focused carrier input with a saturated blue outline, carrier bottom sheet | Existing phone flow keeps the custom bottom sheet; Shinhan fields now animate border and halo to blue on focus. |
| `…008–009.jpeg` | Secure-storage consent and centered completion check | DID issuance has separate storage consent, a centered check, and a completion card. |
| `IMG_5128–5139.HEIC` | ID capture/confirmation, account-selection, one-won verification, four-box account code | DID shows a Host handoff and waits for an assumed success response. No photographed ID or account data is used. |
| `IMG_5140–5142.HEIC` | Royal-blue six-digit keypad and OS biometric prompt | Host-owned DID authorization uses a blue keypad variant in browser development and native biometric prompt when enrolled. The WebView receives only an outcome. |
| `…15-05-03.mp4`, `…15-05-15.mp4`, `…15-05-27.mp4`, `…15-05-41.mp4` | Horizontal page transitions, brief local loading ring, secure-storage progression, biometric/confirmation timing | Estimated 260–330 ms eased horizontal entry, 900 ms neutral ring, fixed footer, and reduced-motion fallback. Timings remain estimates without the production device/viewport. |
| `쏠지갑-신원결제/…001–003.jpeg` | Identity-payment tab, mobile ID card, SOL Pay tiles, electronic-document rows | DID box sits above mobile ID. Payment tiles lead to the existing wallet asset/payment content; menu rows keep the same soft icon-tile rhythm. |

The 4032×3024 HEIC photographs were inspected through temporary local resized views only. The photographed geometry and color are lower confidence than direct screenshots. The certificate card, symbols, shadows, and input states are new DID extensions guided by these observations, not a pixel-level claim about an official Shinhan DID product.
