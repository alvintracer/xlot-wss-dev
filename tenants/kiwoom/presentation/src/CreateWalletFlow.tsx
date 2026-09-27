import {
  Check,
  CaretRight,
  CirclesThreePlus,
  DeviceMobile,
  Key,
  LockKey,
  ShieldCheck,
  Wallet,
  X,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type {
  HostAuthenticationResult,
  CreatePhoneChallengeResponse,
  CreateRegistrationIntentRequest,
  CreateRegistrationIntentResponse,
  KeyAdapterId,
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  SecureSarWalletCreationResult,
  SecureWalletImportResult,
  TenantManifest,
  WalletImportMethod,
  VerifyPhoneChallengeRequest,
  VerifyPhoneChallengeResponse,
  WssIdentityState,
} from '@took-wss/contracts';
import { FlowShell } from './FlowShell';

type CreateFlowStep =
  | 'profile'
  | 'phone-code'
  | 'key-adapter'
  | 'authentication'
  | 'wallet-source'
  | 'seed-wallet'
  | 'secure-import'
  | 'sar-setup'
  | 'provider-wallet'
  | 'provisioning';
type SarWalletSource = 'new' | 'import-mnemonic' | 'import-private-key';

interface CreateWalletFlowProps {
  initialKeyAdapter: KeyAdapterId;
  manifest: TenantManifest;
  mode: 'initial' | 'add';
  canSecureWalletImport: boolean;
  canCreateSecureSarWallet: boolean;
  identity: WssIdentityState;
  onClose: () => void;
  onAuthenticate: () => Promise<HostAuthenticationResult>;
  onRequestSecureSarWalletCreation: () => Promise<SecureSarWalletCreationResult>;
  onRequestSecureImport: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  onCreateRegistrationIntent: (request: CreateRegistrationIntentRequest) => Promise<CreateRegistrationIntentResponse>;
  onCreatePhoneChallenge: (registrationIntentId: string) => Promise<CreatePhoneChallengeResponse>;
  onVerifyPhoneChallenge: (registrationIntentId: string, challengeId: string, request: VerifyPhoneChallengeRequest) => Promise<VerifyPhoneChallengeResponse>;
  onProvision: (request: ProvisionWalletRequest) => Promise<ProvisionWalletResponse>;
  onComplete: (response: ProvisionWalletResponse) => void;
}

const carriers = [
  ['skt', 'SKT'],
  ['kt', 'KT'],
  ['lgu-plus', 'LG U+'],
  ['skt-mvno', 'SKT 알뜰폰'],
  ['kt-mvno', 'KT 알뜰폰'],
  ['lgu-plus-mvno', 'LG U+ 알뜰폰'],
] as const;

const adapterCopy: Record<KeyAdapterId, { title: string; description: string; badge: string }> = {
  'took-sar': {
    title: '자가복구 지갑',
    description: '새 지갑을 만들거나 기존 비수탁 지갑을 가져와 SAR로 보호해요.',
    badge: 'SAR',
  },
  'thirdweb-user-wallet': {
    title: 'Thirdweb MPC 지갑',
    description: '승인된 Thirdweb 고객 통제형 키 관리 방식을 사용해요.',
    badge: 'MPC',
  },
  'fsl-mpc': {
    title: 'FSL MPC 지갑',
    description: '승인된 FSL 고객 통제형 키 관리 방식을 사용해요.',
    badge: 'MPC',
  },
};

export function CreateWalletFlow({
  initialKeyAdapter,
  manifest,
  mode,
  canSecureWalletImport,
  canCreateSecureSarWallet,
  identity,
  onClose,
  onAuthenticate,
  onRequestSecureSarWalletCreation,
  onRequestSecureImport,
  onCreateRegistrationIntent,
  onCreatePhoneChallenge,
  onVerifyPhoneChallenge,
  onProvision,
  onComplete,
}: CreateWalletFlowProps) {
  const canChooseAdapter = mode === 'add' && manifest.keyManagement.allowedAdapters.length > 1;
  const requiresRegistration = mode === 'initial'
    && manifest.identity.onboardingMode === 'phone-first'
    && identity.status === 'registration-required';
  const [keyAdapter, setKeyAdapter] = useState(initialKeyAdapter);
  const [step, setStep] = useState<CreateFlowStep>(requiresRegistration ? 'profile' : canChooseAdapter ? 'key-adapter' : 'authentication');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [carrierCode, setCarrierCode] = useState<CreateRegistrationIntentRequest['carrierCode'] | null>(null);
  const [profileConsent, setProfileConsent] = useState(false);
  const [carrierSheetOpen, setCarrierSheetOpen] = useState(false);
  const [registrationIntentId, setRegistrationIntentId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [hostAuthorizationProof, setHostAuthorizationProof] = useState<string | null>(null);
  const [walletSource, setWalletSource] = useState<SarWalletSource | null>(null);
  const [secureImportRef, setSecureImportRef] = useState<string | null>(null);
  const [preparedSarWallet, setPreparedSarWallet] = useState<Extract<SecureSarWalletCreationResult, { status: 'completed' }> | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const automaticAuthorizationStarted = useRef(false);
  const isSar = keyAdapter === 'took-sar';
  const identityOffset = requiresRegistration ? 2 : 0;
  const offset = canChooseAdapter ? 1 : 0;
  const authenticationStepCount = mode === 'initial' ? 0 : 1;
  const totalSteps = identityOffset + offset + authenticationStepCount + (isSar ? 4 : 2);
  const stepNumber = step === 'profile' ? 1
    : step === 'phone-code' ? 2
      : step === 'key-adapter' ? identityOffset + 1
        : step === 'authentication' ? identityOffset + offset + 1
          : step === 'wallet-source' ? identityOffset + offset + authenticationStepCount + 1
            : step === 'seed-wallet' || step === 'secure-import' ? identityOffset + offset + authenticationStepCount + 2
              : step === 'sar-setup' ? identityOffset + offset + authenticationStepCount + 3
                : step === 'provider-wallet' ? identityOffset + offset + authenticationStepCount + 1
              : totalSteps;

  const normalizedBirthDate = birthDate.replace(/\D/g, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const normalizedPhone = phone.replace(/\D/g, '');
  const canSubmitProfile = name.trim().length >= 2
    && /^\d{4}-\d{2}-\d{2}$/.test(normalizedBirthDate)
    && /^010\d{8}$/.test(normalizedPhone)
    && carrierCode !== null
    && profileConsent;

  useEffect(() => {
    if (mode !== 'initial'
      || requiresRegistration
      || step !== 'authentication'
      || automaticAuthorizationStarted.current) return;
    automaticAuthorizationStarted.current = true;
    setBusy(true);
    setError(null);
    void onAuthenticate()
      .then((result) => {
        if (result.status !== 'authenticated') {
          setError('키움 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.');
          return;
        }
        setHostAuthorizationProof(result.proof);
        setStep(isSar ? 'wallet-source' : 'provider-wallet');
      })
      .catch(() => setError('키움 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.'))
      .finally(() => setBusy(false));
  }, [isSar, mode, onAuthenticate, requiresRegistration, step]);

  const requestPhoneCode = async () => {
    if (!canSubmitProfile || !carrierCode) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await onCreateRegistrationIntent({
        name: name.trim(),
        birthDate: normalizedBirthDate,
        phone: normalizedPhone,
        carrierCode,
        consentVersion: manifest.identity.consentVersion,
      });
      const challenge = await onCreatePhoneChallenge(intent.registrationIntentId);
      setRegistrationIntentId(intent.registrationIntentId);
      setChallengeId(challenge.challengeId);
      setDevelopmentCode(challenge.developmentCode ?? null);
      setVerificationCode('');
      setStep('phone-code');
    } catch {
      setError('입력 내용을 확인하거나 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const resendPhoneCode = async () => {
    if (!registrationIntentId) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await onCreatePhoneChallenge(registrationIntentId);
      setChallengeId(challenge.challengeId);
      setDevelopmentCode(challenge.developmentCode ?? null);
      setVerificationCode('');
    } catch {
      setError('인증번호를 다시 보내지 못했어요. 잠시 후 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!registrationIntentId || !challengeId || !/^\d{6}$/.test(verificationCode)) return;
    setBusy(true);
    setError(null);
    try {
      await onVerifyPhoneChallenge(registrationIntentId, challengeId, { code: verificationCode });
      setDevelopmentCode(null);
    } catch {
      setError('인증번호가 맞지 않거나 유효시간이 지났어요.');
      setBusy(false);
      return;
    }
    automaticAuthorizationStarted.current = true;
    try {
      const result = await onAuthenticate();
      if (result.status === 'authenticated') {
        setHostAuthorizationProof(result.proof);
        setStep(isSar ? 'wallet-source' : 'provider-wallet');
        return;
      }
      setStep('authentication');
      setError('키움 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.');
    } catch {
      setStep('authentication');
      setError('키움 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const selectAdapter = (nextAdapter: KeyAdapterId) => {
    setKeyAdapter(nextAdapter);
    setWalletSource(null);
    setSecureImportRef(null);
    setPreparedSarWallet(null);
    setHostAuthorizationProof(null);
    setRecoveryAcknowledged(false);
    setError(null);
  };

  if (step === 'profile') {
    const selectedCarrier = carriers.find(([code]) => code === carrierCode)?.[1];
    return (
      <FlowShell
        title="고객 정보 확인"
        step={stepNumber}
        totalSteps={totalSteps}
        onClose={onClose}
        footer={(
          <button className="kw-button" type="button" disabled={!canSubmitProfile || busy} aria-busy={busy} onClick={() => void requestPhoneCode()}>
            {busy ? '인증번호를 보내고 있어요' : '인증번호 받기'}
          </button>
        )}
      >
        <h1 className="kw-flow-title">지갑을 연결할 정보를<br />먼저 확인해 주세요</h1>
        <p className="kw-body kw-mt-12">지갑 고객 UUID를 만들고 휴대폰 소유 여부를 확인하는 단계예요. 법적 본인확인을 대신하지 않습니다.</p>
        <div className="kw-underlined-fields kw-mt-24">
          <label><span>이름</span><input value={name} autoComplete="name" maxLength={40} placeholder="이름 입력" onChange={(event) => setName(event.target.value)} /></label>
          <label><span>생년월일</span><input value={birthDate} inputMode="numeric" autoComplete="bday" maxLength={10} placeholder="YYYY.MM.DD" onChange={(event) => setBirthDate(event.target.value)} /></label>
          <button className="kw-field-button" type="button" onClick={() => setCarrierSheetOpen(true)}>
            <span>통신사</span><strong data-empty={!selectedCarrier}>{selectedCarrier ?? '통신사 선택'}</strong><CaretRight aria-hidden="true" />
          </button>
          <label><span>휴대폰 번호</span><input value={phone} inputMode="tel" autoComplete="tel" maxLength={13} placeholder="숫자만 입력" onChange={(event) => setPhone(event.target.value)} /></label>
        </div>
        <label className="kw-consent kw-mt-24">
          <input type="checkbox" checked={profileConsent} onChange={(event) => setProfileConsent(event.target.checked)} />
          <span>지갑 프로필 생성과 휴대폰 소유 확인을 위한 개인정보 처리에 동의합니다.</span>
        </label>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
        {carrierSheetOpen ? (
          <div className="kw-modal-layer" role="presentation" onMouseDown={() => setCarrierSheetOpen(false)}>
            <section className="kw-carrier-sheet" role="dialog" aria-modal="true" aria-label="통신사 선택" onMouseDown={(event) => event.stopPropagation()}>
              <header><h2>통신사를 선택해 주세요</h2><button type="button" aria-label="통신사 선택 닫기" onClick={() => setCarrierSheetOpen(false)}><X aria-hidden="true" /></button></header>
              <div>
                {carriers.map(([code, label]) => (
                  <button type="button" key={code} aria-pressed={carrierCode === code} onClick={() => { setCarrierCode(code); setCarrierSheetOpen(false); }}>
                    <span>{label}</span>{carrierCode === code ? <Check aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </FlowShell>
    );
  }

  if (step === 'phone-code') {
    return (
      <FlowShell
        title="휴대폰 확인"
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={() => setStep('profile')}
        onClose={onClose}
        footer={(
          <button className="kw-button" type="button" disabled={!/^\d{6}$/.test(verificationCode) || busy} aria-busy={busy} onClick={() => void verifyPhoneCode()}>
            {busy ? '확인하고 있어요' : '인증번호 확인'}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><DeviceMobile weight="regular" /></div>
        <h1 className="kw-flow-title">문자로 받은 인증번호<br />6자리를 입력해 주세요</h1>
        <p className="kw-body kw-mt-12">입력한 번호의 휴대폰을 현재 사용할 수 있는지 확인합니다.</p>
        <label className="kw-code-field kw-mt-24">
          <span>인증번호</span>
          <input autoFocus value={verificationCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </label>
        {developmentCode ? <p className="kw-development-code kw-mt-16">개발 확인용 인증번호 <strong>{developmentCode}</strong></p> : null}
        <button className="kw-text-action kw-mt-20" type="button" disabled={busy} onClick={() => void resendPhoneCode()}>인증번호 다시 받기</button>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  const requestAuthentication = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await onAuthenticate();
      if (result.status === 'authenticated') {
        setHostAuthorizationProof(result.proof);
        setStep(isSar ? 'wallet-source' : 'provider-wallet');
        return;
      }
      setError('키움 앱 인증을 완료한 뒤 다시 시도해 주세요.');
    } catch {
      setError('키움 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const chooseSource = (source: SarWalletSource) => {
    setWalletSource(source);
    setSecureImportRef(null);
    setPreparedSarWallet(null);
    setError(null);
    setStep(source === 'new' ? 'seed-wallet' : 'secure-import');
  };

  const prepareSecureSarWallet = async () => {
    if (!canCreateSecureSarWallet) {
      setError('승인된 고객 기기 키 코어 연결이 필요해요.');
      return;
    }
    if (preparedSarWallet) {
      setStep('sar-setup');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onRequestSecureSarWalletCreation();
      if (result.status !== 'completed') {
        setError('복구 구문 확인을 완료하지 못했어요.');
        return;
      }
      setPreparedSarWallet(result);
      setStep('sar-setup');
    } catch {
      setError('키움 보안 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const requestSecureImport = async () => {
    if (walletSource !== 'import-mnemonic' && walletSource !== 'import-private-key') return;
    setBusy(true);
    setError(null);
    const method = walletSource === 'import-mnemonic' ? 'mnemonic' : 'private-key';
    try {
      const result = await onRequestSecureImport(method);
      if (result.status === 'completed') {
        setSecureImportRef(result.secureImportRef);
        setStep('sar-setup');
        return;
      }
      setError('보안 입력을 완료하지 못했어요. 키움 앱 연결을 확인해 주세요.');
    } catch {
      setError('보안 입력을 열지 못했어요. 키움 앱 연결을 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const provision = async () => {
    if (!hostAuthorizationProof) {
      setError('키움 고객 인증을 다시 완료해 주세요.');
      setStep('authentication');
      return;
    }
    if (walletSource && walletSource !== 'new' && !secureImportRef) {
      setError('호스트 보안 입력을 먼저 완료해 주세요.');
      return;
    }
    if (isSar && walletSource === 'new' && !canCreateSecureSarWallet) {
      setError('승인된 고객 기기 키 코어 연결이 필요해요.');
      return;
    }
    setStep('provisioning');
    setBusy(true);
    setError(null);
    try {
      let source: ProvisionWalletRequest['source'];
      if (isSar && walletSource === 'new') {
        if (!preparedSarWallet) throw new Error('Secure SAR wallet preparation is required.');
        source = {
          type: 'secure-new',
          secureProvisionRef: preparedSarWallet.secureProvisionRef,
          addresses: preparedSarWallet.addresses,
          recoveryEnvelopes: preparedSarWallet.recoveryEnvelopes,
          recovery: preparedSarWallet.recovery,
          keyCoreAttestationProof: preparedSarWallet.keyCoreAttestationProof,
        };
      } else if (walletSource && walletSource !== 'new' && secureImportRef) {
        source = {
          type: 'secure-import',
          method: walletSource === 'import-mnemonic' ? 'mnemonic' : 'private-key',
          secureImportRef,
        };
      } else {
        source = { type: 'new' };
      }
      const response = await onProvision({
        idempotencyKey: idempotencyKey.current,
        keyAdapter,
        recoverySetupAcknowledged: isSar ? recoveryAcknowledged : true,
        hostAuthorizationProof,
        source,
      });
      setBusy(false);
      onComplete(response);
    } catch {
      setError('지갑을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
      setStep(isSar ? 'sar-setup' : 'provider-wallet');
      setBusy(false);
    }
  };

  if (step === 'key-adapter') {
    return (
      <FlowShell
        title="지갑 추가"
        step={stepNumber}
        totalSteps={totalSteps}
        onClose={onClose}
        footer={<button className="kw-button" type="button" onClick={() => setStep('authentication')}>선택한 방식으로 계속</button>}
      >
        <h1 className="kw-flow-title">추가할 지갑의<br />키 관리 방식을 선택해 주세요</h1>
        <p className="kw-body kw-mt-12">지갑 슬롯마다 SAR 또는 승인된 MPC 방식을 독립적으로 선택할 수 있어요.</p>
        <div className="kw-flow-choice-list kw-mt-24">
          {manifest.keyManagement.allowedAdapters.map((adapter) => {
            const copy = adapterCopy[adapter];
            return (
              <button className="kw-flow-choice" type="button" aria-pressed={keyAdapter === adapter} key={adapter} onClick={() => selectAdapter(adapter)}>
                <span className="kw-flow-choice__badge">{copy.badge}</span>
                <span><strong>{copy.title}</strong><small>{copy.description}</small></span>
                <Check aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </FlowShell>
    );
  }

  const authenticationBack = canChooseAdapter ? () => setStep('key-adapter') : undefined;
  if (step === 'authentication') {
    if (mode === 'initial') {
      return (
        <FlowShell
          title="지갑 만들기"
          step={stepNumber}
          totalSteps={totalSteps}
          onClose={onClose}
          footer={error ? (
            <button className="kw-button" type="button" disabled={busy} aria-busy={busy} onClick={() => void requestAuthentication()}>
              {busy ? '연결을 확인하고 있어요' : '다시 시도'}
            </button>
          ) : undefined}
        >
          <div className="kw-flow-symbol" aria-hidden="true"><ShieldCheck weight="regular" /></div>
          <h1 className="kw-flow-title">지갑 시작 방식을<br />준비하고 있어요</h1>
          <p className="kw-body kw-mt-12">현재 키움 고객 세션에 지갑 등록 용도의 일회용 증빙을 연결하고 있습니다.</p>
          {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
        </FlowShell>
      );
    }
    return (
      <FlowShell
        title={mode === 'add' ? '지갑 추가' : '지갑 만들기'}
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={authenticationBack}
        onClose={onClose}
        footer={(
          <button className="kw-button" type="button" disabled={busy} aria-busy={busy} onClick={() => void requestAuthentication()}>
            {busy ? '키움 앱에서 확인 중이에요' : '키움 인증 요청'}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><ShieldCheck weight="regular" /></div>
        <h1 className="kw-flow-title">키움 고객 인증으로<br />지갑 등록을 시작해요</h1>
        <p className="kw-body kw-mt-12">키움 앱이 보유한 고객 세션으로 지갑 등록 요청을 한 번 더 확인합니다.</p>
        <div className="kw-inline-notice kw-mt-24">
          <LockKey className="kw-icon kw-icon--small" aria-hidden="true" />
          <span>인증 결과만 전달받으며 PIN, 생체정보, 주민등록번호는 WSS로 전달되지 않습니다.</span>
        </div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  if (step === 'wallet-source') {
    return (
      <FlowShell title="지갑 시작 방식" step={stepNumber} totalSteps={totalSteps} onBack={mode === 'add' ? () => setStep('authentication') : undefined} onClose={onClose}>
        <h1 className="kw-flow-title">새로 만들거나 기존 지갑을<br />가져올 수 있어요</h1>
        <p className="kw-body kw-mt-12">가져온 지갑도 새로운 지갑 슬롯으로 등록하고 SAR 자가복구 체계를 설정합니다.</p>
        <div className="kw-flow-choice-list kw-mt-24">
          <button className="kw-flow-choice" type="button" onClick={() => chooseSource('new')}>
            <span className="kw-flow-choice__icon"><Wallet aria-hidden="true" /></span>
            <span><strong>새 지갑 만들기</strong><small>고객 기기에서 새로운 복구 구문을 만들어요.</small></span>
          </button>
          <button className="kw-flow-choice" type="button" onClick={() => chooseSource('import-mnemonic')}>
            <span className="kw-flow-choice__icon"><Key aria-hidden="true" /></span>
            <span><strong>니모닉으로 가져오기</strong><small>기존 비수탁 지갑의 복구 구문을 보안 입력으로 불러와요.</small></span>
          </button>
          <button className="kw-flow-choice" type="button" onClick={() => chooseSource('import-private-key')}>
            <span className="kw-flow-choice__icon"><LockKey aria-hidden="true" /></span>
            <span><strong>개인키로 가져오기</strong><small>해당 키가 지원하는 네트워크 범위로 지갑을 등록해요.</small></span>
          </button>
        </div>
      </FlowShell>
    );
  }

  if (step === 'seed-wallet') {
    return (
      <FlowShell
        title="새 자가복구 지갑"
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={() => setStep('wallet-source')}
        onClose={onClose}
        footer={(
          <button className="kw-button" type="button" disabled={!canCreateSecureSarWallet || busy} aria-busy={busy} onClick={() => void prepareSecureSarWallet()}>
            {busy ? '키움 보안 화면을 준비하고 있어요' : preparedSarWallet ? '복구 구문 확인 완료' : '키움 보안 화면 열기'}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><Key weight="regular" /></div>
        <h1 className="kw-flow-title">복구 구문을 안전하게<br />보관해 주세요</h1>
        <p className="kw-body kw-mt-12">새 지갑의 복구 구문 12개를 키움 보안 화면에서 한 번만 보여드려요. 지갑을 다시 찾을 때 꼭 필요하니 순서대로 적어 안전한 곳에 보관해 주세요.</p>
        <div className="kw-inline-notice kw-inline-notice--neutral kw-mt-16">
          <DeviceMobile className="kw-icon kw-icon--small" aria-hidden="true" />
          <span>{canCreateSecureSarWallet ? '복구 구문은 고객님의 기기에서만 확인할 수 있으며, 키움 서버로 전송되거나 저장되지 않아요.' : '현재 환경에서는 새 자가복구 지갑을 만들 수 없어요.'}</span>
        </div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  if (step === 'secure-import') {
    const isMnemonic = walletSource === 'import-mnemonic';
    return (
      <FlowShell
        title="기존 지갑 가져오기"
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={() => setStep('wallet-source')}
        onClose={onClose}
        footer={(
          <button className="kw-button" type="button" disabled={!canSecureWalletImport || busy} aria-busy={busy} onClick={() => void requestSecureImport()}>
            {busy ? '보안 입력 확인 중이에요' : canSecureWalletImport ? '키움 보안 입력 열기' : '보안 입력 연결 필요'}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><LockKey weight="regular" /></div>
        <h1 className="kw-flow-title">{isMnemonic ? '복구 구문은' : '개인키는'}<br />키움 보안 화면에서 입력해요</h1>
        <p className="kw-body kw-mt-12">입력한 정보는 고객님의 기기 안에서만 안전하게 처리되며, 키움 서버로 전송되거나 저장되지 않아요.</p>
        <div className="kw-inline-notice kw-mt-24">
          <ShieldCheck className="kw-icon kw-icon--small" aria-hidden="true" />
          <span>보안 입력이 끝나면 비밀값 대신 일회성 등록 참조만 전달받아 SAR 설정을 이어갑니다.</span>
        </div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  if (step === 'sar-setup') {
    return (
      <FlowShell
        title="자가복구 설정"
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={() => setStep(walletSource === 'new' ? 'seed-wallet' : 'secure-import')}
        onClose={onClose}
        footer={(
          <button className="kw-button" type="button" disabled={!recoveryAcknowledged || busy || (walletSource === 'new' && !canCreateSecureSarWallet)} onClick={() => void provision()}>
            {mode === 'add' ? '이 지갑 슬롯 추가하기' : '지갑 만들기'}
          </button>
        )}
      >
        <h1 className="kw-flow-title">2개 조건으로 내가 직접<br />지갑을 복구할 수 있어요</h1>
        <p className="kw-body kw-mt-12">3개의 복구 조건을 서로 다른 신뢰 경계에 두고, 고객이 선택한 2개를 확인해야 복구가 진행됩니다.</p>
        <div className="kw-factor-list kw-mt-24">
          <article><span>A</span><div><strong>비밀번호 · 기기</strong><small>고객 기기에서 보호되는 복구 조건</small></div><Check aria-label="설정 대상" /></article>
          <article><span>B</span><div><strong>휴대폰 메시지 인증</strong><small>분리된 인증·저장 경계</small></div><Check aria-label="설정 대상" /></article>
          <article><span>C</span><div><strong>소셜 · 이메일 인증</strong><small>별도 인증·서명 조건</small></div><Check aria-label="설정 대상" /></article>
        </div>
        <div className="kw-recovery-paths kw-mt-20" aria-label="사용 가능한 복구 조합">
          <span>A + B</span><span>A + C</span><span>B + C</span>
        </div>
        <label className="kw-consent kw-mt-24">
          <input type="checkbox" checked={recoveryAcknowledged} onChange={(event) => setRecoveryAcknowledged(event.target.checked)} />
          <span>어떤 단일 서버나 운영자도 혼자 지갑을 복구할 수 없다는 안내를 확인했어요.</span>
        </label>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  if (step === 'provider-wallet') {
    const copy = adapterCopy[keyAdapter];
    return (
      <FlowShell
        title="MPC 지갑 준비"
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={mode === 'add' ? () => setStep('authentication') : undefined}
        onClose={onClose}
        footer={<button className="kw-button" type="button" disabled={busy} onClick={() => void provision()}>{mode === 'add' ? '이 지갑 슬롯 추가하기' : '지갑 만들기'}</button>}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><CirclesThreePlus weight="regular" /></div>
        <h1 className="kw-flow-title">{copy.title}을<br />새 슬롯으로 준비해요</h1>
        <p className="kw-body kw-mt-12">선택한 공급자의 고객 통제형 지갑을 등록하고, 이 지갑에서 사용할 수 있는 네트워크 정책을 연결합니다.</p>
        <div className="kw-inline-notice kw-mt-24"><strong>선택한 방식</strong>&nbsp; {copy.title}</div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  return (
    <FlowShell title="지갑 준비" step={totalSteps} totalSteps={totalSteps} onClose={onClose}>
      <div className="kw-status-mark" aria-hidden="true"><CirclesThreePlus className="kw-icon" /></div>
      <div className="kw-status-copy">
        <h1 className="kw-flow-title">새 지갑 슬롯을<br />등록하고 있어요</h1>
        <p className="kw-body kw-mt-12">지원 네트워크와 받을 주소를 준비하고 있어요.</p>
      </div>
    </FlowShell>
  );
}
