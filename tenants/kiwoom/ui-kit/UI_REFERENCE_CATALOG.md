# Kiwoom UI reference catalog

키움 tenant 화면을 구현할 때 이미지의 역할을 빠르게 찾기 위한 색인이다. 이 문서는 스크린샷에서 관찰한 근거를 연결하며, 키움의 공식 디자인 시스템을 의미하지 않는다.

## 먼저 지킬 순서

1. `kiwoom-wallet-ui-guide/AGENT_IMPLEMENTATION_BRIEF.md`
2. `kiwoom-wallet-ui-guide/UI_DESIGN_GUIDE.md`
3. guide의 tokens, measurements, UI contract, QA checklist
4. 이 카탈로그에서 작업에 맞는 이미지 확인
5. `new/README.md`에서 새 자산 탭 자료 확인

`assets/references/`의 R01–R19 마스킹 사본을 비교 기준으로 사용한다. 이 폴더 루트의 원본은 출처 확인용이며, 개인정보가 보이는 원본은 `.gitignore`로 로컬에만 남긴다. `assets/previews/`와 `qa/` 이미지는 구현 결과 예시이므로 원본 외형보다 우선하지 않는다.

## 기존 키움 앱 레퍼런스

| ID | 파일 | 주로 참고할 것 |
| --- | --- | --- |
| R01 | `R01-stock-detail-options-login-gate.jpg` | 상세 섹션 간격, 로그인 게이트, 하단 거래 CTA |
| R02 | `R02-stock-detail-info-related-cards.jpg` | 본문 크기·행간, 섹션 제목, 가로 카드의 정보 밀도 |
| R03 | `R03-stock-detail-alert-watchlist-tabs.jpg` | 보조 칩, 밑줄 탭, 로그인 전 상태 |
| R04 | `R04-stock-detail-price-chart-trade-cta.jpg` | 큰 금액, 변화량 계층, 고정 이중 CTA |
| R05 | `R05-feature-guide-overlay-callout.jpg` | 딤, 기능 안내 콜아웃, 한 번만 노출하는 도움말 |
| R06 | `R06-benefits-home-lower-cards-navigation.jpg` | 루트 카드와 배너, 호스트 하단 내비게이션 |
| R07 | `R07-benefits-home-total-missions.jpg` | 회색 루트 캔버스, 총액, 채움형 탭, 큰 흰 카드 |
| R08 | `R08-benefits-mission-list-tabs.jpg` | 반복 목록 간격, 배지, 우측 정렬 값 |
| R09 | `R09-simple-auth-terms-progress.jpg` | 절차 헤더, 진행선, 약관 행, 단일 하단 CTA |
| R10 | `R10-explore-us-ranking-list.jpg` | 루트 셸, 자산형 목록, 이름/금액 정렬, 하단 메뉴 |
| R11 | `R11-menu-home-quick-actions.jpg` | 퀵 액션, 로그인 상태, 메뉴 상단 정보 밀도 |
| R12 | `R12-menu-home-service-list.jpg` | 긴 서비스 목록, 구분선, 하단 내비게이션 |
| R13 | `R13-simple-auth-intro-carousel.jpg` | 도입 화면, 캐러셀, 큰 여백, 하단 그라데이션 |
| R14 | `R14-phone-verification-filled-form.jpg` | 완료된 밑줄 필드, 라벨/값 크기, 필드 리듬 |
| R15 | `R15-phone-verification-carrier-sheet.jpg` | 50% 딤, 바텀시트, 닫기, 52px 선택행 |
| R16 | `R16-phone-verification-error-disabled-cta.jpg` | 검증 오류, 단계형 폼, 비활성 CTA |
| R17 | `R17-app-onboarding-start.jpg` | 온보딩 제목, 넓은 빈 공간, 하단 CTA |
| R18 | `R18-app-permissions-list.jpg` | 권한 항목의 아이콘·제목·설명·보조 배지 |
| R19 | `R19-secure-keypad-optical-reference.jpg` | 호스트 보안 입력의 존재와 경계만 참고. 색·치수·키 배열 복제 금지 |

