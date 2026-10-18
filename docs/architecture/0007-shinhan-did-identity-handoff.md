# ADR 0007 · Shinhan DID identity handoff and device authorization

## Decision

Use the Super SOL Host as the customer-facing identity and device-authorization authority for a Shinhan DID issuance journey. Took WSS should receive a short-lived, signed result through an institution adapter, bind an appropriately labelled VC to a separate holder key, and let the customer connect noncustodial wallet addresses with separate wallet-control signatures. Do not build a parallel ID-camera, account-deposit, or PIN collection system inside the wallet WebView.

The local journey currently calls `verify-person` on the development Host. That call simulates the result of ID and account verification; it is **not evidence that Shinhan verified the person**. The existing credential remains `DEV_ASSUMED`, issued by the Took development issuer. The UI distinguishes entered name and birth date from verified phone possession. A production credential must be newly issued under a separately approved issuer and an `INSTITUTION_KYC_VERIFIED` or equivalent assurance level after the institution assertion is actually validated. No automatic upgrade from the PoC credential is allowed.

## Why

Super SOL already exposes its own certificate and approval journey. Shinhan's public guide describes ShinhanSIGN enrolment and customer-name, birth-date, and phone matching; the ShinhanSIGN FAQ describes approval in Super SOL by password, biometric, or pattern. Reusing the bank-controlled journey keeps customer identity and app security under the institution that already owns the relationship. A separate Took KYC stack would add operational responsibility and a second customer journey without improving the first integration. See [Super SOL guide](https://solgit.shinhan.com/sc26080079.html) and [ShinhanSIGN FAQ](https://portal.sign.shinhan.com/sp/qna/qnaList).

PASS or Kakao certification can be assessed as an institution-approved fallback where Super SOL cannot supply the required assertion. Neither should silently become the DID issuer: the verifier needs to know the actual issuer, evidence type, consent, assurance, freshness, and revocation state. Kakao's own certification documentation describes an integration and permission model for obtaining named identity attributes, which is a separate commercial and technical dependency. See [Kakao certification documentation](https://developers.kakao.com/docs/ko/kakao-certification/common).

## Target contract

1. Wallet asks Host to start an institution identity intent. Host owns ID capture, account verification, and native consent. The wallet receives only an opaque outcome reference, never images, account challenge digits, or CI.
2. The institution adapter validates a signed, time-bound assertion tied to the session and customer reference. It records issuer, method, evidence class, assurance, issue time, expiry, and replay nonce.
3. The VC issuer signs only the approved claim set and declared assurance. The holder key stays in the Host device vault. Wallet keys remain independent; linking a wallet requires a fresh wallet-control signature and holder signature.
4. Host authorizes sensitive DID use with the bank's native device security. Biometrics unlock a local authorization step; biometric templates and the PIN never enter the WebView, VC, DID document, BFF, or ZK proof. ZK proves a credential claim under a verifier challenge; it does not upgrade the assurance of the underlying identity evidence.
5. The verifier enforces issuer trust, assurance policy, consent, challenge freshness, binding, expiry, and revocation for each use case. A future custodial whitelist or transfer rule adds its own compliance decision; DID success alone does not approve a financial transaction.

## Current implementation boundary

- `verify-person` is a development-only Host response after a short loading state. Its future replacement is the signed institution assertion adapter above.
- `authorize` invokes enrolled native biometrics on a supported device. Browser development uses a Host-owned six-position keypad preview; only the pressed-position count is held. This preview is not a real PIN check. The Host requires a short-lived local authorization grant for `issue` and `verify`, and also requires the recent mock `verify-person` response for `issue`.
- `issue`, `bind-wallet`, and `verify` retain the existing Took development issuer, holder key, wallet signature, and Noir/UltraHonk proof paths. New UI stages do not alter cryptographic trust claims.
- Production builds reject the current development identity bridge. Institution integration, secure input approval, contractual issuer designation, and privacy review are required before this flow can be enabled for live customers.
