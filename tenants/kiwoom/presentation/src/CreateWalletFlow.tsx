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
import { normalizeWalletLabel, suggestWalletLabel } from '@took-wss/contracts';
import type {
  HostAuthenticationResult,
  CreatePhoneChallengeResponse,
  CreateRegistrationIntentRequest,
  CreateRegistrationIntentResponse,
  KeyAdapterId,
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  SecureSarWalletCreationResult,
  SecureSarVaultEnrollmentResult,
  SecureWalletImportResult,
  TenantManifest,
  WalletImportMethod,
  WalletProfileSummary,
  VerifyPhoneChallengeRequest,
  VerifyPhoneChallengeResponse,
  WssIdentityState,
  DigitalIdentityHostAction,
  DigitalIdentityHostResult,
} from '@took-wss/contracts';
import { FlowShell } from './FlowShell';
import { BusyButtonLabel } from './BusyButtonLabel';
import { clearPwaWalletCreationResume, savePwaWalletCreationResume } from './pwaAuthResume';

type CreateFlowStep =
  | 'profile'
  | 'phone-code'
  | 'digital-identity'
  | 'existing-wallets'
  | 'no-wallet-found'
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
  entryIntent: 'create' | 'import' | 'recover';
  resumeWalletLabel?: string;
  pwaOAuthRedirect: boolean;
  thirdwebClientId?: string;
  onConnectThirdweb: (strategy?: 'google' | 'apple' | 'stored') => Promise<{ address: string }>;
  onCreateThirdwebProof: (address: string, existingWalletId?: string) => Promise<{
    address: string; challenge: string; signature: string;
  }>;
  onLoadExistingWallet: (walletId: string) => Promise<Extract<ProvisionWalletResponse['walletHome'], { status: 'ready' }>>;
  existingWallets: WalletProfileSummary[];
  canSecureWalletImport: boolean;
  canCreateSecureSarWallet: boolean;
  identity: WssIdentityState;
  onClose: () => void;
  onAuthenticate: () => Promise<HostAuthenticationResult>;
  onRequestSecureSarWalletCreation: () => Promise<SecureSarWalletCreationResult>;
  onRequestSecureSarVaultEnrollment: (walletId: string, secureRef: string) => Promise<SecureSarVaultEnrollmentResult>;
  onRequestSecureImport: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  onCreateRegistrationIntent: (request: CreateRegistrationIntentRequest) => Promise<CreateRegistrationIntentResponse>;
  onCreatePhoneChallenge: (registrationIntentId: string) => Promise<CreatePhoneChallengeResponse>;
  onVerifyPhoneChallenge: (registrationIntentId: string, challengeId: string, request: VerifyPhoneChallengeRequest) => Promise<VerifyPhoneChallengeResponse>;
  onDigitalIdentityRequest?: (action: DigitalIdentityHostAction, walletId?: string) => Promise<DigitalIdentityHostResult>;
  onProvision: (request: ProvisionWalletRequest) => Promise<ProvisionWalletResponse>;
  onComplete: (response: ProvisionWalletResponse, outcome: 'created' | 'loaded') => void;
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
    title: '자가복구 지갑 만들기',
    description: '나만의 인증 수단으로 언제든 복구 구문을 추출하고 복구할 수 있어요.',
    badge: '자가복구',
  },
  'thirdweb-user-wallet': {
    title: 'MPC 지갑 만들기',
    description: 'Google, Apple 또는 이메일로 연결하고 서명할 수 있어요.',
    badge: '간편 연결',
  },
  'fsl-mpc': {
    title: '기관 연동 지갑',
    description: '기관이 제공하는 지갑 보호 방식을 사용해요.',
    badge: '기관 연동',
  },
};

const providerWalletAlreadyRegisteredMessage = '이 계정에는 이미 MPC 지갑이 있어요. 기존 지갑을 선택해 이용해 주세요.';
const evmChainIds = new Set(['ethereum', 'polygon', 'arbitrum', 'base', 'bnb']);

function provisioningFailureMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'wallet_address_already_registered':
      return '이 지갑을 현재 계정에 추가할 수 없어요. 이전에 사용한 계정으로 열거나 고객 연결 상태를 확인해 주세요.';
    case 'provider_wallet_already_registered':
      return providerWalletAlreadyRegisteredMessage;
    case 'wallet_authorization_expired':
      return '고객 확인 시간이 지났어요. 다시 확인한 뒤 지갑 등록을 진행해 주세요.';
    case 'wallet_import_proof_expired':
      return '지갑 가져오기 확인 시간이 지났어요. 복구 구문을 다시 입력해 주세요.';
    case 'wallet_session_changed':
      return '앱 연결이 바뀌었어요. 화면을 다시 열고 진행해 주세요.';
    case 'identity_registration_required':
      return '고객 정보 연결을 확인하지 못했어요. 휴대폰 인증부터 다시 진행해 주세요.';
    case 'thirdweb_not_configured':
      return '계정 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요.';
    case 'thirdweb_auth_failed':
    case 'thirdweb_identity_mismatch':
    case 'provider_wallet_link_conflict':
      return '이 계정에 연결된 지갑을 확인하지 못했어요. 사용한 계정을 다시 확인해 주세요.';
    default:
      return '지갑을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

