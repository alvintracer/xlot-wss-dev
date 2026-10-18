# Shinhan Android development shell

This Capacitor debug shell opens `https://www.took-wss.com/shinhan/app`. The same host serves the web/PWA and obtains a short-lived signed institution preview session before embedding the WSS wallet. The APK contains no signing key or server secret. It is a connected-device development build, not a release package or an institution-approved app.

From the repository root, run `npm run build:debug -w @took-wss/shinhan-android`. The APK is written to `apps/shinhan-android/android/app/build/outputs/apk/debug/app-debug.apk`. The package ID is `com.tookwss.shinhan`; OAuth uses the fixed `com.tookwss.shinhan://auth` callback. The thirdweb project must allow this bundle ID, callback, and host domain before Google/Apple connection can be validated on a device.

The shell provides the same Capacitor App, Filesystem, Share, biometric, in-app-browser, and system-bar bridges used by the shared host. It does not request NFC permission. Default status and navigation surfaces follow the pale Shinhan canvas and the host can update them with `TookSystemBars`. The debug launcher uses the local transparent wordmark with inset padding, and the launch view displays a cleaned derivative of the supplied splash reference full screen. The original screenshot stays local and is not bundled.

Device validation should cover signed preview entry, finance-to-wallet navigation, focused flow insets, secure host input, OAuth return, app icon, and splash. Production use additionally requires Shinhan-approved session issuance, policy/provider configuration, native secure input, and asset approval.
