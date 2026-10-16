import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Backspace, CaretRight, X } from '@phosphor-icons/react';
import type { ReadyWalletHomePayload, WalletProfileSummary } from '@took-wss/contracts';
import { NamuWalletSummary } from '@took-wss/tenant-namu-presentation/kit';
import { NamuServices } from '@took-wss/tenant-namu-presentation/services';
import { NamuHostHeader, NamuHostNavigation } from '@took-wss/tenant-namu-host-chrome';
import './namuReview.css';

type ReviewCase = 'wallet' | 'light-keypad' | 'dark-keypad';
const syntheticAssets = [
  { name: '예시 자산 A', quantity: '1.25개', value: '180,000원', change: '+2.4%' },
  { name: '예시 자산 B', quantity: '14개', value: '72,000원', change: '-0.8%' },
  { name: '예시 자산 C', quantity: '0.004개', value: '28,000원', change: '—' },
];
const syntheticSecondAssets = [
  { name: '예시 자산 D', quantity: '3개', value: '75,000원', change: '—' },
];
const reviewWallets: WalletProfileSummary[] = [
  { walletId: 'review-wallet-1', label: '나무 월렛 1', keyAdapter: 'took-sar', origin: 'created' },
  { walletId: 'review-wallet-2', label: '가져온 월렛 1', keyAdapter: 'took-sar', origin: 'imported' },
  { walletId: 'review-wallet-3', label: '나무 월렛 2', keyAdapter: 'took-sar', origin: 'created' },
];
const reviewHomes: ReadyWalletHomePayload[] = reviewWallets.map((wallet, index) => ({
  status: 'ready', wallet, wallets: reviewWallets, source: 'wallet-query',
  totalFiat: { currency: 'KRW', display: index === 0 ? '280,000원' : index === 1 ? '75,000원' : '0원', asOf: '2026-10-08T01:09:00.000Z', stale: false },
  assets: (index === 0 ? syntheticAssets : index === 1 ? syntheticSecondAssets : []).map((asset, assetIndex) => ({
    assetId: `review-${index}-${assetIndex}`, symbol: 'SYN', name: asset.name, network: 'review',
    balanceAtomic: '0', balanceDisplay: asset.quantity,
  })), receiveAssets: [], networks: [],
  valuation: { currency: 'KRW', provider: 'review', status: index === 2 ? 'sandbox' : 'live', asOf: '2026-10-08T01:09:00.000Z' },
  recovery: { profile: 'sar-2-of-3', status: 'ready', policyVersion: 1 },
}));

