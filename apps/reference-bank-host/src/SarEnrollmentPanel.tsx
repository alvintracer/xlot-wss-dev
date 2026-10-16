import { LockKey, ShieldCheck } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { SecurePinKeypad } from './SecurePinKeypad';
import { sarMasterPasswordError, sarMasterPasswordStrength } from './sarMasterPasswordPolicy';

interface Challenge {
  challengeId: string;
  phoneMasked: string;
  emailMasked: string;
  expiresAt: string;
}

interface Props {
  customerName?: string | null;
  hasAppPin?: boolean;
  keypadLayout: 'four-column' | 'three-column';
  resumeLocal: boolean;
  onCancel: () => void;
  onUnlockExisting: (input: { pin: string } | { masterPassword: string }) => Promise<void>;
  onSaveLocal: (masterPassword: string, pin: string) => Promise<void>;
  onStart: (phone: string, email: string) => Promise<Challenge>;
  onVerify: (factor: 'phone' | 'email', code: string) => Promise<{
    phoneVerified: boolean; emailVerified: boolean;
  }>;
  onComplete: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'registered_phone_mismatch') return '지갑 등록 때 인증한 휴대폰 번호를 입력해 주세요.';
  if (code === 'invalid_vault_phone') return '휴대폰 번호 11자리를 확인해 주세요.';
  if (code === 'invalid_vault_email') return '이메일 주소를 확인해 주세요.';
  if (code === 'challenge_rate_limited') return '인증 요청이 많아요. 잠시 후 다시 시도해 주세요.';
  if (code === 'verification_code_mismatch' || code === 'invalid_code') return '인증번호를 다시 확인해 주세요.';
  if (code === 'email_delivery_unavailable' || code === 'phone_delivery_unavailable') return '인증번호를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (code === 'local_vault_unavailable') return '이 기기에 지갑을 보관하지 못했어요. 브라우저 저장소 설정을 확인해 주세요.';
  if (code === 'local_vault_unlock_failed') return '기존 비밀번호가 맞지 않아요. 다시 확인해 주세요.';
  if (code === 'app_pin_invalid') return '앱 비밀번호가 일치하지 않아요.';
  if (code === 'vault_password_policy_invalid') return '마스터 비밀번호 설정 조건을 확인해 주세요.';
  if (code === 'recovery_address_mismatch') return '기기 보관 정보가 이 지갑 주소와 일치하지 않아요.';
  return '지갑 보관을 완료하지 못했어요. 다시 시도해 주세요.';
}

