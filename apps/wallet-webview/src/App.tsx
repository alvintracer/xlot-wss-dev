import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { LockKey } from '@phosphor-icons/react';
import { createThirdwebClient } from 'thirdweb';
import { lightTheme, useConnectModal } from 'thirdweb/react';
import { autoConnect, inAppWallet } from 'thirdweb/wallets';
import { isHostToWalletMessage } from '@took-wss/contracts';
import { getWalletPresentation } from './presentationRegistry';
import { useWssRuntime } from './useWssRuntime';

function RuntimeGate({ error }: { error: string | null }) {
  const theme = {
    '--runtime-primary': import.meta.env.VITE_WSS_LOADING_PRIMARY || '#5b2ca0',
    '--runtime-canvas': import.meta.env.VITE_WSS_LOADING_CANVAS || '#f8f7fa',
    '--runtime-muted': import.meta.env.VITE_WSS_LOADING_MUTED || '#716b78',
  } as CSSProperties;
  return (
    <main className="runtime-gate" style={theme} aria-live="polite">
      <div className="runtime-mark">
        <LockKey size={28} weight="duotone" />
        {!error ? <span className="runtime-spinner" aria-hidden="true" /> : null}
      </div>
      <strong>{error ? '연결을 확인해 주세요' : '안전한 지갑을 준비하고 있어요'}</strong>
      <p>{error || '기관 세션과 서비스 정책을 확인하는 중입니다.'}</p>
      {import.meta.env.DEV && error === '승인된 금융사 앱 WebView에서 실행해 주세요.' ? (
        <a className="runtime-review-link" href={`${import.meta.env.BASE_URL}namu-review.html`}>나무 UI 키트 미리보기 열기</a>
      ) : null}
    </main>
  );
}

function readableButtonText(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return '#ffffff';
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? '#111619' : '#ffffff';
}

function isStandaloneWalletHost(): boolean {
  try {
    const host = window.top ?? window;
    return host.matchMedia('(display-mode: standalone)').matches
      || host.matchMedia('(display-mode: fullscreen)').matches
      || Boolean((host.navigator as Navigator & { standalone?: boolean }).standalone);
  } catch { return false; }
}

function isNativeAndroidHost(): boolean {
  try {
    const parent = window.parent as Window & {
      Capacitor?: { isNativePlatform: () => boolean; getPlatform: () => string };
    };
    return parent !== window && parent.location.origin === window.location.origin
      && parent.Capacitor?.isNativePlatform() === true && parent.Capacitor.getPlatform() === 'android';
  } catch { return false; }
}

interface PendingNativeAuth {
  flow: string;
  clientId: string;
  resolve: (value: { address: string }) => void;
  reject: (error: Error) => void;
  timer: number;
}

