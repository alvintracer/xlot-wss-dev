import {
  WSS_PROTOCOL_VERSION,
  isWalletToHostMessage,
  type HostCapabilities,
  type HostAuthenticationPurpose,
  type HostAuthenticationResult,
  type HostToWalletMessage,
  type SecureSarWalletCreationResult,
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
  requestAuthentication?: (purpose: HostAuthenticationPurpose) => Promise<HostAuthenticationResult>;
  requestSecureSarWalletCreation?: () => Promise<SecureSarWalletCreationResult>;
  requestSecureWalletImport?: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  requestSecureTransactionSignature?: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
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
    if (event.data.type === 'took-wss:secure-transaction-sign-request') {
      this.#options.onEvent?.(event.data);
      void this.#respondToSecureTransactionSignature(event.data.requestId, event.data.request);
      return;
    }
    this.#options.onEvent?.(event.data);
  };

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