export function SarEnrollmentPanel({ customerName, hasAppPin, keypadLayout, resumeLocal, onCancel, onUnlockExisting, onSaveLocal, onStart, onVerify, onComplete }: Props) {
  const [step, setStep] = useState<'existing' | 'master' | 'pin' | 'contacts' | 'codes'>(resumeLocal ? 'existing' : 'master');
  const [existingMethod, setExistingMethod] = useState<'pin' | 'master'>('pin');
  const [existingPin, setExistingPin] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const masterRef = useRef<HTMLInputElement>(null);
  const existingRef = useRef<HTMLInputElement>(null);
  const masterConfirmRef = useRef<HTMLInputElement>(null);
  const masterValueRef = useRef('');
  const [masterStrength, setMasterStrength] = useState(() => sarMasterPasswordStrength(''));
  const [pinPhase, setPinPhase] = useState<'first' | 'confirm'>('first');
  const [pin, setPin] = useState('');
  const pinFirstRef = useRef('');
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneCodeRef = useRef<HTMLInputElement>(null);
  const emailCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { masterValueRef.current = ''; }, []);

  const unlockExisting = async () => {
    const value = existingMethod === 'pin' ? existingPin : existingRef.current?.value ?? '';
    if (existingMethod === 'pin' && !/^\d{6}$/.test(value)) {
      setError('기존 간편 비밀번호 숫자 6자리를 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onUnlockExisting(existingMethod === 'pin' ? { pin: value } : { masterPassword: value });
      setExistingPin('');
      if (existingRef.current) existingRef.current.value = '';
      setStep('master');
    } catch (caught) { setExistingPin(''); setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  const continueToPin = () => {
    const master = masterRef.current?.value ?? '';
    const policyError = sarMasterPasswordError(master);
    if (policyError) { setError(policyError); return; }
    if (master !== masterConfirmRef.current?.value) { setError('마스터 비밀번호가 서로 달라요.'); return; }
    masterValueRef.current = master;
    if (masterRef.current) masterRef.current.value = '';
    if (masterConfirmRef.current) masterConfirmRef.current.value = '';
    setError(null);
    setStep('pin');
  };

  const saveLocal = async () => {
    if (!/^\d{6}$/.test(pin)) { setError('간편 비밀번호는 숫자 6자리로 입력해 주세요.'); return; }
    if (!hasAppPin && pinPhase === 'first') {
      pinFirstRef.current = pin;
      setPin('');
      setPinPhase('confirm');
      setError(null);
      return;
    }
    if (!hasAppPin && pin !== pinFirstRef.current) {
      pinFirstRef.current = '';
      setPin('');
      setPinPhase('first');
      setError('간편 비밀번호가 서로 달라요. 처음부터 다시 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSaveLocal(masterValueRef.current, pin);
      masterValueRef.current = '';
      pinFirstRef.current = '';
      setPin('');
      setStep('contacts');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await onStart(phoneRef.current?.value ?? '', emailRef.current?.value ?? '');
      if (phoneRef.current) phoneRef.current.value = '';
      if (emailRef.current) emailRef.current.value = '';
      setChallenge(started);
      setStep('codes');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      let phoneDone = phoneVerified;
      let emailDone = emailVerified;
      if (!phoneDone) {
        const result = await onVerify('phone', phoneCodeRef.current?.value.trim() ?? '');
        phoneDone = result.phoneVerified;
        setPhoneVerified(phoneDone);
        if (phoneCodeRef.current) phoneCodeRef.current.value = '';
      }
      if (!emailDone) {
        const result = await onVerify('email', emailCodeRef.current?.value.trim() ?? '');
        emailDone = result.emailVerified;
        setEmailVerified(emailDone);
        if (emailCodeRef.current) emailCodeRef.current.value = '';
      }
      if (!phoneDone || !emailDone) throw new Error('vault_authorization_required');
      await onComplete();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  return <>
    <div className={`host-security-content host-vault-panel${step === 'pin' ? ' host-vault-panel--pin-setup' : ''}`}>
      <p className="host-security-kicker">자가복구 지갑 설정</p>
      <div className="host-security-symbol" aria-hidden="true"><LockKey size={32} /></div>
      {step === 'existing' ? <>
        <h2 id="host-security-title">기존 지갑을 다시 열어 주세요</h2>
        <p>중단된 자가복구 설정을 이어가려면 이 기기의 보관함을 먼저 확인해요.</p>
        {existingMethod === 'pin'
          ? <SecurePinKeypad value={existingPin} onChange={setExistingPin} disabled={busy} layout={keypadLayout} />
          : <label className="host-secure-import-field"><span>기존 마스터 비밀번호</span>
              <input key={existingMethod} ref={existingRef} type="password" autoComplete="current-password" autoFocus /></label>}
        <div className="host-vault-recovery-options"><button type="button" onClick={() => { setExistingMethod(existingMethod === 'pin' ? 'master' : 'pin'); setExistingPin(''); setError(null); }}>
          {existingMethod === 'pin' ? '마스터 비밀번호로 열기' : '간편 비밀번호로 열기'}</button></div>
      </> : step === 'master' ? <>
        <h2 id="host-security-title">마스터 비밀번호를 정해 주세요</h2>
        <p>지갑을 열고 복구할 때도 사용해요.</p>
        <label className="host-secure-import-field"><span>마스터 비밀번호</span><input ref={masterRef} type="password" autoComplete="new-password" aria-describedby="host-master-password-requirements" onChange={(event) => { setMasterStrength(sarMasterPasswordStrength(event.currentTarget.value)); setError(null); }} autoFocus /></label>
        <div className="host-password-strength" data-level={masterStrength.level}>
          <div className="host-password-strength__labels"><span>위험</span><span>안전</span></div>
          <div className="host-password-strength__track" role="meter" aria-label="비밀번호 설정 조건 충족 정도" aria-valuemin={0} aria-valuemax={4} aria-valuenow={masterStrength.score} aria-valuetext={`4개 조건 중 ${masterStrength.score}개 충족`}>
            <span style={{ width: `${masterStrength.score * 25}%` }} />
          </div>
          <ul id="host-master-password-requirements" className="host-password-strength__rules">
            {([
              ['length', '8자 이상'], ['uppercase', '영문 대문자'],
              ['lowercase', '영문 소문자'], ['special', '특수문자'],
            ] as const).map(([key, label]) => <li key={key} className={masterStrength[key] ? 'is-met' : ''} aria-label={`${label} ${masterStrength[key] ? '충족' : '미충족'}`}>{label}</li>)}
          </ul>
        </div>
        <label className="host-secure-import-field"><span>마스터 비밀번호 확인</span><input ref={masterConfirmRef} type="password" autoComplete="new-password" onChange={() => setError(null)} /></label>
      </> : step === 'pin' ? <>
        <h2 id="host-security-title">{hasAppPin ? '앱 비밀번호를 입력해 주세요' : `간편 비밀번호를 ${pinPhase === 'first' ? '정해 주세요' : '다시 입력해 주세요'}`}</h2>
        <p>{hasAppPin ? '이 금융사 앱에서 사용 중인 숫자 6자리를 입력해 주세요.' : '이 기기에서 지갑을 열 때 사용할 숫자 6자리를 입력해 주세요.'}</p>
        <SecurePinKeypad value={pin} onChange={setPin} disabled={busy} layout={keypadLayout} />
      </> : step === 'contacts' ? <>
        <h2 id="host-security-title">기기를 바꿔도 지갑을 복구할 수 있어요</h2>
        <p>휴대폰과 이메일을 확인하면 이 기기의 저장 정보가 지워져도 지갑을 다시 열 수 있어요.</p>
        <label className="host-secure-import-field"><span>등록 때 인증한 휴대폰 번호</span><input ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel" placeholder="01012345678" autoFocus /></label>
        <label className="host-secure-import-field"><span>이메일 주소</span><input ref={emailRef} type="email" autoComplete="email" placeholder="name@example.com" /></label>
      </> : <>
        <h2 id="host-security-title">인증번호를 입력해 주세요</h2>
        <p>휴대폰 {challenge?.phoneMasked}<br />이메일 {challenge?.emailMasked}</p>
        <label className="host-secure-import-field"><span>휴대폰 인증번호 {phoneVerified ? '· 확인됨' : ''}</span><input ref={phoneCodeRef} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={phoneVerified} autoFocus /></label>
        <label className="host-secure-import-field"><span>이메일 인증번호 {emailVerified ? '· 확인됨' : ''}</span><input ref={emailCodeRef} type="text" inputMode="numeric" maxLength={6} disabled={emailVerified} /></label>
      </>}
      {step !== 'master' && step !== 'pin' ? <div className="host-security-notice"><ShieldCheck size={19} aria-hidden="true" /><span>복구 구문과 비밀번호는 {customerName && /^[가-힣]{2,5}$/.test(customerName.trim()) ? customerName.trim().slice(1) : customerName?.trim() || '고객'}님만 복구할 수 있어요.</span></div> : null}
      {error ? <p className="host-security-error" role="alert">{error}</p> : null}
    </div>
    <footer className="host-security-footer host-security-footer--split">
      <button className="host-security-secondary" type="button" disabled={busy} onClick={onCancel}>취소</button>
      <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy}
        onClick={() => void (step === 'existing' ? unlockExisting() : step === 'master' ? continueToPin() : step === 'pin' ? saveLocal() : step === 'contacts' ? start() : verify())}>
        {busy ? <span className="host-security-busy"><span className="host-security-spinner" aria-hidden="true" />{step === 'contacts' ? '인증번호 보내는 중' : step === 'codes' ? '인증번호 확인 중' : '확인하고 있어요'}</span> : step === 'existing' ? '기존 지갑 열기' : step === 'master' ? '다음' : step === 'pin' ? hasAppPin ? '앱 비밀번호 확인' : pinPhase === 'first' ? '다음' : '간편 비밀번호 설정' : step === 'contacts' ? '인증번호 받기' : '지갑 보관 완료'}
      </button>
    </footer>
  </>;
}
