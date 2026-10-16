import { CaretRight, CopySimple, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { openNativeExchange } from './nativeDevice';

const bithumbLogo = new URL('../assets/bithumb.png', import.meta.url).href;
const coinoneLogo = new URL('../assets/coinone.jpg', import.meta.url).href;

type ExchangeId = 'bithumb' | 'coinone';

const exchanges = {
  bithumb: { name: '빗썸', logo: bithumbLogo, color: '#ff8500' },
  coinone: { name: '코인원', logo: coinoneLogo, color: '#1467eb' },
} as const;

interface NamuServicesProps {
  walletId: string;
  walletLabel: string;
  walletAddress?: string;
  onFocusedOverlayChange: (focused: boolean) => void;
}

export function NamuServices({ walletId, walletLabel, walletAddress, onFocusedOverlayChange }: NamuServicesProps) {
  const [exchangeId, setExchangeId] = useState<ExchangeId | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onFocusedOverlayChange(exchangeId !== null);
    return () => onFocusedOverlayChange(false);
  }, [exchangeId, onFocusedOverlayChange]);

  useEffect(() => {
    if (!exchangeId) return;
    closeRef.current?.focus();
  }, [exchangeId]);

  const close = () => {
    setExchangeId(null);
    setMessage('');
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const open = (id: ExchangeId, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setMessage('');
    setExchangeId(id);
  };

  const openExchange = async () => {
    if (!exchangeId || !walletAddress) { setMessage('연결할 EVM 월렛 주소를 확인해 주세요.'); return; }
    setBusy(true);
    setMessage('');
    try { await openNativeExchange(exchangeId, walletId, walletAddress, walletLabel); close(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      setMessage(message === 'Android 앱에서 이용할 수 있어요.' || message === '연결할 EVM 월렛 주소가 없어요.'
        ? message : '거래소 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    finally { setBusy(false); }
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const exchange = exchangeId ? exchanges[exchangeId] : null;

  return <>
    <section className="kw-card namu-service-section" aria-labelledby="namu-service-title">
      <div className="namu-service-section__head">
        <div><h2 id="namu-service-title">서비스</h2><p>내 월렛을 거래소와 연결해요</p></div>
      </div>
      <div className="namu-service-grid">
        {(Object.keys(exchanges) as ExchangeId[]).map((id) => {
          const item = exchanges[id];
          return <button key={id} type="button" onClick={(event) => open(id, event.currentTarget)} aria-label={`${item.name} 월렛 연결 안내 보기`}>
            <img src={item.logo} alt="" aria-hidden="true" />
            <span><strong>{item.name}</strong><small>월렛 연결</small></span>
            <CaretRight size={17} aria-hidden="true" />
          </button>;
        })}
      </div>
    </section>

    {exchange ? <div className="kw-payment-layer namu-service-layer">
      <section className="kw-payment-sheet namu-service-sheet" role="dialog" aria-modal="true" aria-label={`${exchange.name} 월렛 연결 안내`} onKeyDown={onDialogKeyDown}>
        <header className="kw-payment-sheet__header">
          <strong>{exchange.name} 연결</strong>
          <button ref={closeRef} type="button" aria-label="닫기" onClick={close}><X size={22} aria-hidden="true" /></button>
        </header>
        <div className="kw-payment-sheet__body namu-service-sheet__body">
          <div className="namu-service-hero" style={{ '--service-color': exchange.color } as CSSProperties}>
            <div className="namu-service-hero__brand"><img src={exchange.logo} alt="" /><span>{exchange.name}</span></div>
            <h2>{exchange.name}에<br />나무 월렛 연결하기</h2>
            <p>거래소에서 내 월렛을 사용할 수 있도록 연결 과정을 안내해요.</p>
          </div>
          <div className="namu-service-wallet"><span>연결할 월렛</span><strong>{walletLabel}</strong></div>
          {walletAddress ? <button className="namu-service-address" type="button" onClick={() => void navigator.clipboard.writeText(walletAddress).then(() => setMessage('월렛 주소를 복사했어요.')).catch(() => setMessage('주소를 복사하지 못했어요.'))}>
            <span>{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</span><CopySimple size={17} aria-hidden="true" />
          </button> : <p className="namu-service-address-hint">연결 가능한 EVM 주소가 없어요.</p>}
          <p className="namu-service-preview-note">로그인 후 연결 도우미가 주소 등록을 진행해요. 지갑 소유 확인 서명은 나무 월렛에서 승인해 주세요.</p>
          {message ? <p className="namu-service-message" role="status">{message}</p> : null}
        </div>
        <div className="namu-service-sheet__footer">
          <button type="button" disabled={busy} onClick={() => void openExchange()}>
            {busy ? '거래소를 열고 있어요' : '거래소 열기'}
          </button>
        </div>
      </section>
    </div> : null}
  </>;
}
