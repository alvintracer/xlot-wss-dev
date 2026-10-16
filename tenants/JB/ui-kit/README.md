# JB UI authority

The original SVG screen exports in `references/` are read-only evidence. The source HTML/CSS handoff in `jb-ui-extractor/` was copied unchanged from [`alvintracer/ui-extractor`](https://github.com/alvintracer/ui-extractor) at commit `13739924f6c785464c9037015a08c33827c702d0`. Its referenced `assets/screens` PNG files were not present in that repository; the supplied SVG exports provide the screen images.

Read in this order before changing JB-visible UI:

1. `jb-ui-extractor/AGENT_IMPLEMENTATION_BRIEF.md`
2. `jb-ui-extractor/UI_DESIGN_GUIDE.md`
3. `jb-ui-extractor/design/tokens.json`
4. `jb-ui-extractor/design/measurements.json`
5. `jb-ui-extractor/src/wallet-ui-contract.ts`
6. `jb-ui-extractor/qa/ACCEPTANCE_CHECKLIST.md`
7. `references/홈 계좌 보유.svg`, `references/홈 계좌 안내.svg`, and `references/홈 내 카드.svg`

The JB account and card examples belong to the reference host. WSS wallet content belongs to the wallet WebView. The new `내 지갑` tab is a proposed extension, not an observed JB screen.
