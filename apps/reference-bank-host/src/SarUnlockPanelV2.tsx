import { Fingerprint, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { SarVaultPair } from './sarVaultCryptoV2';
import { SecurePinKeypad } from './SecurePinKeypad';

interface Challenge {
  challengeId: string;
  phoneMasked: string;
  emailMasked: string;
  expiresAt: string;
}

interface Props {
  hasLocalVault: boolean;
  hasAppPin?: boolean;
  biometricEnabled?: boolean;
  onBiometricUnlock?: () => Promise<void>;
  remoteAvailable: boolean;
  phoneMasked?: string;
  emailMasked?: string;
  keypadLayout: 'four-column' | 'three-column';
  onCancel: () => void;
  onLocalUnlock: (input: { pin: string; legacy?: boolean } | { masterPassword: string }) => Promise<void>;
  onStartRemote: (pair: SarVaultPair) => Promise<Challenge>;
  onVerifyRemote: (factor: 'phone' | 'email', code: string) => Promise<{
    phoneVerified: boolean; emailVerified: boolean;
  }>;
  onCompleteRemote: (input: { password?: string; localPin?: string }) => Promise<void>;
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'local_vault_unlock_failed') return '비밀번호가 일치하지 않아요. 다시 확인해 주세요.';
  if (code === 'app_pin_invalid') return '앱 비밀번호가 일치하지 않아요.';
  if (code === 'app_pin_migration_needed') return '이 월렛은 이전 간편 비밀번호로 보호돼요. 한 번만 이전 비밀번호를 입력하면 앱 비밀번호로 연결됩니다.';
  if (code === 'app_pin_migration_expired') return '앱 비밀번호를 다시 입력해 주세요.';
  if (code === 'recovery_address_mismatch') return '복구 정보가 이 지갑 주소와 일치하지 않아요.';
  if (code === 'vault_password_or_envelope_invalid') return '비밀번호가 일치하지 않아요.';
  if (code === 'local_vault_unavailable' || code === 'local_vault_invalid') return '이 기기에 지갑을 보관하지 못했어요. 저장소를 확인해 주세요.';
  if (code === 'challenge_rate_limited') return '인증 요청이 많아요. 잠시 후 다시 시도해 주세요.';
  if (code === 'verification_code_mismatch' || code === 'invalid_code') return '인증번호를 다시 확인해 주세요.';
  if (code === 'challenge_expired') return '인증 시간이 지났어요. 처음부터 다시 시도해 주세요.';
  return '지갑을 열지 못했어요. 다시 시도해 주세요.';
}

