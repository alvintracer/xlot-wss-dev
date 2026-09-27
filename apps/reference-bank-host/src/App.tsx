import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Bank, CheckCircle, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { isRecord } from '@took-wss/contracts';
import type {
  CreateSessionResponse,
  HostAuthenticationPurpose,
  HostAuthenticationResult,
  HostCapabilities,
  KeyAdapterId,
  SecureSarWalletCreationResult,
  SecureSarWalletPayload,
  WalletShellMode,
  WalletToHostMessage,
} from '@took-wss/contracts';
import { WssHostClient } from '@took-wss/host-sdk';
import { KEY_ADAPTERS } from '@took-wss/key-adapters';
import { ReferenceHostSarKeyCore, type PreparedSarWallet } from '@took-wss/sar-key-core';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';
import { getHostChromeProfile } from './hostChromeRegistry';
import { HostSecurityOverlay, type HostSecurityView } from './HostSecurityOverlay';

const bffUrl = import.meta.env.VITE_WSS_BFF_URL || 'http://localhost:4100';
const localDevelopmentInstitutionKey = import.meta.env.DEV ? 'local-wss-development-only' : '';
const previewCustomerRef = (() => {
  if (!import.meta.env.DEV) return '';
  const requested = new URLSearchParams(window.location.search).get('customerRef')?.trim();
  return requested && /^[a-zA-Z0-9._:-]{3,128}$/.test(requested) ? requested : 'demo-customer-001';
})();
const hostCapabilities: HostCapabilities = {
  handlesSafeArea: true,
  rendersRootHeader: true,
  rendersRootTabs: true,
  canScanQr: true,
  canUseContacts: true,
  canOpenRecovery: true,
  canLinkExternalWallet: true,
  canSecureWalletImport: false,
  canCreateSecureSarWallet: import.meta.env.DEV,
};

const referenceHostSarKeyCore = new ReferenceHostSarKeyCore();

function tenantOption(manifest: typeof kiwoomManifest | typeof referenceBankManifest) {
  return {
    label: manifest.walletName,
    presentationProfileId: manifest.presentation.profileId,
    focusedFlow: manifest.presentation.navigation.focusedFlow,
    defaultAdapter: manifest.keyManagement.defaultAdapter,
    adapters: manifest.keyManagement.allowedAdapters.map((id) => ({
      id,
      label: `${KEY_ADAPTERS[id].label}${id === manifest.keyManagement.defaultAdapter ? ' · 기본' : ''}`,
    })),
  };
}

const tenantOptions = {
  kiwoom: tenantOption(kiwoomManifest),
  'reference-bank': tenantOption(referenceBankManifest),
};

type TenantId = keyof typeof tenantOptions;

type SecurityCeremony =
  | Extract<HostSecurityView, { type: 'authentication' }>
  | (Extract<HostSecurityView, { type: 'sar-backup' }> & { prepared: PreparedSarWallet });

function chooseConfirmationIndexes(wordCount: number): number[] {
  const indexes = new Set<number>();
  while (indexes.size < Math.min(3, wordCount)) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    indexes.add(random % wordCount);
  }
  return [...indexes].sort((left, right) => left - right);
}

function sarPayload(prepared: PreparedSarWallet): SecureSarWalletPayload {
  return {
    secureProvisionRef: prepared.wallet.keyHandle,
    addresses: prepared.wallet.addresses,
    recoveryEnvelopes: prepared.wallet.recoveryEnvelopes,
    recovery: prepared.wallet.recovery,
  };
}

