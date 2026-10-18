# Shinhan Super SOL UI kit

This folder contains the original screenshot set, supplied transparent icons, and additional capture groups. The two supplied identity files are at the tenant root: `app-logo.jpg` and `splash.jpeg`. Original paths and bytes are unchanged; `extracted/reference-manifest.json` names the original intake set. The newer certificate and identity-payment captures are mapped in `extracted/shinhan-certificate-evidence.md`.

Read in order:

1. `extracted/AGENT_IMPLEMENTATION_BRIEF.md`
2. `extracted/UI_DESIGN_GUIDE.md` and `extracted/UI_SPEC.md`
3. `extracted/design/tokens.css`, `extracted/design/measurements.json`, and `extracted/motion-evidence.json`
4. `extracted/src/wallet-ui-contract.md`
5. `extracted/qa/ACCEPTANCE_CHECKLIST.md`

`screen-map.json`, `component-map.json`, and `asset-map.json` connect source IDs to the preview. Source screenshots and videos can contain personal information and must not enter public bundles or shared reports. Transparent cutout candidates are kept in `.artifacts/preview-assets/`, with compressed copies under `../presentation/assets/preview/` for the development-only review page. Their source and approval status are in `asset-map.json`. They are generated review artifacts, not Shinhan-approved artwork.

`additional/` contains `R068`–`R074`: linked-account finance, recipient selection/list, amount keypad, transfer confirmation, favorite-account editing, and a photographed simple-password keypad. These are local evidence and are ignored by Git. The photographed keypad has lower geometry/color confidence than the direct app captures.

The 2026-10-18 `additional/` certificate folder contains direct screenshots, photographed secure screens, and four recordings. The identity-payment folder contains three direct screenshots. See `extracted/shinhan-certificate-evidence.md` for their screen roles and privacy boundary.
