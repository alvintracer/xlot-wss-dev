# Namu implementation brief

Read this file completely, then follow `../README.md`'s order: design guide, tokens, measurements, UI contract, and QA checklist. Read `UI_SPEC.md` and the JSON maps before editing components.

## Authority and boundaries

- The 42 screenshots in `../references/` are the visual source. `R033` is the main **내 투자 / 나무 자산** reference; `R032` is the dense holdings list; `R035` and `R041` show two distinct number pads; `R037` shows the OS Korean keyboard; `R003`, `R019`, and `R020` show the persistent black bottom bar and detail navigation. The Namu logo files at the tenant root are supplied assets.
- Keep the host header, black bottom navigation, and safe area in host chrome. The wallet content starts below that header and stops above the nav. Focused send, receive, recovery, and authentication flows follow the existing WSS bridge.
- `내 지갑` is a **wallet-extension** using the source app's composition. Stock values, personal details, account numbers, article content, and screenshots themselves must not become runtime fixture data.
- Static captures cannot determine font family, motion timing, keyboard SDK behavior, or the real mobile viewport. Record those as estimates or unknowns. Visual approval remains pending.
- Real credential entry and OS keyboard are host/platform owned. A Namu-shaped keypad in the UI kit is a visual and interaction review fixture with synthetic, nonsecret digits only.

## Current implementation route

Namu primitives and the wallet summary live in `tenants/namu/presentation`. Host chrome lives in `tenants/namu/host-chrome`. A development-only review entry under `apps/wallet-webview` renders these same components with synthetic data. Following the user's 2026-10-07 direction to implement the same capabilities as Kiwoom/JB, `tenants/namu/src/index.ts` now declares a **sandbox preview manifest** with their common WSS capability baseline and Namu's distinct presentation, colors, and consent version. This is a development configuration, not evidence of NH투자증권 approval of chains, providers, identity flow, or key policy. A short-lived signed session still selects the runtime tenant. Production activation needs institution-approved policy and integration review.
