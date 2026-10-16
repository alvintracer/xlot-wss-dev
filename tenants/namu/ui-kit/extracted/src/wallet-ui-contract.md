# Namu presentation contract · draft

| Region | Owner | Rule |
| --- | --- | --- |
| Status bar / OS keyboard | Device or host | No wallet imitation in production. |
| Root logo, top tabs, utility icons | Host chrome | Render once above WebView content. |
| Persistent black bottom menu and safe area | Host chrome | Render once at root, hidden for focused wallet flows by manifest policy. |
| `내 지갑` balance, asset list, activity | Wallet presentation | Use WSS payload and WSS actions. |
| Secure PIN / signing approval | Approved host SDK | Visual review fixture cannot collect secrets or replace host authorization. |
| Modal, wallet selector, send/receive | Wallet presentation | Accessible sheet/dialog, return host shell to root on close. |

The signed institution session, not a URL slug, selects the presentation profile. The Namu sandbox manifest uses the Kiwoom/JB capability baseline at the user's 2026-10-07 direction. Its chain, provider, identity, and key settings remain preview assumptions and need institution approval before production activation.
