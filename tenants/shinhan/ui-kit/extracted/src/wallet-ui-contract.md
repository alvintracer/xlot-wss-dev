# Shinhan preview presentation contract

| Region | Owner | Rule |
| --- | --- | --- |
| Android status, system navigation, OS keyboard | Device/platform | Preview may show neutral stand-ins; production must use the real regions and insets. |
| Root title, utilities, finance tabs | Host chrome | Render once outside wallet content. |
| Floating five-item root navigation | Host chrome | Render once on the finance root. The supplied 쏠지갑 screen has no bottom tab bar; hide it in that subview and in focused flows. |
| Wallet total, holdings, activity, receive/send/exchange entry | Wallet presentation | Use WSS payload and callbacks; never embed screenshot values. |
| Authentication, consent, secure keypad | Approved host flow | Captures are visual evidence only. |
| Bank-account transfer recipient, amount, confirmation | Shinhan host app | Preview-only host scenes based on `R069`–`R073`; no bank transfer request or customer account data reaches WSS. |
| Simple-password keypad | Institution host/native secure input | Use the `R074` visual pattern whenever a Shinhan simple-password step is shown. The local preview stores only entered position count and cannot authorize a transfer. Never collect a PIN in the wallet WebView or BFF. |
| Focused wallet flow header and action footer | Wallet presentation with host coordination | Restore root chrome on close/cancel/completion. |

Only a short-lived institution session can select a production presentation. The `shinhan-super-sol-preview-v1` profile is bound to a development manifest using the common WSS sandbox baseline. No chain, provider, recovery, authentication, or consent setting follows from the source app captures or implies institution approval.

The local finance preview opens by default. Its upper-right wallet control opens the 쏠지갑 digital-asset subview, and the subview's back control returns to finance. This describes preview navigation only; host integration still needs the institution's navigation contract.
