import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WSS_PROTOCOL_VERSION,
  isHostToWalletMessage,
  isRecord,
  isWssIdentityState,
  isWalletHomePayload,
  type HostCapabilities,
  type CreatePhoneChallengeResponse,
  type CreateRegistrationIntentRequest,
  type CreateRegistrationIntentResponse,
  type HostAuthenticationPurpose,
  type HostAuthenticationResult,
  type PrepareTransferRequest,
  type PreparedTransfer,
  type ProvisionWalletRequest,
  type ProvisionWalletResponse,
  type ReadyWalletHomePayload,
  type SecureSarWalletCreationResult,
  type SecureTransactionSigningRequest,
  type SecureTransactionSigningResult,
  type SecureWalletImportResult,
  type WalletImportMethod,
  type WalletShellMode,
  type SubmitTransferRequest,
  type TransferExecutionResult,
  type WalletToHostMessage,
  type WssRuntimeBootstrap,
  type VerifyPhoneChallengeRequest,
  type VerifyPhoneChallengeResponse,
} from '@took-wss/contracts';

type RuntimeState =
  | { status: 'waiting' | 'loading'; bootstrap: null; hostCapabilities: null; error: null }
  | { status: 'ready'; bootstrap: WssRuntimeBootstrap; hostCapabilities: HostCapabilities; error: null }
  | { status: 'error'; bootstrap: null; hostCapabilities: null; error: string };

type RuntimeResult = RuntimeState & {
  navigate: (route: string) => void;
  setShellMode: (mode: WalletShellMode) => void;
  requestHostAuthentication: (purpose: HostAuthenticationPurpose) => Promise<HostAuthenticationResult>;
  requestSecureSarWalletCreation: () => Promise<SecureSarWalletCreationResult>;
  requestSecureWalletImport: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  createRegistrationIntent: (request: CreateRegistrationIntentRequest) => Promise<CreateRegistrationIntentResponse>;
  createPhoneChallenge: (registrationIntentId: string) => Promise<CreatePhoneChallengeResponse>;
  verifyPhoneChallenge: (registrationIntentId: string, challengeId: string, request: VerifyPhoneChallengeRequest) => Promise<VerifyPhoneChallengeResponse>;
  provisionWallet: (request: ProvisionWalletRequest) => Promise<ProvisionWalletResponse>;
  selectWallet: (walletId: string) => Promise<ReadyWalletHomePayload>;
  prepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  requestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  submitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
};

const initialState: RuntimeState = { status: 'waiting', bootstrap: null, hostCapabilities: null, error: null };

function originsFromEnvironment(value: string | undefined, fallback: string[]): Set<string> {
  const values = value?.split(',').map((item) => item.trim()).filter(Boolean) || fallback;
  return new Set(values.map((item) => new URL(item).origin));
}

