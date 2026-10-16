import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, Plus, ShieldCheck, Wallet } from '@phosphor-icons/react';
import type { PhoneClaimInfo, ReadyWalletHomePayload, WalletHomePayload, WalletPresentationProps } from '@took-wss/contracts';

const explorer: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx/', polygon: 'https://polygonscan.com/tx/',
  arbitrum: 'https://arbiscan.io/tx/', base: 'https://basescan.org/tx/',
};

const errorCopy: Record<string, string> = {
  claim_not_found: '수령 링크를 찾지 못했어요.',
  claim_not_ready: '아직 받을 수 없어요. 잠시 뒤 다시 확인해 주세요.',
  claim_phone_mismatch: '문자를 받은 휴대폰 번호를 확인해 주세요.',
  institution_phone_mismatch: '금융사 고객 정보에 등록된 휴대폰 번호와 일치하지 않아요.',
  institution_identity_required: '고객 정보 확인을 먼저 마쳐 주세요.',
  claim_otp_rate_limited: '인증 요청이 많아요. 잠시 뒤 다시 시도해 주세요.',
  verification_code_mismatch: '인증번호를 다시 확인해 주세요.',
  invalid_otp: '인증번호 6자리를 확인해 주세요.',
  claim_wallet_network_unavailable: '이 월렛은 수령 네트워크의 주소가 준비되지 않았어요. 다른 월렛을 선택해 주세요.',
  recipient_review_required: '받을 주소의 안전성을 확인하지 못해 수령할 수 없어요.',
  claim_service_unavailable: '지금은 수령 서비스를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
};

function messageFor(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return errorCopy[code] ?? '요청을 완료하지 못했어요. 다시 시도해 주세요.';
}

interface Props {
  code: string;
  identity: WalletPresentationProps['identity'];
  walletHome: WalletHomePayload;
  onGetInfo: WalletPresentationProps['onGetPhoneClaimInfo'];
  onRequestOtp: WalletPresentationProps['onRequestInstitutionPhoneClaimOtp'];
  onSubmit: WalletPresentationProps['onSubmitInstitutionPhoneClaim'];
  onSelectWallet: WalletPresentationProps['onSelectWallet'];
  onCreateWallet: () => void;
  onClose: () => void;
}

