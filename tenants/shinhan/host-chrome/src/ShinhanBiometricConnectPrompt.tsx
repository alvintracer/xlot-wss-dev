import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Fingerprint, ShieldCheck, X } from '@phosphor-icons/react';
import './biometric-connect.css';

export function ShinhanBiometricConnectPrompt({ onConnect, onLater }: { onConnect: () => void; onLater: () => void }) {
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => { rootRef.current?.querySelector<HTMLButtonElement>('.shinhan-biometric-connect__primary')?.focus(); }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onLater(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  };
  return <section ref={rootRef} className="shinhan-biometric-connect" role="dialog" aria-modal="true" aria-labelledby="shinhan-biometric-connect-title" onKeyDown={onKeyDown}>
    <header><span /><strong>생체인증 연결</strong><button type="button" aria-label="나중에 연결하기" onClick={onLater}><X size={21} aria-hidden="true" /></button></header>
    <div className="shinhan-biometric-connect__content">
      <div className="shinhan-biometric-connect__symbol" aria-hidden="true"><span><Fingerprint size={58} weight="thin" /></span><i><ShieldCheck size={21} weight="fill" /></i></div>
      <h2 id="shinhan-biometric-connect-title">다음부터 생체인증으로<br />확인할까요?</h2>
      <p>이 기기의 지문이나 얼굴로 신한 DID 증명서를 더 간편하게 확인할 수 있어요.</p>
      <div className="shinhan-biometric-connect__note"><ShieldCheck size={19} aria-hidden="true" /><span>생체정보는 기기에서만 확인하며 증명서에 저장되지 않아요.</span></div>
    </div>
    <footer><button className="shinhan-biometric-connect__primary" type="button" onClick={onConnect}>생체인증 연결하기</button><button className="shinhan-biometric-connect__later" type="button" onClick={onLater}>다음에 할게요</button></footer>
  </section>;
}
