import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowClockwise, CaretRight, IdentificationCard, X } from '@phosphor-icons/react';
import type { ReadyWalletHomePayload, WalletProfileSummary } from '@took-wss/contracts';
import { ShinhanHostHeader, ShinhanHostNavigation, type ShinhanFinanceTab, type ShinhanRootTab } from '../../../tenants/shinhan/host-chrome/src';
import { ShinhanSimplePasswordPreview } from '@took-wss/tenant-shinhan-host-chrome/simple-password-preview';
import { ShinhanWalletSummary } from '../../../tenants/shinhan/presentation/src/ShinhanWalletSummary';
import { ShinhanTransferPreview, type ShinhanTransferStage } from '@took-wss/tenant-shinhan-host-chrome/transfer-preview';
import { ShinhanIdentityPreview, type ShinhanIdentityRecord } from './ShinhanIdentityPreview';
import './shinhanReview.css';

const retirementBank = new URL('../../../tenants/shinhan/presentation/assets/preview/retirement-bank-preview.png', import.meta.url).href;
const exchangeCoin = new URL('../../../tenants/shinhan/presentation/assets/preview/exchange-coin-preview.png', import.meta.url).href;
const wordmark = new URL('../../../tenants/shinhan/presentation/assets/preview/super-sol-wordmark-preview.png', import.meta.url).href;
const financeTabs: ShinhanFinanceTab[] = ['bank', 'card', 'securities', 'insurance'];
type Scene = 'finance' | 'exchange' | 'wallet' | 'identity' | 'splash' | `transfer-${ShinhanTransferStage}` | 'simple-password';

const reviewWallet: WalletProfileSummary = { walletId: 'shinhan-local-preview', label: '내 지갑', keyAdapter: 'took-sar', origin: 'created' };
const reviewHome: ReadyWalletHomePayload = {
  status: 'ready', wallet: reviewWallet, wallets: [reviewWallet], source: 'wallet-query',
  totalFiat: { currency: 'KRW', display: '280,000원', asOf: '2026-10-18T00:00:00.000Z', stale: false },
  assets: [
    { assetId: 'sample-a', symbol: 'SYN', name: '자산 A', network: 'review', balanceAtomic: '0', balanceDisplay: '1.25개' },
    { assetId: 'sample-b', symbol: 'SYN', name: '자산 B', network: 'review', balanceAtomic: '0', balanceDisplay: '14개' },
  ],
  receiveAssets: [], networks: [], valuation: { currency: 'KRW', provider: 'review', status: 'sandbox', asOf: '2026-10-18T00:00:00.000Z' },
  recovery: { profile: 'sar-2-of-3', status: 'ready', policyVersion: 1 },
};

function FinanceBankPane({ onEdit, onDetails, onTransfer }: { onEdit: () => void; onDetails: () => void; onTransfer: () => void }) {
  return <div className="shinhan-review-finance-pane" data-testid="shinhan-bank-pane">
    <div className="shinhan-review-amount-line"><span>금액</span><span className="shinhan-review-toggle" aria-label="금액 표시됨"><span>₩</span></span><button type="button" onClick={onEdit}>편집 <CaretRight size={17} aria-hidden="true" /></button></div>
    <section className="shinhan-review-account-card" aria-label="계좌">
      <div className="shinhan-review-account-card__head"><h2>계좌</h2><button type="button" onClick={onDetails}>전체계좌 <CaretRight size={17} aria-hidden="true" /></button></div>
      <div className="shinhan-review-account-card__account"><span className="shinhan-review-account-card__bank-mark" aria-hidden="true">S</span><div><strong>입출금 계좌</strong><small>신한은행 · 계좌번호 끝 1234</small></div><span aria-hidden="true">⚙</span></div>
      <strong className="shinhan-review-account-card__amount">1,250,000원</strong>
      <button className="shinhan-review-account-card__action" type="button" onClick={onTransfer}>이체</button>
    </section>
    <div className="shinhan-review-account-pager" aria-hidden="true"><span>‹</span><i /><i className="is-current" /><i /><i /><span>›</span></div>
    <section className="shinhan-review-retirement" aria-label="퇴직연금 안내"><div><strong>나의 퇴직연금 현황 확인하기</strong><span>내 자산 보기 <CaretRight size={15} aria-hidden="true" /></span></div><img src={retirementBank} alt="" /></section>
  </div>;
}

