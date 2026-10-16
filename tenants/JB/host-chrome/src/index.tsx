import {
  Bell, CaretRight, CreditCard, Gear, Lightning,
  MagnifyingGlass, Tag, TrendUp, Wallet,
} from '@phosphor-icons/react';
import './styles.css';

export interface JbHostChromeProps {
  onAction?: (message: string) => void;
  onOpenWalletSettings?: () => void;
  activeTab?: string;
  onSelectTab?: (tab: string) => void;
  customerName?: string | null;
}

const tabs = [
  { id: 'account', label: '내 계좌' },
  { id: 'card', label: '내 카드' },
  { id: 'wallet', label: '내 지갑' },
] as const;

export function JbHostHeader({ activeTab = 'account', onSelectTab, onAction, onOpenWalletSettings, customerName }: JbHostChromeProps) {
  return (
    <header className="jb-host-header" data-testid="jb-root-header">
      <div className="jb-host-header__top">
        <strong>{customerName ? <><span className="jb-host-header__customer-name">{customerName}</span>님</> : '고객님'}</strong>
        <div className="jb-host-header__actions">
          <button type="button" aria-label="검색" onClick={() => onAction?.('검색은 JB 앱에서 연결합니다.')}><MagnifyingGlass size={23} aria-hidden="true" /></button>
          <button type="button" aria-label="알림" onClick={() => onAction?.('알림은 JB 앱에서 연결합니다.')}><Bell size={23} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="jb-host-header__tabs">
        <nav aria-label="JB 홈 탭">
          {tabs.map((tab) => <button key={tab.id} type="button" aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => onSelectTab?.(tab.id)}>{tab.label}</button>)}
        </nav>
        <button className="jb-host-header__settings" type="button" aria-label="설정" onClick={onOpenWalletSettings}><Gear size={22} aria-hidden="true" /></button>
      </div>
    </header>
  );
}

export function JbHostNavigation({ onSelectTab, onAction }: JbHostChromeProps) {
  const items = [
    { id: 'home', label: '홈', image: new URL('./assets/home.png', import.meta.url).href },
    { id: 'assets', label: '자산', image: new URL('./assets/assets.png', import.meta.url).href },
    { id: 'benefits', label: '혜택', image: new URL('./assets/benefits.png', import.meta.url).href },
    { id: 'products', label: '상품', image: new URL('./assets/products.png', import.meta.url).href },
    { id: 'all', label: '전체', image: new URL('./assets/all.png', import.meta.url).href },
  ] as const;
  return <nav className="jb-host-nav" aria-label="JB 앱 기본 메뉴" data-testid="jb-root-navigation">
    {items.map(({ id, label, image }) => <button key={id} type="button" aria-current={id === 'home' ? 'page' : undefined} onClick={() => id === 'home' ? onSelectTab?.('account') : onAction?.(`${label} 메뉴는 JB 앱에서 연결합니다.`)}><span className="jb-host-nav__icon"><img src={image} alt="" aria-hidden="true" /></span><span>{label}</span></button>)}
  </nav>;
}

function QuickAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick}><span className="jb-quick-icon" aria-hidden="true">{icon}</span><span>{label}</span></button>;
}

export function JbHostPreview({ activeTab = 'account', onSelectTab, onAction }: JbHostChromeProps) {
  const isAccount = activeTab === 'account';
  return <div className="jb-host-preview" role="region" aria-label={isAccount ? '내 계좌 미리보기' : '내 카드 미리보기'}>
    <section className="jb-host-preview__card">
      <div className="jb-host-preview__card-icon">{isAccount ? <Wallet size={24} aria-hidden="true" /> : <CreditCard size={24} aria-hidden="true" />}</div>
      <p>{isAccount ? '전북은행 계좌' : '전북은행 카드'}</p>
      <h2>{isAccount ? '내 계좌를 확인해 보세요' : '내 카드를 확인해 보세요'}</h2>
      <p className="jb-host-preview__detail">{isAccount ? '계좌 정보는 JB 앱에서 표시됩니다.' : '카드 정보는 JB 앱에서 표시됩니다.'}</p>
      <button type="button" onClick={() => onAction?.(isAccount ? '계좌 조회는 JB 앱에서 연결합니다.' : '카드 조회는 JB 앱에서 연결합니다.')}>{isAccount ? '전체계좌보기' : '카드 보러가기'}<CaretRight size={17} aria-hidden="true" /></button>
    </section>
    <div className="jb-host-preview__dots" aria-hidden="true"><i /><i /></div>
    {isAccount ? <button className="jb-host-preview__all" type="button" onClick={() => onAction?.('전체계좌 조회는 JB 앱에서 연결합니다.')}><strong>전체계좌보기</strong><CaretRight size={18} aria-hidden="true" /></button> : null}
    <section className="jb-host-preview__quick" aria-label="빠른 메뉴">
      <QuickAction label="쿠폰마켓" icon={<Tag size={22} />} onClick={() => onAction?.('쿠폰마켓은 JB 앱에서 연결합니다.')} />
      <QuickAction label="신용관리" icon={<TrendUp size={22} />} onClick={() => onAction?.('신용관리는 JB 앱에서 연결합니다.')} />
      <QuickAction label="내 카드" icon={<CreditCard size={22} />} onClick={() => onSelectTab?.('card')} />
      <QuickAction label="내 지갑" icon={<Wallet size={22} />} onClick={() => onSelectTab?.('wallet')} />
      <QuickAction label="자금모으기" icon={<Lightning size={22} />} onClick={() => onAction?.('자금모으기는 JB 앱에서 연결합니다.')} />
    </section>
    <section className="jb-host-preview__banner"><small>JB 디지털 지갑</small><strong>내 자산을 한눈에, 지갑에서 간편하게</strong><Wallet size={66} weight="duotone" aria-hidden="true" /></section>
  </div>;
}
