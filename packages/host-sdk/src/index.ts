import {
  WSS_PROTOCOL_VERSION,
  isWalletToHostMessage,
  type HostCapabilities,
  type HostAuthenticationPurpose,
  type HostAuthenticationResult,
  type HostRecipientPickResult,
  type HostToWalletMessage,
  type SecureSarWalletCreationResult,
  type SecureSarVaultEnrollmentResult,
  type SecureTransactionSigningRequest,
  type SecureTransactionSigningResult,
  type SecureWalletImportResult,
  type WalletImportMethod,
  type WalletToHostMessage,
} from '@took-wss/contracts';

export interface WssHostClientOptions {
  frame: HTMLIFrameElement;
  walletOrigin: string;
  sessionToken: string;
  bffUrl: string;
  hostCapabilities: HostCapabilities;
  onEvent?: (event: WalletToHostMessage) => void;
  requestSessionRefresh?: () => Promise<string | null>;
  requestAuthentication?: (purpose: HostAuthenticationPurpose) => Promise<HostAuthenticationResult>;
  requestSecureSarWalletCreation?: () => Promise<SecureSarWalletCreationResult>;
  requestSecureSarVaultEnrollment?: (walletId: string, secureRef: string) => Promise<SecureSarVaultEnrollmentResult>;
  requestSecureWalletImport?: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  requestSecureTransactionSignature?: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  requestRecipientPick?: (mode: 'qr' | 'contacts', chainId: string) => Promise<HostRecipientPickResult>;
}

export class WssHostClient {
  readonly #options: WssHostClientOptions;
  #started = false;
  #walletInitialized = false;

  constructor(options: WssHostClientOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    window.addEventListener('message', this.#receive);
  }

  stop(): void {
    if (!this.#started) return;
    window.removeEventListener('message', this.#receive);
    this.#started = false;
  }

  #receive = (event: MessageEvent<unknown>): void => {
    if (event.origin !== this.#options.walletOrigin) return;
    if (event.source !== this.#options.frame.contentWindow) return;
    if (!isWalletToHostMessage(event.data)) return;

    if (event.data.type === 'took-wss:ready') {
      if (this.#walletInitialized) return;
      this.#walletInitialized = true;
      this.#options.onEvent?.(event.data);
      this.#initializeWallet();
      return;
    }
    if (event.data.type === 'took-wss:host-auth-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToAuthentication(event.data.requestId, event.data.purpose);
      return;
    }
    if (event.data.type === 'took-wss:session-refresh-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToSessionRefresh(event.data.requestId);
      return;
    }
    if (event.data.type === 'took-wss:secure-import-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToSecureImport(event.data.requestId, event.data.method);
      return;
    }
    if (event.data.type === 'took-wss:secure-sar-create-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToSecureSarWalletCreation(event.data.requestId);
      return;
    }
    if (event.data.type === 'took-wss:secure-sar-enroll-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToSarVaultEnrollment(event.data.requestId, event.data.walletId, event.data.secureRef);
      return;
    }
    if (event.data.type === 'took-wss:secure-transaction-sign-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToSecureTransactionSignature(event.data.requestId, event.data.request);
      return;
    }
    if (event.data.type === 'took-wss:recipient-pick-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToRecipientPick(event.data.requestId, event.data.mode, event.data.chainId);
      return;
    }
    this.#options.onEvent?.(event.data);
  };

  async #respondToSessionRefresh(requestId: string): Promise<void> {
    let sessionToken: string | null = null;
    try {
      sessionToken = await this.#options.requestSessionRefresh?.() ?? null;
    } catch {
      sessionToken = null;
    }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:session-refresh-result',
      protocolVersion: WSS_PROTOCOL_VERSION,
      requestId,
      ...(sessionToken ? { sessionToken } : {}),
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  async #respondToAuthentication(requestId: string, purpose: HostAuthenticationPurpose): Promise<void> {
    let result: HostAuthenticationResult = { status: 'cancelled' };
    try {
      result = await this.#options.requestAuthentication?.(purpose) ?? { status: 'cancelled' };
    } catch {
      result = { status: 'cancelled' };
    }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:host-auth-result',
      protocolVersion: WSS_PROTOCOL_VERSION,
      requestId,
      result,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  async #respondToSecureImport(requestId: string, method: WalletImportMethod): Promise<void> {
    let result: SecureWalletImportResult = { status: 'cancelled' };
    try {
      result = await this.#options.requestSecureWalletImport?.(method) ?? { status: 'cancelled' };
    } catch {
      result = { status: 'cancelled' };
    }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:secure-import-result',
      protocolVersion: WSS_PROTOCOL_VERSION,
      requestId,
      result,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  async #respondToSecureSarWalletCreation(requestId: string): Promise<void> {
    let result: SecureSarWalletCreationResult = { status: 'cancelled' };
    try {
      result = await this.#options.requestSecureSarWalletCreation?.() ?? { status: 'cancelled' };
    } catch {
      result = { status: 'cancelled' };
    }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:secure-sar-create-result',
      protocolVersion: WSS_PROTOCOL_VERSION,
      requestId,
      result,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  async #respondToSarVaultEnrollment(requestId: string, walletId: string, secureRef: string): Promise<void> {
    let result: SecureSarVaultEnrollmentResult = { status: 'cancelled' };
    try {
      result = await this.#options.requestSecureSarVaultEnrollment?.(walletId, secureRef) ?? { status: 'cancelled' };
    } catch {
      result = { status: 'cancelled' };
    }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:secure-sar-enroll-result',
      protocolVersion: WSS_PROTOCOL_VERSION,
      requestId,
      result,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  async #respondToSecureTransactionSignature(requestId: string, request: SecureTransactionSigningRequest): Promise<void> {
    let result: SecureTransactionSigningResult = { status: 'cancelled' };
    try {
      result = await this.#options.requestSecureTransactionSignature?.(request) ?? { status: 'cancelled' };
    } catch {
      result = { status: 'cancelled' };
    }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:secure-transaction-sign-result',
      protocolVersion: WSS_PROTOCOL_VERSION,
      requestId,
      result,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  async #respondToRecipientPick(requestId: string, mode: 'qr' | 'contacts', chainId: string): Promise<void> {
    let result: HostRecipientPickResult = { status: 'cancelled' };
    try {
      result = await this.#options.requestRecipientPick?.(mode, chainId) ?? { status: 'cancelled' };
    } catch { result = { status: 'cancelled' }; }
    if (!this.#started) return;
    const message: HostToWalletMessage = {
      type: 'took-wss:recipient-pick-result', protocolVersion: WSS_PROTOCOL_VERSION,
      requestId, result,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }

  #initializeWallet(): void {
    const message: HostToWalletMessage = {
      type: 'took-wss:init',
      protocolVersion: WSS_PROTOCOL_VERSION,
      sessionToken: this.#options.sessionToken,
      bffUrl: this.#options.bffUrl,
      hostCapabilities: this.#options.hostCapabilities,
    };
    this.#options.frame.contentWindow?.postMessage(message, this.#options.walletOrigin);
  }
}