export function InstitutionPhoneClaimFlow({ code, identity, walletHome, onGetInfo, onRequestOtp, onSubmit, onSelectWallet, onCreateWallet, onClose }: Props) {
  const [info, setInfo] = useState<PhoneClaimInfo | null>(null);
  const [selected, setSelected] = useState<ReadyWalletHomePayload | null>(null);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await onGetInfo(code);
        if (!active) return;
        setInfo(next);
        setError('');
      } catch (cause) { if (active) setError(messageFor(cause)); }
    };
    void refresh();
    return () => { active = false; };
  }, [code, onGetInfo]);

  useEffect(() => {
    if (info?.status !== 'pending' && info?.status !== 'processing') return;
    const timer = window.setTimeout(() => { void onGetInfo(code).then(setInfo).catch((cause) => setError(messageFor(cause))); }, 8_000);
    return () => window.clearTimeout(timer);
  }, [code, info, onGetInfo]);

  const chooseWallet = async (walletId: string) => {
    setBusy(true); setError('');
    try { setSelected(await onSelectWallet(walletId)); setOtpSent(false); setOtp(''); }
    catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const requestOtp = async () => {
    const normalized = phone.replace(/\D/g, '');
    if (!/^010\d{8}$/.test(normalized)) { setError('휴대폰 번호를 확인해 주세요.'); return; }
    setBusy(true); setError('');
    try { await onRequestOtp(code, normalized); setPhone(normalized); setOtpSent(true); }
    catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!selected || !/^\d{6}$/.test(otp)) { setError('인증번호 6자리를 확인해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit(code, phone, otp, selected.wallet.walletId);
      setInfo((current) => current ? { ...current, status: 'processing' } : current);
      // A separate fetch picks up the durable on-chain result. The claim endpoint is idempotent only before claiming.
      const next = await onGetInfo(code);
      setInfo(next);
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const receiveNetwork = selected?.networks.find((network) => network.chainId === info?.network);
  const canReceive = receiveNetwork?.addressStatus === 'ready' && /^0x[0-9a-fA-F]{40}$/.test(receiveNetwork.address ?? '');
  const wallets = walletHome.status === 'ready' ? walletHome.wallets : [];
  const terminal = info?.status === 'claimed' || info?.status === 'expired' || info?.status === 'refunded';

  return <section className="kw-screen kw-claim" aria-labelledby="claim-title">
    <header className="kw-claim__header">
      <button type="button" className="kw-icon-button" onClick={onClose} aria-label="월렛으로 돌아가기"><ArrowLeft size={23} /></button>
      <strong>자산 받기</strong><span aria-hidden="true" />
    </header>
    <div className="kw-scroll kw-claim__content">
      <div className="kw-claim__mark"><ShieldCheck size={28} weight="duotone" /></div>
      <h1 id="claim-title" className="kw-flow-title">보내주신 자산을 받아볼까요?</h1>
      <p className="kw-body">금융사 고객 정보를 확인하고<br />받을 월렛을 선택해 주세요.</p>
      <div className="kw-claim__summary" aria-live="polite">
        <span>수령 예정 자산</span>
        <strong>{info ? `${info.payoutDisplay ?? info.amountDisplay} ${info.assetSymbol}` : '확인 중이에요'}</strong>
        {info ? <small>{info.network} 네트워크 · {new Date(info.expiresAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}까지</small> : null}
      </div>

      {info?.status === 'ready' && identity.status !== 'established' ? <div className="kw-claim__section">
        <h2>고객 정보 확인이 필요해요</h2>
        <p>고객 정보와 휴대폰 번호를 확인한 뒤 월렛을 만들거나 불러올 수 있어요.</p>
        <button type="button" className="kw-button" onClick={onCreateWallet}>고객 정보 확인하기 <ArrowRight size={18} /></button>
      </div> : null}

      {info?.status === 'ready' && identity.status === 'established' && !selected ? <div className="kw-claim__section">
        <h2>받을 월렛을 선택해 주세요</h2>
        <p>선택한 월렛의 {info.network} 주소로 자산이 들어와요.</p>
        <div className="kw-claim__wallets">
          {wallets.map((wallet) => <button key={wallet.walletId} type="button" className="kw-claim__wallet" disabled={busy} onClick={() => void chooseWallet(wallet.walletId)}>
            <Wallet size={22} weight="duotone" /><span>{wallet.label}</span><ArrowRight size={18} />
          </button>)}
          <button type="button" className="kw-claim__wallet" onClick={onCreateWallet}><Plus size={22} /><span>새 월렛 만들기</span><ArrowRight size={18} /></button>
        </div>
      </div> : null}

      {info?.status === 'ready' && selected && identity.status === 'established' ? <div className="kw-claim__section">
        <button type="button" className="kw-claim__change" onClick={() => { setSelected(null); setOtpSent(false); setOtp(''); }}>← 다른 월렛 선택</button>
        <h2>{selected.wallet.label}</h2>
        <p>{canReceive ? `${info.network} 주소로 받을 수 있어요.` : '이 월렛에는 해당 네트워크의 받을 주소가 없어요.'}</p>
        {canReceive ? <form className="kw-claim__form" onSubmit={(event) => { event.preventDefault(); if (otpSent) void submit(); else void requestOtp(); }}>
          <label htmlFor="claim-phone">문자를 받은 휴대폰 번호</label>
          <input id="claim-phone" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(event) => { setPhone(event.target.value); setOtpSent(false); setOtp(''); }} readOnly={otpSent} placeholder="01012345678" maxLength={16} />
          {otpSent ? <>
            <p className="kw-claim__sent">인증번호를 문자로 보냈어요.</p>
            <label htmlFor="claim-otp">인증번호 6자리</label>
            <input id="claim-otp" type="text" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} placeholder="6자리 숫자" />
            <button type="button" className="kw-claim__change" onClick={() => { setOtpSent(false); setOtp(''); }}>휴대폰 번호 다시 입력</button>
          </> : null}
          <button type="submit" className="kw-button" disabled={busy}>{busy ? '확인하고 있어요' : otpSent ? '인증하고 자산 받기' : '인증번호 받기'}</button>
        </form> : <button type="button" className="kw-button kw-button--secondary" onClick={() => { setSelected(null); onCreateWallet(); }}>새 월렛 만들기</button>}
      </div> : null}

      {info?.status === 'pending' ? <p className="kw-claim__state">보낸 분의 입금이 확인되면 받을 수 있어요.</p> : null}
      {info?.status === 'processing' ? <p className="kw-claim__state" role="status">네트워크에서 수령 거래를 확인하고 있어요.</p> : null}
      {terminal ? <div className="kw-claim__result"><CheckCircle size={38} weight="duotone" />
        <strong>{info.status === 'claimed' ? '자산 수령이 완료됐어요' : info.status === 'expired' ? '수령 기한이 지났어요' : '보낸 분에게 환불된 자산이에요'}</strong>
        {info.status === 'claimed' && info.payoutBelowExpected ? <p>예정 금액보다 적게 도착했어요. 고객센터에 문의해 주세요.</p> : null}
        {info.status === 'claimed' && info.transactionHash && explorer[info.network] ? <a href={`${explorer[info.network]}${info.transactionHash}`} target="_blank" rel="noopener noreferrer">수령 거래 확인</a> : null}
        <button type="button" className="kw-button" onClick={onClose}>월렛으로 돌아가기</button>
      </div> : null}
      {error ? <p className="kw-claim__error" role="alert">{error}</p> : null}
      <p className="kw-claim__note">수령 기한이 지나면 보낸 분이 환불할 수 있어요.</p>
    </div>
  </section>;
}
