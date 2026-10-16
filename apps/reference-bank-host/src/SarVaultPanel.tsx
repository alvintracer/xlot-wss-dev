import { LockKey, ShieldCheck } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';
import { SecurePinKeypad } from './SecurePinKeypad';

interface SarVaultChallenge {
  challengeId: string;
  purpose: 'enroll' | 'unlock';
  phoneMasked: string;
  emailMasked: string;
  expiresAt: string;
}

interface SarVaultPanelProps {
  mode: 'setup' | 'unlock';
  requiresRecovery: boolean;
  acceptsPrivateKey: boolean;
  phoneMasked?: string;
  emailMasked?: string;
  request: SecureTransactionSigningRequest;
  keypadLayout: 'four-column' | 'three-column';
  onCancel: () => void;
  onStartSetup: (input: { secret?: string; password: string; phone: string; email: string }) => Promise<SarVaultChallenge>;
  onStartUnlock: () => Promise<SarVaultChallenge>;
  onVerifyCode: (factor: 'phone' | 'email', code: string) => Promise<{
    phoneVerified: boolean;
    emailVerified: boolean;
  }>;
  onComplete: (password?: string, pin?: string) => Promise<void>;
}

function message(error: unknown): string {
  const reason = error instanceof Error ? error.message : '';
  if (reason === 'recovery_address_mismatch') return '복구 정보가 이 지갑 주소와 일치하지 않아요.';
  if (reason === 'invalid_mnemonic' || reason === 'invalid_private_key') return '복구 구문 또는 개인키를 확인해 주세요.';
  if (reason === 'registered_phone_mismatch') return '지갑 등록 때 인증한 휴대폰 번호를 입력해 주세요.';
  if (reason === 'invalid_vault_phone') return '휴대폰 번호 11자리를 확인해 주세요.';
  if (reason === 'invalid_vault_email') return '이메일 주소를 확인해 주세요.';
  if (reason === 'vault_password_or_envelope_invalid') return '비밀번호가 다르거나 보관 정보가 손상됐어요.';
  if (reason === 'local_vault_unavailable') return '이 기기에 지갑을 보관하지 못했어요. 브라우저 저장소 설정을 확인하거나 이번만 사용하기를 선택해 주세요.';
  if (reason === 'challenge_rate_limited') return '인증 요청이 많아요. 잠시 후 다시 시도해 주세요.';
  if (reason === 'verification_code_mismatch' || reason === 'invalid_code') return '인증번호를 다시 확인해 주세요.';
  if (reason === 'email_delivery_unavailable') return '이메일 인증번호를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (reason === 'phone_delivery_unavailable') return '휴대폰 인증번호를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (reason === 'challenge_expired') return '인증 시간이 지났어요. 처음부터 다시 시도해 주세요.';
  return '지갑 보안 확인을 완료하지 못했어요. 다시 시도해 주세요.';
}

