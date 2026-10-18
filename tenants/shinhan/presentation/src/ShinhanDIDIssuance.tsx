import { useState } from 'react';
import { CaretLeft, Check, CheckCircle, Fingerprint, IdentificationCard, ShieldCheck, X } from '@phosphor-icons/react';
import type { DigitalIdentityFlowProps } from '@took-wss/tenant-kiwoom-presentation';
import './issuance.css';

const superSolLogo = new URL('../assets/preview/super-sol-app-mark.png', import.meta.url).href;

type Phase = 'intro' | 'host' | 'checking' | 'secure' | 'issuing' | 'issued';

export function ShinhanDIDIssuance({ name, onClose, onContinue, onRequest }: DigitalIdentityFlowProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [consent, setConsent] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = phase === 'checking' || phase === 'issuing';
  const back = () => setPhase(phase === 'secure' ? 'host' : 'intro');
  const advance = async () => {
    setError(null);
    if (phase === 'intro') { setPhase('host'); return; }
    if (phase === 'issued') { onContinue(); return; }
    if (phase === 'host') {
      setPhase('checking');
      try {
        const response = await onRequest('verify-person');
        if (!response.ok) throw new Error(response.error);
        const status = await onRequest('status');
        if (!status.ok) throw new Error(status.error);
        setBiometric(Boolean(status.biometricEnabled));
        setPhase('secure');
      } catch { setPhase('host'); setError('슈퍼쏠 확인 요청을 마치지 못했어요. 다시 시도해 주세요.'); }
      return;
    }
    if (phase === 'secure') {
      setPhase('issuing');
      try {
        const status = await onRequest('status');
        if (!status.ok) throw new Error(status.error);
        if (!status.summary) {
          const authorization = await onRequest('authorize');
          if (!authorization.ok) throw new Error(authorization.error);
          setBiometric(authorization.authorizationMethod === 'biometric');
          const issued = await onRequest('issue');
          if (!issued.ok || !issued.summary) throw new Error(issued.error);
        }
        setPhase('issued');
      } catch { setPhase('secure'); setError('신한 DID를 발급하지 못했어요. 다시 시도해 주세요.'); }
    }
  };
  return <section className="shinhan-did-issuance" aria-label="신한 DID 발급">
    <header className="shinhan-did-issuance__header">
      {phase === 'host' || phase === 'secure' ? <button type="button" aria-label="이전" onClick={back}><CaretLeft size={24} aria-hidden="true" /></button> : <span />}
      <button type="button" aria-label="닫기" disabled={busy} onClick={onClose}><X size={23} aria-hidden="true" /></button>
    </header>
    <div className="shinhan-did-issuance__scroll"><div className="shinhan-did-issuance__page" key={phase}>
      {phase === 'intro' ? <><div className="shinhan-did-issuance__mark" aria-hidden="true"><img src={superSolLogo} alt="" /></div><h1>신한 DID를 발급할게요</h1><p>확인한 휴대폰과 입력한 이름·생년월일로 디지털 신원인증을 만들어요. 원하는 지갑에 연결해서 필요한 정보만 증명할 수 있어요.</p><ol className="shinhan-did-issuance__steps"><li><span>1</span><strong>내 정보 확인</strong><small>이름 · 생년월일 · 휴대폰</small></li><li><span>2</span><strong>슈퍼쏠 확인</strong><small>신분증·계좌 확인 요청</small></li><li><span>3</span><strong>기기에 안전하게 보관</strong><small>간편비밀번호 또는 생체인증</small></li></ol><p className="shinhan-did-issuance__fine">이름과 생년월일은 입력한 정보로 표시돼요. 휴대폰 사용 여부와 구분해서 확인할 수 있어요.</p></> : null}
      {phase === 'host' ? <><h1>슈퍼쏠에서 본인확인을 진행할게요</h1><p>신분증 촬영과 계좌 확인은 슈퍼쏠에서 진행해요. 확인 결과를 받은 뒤 DID 발급을 이어갈게요.</p><div className="shinhan-did-issuance__host-card"><IdentificationCard size={35} weight="duotone" aria-hidden="true" /><span><strong>슈퍼쏠 본인확인</strong><small>신분증 확인 · 계좌 확인</small></span><CheckCircle size={22} aria-hidden="true" /></div><p className="shinhan-did-issuance__fine">쏠지갑은 신분증 사진이나 계좌 인증번호를 받지 않아요.</p></> : null}
      {phase === 'checking' || phase === 'issuing' ? <div className="shinhan-did-issuance__busy" role="status"><span className="shinhan-did-issuance__spinner" aria-hidden="true" /><strong>{phase === 'checking' ? '슈퍼쏠에서 확인하고 있어요' : '신한 DID를 안전하게 보관하고 있어요'}</strong><p>잠시만 기다려 주세요</p></div> : null}
      {phase === 'secure' ? <><h1>신한 DID를 안전하게 보관할게요</h1><p>이 기기의 보안 확인을 마치면 디지털 신원인증을 발급해요.</p><div className="shinhan-did-issuance__host-card"><Fingerprint size={31} aria-hidden="true" /><span><strong>{biometric ? '생체인증으로 확인' : '간편비밀번호로 확인'}</strong><small>{biometric ? '기기의 지문 또는 얼굴 인식이 열려요' : '슈퍼쏠 보안 입력 화면이 열려요'}</small></span><CheckCircle size={20} aria-hidden="true" /></div><label className="shinhan-did-issuance__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>디지털 신원인증 발급과 이 기기 보관에 동의해요.</span></label><p className="shinhan-did-issuance__fine">생체정보는 기기에서 확인하며 DID 증명서에 저장되지 않아요.</p></> : null}
      {phase === 'issued' ? <><div className="shinhan-did-issuance__complete" aria-hidden="true"><Check size={34} weight="bold" /></div><h1>신한 DID를 발급했어요</h1><p>디지털 신원인증을 기기에 보관했어요. 이제 지갑을 만들고 연결할 수 있어요.</p><div className="shinhan-did-issuance__certificate"><span><b><img src={superSolLogo} alt="" /></b> 신한 DID</span><strong>{name}</strong><small>내 디지털 신원인증 · 입력 정보 기반</small></div><div className="shinhan-did-issuance__host-card"><ShieldCheck size={25} aria-hidden="true" /><span><strong>{biometric ? '생체인증 연결됨' : '기기 보안 확인 완료'}</strong><small>신원인증 사용 시 기기에서 다시 확인해요</small></span></div></> : null}
      {error ? <p className="shinhan-did-issuance__error" role="alert">{error}</p> : null}
    </div></div>
    {!busy ? <footer className="shinhan-did-issuance__footer"><button type="button" disabled={phase === 'secure' && !consent} onClick={() => void advance()}>{phase === 'intro' ? '신한 DID 발급하기' : phase === 'host' ? '슈퍼쏠에서 확인하기' : phase === 'secure' ? '동의하고 안전하게 발급하기' : '지갑 만들기 계속하기'}</button></footer> : null}
  </section>;
}