실제 파일 경로는 `kiwoom-wallet-ui-guide/assets/references/` 아래다. 루트의 설명형 `.jpeg` 파일은 같은 화면의 사용자 제공 원본이며, 마스킹 사본이 있는 경우 구현 비교에는 R 파일을 우선한다.

## 새 자산 탭 레퍼런스

`new/`의 파일은 승인 전 intake evidence다. 전체 목록과 개인정보 처리 여부는 `new/README.md`를 따른다.

| 구현 주제 | 우선 이미지 | 적용 판단 |
| --- | --- | --- |
| 자산 홈·상단 탭 | `new/asset-home-main.jpeg` | `키움자산 / 디지털자산`, 총액, 채우기·보내기·환전하기, 잔고 구조 |
| 빈 상태·로딩 전환 | `new/asset-inquiry-empty-domestic.jpeg`, R16 | 값이 없는 상태와 조회 중 상태를 0원과 구분 |
| 받기/채우기 진입 | `new/asset-fund-in-open-banking-intro.jpeg` | 큰 안내문, 중앙 설명, 단일 다음 동작 |
| 보내기 수신자 | `new/asset-transfer-recipient-empty.jpeg` | 밑줄 입력, 수신자 탭, 조건 충족 전 disabled CTA |
| 기관 선택 모달 | `new/asset-transfer-institution-picker.jpeg`, R15 | 시트·탭·선택 그리드. 지갑 네트워크 선택에는 R15의 행 문법 우선 |
| 환전 입력 | `new/fx-exchange-amount-entry.jpeg` | 원화/외화 금액 계층, 환율 요약, 방향 전환 |
| 숫자 키패드 | `new/fx-exchange-amount-keypad.jpeg` | 키패드가 열렸을 때 레이아웃과 CTA 회피만 참고 |
| 안내 시트 | `new/fx-exchange-hours-notice.jpeg` | 긴 설명, 표, 하단 확인 CTA |
| 온보딩·캐러셀 | `new/open-banking-connect-overview.jpeg`, `new/open-banking-connect-account-list.jpeg`, R13 | 여러 장 도입 흐름과 페이지 간 정보량 |
| 상세 텍스트·폼 | R02, R14, R16, R18 | 본문 16, 보조 14, 라벨/오류 12의 역할 분리 |

## took WSS 확장에 적용하는 방식

- `툭주기/툭받기`, 연락처 송금, E2E 메시징, 멀티체인 지갑 슬롯은 기존 키움 화면에서 관찰된 기능이 아니라 **지갑 확장**으로 표시한다. 여기서 슬롯은 체인이 아니라 독립된 지갑 하나를 뜻한다.
- 외형은 R10 자산행, R15 시트, R14/R16 입력 문법을 재사용한다. 기능 제공 여부는 tenant manifest와 host/core capability가 결정한다.
- 연락처·카메라·보안 키패드·본인 인증은 호스트 브리지 소유다. 스크린샷을 보고 웹에서 보안 입력을 복제하지 않는다.
- 실제 수신 주소, 요청 링크, 잔액, 견적, KYT, 고객 승인이 준비되기 전에는 실행 버튼을 활성화하거나 성공 상태를 만들지 않는다.
- 이미지에 보이는 고객명, 전화번호, 계좌번호, 주소는 제품 코드·테스트 픽스처·문서에 옮기지 않는다.

## 파일 이름 규칙

- 원본 intake: `<domain>-<screen>-<state-or-variant>.<extension>`
- 마스킹된 기준 사본: `RNN-<domain>-<screen>-<state-or-variant>.jpg`
- 구현 미리보기: `<feature>-<screen-or-state>.png`

새 묶음은 `docs/UI_REFERENCE_INGEST.md`의 가벼운 분류 절차를 따른다. 깊은 OCR이나 자동 상품 문구 추출은 하지 않고, 보이는 화면 제목·주요 액션·상태만으로 이름을 붙인다.
