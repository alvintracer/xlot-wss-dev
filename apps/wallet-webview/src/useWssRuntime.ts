import { useCallback, useEffect, useRef, useState } from 'react';
import { WalletHomeCache } from './walletHomeCache';
import {
  WSS_PROTOCOL_VERSION,
  isHostToWalletMessage,
  isSecureTransactionSigningRequest,
  transactionSigningRequestMatches,
  isRecord,
  isWssIdentityState,
  isWalletHomePayload,
  type HostCapabilities,
  type HostRecipientPickResult,
  type ExchangeExecutionResult,
  type ExchangeQuote,
  type PrepareExchangeRequest,
  type PreparedExchange,
  type ProviderWalletLoginState,
  type RequestExchangeQuote,
  type CreatePhoneChallengeResponse,
  type CreateRegistrationIntentRequest,
  type CreateRegistrationIntentResponse,
  type HostAuthenticationPurpose,
  type HostAuthenticationResult,
  type PrepareTransferRequest,
  type PreparedTransfer,
  type PhoneClaimInfo,
  type ProvisionWalletRequest,
  type ProvisionWalletResponse,
  type ReadyWalletHomePayload,
  type WalletHomePayload,
  type WalletPaymentRequest,
  type KeyAdapterId,
  type WalletProfileSummary,
  type SecureSarWalletCreationResult,
  type SecureSarVaultEnrollmentResult,
  type SecureTransactionSigningRequest,
  type SecureTransactionSigningResult,
  type SecureWalletImportResult,
  type WalletImportMethod,
  type WalletShellMode,
  type SubmitTransferRequest,
  type SubmitExchangeRequest,
  type TransferExecutionResult,
  type TransferActivityItem,
  type WalletToHostMessage,
  type WssRuntimeBootstrap,
  type VerifyPhoneChallengeRequest,
  type VerifyPhoneChallengeResponse,
  type DigitalIdentityHostAction,
  type DigitalIdentityHostResult,
} from '@took-wss/contracts';

type RuntimeState =
  | { status: 'waiting' | 'loading'; bootstrap: null; hostCapabilities: null; error: null }
  | { status: 'ready'; bootstrap: WssRuntimeBootstrap; hostCapabilities: HostCapabilities; error: null }
  | { status: 'error'; bootstrap: null; hostCapabilities: null; error: string };

type RuntimeResult = RuntimeState & {
  createPaymentRequest: (input: { walletId: string; chainId: string; assetId: string; amountAtomic: string }) => Promise<WalletPaymentRequest>;
  getPaymentRequest: (id: string) => Promise<WalletPaymentRequest>;
  listPaymentRequests: (walletId: string) => Promise<WalletPaymentRequest[]>;
  listSpentPayments: (walletId: string) => Promise<WalletPaymentRequest[]>;
  getPhoneClaimInfo: (code: string) => Promise<PhoneClaimInfo>;
  requestInstitutionPhoneClaimOtp: (code: string, phone: string) => Promise<void>;
  submitInstitutionPhoneClaim: (code: string, phone: string, otp: string, walletId: string) => Promise<{ status: 'processing'; transactionHash?: string }>;
  providerLogin: ProviderWalletLoginState | null;
  completeProviderLogin: (address: string) => Promise<void>;
  cancelProviderLogin: () => void;
  navigate: (route: string) => void;
  setShellMode: (mode: WalletShellMode) => void;
  requestHostAuthentication: (purpose: HostAuthenticationPurpose) => Promise<HostAuthenticationResult>;
  requestSecureSarWalletCreation: () => Promise<SecureSarWalletCreationResult>;
  requestSecureSarVaultEnrollment: (walletId: string, secureRef: string) => Promise<SecureSarVaultEnrollmentResult>;
  requestSecureWalletImport: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  createRegistrationIntent: (request: CreateRegistrationIntentRequest) => Promise<CreateRegistrationIntentResponse>;
  createPhoneChallenge: (registrationIntentId: string) => Promise<CreatePhoneChallengeResponse>;
  verifyPhoneChallenge: (registrationIntentId: string, challengeId: string, request: VerifyPhoneChallengeRequest) => Promise<VerifyPhoneChallengeResponse>;
  requestDigitalIdentity: (action: DigitalIdentityHostAction, walletId?: string) => Promise<DigitalIdentityHostResult>;
  createThirdwebProof: (address: string, existingWalletId?: string) => Promise<{
    address: string; challenge: string; signature: string;
  }>;
  provisionWallet: (request: ProvisionWalletRequest) => Promise<ProvisionWalletResponse>;
  selectWallet: (walletId: string) => Promise<ReadyWalletHomePayload>;
  refreshWallet: (walletId: string) => Promise<ReadyWalletHomePayload>;
  invalidateWallets: (walletIds: readonly string[]) => void;
  renameWallet: (walletId: string, label: string) => Promise<WalletProfileSummary>;
  removeWallet: (walletId: string, hostAuthorizationProof: string) => Promise<WalletHomePayload>;
  prepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  quotePhoneEscrow: (request: { walletId: string; assetId: string; chainId: string; amountAtomic: string }) => Promise<import('@took-wss/contracts').PhoneEscrowQuote>;
  requestExchangeQuote: (request: RequestExchangeQuote) => Promise<ExchangeQuote>;
  prepareExchange: (request: PrepareExchangeRequest) => Promise<PreparedExchange>;
  requestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  submitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  preparePhoneRefund: (transferIntentId: string) => Promise<SecureTransactionSigningRequest>;
  submitPhoneRefund: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  listTransferActivity: (walletId: string) => Promise<TransferActivityItem[]>;
  getTransferStatus: (intentId: string) => Promise<TransferActivityItem>;
  retryPhoneNotification: (intentId: string) => Promise<import('@took-wss/contracts').PhoneNotificationResult>;
  requestRecipientPick: (mode: 'qr' | 'contacts', chainId: string) => Promise<HostRecipientPickResult>;
  submitExchange: (request: SubmitExchangeRequest) => Promise<ExchangeExecutionResult>;
  getExchangeStatus: (intentId: string) => Promise<ExchangeExecutionResult>;
};

const initialState: RuntimeState = { status: 'waiting', bootstrap: null, hostCapabilities: null, error: null };

