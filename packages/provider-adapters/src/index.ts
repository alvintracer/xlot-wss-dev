import type {
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  TenantManifest,
  WalletHomePayload,
  WssSessionClaims,
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
  getHome(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    walletId?: string;
  }): Promise<WalletHomePayload>;
}

export interface WalletProvisioningProvider {
  readonly id: string;
  provision(input: {
    session: Omit<WssSessionClaims, 'nonce'>;
    manifest: TenantManifest;
    request: ProvisionWalletRequest;
  }): Promise<ProvisionWalletResponse>;
}
