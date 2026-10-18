import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, CaretLeft, CaretRight, CheckCircle, CreditCard, FileText, Fingerprint, IdentificationCard, LinkSimple, ShieldCheck, UserCircle, Wallet, X } from '@phosphor-icons/react';
import type { DigitalIdentityHostAction, DigitalIdentityHostResult, DigitalIdentitySummary, WalletProfileSummary } from '@took-wss/contracts';
import './identity.css';
import { useShinhanWalletTabs } from './ShinhanWalletTabs';
import { ShinhanWalletMark } from './ShinhanWalletMark';
import { ShinhanIdentityHome, shinhanIdentityServiceIcon } from './ShinhanIdentityHome';

const superSolLogo = new URL('../assets/preview/super-sol-app-mark.png', import.meta.url).href;

type Stage = 'loading' | 'intro' | 'host-request' | 'checking' | 'secure-choice' | 'issuing' | 'overview' | 'issued' | 'wallet-select' | 'wallet-confirm' | 'proof-request' | 'proof-consent' | 'proof-verifying' | 'proof-result';
type Request = (action: DigitalIdentityHostAction, walletId?: string) => Promise<DigitalIdentityHostResult>;

function CredentialCard({ summary }: { summary: DigitalIdentitySummary }) {
  return <section className="shinhan-identity__id-card" aria-label="디지털 신원인증 카드">
    <div className="shinhan-identity__id-card-top"><span className="shinhan-identity__id-mark"><img src={superSolLogo} alt="" /></span><strong>신한 DID</strong><span>사용 가능</span></div>
    <div className="shinhan-identity__id-card-person"><span className="shinhan-identity__id-avatar"><UserCircle size={54} weight="thin" aria-hidden="true" /></span><div><small>내 디지털 신원인증</small><strong>{summary.name}</strong><span>{summary.birthDate.replace(/-/g, '.')}</span></div></div>
    <div className="shinhan-identity__id-card-number"><span>디지털 ID · 입력 정보 기반</span><code>SOL-{summary.credentialId.slice(0, 8).toUpperCase()}</code></div>
  </section>;
}

function ProofVerification() {
  return <div className="shinhan-identity__verification" role="status" aria-live="polite">
    <div className="shinhan-identity__verification-scene" aria-hidden="true">
      <div className="shinhan-identity__verification-halo" />
      <div className="shinhan-identity__verification-card">
        <span className="shinhan-identity__verification-mark"><IdentificationCard size={22} weight="duotone" /></span>
        <span className="shinhan-identity__verification-avatar"><UserCircle size={44} weight="thin" /></span>
        <span className="shinhan-identity__verification-lines"><i /><i /><i /></span>
        <span className="shinhan-identity__verification-scan" />
      </div>
      <span className="shinhan-identity__verification-seal"><ShieldCheck size={27} weight="fill" /></span>
    </div>
    <h2>증명서를 확인하고 있어요</h2>
    <p>디지털 ID와 이 기기의 소유 여부를 확인해요.</p>
    <div className="shinhan-identity__verification-track" aria-hidden="true"><span /></div>
    <small>확인이 끝나면 결과를 보여드릴게요</small>
  </div>;
}

