import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, CaretLeft, CheckCircle, IdentificationCard, LinkSimple, ShieldCheck, UserCircle, Wallet, X } from '@phosphor-icons/react';
import type { DigitalIdentityHostAction, DigitalIdentityHostResult, DigitalIdentitySummary, WalletProfileSummary } from '@took-wss/contracts';
import './identity.css';

type Stage = 'loading' | 'intro' | 'overview' | 'issued' | 'wallet-select' | 'wallet-confirm' | 'proof-request' | 'proof-consent' | 'proof-result';
type Request = (action: DigitalIdentityHostAction, walletId?: string) => Promise<DigitalIdentityHostResult>;

function shortAddress(value: string) { return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }

function CredentialCard({ summary }: { summary: DigitalIdentitySummary }) {
  return <section className="shinhan-identity__id-card" aria-label="디지털 신원인증 카드">
    <div className="shinhan-identity__id-card-top"><span className="shinhan-identity__id-mark">S</span><strong>SUPER SOL</strong><span>사용 가능</span></div>
    <div className="shinhan-identity__id-card-person"><span className="shinhan-identity__id-avatar"><UserCircle size={54} weight="thin" aria-hidden="true" /></span><div><small>내 디지털 신원인증</small><strong>{summary.name}</strong><span>{summary.birthDate.replace(/-/g, '.')}</span></div></div>
    <div className="shinhan-identity__id-card-number"><span>디지털 ID</span><code>SOL-{summary.credentialId.slice(0, 8).toUpperCase()}</code></div>
  </section>;
}

