import { ArrowLeft, CaretRight, Fingerprint, LockKey, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { SecurePinKeypad } from './SecurePinKeypad';
import { ensureAppPin } from './appPin';
import { biometricPinAvailable, biometricPinEnabled, disableBiometricPin, enableBiometricPin } from './nativeBiometricPin';

interface Props {
  scope: string | null;
  keypadLayout: 'four-column' | 'three-column';
  hasPin: boolean;
  onBiometricChange?: (enabled: boolean) => void;
  onClose: () => void;
}

export function HostAppSettings({ scope, keypadLayout, hasPin, onBiometricChange, onClose }: Props) {
  const [page, setPage] = useState<'home' | 'password' | 'create' | 'confirm' | 'enable'>('home');
  const isPinPage = page === 'create' || page === 'confirm' || page === 'enable';
  const [pinReady, setPinReady] = useState(hasPin);
  const [firstPin, setFirstPin] = useState('');
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    void biometricPinAvailable().then((value) => { if (active) setAvailable(value); });
    if (scope) void biometricPinEnabled(scope).then((value) => { if (active) setEnabled(value); });
    return () => { active = false; };
  }, [scope]);
  const back = () => {
    setPin(''); setError('');
    if (page === 'confirm') setPage('create');
    else { setFirstPin(''); setPage(page === 'enable' || page === 'create' ? 'password' : 'home'); }
  };
  const createPin = async () => {
    if (!scope || !/^\d{6}$/.test(pin)) { setError('숫자 6자리를 입력해 주세요.'); return; }
    if (page === 'create') { setFirstPin(pin); setPin(''); setError(''); setPage('confirm'); return; }
    if (pin !== firstPin) { setPin(''); setError('두 번 입력한 비밀번호가 달라요. 다시 확인해 주세요.'); return; }
    setBusy(true); setError('');
    try { await ensureAppPin(scope, pin); setPinReady(true); setFirstPin(''); setPin(''); setPage('password'); }
    catch { setPin(''); setFirstPin(''); setPage('create'); setError('앱 비밀번호를 설정하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  const enable = async () => {
    if (!scope || !/^\d{6}$/.test(pin)) { setError('앱 비밀번호 6자리를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try { await enableBiometricPin(scope, pin); setEnabled(true); onBiometricChange?.(true); setPage('password'); setPin(''); }
    catch (caught) { setError(caught instanceof Error && caught.message === 'app_pin_invalid'
      ? '앱 비밀번호가 일치하지 않아요.' : '생체 인증을 연결하지 못했어요. 기기 설정을 확인해 주세요.'); setPin(''); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    if (!scope) return;
    setBusy(true); setError('');
    try { await disableBiometricPin(scope); setEnabled(false); onBiometricChange?.(false); }
    catch { setError('생체 인증을 해제하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  return <section className="host-security-layer host-app-settings" role="dialog" aria-modal="true" aria-labelledby="host-app-settings-title"
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); page === 'home' ? onClose() : back(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="host-app-settings__header">
      {page !== 'home' ? <button type="button" aria-label="뒤로" onClick={back}><ArrowLeft size={22} aria-hidden="true" /></button> : <span />}
      <strong id="host-app-settings-title">{page === 'home' ? '설정' : '앱 비밀번호 설정'}</strong>
      <button ref={closeRef} type="button" aria-label="설정 닫기" onClick={onClose}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className={`host-app-settings__content${isPinPage ? ' host-app-settings__content--pin' : ''}`}>
      {page === 'home' ? <>
        <p className="host-app-settings__caption">월렛 보안</p>
        <button className="host-app-settings__row" type="button" onClick={() => setPage('password')}><span className="host-app-settings__icon"><LockKey size={23} aria-hidden="true" /></span><span><strong>앱 비밀번호 설정</strong><small>간편 비밀번호와 생체 인증</small></span><CaretRight size={19} aria-hidden="true" /></button>
      </> : page === 'password' ? <>
        <h2>앱 비밀번호 설정</h2>
        <p>자가복구 월렛은 이 금융사 앱의 비밀번호로 열어요. 마스터 비밀번호와 복구 방법은 월렛마다 유지됩니다. 간편 연동 월렛은 연결한 계정으로 서명해요.</p>
        <div className="host-app-settings__status"><span>앱 비밀번호</span><strong>{pinReady ? '설정됨' : '설정 전'}</strong></div>
        {!pinReady ? <button className="host-app-settings__primary" type="button" disabled={!scope} onClick={() => setPage('create')}>앱 비밀번호 설정하기</button> : null}
        <div className="host-app-settings__row host-app-settings__row--static"><span className="host-app-settings__icon"><Fingerprint size={23} aria-hidden="true" /></span><span><strong>생체 인증 사용</strong><small>{available ? pinReady ? '자가복구 월렛 서명에 지문이나 얼굴을 사용해요' : '앱 비밀번호 설정 후 사용할 수 있어요' : '이 기기에서는 아직 사용할 수 없어요'}</small></span><button type="button" className="host-app-settings__switch" role="switch" aria-label="생체 인증 사용" aria-checked={enabled} disabled={!available || !pinReady || busy} onClick={() => void (enabled ? disable() : setPage('enable'))}><span /></button></div>
      </> : <>
        <h2>{page === 'create' ? '앱 비밀번호를 만들어 주세요' : page === 'confirm' ? '한 번 더 입력해 주세요' : '앱 비밀번호를 확인해 주세요'}</h2>
        <p>{page === 'create' ? '자가복구 월렛에 사용할 숫자 6자리를 정해 주세요. 기존 월렛은 첫 사용 때 이전 비밀번호로 연결해요.' : page === 'confirm' ? '방금 입력한 숫자 6자리를 다시 입력해 주세요.' : '현재 사용 중인 숫자 6자리를 입력한 뒤 기기의 생체 인증을 연결해요.'}</p>
        <div className="host-app-settings__pin-entry">
          <SecurePinKeypad key={page} value={pin} onChange={setPin} disabled={busy} layout={keypadLayout} />
          {error ? <p className="host-app-settings__error" role="alert">{error}</p> : null}
        </div>
      </>}
      {error && !isPinPage ? <p className="host-app-settings__error" role="alert">{error}</p> : null}
    </div>
    {isPinPage ? <footer className="host-app-settings__footer">
      <button className="host-app-settings__primary" type="button" disabled={busy || pin.length !== 6} onClick={() => void (page === 'enable' ? enable() : createPin())}>{busy ? page === 'enable' ? '생체 인증을 연결하고 있어요' : '앱 비밀번호를 설정하고 있어요' : page === 'enable' ? '생체 인증 연결하기' : page === 'create' ? '다음' : '앱 비밀번호 설정하기'}</button>
    </footer> : null}
  </section>;
}