function originsFromEnvironment(value: string | undefined, fallback: string[]): Set<string> {
  const values = value?.split(',').map((item) => item.trim()).filter(Boolean) || fallback;
  return new Set(values.map((item) => new URL(item).origin));
}

const runtimeOrigin = window.location.origin;
const allowedHostOrigins = originsFromEnvironment(import.meta.env.VITE_WSS_ALLOWED_HOST_ORIGINS, [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  runtimeOrigin,
]);
const allowedBffOrigins = originsFromEnvironment(import.meta.env.VITE_WSS_ALLOWED_BFF_ORIGINS, [
  'http://localhost:4100',
  'http://127.0.0.1:4100',
  runtimeOrigin,
]);

function referrerOrigin(): string | null {
  if (!document.referrer) {
    try {
      return window.parent !== window && window.parent.location.origin === window.location.origin
        ? window.location.origin
        : null;
    } catch {
      return null;
    }
  }
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

function postToHost(origin: string, message: WalletToHostMessage): void {
  if (window.parent !== window) window.parent.postMessage(message, origin);
}

export function useWssRuntime(): RuntimeResult {
  const [state, setState] = useState<RuntimeState>(initialState);
  const initializedToken = useRef<string | null>(null);
  const hostOrigin = useRef<string | null>(null);
  const sessionToken = useRef<string | null>(null);
  const bffBaseUrlRef = useRef<string | null>(null);
  const thirdwebClientIdRef = useRef<string | null>(null);
  const walletAdaptersRef = useRef(new Map<string, KeyAdapterId>());
  const walletHomeCacheRef = useRef(new WalletHomeCache());
  const pendingProviderLoginRef = useRef<{
    walletId: string;
    address: string;
    resolve: (result: import('thirdweb/wallets').Account | null) => void;
  } | null>(null);
  const [providerLogin, setProviderLogin] = useState<ProviderWalletLoginState | null>(null);
  const pendingAuthentication = useRef(new Map<string, {
    resolve: (result: HostAuthenticationResult) => void;
    timeout: number;
  }>());
  const pendingSessionRefresh = useRef(new Map<string, {
    resolve: (token: string | null) => void;
    timeout: number;
  }>());
  const paymentSessionRefresh = useRef<Promise<string | null> | null>(null);
  const pendingSecureImports = useRef(new Map<string, {
    resolve: (result: SecureWalletImportResult) => void;
    timeout: number;
  }>());
  const pendingSecureSarCreations = useRef(new Map<string, {
    resolve: (result: SecureSarWalletCreationResult) => void;
    timeout: number;
  }>());
  const pendingSarEnrollments = useRef(new Map<string, {
    resolve: (result: SecureSarVaultEnrollmentResult) => void;
    timeout: number;
  }>());
  const pendingTransactionSignatures = useRef(new Map<string, {
    resolve: (result: SecureTransactionSigningResult) => void;
    timeout: number;
  }>());
  const pendingRecipientPicks = useRef(new Map<string, {
    resolve: (result: HostRecipientPickResult) => void;
    timeout: number;
  }>());
  const pendingDigitalIdentity = useRef(new Map<string, {
    resolve: (result: DigitalIdentityHostResult) => void;
    timeout: number;
  }>());

  useEffect(() => {
    const parentOrigin = referrerOrigin();
    if (!parentOrigin || !allowedHostOrigins.has(parentOrigin) || window.parent === window) {
      setState({ status: 'error', bootstrap: null, hostCapabilities: null, error: '승인된 금융사 앱 WebView에서 실행해 주세요.' });
      return;
    }
    hostOrigin.current = parentOrigin;

    let cancelled = false;
    const receive = async (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.origin !== parentOrigin || !isHostToWalletMessage(event.data)) return;
      if (event.data.type === 'took-wss:digital-identity-result') {
        const pending = pendingDigitalIdentity.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingDigitalIdentity.current.delete(event.data.requestId);
        pending.resolve(event.data);
        return;
      }
      if (event.data.type === 'took-wss:session-refresh-result') {
        const pending = pendingSessionRefresh.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingSessionRefresh.current.delete(event.data.requestId);
        if (event.data.sessionToken) sessionToken.current = event.data.sessionToken;
        pending.resolve(event.data.sessionToken ?? null);
        return;
      }
      if (event.data.type === 'took-wss:host-auth-result') {
        const pending = pendingAuthentication.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingAuthentication.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (event.data.type === 'took-wss:recipient-pick-result') {
        const pending = pendingRecipientPicks.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingRecipientPicks.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (event.data.type === 'took-wss:secure-import-result') {
        const pending = pendingSecureImports.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingSecureImports.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (event.data.type === 'took-wss:secure-sar-create-result') {
        const pending = pendingSecureSarCreations.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingSecureSarCreations.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (event.data.type === 'took-wss:secure-sar-enroll-result') {
        const pending = pendingSarEnrollments.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingSarEnrollments.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (event.data.type === 'took-wss:secure-transaction-sign-result') {
        const pending = pendingTransactionSignatures.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingTransactionSignatures.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (event.data.type === 'took-wss:oauth-redirect-status') return;
      if (initializedToken.current === event.data.sessionToken) return;
      initializedToken.current = event.data.sessionToken;

      try {
        setState({ status: 'loading', bootstrap: null, hostCapabilities: null, error: null });
        const approvedBffUrl = new URL(event.data.bffUrl);
        if (!allowedBffOrigins.has(approvedBffUrl.origin)
          || approvedBffUrl.username
          || approvedBffUrl.password
          || approvedBffUrl.search
          || approvedBffUrl.hash) throw new Error('Unapproved WSS BFF URL.');
        const bffBaseUrl = approvedBffUrl.href.replace(/\/$/, '');
        const response = await fetch(`${bffBaseUrl}/v1/runtime/bootstrap`, {
          headers: { Authorization: `Bearer ${event.data.sessionToken}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Institution session bootstrap failed.');
        const bootstrap = await response.json() as WssRuntimeBootstrap;
        if (!isRecord(bootstrap)
          || bootstrap.protocolVersion !== WSS_PROTOCOL_VERSION
          || !isRecord(bootstrap.manifest)
          || !isRecord(bootstrap.session)
          || !isWssIdentityState(bootstrap.identity)
          || !isWalletHomePayload(bootstrap.walletHome)) {
          throw new Error('Unsupported WSS bootstrap contract.');
        }
        if (cancelled) return;
        sessionToken.current = event.data.sessionToken;
        bffBaseUrlRef.current = bffBaseUrl;
        thirdwebClientIdRef.current = bootstrap.publicProviders?.thirdwebClientId ?? null;
        walletAdaptersRef.current = new Map(bootstrap.walletHome.status === 'ready'
          ? bootstrap.walletHome.wallets.map((wallet) => [wallet.walletId, wallet.keyAdapter])
          : []);
        walletHomeCacheRef.current = new WalletHomeCache();
        if (bootstrap.walletHome.status === 'ready') walletHomeCacheRef.current.seed(bootstrap.walletHome);
        setState({ status: 'ready', bootstrap, hostCapabilities: event.data.hostCapabilities, error: null });
        postToHost(parentOrigin, {
          type: 'took-wss:bootstrapped',
          protocolVersion: WSS_PROTOCOL_VERSION,
          tenantId: bootstrap.manifest.tenantId,
          sessionId: bootstrap.session.sessionId,
          ...(bootstrap.identity.status === 'established' && bootstrap.identity.displayName
            ? { displayName: bootstrap.identity.displayName }
            : {}),
        });
      } catch {
        initializedToken.current = null;
        if (cancelled) return;
        setState({ status: 'error', bootstrap: null, hostCapabilities: null, error: '안전한 지갑 세션을 시작하지 못했습니다.' });
        postToHost(parentOrigin, { type: 'took-wss:error', protocolVersion: WSS_PROTOCOL_VERSION, code: 'BOOTSTRAP_FAILED' });
      }
    };

    window.addEventListener('message', receive);
    postToHost(parentOrigin, { type: 'took-wss:ready', protocolVersion: WSS_PROTOCOL_VERSION });
    return () => {
      cancelled = true;
      hostOrigin.current = null;
      sessionToken.current = null;
      bffBaseUrlRef.current = null;
      thirdwebClientIdRef.current = null;
      walletAdaptersRef.current.clear();
      pendingProviderLoginRef.current?.resolve(null);
      pendingProviderLoginRef.current = null;
      for (const pending of pendingAuthentication.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingAuthentication.current.clear();
      for (const pending of pendingSessionRefresh.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve(null);
      }
      pendingSessionRefresh.current.clear();
      for (const pending of pendingSecureImports.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingSecureImports.current.clear();
      for (const pending of pendingSecureSarCreations.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingSecureSarCreations.current.clear();
      for (const pending of pendingSarEnrollments.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingSarEnrollments.current.clear();
      for (const pending of pendingTransactionSignatures.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingTransactionSignatures.current.clear();
      for (const pending of pendingRecipientPicks.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingRecipientPicks.current.clear();
      for (const pending of pendingDigitalIdentity.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ type: 'took-wss:digital-identity-result', protocolVersion: 1,
          requestId: '', ok: false, error: 'identity_host_unavailable' });
      }
      pendingDigitalIdentity.current.clear();
      window.removeEventListener('message', receive);
    };
  }, []);

  const navigate = useCallback((route: string) => {
    if (!hostOrigin.current) return;
    postToHost(hostOrigin.current, { type: 'took-wss:navigation', protocolVersion: WSS_PROTOCOL_VERSION, route });
  }, []);

  const refreshSession = useCallback((): Promise<string | null> => {
    if (!hostOrigin.current) return Promise.resolve(null);
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingSessionRefresh.current.delete(requestId);
        resolve(null);
      }, 20_000);
      pendingSessionRefresh.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, {
        type: 'took-wss:session-refresh-request',
        protocolVersion: WSS_PROTOCOL_VERSION,
        requestId,
      });
    });
  }, []);

  const createThirdwebProof = useCallback(async (address: string, existingWalletId?: string) => {
    const clientId = thirdwebClientIdRef.current;
    if (!clientId || !sessionToken.current || !bffBaseUrlRef.current) throw new Error('thirdweb_not_configured');
    const send = (token: string) => fetch(`${bffBaseUrlRef.current}/v1/wallets/provider-challenges`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, ...(existingWalletId ? { existingWalletId } : {}) }),
      cache: 'no-store',
    });
    let response = await send(sessionToken.current);
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (!refreshed) throw new Error('wallet_session_changed');
      response = await send(refreshed);
    }
    if (!response.ok) throw new Error('thirdweb_challenge_unavailable');
    const result = await response.json() as unknown;
    if (!isRecord(result) || typeof result.challenge !== 'string' || typeof result.message !== 'string') {
      throw new Error('thirdweb_challenge_unavailable');
    }
    const { signThirdwebConnectionChallenge } = await import('./thirdwebWallet');
    const signature = await signThirdwebConnectionChallenge(clientId, address, result.message);
    return { address, challenge: result.challenge, signature };
  }, [refreshSession]);

  const setShellMode = useCallback((mode: WalletShellMode) => {
    if (!hostOrigin.current) return;
    postToHost(hostOrigin.current, { type: 'took-wss:shell-change', protocolVersion: WSS_PROTOCOL_VERSION, mode });
  }, []);

  const requestHostAuthentication = useCallback((purpose: HostAuthenticationPurpose): Promise<HostAuthenticationResult> => {
    if (!hostOrigin.current) return Promise.resolve({ status: 'cancelled' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingAuthentication.current.delete(requestId);
        resolve({ status: 'cancelled' });
      }, 120_000);
      pendingAuthentication.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, {
        type: 'took-wss:host-auth-request',
        protocolVersion: WSS_PROTOCOL_VERSION,
        requestId,
        purpose,
      });
    });
  }, []);

  const requestDigitalIdentity = useCallback((action: DigitalIdentityHostAction, walletId?: string): Promise<DigitalIdentityHostResult> => {
    if (!hostOrigin.current) return Promise.reject(new Error('identity_host_unavailable'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingDigitalIdentity.current.delete(requestId);
        resolve({ type: 'took-wss:digital-identity-result', protocolVersion: 1, requestId,
          ok: false, error: 'identity_request_timeout' });
      }, 120_000);
      pendingDigitalIdentity.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, { type: 'took-wss:digital-identity-request', protocolVersion: 1,
        requestId, action, ...(walletId ? { walletId } : {}) });
    });
  }, []);

  const verifyProviderConnection = useCallback(async (
    walletId: string,
    address: string,
  ): Promise<boolean> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) return false;
    const send = async (token: string) => {
      const proof = await createThirdwebProof(address, walletId);
      return fetch(`${bffBaseUrlRef.current}/v1/wallets/${encodeURIComponent(walletId)}/provider-verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken.current ?? token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
        cache: 'no-store',
      });
    };
    try {
      let response = await send(sessionToken.current);
      if (response.status === 401) {
        const refreshed = await refreshSession();
        if (!refreshed) return false;
        response = await send(refreshed);
      }
      if (!response.ok) return false;
      const body = await response.json().catch(() => null) as unknown;
      return isRecord(body) && body.verified === true
        && typeof body.address === 'string' && body.address.toLowerCase() === address.toLowerCase();
    } catch {
      return false;
    }
  }, [createThirdwebProof, refreshSession]);

  const cancelProviderLogin = useCallback(() => {
    pendingProviderLoginRef.current?.resolve(null);
    pendingProviderLoginRef.current = null;
    setProviderLogin(null);
  }, []);

  const completeProviderLogin = useCallback(async (address: string) => {
    const pending = pendingProviderLoginRef.current;
    const clientId = thirdwebClientIdRef.current;
    if (!pending || !clientId) return;
    setProviderLogin((current) => current ? { ...current, busy: true, error: null } : null);
    try {
      if (address.toLowerCase() !== pending.address.toLowerCase()
        || !(await verifyProviderConnection(pending.walletId, address))) {
        throw new Error('provider_wallet_link_conflict');
      }
      const { connectedThirdwebAccount } = await import('./thirdwebWallet');
      const account = await connectedThirdwebAccount(clientId);
      if (!account || account.address.toLowerCase() !== pending.address.toLowerCase()) {
        throw new Error('thirdweb_auth_failed');
      }
      pendingProviderLoginRef.current = null;
      setProviderLogin(null);
      pending.resolve(account);
    } catch {
      setProviderLogin((current) => current ? {
        ...current, busy: false,
        error: '이 지갑을 만들 때 사용한 계정을 확인하지 못했어요. 다시 연결해 주세요.',
      } : null);
    }
  }, [verifyProviderConnection]);

  const ensureProviderConnection = useCallback(async (walletId: string, address: string) => {
    const clientId = thirdwebClientIdRef.current;
    if (!clientId) return null;
    const { connectedThirdwebAccount } = await import('./thirdwebWallet');
    const current = await connectedThirdwebAccount(clientId).catch(() => null);
    if (current?.address.toLowerCase() === address.toLowerCase()
      && await verifyProviderConnection(walletId, address)) return current;
    if (pendingProviderLoginRef.current) return null;
    return new Promise<import('thirdweb/wallets').Account | null>((resolve) => {
      pendingProviderLoginRef.current = { walletId, address, resolve };
      setProviderLogin({ walletId, busy: false, error: null });
    });
  }, [verifyProviderConnection]);

  const provisionWallet = useCallback(async (request: ProvisionWalletRequest): Promise<ProvisionWalletResponse> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/wallets/provision`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken.current}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as unknown;
      const code = isRecord(body) && typeof body.error === 'string' ? body.error : 'request_rejected';
      throw new Error(code);
    }
    const result = await response.json() as ProvisionWalletResponse;
    if (!isRecord(result)
      || (result.mode !== 'sandbox-contract-only' && result.mode !== 'development-key-core'
        && result.mode !== 'development-provider' && result.mode !== 'live')
      || !isWalletHomePayload(result.walletHome)
      || result.walletHome.status !== 'ready') {
      throw new Error('Unsupported wallet provisioning response.');
    }
    walletAdaptersRef.current = new Map(result.walletHome.wallets.map((wallet) => [wallet.walletId, wallet.keyAdapter]));
    walletHomeCacheRef.current.invalidate(result.walletHome.wallets.map((wallet) => wallet.walletId));
    walletHomeCacheRef.current.seed(result.walletHome);
    return result;
  }, []);

  const requestSecureWalletImport = useCallback((method: WalletImportMethod): Promise<SecureWalletImportResult> => {
    if (!hostOrigin.current) return Promise.resolve({ status: 'cancelled' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingSecureImports.current.delete(requestId);
        resolve({ status: 'cancelled' });
      }, 60_000);
      pendingSecureImports.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, {
        type: 'took-wss:secure-import-request',
        protocolVersion: WSS_PROTOCOL_VERSION,
        requestId,
        method,
      });
    });
  }, []);

  const requestSecureSarWalletCreation = useCallback((): Promise<SecureSarWalletCreationResult> => {
    if (!hostOrigin.current) return Promise.resolve({ status: 'cancelled' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingSecureSarCreations.current.delete(requestId);
        resolve({ status: 'cancelled' });
      }, 600_000);
      pendingSecureSarCreations.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, {
        type: 'took-wss:secure-sar-create-request',
        protocolVersion: WSS_PROTOCOL_VERSION,
        requestId,
      });
    });
  }, []);

  const requestSecureSarVaultEnrollment = useCallback((walletId: string, secureRef: string): Promise<SecureSarVaultEnrollmentResult> => {
    if (!hostOrigin.current) return Promise.resolve({ status: 'cancelled' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingSarEnrollments.current.delete(requestId);
        resolve({ status: 'cancelled' });
      }, 600_000);
      pendingSarEnrollments.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, {
        type: 'took-wss:secure-sar-enroll-request',
        protocolVersion: WSS_PROTOCOL_VERSION,
        requestId,
        walletId,
        secureRef,
      });
    });
  }, []);

  const loadWallet = useCallback((walletId: string, refresh: boolean): Promise<ReadyWalletHomePayload> => {
    const token = sessionToken.current;
    const baseUrl = bffBaseUrlRef.current;
    if (!token || !baseUrl) return Promise.reject(new Error('Wallet session is not ready.'));
    const cache = walletHomeCacheRef.current;
    return cache.load(walletId, async () => {
      const response = await fetch(`${baseUrl}/v1/wallets/${encodeURIComponent(walletId)}/home`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (!response.ok) throw new Error('Wallet selection was rejected.');
      const result = await response.json() as ReadyWalletHomePayload;
      if (sessionToken.current !== token || walletHomeCacheRef.current !== cache) throw new Error('Wallet session changed during selection.');
      if (!isWalletHomePayload(result) || result.status !== 'ready') throw new Error('Unsupported selected wallet response.');
      walletAdaptersRef.current = new Map(result.wallets.map((wallet) => [wallet.walletId, wallet.keyAdapter]));
      return result;
    }, refresh);
  }, []);
  const selectWallet = useCallback((walletId: string) => loadWallet(walletId, false), [loadWallet]);
  const refreshWallet = useCallback((walletId: string) => loadWallet(walletId, true), [loadWallet]);
  const invalidateWallets = useCallback((walletIds: readonly string[]) => walletHomeCacheRef.current.invalidate(walletIds), []);

  const renameWallet = useCallback(async (walletId: string, label: string): Promise<WalletProfileSummary> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('wallet_session_unavailable');
    const send = (token: string) => fetch(`${bffBaseUrlRef.current}/v1/wallets/${encodeURIComponent(walletId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
      cache: 'no-store',
    });
    let response = await send(sessionToken.current);
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (!refreshed) throw new Error('session_refresh_unavailable');
      response = await send(refreshed);
    }
    const result = await response.json() as unknown;
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : 'wallet_rename_failed');
    if (!isRecord(result) || result.walletId !== walletId || typeof result.label !== 'string'
      || (result.keyAdapter !== 'took-sar' && result.keyAdapter !== 'fsl-mpc' && result.keyAdapter !== 'thirdweb-user-wallet')
      || (result.origin !== 'created' && result.origin !== 'imported')) throw new Error('wallet_rename_response_invalid');
    walletHomeCacheRef.current.rename(result as unknown as WalletProfileSummary);
    return result as unknown as WalletProfileSummary;
  }, [refreshSession]);

  const removeWallet = useCallback(async (walletId: string, hostAuthorizationProof: string): Promise<WalletHomePayload> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('wallet_session_unavailable');
    const send = (token: string) => fetch(`${bffBaseUrlRef.current}/v1/wallets/${encodeURIComponent(walletId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostAuthorizationProof }),
      cache: 'no-store',
    });
    let response = await send(sessionToken.current);
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (!refreshed) throw new Error('session_refresh_unavailable');
      response = await send(refreshed);
    }
    const result = await response.json() as unknown;
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : 'wallet_removal_failed');
    if (!isWalletHomePayload(result)) throw new Error('wallet_removal_response_invalid');
    walletHomeCacheRef.current = new WalletHomeCache();
    if (result.status === 'ready') walletHomeCacheRef.current.seed(result);
    if (/^[0-9a-f-]{36}$/i.test(walletId) && hostOrigin.current) postToHost(hostOrigin.current, {
      type: 'took-wss:wallet-removed', protocolVersion: WSS_PROTOCOL_VERSION, walletId,
    });
    return result;
  }, [refreshSession]);

  const prepareTransferRequest = useCallback(async (request: PrepareTransferRequest): Promise<PreparedTransfer> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const send = (token: string) => fetch(`${bffBaseUrlRef.current}/v1/transfers/prepare`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    let response = await send(sessionToken.current);
    if (response.status === 401) {
      const refreshedToken = await refreshSession();
      if (!refreshedToken) throw new Error('session_refresh_unavailable');
      response = await send(refreshedToken);
    }
    if (!response.ok) {
      const rejected = await response.json().catch(() => null) as unknown;
      const code = isRecord(rejected) && typeof rejected.error === 'string'
        ? rejected.error
        : 'transfer_preparation_unavailable';
      throw new Error(code);
    }
    const result = await response.json() as PreparedTransfer;
    if (!isRecord(result)
      || typeof result.intentId !== 'string'
      || typeof result.walletId !== 'string'
      || typeof result.expiresAt !== 'string'
      || !isRecord(result.compliance)
      || !isRecord(result.gasSponsorship)) {
      throw new Error('Unsupported transfer preparation response.');
    }
    return result;
  }, [refreshSession]);

  const requestExchangeQuote = useCallback(async (request: RequestExchangeQuote): Promise<ExchangeQuote> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/exchanges/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) {
      const rejected = await response.json().catch(() => null) as unknown;
      const code = isRecord(rejected) && typeof rejected.error === 'string'
        ? rejected.error
        : 'exchange_quote_unavailable';
      throw new Error(code);
    }
    const result = await response.json() as ExchangeQuote;
    if (!isRecord(result)
      || typeof result.quoteId !== 'string'
      || (result.mode !== 'exact-in' && result.mode !== 'exact-out')
      || !isRecord(result.sell)
      || !isRecord(result.buy)
      || typeof result.expiresAt !== 'string') {
      throw new Error('Unsupported exchange quote response.');
    }
    return result;
  }, []);

  const prepareExchange = useCallback(async (request: PrepareExchangeRequest): Promise<PreparedExchange> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/exchanges/prepare`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Exchange preparation was rejected.');
    const result = await response.json() as PreparedExchange;
    if (!isRecord(result)
      || typeof result.intentId !== 'string'
      || typeof result.quoteId !== 'string'
      || !isRecord(result.signingRequest)) {
      throw new Error('Unsupported exchange preparation response.');
    }
    return result;
  }, []);

  const requestSecureTransactionSignature = useCallback(async (request: SecureTransactionSigningRequest): Promise<SecureTransactionSigningResult> => {
    if (!hostOrigin.current) return { status: 'cancelled' };
    if (walletAdaptersRef.current.get(request.walletId) !== 'thirdweb-user-wallet') {
      const requestId = crypto.randomUUID();
      return new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          pendingTransactionSignatures.current.delete(requestId);
          resolve({ status: 'cancelled' });
        }, 180_000);
        pendingTransactionSignatures.current.set(requestId, { resolve, timeout });
        postToHost(hostOrigin.current!, {
          type: 'took-wss:secure-transaction-sign-request',
          protocolVersion: WSS_PROTOCOL_VERSION,
          requestId,
          request,
        });
      });
    }
    if (!sessionToken.current || !bffBaseUrlRef.current || !isSecureTransactionSigningRequest(request)
      || !/^0x[0-9a-fA-F]{40}$/.test(request.fromAddress)) return { status: 'cancelled' };
    const approvalPath = request.operation === 'exchange' ? 'exchanges' : request.operation === 'refund' ? 'refunds' : 'transfers';
    const verifyApproval = async () => {
      if (!sessionToken.current || !bffBaseUrlRef.current) return false;
      const send = (token: string) => fetch(`${bffBaseUrlRef.current}/v1/${approvalPath}/${encodeURIComponent(request.intentId)}/approval-payload`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      let response = await send(sessionToken.current);
      if (response.status === 401) {
        const refreshed = await refreshSession();
        if (!refreshed) return false;
        response = await send(refreshed);
      }
      if (!response.ok) return false;
      return transactionSigningRequestMatches(await response.json(), request);
    };
    if (!(await verifyApproval())) return { status: 'cancelled' };
    const connected = await ensureProviderConnection(request.walletId, request.fromAddress);
    if (!connected || !(await verifyApproval())) return { status: 'cancelled' };
    const authorization = await requestHostAuthentication(request.operation === 'exchange' ? 'exchange-approval' : 'transfer-approval');
    if (authorization.status !== 'authenticated') return { status: 'cancelled' };
    const account = connected;
    if (account.address.toLowerCase() !== request.fromAddress.toLowerCase()) return { status: 'cancelled' };
    const { signThirdwebEvmTransaction, signThirdwebRelayAuthorization, signThirdwebUsdcPermit } = await import('./thirdwebWallet');
    const transaction = request.transaction;
    let signedTransaction: string;
    if (transaction.type === 'evm-native' || transaction.type === 'evm-erc20') {
      signedTransaction = await signThirdwebEvmTransaction(account, transaction);
    } else if (transaction.type === 'evm-batch') {
      const signed: string[] = [];
      for (const item of transaction.transactions) signed.push(await signThirdwebEvmTransaction(account, item));
      signedTransaction = JSON.stringify(signed);
    } else if (transaction.type === 'evm-permit-relay') {
      const walletAuthSignature = await signThirdwebRelayAuthorization(account, transaction.transfer);
      if (!sessionToken.current || !bffBaseUrlRef.current) return { status: 'cancelled' };
      const relayResponse = await fetch(`${bffBaseUrlRef.current}/v1/transfers/${encodeURIComponent(request.intentId)}/relay-prepare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAuthSignature }), cache: 'no-store',
      });
      if (!relayResponse.ok) return { status: 'cancelled' };
      const relay = await relayResponse.json() as {
        transferId?: string; chainId?: number; tokenAddress?: string; recipient?: string; spender?: string;
        totalAmount?: string; fee?: string; recipientReceives?: string; nonce?: string; deadline?: number;
        domain?: { name?: string; version?: string; chainId?: number; verifyingContract?: string };
      };
      if (relay.transferId !== transaction.transfer.id
        || relay.chainId !== transaction.transfer.chainId
        || relay.tokenAddress?.toLowerCase() !== transaction.transfer.tokenAddress.toLowerCase()
        || relay.recipient?.toLowerCase() !== transaction.transfer.recipient.toLowerCase()
        || relay.spender?.toLowerCase() !== transaction.router.toLowerCase()
        || relay.totalAmount !== transaction.totalAmountDisplay
        || relay.fee !== transaction.feeAmountDisplay
        || relay.recipientReceives !== transaction.transfer.tokenAmount
        || relay.domain?.chainId !== transaction.transfer.chainId
        || relay.domain.verifyingContract?.toLowerCase() !== transaction.transfer.tokenAddress.toLowerCase()
        || relay.domain.name !== 'USD Coin' || relay.domain.version !== '2'
        || typeof relay.nonce !== 'string' || !/^\d+$/.test(relay.nonce)
        || !Number.isSafeInteger(relay.deadline)
        || relay.deadline !== Math.floor(Date.parse(transaction.transfer.expiresAt) / 1000)) return { status: 'cancelled' };
      const permitSignature = await signThirdwebUsdcPermit(account, {
        domain: { name: relay.domain.name, version: relay.domain.version,
          chainId: relay.domain.chainId, verifyingContract: relay.domain.verifyingContract },
        spender: relay.spender,
        value: transaction.totalAmountAtomic,
        nonce: relay.nonce,
        deadline: relay.deadline,
      });
      signedTransaction = JSON.stringify({ walletAuthSignature, permitSignature });
    } else {
      return { status: 'cancelled' };
    }
    if (!await verifyApproval()) return { status: 'cancelled' };
    return {
      status: 'completed', intentId: request.intentId,
      signedTransaction, hostAuthorizationProof: authorization.proof,
    };
  }, [ensureProviderConnection, refreshSession, requestHostAuthentication]);

  const requestRecipientPick = useCallback((mode: 'qr' | 'contacts', chainId: string): Promise<HostRecipientPickResult> => {
    if (!hostOrigin.current) return Promise.resolve({ status: 'cancelled' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingRecipientPicks.current.delete(requestId);
        resolve({ status: 'cancelled' });
      }, 120_000);
      pendingRecipientPicks.current.set(requestId, { resolve, timeout });
      postToHost(hostOrigin.current!, {
        type: 'took-wss:recipient-pick-request', protocolVersion: WSS_PROTOCOL_VERSION,
        requestId, mode, chainId,
      });
    });
  }, []);

  const submitTransferRequest = useCallback(async (request: SubmitTransferRequest): Promise<TransferExecutionResult> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/transfers/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Transfer submission was rejected.');
    const result = await response.json() as TransferExecutionResult;
    if (!isRecord(result)
      || typeof result.intentId !== 'string'
      || (result.status !== 'processing' && result.status !== 'submitted' && result.status !== 'confirmed' && result.status !== 'failed')
      || (result.transactionHash !== undefined && typeof result.transactionHash !== 'string')) {
      throw new Error('Unsupported transfer result.');
    }
    return result;
  }, []);

  const listTransferActivity = useCallback(async (walletId: string): Promise<TransferActivityItem[]> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/wallets/${encodeURIComponent(walletId)}/activity`, {
      headers: { Authorization: `Bearer ${sessionToken.current}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('Transfer activity is unavailable.');
    const result = await response.json() as unknown;
    if (!Array.isArray(result)) throw new Error('Unsupported transfer activity response.');
    return result as TransferActivityItem[];
  }, []);

  const paymentRequest = useCallback(async (path: string, input?: Record<string, string>): Promise<unknown> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const send = (token: string) => fetch(`${bffBaseUrlRef.current}${path}`, {
      method: input ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}), cache: 'no-store',
    });
    let response = await send(sessionToken.current);
    if (response.status === 401) {
      const pending = paymentSessionRefresh.current ?? refreshSession();
      paymentSessionRefresh.current = pending;
      let refreshed: string | null;
      try { refreshed = await pending; }
      finally { if (paymentSessionRefresh.current === pending) paymentSessionRefresh.current = null; }
      if (!refreshed) throw new Error('session_refresh_unavailable');
      response = await send(refreshed);
    }
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : 'payment_unavailable');
    return result;
  }, [refreshSession]);

  const createPaymentRequest = useCallback(async (input: { walletId: string; chainId: string; assetId: string; amountAtomic: string }): Promise<WalletPaymentRequest> => {
    const result = await paymentRequest('/v1/payments/requests', input);
    if (!isRecord(result) || typeof result.id !== 'string' || result.amountAtomic !== input.amountAtomic) throw new Error('payment_response_invalid');
    return result as unknown as WalletPaymentRequest;
  }, [paymentRequest]);
  const getPaymentRequest = useCallback(async (id: string): Promise<WalletPaymentRequest> => {
    const result = await paymentRequest(`/v1/payments/requests/${encodeURIComponent(id)}`);
    if (!isRecord(result) || result.id !== id || typeof result.status !== 'string') throw new Error('payment_response_invalid');
    return result as unknown as WalletPaymentRequest;
  }, [paymentRequest]);
  const listPaymentRequests = useCallback(async (walletId: string): Promise<WalletPaymentRequest[]> => {
    const result = await paymentRequest(`/v1/wallets/${encodeURIComponent(walletId)}/payments`);
    if (!Array.isArray(result)) throw new Error('payment_response_invalid');
    return result as WalletPaymentRequest[];
  }, [paymentRequest]);
  const listSpentPayments = useCallback(async (walletId: string): Promise<WalletPaymentRequest[]> => {
    const result = await paymentRequest(`/v1/wallets/${encodeURIComponent(walletId)}/payments/spent`);
    if (!Array.isArray(result)) throw new Error('payment_response_invalid');
    return result as WalletPaymentRequest[];
  }, [paymentRequest]);

  const getTransferStatus = useCallback(async (intentId: string): Promise<TransferActivityItem> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/transfers/${encodeURIComponent(intentId)}/status`, {
      headers: { Authorization: `Bearer ${sessionToken.current}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('Transfer status is unavailable.');
    const result = await response.json() as TransferActivityItem;
    if (!isRecord(result) || result.intentId !== intentId || typeof result.status !== 'string') {
      throw new Error('Unsupported transfer status response.');
    }
    return result;
  }, []);

  const retryPhoneNotification = useCallback(async (intentId: string): Promise<import('@took-wss/contracts').PhoneNotificationResult> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/phone-escrows/${encodeURIComponent(intentId)}/notify`, {
      method: 'POST', headers: { Authorization: `Bearer ${sessionToken.current}` }, cache: 'no-store',
    });
    const result = await response.json() as { error?: string; status?: string; recipientDisplay?: string; claimUrl?: string };
    if (!response.ok) throw new Error(result.error ?? 'phone_escrow_notification_unavailable');
    if ((result.status !== 'pending' && result.status !== 'sent' && result.status !== 'failed')
      || typeof result.recipientDisplay !== 'string'
      || (result.claimUrl !== undefined && !/^https:\/\//.test(result.claimUrl))) {
      throw new Error('Unsupported phone notification result.');
    }
    return result as import('@took-wss/contracts').PhoneNotificationResult;
  }, []);

  const quotePhoneEscrow = useCallback(async (request: { walletId: string; assetId: string; chainId: string; amountAtomic: string }): Promise<import('@took-wss/contracts').PhoneEscrowQuote> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/phone-escrows/quote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), cache: 'no-store',
    });
    const result = await response.json() as { error?: string; recipientAmountAtomic?: string; escrowAmountAtomic?: string; claimFeeAtomic?: string; maximumRecipientAtomic?: string };
    if (!response.ok) throw new Error(result.error ?? 'phone_escrow_quote_unavailable');
    if (result.recipientAmountAtomic !== request.amountAtomic
      || !/^\d+$/.test(result.escrowAmountAtomic ?? '')
      || !/^\d+$/.test(result.claimFeeAtomic ?? '')
      || !/^\d+$/.test(result.maximumRecipientAtomic ?? '')) throw new Error('Unsupported phone escrow quote.');
    return result as import('@took-wss/contracts').PhoneEscrowQuote;
  }, []);

  const preparePhoneRefund = useCallback(async (transferIntentId: string): Promise<SecureTransactionSigningRequest> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/phone-escrows/${encodeURIComponent(transferIntentId)}/refund/prepare`, {
      method: 'POST', headers: { Authorization: `Bearer ${sessionToken.current}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('Refund preparation is unavailable.');
    const result = await response.json() as SecureTransactionSigningRequest;
    if (!isSecureTransactionSigningRequest(result) || result.operation !== 'refund'
      || result.transaction.type !== 'evm-native') {
      throw new Error('Unsupported refund preparation.');
    }
    return result;
  }, []);

  const submitPhoneRefund = useCallback(async (request: SubmitTransferRequest): Promise<TransferExecutionResult> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/refunds/${encodeURIComponent(request.intentId)}/submit`, {
      method: 'POST', headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), cache: 'no-store',
    });
    if (!response.ok) throw new Error('Refund submission is unavailable.');
    const result = await response.json() as TransferExecutionResult;
    if (!isRecord(result) || result.intentId !== request.intentId
      || (result.status !== 'processing' && result.status !== 'confirmed')) throw new Error('Unsupported refund result.');
    return result;
  }, []);

  const submitExchange = useCallback(async (request: SubmitExchangeRequest): Promise<ExchangeExecutionResult> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/exchanges/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Exchange submission was rejected.');
    const result = await response.json() as ExchangeExecutionResult;
    if (!isRecord(result)
      || typeof result.intentId !== 'string'
      || result.status !== 'submitted'
      || typeof result.transactionHash !== 'string') {
      throw new Error('Unsupported exchange result.');
    }
    return result;
  }, []);

  const getExchangeStatus = useCallback(async (intentId: string): Promise<ExchangeExecutionResult> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/exchanges/${encodeURIComponent(intentId)}/status`, {
      headers: { Authorization: `Bearer ${sessionToken.current}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('Exchange status is unavailable.');
    const result = await response.json() as ExchangeExecutionResult;
    if (!isRecord(result) || result.intentId !== intentId
      || !['processing', 'submitted', 'confirmed', 'failed'].includes(result.status)
      || typeof result.transactionHash !== 'string') throw new Error('Unsupported exchange status.');
    return result;
  }, []);

  const createRegistrationIntent = useCallback(async (request: CreateRegistrationIntentRequest): Promise<CreateRegistrationIntentResponse> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/registration/intents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Registration intent was rejected.');
    const result = await response.json() as CreateRegistrationIntentResponse;
    if (!isRecord(result) || typeof result.registrationIntentId !== 'string' || typeof result.expiresAt !== 'string') {
      throw new Error('Unsupported registration intent response.');
    }
    return result;
  }, []);

  const createPhoneChallenge = useCallback(async (registrationIntentId: string): Promise<CreatePhoneChallengeResponse> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/registration/intents/${encodeURIComponent(registrationIntentId)}/challenges`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Phone challenge was rejected.');
    const result = await response.json() as CreatePhoneChallengeResponse;
    if (!isRecord(result)
      || typeof result.challengeId !== 'string'
      || typeof result.expiresAt !== 'string'
      || result.delivery !== 'sms'
      || (result.developmentCode !== undefined && typeof result.developmentCode !== 'string')) {
      throw new Error('Unsupported phone challenge response.');
    }
    return result;
  }, []);

  const verifyPhoneChallenge = useCallback(async (
    registrationIntentId: string,
    challengeId: string,
    request: VerifyPhoneChallengeRequest,
  ): Promise<VerifyPhoneChallengeResponse> => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/registration/intents/${encodeURIComponent(registrationIntentId)}/challenges/${encodeURIComponent(challengeId)}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as unknown;
      throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : 'phone_verification_failed');
    }
    const result = await response.json() as VerifyPhoneChallengeResponse;
    if (!isRecord(result) || !isWssIdentityState(result.identity) || result.identity.status !== 'established') {
      throw new Error('Unsupported phone verification response.');
    }
    setState((current) => current.status === 'ready'
      ? { ...current, bootstrap: { ...current.bootstrap, identity: result.identity } }
      : current);
    if (result.identity.displayName && hostOrigin.current) {
      postToHost(hostOrigin.current, {
        type: 'took-wss:identity-established',
        protocolVersion: WSS_PROTOCOL_VERSION,
        displayName: result.identity.displayName,
      });
    }
    return result;
  }, []);

  const claimRequest = useCallback(async (code: string, action: '' | '/institution-otp' | '/institution-submit', body?: object) => {
    if (!sessionToken.current || !bffBaseUrlRef.current) throw new Error('wallet_session_unavailable');
    const response = await fetch(`${bffBaseUrlRef.current}/v1/claims/${encodeURIComponent(code)}${action}`, {
      ...(body ? { method: 'POST', headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { headers: { Authorization: `Bearer ${sessionToken.current}` } }),
      cache: 'no-store',
    });
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : 'claim_service_unavailable');
    if (!isRecord(result)) throw new Error('claim_service_unavailable');
    return result;
  }, []);

  const getPhoneClaimInfo = useCallback(async (code: string): Promise<PhoneClaimInfo> => {
    const result = await claimRequest(code, '');
    if (typeof result.status !== 'string' || typeof result.network !== 'string'
      || typeof result.assetSymbol !== 'string' || typeof result.amountDisplay !== 'string'
      || typeof result.expiresAt !== 'string') throw new Error('claim_service_unavailable');
    return result as unknown as PhoneClaimInfo;
  }, [claimRequest]);

  const requestInstitutionPhoneClaimOtp = useCallback(async (code: string, phone: string): Promise<void> => {
    await claimRequest(code, '/institution-otp', { phone });
  }, [claimRequest]);

  const submitInstitutionPhoneClaim = useCallback(async (code: string, phone: string, otp: string, walletId: string) => {
    const result = await claimRequest(code, '/institution-submit', { phone, otp, walletId });
    if (result.status !== 'processing') throw new Error('claim_service_unavailable');
    return result as { status: 'processing'; transactionHash?: string };
  }, [claimRequest]);

  return {
    ...state,
    createPaymentRequest,
    getPaymentRequest,
    listPaymentRequests,
    listSpentPayments,
    getPhoneClaimInfo,
    requestInstitutionPhoneClaimOtp,
    submitInstitutionPhoneClaim,
    providerLogin,
    completeProviderLogin,
    cancelProviderLogin,
    navigate,
    setShellMode,
    requestHostAuthentication,
    requestSecureSarWalletCreation,
    requestSecureSarVaultEnrollment,
    requestSecureWalletImport,
    createRegistrationIntent,
    createPhoneChallenge,
    verifyPhoneChallenge,
    requestDigitalIdentity,
    createThirdwebProof,
    provisionWallet,
    selectWallet,
    refreshWallet,
    invalidateWallets,
    renameWallet,
    removeWallet,
    prepareTransfer: prepareTransferRequest,
    quotePhoneEscrow,
    requestExchangeQuote,
    prepareExchange,
    requestSecureTransactionSignature,
    requestRecipientPick,
    submitTransfer: submitTransferRequest,
    listTransferActivity,
    getTransferStatus,
    retryPhoneNotification,
    preparePhoneRefund,
    submitPhoneRefund,
    submitExchange,
    getExchangeStatus,
  };
}
