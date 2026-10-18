import { CaretLeft } from '@phosphor-icons/react';
import './styles.css';
export { ShinhanHostLoading } from './ShinhanHostLoading';

export type ShinhanSection = 'finance' | 'exchange' | 'wallet' | 'home';
export type ShinhanFinanceTab = 'bank' | 'card' | 'securities' | 'insurance';
export type ShinhanRootTab = 'home' | 'finance' | 'products' | 'benefits' | 'stocks';

const icon = (name: string) => new URL(`../../ui-kit/icons_transparent/${name}`, import.meta.url).href;
const navItems: { id: ShinhanRootTab; label: string; icon: string; activeIcon?: string }[] = [
  { id: 'home', label: '홈', icon: 'icon_home_filled.png' },
  { id: 'finance', label: '금융', icon: 'icon_won_circle_gray.png', activeIcon: 'icon_won_circle_blue.png' },
  { id: 'products', label: '상품', icon: 'icon_shopping_bag.png' },
  { id: 'benefits', label: '혜택', icon: 'icon_package.png' },
  { id: 'stocks', label: '주식', icon: 'icon_chart_up.png' },
];
const financeTabs: { id: ShinhanFinanceTab; label: string }[] = [
  { id: 'bank', label: '은행' }, { id: 'card', label: '카드' },
  { id: 'securities', label: '증권' }, { id: 'insurance', label: '보험' },
];

export function ShinhanHostHeader({ section, financeTab = 'bank', onFinanceTab, onBack, onAction, onSettings }: {
  section: ShinhanSection;
  financeTab?: ShinhanFinanceTab;
  onFinanceTab?: (tab: ShinhanFinanceTab) => void;
  onBack?: () => void;
  onAction?: (action: 'chat' | 'wallet' | 'search' | 'home') => void;
  onSettings?: () => void;
}) {
  const title = section === 'finance' ? '금융' : section === 'exchange' ? '환전' : section === 'wallet' ? '쏠지갑' : '홈';
  return <header className="shinhan-ui shinhan-host-header" data-section={section} data-testid="shinhan-root-header">
    <div className="shinhan-host-header__title-row">
      {section === 'finance' || section === 'home' ? null : <button className="shinhan-host-header__back" type="button" aria-label="뒤로" onClick={onBack}><CaretLeft size={26} weight="regular" aria-hidden="true" /></button>}
      <h1>{title}</h1>
      <div className="shinhan-host-header__actions">
        <button type="button" aria-label="AI 상담" onClick={() => onAction?.('chat')}><img src={icon('icon_chat_smile.png')} alt="" /></button>
        {section === 'wallet' && onSettings ? <button type="button" aria-label="설정" onClick={onSettings}><img src={icon('icon_gear.png')} alt="" /></button> : null}
        {section === 'finance' ? <button type="button" aria-label="쏠지갑으로 이동" onClick={() => onAction?.('wallet')}><img src={icon('icon_wallet.png')} alt="" /></button> : null}
        <button type="button" aria-label={section === 'finance' ? '검색' : '홈'} onClick={() => onAction?.(section === 'finance' ? 'search' : 'home')}>
          <img src={icon(section === 'finance' ? 'icon_search.png' : 'icon_home_outline.png')} alt="" />
        </button>
      </div>
    </div>
    {section === 'finance' ? <nav className="shinhan-host-header__finance-tabs" aria-label="금융 종류">
      {financeTabs.map(({ id, label }) => <button key={id} type="button" aria-current={financeTab === id ? 'page' : undefined} onClick={() => onFinanceTab?.(id)}>{label}</button>)}
      <span className="shinhan-host-header__indicator" data-tab={financeTab} aria-hidden="true" />
    </nav> : null}
  </header>;
}

export function ShinhanHostNavigation({ activeTab = 'finance', onSelectTab }: {
  activeTab?: ShinhanRootTab;
  onSelectTab?: (tab: ShinhanRootTab) => void;
}) {
  return <nav className="shinhan-ui shinhan-host-navigation" aria-label="신한 슈퍼쏠 기본 메뉴" data-testid="shinhan-root-navigation">
    {navItems.map((item) => <button key={item.id} type="button" aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => onSelectTab?.(item.id)}>
      <img src={icon(activeTab === item.id && item.activeIcon || item.icon)} alt="" />
      <span>{item.label}</span>
    </button>)}
  </nav>;
}
