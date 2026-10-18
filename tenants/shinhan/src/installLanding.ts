export const shinhanInstallLanding = {
  tenantId: 'shinhan',
  brandName: '신한 슈퍼쏠',
  eyebrow: 'SHINHAN SUPER SOL',
  heading: '쏠지갑을 만나보세요',
  description: '내 디지털자산을 한곳에서 확인해요.',
  iconFile: 'shinhan-super-sol-512.png',
  launchSplash: {
    image: new URL('../presentation/assets/preview/shinhan-splash-full.png', import.meta.url).href,
    background: '#0739FA',
  },
  fontFamily: "ShinhanPreviewNanumSquareAC, 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif",
  colors: {
    canvas: '#F0F3FA', ink: '#172132', muted: '#748093',
    primary: '#0565F5', primaryInk: '#FFFFFF', accent: '#0649F6', border: '#DCE6FA',
  },
} as const;
