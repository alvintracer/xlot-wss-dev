import { Fingerprint, LockKey, ShieldCheck, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { SecurePinKeypad } from './SecurePinKeypad';
import './ExchangeSignPanel.css';

interface Props {
  exchangeName: string;
  identityBinding?: boolean;
  walletLabel: string;
  message: string;
  initialError?: string;
  requiresPin: boolean;
  color: string;
  keypadLayout: 'four-column' | 'three-column';
  onApprove: (pin: string, legacy?: boolean) => Promise<void>;
  onBiometricApprove?: () => Promise<void>;
  onCancel: () => void;
}

function readableChallenge(value: string): string {
  if (/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value.slice(2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))); }
    catch { return `16진수 메시지 · ${(value.length - 2) / 2}바이트`; }
  }
  return value;
}

export function ExchangeSignLoading({ color }: { color: string }) {
  return <div className="host-exchange-sign-backdrop">
    <section className="host-exchange-sign host-exchange-sign--loading" role="status" aria-live="polite" aria-busy="true" style={{ '--exchange-sign-color': color } as CSSProperties}>
      <div className="host-exchange-sign-icon"><LockKey size={27} weight="duotone" /></div>
      <h2>서명 요청을 확인하고 있어요</h2>
      <p className="host-exchange-sign-intro">선택한 월렛과 요청 주소를 확인하고 있어요.</p>
      <span className="host-exchange-sign-spinner" aria-hidden="true" />
    </section>
  </div>;
}

export function ExchangeSignPanel({ exchangeName, identityBinding = false, walletLabel, message, initialError, requiresPin, color, keypadLayout, onApprove, onBiometricApprove, onCancel }: Props) {
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<'review' | 'pin' | 'legacy'>('review');
  const [pinAttempt, setPinAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const challenge = readableChallenge(message);
  const challengeSections = challenge.slice(0, 800).split(/\r?\n\s*\r?\n/);
  const challengeHeading = challengeSections.length > 1 ? (challengeSections[0]?.trim() ?? '') : '';
  const challengeBody = challengeHeading ? challengeSections.slice(1).join(' ').trim() : (challengeSections[0] ?? '');
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const approve = async (enteredPin: string) => {
    setBusy(true);
    setError('');
    try { await onApprove(enteredPin, step === 'legacy'); }
    catch (caught) {
      const code = caught instanceof Error ? caught.message : '';
      if (code === 'app_pin_migration_needed') {
        setStep('legacy'); setPin(''); setPinAttempt((attempt) => attempt + 1);
        return;
      }
      setError(code === 'local_vault_unlock_failed' && step === 'legacy' ? '이 월렛의 이전 비밀번호가 일치하지 않아요.'
        : code === 'local_vault_unlock_failed' || code === 'app_pin_invalid' ? '앱 비밀번호가 일치하지 않아요.'
        : code === 'app_pin_migration_expired' ? '다시 앱 비밀번호부터 확인해 주세요.'
        : code === 'thirdweb_auth_failed' ? '이 월렛에 연결된 계정으로 다시 로그인해 주세요.'
          : '서명을 완료하지 못했어요. 다시 시도해 주세요.');
      setPin('');
      if (requiresPin) setPinAttempt((attempt) => attempt + 1);
    } finally { setBusy(false); }
  };
  const onPinChange = (value: string) => {
    setPin(value);
    if (value.length === 6 && !busy) void approve(value);
  };
  const onReviewApprove = () => {
    setError('');
    if (requiresPin) { setStep('pin'); return; }
    void approve('');
  };
  return <div className="host-exchange-sign-backdrop">
    <section className="host-exchange-sign" role="dialog" aria-modal="true" aria-labelledby="host-exchange-sign-title" onKeyDown={onKeyDown} style={{ '--exchange-sign-color': color } as CSSProperties}>
      <button ref={closeRef} className="host-exchange-sign-close" type="button" aria-label="취소" disabled={busy} onClick={onCancel}><X size={21} /></button>
      <div className="host-exchange-sign-icon"><LockKey size={27} weight="duotone" /></div>
      <p className="host-exchange-sign-kicker">{identityBinding ? '디지털 신원인증 · 지갑 연결' : `${exchangeName} 개인지갑 등록`}</p>
      {step === 'review' ? <>
        <h2 id="host-exchange-sign-title">월렛 연결을 승인할까요?</h2>
        <p className="host-exchange-sign-intro">{walletLabel}의 소유 확인 메시지에 서명해요.</p>
        <div className="host-exchange-sign-message"><span>서명할 내용</span>{challengeHeading ? <strong>{challengeHeading}</strong> : null}<p>{challengeBody}</p></div>
        <p className="host-exchange-sign-safe"><ShieldCheck size={17} />서명은 이 기기에서 처리해요.</p>
        {error ? <p className="host-exchange-sign-error" role="alert">{error}</p> : null}
        <div className="host-exchange-sign-actions"><button type="button" disabled={busy} onClick={onCancel}>취소</button><button type="button" disabled={busy} onClick={onReviewApprove}>{busy ? '확인하고 있어요' : '서명 승인'}</button></div>
      </> : <div className="host-exchange-sign-pin-step">
        <h2 id="host-exchange-sign-title">{step === 'legacy' ? '이 월렛의 이전 비밀번호' : '앱 비밀번호를 입력해 주세요'}</h2>
        <p className="host-exchange-sign-intro">{step === 'legacy' ? '이 월렛을 앱 비밀번호에 연결해요. 이번 한 번만 입력해 주세요.' : `${walletLabel}의 서명을 완료해요.`}</p>
        <SecurePinKeypad key={pinAttempt} value={pin} onChange={onPinChange} disabled={busy} layout={keypadLayout} inline autoOpen />
        {onBiometricApprove && step !== 'legacy' ? <button className="host-vault-biometric" type="button" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void onBiometricApprove().catch((caught: unknown) => {
            if (caught instanceof Error && caught.message === 'app_pin_migration_needed') {
              setStep('legacy'); setPin(''); setPinAttempt((attempt) => attempt + 1);
              setError('이 월렛의 이전 비밀번호를 한 번 입력해 앱 비밀번호에 연결해 주세요.');
            } else setError('생체 인증으로 서명하지 못했어요. 앱 비밀번호를 사용해 주세요.');
          }).finally(() => setBusy(false));
        }}><Fingerprint size={20} aria-hidden="true" /> 생체 인증으로 서명</button> : null}
        {error ? <p className="host-exchange-sign-error" role="alert">{error}</p> : null}
        <p className="host-exchange-sign-pin-hint" role="status">{busy ? '서명을 확인하고 있어요.' : '숫자 6자리를 입력하면 서명이 진행돼요.'}</p>
        <div className="host-exchange-sign-actions"><button type="button" disabled={busy} onClick={() => { setStep(step === 'legacy' ? 'pin' : 'review'); setPin(''); setError(''); }}>이전</button><button type="button" disabled={busy} onClick={onCancel}>취소</button></div>
      </div>}
    </section>
  </div>;
}