export function ShinhanDigitalIdentityEntry({ walletId, wallets, onFocusedOverlayChange, onRequest }: {
  walletId: string;
  wallets: WalletProfileSummary[];
  onFocusedOverlayChange: (focused: boolean) => void;
  onRequest: Request;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('loading');
  const [summary, setSummary] = useState<DigitalIdentitySummary | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState(walletId);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => { onFocusedOverlayChange(open); }, [open, onFocusedOverlayChange]);
  useEffect(() => () => onFocusedOverlayChange(false), [onFocusedOverlayChange]);
  useEffect(() => {
    if (open) { wasOpenRef.current = true; dialogRef.current?.querySelector<HTMLButtonElement>('.shinhan-identity__header button')?.focus(); }
    else if (wasOpenRef.current) entryRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setStage('loading'); setError(null);
    void onRequest('status').then((result) => {
      if (!active) return;
      if (!result.ok) { setError('신원인증 정보를 불러오지 못했어요. 다시 열어 주세요.'); setStage('intro'); return; }
      setSummary(result.summary ?? null);
      setStage(result.summary ? 'overview' : 'intro');
    }).catch(() => { if (active) { setError('신원인증 정보를 불러오지 못했어요.'); setStage('intro'); } });
    return () => { active = false; };
  }, [open, onRequest]);

  const run = async (action: DigitalIdentityHostAction, next: Stage, targetWalletId?: string) => {
    setBusy(true); setError(null);
    try {
      const result = await onRequest(action, targetWalletId);
      if (!result.ok) throw new Error(result.error || 'identity_unavailable');
      if (result.summary) setSummary(result.summary);
      if (action === 'verify' && !result.verified) throw new Error('credential_invalid');
      setStage(next);
    } catch {
      setError(action === 'bind-wallet' ? '지갑 연결을 확인하지 못했어요. 다시 시도해 주세요.'
        : action === 'issue' ? '디지털 ID를 발급하지 못했어요. 다시 시도해 주세요.'
          : '증명서를 확인하지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  const close = () => { if (busy) return; setOpen(false); setError(null); setConsent(false); };
  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? [])];
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  };
  const back = () => {
    if (stage === 'wallet-confirm') setStage('wallet-select');
    else if (stage === 'proof-consent') setStage('proof-request');
    else if (stage === 'wallet-select' || stage === 'proof-request' || stage === 'proof-result') setStage('overview');
    else close();
  };
  const linked = new Set(summary?.connectedWallets.map((wallet) => wallet.walletId) ?? []);
  const availableWallets = wallets.filter((wallet) => !linked.has(wallet.walletId));
  const selectedWallet = wallets.find((wallet) => wallet.walletId === selectedWalletId);

  return <>
    <button ref={entryRef} className="shinhan-live-identity-entry" type="button" onClick={() => setOpen(true)}>
      <span className="shinhan-live-identity-entry__icon"><IdentificationCard size={23} aria-hidden="true" /></span>
      <span><strong>내 디지털 신원인증</strong><small>{summary ? `발급 완료 · 연결된 지갑 ${linked.size}개` : '내 정보로 디지털 ID를 발급해요'}</small></span>
      <ArrowRight size={19} aria-hidden="true" />
    </button>
    {open ? <section ref={dialogRef} className="shinhan-identity shinhan-identity--live" role="dialog" aria-modal="true" aria-label="내 디지털 신원인증" onKeyDown={onDialogKeyDown}>
      <header className="shinhan-identity__header"><button type="button" aria-label="뒤로" onClick={back}><CaretLeft size={24} aria-hidden="true" /></button><strong>내 신원인증</strong><button type="button" aria-label="닫기" onClick={close}><X size={21} aria-hidden="true" /></button></header>
      <div className="shinhan-identity__scroll" aria-live="polite">
        {stage === 'loading' ? <div className="shinhan-live-identity-loading" role="status"><span className="shinhan-live-identity-spinner" aria-hidden="true" />신원인증을 확인하고 있어요</div> : null}
        {stage === 'intro' ? <><div className="shinhan-identity__hero-icon"><IdentificationCard size={31} weight="duotone" aria-hidden="true" /></div><h2>디지털 신원인증을 만들어요</h2><p className="shinhan-identity__lead">확인된 휴대폰과 입력한 이름·생년월일로 디지털 ID를 만들고 이 기기에 보관해요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>확인된 정보</span><strong>휴대폰 사용 여부</strong></div><div><span>입력한 정보</span><strong>이름 · 생년월일</strong></div><div><span>보관 위치</span><strong>내 기기</strong></div></div><p className="shinhan-identity__note">이름과 생년월일은 입력한 정보이며 별도 실명확인은 아직 진행되지 않았어요.</p><label className="shinhan-identity__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>디지털 ID 발급과 이 기기 보관에 동의해요.</span></label></> : null}
        {stage === 'issued' ? <><div className="shinhan-identity__hero-icon"><CheckCircle size={31} weight="duotone" aria-hidden="true" /></div><h2>디지털 신원인증이 준비됐어요</h2><p className="shinhan-identity__lead">원하는 지갑을 연결해 보세요.</p>{summary ? <CredentialCard summary={summary} /> : null}</> : null}
        {stage === 'overview' && summary ? <><h2>내 디지털 신원인증</h2><p className="shinhan-identity__lead">디지털 ID와 연결한 지갑, 확인할 수 있는 정보를 살펴보세요.</p><CredentialCard summary={summary} /><section className="shinhan-identity__overview-section"><h3>연결된 지갑 <span>{linked.size}</span></h3><div className="shinhan-identity__card">{summary.connectedWallets.length ? summary.connectedWallets.map((wallet) => <div className="shinhan-identity__row" key={wallet.walletId}><span className="shinhan-identity__row-icon"><Wallet size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>{wallet.label}</strong><small>{shortAddress(wallet.address)}</small></span><CheckCircle size={18} aria-hidden="true" /></div>) : <p className="shinhan-identity__empty">아직 연결된 지갑이 없어요.</p>}</div>{availableWallets.length ? <button className="shinhan-identity__text-action" type="button" onClick={() => { setSelectedWalletId(availableWallets[0]!.walletId); setStage('wallet-select'); }}>지갑 연결하기 <ArrowRight size={17} aria-hidden="true" /></button> : null}</section><section className="shinhan-identity__overview-section"><h3>확인 가능한 정보</h3><div className="shinhan-identity__card"><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><UserCircle size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>이름</strong><small>{summary.name} · 입력 정보</small></span></div><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><IdentificationCard size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>생년월일</strong><small>{summary.birthDate.replace(/-/g, '.')} · 입력 정보</small></span></div><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><ShieldCheck size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>휴대폰 사용 확인</strong><small>{summary.phoneMasked}</small></span></div></div></section></> : null}
        {stage === 'wallet-select' ? <><div className="shinhan-identity__hero-icon"><Wallet size={31} weight="duotone" aria-hidden="true" /></div><h2>어떤 지갑을 연결할까요?</h2><p className="shinhan-identity__lead">지갑마다 한 번씩 서명해 직접 통제하는지 확인해요.</p><div className="shinhan-identity__wallet-list" role="radiogroup" aria-label="연결할 지갑">{availableWallets.map((wallet) => <label className="shinhan-identity__wallet-option" data-selected={selectedWalletId === wallet.walletId} key={wallet.walletId}><input type="radio" name="identity-wallet" checked={selectedWalletId === wallet.walletId} onChange={() => setSelectedWalletId(wallet.walletId)} /><span className="shinhan-identity__wallet-avatar"><Wallet size={21} aria-hidden="true" /></span><span><strong>{wallet.label}</strong><small>{wallet.keyAdapter === 'took-sar' ? '쏠지갑에서 만든 지갑' : '연결된 지갑'}</small></span></label>)}</div></> : null}
        {stage === 'wallet-confirm' ? <><div className="shinhan-identity__hero-icon"><LinkSimple size={31} weight="duotone" aria-hidden="true" /></div><h2>이 지갑을 연결할게요</h2><p className="shinhan-identity__lead">지갑에서 서명해 주소를 직접 통제하는지 확인해요. 자산 이동은 일어나지 않아요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>연결할 지갑</span><strong>{selectedWallet?.label ?? '선택한 지갑'}</strong></div><div><span>확인 방법</span><strong>일회성 서명</strong></div></div></> : null}
        {stage === 'proof-request' ? <><div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div><h2>신원인증을 확인할게요</h2><p className="shinhan-identity__lead">발급된 디지털 ID와 이름·생년월일이 일치하는지 확인해요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>확인할 정보</span><strong>이름 · 생년월일</strong></div><div><span>추가 확인</span><strong>이 기기의 증명서 소유</strong></div><div><span>연결된 지갑</span><strong>{linked.size}개</strong></div></div><p className="shinhan-identity__note">이 확인은 쏠지갑 안에서 진행돼요.</p></> : null}
        {stage === 'proof-consent' ? <><div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div><h2>증명서 확인을 허용할까요?</h2><p className="shinhan-identity__lead">발급 서명과 이 기기의 소유 서명을 확인해요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>확인할 정보</span><strong>이름 · 생년월일</strong></div><div><span>확인 방식</span><strong>발급 서명 · 기기 서명</strong></div></div><label className="shinhan-identity__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>이번 증명서 확인에 동의해요.</span></label></> : null}
        {stage === 'proof-result' ? <><div className="shinhan-identity__hero-icon"><CheckCircle size={33} weight="duotone" aria-hidden="true" /></div><h2>신원인증을 확인했어요</h2><p className="shinhan-identity__lead">서명된 증명서와 이 기기의 소유 확인을 마쳤어요.</p><div className="shinhan-identity__result"><span className="shinhan-identity__pill">확인 완료</span><strong>디지털 ID 확인 완료</strong><p>이름·생년월일 일치와 발급 서명을 확인했어요.</p><div><span>발급 서명</span><b>유효</b></div><div><span>기기 소유</span><b>확인</b></div><div><span>이름 · 생년월일</span><b>일치</b></div></div></> : null}
        {error ? <p className="shinhan-live-identity-error" role="alert">{error}</p> : null}
      </div>
      {stage !== 'loading' ? <footer className="shinhan-identity__footer">
        {stage === 'intro' ? <button className="shinhan-identity__button" type="button" disabled={!consent || busy || Boolean(error)} onClick={() => void run('issue', 'issued')}>{busy ? '발급하고 있어요' : '디지털 ID 발급받기'}</button> : null}
        {stage === 'issued' ? <button className="shinhan-identity__button" type="button" onClick={() => { if (availableWallets.length) { setSelectedWalletId(availableWallets[0]!.walletId); setStage('wallet-select'); } else setStage('overview'); }}>{availableWallets.length ? '지갑 연결하기' : '내 신원인증 보기'}</button> : null}
        {stage === 'overview' ? <button className="shinhan-identity__button" type="button" onClick={() => setStage('proof-request')}>증명서 확인하기</button> : null}
        {stage === 'wallet-select' ? <button className="shinhan-identity__button" type="button" disabled={!selectedWalletId} onClick={() => setStage('wallet-confirm')}>선택한 지갑 연결하기</button> : null}
        {stage === 'wallet-confirm' ? <button className="shinhan-identity__button" type="button" disabled={busy} onClick={() => void run('bind-wallet', 'overview', selectedWalletId)}>{busy ? '지갑을 확인하고 있어요' : '서명하고 연결하기'}</button> : null}
        {stage === 'proof-request' ? <button className="shinhan-identity__button" type="button" onClick={() => { setConsent(false); setStage('proof-consent'); }}>요청 내용 확인하기</button> : null}
        {stage === 'proof-consent' ? <><button className="shinhan-identity__button" type="button" disabled={!consent || busy} onClick={() => void run('verify', 'proof-result')}>{busy ? '확인하고 있어요' : '동의하고 확인하기'}</button><button className="shinhan-identity__button shinhan-identity__button--secondary" type="button" onClick={() => setStage('overview')}>동의하지 않기</button></> : null}
        {stage === 'proof-result' ? <button className="shinhan-identity__button" type="button" onClick={() => setStage('overview')}>내 신원인증으로 돌아가기</button> : null}
      </footer> : null}
    </section> : null}
  </>;
}