function FinanceOtherPane({ tab }: { tab: Exclude<ShinhanFinanceTab, 'bank'> }) {
  const content = tab === 'card' ? ['내 카드', '최근 이용내역'] : tab === 'securities' ? ['총 자산', '투자 준비'] : ['보험', '가입한 보험'];
  return <div className="shinhan-review-other-pane"><section><h2>{content[0]}</h2><strong>0원</strong><p>조회된 내용이 없어요.</p></section><section><h2>{content[1]}</h2><p>연결된 내역을 확인할 수 있어요.</p></section></div>;
}

function ExchangeScene({ loading, onRefresh, onStart }: { loading: boolean; onRefresh: () => void; onStart: () => void }) {
  return <div className="shinhan-review-exchange" data-testid="shinhan-exchange-scene">
    <section className="shinhan-review-exchange-promo"><div className="shinhan-review-exchange-promo__top"><img src={exchangeCoin} alt="" /><div><p>최대 90% 환율우대로 알뜰하게 환전해요</p><h2>쏠편한 환전</h2></div></div><button type="button" onClick={onStart}>환전하기</button></section>
    <section className="shinhan-review-rates" aria-label="환율 정보" data-loading={loading}><div className="shinhan-review-rates__grid">{[['🇺🇸','미국 USD','1,338.50'],['🇯🇵','일본 JPY','847.09'],['🇪🇺','유럽 EUR','1,504.34']].map(([flag,label,value])=><div key={label}><span aria-hidden="true">{flag}</span><small>{label}</small>{loading ? null : <><strong>{value}</strong><em>-0.42%</em></>}</div>)}</div><div className="shinhan-review-rates__foot"><span>환전 시 적용되는 환율을 확인해요.</span><button type="button" onClick={onRefresh} aria-label="환율 새로고침"><ArrowClockwise size={18} aria-hidden="true" /></button></div>{loading ? <span className="shinhan-review-spinner" role="status" aria-label="환율을 불러오는 중" /> : null}</section>
    <button className="shinhan-review-simple-row" type="button" onClick={onStart}>최근 환전내역 <CaretRight size={20} aria-hidden="true" /></button>
    <section className="shinhan-review-vault"><h2>환전 모바일금고</h2><button type="button" onClick={onStart}>금고 채우기</button></section>
  </div>;
}

function WalletScene({ hidden, identityRecord, onToggleBalance, onSheet, onIdentity }: { hidden: boolean; identityRecord: ShinhanIdentityRecord | null; onToggleBalance: () => void; onSheet: (name: string) => void; onIdentity: () => void }) {
  return <div className="shinhan-review-wallet" data-testid="shinhan-wallet-scene">
    <div className="shinhan-review-wallet__intro"><span className="shinhan-review-wallet__badge">S</span><div><strong>내 지갑</strong><p>자산을 한곳에서 확인해요.</p></div></div>
    <div className="shinhan-review-wallet__tabs"><button type="button" onClick={onIdentity}>신원·결제</button><strong>디지털자산</strong></div>
    <div className="shinhan-review-wallet__canvas"><ShinhanWalletSummary walletHome={reviewHome} balanceHidden={hidden} onToggleBalance={onToggleBalance} onOpenWalletSelector={() => onSheet('지갑 선택')} onAddWallet={() => onSheet('지갑 추가')} onSelectWallet={async () => {}} onShowAction={(action) => onSheet(action === 'receive' ? '받기' : action === 'send' ? '보내기' : '바꾸기')} onRefreshWallet={() => onSheet('새로고침')} onNavigate={() => {}} />
      <button className="shinhan-review-identity-entry" type="button" onClick={onIdentity}><span className="shinhan-review-identity-entry__icon"><IdentificationCard size={23} aria-hidden="true" /></span><span><strong>내 디지털 신원인증</strong><small>{identityRecord ? `발급 완료 · 연결된 지갑 ${identityRecord.connectedWallets.length}개` : '내 정보를 확인하고 디지털 ID를 발급해요'}</small></span><CaretRight size={20} aria-hidden="true" /></button>
      <section className="shinhan-review-holdings"><h2>보유 자산</h2><div><span className="shinhan-review-holdings__icon">A</span><span><strong>자산 A</strong><small>1.25개</small></span><b>{hidden ? '••••' : '180,000원'}</b></div><div><span className="shinhan-review-holdings__icon">B</span><span><strong>자산 B</strong><small>14개</small></span><b>{hidden ? '••••' : '100,000원'}</b></div></section>
      <section className="shinhan-review-activity"><h2>최근 내역</h2><p>아직 내역이 없어요.</p></section>
    </div>
  </div>;
}