export function SarVaultPanel({
  mode,
  requiresRecovery,
  acceptsPrivateKey,
  phoneMasked,
  emailMasked,
  request,
  keypadLayout,
  onCancel,
  onStartSetup,
  onStartUnlock,
  onVerifyCode,
  onComplete,
}: SarVaultPanelProps) {
  const [step, setStep] = useState<'details' | 'codes' | 'pin' | 'password'>('details');
  const [pinPhase, setPinPhase] = useState<'first' | 'confirm'>('first');
  const [pin, setPin] = useState('');
  const firstPinRef = useRef('');
  const confirmedPinRef = useRef<string | undefined>(undefined);
  const [challenge, setChallenge] = useState<SarVaultChallenge | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secretRef = useRef<HTMLTextAreaElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneCodeRef = useRef<HTMLInputElement>(null);
  const emailCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    firstPinRef.current = '';
    confirmedPinRef.current = undefined;
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      let started: SarVaultChallenge;
      if (mode === 'setup') {
        const password = passwordRef.current?.value ?? '';
        if (password.length < 8) throw new Error('vault_password_too_short');
        if (password !== passwordConfirmRef.current?.value) throw new Error('vault_password_mismatch');
        const secret = secretRef.current?.value.trim();
        if (requiresRecovery && !secret) throw new Error('recovery_required');
        started = await onStartSetup({
          ...(secret ? { secret } : {}),
          password,
          phone: phoneRef.current?.value ?? '',
          email: emailRef.current?.value ?? '',
        });
        if (secretRef.current) secretRef.current.value = '';
        if (passwordRef.current) passwordRef.current.value = '';
        if (passwordConfirmRef.current) passwordConfirmRef.current.value = '';
      } else {
        started = await onStartUnlock();
      }
      if (phoneRef.current) phoneRef.current.value = '';
      if (emailRef.current) emailRef.current.value = '';
      setChallenge(started);
      setStep('codes');
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : '';
      setError(reason === 'vault_password_too_short'
        ? '비밀번호를 8자 이상 입력해 주세요.'
        : reason === 'vault_password_mismatch'
          ? '비밀번호가 서로 달라요.'
          : reason === 'recovery_required'
            ? '이 지갑의 복구 구문 또는 개인키를 입력해 주세요.'
            : message(caught));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      let phoneDone = phoneVerified;
      let emailDone = emailVerified;
      if (!phoneDone) {
        const result = await onVerifyCode('phone', phoneCodeRef.current?.value.trim() ?? '');
        phoneDone = result.phoneVerified;
        setPhoneVerified(phoneDone);
        if (phoneCodeRef.current) phoneCodeRef.current.value = '';
      }
      if (!emailDone) {
        const result = await onVerifyCode('email', emailCodeRef.current?.value.trim() ?? '');
        emailDone = result.emailVerified;
        setEmailVerified(emailDone);
        if (emailCodeRef.current) emailCodeRef.current.value = '';
      }
      if (!phoneDone || !emailDone) throw new Error('vault_authorization_required');
      if (mode === 'setup') await onComplete();
      else setStep('pin');
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const continueFromPin = () => {
    if (!/^\d{6}$/.test(pin)) { setError('간편 비밀번호는 숫자 6자리로 입력해 주세요.'); return; }
    if (pinPhase === 'first') {
      firstPinRef.current = pin;
      setPin('');
      setPinPhase('confirm');
      setError(null);
      return;
    }
    if (pin !== firstPinRef.current) {
      firstPinRef.current = '';
      setPin('');
      setPinPhase('first');
      setError('간편 비밀번호가 서로 달라요. 처음부터 다시 입력해 주세요.');
      return;
    }
    confirmedPinRef.current = pin;
    firstPinRef.current = '';
    setPin('');
    setError(null);
    setStep('password');
  };

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await onComplete(passwordRef.current?.value ?? '', confirmedPinRef.current);
      confirmedPinRef.current = undefined;
      if (passwordRef.current) passwordRef.current.value = '';
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="host-security-content host-vault-panel">
        <p className="host-security-kicker">{request.operation === 'exchange' ? '환전 최종 확인' : '보내기 최종 확인'}</p>
        <dl className="host-transfer-summary">
          <div><dt>보낼 자산</dt><dd>{request.amountDisplay} {request.assetSymbol}</dd></div>
          <div><dt>네트워크</dt><dd>{request.network}</dd></div>
          {request.operation === 'exchange'
            ? <div><dt>받을 자산</dt><dd>{request.receiveAmountDisplay} {request.receiveAssetSymbol}</dd></div>
            : <div><dt>받는 주소</dt><dd>{request.recipient}</dd></div>}
        </dl>
        <div className="host-security-symbol" aria-hidden="true"><LockKey size={32} weight="regular" /></div>
        {step === 'details' ? mode === 'setup' ? (
          <>
            <h3 id="host-security-title">복구 정보를 한 번만 안전하게 보관해요</h3>
            <p>이 기기에서 지갑 조각을 암호화하고, 휴대폰과 이메일 인증으로 다시 사용할 수 있게 설정해요.</p>
            {requiresRecovery ? <label className="host-secure-import-field">
              <span>{acceptsPrivateKey ? '복구 구문 또는 EVM 개인키' : '복구 구문'}</span>
              <textarea ref={secretRef} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} rows={3} />
            </label> : null}
            <label className="host-secure-import-field"><span>보관 비밀번호 · 8자 이상</span>
              <input ref={passwordRef} type="password" autoComplete="new-password" /></label>
            <label className="host-secure-import-field"><span>보관 비밀번호 확인</span>
              <input ref={passwordConfirmRef} type="password" autoComplete="new-password" /></label>
            <label className="host-secure-import-field"><span>등록 때 인증한 휴대폰 번호</span>
              <input ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel" placeholder="01012345678" /></label>
            <label className="host-secure-import-field"><span>이메일 주소</span>
              <input ref={emailRef} type="email" autoComplete="email" placeholder="name@example.com" /></label>
          </>
        ) : (
          <>
            <h3 id="host-security-title">보관한 지갑을 다시 열게요</h3>
            <p>복구 구문 대신 등록한 휴대폰과 이메일로 받은 인증번호를 확인해요.</p>
            <p className="host-vault-contact">휴대폰 {phoneMasked}<br />이메일 {emailMasked}</p>
          </>
        ) : step === 'codes' ? (
          <>
            <h3 id="host-security-title">인증번호를 입력해 주세요</h3>
            <p>휴대폰 {challenge?.phoneMasked}<br />이메일 {challenge?.emailMasked}</p>
            <label className="host-secure-import-field"><span>휴대폰 인증번호 {phoneVerified ? '· 확인됨' : ''}</span>
              <input ref={phoneCodeRef} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={phoneVerified} /></label>
            <label className="host-secure-import-field"><span>이메일 인증번호 {emailVerified ? '· 확인됨' : ''}</span>
              <input ref={emailCodeRef} type="text" inputMode="numeric" maxLength={6} disabled={emailVerified} /></label>
          </>
        ) : step === 'pin' ? (
          <>
            <h3 id="host-security-title">이 기기에서 쓸 간편 비밀번호를 {pinPhase === 'first' ? '정해 주세요' : '다시 입력해 주세요'}</h3>
            <p>한 번만 설정하면 다음 보내기부터 이 기기에서 간편 비밀번호로 지갑을 열 수 있어요.</p>
            <SecurePinKeypad value={pin} onChange={setPin} disabled={busy} layout={keypadLayout} />
            <button className="host-vault-skip-local" type="button" disabled={busy} onClick={() => {
              confirmedPinRef.current = undefined;
              firstPinRef.current = '';
              setPin('');
              setError(null);
              setStep('password');
            }}>이번만 사용하기</button>
          </>
        ) : (
          <>
            <h3 id="host-security-title">보관 비밀번호를 입력해 주세요</h3>
            <p>{confirmedPinRef.current ? '지갑을 열고 이 기기에 암호화해 보관해요.' : '암호화된 지갑 조각을 이 기기에서 열어요.'}</p>
            <label className="host-secure-import-field"><span>보관 비밀번호</span>
              <input ref={passwordRef} autoFocus type="password" autoComplete="current-password" /></label>
          </>
        )}
        {step !== 'pin' ? <div className="host-security-notice"><ShieldCheck size={19} aria-hidden="true" />
          <span>복구 구문, 비밀번호, 복호화된 지갑 조각은 서버로 보내지 않아요.</span></div> : null}
        {error ? <p className="host-security-error" role="alert">{error}</p> : null}
      </div>
      <footer className="host-security-footer host-security-footer--split">
        <button className="host-security-secondary" type="button" disabled={busy} onClick={onCancel}>취소</button>
        <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy}
          onClick={() => void (step === 'details' ? start() : step === 'codes' ? verify() : step === 'pin' ? continueFromPin() : unlock())}>
          {busy ? <span className="host-security-busy"><span className="host-security-spinner" aria-hidden="true" />{step === 'details' ? '인증번호 보내는 중' : step === 'codes' ? '인증번호 확인 중' : '확인하고 있어요'}</span> : step === 'details' ? '인증번호 받기' : step === 'codes' ? '인증번호 확인' : step === 'pin' ? pinPhase === 'first' ? '다음' : '간편 비밀번호 설정' : '지갑 열고 보내기'}
        </button>
      </footer>
    </>
  );
}