export function SarUnlockPanelV2({
  hasLocalVault, hasAppPin, biometricEnabled, onBiometricUnlock, remoteAvailable, phoneMasked, emailMasked, keypadLayout, onCancel, onLocalUnlock, onStartRemote, onVerifyRemote, onCompleteRemote,
}: Props) {
  const [step, setStep] = useState<'local' | 'pair' | 'codes' | 'local-setup'>(hasLocalVault ? 'local' : 'pair');
  const [localMethod, setLocalMethod] = useState<'pin' | 'legacy-pin' | 'master'>('pin');
  const [localPin, setLocalPin] = useState('');
  const [pinFailures, setPinFailures] = useState(0);
  const [pair, setPair] = useState<SarVaultPair>('phone-email');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupPin, setSetupPin] = useState('');
  const [setupPinPhase, setSetupPinPhase] = useState<'first' | 'confirm'>('first');
  const firstSetupPinRef = useRef('');
  const localInputRef = useRef<HTMLInputElement>(null);
  const phoneCodeRef = useRef<HTMLInputElement>(null);
  const emailCodeRef = useRef<HTMLInputElement>(null);
  const remotePasswordRef = useRef<HTMLInputElement>(null);

  const unlockLocal = async () => {
    if (localMethod !== 'master' && pinFailures >= 5) { setLocalMethod('master'); return; }
    if (localMethod !== 'master' && !/^\d{6}$/.test(localPin)) {
      setError('간편 비밀번호 숫자 6자리를 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const value = localMethod !== 'master' ? localPin : localInputRef.current?.value ?? '';
      await onLocalUnlock(localMethod === 'master' ? { masterPassword: value } : { pin: value, ...(localMethod === 'legacy-pin' ? { legacy: true } : {}) });
      setLocalPin('');
      if (localInputRef.current) localInputRef.current.value = '';
    } catch (caught) {
      if (caught instanceof Error && caught.message === 'app_pin_migration_needed') {
        setLocalMethod('legacy-pin'); setLocalPin(''); setError(errorMessage(caught)); return;
      }
      if (localMethod !== 'master') {
        setLocalPin('');
        setPinFailures((count) => count + 1);
        if (pinFailures >= 4) setLocalMethod('master');
      }
      setError(errorMessage(caught));
    } finally { setBusy(false); }
  };

  const unlockBiometric = async () => {
    if (!onBiometricUnlock) return;
    setBusy(true); setError(null);
    try { await onBiometricUnlock(); }
    catch (caught) {
      if (caught instanceof Error && caught.message === 'app_pin_migration_needed') setLocalMethod('legacy-pin');
      setError(caught instanceof Error && caught.message === 'app_pin_migration_needed'
        ? '이 월렛은 이전 비밀번호로 보호돼요. 이전 월렛 PIN을 한 번 입력해 앱 비밀번호로 연결해 주세요.'
        : '생체 인증으로 지갑을 열지 못했어요. 앱 비밀번호를 사용해 주세요.');
    }
    finally { setBusy(false); }
  };

  const startRemote = async () => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await onStartRemote(pair));
      setPhoneVerified(false);
      setEmailVerified(false);
      setStep('codes');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  const verifyRemote = async () => {
    setBusy(true);
    setError(null);
    try {
      const needsPhone = pair === 'password-phone' || pair === 'phone-email';
      const needsEmail = pair === 'password-email' || pair === 'phone-email';
      let phoneDone = phoneVerified;
      let emailDone = emailVerified;
      if (needsPhone && !phoneDone) {
        const result = await onVerifyRemote('phone', phoneCodeRef.current?.value.trim() ?? '');
        phoneDone = result.phoneVerified;
        setPhoneVerified(phoneDone);
        if (phoneCodeRef.current) phoneCodeRef.current.value = '';
      }
      if (needsEmail && !emailDone) {
        const result = await onVerifyRemote('email', emailCodeRef.current?.value.trim() ?? '');
        emailDone = result.emailVerified;
        setEmailVerified(emailDone);
        if (emailCodeRef.current) emailCodeRef.current.value = '';
      }
      if (needsPhone && !phoneDone || needsEmail && !emailDone) throw new Error('vault_authorization_required');
      setStep('local-setup');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  const completeRemote = async (saveLocally: boolean) => {
    const password = remotePasswordRef.current?.value ?? '';
    if (pair !== 'phone-email' && !password) { setError('마스터 비밀번호를 입력해 주세요.'); return; }
    if (saveLocally) {
      if (!password) { setError('이 기기에 저장하려면 마스터 비밀번호를 입력해 주세요.'); return; }
      if (!/^\d{6}$/.test(setupPin)) { setError('간편 비밀번호 숫자 6자리를 입력해 주세요.'); return; }
      if (!hasAppPin && setupPinPhase === 'first') { firstSetupPinRef.current = setupPin; setSetupPin(''); setSetupPinPhase('confirm'); setError(null); return; }
      if (!hasAppPin && setupPin !== firstSetupPinRef.current) { firstSetupPinRef.current = ''; setSetupPin(''); setSetupPinPhase('first'); setError('간편 비밀번호가 달라요. 처음부터 다시 입력해 주세요.'); return; }
    }
    setBusy(true);
    setError(null);
    try { await onCompleteRemote({ ...(password ? { password } : {}), ...(saveLocally ? { localPin: setupPin } : {}) });
      if (remotePasswordRef.current) remotePasswordRef.current.value = '';
      firstSetupPinRef.current = ''; setSetupPin(''); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  return <>
    <div className="host-security-content host-vault-panel">
      <p className="host-security-kicker">지갑 보안 확인</p>
      <div className="host-security-symbol" aria-hidden="true"><LockKey size={32} /></div>
      {step === 'local' ? <>
        <h2 id="host-security-title">이 기기의 지갑을 열어 주세요</h2>
        <p>{localMethod === 'pin' ? hasAppPin ? '이 금융사 앱 비밀번호로 지갑을 열어요.' : '설정한 간편 비밀번호로 지갑을 열어요.' : localMethod === 'legacy-pin' ? '이 월렛에서 전에 쓰던 간편 비밀번호를 입력해 주세요.' : '마스터 비밀번호로 이 기기에 보관한 지갑을 열어요.'}</p>
        {localMethod !== 'master'
          ? <SecurePinKeypad value={localPin} onChange={setLocalPin} disabled={busy} layout={keypadLayout} />
          : <label className="host-secure-import-field"><span>마스터 비밀번호</span>
              <input key={localMethod} ref={localInputRef} type="password" autoComplete="current-password" autoFocus /></label>}
        {localMethod === 'pin' && biometricEnabled ? <button className="host-vault-biometric" type="button" disabled={busy} onClick={() => void unlockBiometric()}><Fingerprint size={20} aria-hidden="true" /> 생체 인증으로 열기</button> : null}
        <div className="host-vault-recovery-options">
          <button type="button" onClick={() => { setLocalMethod(localMethod === 'pin' ? 'master' : 'pin'); setLocalPin(''); setError(null); }}>
            {localMethod !== 'master' ? '마스터 비밀번호로 열기' : '앱 비밀번호로 열기'}</button>
          {remoteAvailable ? <button type="button" onClick={() => { setStep('pair'); setError(null); }}>기기를 바꿨거나 비밀번호를 잊었어요</button> : null}
        </div>
      </> : step === 'pair' ? <>
        <h2 id="host-security-title">두 가지 방법으로 지갑을 복구해요</h2>
        <p>사용할 수 있는 방법 두 개를 선택해 주세요.</p>
        <div className="host-vault-factor-pairs" role="radiogroup" aria-label="지갑 복구 방법">
          {([
            ['phone-email', '휴대폰 인증 + 이메일 인증'],
            ['password-phone', '마스터 비밀번호 + 휴대폰 인증'],
            ['password-email', '마스터 비밀번호 + 이메일 인증'],
          ] as const).map(([value, label]) => <label key={value}>
            <input type="radio" name="sar-factor-pair" checked={pair === value} onChange={() => setPair(value)} />{label}
          </label>)}
        </div>
        <p className="host-vault-contact">휴대폰 {phoneMasked}<br />이메일 {emailMasked}</p>
      </> : step === 'codes' ? <>
        <h2 id="host-security-title">인증번호를 입력해 주세요</h2>
        <p>{pair !== 'password-email' ? <>휴대폰 {challenge?.phoneMasked}<br /></> : null}
          {pair !== 'password-phone' ? <>이메일 {challenge?.emailMasked}</> : null}</p>
        {pair !== 'password-email' ? <label className="host-secure-import-field"><span>휴대폰 인증번호 {phoneVerified ? '· 확인됨' : ''}</span>
          <input ref={phoneCodeRef} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={phoneVerified} autoFocus /></label> : null}
        {pair !== 'password-phone' ? <label className="host-secure-import-field"><span>이메일 인증번호 {emailVerified ? '· 확인됨' : ''}</span>
          <input ref={emailCodeRef} type="text" inputMode="numeric" maxLength={6} disabled={emailVerified} autoFocus={pair === 'password-email'} /></label> : null}
      </> : <>
        <h2 id="host-security-title">이 기기에서 간편하게 열어 보세요</h2>
        <p>한 번 보관하면 다음 결제부터 간편 비밀번호나 마스터 비밀번호로 지갑을 열 수 있어요.</p>
        <label className="host-secure-import-field"><span>마스터 비밀번호</span>
          <input ref={remotePasswordRef} type="password" autoComplete="current-password" autoFocus placeholder={pair === 'phone-email' ? '기기에 보관할 때 입력해 주세요' : undefined} />
          <small>이전에 복구 비밀번호를 따로 설정했다면 그 비밀번호를 입력해 주세요.</small></label>
        <p>{hasAppPin ? '기존 앱 비밀번호 6자리를 입력해 주세요.' : setupPinPhase === 'first' ? '이 기기에서 사용할 간편 비밀번호 6자리를 정해 주세요.' : '간편 비밀번호를 다시 입력해 주세요.'}</p>
        <SecurePinKeypad value={setupPin} onChange={setSetupPin} disabled={busy} layout={keypadLayout} />
        <button className="host-vault-skip-local" type="button" disabled={busy} onClick={() => void completeRemote(false)}>이번만 지갑 열기</button>
      </>}
      <div className="host-security-notice"><ShieldCheck size={19} aria-hidden="true" /><span>지갑은 이 기기에서만 열리고 서명해요.</span></div>
      {error ? <p className="host-security-error" role="alert">{error}</p> : null}
    </div>
    <footer className="host-security-footer host-security-footer--split">
      <button className="host-security-secondary" type="button" disabled={busy} onClick={step === 'codes' ? () => { setStep('pair'); setError(null); } : step === 'local-setup' ? () => { setStep('pair'); setSetupPin(''); firstSetupPinRef.current = ''; setSetupPinPhase('first'); setError(null); } : step === 'pair' && hasLocalVault ? () => { setStep('local'); setError(null); } : onCancel}>
        {step === 'codes' || step === 'local-setup' || step === 'pair' && hasLocalVault ? '뒤로' : '취소'}
      </button>
      <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy}
        onClick={() => void (step === 'local' ? unlockLocal() : step === 'pair' ? startRemote() : step === 'codes' ? verifyRemote() : completeRemote(true))}>
        {busy ? <span className="host-security-busy"><span className="host-security-spinner" aria-hidden="true" />{step === 'pair' ? '인증번호 보내는 중' : step === 'codes' ? '인증번호 확인 중' : '지갑을 열고 있어요'}</span> : step === 'local' ? '지갑 열기' : step === 'pair' ? '인증번호 받기' : step === 'codes' ? '인증번호 확인' : hasAppPin ? '앱 비밀번호 확인 후 보관' : setupPinPhase === 'first' ? '다음' : '이 기기에 보관하고 열기'}
      </button>
    </footer>
  </>;
}