function ReviewSheet({ title, onClose }: { title: string; onClose: () => void }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(sheetRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      if (!focusables.length) return;
      if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0]?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="shinhan-review-sheet-layer"><button className="shinhan-review-sheet-layer__scrim" type="button" aria-label="닫기" onClick={onClose} /><section ref={sheetRef} className="shinhan-review-sheet" role="dialog" aria-modal="true" aria-labelledby="shinhan-review-sheet-title"><div className="shinhan-review-sheet__handle" aria-hidden="true" /><button ref={firstRef} type="button" aria-label="닫기" onClick={onClose}><X size={21} aria-hidden="true" /></button><h2 id="shinhan-review-sheet-title">{title}</h2><p>이 기능은 아직 준비 중이에요.</p><button className="shinhan-review-sheet__primary" type="button" onClick={onClose}>확인</button></section></div>;
}

function ReviewApp() {
  const url = new URL(window.location.href);
  const sceneParam = url.searchParams.get('scene');
  const initialScene: Scene = sceneParam === 'exchange' || sceneParam === 'wallet' || sceneParam === 'identity' || sceneParam === 'splash' || sceneParam === 'simple-password' || sceneParam === 'transfer-recipient' || sceneParam === 'transfer-amount' || sceneParam === 'transfer-confirm' || sceneParam === 'transfer-favorites' ? sceneParam : 'finance';
  const rawWidth = Number(url.searchParams.get('width'));
  const reviewWidth = [320, 360, 390, 430].includes(rawWidth) ? rawWidth : 360;
  const [scene, setScene] = useState<Scene>(initialScene);
  const [financeTab, setFinanceTab] = useState<ShinhanFinanceTab>('bank');
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [amountDigits, setAmountDigits] = useState(initialScene === 'transfer-confirm' ? '100' : '');
  const [identityRecord, setIdentityRecord] = useState<ShinhanIdentityRecord | null>(() => url.searchParams.get('identityState') === 'issued'
    ? { id: 'SOL-8F2C-91D4', name: '김하늘', birthDate: '1992.04.18', phoneMasked: '010-••••-4827', connectedWallets: ['sar'] }
    : null);
  const [sheet, setSheet] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const loadingTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (loadingTimerRef.current !== null) window.clearTimeout(loadingTimerRef.current); }, []);
  const openSheet = (name: string) => { openerRef.current = document.activeElement as HTMLElement; setSheet(name); };
  const closeSheet = useCallback(() => { setSheet(null); window.setTimeout(() => openerRef.current?.focus(), 0); }, []);
  const refresh = () => { setLoading(true); if (loadingTimerRef.current !== null) window.clearTimeout(loadingTimerRef.current); loadingTimerRef.current = window.setTimeout(() => setLoading(false), 1400); };
  const section = scene === 'finance' || scene === 'exchange' || scene === 'wallet' ? scene : null;
  const transferStage = scene.startsWith('transfer-') ? scene.slice('transfer-'.length) as ShinhanTransferStage : null;
  const closeTransfer = () => { setScene('finance'); setAmountDigits(''); };
  const backTransfer = () => { if (scene === 'transfer-amount' || scene === 'transfer-favorites') setScene('transfer-recipient'); else if (scene === 'transfer-confirm') setScene('transfer-amount'); else if (scene === 'simple-password') setScene('transfer-confirm'); else closeTransfer(); };
  const onRootTab = (tab: ShinhanRootTab) => { if (tab === 'finance') setScene('finance'); else openSheet(tab === 'home' ? '홈' : tab === 'products' ? '상품' : tab === 'benefits' ? '혜택' : '주식'); };
  return <main className="shinhan-review-page">
    <aside className="shinhan-review-controls"><small>SHINHAN · SCREEN FLOW</small><h1>Super SOL 화면</h1><p>금융 화면부터 쏠지갑과 신원인증까지 이어지는 흐름을 살펴보세요.</p><div role="group" aria-label="화면 선택">{([['finance','금융'],['exchange','환전'],['wallet','내 지갑'],['identity','신원인증 흐름'],['transfer-recipient','이체 화면'],['transfer-amount','금액 입력'],['transfer-confirm','보내기 확인'],['transfer-favorites','자주쓰는 계좌'],['simple-password','간편비밀번호'],['splash','스플래시']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={scene===id} onClick={()=>setScene(id)}>{label}</button>)}</div><p className="shinhan-review-controls__note">{reviewWidth} × {Math.round(reviewWidth*13/6)} CSS px</p></aside>
    <section className="shinhan-review-device shinhan-ui" data-scene={scene} data-testid="shinhan-review-device" aria-label="신한 슈퍼쏠 화면" style={{ width: reviewWidth, height: Math.round(reviewWidth*13/6) }}>
      {scene === 'splash' ? <div className="shinhan-review-splash"><div className="shinhan-review-status"><span>9:41</span><span>● ▰ ▰</span></div><img src={wordmark} alt="super SOL" /><div className="shinhan-review-system-nav" aria-hidden="true"><i /><i /><i /></div></div> : <>
        <div className="shinhan-review-status"><span>9:41</span><span>● ▰ ▰</span></div>
        {section ? <ShinhanHostHeader section={section} financeTab={financeTab} onFinanceTab={setFinanceTab} onBack={() => setScene('finance')} onAction={(action) => { if (action === 'wallet') setScene('wallet'); else if (action === 'home') setScene('finance'); else openSheet('서비스'); }} /> : null}
        <div className="shinhan-review-content" data-scene={scene}>
          {scene === 'finance' ? <div className="shinhan-review-finance-viewport"><div className="shinhan-review-finance-track" style={{ transform: `translateX(-${financeTabs.indexOf(financeTab)*25}%)` }}>{financeTabs.map(tab => <div key={tab} className="shinhan-review-finance-track__pane">{tab === 'bank' ? <FinanceBankPane onEdit={() => openSheet('금액 편집')} onDetails={() => openSheet('계좌 상세')} onTransfer={() => setScene('transfer-recipient')} /> : <FinanceOtherPane tab={tab} />}</div>)}</div></div> : null}
          {scene === 'exchange' ? <ExchangeScene loading={loading} onRefresh={refresh} onStart={() => openSheet('환전')} /> : null}
          {scene === 'wallet' ? <WalletScene hidden={hidden} identityRecord={identityRecord} onToggleBalance={() => setHidden(value=>!value)} onSheet={openSheet} onIdentity={() => setScene('identity')} /> : null}
          {scene === 'identity' ? <ShinhanIdentityPreview record={identityRecord} onRecordChange={setIdentityRecord} onClose={() => setScene('wallet')} /> : null}
          {transferStage ? <ShinhanTransferPreview stage={transferStage} onStage={(stage) => setScene(`transfer-${stage}`)} onClose={closeTransfer} onPin={() => setScene('simple-password')} amountDigits={amountDigits} onAmountDigits={setAmountDigits} onBack={backTransfer} onPreviewAction={openSheet} /> : null}
          {scene === 'simple-password' ? <ShinhanSimplePasswordPreview onClose={() => setScene('transfer-confirm')} /> : null}
        </div>
        {scene === 'finance' ? <div className="shinhan-review-navigation"><ShinhanHostNavigation activeTab="finance" onSelectTab={onRootTab} /></div> : null}
        <div className="shinhan-review-system-nav" aria-hidden="true"><i /><i /><i /></div>
        {sheet ? <ReviewSheet title={sheet} onClose={closeSheet} /> : null}
      </>}
    </section>
  </main>;
}

if (!import.meta.env.DEV) {
  document.getElementById('root')!.textContent = '개발 환경에서만 열 수 있습니다.';
} else {
  createRoot(document.getElementById('root')!).render(<ReviewApp />);
}