const allowedHostOrigins = originsFromEnvironment(import.meta.env.VITE_WSS_ALLOWED_HOST_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173']);
const allowedBffOrigins = originsFromEnvironment(import.meta.env.VITE_WSS_ALLOWED_BFF_ORIGINS, ['http://localhost:4100', 'http://127.0.0.1:4100']);

function referrerOrigin(): string | null {
  if (!document.referrer) return null;
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
  const bffOriginRef = useRef<string | null>(null);
  const pendingAuthentication = useRef(new Map<string, {
    resolve: (result: HostAuthenticationResult) => void;
    timeout: number;
  }>());
  const pendingSecureImports = useRef(new Map<string, {
    resolve: (result: SecureWalletImportResult) => void;
    timeout: number;
  }>());
  const pendingSecureSarCreations = useRef(new Map<string, {
    resolve: (result: SecureSarWalletCreationResult) => void;
    timeout: number;
  }>());
  const pendingTransactionSignatures = useRef(new Map<string, {
    resolve: (result: SecureTransactionSigningResult) => void;
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
      if (event.data.type === 'took-wss:host-auth-result') {
        const pending = pendingAuthentication.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingAuthentication.current.delete(event.data.requestId);
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
      if (event.data.type === 'took-wss:secure-transaction-sign-result') {
        const pending = pendingTransactionSignatures.current.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingTransactionSignatures.current.delete(event.data.requestId);
        pending.resolve(event.data.result);
        return;
      }
      if (initializedToken.current === event.data.sessionToken) return;
      initializedToken.current = event.data.sessionToken;

      try {
        setState({ status: 'loading', bootstrap: null, hostCapabilities: null, error: null });
        const approvedBffOrigin = new URL(event.data.bffUrl).origin;
        if (!allowedBffOrigins.has(approvedBffOrigin)) throw new Error('Unapproved WSS BFF origin.');
        const response = await fetch(`${approvedBffOrigin}/v1/runtime/bootstrap`, {
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
        bffOriginRef.current = approvedBffOrigin;
        setState({ status: 'ready', bootstrap, hostCapabilities: event.data.hostCapabilities, error: null });
        postToHost(parentOrigin, {
          type: 'took-wss:bootstrapped',
          protocolVersion: WSS_PROTOCOL_VERSION,
          tenantId: bootstrap.manifest.tenantId,
          sessionId: bootstrap.session.sessionId,
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
      bffOriginRef.current = null;
      for (const pending of pendingAuthentication.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingAuthentication.current.clear();
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
      for (const pending of pendingTransactionSignatures.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve({ status: 'cancelled' });
      }
      pendingTransactionSignatures.current.clear();
      window.removeEventListener('message', receive);
    };
  }, []);

  const navigate = useCallback((route: string) => {
    if (!hostOrigin.current) return;
    postToHost(hostOrigin.current, { type: 'took-wss:navigation', protocolVersion: WSS_PROTOCOL_VERSION, route });
  }, []);

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

  const provisionWallet = useCallback(async (request: ProvisionWalletRequest): Promise<ProvisionWalletResponse> => {
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/wallets/provision`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken.current}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Wallet provisioning was rejected.');
    const result = await response.json() as ProvisionWalletResponse;
    if (!isRecord(result)
      || (result.mode !== 'sandbox-contract-only' && result.mode !== 'development-key-core' && result.mode !== 'live')
      || !isWalletHomePayload(result.walletHome)
      || result.walletHome.status !== 'ready') {
      throw new Error('Unsupported wallet provisioning response.');
    }
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

  const selectWallet = useCallback(async (walletId: string): Promise<ReadyWalletHomePayload> => {
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/wallets/${encodeURIComponent(walletId)}/home`, {
      headers: { Authorization: `Bearer ${sessionToken.current}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Wallet selection was rejected.');
    const result = await response.json() as ReadyWalletHomePayload;
    if (!isWalletHomePayload(result) || result.status !== 'ready') throw new Error('Unsupported selected wallet response.');
    return result;
  }, []);

  const prepareTransferRequest = useCallback(async (request: PrepareTransferRequest): Promise<PreparedTransfer> => {
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/transfers/prepare`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Transfer preparation was rejected.');
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
  }, []);

  const requestSecureTransactionSignature = useCallback((request: SecureTransactionSigningRequest): Promise<SecureTransactionSigningResult> => {
    if (!hostOrigin.current) return Promise.resolve({ status: 'cancelled' });
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
  }, []);

  const submitTransferRequest = useCallback(async (request: SubmitTransferRequest): Promise<TransferExecutionResult> => {
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/transfers/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Transfer submission was rejected.');
    const result = await response.json() as TransferExecutionResult;
    if (!isRecord(result)
      || typeof result.intentId !== 'string'
      || (result.status !== 'submitted' && result.status !== 'confirmed')
      || typeof result.transactionHash !== 'string') {
      throw new Error('Unsupported transfer result.');
    }
    return result;
  }, []);

  const createRegistrationIntent = useCallback(async (request: CreateRegistrationIntentRequest): Promise<CreateRegistrationIntentResponse> => {
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/registration/intents`, {
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
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/registration/intents/${encodeURIComponent(registrationIntentId)}/challenges`, {
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
    if (!sessionToken.current || !bffOriginRef.current) throw new Error('Wallet session is not ready.');
    const response = await fetch(`${bffOriginRef.current}/v1/registration/intents/${encodeURIComponent(registrationIntentId)}/challenges/${encodeURIComponent(challengeId)}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Phone verification was rejected.');
    const result = await response.json() as VerifyPhoneChallengeResponse;
    if (!isRecord(result) || !isWssIdentityState(result.identity) || result.identity.status !== 'established') {
      throw new Error('Unsupported phone verification response.');
    }
    setState((current) => current.status === 'ready'
      ? { ...current, bootstrap: { ...current.bootstrap, identity: result.identity } }
      : current);
    return result;
  }, []);

  return {
    ...state,
    navigate,
    setShellMode,
    requestHostAuthentication,
    requestSecureSarWalletCreation,
    requestSecureWalletImport,
    createRegistrationIntent,
    createPhoneChallenge,
    verifyPhoneChallenge,
    provisionWallet,
    selectWallet,
    prepareTransfer: prepareTransferRequest,
    requestSecureTransactionSignature,
    submitTransfer: submitTransferRequest,
  };
}