export function CreateWalletFlow({
  initialKeyAdapter,
  manifest,
  mode,
  entryIntent,
  resumeWalletLabel,
  pwaOAuthRedirect,
  thirdwebClientId,
  onConnectThirdweb,
  onCreateThirdwebProof,
  onLoadExistingWallet,
  existingWallets,
  canSecureWalletImport,
  canCreateSecureSarWallet,
  identity,
  onClose,
  onAuthenticate,
  onRequestSecureSarWalletCreation,
  onRequestSecureSarVaultEnrollment,
  onRequestSecureImport,
  onCreateRegistrationIntent,
  onCreatePhoneChallenge,
  onVerifyPhoneChallenge,
  onDigitalIdentityRequest,
  onProvision,
  onComplete,
}: CreateWalletFlowProps) {
  const canChooseAdapter = entryIntent === 'create' && manifest.keyManagement.allowedAdapters.includes('thirdweb-user-wallet');
  const requiresRegistration = mode === 'initial' && identity.status !== 'established'
    && manifest.identity.onboardingMode === 'phone-first';
  const [keyAdapter, setKeyAdapter] = useState<KeyAdapterId>(resumeWalletLabel ? 'thirdweb-user-wallet' : initialKeyAdapter === 'fsl-mpc' ? 'took-sar' : initialKeyAdapter);
  const [step, setStep] = useState<CreateFlowStep>(resumeWalletLabel ? 'authentication' : requiresRegistration ? 'profile' : canChooseAdapter ? 'key-adapter' : 'authentication');
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
  const [foundWallets, setFoundWallets] = useState<WalletProfileSummary[]>([]);
  const [nextAfterIdentity, setNextAfterIdentity] = useState<CreateFlowStep>('key-adapter');
  const [digitalIdentityConsent, setDigitalIdentityConsent] = useState(false);
  const [phoneCodeAction, setPhoneCodeAction] = useState<'verify' | 'resend' | null>(null);
  const [hostAuthorizationProof, setHostAuthorizationProof] = useState<string | null>(null);
  const [hostAuthorizationExpiresAt, setHostAuthorizationExpiresAt] = useState<string | null>(null);
  const [walletSource, setWalletSource] = useState<SarWalletSource | null>(null);
  const [walletLabel, setWalletLabel] = useState(() => resumeWalletLabel ?? suggestWalletLabel(manifest.brand.logoText, existingWallets, 'created'));
  const [preparedImportedWallet, setPreparedImportedWallet] = useState<Extract<SecureWalletImportResult, { status: 'completed' }> | null>(null);
  const [preparedSarWallet, setPreparedSarWallet] = useState<Extract<SecureSarWalletCreationResult, { status: 'completed' }> | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const provisionedSarWallet = useRef<{ response: ProvisionWalletResponse; secureRef: string } | null>(null);
  const automaticAuthorizationStarted = useRef(false);
  const automaticProviderConnectStarted = useRef(false);
  const institutionLabel = manifest.brand.logoText;
  const institutionName = manifest.institutionName;
  const isSar = keyAdapter === 'took-sar';
  const sarChainCount = manifest.chains.length;
  const providerChainCount = manifest.chains.filter((chainId) => evmChainIds.has(chainId)).length;
  const validWalletLabel = normalizeWalletLabel(walletLabel);
  const walletNameField = <div className="kw-underlined-fields kw-wallet-name-fields kw-mt-24">
    <label><span>지갑 이름</span><input type="text" value={walletLabel} maxLength={30} autoComplete="off" aria-describedby="kw-wallet-name-hint" aria-invalid={!validWalletLabel}
      onChange={(event) => setWalletLabel(event.target.value)} /></label>
    <p className="kw-wallet-name-hint" id="kw-wallet-name-hint" aria-live="polite">{validWalletLabel ? '원하는 이름으로 바꿀 수 있어요. 최대 30자' : '지갑 이름을 1~30자로 입력해 주세요.'}</p>
  </div>;
  const identityOffset = requiresRegistration ? (manifest.identity.digitalCredential ? 3 : 2) : 0;
  const offset = canChooseAdapter ? 1 : 0;
  const authenticationStepCount = mode === 'initial' ? 0 : 1;
  const totalSteps = identityOffset + offset + authenticationStepCount + (isSar ? 4 : 2);
  const stepNumber = step === 'profile' ? 1
    : step === 'phone-code' ? 2
      : step === 'digital-identity' ? 3
      : step === 'existing-wallets' || step === 'no-wallet-found' ? 3
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
    if ((mode !== 'initial' && !resumeWalletLabel)
      || step !== 'authentication'
      || automaticAuthorizationStarted.current) return;
    automaticAuthorizationStarted.current = true;
    setBusy(true);
    setError(null);
    void onAuthenticate()
      .then((result) => {
        if (result.status !== 'authenticated') {
          setError(`${institutionLabel} 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.`);
          return;
        }
        setHostAuthorizationProof(result.proof);
        setHostAuthorizationExpiresAt(result.expiresAt);
        setStep(isSar ? 'wallet-source' : 'provider-wallet');
      })
      .catch(() => setError(`${institutionLabel} 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.`))
      .finally(() => setBusy(false));
  }, [institutionLabel, isSar, mode, onAuthenticate, resumeWalletLabel, step]);

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
      setPhone('');
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
    setPhoneCodeAction('resend');
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
      setPhoneCodeAction(null);
    }
  };

  const verifyPhoneCode = async () => {
    if (!registrationIntentId || !challengeId || !/^\d{6}$/.test(verificationCode)) return;
    setBusy(true);
    setPhoneCodeAction('verify');
    setError(null);
    try {
      const result = await onVerifyPhoneChallenge(registrationIntentId, challengeId, { code: verificationCode });
      setDevelopmentCode(null);
      if (result.existingWallets.length > 0) setFoundWallets(result.existingWallets);
      if (entryIntent === 'import') setKeyAdapter('took-sar');
      const next: CreateFlowStep = result.existingWallets.length > 0 ? 'existing-wallets'
        : entryIntent === 'recover' ? 'no-wallet-found'
          : entryIntent === 'import' ? 'authentication' : 'key-adapter';
      if (manifest.identity.digitalCredential) {
        setNextAfterIdentity(next);
        setStep('digital-identity');
      } else setStep(next);
    } catch (verificationError) {
      const code = verificationError instanceof Error ? verificationError.message : '';
      setError(code === 'identity_details_mismatch' || code === 'identity_profile_mismatch'
        ? '기존 고객 정보와 일치하지 않아요. 입력한 이름과 생년월일을 확인해 주세요.'
        : '인증번호가 맞지 않거나 유효시간이 지났어요.');
      setBusy(false);
      setPhoneCodeAction(null);
      return;
    }
    setBusy(false);
    setPhoneCodeAction(null);
  };

  const selectAdapter = (nextAdapter: KeyAdapterId) => {
    setKeyAdapter(nextAdapter);
    setWalletLabel(suggestWalletLabel(manifest.brand.logoText, foundWallets.length ? foundWallets : existingWallets, 'created'));
    setWalletSource(null);
    setPreparedImportedWallet(null);
    setPreparedSarWallet(null);
    setHostAuthorizationProof(null);
    setHostAuthorizationExpiresAt(null);
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
            {busy ? <BusyButtonLabel>인증번호를 보내고 있어요</BusyButtonLabel> : '인증번호 받기'}
          </button>
        )}
      >
        <h1 className="kw-flow-title">지갑 등록 정보를 확인해 주세요</h1>
        <p className="kw-body kw-mt-12">고객 정보를 확인해요. 휴대폰 소유 여부도 확인해요. 금융사 인증과는 별도예요.</p>
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
          <span>지갑 등록과 휴대폰 확인을 위한 개인정보 처리에 동의합니다.</span>
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
            {busy && phoneCodeAction === 'verify' ? <BusyButtonLabel>인증번호를 확인하고 있어요</BusyButtonLabel> : '인증번호 확인'}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><DeviceMobile weight="regular" /></div>
        <h1 className="kw-flow-title">문자로 받은 인증번호 6자리를 입력해 주세요</h1>
        <p className="kw-body kw-mt-12">입력한 번호의 휴대폰을 현재 사용할 수 있는지 확인합니다.</p>
        <label className="kw-code-field kw-mt-24">
          <span>인증번호</span>
          <input autoFocus value={verificationCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </label>
        {developmentCode ? <p className="kw-development-code kw-mt-16">{manifest.identity.digitalCredential ? '인증번호' : '개발 확인용 인증번호'} <strong>{developmentCode}</strong></p> : null}
        <button className="kw-text-action kw-mt-20" type="button" disabled={busy} aria-busy={busy && phoneCodeAction === 'resend'} onClick={() => void resendPhoneCode()}>{busy && phoneCodeAction === 'resend' ? <BusyButtonLabel>인증번호를 다시 보내고 있어요</BusyButtonLabel> : '인증번호 다시 받기'}</button>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  if (step === 'digital-identity') {
    return <FlowShell title="디지털 신원인증" step={stepNumber} totalSteps={totalSteps} onClose={onClose}
      footer={<button className="kw-button" type="button" disabled={!digitalIdentityConsent || busy} aria-busy={busy}
        onClick={() => { void (async () => {
          if (!onDigitalIdentityRequest) { setError('신원인증 연결을 확인해 주세요.'); return; }
          setBusy(true); setError(null);
          try {
            const status = await onDigitalIdentityRequest('status');
            if (!status.ok) throw new Error(status.error || 'identity_unavailable');
            if (!status.summary) {
              const issued = await onDigitalIdentityRequest('issue');
              if (!issued.ok || !issued.summary) throw new Error(issued.error || 'identity_issue_failed');
            }
            setStep(nextAfterIdentity);
          } catch { setError('디지털 신원인증을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
          finally { setBusy(false); }
        })(); }}>{busy ? <BusyButtonLabel>신원인증을 준비하고 있어요</BusyButtonLabel> : '디지털 ID 발급하고 계속하기'}</button>}>
      <div className="kw-flow-symbol" aria-hidden="true"><ShieldCheck weight="regular" /></div>
      <h1 className="kw-flow-title">내 디지털 신원인증을 만들어요</h1>
      <p className="kw-body kw-mt-12">확인한 휴대폰과 입력한 이름·생년월일로 디지털 ID를 만들고 이 기기에 보관해요.</p>
      <div className="kw-flow-choice-list kw-mt-24">
        <div className="kw-flow-choice"><span className="kw-flow-choice__icon"><ShieldCheck aria-hidden="true" /></span><span><strong>확인된 정보</strong><small>휴대폰 사용 여부</small></span></div>
        <div className="kw-flow-choice"><span className="kw-flow-choice__icon"><Wallet aria-hidden="true" /></span><span><strong>입력한 정보</strong><small>이름과 생년월일 · 별도 실명확인 전</small></span></div>
      </div>
      <label className="kw-consent kw-mt-24"><input type="checkbox" checked={digitalIdentityConsent} onChange={(event) => setDigitalIdentityConsent(event.target.checked)} /><span>디지털 ID 발급과 이 기기 보관에 동의해요.</span></label>
      {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
    </FlowShell>;
  }

  if (step === 'existing-wallets') {
    return (
      <FlowShell title="기존 지갑 확인" step={stepNumber} totalSteps={totalSteps} onClose={onClose}
        footer={<button className="kw-button" type="button" disabled={busy} aria-busy={busy} onClick={async () => {
          const first = foundWallets[0];
          if (!first) return;
          setBusy(true);
          setError(null);
          try {
            const walletHome = await onLoadExistingWallet(first.walletId);
            onComplete({ mode: 'development-key-core', walletHome }, 'loaded');
          } catch {
            setError('기존 지갑을 불러오지 못했어요. 다시 시도해 주세요.');
          } finally { setBusy(false); }
        }}>{busy ? <BusyButtonLabel>지갑을 불러오고 있어요</BusyButtonLabel> : '기존 지갑 모두 불러오기'}</button>}>
        <div className="kw-flow-symbol" aria-hidden="true"><Wallet weight="regular" /></div>
        <h1 className="kw-flow-title">기존 지갑 정보를 불러오시겠어요?</h1>
        <p className="kw-body kw-mt-12">확인한 고객 정보에 연결된 지갑 {foundWallets.length}개를 모두 불러올 수 있어요.</p>
        <div className="kw-flow-choice-list kw-mt-24" aria-label="연결된 기존 지갑">
          {foundWallets.map((wallet) => (
            <div className="kw-flow-choice" key={wallet.walletId}>
              <span className="kw-flow-choice__icon"><Wallet aria-hidden="true" /></span>
              <span><strong>{wallet.label}</strong><small>{wallet.keyAdapter === 'took-sar' ? '자가복구 지갑' : '간편 연결 지갑'}</small></span>
            </div>
          ))}
        </div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
        <button className="kw-text-action kw-mt-24" type="button" onClick={() => {
          setKeyAdapter('took-sar');
          setWalletLabel(suggestWalletLabel(manifest.brand.logoText, foundWallets, 'created'));
          setStep(entryIntent === 'import' ? 'authentication' : 'key-adapter');
        }}>새 지갑 추가하기</button>
      </FlowShell>
    );
  }

  if (step === 'no-wallet-found') {
    return (
      <FlowShell title="기존 지갑 확인" step={stepNumber} totalSteps={totalSteps} onClose={onClose}
        footer={<button className="kw-button" type="button" onClick={() => setStep('key-adapter')}>새 지갑 만들기</button>}>
        <div className="kw-flow-symbol" aria-hidden="true"><Wallet weight="regular" /></div>
        <h1 className="kw-flow-title">연결된 기존 지갑이 없어요</h1>
        <p className="kw-body kw-mt-12">확인한 고객 정보로 등록된 지갑을 찾지 못했어요. 새로 만들거나 외부 지갑을 가져올 수 있어요.</p>
        {canSecureWalletImport ? <button className="kw-text-action kw-mt-24" type="button" onClick={() => {
          setKeyAdapter('took-sar');
          setStep('authentication');
        }}>외부 지갑 가져오기</button> : null}
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
        setHostAuthorizationExpiresAt(result.expiresAt);
        setStep(isSar ? 'wallet-source' : 'provider-wallet');
        return;
      }
      setError(`${institutionLabel} 앱 인증을 완료한 뒤 다시 시도해 주세요.`);
    } catch {
      setError(`${institutionLabel} 앱 인증 연결을 확인한 뒤 다시 시도해 주세요.`);
    } finally {
      setBusy(false);
    }
  };

  const chooseSource = (source: SarWalletSource) => {
    setWalletSource(source);
    setWalletLabel(suggestWalletLabel(manifest.brand.logoText, foundWallets.length ? foundWallets : existingWallets, source === 'new' ? 'created' : 'imported'));
    setPreparedImportedWallet(null);
    setPreparedSarWallet(null);
    setError(null);
    setStep(source === 'new' ? 'seed-wallet' : 'secure-import');
  };

  const prepareSecureSarWallet = async () => {
    if (!canCreateSecureSarWallet) {
      setError('기기의 보안 기능 연결이 필요해요.');
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
      setError(`${institutionLabel} 보안 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.`);
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
        setPreparedImportedWallet(result);
        await provision(result);
        return;
      }
      setError(`보안 입력을 완료하지 못했어요. ${institutionLabel} 앱 연결을 확인해 주세요.`);
    } catch {
      setError(`보안 입력을 열지 못했어요. ${institutionLabel} 앱 연결을 확인해 주세요.`);
    } finally {
      setBusy(false);
    }
  };

  const provision = async (
    importedWallet?: Extract<SecureWalletImportResult, { status: 'completed' }>,
    providerAccount?: { address: string },
  ) => {
    if (provisionedSarWallet.current) {
      setStep('provisioning');
      setBusy(true);
      setError(null);
      try {
        const { response, secureRef } = provisionedSarWallet.current;
        const enrollment = await onRequestSecureSarVaultEnrollment(response.walletHome.wallet.walletId, secureRef);
        if (enrollment.status !== 'completed') throw new Error('sar_vault_enrollment_cancelled');
        setBusy(false);
        onComplete(response, 'created');
      } catch {
        setError('지갑은 만들어졌지만 보관 설정이 끝나지 않았어요. 다시 시도해 주세요.');
        setStep('sar-setup');
        setBusy(false);
      }
      return;
    }
    const label = normalizeWalletLabel(walletLabel);
    if (!label) { setError('지갑 이름을 1~30자로 입력해 주세요.'); return; }
    const walletToImport = importedWallet ?? preparedImportedWallet;
    if (!hostAuthorizationProof) {
      setError(`${institutionLabel} 고객 인증을 다시 완료해 주세요.`);
      setStep('authentication');
      return;
    }
    if (walletSource && walletSource !== 'new' && !walletToImport) {
      setError('호스트 보안 입력을 먼저 완료해 주세요.');
      return;
    }
    if (isSar && walletSource === 'new' && !canCreateSecureSarWallet) {
      setError('기기의 보안 기능 연결이 필요해요.');
      return;
    }
    setStep('provisioning');
    setBusy(true);
    setError(null);
    try {
      let authorizationProof = hostAuthorizationProof;
      if (hostAuthorizationExpiresAt && Date.parse(hostAuthorizationExpiresAt) <= Date.now() + 30_000) {
        const refreshed = await onAuthenticate();
        if (refreshed.status !== 'authenticated') throw new Error('wallet_authorization_expired');
        authorizationProof = refreshed.proof;
        setHostAuthorizationProof(refreshed.proof);
        setHostAuthorizationExpiresAt(refreshed.expiresAt);
      }
      let source: ProvisionWalletRequest['source'];
      if (keyAdapter === 'thirdweb-user-wallet') {
        if (!providerAccount) throw new Error('thirdweb_auth_failed');
        const proof = await onCreateThirdwebProof(providerAccount.address);
        source = {
          type: 'provider-auth',
          ...proof,
        };
      } else if (isSar && walletSource === 'new') {
        if (!preparedSarWallet) throw new Error('Secure SAR wallet preparation is required.');
        source = {
          type: 'secure-new',
          secureProvisionRef: preparedSarWallet.secureProvisionRef,
          addresses: preparedSarWallet.addresses,
          recoveryEnvelopes: preparedSarWallet.recoveryEnvelopes,
          recovery: preparedSarWallet.recovery,
          keyCoreAttestationProof: preparedSarWallet.keyCoreAttestationProof,
        };
      } else if (walletSource && walletSource !== 'new' && walletToImport) {
        source = {
          type: 'secure-import',
          method: walletSource === 'import-mnemonic' ? 'mnemonic' : 'private-key',
          secureImportRef: walletToImport.secureImportRef,
          addresses: walletToImport.addresses,
          recoveryEnvelopes: walletToImport.recoveryEnvelopes,
          recovery: walletToImport.recovery,
          keyCoreAttestationProof: walletToImport.keyCoreAttestationProof,
        };
      } else {
        source = { type: 'new' };
      }
      const response = await onProvision({
        idempotencyKey: idempotencyKey.current,
        keyAdapter,
        label,
        recoverySetupAcknowledged: isSar ? recoveryAcknowledged : true,
        hostAuthorizationProof: authorizationProof,
        source,
      });
      if (isSar) {
        const secureRef = source.type === 'secure-new' ? source.secureProvisionRef
          : source.type === 'secure-import' ? source.secureImportRef : null;
        if (!secureRef) throw new Error('sar_vault_enrollment_required');
        provisionedSarWallet.current = { response, secureRef };
        const enrollment = await onRequestSecureSarVaultEnrollment(response.walletHome.wallet.walletId, secureRef);
        if (enrollment.status !== 'completed') throw new Error('sar_vault_enrollment_cancelled');
      }
      setBusy(false);
      onComplete(response, 'created');
    } catch (error) {
      setError(provisionedSarWallet.current
        ? '지갑은 만들어졌지만 보관 설정이 끝나지 않았어요. 다시 시도해 주세요.'
        : provisioningFailureMessage(error));
      setStep(error instanceof Error && error.message === 'wallet_import_proof_expired'
        ? 'secure-import'
        : isSar ? 'sar-setup' : 'provider-wallet');
      setBusy(false);
    }
  };

  const connectProviderWallet = async (strategy?: 'google' | 'apple' | 'stored') => {
    if (!thirdwebClientId) { setError('계정 연결을 준비하고 있어요.'); return; }
    setBusy(true);
    setError(null);
    try {
      if (pwaOAuthRedirect && (strategy === 'google' || strategy === 'apple')) {
        savePwaWalletCreationResume({ tenantId: manifest.tenantId, mode, entryIntent, walletLabel });
      }
      const account = await onConnectThirdweb(strategy);
      clearPwaWalletCreationResume(manifest.tenantId);
      await provision(undefined, account);
    } catch (error) {
      clearPwaWalletCreationResume(manifest.tenantId);
      if (error == null) return;
      setError('계정 연결을 완료하지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!resumeWalletLabel || !pwaOAuthRedirect || step !== 'provider-wallet'
      || !hostAuthorizationProof || !thirdwebClientId || automaticProviderConnectStarted.current) return;
    automaticProviderConnectStarted.current = true;
    void connectProviderWallet('stored');
  }, [hostAuthorizationProof, pwaOAuthRedirect, resumeWalletLabel, step, thirdwebClientId]);

  if (resumeWalletLabel && !error
    && (step === 'authentication' || step === 'provider-wallet' || step === 'provisioning')) {
    return <FlowShell title="지갑 준비" step={totalSteps} totalSteps={totalSteps} onClose={onClose}>
      <div className="kw-status-mark" aria-hidden="true"><span className="kw-flow-spinner" /></div>
      <div className="kw-status-copy" role="status" aria-live="polite">
        <h1 className="kw-flow-title">새 지갑을 생성하고 있어요</h1>
        <p className="kw-body kw-mt-12">지갑과 주소를 준비하고 있어요.</p>
      </div>
    </FlowShell>;
  }

  if (step === 'key-adapter') {
    return (
      <FlowShell
        title={mode === 'add' ? '지갑 추가' : '새 지갑 만들기'}
        step={stepNumber}
        totalSteps={totalSteps}
        onClose={onClose}
        footer={<button className="kw-button" type="button" disabled={keyAdapter === 'thirdweb-user-wallet' && !thirdwebClientId}
          onClick={() => { automaticAuthorizationStarted.current = false; setStep('authentication'); }}>선택한 방식으로 계속</button>}
      >
        <h1 className="kw-flow-title">새 지갑 만들기</h1>
        <p className="kw-body kw-mt-12">지갑을 만드는 방식을 선택해 주세요.</p>
        <div className="kw-flow-choice-list kw-mt-24">
          {manifest.keyManagement.allowedAdapters.filter((adapter) => adapter === 'took-sar' || adapter === 'thirdweb-user-wallet').map((adapter) => {
            const copy = adapterCopy[adapter];
            return (
              <button className="kw-flow-choice" type="button" aria-pressed={keyAdapter === adapter} key={adapter} onClick={() => selectAdapter(adapter)}>
                <span><span className="kw-flow-choice__heading"><strong>{copy.title}</strong>
                  <em>{adapter === 'took-sar' ? `${sarChainCount}개 체인 지원` : `${providerChainCount}개 체인(EVM) 지원`}</em></span>
                  <small>{copy.description}</small>
                  {adapter === 'thirdweb-user-wallet' && !thirdwebClientId ? <small>계정 연결 준비 중</small> : null}</span>
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
          onBack={authenticationBack}
          onClose={onClose}
          footer={(
            <button className="kw-button" type="button" disabled={busy} aria-busy={busy} onClick={() => void requestAuthentication()}>
              {busy ? <BusyButtonLabel>연결을 확인하고 있어요</BusyButtonLabel> : error ? '다시 시도' : `${institutionLabel} 인증 요청`}
            </button>
          )}
        >
          <div className="kw-flow-symbol" aria-hidden="true">{busy ? <span className="kw-flow-spinner" /> : <ShieldCheck weight="regular" />}</div>
          <h1 className="kw-flow-title">지갑 시작 방식을 준비하고 있어요</h1>
          <p className="kw-body kw-mt-12">현재 {institutionLabel} 고객 세션에 지갑 등록 용도의 일회용 증빙을 연결하고 있습니다.</p>
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
            {busy ? <BusyButtonLabel>{`${institutionLabel} 앱에서 확인 중이에요`}</BusyButtonLabel> : `${institutionLabel} 인증 요청`}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><ShieldCheck weight="regular" /></div>
        <h1 className="kw-flow-title">{institutionLabel} 고객 인증으로 지갑 등록을 시작해요</h1>
        <p className="kw-body kw-mt-12">{institutionLabel} 앱이 보유한 고객 세션으로 지갑 등록 요청을 한 번 더 확인합니다.</p>
        <div className="kw-inline-notice kw-mt-24">
          <LockKey className="kw-icon kw-icon--small" aria-hidden="true" />
          <span>인증 결과만 전달받으며 PIN, 생체정보, 주민등록번호는 WSS로 전달되지 않습니다.</span>
        </div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
      </FlowShell>
    );
  }

  if (step === 'wallet-source') {
    const importOnly = entryIntent !== 'create' && mode === 'initial';
    return (
      <FlowShell title="지갑 시작 방식" step={stepNumber} totalSteps={totalSteps} onBack={mode === 'add' ? () => setStep('authentication') : undefined} onClose={onClose}>
        <h1 className="kw-flow-title">{importOnly ? '외부 지갑을 가져와 주세요' : <>새로 만들거나<br />기존 지갑을 가져올 수 있어요</>}</h1>
        <p className="kw-body kw-mt-12">가져온 지갑도 별도의 지갑으로 등록하고 복구 방법을 설정합니다.</p>
        <div className="kw-flow-choice-list kw-mt-24">
          {!importOnly ? <button className="kw-flow-choice" type="button" onClick={() => chooseSource('new')}>
            <span className="kw-flow-choice__icon"><Wallet aria-hidden="true" /></span>
            <span><strong>새 지갑 만들기</strong><small>고객 기기에서 새로운 복구 구문을 만들어요.</small></span>
          </button> : null}
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
            {busy ? <BusyButtonLabel>{`${institutionLabel} 보안 화면을 준비하고 있어요`}</BusyButtonLabel> : preparedSarWallet ? '복구 구문 확인 완료' : `${institutionLabel} 보안 화면 열기`}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><Key weight="regular" /></div>
        <h1 className="kw-flow-title">복구 구문을 안전하게 보관해 주세요</h1>
        <p className="kw-body kw-mt-12">새 지갑의 복구 구문 12개를 {institutionLabel} 보안 화면에서 한 번만 보여드려요. 지갑을 다시 찾을 때 꼭 필요하니 순서대로 적어 안전한 곳에 보관해 주세요.</p>
        <div className="kw-inline-notice kw-inline-notice--neutral kw-mt-16">
          <DeviceMobile className="kw-icon kw-icon--small" aria-hidden="true" />
          <span>{canCreateSecureSarWallet ? `복구 구문은 고객님의 기기에서만 확인할 수 있으며, ${institutionName} 서버로 전송되거나 저장되지 않아요.` : '현재 환경에서는 새 자가복구 지갑을 만들 수 없어요.'}</span>
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
          <button className="kw-button" type="button" disabled={!canSecureWalletImport || !recoveryAcknowledged || !validWalletLabel || busy} aria-busy={busy} onClick={() => void requestSecureImport()}>
            {busy ? <BusyButtonLabel>지갑을 가져오고 있어요</BusyButtonLabel> : canSecureWalletImport ? '보안 입력 후 지갑 추가하기' : '보안 입력 연결 필요'}
          </button>
        )}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><LockKey weight="regular" /></div>
        <h1 className="kw-flow-title">{isMnemonic ? '복구 구문은' : '개인키는'} {institutionLabel} 보안 화면에서 입력해요</h1>
        <p className="kw-body kw-mt-12">입력한 정보는 고객님의 기기 안에서만 안전하게 처리되며, {institutionName} 서버로 전송되거나 저장되지 않아요.</p>
        {walletNameField}
        <div className="kw-inline-notice kw-mt-24">
          <ShieldCheck className="kw-icon kw-icon--small" aria-hidden="true" />
          <span>보안 입력을 마치면 지갑 주소를 확인하고 지갑을 추가해요.</span>
        </div>
        <label className="kw-consent kw-mt-24">
          <input type="checkbox" checked={recoveryAcknowledged} onChange={(event) => setRecoveryAcknowledged(event.target.checked)} />
          <span>자가복구 방식으로 지갑을 보호한다는 안내를 확인했어요.</span>
        </label>
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
          <button className="kw-button" type="button" disabled={!recoveryAcknowledged || !validWalletLabel || busy || (walletSource === 'new' && !canCreateSecureSarWallet)} aria-busy={busy} onClick={() => void provision()}>
            {busy ? <BusyButtonLabel>지갑을 등록하고 있어요</BusyButtonLabel> : mode === 'add' ? '이 지갑 추가하기' : '지갑 만들기'}
          </button>
        )}
      >
        <h1 className="kw-flow-title">나의 인증 수단 중<br className="kw-recovery-narrow-break" /> 2가지 조합을 통해<br />언제든 지갑을 복구할 수 있어요</h1>
        <p className="kw-body kw-mt-12">아래 인증 수단을 준비해 주세요.</p>
        {walletNameField}
        <div className="kw-factor-list kw-mt-24">
          <article><span>A</span><div><strong>마스터 비밀번호</strong></div><Check aria-label="설정 대상" /></article>
          <article><span>B</span><div><strong>휴대폰 메시지 인증</strong></div><Check aria-label="설정 대상" /></article>
          <article><span>C</span><div><strong>이메일 인증</strong></div><Check aria-label="설정 대상" /></article>
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
    return (
      <FlowShell
        title="MPC 지갑 만들기"
        step={stepNumber}
        totalSteps={totalSteps}
        onBack={() => setStep('authentication')}
        onClose={onClose}
        footer={error === providerWalletAlreadyRegisteredMessage
          ? <button className="kw-button" type="button" onClick={onClose}>기존 지갑 보기</button>
          : pwaOAuthRedirect
          ? resumeWalletLabel ? <button className="kw-button" type="button" disabled={busy || !thirdwebClientId || !validWalletLabel} aria-busy={busy} onClick={() => void connectProviderWallet('stored')}>
            {busy ? <BusyButtonLabel>계정을 연결하고 있어요</BusyButtonLabel> : '로그인한 계정으로 계속'}
          </button> : null
          : <button className="kw-button" type="button" disabled={busy || !thirdwebClientId || !validWalletLabel} aria-busy={busy} onClick={() => void connectProviderWallet()}>
            {busy ? <BusyButtonLabel>계정을 연결하고 있어요</BusyButtonLabel> : '계정 선택하기'}
          </button>}
      >
        <div className="kw-flow-symbol" aria-hidden="true"><CirclesThreePlus weight="regular" /></div>
        <h1 className="kw-flow-title">계정을 선택해 지갑을 만들어요</h1>
        <p className="kw-body kw-mt-12">Google, Apple 또는 이메일로 로그인할 수 있어요.</p>
        {error ? <p className="kw-error kw-mt-16" role="alert">{error}</p> : null}
        {walletNameField}
        {pwaOAuthRedirect ? <div className="kw-pwa-auth-methods kw-mt-24" aria-label="계정 로그인 방법">
          <button type="button" disabled={busy || !validWalletLabel} onClick={() => void connectProviderWallet('google')}>Google로 계속</button>
          <button type="button" disabled={busy || !validWalletLabel} onClick={() => void connectProviderWallet('apple')}>Apple로 계속</button>
          <button type="button" disabled={busy || !validWalletLabel} onClick={() => void connectProviderWallet()}>이메일로 계속</button>
        </div> : null}
        {!thirdwebClientId ? <p className="kw-error kw-mt-16" role="status">계정 연결을 준비하고 있어요.</p> : null}
      </FlowShell>
    );
  }

  return (
    <FlowShell title="지갑 준비" step={totalSteps} totalSteps={totalSteps} onClose={onClose}>
      <div className="kw-status-mark" aria-hidden="true"><span className="kw-flow-spinner" /></div>
      <div className="kw-status-copy" role="status" aria-live="polite">
        <h1 className="kw-flow-title">{walletSource === 'import-mnemonic' || walletSource === 'import-private-key' ? '기존 지갑을 연결하고 있어요' : '새 지갑을 생성하고 있어요'}</h1>
        <p className="kw-body kw-mt-12">{walletSource === 'import-mnemonic' || walletSource === 'import-private-key' ? '기존 지갑의 주소를 연결하고 있어요.' : '지갑과 주소를 준비하고 있어요.'}</p>
      </div>
    </FlowShell>
  );
}
