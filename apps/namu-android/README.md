# Namu Android device-validation build

This Capacitor shell opens the existing Namu WSS host at `https://www.took-wss.com/namu/app`. The host issues the same short-lived institution session and embeds the same wallet WebView as the PWA. The APK contains no customer signing key or server secret. The remote URL is intentional for the current showcase/device-validation build; this is not an offline or store-release bundle.

## Build

From the repository root:

```sh
npm install
npm run build:debug -w @took-wss/namu-android
```

Output: `apps/namu-android/android/app/build/outputs/apk/debug/app-debug.apk`. The package is `com.tookwss.namu` and can coexist with the PWA. The debug APK is signed with the local Android debug keystore and is for connected-device verification only.

## Implemented bridge

- The Namu host verifies the embedded wallet frame source and origin before accepting native requests.
- The ISO-DEP NFC card reader is copied from the verified took! Android plugin, with only its Java package changed. It reads the card applet's public identity; the one-time PIN and signing methods remain native and are not used by the current WSS card UI.
- The Namu card sheet can scan a prepared physical card and remember its public identity on this device. Its wallet and chain toggles remain local display settings; they do not bind an EOA/smart account or enable NFC payments.
- Bithumb and Coinone open in an allowlisted Android WebView with a tenant-branded router. Coinone opens the withdrawal address book directly, so an existing login does not land on an unrelated account page. On the address-book route, the router uses the selected wallet's public EVM address, creates an ETH address-book entry if needed, and opens personal-wallet additional registration. The Coinone ownership message is approved by the wallet app; no signing key is passed to the exchange WebView.
- Google/Apple wallet login from this Capacitor shell uses an external browser and returns through the fixed URI `com.tookwss.namu://auth`. The Android App plugin forwards the result to the wallet frame, which requires a pending login and lets thirdweb consume its one-time redirect state before reconnecting the account. The thirdweb project must allow the `www.took-wss.com` domain, `com.tookwss.namu` bundle ID, and `com.tookwss.namu://auth` redirect URI.
- Android status and navigation bar backgrounds follow the host's current header and bottom tab colors. Focused flows and white modals switch both to white; the host calls the `TookSystemBars` native plugin with validated hex colors. Insets keep the WebView clear of system controls, including three-button navigation.

When building a Kiwoom or JB Android shell, register the same `TookSystemBars` bridge and take its default colors from that tenant's UI kit. The shared host reads each tenant's rendered header and navigation colors, so do not put tenant color branches in the host runtime. Verify the default, focused modal, keyboard, gesture navigation, and three-button navigation states on a device.

## Device verification sequence

1. Install the APK and open Namu Wallet. Confirm the PWA install gate is bypassed and the signed WSS session loads.
2. Open **월렛 카드**, tap **카드 등록하기**, and tag a prepared card. Confirm the displayed card ID and re-open the sheet to confirm local persistence.
3. Select the desired wallet, open **서비스 → 코인원**, and tap **거래소 열기 → 연결 시작**. Confirm the router keeps the selected wallet across the address-book and additional-registration screens.
4. Approve the ownership signature in the wallet app. If the selected wallet uses thirdweb, select the Google/Apple/email account that created it. Confirm the external browser returns to Namu and Coinone updates the address-book row.
5. Verify bottom safe area, sheet keyboard behavior, app icon, and splash on the physical device.

## Remaining for payment release

Physical-card payment needs an explicit WSS account binding, card PIN ceremony through the host, original took! smart-account/on-chain guard integration, policy/quote/execution adapters, and a payment transaction test. A local NFC read or visual wallet toggle alone does not activate payment. Exchange account registration has no provider callback/API confirmation; the router reads the exchange page's visible state and does not report a connection from an unconfirmed wallet signature alone.