function ReviewKeypad({ variant }: { variant: 'light' | 'dark' }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const keys = variant === 'light'
    ? ['1', '2', '3', 'C', '4', '5', '6', '가능', '7', '8', '9', '1/2', '00', '0', 'delete', '1/3']
    : ['1', '2', '', '3', '4', '5', '6', '', '7', '8', '9', '0', 'delete', '취소', '확인', ''];
  const update = (key: string) => {
    if (key === 'delete') setValue((current) => current.slice(0, -1));
    else if (key === 'C' || key === '취소' || key === '확인') { setValue(''); setOpen(false); }
    else if (/^\d+$/.test(key)) {
      const next = (value + key).slice(0, variant === 'dark' ? 6 : 8);
      setValue(next);
      if (variant === 'dark' && next.length === 6) setOpen(false);
    }
  };
  if (variant === 'dark') return <div className="namu-review-pin">
    <button className="namu-review-pin__dots" type="button" aria-label={`확인 번호 입력, ${value.length}자리 입력됨`} aria-expanded={open} onClick={() => setOpen(true)}>
      {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < value.length ? 'is-filled' : ''} aria-hidden="true" />)}
    </button>
    <div className="namu-review-pin__footer"><button type="button" onClick={() => { setValue(''); setOpen(false); }}>취소</button><button type="button" onClick={() => { if (value.length === 6) setValue(''); }}>다음</button></div>
    {open ? <div className="namu-review-pin__overlay"><button type="button" className="namu-review-pin__scrim" aria-label="키패드 닫기" onClick={() => setOpen(false)} />
      <div className="namu-review-pin__sheet" role="dialog" aria-modal="true" aria-label="검수용 보안 키패드">
        <button className="namu-review-pin__close" type="button" aria-label="키패드 닫기" onClick={() => setOpen(false)}><X size={20} aria-hidden="true" /></button>
        <div className="namu-review-pad__keys" aria-label="검수용 숫자 키패드">
          {keys.map((key, index) => key ? <button type="button" key={`${key}-${index}`} className={key === '확인' ? 'namu-review-pad__confirm' : undefined} onClick={() => update(key)} aria-label={key === 'delete' ? '한 자리 지우기' : key}>{key === 'delete' ? <Backspace size={21} aria-hidden="true" /> : key}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}
        </div>
      </div>
    </div> : null}
  </div>;
  return <div className={`namu-review-pad namu-review-pad--${variant}`}>
    <div className="namu-review-pad__head"><strong>{variant === 'light' ? '수량 계산기' : '확인 번호'}</strong><span>검수용 입력</span></div>
    {variant === 'light' ? <div className="namu-review-pad__fields"><div><span>수량</span><strong>{value || '0'} 주</strong><button type="button" onClick={() => setValue((current) => String(Number(current || '0') + 1))}>＋</button></div><div><span>단가</span><strong>— 원</strong><button type="button" disabled>＋</button></div><div><span>금액</span><strong>— 원</strong></div></div> : null}
    <div className="namu-review-pad__value" role="status">{value || (variant === 'light' ? '0' : '○ ○ ○ ○ ○ ○')}</div>
    <div className="namu-review-pad__keys" aria-label="검수용 숫자 키패드">
      {keys.map((key, index) => key ? <button type="button" key={`${key}-${index}`} className={key === '확인' ? 'namu-review-pad__confirm' : undefined} onClick={() => update(key)} aria-label={key === 'delete' ? '한 자리 지우기' : key}>{key === 'delete' ? <Backspace size={21} aria-hidden="true" /> : key}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}
    </div>
    {variant === 'light' ? <div className="namu-review-pad__footer"><button type="button" onClick={() => setValue('')}>취소</button><button type="button" onClick={() => setValue('')}>확인</button></div> : null}
  </div>;
}

function ReviewSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(sheetRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="namu-review-sheet-layer">
    <button className="namu-review-sheet-layer__scrim" type="button" aria-label="닫기" onClick={onClose} />
    <section ref={sheetRef} className="namu-review-sheet" role="dialog" aria-modal="true" aria-labelledby="namu-review-sheet-title">
      <div className="namu-review-sheet__handle" aria-hidden="true" />
      <button ref={closeRef} className="namu-review-sheet__close" type="button" aria-label="닫기" onClick={onClose}><X size={21} aria-hidden="true" /></button>
      <h2 id="namu-review-sheet-title">지갑에서 무엇을 할까요?</h2>
      <p>이 화면은 합성 데이터로 만든 시각 검수용 초안입니다.</p>
      {['받기', '보내기', '바꾸기'].map((label) => <button className="namu-review-sheet__row" type="button" key={label} onClick={onClose}><span>{label}</span><CaretRight size={19} aria-hidden="true" /></button>)}
      <button className="namu-review-sheet__primary" type="button" onClick={onClose}>확인</button>
    </section>
  </div>;
}

function ReviewApp() {
  const [reviewCase, setReviewCase] = useState<ReviewCase>('wallet');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState(reviewWallets[0]!.walletId);
  const openRef = useRef<HTMLButtonElement>(null);
  const closeSheet = () => { setSheetOpen(false); window.setTimeout(() => openRef.current?.focus(), 0); };
  return <main className="namu-review-page">
    <aside className="namu-review-controls">
      <small>NAMU UI KIT · LOCAL REVIEW</small><h1>나무 지갑 UI 초안</h1>
      <p>실제 스크린샷은 이 빌드에 포함되지 않습니다. 합성 금액과 동일한 컴포넌트로 배치·키패드·모달을 검수합니다.</p>
      <div role="group" aria-label="검수 화면 선택">
        {([['wallet', '내 지갑'], ['light-keypad', '거래 키패드'], ['dark-keypad', '보안 키패드']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={reviewCase === id} onClick={() => setReviewCase(id)}>{label}</button>)}
      </div>
      <button ref={openRef} type="button" onClick={() => setSheetOpen(true)}>모달 보기</button>
      <p className="namu-review-controls__note">430 × 932 CSS px · draft · 승인 전</p>
    </aside>
    <section className="namu-review-device" aria-label="나무 지갑 화면 미리보기" data-testid="namu-review-device">
      <div className="namu-review-status"><span>10:09</span><span>▂▄▆ LTE ▰</span></div>
      {reviewCase === 'wallet' ? <>
        <NamuHostHeader activeTab="wallet" onSelectTab={() => setReviewCase('wallet')} />
        <div className="namu-ui namu-wallet namu-review-content">
          <NamuWalletSummary walletHome={reviewHomes.find((home) => home.wallet.walletId === activeWalletId)!} balanceHidden={hidden}
            onToggleBalance={() => setHidden((value) => !value)} onOpenWalletSelector={() => setSheetOpen(true)} onAddWallet={() => setSheetOpen(true)}
            onSelectWallet={async (walletId) => { setActiveWalletId(walletId); }} onRefreshWallet={() => {}} onShowAction={() => setSheetOpen(true)} onNavigate={() => {}} />
          <section className="namu-review-assets" aria-label="보유 자산"><h2>보유 자산</h2><p>선택한 지갑의 자산</p>
            {(activeWalletId === reviewWallets[0]!.walletId ? syntheticAssets : activeWalletId === reviewWallets[1]!.walletId ? syntheticSecondAssets : []).map((asset) => <div className="namu-review-asset-row" key={asset.name}><span className="namu-review-asset-icon">●</span><span><strong>{asset.name}</strong><small>{asset.quantity}</small></span><span className="namu-review-asset-value"><strong>{hidden ? '••••' : asset.value}</strong><small>{asset.change}</small></span></div>)}
          </section>
          <section className="namu-review-assets namu-review-payment" aria-label="결제"><h2>결제</h2><p>월렛 카드 · 월렛 POS 미리보기 영역</p></section>
          <NamuServices walletId={activeWalletId} walletLabel={reviewWallets.find((wallet) => wallet.walletId === activeWalletId)!.label} walletAddress="0x2f5c2c5cde0b8d85a8c15a9a2a4b98140a19dd11" onFocusedOverlayChange={() => {}} />
          <section className="namu-review-assets namu-review-activity"><h2>보내기 내역</h2><p>아직 보낸 내역이 없어요.</p></section>
        </div>
        <NamuHostNavigation activeTab="wallet" onSelectTab={() => setReviewCase('wallet')} />
      </> : <div className={`namu-review-keypad-scene${reviewCase === 'dark-keypad' ? ' namu-review-keypad-scene--secure' : ''}`}><div className="namu-review-keypad-title">{reviewCase === 'light-keypad' ? '거래 수량' : '본인 확인'}</div><ReviewKeypad variant={reviewCase === 'light-keypad' ? 'light' : 'dark'} /></div>}
      {sheetOpen ? <ReviewSheet onClose={closeSheet} /> : null}
    </section>
  </main>;
}

if (!import.meta.env.DEV) {
  document.getElementById('root')!.textContent = '개발 환경에서만 열 수 있습니다.';
} else {
  createRoot(document.getElementById('root')!).render(<ReviewApp />);
}
