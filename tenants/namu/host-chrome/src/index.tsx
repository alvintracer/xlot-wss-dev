import { Bell, GearSix, List, MagnifyingGlass, UserCircle } from '@phosphor-icons/react';
import './styles.css';

export interface NamuHostChromeProps {
  onAction?: (message: string) => void;
  onOpenWalletSettings?: () => void;
  activeTab?: string;
  onSelectTab?: (tab: string) => void;
  customerName?: string | null;
}

const topTabs = [{ id: 'wallet', label: '내 투자' }, { id: 'discover', label: '발견' }, { id: 'feed', label: '피드' }] as const;
const bottomTabs = [
  { id: 'home', label: '홈' },
  { id: 'watchlist', label: <>관심<br />그룹</> },
  { id: 'quotes', label: <>주식<br />현재가</> },
  { id: 'order', label: <>국내주식<br />주문</> },
  { id: 'portfolio', label: <>주식<br />잔고·손익</> },
] as const;

export function NamuHostHeader({ activeTab = 'wallet', onSelectTab, onAction, onOpenWalletSettings }: NamuHostChromeProps) {
  return <header className="namu-ui namu-host-header" data-testid="namu-root-header">
    <div className="namu-host-header__top">
      <img src={new URL('../../namu-logo-full.png', import.meta.url).href} alt="나무" />
      <div className="namu-host-header__tools">
        <button type="button" aria-label="검색" onClick={() => onAction?.('검색은 나무 앱에서 연결합니다.')}><MagnifyingGlass size={25} aria-hidden="true" /></button>
        <button type="button" aria-label="알림" onClick={() => onAction?.('알림은 나무 앱에서 연결합니다.')}><Bell size={25} aria-hidden="true" /><span className="namu-host-header__alert-dot" /></button>
        <button type="button" aria-label="설정" onClick={onOpenWalletSettings}><GearSix size={25} aria-hidden="true" /></button>
        <button type="button" aria-label="내 정보" onClick={() => onAction?.('내 정보는 나무 앱에서 연결합니다.')}><UserCircle size={25} aria-hidden="true" /></button>
      </div>
    </div>
    <nav className="namu-host-header__tabs" aria-label="나무 상단 메뉴">
      {topTabs.map((tab) => <button type="button" key={tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => tab.id === 'wallet' ? onSelectTab?.('wallet') : onAction?.(`${tab.label}은 나무 앱에서 연결합니다.`)}>{tab.label}{tab.id === 'wallet' ? <span aria-hidden="true" className="namu-host-header__money" title="이모지 © 토스팀 토스페이스">💸</span> : null}</button>)}
    </nav>
  </header>;
}

export function NamuHostNavigation({ activeTab = 'wallet', onAction }: NamuHostChromeProps) {
  return <nav className="namu-ui namu-host-nav" aria-label="나무 앱 기본 메뉴" data-testid="namu-root-navigation">
    <button className="namu-host-nav__menu" type="button" aria-label="전체 메뉴" onClick={() => onAction?.('전체 메뉴는 나무 앱에서 연결합니다.')}><List size={27} aria-hidden="true" /></button>
    {bottomTabs.map((tab) => <button className="namu-host-nav__item" type="button" key={tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => onAction?.(`${tab.id === 'portfolio' ? '주식 잔고·손익' : tab.id === 'watchlist' ? '관심 그룹' : tab.id === 'quotes' ? '주식 현재가' : tab.id === 'order' ? '국내주식 주문' : '홈'}은 나무 앱에서 연결합니다.`)}>{tab.label}</button>)}
  </nav>;
}
