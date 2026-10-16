import type {
  CreatePhoneChallengeResponse,
  CreateRegistrationIntentRequest,
  CreateRegistrationIntentResponse,
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  TenantManifest,
  WalletHomePayload,
  WalletProfileSummary,
  WssSessionClaims,
  VerifyPhoneChallengeResponse,
  WssIdentityState,
  ExchangeQuoteMode,
} from '@took-wss/contracts';

export interface TransferIntent {
  intentId: string;
  tenantId: string;
  walletRef: string;
  chain: string;
  asset: string;
  amount: string;
  recipient: string;
  expiresAt: string;
}

export interface KrwQuote {
  quoteId: string;
  provider: string;
  asset: string;
  krwPrice: string;
  sourceCount: number;
  observedAt: string;
  expiresAt: string;
}

export interface ComplianceDecision {
  decisionId: string;
  status: 'allow' | 'review' | 'block';
  riskCodes: string[];
  provider: string;
  observedAt: string;
}

export interface ExecutionReceipt {
  executionId: string;
  status: 'accepted' | 'submitted' | 'confirmed' | 'failed';
  transactionHash?: string;
  chain: string;
  fee?: { asset: string; amount: string; sponsored: boolean };
}

export interface QuoteProvider {
  readonly id: string;
  getKrwQuote(input: Pick<TransferIntent, 'asset' | 'amount'>): Promise<KrwQuote>;
}

export interface DexQuoteRequest {
  chainId: number;
  taker: string;
  sellToken: string;
  buyToken: string;
  mode: ExchangeQuoteMode;
  amountAtomic: string;
}

export interface DexQuoteResult {
  providerQuoteId: string;
  sellAmountAtomic: string;
  buyAmountAtomic: string;
  minimumBuyAmountAtomic?: string;
  maximumSellAmountAtomic?: string;
  allowanceTarget?: string;
  allowanceRequired: boolean;
  liquidityAvailable: boolean;
  networkFeeAtomic: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    gas: string;
    gasPrice?: string;
  };
}

/** Server-side only. Provider credentials and raw routing responses never cross into a wallet WebView. */
export interface DexQuoteProvider {
  readonly id: string;
  getFirmQuote(input: DexQuoteRequest): Promise<DexQuoteResult>;
}

export interface ComplianceProvider {
  readonly id: string;
  screenTransfer(intent: TransferIntent): Promise<ComplianceDecision>;
}

export interface ExecutionProvider {
  readonly id: string;
  prepare(intent: TransferIntent, decision: ComplianceDecision): Promise<{ approvalPayload: string; expiresAt: string }>;
  submit(intentId: string, customerApproval: string): Promise<ExecutionReceipt>;
  getReceipt(executionId: string): Promise<ExecutionReceipt>;
}

export interface WalletQueryProvider {
  readonly id: string;
  getOwnedReceiveAddress(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    walletId: string;
    chainId: string;
  }): Promise<string | null>;
  verifyProviderWallet?(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    walletId: string;
    account: { subjectHash: string; address: string };
  }): Promise<boolean>;
  getHome(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    walletId?: string;
  }): Promise<WalletHomePayload>;
  renameWallet(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    walletId: string;
    label: string;
  }): Promise<WalletProfileSummary>;
  removeWallet(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    walletId: string;
    authorizationId: string;
  }): Promise<WalletHomePayload>;
}

export interface WalletProvisioningProvider {
  readonly id: string;
  provision(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    request: ProvisionWalletRequest;
    evidence: {
      hostAuthorizationId: string;
      keyCoreAttestationId?: string;
      providerAccount?: { subjectHash: string; address: string };
    };
  }): Promise<ProvisionWalletResponse>;
}

export interface IdentityRegistrationProvider {
  readonly id: string;
  getIdentity(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
  }): Promise<WssIdentityState>;
  createRegistrationIntent(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    request: CreateRegistrationIntentRequest;
  }): Promise<CreateRegistrationIntentResponse>;
  createPhoneChallenge(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    registrationIntentId: string;
  }): Promise<CreatePhoneChallengeResponse>;
  verifyPhoneChallenge(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    registrationIntentId: string;
    challengeId: string;
    code: string;
  }): Promise<VerifyPhoneChallengeResponse>;
}