export function ShinhanDigitalIdentityEntry({ walletId, wallets, onFocusedOverlayChange, onOpenPayment, onRequest }: {
  walletId: string;
  wallets: WalletProfileSummary[];
  onFocusedOverlayChange: (focused: boolean) => void;
  onOpenPayment: (screen: 'card' | 'pos') => void;
  onRequest: Request;
}) {
  const { setTab } = useShinhanWalletTabs();
  const [open, setOpen] = useState(false);
  const [auxiliarySheet, setAuxiliarySheet] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [summary, setSummary] = useState<DigitalIdentitySummary | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState(walletId);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [authorizationMethod, setAuthorizationMethod] = useState<'biometric' | 'simple-password-preview' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const auxiliaryRef = useRef<HTMLElement>(null);
  const auxiliaryTriggerRef = useRef<HTMLElement | null>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    let active = true;
    void onRequest('status').then((result) => {
      if (active && result.ok) { setSummary(result.summary ?? null); setBiometricEnabled(Boolean(result.biometricEnabled)); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [onRequest]);
  useEffect(() => { onFocusedOverlayChange(open || auxiliarySheet !== null); }, [open, auxiliarySheet, onFocusedOverlayChange]);
  useEffect(() => {
    if (auxiliarySheet) auxiliaryRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else auxiliaryTriggerRef.current?.focus();
  }, [auxiliarySheet]);
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
      setBiometricEnabled(Boolean(result.biometricEnabled));
      setSummary(result.summary ?? null);
      setStage(result.summary ? 'overview' : 'intro');
    }).catch(() => { if (active) { setError('신원인증 정보를 불러오지 못했어요.'); setStage('intro'); } });
    return () => { active = false; };
  }, [open, onRequest]);

  const run = async (action: DigitalIdentityHostAction, next: Stage, targetWalletId?: string) => {
    setBusy(true); setError(null);
    try {
      if (action === 'verify') {
        setStage('proof-verifying');
        const authorization = await onRequest('authorize-proof');
        if (!authorization.ok) throw new Error(authorization.error || 'authorization_cancelled');
        setAuthorizationMethod(authorization.authorizationMethod ?? null);
        setBiometricEnabled(Boolean(authorization.biometricEnabled));
      }
      const result = await onRequest(action, targetWalletId);
      if (!result.ok) throw new Error(result.error || 'identity_unavailable');
      if (result.summary) setSummary(result.summary);
      if (action === 'verify' && !result.verified) throw new Error('credential_invalid');
      if (action === 'verify') await new Promise((resolve) => window.setTimeout(resolve, 850));
      setStage(next);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      if (action === 'verify') setStage('proof-consent');
      if (code === 'authorization_cancelled') return;
      setError(code === 'identity_session_unavailable' || code === 'request_rejected'
        ? '연결 시간이 지나 신원인증을 확인하지 못했어요. 다시 시도해 주세요.'
        : action === 'bind-wallet' ? '지갑 연결을 확인하지 못했어요. 다시 시도해 주세요.'
        : action === 'issue' ? '디지털 ID를 발급하지 못했어요. 다시 시도해 주세요.'
          : '증명서를 확인하지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  const verifyWithHost = async () => {
    setStage('checking'); setBusy(true); setError(null);
    try {
      const result = await onRequest('verify-person');
      if (!result.ok) throw new Error(result.error);
      setStage('secure-choice');
    } catch { setStage('host-request'); setError('슈퍼쏠 확인 요청을 마치지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  const authorizeAndIssue = async () => {
    setStage('issuing'); setBusy(true); setError(null);
    try {
      const authorization = await onRequest('authorize');
      if (!authorization.ok) throw new Error(authorization.error);
      setAuthorizationMethod(authorization.authorizationMethod ?? null);
      const issued = await onRequest('issue');
      if (!issued.ok || !issued.summary) throw new Error(issued.error);
      setSummary(issued.summary); setStage('issued');
    } catch { setStage('secure-choice'); setError('신원인증을 발급하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };

  const close = () => { if (busy) return; setOpen(false); setError(null); setConsent(false); };
  const showAuxiliary = (title: string) => { auxiliaryTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAuxiliarySheet(title); };
  const closeAuxiliary = () => setAuxiliarySheet(null);
  const onAuxiliaryKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeAuxiliary(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...(auxiliaryRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  };
  const openWalletPayment = (screen: 'card' | 'pos') => {
    setTab('assets');
    onOpenPayment(screen);
  };
  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? [])];
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  };
  const back = () => {
    if (busy) return;
    if (stage === 'wallet-confirm') setStage('wallet-select');
    else if (stage === 'proof-consent') setStage('proof-request');
    else if (stage === 'host-request') setStage('intro');
    else if (stage === 'secure-choice') setStage('host-request');
    else if (stage === 'wallet-select' || stage === 'proof-request' || stage === 'proof-result') setStage('overview');
    else close();
  };
  const linked = new Set(summary?.connectedWallets.map((wallet) => wallet.walletId) ?? []);
  const availableWallets = wallets.filter((wallet) => !linked.has(wallet.walletId));
  const selectedWallet = wallets.find((wallet) => wallet.walletId === selectedWalletId);
  const auxiliaryIcon = auxiliarySheet ? shinhanIdentityServiceIcon(auxiliarySheet) : undefined;
  const refreshHome = () => {
    void onRequest('status').then((result) => {
      if (result.ok) { setSummary(result.summary ?? null); setBiometricEnabled(Boolean(result.biometricEnabled)); }
    }).catch(() => undefined);
  };

  return <>
    <ShinhanIdentityHome connectedWalletCount={summary ? linked.size : null} identityButtonRef={entryRef} onIdentity={() => setOpen(true)} onRefresh={refreshHome} onAuxiliary={showAuxiliary} onWalletCard={() => openWalletPayment('card')} onWalletPos={() => openWalletPayment('pos')} />
    {auxiliarySheet ? <section ref={auxiliaryRef} className="shinhan-identity-home__sheet" role="dialog" aria-modal="true" aria-label={auxiliarySheet} onKeyDown={onAuxiliaryKeyDown}><header><button type="button" aria-label="뒤로" onClick={closeAuxiliary}><CaretLeft size={23} aria-hidden="true" /></button><strong>{auxiliarySheet}</strong><button type="button" aria-label="닫기" onClick={closeAuxiliary}><X size={21} aria-hidden="true" /></button></header><div><span className="shinhan-identity-home__icon">{auxiliaryIcon ? <img src={auxiliaryIcon} alt="" /> : auxiliarySheet.includes('결제') ? <CreditCard size={27} aria-hidden="true" /> : <FileText size={27} aria-hidden="true" />}</span><h2>{auxiliarySheet}</h2><p>{auxiliarySheet === '모바일 신분증' ? '모바일 신분증은 슈퍼쏠에서 별도로 관리해요. 신한 DID의 연결된 지갑과 증명 정보는 위에서 확인할 수 있어요.' : auxiliarySheet.includes('결제') ? '이 결제 서비스는 슈퍼쏠에서 이용할 수 있어요.' : '이 서비스는 슈퍼쏠에서 이용할 수 있어요.'}</p></div><footer><button type="button" onClick={closeAuxiliary}>확인</button></footer></section> : null}
    {open ? <section ref={dialogRef} className="shinhan-identity shinhan-identity--live" role="dialog" aria-modal="true" aria-label="내 디지털 신원인증" onKeyDown={onDialogKeyDown}>
      <header className="shinhan-identity__header"><button type="button" aria-label="뒤로" onClick={back}><CaretLeft size={24} aria-hidden="true" /></button><strong>내 신원인증</strong><button type="button" aria-label="닫기" onClick={close}><X size={21} aria-hidden="true" /></button></header>
      <div className="shinhan-identity__scroll" aria-live="polite"><div className="shinhan-identity__page" key={stage}>
        {stage === 'loading' || stage === 'checking' || stage === 'issuing' ? <div className="shinhan-live-identity-loading" role="status"><span className="shinhan-live-identity-spinner" aria-hidden="true" />{stage === 'checking' ? '슈퍼쏠에서 확인하고 있어요' : stage === 'issuing' ? '신한 DID를 안전하게 보관하고 있어요' : '신원인증을 확인하고 있어요'}</div> : null}
        {stage === 'intro' ? <><div className="shinhan-identity__symbol"><img src={superSolLogo} alt="" /></div><h2>신한 DID를 발급할게요</h2><p className="shinhan-identity__lead">내 정보로 디지털 신원인증을 만들고, 필요한 지갑에 연결할 수 있어요. 증명할 때마다 공유할 정보를 직접 확인해요.</p><div className="shinhan-identity__step-list"><div><span>1</span><strong>내 정보 확인</strong><small>이름 · 생년월일 · 휴대폰</small></div><div><span>2</span><strong>슈퍼쏠 확인</strong><small>신분증·계좌 확인 요청</small></div><div><span>3</span><strong>기기에 안전하게 보관</strong><small>간편비밀번호 또는 생체인증</small></div></div><p className="shinhan-identity__note">슈퍼쏠의 확인 결과를 받은 뒤 다음 단계로 이동해요. 이름과 생년월일은 입력한 정보로 표시돼요.</p></> : null}
        {stage === 'host-request' ? <><h2>슈퍼쏠에서 본인확인을 진행할게요</h2><p className="shinhan-identity__lead">신분증 촬영과 계좌 확인은 슈퍼쏠에서 진행해요. 확인 결과를 받은 뒤 신한 DID 발급을 이어갈게요.</p><div className="shinhan-identity__host-card"><IdentificationCard size={42} weight="duotone" aria-hidden="true" /><div><strong>슈퍼쏠 본인확인</strong><span>신분증 확인 · 계좌 확인</span></div><CheckCircle size={23} aria-hidden="true" /></div><p className="shinhan-identity__note">쏠지갑은 신분증 사진이나 계좌 인증번호를 받지 않아요.</p></> : null}
        {stage === 'secure-choice' ? <><h2>신한 DID를 안전하게 보관할게요</h2><p className="shinhan-identity__lead">이 기기에서만 사용할 수 있도록 보안 확인을 진행해요. 생체인증을 켜 둔 경우 기기의 생체인증 창이 열려요.</p><div className="shinhan-identity__security-row"><span><Fingerprint size={28} aria-hidden="true" /></span><div><strong>{biometricEnabled ? '생체인증으로 확인' : '간편비밀번호로 확인'}</strong><small>{biometricEnabled ? '기기에서 지문 또는 얼굴로 확인해요' : '슈퍼쏠의 보안 입력 화면에서 확인해요'}</small></div><CheckCircle size={19} aria-hidden="true" /></div><label className="shinhan-identity__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>디지털 신원인증 발급과 이 기기 보관에 동의해요.</span></label><p className="shinhan-identity__note">생체정보는 기기에서 확인하며 쏠지갑이나 DID 증명서에 저장되지 않아요.</p></> : null}
        {stage === 'issued' ? <><div className="shinhan-identity__complete-icon"><CheckCircle size={37} weight="bold" aria-hidden="true" /></div><h2>신한 DID를 발급했어요</h2><p className="shinhan-identity__lead">내 디지털 신원인증을 기기에 보관했어요. 원하는 지갑을 연결해 사용할 수 있어요.</p>{summary ? <CredentialCard summary={summary} /> : null}<div className="shinhan-identity__security-row shinhan-identity__security-row--issued"><span><Fingerprint size={25} aria-hidden="true" /></span><div><strong>{authorizationMethod === 'biometric' ? '생체인증 연결됨' : '생체인증으로 더 간편하게'}</strong><small>{authorizationMethod === 'biometric' ? '이 기기에서 신원인증을 확인했어요' : '기기 설정에서 생체인증을 연결할 수 있어요'}</small></div>{authorizationMethod === 'biometric' ? <CheckCircle size={18} aria-hidden="true" /> : <CaretRight size={18} aria-hidden="true" />}</div>{authorizationMethod !== 'biometric' ? <button className="shinhan-identity__text-action" type="button" onClick={() => void onRequest('open-biometric-settings').catch(() => setError('생체인증 설정을 열지 못했어요.'))}>생체인증 설정하기 <ArrowRight size={17} aria-hidden="true" /></button> : null}</> : null}
        {stage === 'overview' && summary ? <><h2>내 디지털 신원인증</h2><p className="shinhan-identity__lead">디지털 ID와 연결한 지갑, 확인할 수 있는 정보를 살펴보세요.</p><CredentialCard summary={summary} /><section className="shinhan-identity__overview-section"><h3>연결된 지갑 <span>{linked.size}</span></h3><div className="shinhan-identity__card">{summary.connectedWallets.length ? [...new Map(summary.connectedWallets.map((wallet) => [wallet.walletId, wallet])).values()].map((wallet) => <div className="shinhan-identity__row" key={wallet.walletId}><span className="shinhan-identity__row-icon"><Wallet size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>{wallet.label}</strong><small>이 지갑의 소유를 확인했어요</small></span><CheckCircle size={18} aria-hidden="true" /></div>) : <p className="shinhan-identity__empty">아직 연결된 지갑이 없어요.</p>}</div>{availableWallets.length ? <button className="shinhan-identity__text-action" type="button" onClick={() => { setSelectedWalletId(availableWallets[0]!.walletId); setStage('wallet-select'); }}>지갑 연결하기 <ArrowRight size={17} aria-hidden="true" /></button> : null}</section><section className="shinhan-identity__overview-section"><h3>확인 가능한 정보</h3><div className="shinhan-identity__card"><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><UserCircle size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>이름</strong><small>{summary.name} · 입력 정보</small></span></div><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><IdentificationCard size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>생년월일</strong><small>{summary.birthDate.replace(/-/g, '.')} · 입력 정보</small></span></div><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><ShieldCheck size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>휴대폰 사용 확인</strong><small>{summary.phoneMasked}</small></span></div></div></section><section className="shinhan-identity__overview-section"><h3>기기 보안</h3><div className="shinhan-identity__card"><div className="shinhan-identity__row"><span className="shinhan-identity__row-icon"><Fingerprint size={21} aria-hidden="true" /></span><span className="shinhan-identity__row-copy"><strong>{biometricEnabled ? '생체인증 연결됨' : '간편비밀번호 확인'}</strong><small>증명할 때 기기에서 다시 확인해요</small></span></div></div></section></> : null}
        {stage === 'wallet-select' ? <><div className="shinhan-identity__hero-icon"><Wallet size={31} weight="duotone" aria-hidden="true" /></div><h2>어떤 지갑을 연결할까요?</h2><p className="shinhan-identity__lead">지갑마다 한 번씩 서명해 직접 통제하는지 확인해요.</p><div className="shinhan-identity__wallet-list" role="radiogroup" aria-label="연결할 지갑">{availableWallets.map((wallet) => <label className="shinhan-identity__wallet-option" data-selected={selectedWalletId === wallet.walletId} key={wallet.walletId}><input type="radio" name="identity-wallet" checked={selectedWalletId === wallet.walletId} onChange={() => setSelectedWalletId(wallet.walletId)} /><span className="shinhan-identity__wallet-avatar"><ShinhanWalletMark wallet={wallet} /></span><span><strong>{wallet.label}</strong><small>{wallet.origin === 'imported' ? '가져온 지갑' : '쏠지갑에서 만든 지갑'}</small></span></label>)}</div></> : null}
        {stage === 'wallet-confirm' ? <><div className="shinhan-identity__hero-icon"><LinkSimple size={31} weight="duotone" aria-hidden="true" /></div><h2>이 지갑을 연결할게요</h2><p className="shinhan-identity__lead">지갑에서 서명해 주소를 직접 통제하는지 확인해요. 자산 이동은 일어나지 않아요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>연결할 지갑</span><strong>{selectedWallet?.label ?? '선택한 지갑'}</strong></div><div><span>확인 방법</span><strong>일회성 서명</strong></div></div></> : null}
        {stage === 'proof-request' ? <><div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div><h2>신원인증을 확인할게요</h2><p className="shinhan-identity__lead">발급된 디지털 ID와 이름·생년월일이 일치하는지 확인해요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>확인할 정보</span><strong>이름 · 생년월일</strong></div><div><span>추가 확인</span><strong>이 기기의 증명서 소유</strong></div><div><span>연결된 지갑</span><strong>{linked.size}개</strong></div></div><p className="shinhan-identity__note">이 확인은 쏠지갑 안에서 진행돼요.</p></> : null}
        {stage === 'proof-consent' ? <><div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div><h2>증명서 확인을 허용할까요?</h2><p className="shinhan-identity__lead">발급 서명과 이 기기의 소유 서명을 확인해요.</p><div className="shinhan-identity__card shinhan-identity__detail-card"><div><span>확인할 정보</span><strong>이름 · 생년월일</strong></div><div><span>확인 방식</span><strong>발급 서명 · 기기 서명</strong></div></div><label className="shinhan-identity__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>이번 증명서 확인에 동의해요.</span></label></> : null}
        {stage === 'proof-verifying' ? <ProofVerification /> : null}
        {stage === 'proof-result' ? <><div className="shinhan-identity__hero-icon"><CheckCircle size={33} weight="duotone" aria-hidden="true" /></div><h2>신원인증을 확인했어요</h2><p className="shinhan-identity__lead">서명된 증명서와 이 기기의 소유 확인을 마쳤어요.</p><div className="shinhan-identity__result"><span className="shinhan-identity__pill">확인 완료</span><strong>디지털 ID 확인 완료</strong><p>이름·생년월일 일치와 발급 서명을 확인했어요.</p><div><span>발급 서명</span><b>유효</b></div><div><span>기기 소유</span><b>확인</b></div><div><span>이름 · 생년월일</span><b>일치</b></div></div></> : null}
        {error ? <p className="shinhan-live-identity-error" role="alert">{error}</p> : null}</div>
      </div>
      {!['loading', 'checking', 'issuing', 'proof-verifying'].includes(stage) ? <footer className="shinhan-identity__footer">
        {stage === 'intro' ? <button className="shinhan-identity__button" type="button" onClick={() => setStage('host-request')}>신한 DID 발급하기</button> : null}
        {stage === 'host-request' ? <button className="shinhan-identity__button" type="button" disabled={busy} onClick={() => void verifyWithHost()}>슈퍼쏠에서 확인하기</button> : null}
        {stage === 'secure-choice' ? <button className="shinhan-identity__button" type="button" disabled={!consent || busy} onClick={() => void authorizeAndIssue()}>동의하고 안전하게 발급하기</button> : null}
        {stage === 'issued' ? <button className="shinhan-identity__button" type="button" onClick={() => { if (availableWallets.length) { setSelectedWalletId(availableWallets[0]!.walletId); setStage('wallet-select'); } else setStage('overview'); }}>{availableWallets.length ? '지갑 연결하기' : '내 신원인증 보기'}</button> : null}
        {stage === 'overview' ? <button className="shinhan-identity__button" type="button" onClick={() => setStage('proof-request')}>증명서 확인하기</button> : null}
        {stage === 'wallet-select' ? <button className="shinhan-identity__button" type="button" disabled={!selectedWalletId} onClick={() => setStage('wallet-confirm')}>선택한 지갑 연결하기</button> : null}
        {stage === 'wallet-confirm' ? <button className="shinhan-identity__button" type="button" disabled={busy} onClick={() => void run('bind-wallet', 'overview', selectedWalletId)}>{busy ? '지갑을 확인하고 있어요' : '서명하고 연결하기'}</button> : null}
        {stage === 'proof-request' ? <button className="shinhan-identity__button" type="button" onClick={() => { setConsent(false); setStage('proof-consent'); }}>요청 내용 확인하기</button> : null}
        {stage === 'proof-consent' ? <><button className="shinhan-identity__button" type="button" disabled={!consent || busy} onClick={() => void run('verify', 'proof-result')}>동의하고 확인하기</button><button className="shinhan-identity__button shinhan-identity__button--secondary" type="button" onClick={() => setStage('overview')}>동의하지 않기</button></> : null}
        {stage === 'proof-result' ? <button className="shinhan-identity__button" type="button" onClick={() => setStage('overview')}>내 신원인증으로 돌아가기</button> : null}
      </footer> : null}
    </section> : null}
  </>;
}
