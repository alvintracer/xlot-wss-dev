# 키움 임베디드 지갑 UI 개발 전달 패키지

**v1.0 / 2026-09-27**

## 바로 보기

`UI_DESIGN_GUIDE.html`을 브라우저로 열면 색상·규격·원본 이미지·지갑 예시·전체 가이드를 볼 수 있습니다. `wallet-preview.html`은 별도 설치 없이 열 수 있는 클릭형 UI 예시입니다. HTML은 폰트/CDN/백엔드를 요청하지 않습니다. 실제 폰트는 실행 환경의 설치 서체를 사용하므로 기기에 따라 외형이 달라질 수 있습니다.

개발자/코딩 에이전트에게는 **이 폴더 전체 + `AGENT_IMPLEMENTATION_BRIEF.md`**를 전달하세요. 한 파일만 넣을 수 있는 환경에서는 `UI_DESIGN_GUIDE.md`를 우선 사용하고 참고 이미지와 토큰을 추가로 전달하세요.

## 구성

```text
UI_DESIGN_GUIDE.html                 단독 열람용 종합 가이드
UI_DESIGN_GUIDE.md                   개발용 원문
AGENT_IMPLEMENTATION_BRIEF.md        에이전트 착수 지시문
wallet-preview.html                 오프라인 클릭형 프로토타입
design/tokens.json                  토큰 기준
design/tokens.css                   자동 생성 CSS 변수
design/measurements.json            원본 좌표/색상 측정 근거
src/kiwoom-wallet.css               호스트와 충돌하지 않는 scoped CSS
src/wallet-ui-contract.ts           실제 연동을 위한 UI 계약 시작점
src/preview.js                      데모 전용 상태/이벤트 (실서비스 사용 금지)
assets/references/                  개인정보 가림 참고 이미지 19장
assets/derived/                     검수용 로고 크롭, 정식 교체 필요
assets/previews/                    렌더링한 화면 예시
assets/reference-manifest.json      출처/마스킹/크롭 이력
qa/ACCEPTANCE_CHECKLIST.md           통합·시각·상태 검수표
qa/test-results.json                이번 자동 점검 결과
tools/build_tokens.py               JSON → CSS 변수 생성기
```

## 실제 개발에서 CSS 사용

```html
<link rel="stylesheet" href="design/tokens.css">
<link rel="stylesheet" href="src/kiwoom-wallet.css">
<div class="kw-root"><!-- 호스트 연동 컴포넌트 --></div>
```

`tokens.json`을 수정한 뒤 `python tools/build_tokens.py`를 실행해 `tokens.css`를 갱신하세요. 컴포넌트 조합의 여백·상태별 레이아웃은 `kiwoom-wallet.css` 및 각 화면에서 관리합니다. 독립 데모 HTML은 생성 시점의 CSS/JS를 담은 snapshot이므로 소스 변경 시 별도로 다시 빌드해야 합니다.

미리보기를 호스트 셸 없는 콘텐츠 모드로 보려면 `wallet-preview.html?embed=1&view=home` 형태로 엽니다. 실제 앱에서는 가짜 상태 표시줄·시스템 하단 버튼·데모 검수 패널을 포함하지 않습니다. 루트 헤더/하단 탭은 호스트 소유 여부에 맞춰 한 번만 렌더링합니다.

## 데이터와 미검증 영역

화면 속 지갑 잔액·주소·시세·수수료·거래 상태는 가상값입니다. 받기 화면의 QR 영역은 의도적으로 스캔 불가능한 자리표시자입니다. 네트워크 조회·KYT·실제 인증·서명·송금·복구를 수행하지 않습니다. 참고용 종목 화면의 숫자는 첨부 캡처의 표시값이며 현재 시세가 아닙니다.

이 자료는 **원본 앱의 공식 디자인 시스템이 아닌 스크린샷 역설계 가이드**입니다. 폰트 파일은 포함하지 않습니다. 폰트·정식 아이콘·일러스트·실제 앱 viewport를 확보하고 실단말 비교를 마쳐야 최종 시각 일치를 승인할 수 있습니다. 자세한 미검증 항목은 `qa/ACCEPTANCE_CHECKLIST.md`를 확인하세요.