export function App() {
  const runtime = useWssRuntime();
  const reconnectThirdwebRef = useRef<(() => Promise<{ address: string }>) | null>(null);
  const nativeAuthRef = useRef<PendingNativeAuth | null>(null);
  const [nativeAuthPicker, setNativeAuthPicker] = useState(false);
  const [nativeAuthBusy, setNativeAuthBusy] = useState(false);
  const { connect } = useConnectModal();
  const configuredManifest = runtime.status === 'ready' ? runtime.bootstrap.manifest : null;
  const thirdwebClientId = runtime.status === 'ready'
    ? runtime.bootstrap.publicProviders?.thirdwebClientId : undefined;
  const pwaOAuthRedirect = isStandaloneWalletHost() && window.parent !== window;
  const nativeAndroid = configuredManifest?.tenantId === 'namu' && isNativeAndroidHost();
  useEffect(() => {
    if (!nativeAndroid) return;
    const onNativeReturn = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin
        || event.data?.type !== 'took-wss:native-thirdweb-return'
        || typeof event.data.url !== 'string') return;
      const pending = nativeAuthRef.current;
      if (!pending) return;
      let callback: URL;
      try { callback = new URL(event.data.url); } catch { return; }
      if (callback.protocol !== 'com.tookwss.namu:' || callback.hostname !== 'auth'
        || !callback.searchParams.has('state')
        || !(callback.searchParams.has('authResult') || callback.searchParams.has('authCookie'))) return;
      void (async () => {
        try {
          const returnUrl = new URL(window.location.href);
          for (const key of ['walletId', 'authProvider', 'authFlow', 'authResult', 'authCookie', 'state']) {
            const value = callback.searchParams.get(key);
            if (value !== null) returnUrl.searchParams.set(key, value);
          }
          window.history.pushState({}, '', `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
          const client = createThirdwebClient({ clientId: pending.clientId });
          const wallet = inAppWallet({ hidePrivateKeyExport: true });
          const connected = await autoConnect({
            client, wallets: [wallet], force: true, timeout: 40_000,
          });
          const account = wallet.getAccount();
          if (!connected || !account || !/^0x[0-9a-fA-F]{40}$/.test(account.address)) {
            throw new Error('thirdweb_auth_failed');
          }
          const { rememberConnectedThirdwebAccount } = await import('./thirdwebWallet');
          rememberConnectedThirdwebAccount(pending.clientId, account);
          if (nativeAuthRef.current === pending) {
            nativeAuthRef.current = null;
            window.clearTimeout(pending.timer);
            setNativeAuthPicker(false);
            setNativeAuthBusy(false);
            pending.resolve({ address: account.address });
          }
        } catch {
          if (nativeAuthRef.current === pending) {
            nativeAuthRef.current = null;
            window.clearTimeout(pending.timer);
            setNativeAuthPicker(false);
            setNativeAuthBusy(false);
            pending.reject(new Error('thirdweb_auth_failed'));
          }
        } finally {
          const clean = new URL(window.location.href);
          for (const key of ['walletId', 'authProvider', 'authFlow', 'authResult', 'authCookie', 'state']) clean.searchParams.delete(key);
          window.history.replaceState({}, '', `${clean.pathname}${clean.search}${clean.hash}`);
        }
      })();
    };
    window.addEventListener('message', onNativeReturn);
    return () => window.removeEventListener('message', onNativeReturn);
  }, [nativeAndroid]);
  useEffect(() => {
    if (runtime.status !== 'ready') return;
    const onExchangeSign = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin
        || event.data?.type !== 'took-wss:exchange-personal-sign'
        || typeof event.data.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.data.requestId)) return;
      const { requestId, walletId, address, message } = event.data as Record<string, unknown>;
      const respond = (result: { ok: boolean; signature?: string; error?: string }) => window.parent.postMessage({
        type: 'took-wss:exchange-personal-sign-result', requestId, ...result,
      }, event.origin);
      if (typeof walletId !== 'string' || !walletId
        || typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)
        || typeof message !== 'string' || message.length > 8192) {
        respond({ ok: false, error: 'thirdweb_auth_failed' });
        return;
      }
      const clientId = runtime.bootstrap.publicProviders?.thirdwebClientId;
      if (!clientId) { respond({ ok: false, error: 'thirdweb_not_configured' }); return; }
      void import('./thirdwebWallet').then(async ({ connectedThirdwebAccount }) => {
        let account = await connectedThirdwebAccount(clientId);
        if (!account || account.address.toLowerCase() !== address.toLowerCase()) {
          const reconnected = await reconnectThirdwebRef.current?.();
          if (!reconnected || reconnected.address.toLowerCase() !== address.toLowerCase()) {
            throw new Error('thirdweb_auth_failed');
          }
          account = await connectedThirdwebAccount(clientId);
        }
        if (!account || account.address.toLowerCase() !== address.toLowerCase()) throw new Error('thirdweb_auth_failed');
        const payload = message.startsWith('0x')
          ? { raw: message as `0x${string}` } : message;
        const signature = await account.signMessage({ message: payload });
        respond({ ok: true, signature });
      }).catch((caught: unknown) => respond({ ok: false, error: caught instanceof Error ? caught.message : 'thirdweb_auth_failed' }));
    };
    window.addEventListener('message', onExchangeSign);
    return () => window.removeEventListener('message', onExchangeSign);
  }, [runtime]);
  const cancelNativeAuth = useCallback(() => {
    const pending = nativeAuthRef.current;
    nativeAuthRef.current = null;
    if (pending) { window.clearTimeout(pending.timer); pending.reject(new Error('thirdweb_auth_cancelled')); }
    setNativeAuthPicker(false);
    setNativeAuthBusy(false);
  }, []);
  const beginNativeAuth = useCallback((strategy: 'google' | 'apple') => {
    const pending = nativeAuthRef.current;
    if (!pending) return;
    setNativeAuthPicker(false);
    setNativeAuthBusy(true);
    const startedAt = Date.now();
    const wallet = inAppWallet({
      auth: { options: ['google', 'apple', 'email'], mode: 'window',
        redirectUrl: 'com.tookwss.namu://auth' },
      hidePrivateKeyExport: true,
    });
    void wallet.connect({ client: createThirdwebClient({ clientId: pending.clientId }), strategy }).catch(() => {
      // Redirect mode opens the system browser, then the SDK's abandoned connect
      // call can reject before Android delivers the deep link. Only early failures
      // mean the browser could not be opened.
      if (Date.now() - startedAt < 3_000 && nativeAuthRef.current === pending) cancelNativeAuth();
    });
  }, [cancelNativeAuth]);
  const connectThirdweb = useCallback(async (strategy?: 'google' | 'apple' | 'stored' | 'email') => {
    if (!configuredManifest || !thirdwebClientId) throw new Error('thirdweb_not_configured');
    if (strategy === 'stored') {
      const { connectedThirdwebAccount } = await import('./thirdwebWallet');
      const account = await connectedThirdwebAccount(thirdwebClientId);
      if (!account) throw new Error('thirdweb_auth_failed');
      return { address: account.address };
    }
    if (nativeAndroid && (strategy === undefined || strategy === 'google' || strategy === 'apple')) {
      if (nativeAuthRef.current) throw new Error('thirdweb_auth_in_progress');
      return new Promise<{ address: string }>((resolve, reject) => {
        const flow = crypto.randomUUID();
        const timer = window.setTimeout(() => {
          const pending = nativeAuthRef.current;
          if (pending?.flow !== flow) return;
          nativeAuthRef.current = null;
          setNativeAuthPicker(false);
          setNativeAuthBusy(false);
          reject(new Error('thirdweb_auth_timeout'));
        }, 300_000);
        nativeAuthRef.current = { flow, clientId: thirdwebClientId, resolve, reject, timer };
        if (strategy === 'google' || strategy === 'apple') beginNativeAuth(strategy);
        else setNativeAuthPicker(true);
      });
    }
    if ((strategy === 'google' || strategy === 'apple') && pwaOAuthRedirect) {
      const requestId = crypto.randomUUID();
      return new Promise<{ address: string }>((_resolve, reject) => {
        const cleanup = () => {
          window.clearTimeout(startTimeout);
          window.removeEventListener('message', onMessage);
        };
        const onMessage = (event: MessageEvent) => {
          if (event.source !== window.parent || event.origin !== window.location.origin
            || !isHostToWalletMessage(event.data)
            || event.data.type !== 'took-wss:oauth-redirect-status'
            || event.data.requestId !== requestId) return;
          if (event.data.status === 'started') {
            window.clearTimeout(startTimeout);
            return;
          }
          cleanup();
          reject(new Error('oauth_redirect_unavailable'));
        };
        const startTimeout = window.setTimeout(() => {
          cleanup();
          reject(new Error('oauth_redirect_unavailable'));
        }, 10_000);
        window.addEventListener('message', onMessage);
        window.parent.postMessage({
          type: 'took-wss:oauth-redirect-request', protocolVersion: 1,
          requestId, clientId: thirdwebClientId, strategy,
        }, window.location.origin);
      });
    }
    const primary = configuredManifest.brand.primaryColor;
    const fontFamily = getComputedStyle(document.querySelector('[data-presentation]') ?? document.body).fontFamily;
    const wallet = await connect({
      client: createThirdwebClient({ clientId: thirdwebClientId }),
      wallets: [inAppWallet({
        auth: { options: strategy === 'email' ? ['email'] : ['google', 'apple', 'email'] },
        hidePrivateKeyExport: true,
        metadata: { name: configuredManifest.walletName },
      })],
      setActive: false,
      showAllWallets: false,
      locale: 'ko_KR',
      size: 'compact',
      title: `${configuredManifest.walletName} 연결`,
      titleIcon: '',
      theme: lightTheme({
        fontFamily,
        colors: {
          accentText: primary,
          accentButtonBg: primary,
          accentButtonText: readableButtonText(primary),
          primaryButtonBg: primary,
          primaryButtonText: readableButtonText(primary),
        },
      }),
    });
    const account = wallet.getAccount();
    if (!account) throw new Error('thirdweb_auth_failed');
    const { rememberConnectedThirdwebAccount } = await import('./thirdwebWallet');
    rememberConnectedThirdwebAccount(thirdwebClientId, account);
    return { address: account.address };
  }, [beginNativeAuth, connect, configuredManifest, nativeAndroid, pwaOAuthRedirect, thirdwebClientId]);
  reconnectThirdwebRef.current = () => connectThirdweb();
  if (runtime.status !== 'ready') return <RuntimeGate error={runtime.error} />;

  const { manifest, walletHome } = runtime.bootstrap;
  const boundaryMismatch = (manifest.presentation.rootHeaderOwner === 'host' && !runtime.hostCapabilities.rendersRootHeader)
    || (manifest.presentation.rootNavigationOwner === 'host' && !runtime.hostCapabilities.rendersRootTabs)
    || (manifest.presentation.safeAreaOwner === 'host' && !runtime.hostCapabilities.handlesSafeArea);
  if (boundaryMismatch) return <RuntimeGate error="금융사 앱과 지갑 화면의 표시 영역 설정이 맞지 않습니다." />;

  const Presentation = getWalletPresentation(manifest.presentation.profileId);
  const claimCode = new URLSearchParams(window.location.hash.slice(1)).get('claim');
  const paymentRequestId = new URLSearchParams(window.location.hash.slice(1)).get('payment');
  return (
    <Suspense fallback={<RuntimeGate error={null} />}>
      <Presentation
        manifest={manifest}
        incomingClaimCode={claimCode && /^[A-Za-z0-9_-]{12}$/.test(claimCode) ? claimCode : undefined}
        incomingPaymentRequestId={paymentRequestId && /^[0-9a-f-]{36}$/i.test(paymentRequestId) ? paymentRequestId : undefined}
        onCreatePaymentRequest={runtime.createPaymentRequest}
        onGetPaymentRequest={runtime.getPaymentRequest}
        onListPaymentRequests={runtime.listPaymentRequests}
        onListSpentPayments={runtime.listSpentPayments}
        onGetPhoneClaimInfo={runtime.getPhoneClaimInfo}
        onRequestInstitutionPhoneClaimOtp={runtime.requestInstitutionPhoneClaimOtp}
        onSubmitInstitutionPhoneClaim={runtime.submitInstitutionPhoneClaim}
        thirdwebClientId={runtime.bootstrap.publicProviders?.thirdwebClientId}
        onConnectThirdweb={connectThirdweb}
        pwaOAuthRedirect={pwaOAuthRedirect || nativeAndroid}
        onCreateThirdwebProof={runtime.createThirdwebProof}
        providerLogin={runtime.providerLogin}
        onCompleteProviderLogin={runtime.completeProviderLogin}
        onCancelProviderLogin={runtime.cancelProviderLogin}
        sessionKeyAdapter={runtime.bootstrap.session.keyAdapter}
        hostCapabilities={runtime.hostCapabilities}
        walletHome={walletHome}
        identity={runtime.bootstrap.identity}
        onNavigate={runtime.navigate}
        onShellModeChange={runtime.setShellMode}
        onRequestHostAuthentication={runtime.requestHostAuthentication}
        onRequestSecureSarWalletCreation={runtime.requestSecureSarWalletCreation}
        onRequestSecureSarVaultEnrollment={runtime.requestSecureSarVaultEnrollment}
        onRequestSecureWalletImport={runtime.requestSecureWalletImport}
        onCreateRegistrationIntent={runtime.createRegistrationIntent}
        onCreatePhoneChallenge={runtime.createPhoneChallenge}
        onVerifyPhoneChallenge={runtime.verifyPhoneChallenge}
        onProvisionWallet={runtime.provisionWallet}
        onSelectWallet={runtime.selectWallet}
        onRefreshWallet={runtime.refreshWallet}
        onInvalidateWallets={runtime.invalidateWallets}
        onRenameWallet={runtime.renameWallet}
        onRemoveWallet={runtime.removeWallet}
        onPrepareTransfer={runtime.prepareTransfer}
        onQuotePhoneEscrow={runtime.quotePhoneEscrow}
        onRequestExchangeQuote={runtime.requestExchangeQuote}
        onPrepareExchange={runtime.prepareExchange}
        onRequestSecureTransactionSignature={runtime.requestSecureTransactionSignature}
        onRequestRecipientPick={runtime.requestRecipientPick}
        onSubmitTransfer={runtime.submitTransfer}
        onListTransferActivity={runtime.listTransferActivity}
        onGetTransferStatus={runtime.getTransferStatus}
        onRetryPhoneNotification={runtime.retryPhoneNotification}
        onPreparePhoneRefund={runtime.preparePhoneRefund}
        onSubmitPhoneRefund={runtime.submitPhoneRefund}
        onSubmitExchange={runtime.submitExchange}
        onGetExchangeStatus={runtime.getExchangeStatus}
      />
      {nativeAuthPicker ? <div className="native-thirdweb-auth-backdrop">
        <section className="native-thirdweb-auth" role="dialog" aria-modal="true" aria-labelledby="native-thirdweb-auth-title"
          style={{ '--native-auth-color': manifest.brand.primaryColor } as CSSProperties}>
          <span className="native-thirdweb-auth__mark"><LockKey size={25} weight="duotone" /></span>
          <h2 id="native-thirdweb-auth-title">월렛 계정을 연결해 주세요</h2>
          <p>이 월렛을 만들 때 사용한 계정으로 로그인해 주세요.</p>
          <div className="native-thirdweb-auth__methods">
            <button type="button" onClick={() => beginNativeAuth('google')}>Google로 계속</button>
            <button type="button" onClick={() => beginNativeAuth('apple')}>Apple로 계속</button>
            <button type="button" onClick={() => {
              const pending = nativeAuthRef.current;
              if (!pending) return;
              setNativeAuthPicker(false);
              void connectThirdweb('email').then((account) => {
                if (nativeAuthRef.current !== pending) return;
                nativeAuthRef.current = null;
                window.clearTimeout(pending.timer);
                setNativeAuthBusy(false);
                pending.resolve(account);
              }).catch(() => {
                if (nativeAuthRef.current !== pending) return;
                nativeAuthRef.current = null;
                window.clearTimeout(pending.timer);
                setNativeAuthBusy(false);
                pending.reject(new Error('thirdweb_auth_failed'));
              });
            }}>이메일로 계속</button>
          </div>
          <button className="native-thirdweb-auth__cancel" type="button" onClick={cancelNativeAuth}>취소</button>
        </section>
      </div> : null}
      {nativeAuthBusy ? <div className="native-thirdweb-auth-wait" role="status">계정을 연결하고 있어요.</div> : null}
    </Suspense>
  );
}
