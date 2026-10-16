# JB wallet implementation brief

Build a JB tenant of the existing WSS capability. Preserve the source assets and handoff. The host owns the account/card/wallet tabs, top identity and actions, bottom five-item navigation, safe area, and secure authentication. The wallet WebView owns only wallet content and focused wallet flows.

The user requests `내 지갑` next to `내 계좌` and `내 카드`, using the `홈 계좌 보유` screen as the visual base. This is a **new wallet extension**. It must not be described as part of the original bank app. Use the existing WSS session, registration, wallet, transfer, receive, exchange, and signing contracts; do not implement secrets in the WebView or substitute screenshot data for account balances.

The source `representative.html` is a static layout handoff and has no interactions. Its home illustration differs in some details from the supplied SVG; prefer the actual SVG for visual choices. Neither the production JB font nor official interactive assets nor a device comparison is provided. Do not claim pixel-perfect completion.
