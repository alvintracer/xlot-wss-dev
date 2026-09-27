import { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Bank, CheckCircle, LockKey, ShieldCheck } from '@phosphor-icons/react';
import type {
  CreateSessionResponse,
  HostAuthenticationPurpose,
  HostCapabilities,
  KeyAdapterId,
  WalletShellMode,
  WalletToHostMessage,
} from '@took-wss/contracts';
import { WssHostClient } from '@took-wss/host-sdk';
import { KEY_ADAPTERS } from '@took-wss/key-adapters';
import { ReferenceHostSarKeyCore } from '@took-wss/sar-key-core';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';
import { getHostChromeProfile } from './hostChromeRegistry';

const bffUrl = import.meta.env.VITE_WSS_BFF_URL || 'http://localhost:4100';
const localDevelopmentInstitutionKey = import.meta.env.DEV ? 'local-wss-development-only' : '';
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

export function App() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [tenantId, setTenantId] = useState<TenantId>('kiwoom');
  const [keyAdapter, setKeyAdapter] = useState<KeyAdapterId>(tenantOptions.kiwoom.defaultAdapter);
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [events, setEvents] = useState<WalletToHostMessage[]>([]);
  const [hostFeedback, setHostFeedback] = useState<string | null>(null);
  const [shellMode, setShellMode] = useState<WalletShellMode>('root');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const hostChrome = getHostChromeProfile(tenantOptions[tenantId].presentationProfileId);
  const HostHeader = hostChrome.Header;
  const HostNavigation = hostChrome.Navigation;
  const showRootChrome = shellMode === 'root' || tenantOptions[tenantId].focusedFlow === 'keep-host-chrome';

  const selectTenant = (nextTenant: TenantId) => {
    setTenantId(nextTenant);
    setKeyAdapter(tenantOptions[nextTenant].defaultAdapter);
    setSession(null);
    setEvents([]);
    setHostFeedback(null);
    setShellMode('root');
    setStatus('idle');
  };

  const createSession = async () => {
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
        body: JSON.stringify({ tenantId, customerRef: 'demo-customer-001', requestedKeyAdapter: keyAdapter }),
      });
      if (!response.ok) throw new Error('Session request rejected.');
      setSession(await response.json() as CreateSessionResponse);
      setStatus('ready');
    } catch {
      setSession(null);
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
      requestAuthentication: async (purpose: HostAuthenticationPurpose) => {
        const label = purpose === 'wallet-provisioning' ? '지갑 생성' : purpose === 'transfer-approval' ? '송금 승인' : '지갑 복구';
        if (!import.meta.env.DEV) {
          setHostFeedback(`실제 금융사 ${label} 인증 SDK 연동이 필요합니다.`);
          return 'cancelled';
        }
        setHostFeedback(`Reference Host가 ${label} 인증을 확인했습니다.`);
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        return 'authenticated';
      },
      requestSecureSarWalletCreation: async () => {
        if (!import.meta.env.DEV) {
          setHostFeedback('승인된 네이티브 SAR 키 코어 연동이 필요합니다.');
          return { status: 'cancelled' };
        }
        setHostFeedback('고객 기기 키 코어에서 실제 멀티체인 지갑과 SAR 복구 조각을 만들고 있습니다.');
        const created = await referenceHostSarKeyCore.createWallet();
        return {
          status: 'completed',
          secureProvisionRef: created.keyHandle,
          addresses: created.addresses,
          recoveryEnvelopes: created.recoveryEnvelopes,
          recovery: created.recovery,
        };
      },
      requestSecureWalletImport: async (method) => {
        const label = method === 'mnemonic' ? '니모닉' : '개인키';
        setHostFeedback(`실제 금융사 ${label} 보안 입력·키 코어 연동이 필요합니다.`);
        return { status: 'cancelled' };
      },
    });
    client.start();
    return () => client.stop();
  }, [session]);

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
              <input type="radio" name="key-adapter" value={adapter.id} checked={keyAdapter === adapter.id} onChange={() => { setKeyAdapter(adapter.id); setSession(null); setStatus('idle'); }} />
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
          <div className="host-feedback" role="status" aria-live="polite">{hostFeedback}</div>
        </div>
      </section>
    </main>
  );
}
