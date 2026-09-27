/** UI-only integration skeleton, not a production API specification.
 * Never pass private keys, recovery secrets, PINs or resident-registration numbers here.
 * Atomic quantities are decimal strings; do not use JS Number for financial arithmetic.
 */
export type AtomicAmount = string;
export type IsoDateTime = string;
export type WalletId = string;
export type AssetKey = `${string}:${string}`; // canonical chain ID + native/contract asset identifier
export type CustodyMode = 'customer-controlled' | 'custodial' | 'unknown';

export interface HostCapabilities {
  handlesSafeArea: boolean;
  rendersRootHeader: boolean;
  rendersRootTabs: boolean;
  canScanQr: boolean;
  canUseContacts: boolean;
  canOpenRecovery: boolean;
  canLinkExternalWallet: boolean;
}
export interface AssetView {
  key: AssetKey;
  chainId: string;
  networkLabel: string;
  name: string;
  symbol: string;
  decimals: number;
  balanceAtomic: AtomicAmount;
  balanceDisplay: string;
  availableAtomic: AtomicAmount;
  fiat?: { currency: 'KRW'; display: string; asOf: IsoDateTime; stale: boolean };
  iconAssetId?: string; // vetted asset catalog, not an arbitrary external URL
}
export interface Recipient {
  chainId: string;
  fullAddress: string;
  memo?: { label: string; value: string; required: boolean };
  displayName?: string;
  validation: 'not-checked' | 'checking' | 'valid' | 'invalid';
}
export type PolicyDecision =
  | { status: 'checking' }
  | { status: 'clear'; checkedAt: IsoDateTime; validUntil: IsoDateTime; decisionId: string }
  | { status: 'review-required'; message: string; caseRef?: string }
  | { status: 'restricted'; message: string; reasonCode: string }
  | { status: 'unavailable'; message: string };
export interface TransferQuote {
  id: string;
  walletId: WalletId;
  assetKey: AssetKey;
  recipient: Recipient;
  sendAtomic: AtomicAmount;
  receiveAtomic: AtomicAmount;
  sendDisplay: string;
  receiveDisplay: string;
  fiatReference?: { currency: 'KRW'; display: string; rateAsOf: IsoDateTime };
  fees: Array<{
    label: string;
    assetKey: AssetKey;
    atomic: AtomicAmount;
    display: string;
    payer: 'customer' | 'service' | 'partner';
    deduction: 'separate' | 'from-send-amount';
  }>;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  policy: PolicyDecision;
  intentFingerprint: string; // changing recipient/chain/amount/fees invalidates approval
}
export type TransferState =
  | { status: 'draft' | 'validating' | 'quote-expired' }
  | { status: 'review'; quote: TransferQuote }
  | { status: 'awaiting-approval' | 'signing'; intentId: string }
  | { status: 'broadcasted' | 'pending'; intentId: string; transactionId: string }
  | { status: 'confirmed'; intentId: string; transactionId: string; confirmedAt: IsoDateTime }
  | { status: 'cancelled'; intentId?: string }
  | { status: 'failed'; intentId?: string; reason: string; retryAllowed: boolean }
  | { status: 'unknown'; intentId: string; message: string }; // reconcile, do not re-send blindly
export interface WalletProfile {
  id: WalletId;
  label: string;
  custodyMode: CustodyMode;
  recoveryProfileId?: string; // host/core-controlled, not hard-coded to SAR or MPC
  capabilities: HostCapabilities;
}
export interface WalletUiBridge {
  getHostCapabilities(): Promise<HostCapabilities>;
  requestLogin(input: { returnRoute: string }): Promise<'authenticated' | 'cancelled'>;
  navigateHost(route: string): void;
  scanQr(): Promise<{ payload: string } | { cancelled: true }>;
  copyAddress(address: string): Promise<void>;
  getQuote(input: {
    walletId: WalletId; assetKey: AssetKey; recipient: Recipient;
    amount: { unit: 'atomic'; value: AtomicAmount } | { unit: 'KRW'; decimal: string };
  }): Promise<TransferQuote>;
  /** Core coordinates host secure authentication/signing; never return reusable auth secrets to JS. */
  requestTransferApproval(input: {
    quoteId: string; intentFingerprint: string; idempotencyKey: string;
  }): Promise<TransferState>;
  getTransferState(intentId: string): Promise<TransferState>;
  openRecovery(input: { walletId: WalletId; recoveryProfileId: string }): Promise<void>;
}

/** UI gate only. The core MUST independently revalidate before authorization/broadcast. */
export function isQuoteReadyForApproval(quote: TransferQuote, nowMs = Date.now()): boolean {
  const expiry = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiry) || nowMs >= expiry) return false;
  if (quote.policy.status !== 'clear' || quote.recipient.validation !== 'valid') return false;
  const policyExpiry = Date.parse(quote.policy.validUntil);
  if (!Number.isFinite(policyExpiry) || nowMs >= policyExpiry) return false;
  return Boolean(quote.intentFingerprint && quote.id);
}