export function App() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [tenantId, setTenantId] = useState<TenantId>('kiwoom');
  const [keyAdapter, setKeyAdapter] = useState<KeyAdapterId>(tenantOptions.kiwoom.defaultAdapter);
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [events, setEvents] = useState<WalletToHostMessage[]>([]);
  const [hostFeedback, setHostFeedback] = useState<string | null>(null);
  const [shellMode, setShellMode] = useState<WalletShellMode>('root');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [securityCeremony, setSecurityCeremony] = useState<SecurityCeremony | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const securityCeremonyRef = useRef<SecurityCeremony | null>(null);
  const sarPreparationInProgress = useRef(false);
  const authenticationResolver = useRef<((result: HostAuthenticationResult) => void) | null>(null);
  const sarResolver = useRef<((result: SecureSarWalletCreationResult) => void) | null>(null);
  const hostChrome = getHostChromeProfile(tenantOptions[tenantId].presentationProfileId);
  const HostHeader = hostChrome.Header;
  const HostNavigation = hostChrome.Navigation;
  const showRootChrome = shellMode === 'root' || tenantOptions[tenantId].focusedFlow === 'keep-host-chrome';

  const showSecurityCeremony = useCallback((ceremony: SecurityCeremony | null) => {
    securityCeremonyRef.current = ceremony;
    setSecurityCeremony(ceremony);
  }, []);

  const cancelSecurityCeremony = useCallback(() => {
    const active = securityCeremonyRef.current;
    if (!active) return;
    if (active.type === 'authentication') {
      authenticationResolver.current?.({ status: 'cancelled' });
      authenticationResolver.current = null;
    } else {
      void referenceHostSarKeyCore.discardWallet(active.prepared.wallet.keyHandle);
      sarResolver.current?.({ status: 'cancelled' });
      sarResolver.current = null;
    }
    showSecurityCeremony(null);
  }, [showSecurityCeremony]);

  const requestHostAuthentication = useCallback((purpose: HostAuthenticationPurpose): Promise<HostAuthenticationResult> => {
    if (!import.meta.env.DEV
      || !session
      || sessionTokenRef.current !== session.sessionToken
      || securityCeremonyRef.current) {
      return Promise.resolve({ status: 'cancelled' });
    }
    return new Promise((resolve) => {
      authenticationResolver.current = resolve;
      showSecurityCeremony({ id: crypto.randomUUID(), type: 'authentication', purpose });
    });
  }, [session, showSecurityCeremony]);

  const approveHostAuthentication = useCallback(async () => {
    const active = securityCeremonyRef.current;
    if (!session || active?.type !== 'authentication' || !authenticationResolver.current) {
      throw new Error('No active host authentication ceremony.');
    }
    const activeId = active.id;
    const activeSessionToken = session.sessionToken;
    const resolve = authenticationResolver.current;
    const response = await fetch(`${bffUrl}/v1/development/host-authorizations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeSessionToken}`,
        'Content-Type': 'application/json',
        'x-wss-institution-key': localDevelopmentInstitutionKey,
      },
      body: JSON.stringify({ purpose: active.purpose }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Host authorization was rejected.');
    const result = await response.json() as unknown;
    if (!isRecord(result)
      || result.status !== 'authenticated'
      || typeof result.proof !== 'string'
      || typeof result.expiresAt !== 'string'
      || result.method !== 'development-reference-host') {
      throw new Error('Unsupported host authorization response.');
    }
    if (sessionTokenRef.current !== activeSessionToken
      || securityCeremonyRef.current?.id !== activeId
      || authenticationResolver.current !== resolve) return;
    authenticationResolver.current = null;
    showSecurityCeremony(null);
    setHostFeedback('현재 세션에 묶인 일회용 고객 인증 증빙을 발급했습니다.');
    resolve(result as HostAuthenticationResult);
  }, [session, showSecurityCeremony]);

  const requestSecureSarWalletCreation = useCallback(async (): Promise<SecureSarWalletCreationResult> => {
    if (!import.meta.env.DEV
      || !session
      || sessionTokenRef.current !== session.sessionToken
      || securityCeremonyRef.current
      || sarPreparationInProgress.current) return { status: 'cancelled' };
    const activeSessionToken = session.sessionToken;
    sarPreparationInProgress.current = true;
    let prepared: PreparedSarWallet;
    try {
      prepared = await referenceHostSarKeyCore.prepareWallet();
    } finally {
      sarPreparationInProgress.current = false;
    }
    if (sessionTokenRef.current !== activeSessionToken || securityCeremonyRef.current) {
      await referenceHostSarKeyCore.discardWallet(prepared.wallet.keyHandle);
      return { status: 'cancelled' };
    }
    return new Promise((resolve) => {
      sarResolver.current = resolve;
      showSecurityCeremony({
        id: crypto.randomUUID(),
        type: 'sar-backup',
        mnemonicWords: prepared.mnemonicWords,
        confirmationIndexes: chooseConfirmationIndexes(prepared.mnemonicWords.length),
        prepared,
      });
    });
  }, [session, showSecurityCeremony]);

  const confirmSeedBackup = useCallback(async () => {
    const active = securityCeremonyRef.current;
    if (!session || active?.type !== 'sar-backup' || !sarResolver.current) {
      throw new Error('No active SAR backup ceremony.');
    }
    const activeId = active.id;
    const activeSessionToken = session.sessionToken;
    const resolve = sarResolver.current;
    const registration = sarPayload(active.prepared);
    const response = await fetch(`${bffUrl}/v1/development/sar-key-core-attestations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeSessionToken}`,
        'Content-Type': 'application/json',
        'x-wss-institution-key': localDevelopmentInstitutionKey,
      },
      body: JSON.stringify({ registration }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('SAR key-core attestation was rejected.');
    const result = await response.json() as unknown;
    if (!isRecord(result) || typeof result.proof !== 'string' || typeof result.expiresAt !== 'string') {
      throw new Error('Unsupported SAR key-core attestation response.');
    }
    if (sessionTokenRef.current !== activeSessionToken
      || securityCeremonyRef.current?.id !== activeId
      || sarResolver.current !== resolve) return;
    sarResolver.current = null;
    showSecurityCeremony(null);
    setHostFeedback('복구 구문 확인을 마치고 공개 지갑 정보만 WSS에 전달했습니다.');
    resolve({ status: 'completed', ...registration, keyCoreAttestationProof: result.proof });
  }, [session, showSecurityCeremony]);

  const selectTenant = (nextTenant: TenantId) => {
    cancelSecurityCeremony();
    setTenantId(nextTenant);
    setKeyAdapter(tenantOptions[nextTenant].defaultAdapter);
    setSession(null);
    sessionTokenRef.current = null;
    setEvents([]);
    setHostFeedback(null);
    setShellMode('root');
    setStatus('idle');
  };

  const selectKeyAdapter = (nextAdapter: KeyAdapterId) => {
    cancelSecurityCeremony();
    setKeyAdapter(nextAdapter);
    setSession(null);
    sessionTokenRef.current = null;
    setEvents([]);
    setShellMode('root');
    setStatus('idle');
  };

  const createSession = async () => {
    cancelSecurityCeremony();
    sessionTokenRef.current = null;
    setSession(null);
    setStatus('loading');
    setEvents([]);
    setShellMode('root');
    try {
      if (!localDevelopmentInstitutionKey) throw new Error('Reference Host requires an institution backend outside local development.');
      const response = await fetch(`${bffUrl}/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wss-institution-key': localDevelopmentInstitutionKey,
        },
        body: JSON.stringify({ tenantId, customerRef: previewCustomerRef, requestedKeyAdapter: keyAdapter }),
      });
      if (!response.ok) throw new Error('Session request rejected.');
      const createdSession = await response.json() as CreateSessionResponse;
      sessionTokenRef.current = createdSession.sessionToken;
      setSession(createdSession);
      setStatus('ready');
    } catch {
      setSession(null);
      sessionTokenRef.current = null;
      setStatus('error');
    }
  };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !session) return;
    const client = new WssHostClient({
      frame,
      walletOrigin: new URL(session.walletUrl).origin,
      sessionToken: session.sessionToken,
      bffUrl,
      hostCapabilities,
      onEvent: (event) => {
        if (event.type === 'took-wss:shell-change') setShellMode(event.mode);
        setEvents((current) => [...current.slice(-5), event]);
      },
      requestAuthentication: requestHostAuthentication,
      requestSecureSarWalletCreation,
      requestSecureWalletImport: async (method) => {
        const label = method === 'mnemonic' ? '니모닉' : '개인키';
        setHostFeedback(`실제 금융사 ${label} 보안 입력·키 코어 연동이 필요합니다.`);
        return { status: 'cancelled' };
      },
    });
    client.start();
    return () => client.stop();
  }, [requestHostAuthentication, requestSecureSarWalletCreation, session]);

  useEffect(() => {
    if (!hostFeedback) return;
    const timeout = window.setTimeout(() => setHostFeedback(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [hostFeedback]);

  return (
    <main className="host-page">
      <section className="control-panel ops-editorial-grid">
        <div className="eyebrow"><ShieldCheck size={15} weight="fill" /> TOOK WSS REFERENCE HOST</div>
        <h1>금융사 앱 안에<br />지갑을 안전하게.</h1>
        <p className="intro">브랜드, 서비스 모듈, 키 관리 방식을 조합하고 동일한 WSS WebView를 기관 앱 안에 삽입합니다.</p>

        <label>
          <span>Tenant profile</span>
          <select value={tenantId} onChange={(event) => selectTenant(event.target.value as TenantId)}>
            {Object.entries(tenantOptions).map(([id, option]) => <option value={id} key={id}>{option.label}</option>)}
          </select>
        </label>

        <fieldset>
          <legend>Key management</legend>
          {tenantOptions[tenantId].adapters.map((adapter) => (
            <label className="radio-row" key={adapter.id}>
              <input type="radio" name="key-adapter" value={adapter.id} checked={keyAdapter === adapter.id} onChange={() => selectKeyAdapter(adapter.id)} />
              <span><LockKey size={18} />{adapter.label}</span>
            </label>
          ))}
        </fieldset>

        <button className="launch-button" type="button" disabled={status === 'loading'} onClick={createSession}>
          {status === 'loading' ? <ArrowsClockwise className="spin" size={19} /> : <Bank size={19} weight="fill" />}
          {session ? '새 세션 발급하기' : '은행앱에서 월렛 열기'}
        </button>

        <div className="boundary-note">
          <strong>상용 연동 경계</strong>
          <p>세션 발급은 금융사 서버에서 수행합니다. 브라우저의 개발용 키는 로컬 Reference Host에서만 사용됩니다.</p>
        </div>

        <div className="event-log" aria-live="polite">
          <strong>Bridge events</strong>
          {events.length === 0 ? <span>아직 수신한 이벤트가 없습니다.</span> : events.map((event, index) => <span key={`${event.type}-${index}`}><CheckCircle size={13} />{event.type}</span>)}
        </div>
      </section>

      <section className="device-stage" aria-label="금융사 모바일 앱 프리뷰">
        <div
          className={`phone ${showRootChrome ? 'phone--root' : 'phone--focus'}`}
          data-host-chrome={tenantOptions[tenantId].presentationProfileId}
          data-shell-mode={shellMode}
        >
          <div className="phone-status"><span>9:41</span><span>● ● ▰</span></div>
          {showRootChrome ? <HostHeader onAction={setHostFeedback} /> : null}
          {session ? (
            <iframe ref={frameRef} src={session.walletUrl} title={`${tenantOptions[tenantId].label} WebView`} allow="clipboard-write" />
          ) : (
            <div className="host-placeholder">
              <Bank size={38} weight="duotone" />
              <strong>{tenantOptions[tenantId].label}</strong>
              <p>기관 세션을 발급하면 동일한 영역에 WSS WebView가 열립니다.</p>
              {status === 'error' ? <em>BFF 연결을 확인해 주세요.</em> : null}
            </div>
          )}
          {showRootChrome ? <HostNavigation onAction={setHostFeedback} /> : null}
          {securityCeremony ? (
            <HostSecurityOverlay
              key={securityCeremony.id}
              view={securityCeremony}
              onCancel={cancelSecurityCeremony}
              onApproveAuthentication={approveHostAuthentication}
              onConfirmSeedBackup={confirmSeedBackup}
            />
          ) : null}
          <div className="host-feedback" role="status" aria-live="polite">{hostFeedback}</div>
        </div>
      </section>
    </main>
  );
}
