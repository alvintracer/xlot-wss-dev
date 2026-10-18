# Shinhan Super SOL development tenant

`shinhanManifest` selects the existing WSS sandbox capability baseline for signed development sessions. It is a product integration scaffold, not Shinhan-approved policy, custody, authentication, or provider configuration. Production activation needs an institution session issuer and approved native secure input.

The local UI evidence and design authority are in `ui-kit/`. Original screenshots, recordings, `app-logo.jpg`, and `splash.jpeg` stay local. The PWA and Android icons under `apps/` are resized from the supplied app logo. The photographed splash is not used because it includes system UI and a security message; the Android launch screen uses solid blue with the app mark.

- Web/PWA: `/shinhan/app` opens the Shinhan host finance root; the upper-right wallet control opens the WSS wallet at `/shinhan/wallet`. The wallet subview has no bottom host navigation.
- Android: `apps/shinhan-android` opens the same signed-session host. Its debug package ID is `com.tookwss.shinhan`.
- Host-owned finance/account transfer views use synthetic values and never submit a bank transfer through WSS. The photographed simple-password keypad is represented in local preview with a tap count only. WSS authentication and signing remain host-owned.
- The wallet keeps the shared WSS capabilities for creation, recovery, holdings, activity, receive/send, exchange, payments, and connected wallet paths where their configured development providers are available. A declared module or a visible action does not prove a funded transaction or institution approval.
