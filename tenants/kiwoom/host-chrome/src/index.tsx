import {
  ChartPieSlice,
  Globe,
  SquaresFour,
  Star,
  Tag,
  UserCircle,
} from '@phosphor-icons/react';
import './styles.css';

export interface KiwoomHostChromeProps {
  onAction?: (message: string) => void;
}

const logoPreviewUrl = new URL(
  '../../ui-kit/kiwoom-wallet-ui-guide/assets/derived/kiwoom-logo-preview.png',
  import.meta.url,
).href;

const ROOT_NAV_ITEMS = [
  { id: 'explore', label: '탐색', Icon: Globe },
  { id: 'watchlist', label: '관심', Icon: Star },
  { id: 'assets', label: '자산', Icon: ChartPieSlice },
  { id: 'benefits', label: '혜택', Icon: Tag },
  { id: 'menu', label: '메뉴', Icon: SquaresFour },
] as const;

export function KiwoomHostHeader({ onAction }: KiwoomHostChromeProps) {
  return (
    <header className="kw-host-header" data-testid="kiwoom-root-header">
      <div className="kw-host-header__brand" aria-label="자산 페이지">
        <img src={logoPreviewUrl} alt="" aria-hidden="true" />
        <nav className="kw-host-asset-pages" aria-label="자산 서비스">
          <button type="button" onClick={() => onAction?.('키움자산 화면 전환은 금융사 호스트 앱이 담당합니다.')}>키움자산</button>
          <strong aria-current="page">디지털자산</strong>
        </nav>
      </div>
      <div className="kw-host-header__actions">
        <button type="button" aria-label="고객 정보" onClick={() => onAction?.('고객 정보는 금융사 호스트 앱이 연결합니다.')}>
          <UserCircle aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export function KiwoomHostNavigation({ onAction }: KiwoomHostChromeProps) {
  return (
    <nav className="kw-host-nav" aria-label="키움 앱 기본 메뉴" data-testid="kiwoom-root-navigation">
      {ROOT_NAV_ITEMS.map(({ id, label, Icon }) => {
        const isCurrent = id === 'assets';
        return (
          <button
            className="kw-host-nav__item"
            type="button"
            key={id}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onAction?.(isCurrent ? '현재 자산 화면입니다.' : `${label} 화면 전환은 금융사 호스트 앱이 담당합니다.`)}
          >
            <Icon size={24} weight={isCurrent ? 'fill' : 'regular'} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
