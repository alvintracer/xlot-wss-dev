# QR 결제 운영 진단

## 결제 흐름과 관측 지점

1. POS가 결제 요청을 만들고 `paymentRequestId`를 QR에 담는다.
2. 송금자가 QR을 열면 요청을 조회하고, 결제 승인 한 번으로 전송 준비와 주소 위험도 검사를 시작한다.
3. 준비 API는 `wss_qr_prepare` 로그에 `paymentRequestId`, `intentId`, `durationMs`를 기록한다. KYT는 `wss_kyt_screened` 또는 `wss_kyt_unavailable`에 `traceId`, 판정, `durationMs`를 기록한다. 서명 요청은 준비가 끝난 뒤 열린다.
4. 서명 제출 API는 `wss_transfer_submit`에 `intentId`, 상태, `durationMs`를 기록한다. POS는 요청을 재조회하며 서버가 온체인 전송을 확인하면 `confirmed`로 표시한다. 송금 화면은 확정 시 월렛 잔액을 한 번만 새로고침한다.
5. 월렛 카드의 QR 이력과 POS 증빙은 월렛별 목록 API를 사용한다. 한 결제 건의 상태 재확인이 실패하면 해당 행은 기존 상태로 반환하고 `wss_qr_reconcile_failed`를 기록한다.

로그에는 비밀번호, 복구 조각, 서명 재료, 전화번호, 전체 지갑 주소를 남기지 않는다. 로그 검색에는 `paymentRequestId`와 `intentId`를 사용한다.

## 오류가 났을 때

- QR을 스캔했는데 다른 기기에서 진행 중이라고 나오면 해당 `paymentRequestId`의 요청 상태와 `intentId`를 먼저 확인한다. 중복 결제를 피하려고 이미 결제에 묶인 요청은 재사용하지 않는다.
- 결제 승인 뒤 기다리는 시간이 길면 `wss_qr_prepare.durationMs`와 `wss_kyt_screened.durationMs`를 비교한다. 준비 단계의 RPC 대기와 KYT를 병렬로 시작한다. 이 구간이 끝나기 전에는 기기 서명 화면이 열리지 않는다.
- 서명 뒤 송금 화면으로 튕기거나 완료가 늦으면 `wss_transfer_submit.status`, 거래 해시, 결제 요청 상태를 대조한다. `processing`은 실패가 아니므로 같은 요청으로 다시 서명하지 말고 상태를 재조회한다.
- POS 증빙에 일부 월렛이 빠지면 그 월렛의 `/payments` 요청 상태를 확인한다. 401은 만료된 기관 세션을 갱신한 뒤 한 번 재시도한다. 서버의 `wss_qr_reconcile_failed`가 있다면 요청 ID를 기준으로 해당 건만 조사한다.

Vercel 운영 로그 예시: `vercel logs --environment production --since 1h --json`. 출력에 고객 관련 값이 있을 수 있으므로 외부 공유 전에 식별자를 제거한다. 결제 요청 ID와 전송 의도 ID를 기준으로 같은 건의 로그를 묶는다.

## 품질 확인

나무 Android 앱과 PC POS로 서로 다른 월렛 두 개를 사용한다. 같은 QR을 두 번 스캔해 중복 결제가 막히는지, 결제 진행 중 POS 상태가 이어지는지, 확정 뒤 양쪽 애니메이션이 사라지고 수령 QR이 만료 표시되는지 확인한다. 이후 월렛 카드의 QR 이력, POS 관리의 영수증 이미지, 증빙 CSV가 같은 결제 건을 표시하는지 대조한다. 키움·JB는 각 기관 세션과 실제 앱 컨테이너에서 같은 검증을 반복한다.
