# 전북은행 모바일 플로우 — HTML/CSS Handoff

## 구성

- `index.html`: Figma와 동일한 순서의 35개 모바일 화면
- `styles.css`: 반응형 화면 갤러리와 공통 디자인 토큰
- `representative.html`: 직접 수정 가능한 대표 레이아웃 11종
- `representative.css`: 대표 레이아웃 전용 스타일과 Paperlogy 설정
- `assets/screens/`: 각 화면의 기준 PNG

## 실행

정적 서버의 루트를 저장소 루트로 지정하거나 `index.html`을 브라우저에서 열면 됩니다.

## 외부 에이전트 전달 시

각 `figure`의 `id`가 화면 순서를 나타냅니다. PNG를 시각적 기준으로 사용하고, 실제 구현에서는 화면별 `figure`를 semantic HTML 컴포넌트로 교체하세요. 기본 토큰은 `styles.css`의 `:root`에 정리되어 있습니다.

대표 화면은 `representative.html`에 이미지가 아닌 HTML 요소로 구현되어 있습니다. 기존 6종과 얼굴 인증, 지문 인증, 알림 설정, 인증번호 입력, 계좌 거래내역이 포함됩니다. 나머지 화면은 `assets/screens`의 PNG와 함께 전달하면 됩니다.

## Paperlogy

페이지 제목 계열은 `--font-display` 또는 `--paperlogy`로 Paperlogy를 우선 사용합니다. 웹폰트를 함께 전달하려면 `assets/fonts/Paperlogy-7Bold.woff2` 위치에 라이선스가 허용된 폰트 파일을 추가하세요. 설치된 로컬 Paperlogy도 자동 사용됩니다.

> 현재 패키지는 화면 구조와 시각 기준을 전달하기 위한 정적 HTML/CSS 핸드오프입니다. 입력, 인증, 내비게이션 동작은 포함하지 않습니다.