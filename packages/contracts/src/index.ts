export const WSS_PROTOCOL_VERSION = 1 as const;

export type WssModuleId =
  | 'wallet-home'
  | 'send-receive'
  | 'sar-recovery'
  | 'super-wallet'
  | 'phone-transfer'
  | 'messaging-transfer'
  | 'exchange-connect'
  | 'card'
  | 'dapp-browser'
  | 'kyt'
  | 'travel-rule'
  | 'k-vwap'
  | 'gas-sponsorship';

export type KeyAdapterId = 'took-sar' | 'thirdweb-user-wallet' | 'fsl-mpc';
export type ExecutionAdapterId = 'took-router' | 'fsl-wis';
export type DeploymentMode = 'saas' | 'dedicated' | 'institution-controlled';
export type RecoveryRequirement = 'sar-required' | 'sar-preferred' | 'provider-recovery-accepted';
export const MOBILE_CARRIER_CODES = [
  'skt',
  'kt',
  'lgu-plus',
  'skt-mvno',
  'kt-mvno',
  'lgu-plus-mvno',
] as const;
export type MobileCarrierCode = typeof MOBILE_CARRIER_CODES[number];
export type IdentityOnboardingMode = 'institution-first' | 'phone-first';
export type PhoneVerificationMode = 'host' | 'development-sms' | 'supabase-auth-solapi';
export type IdentityAssuranceLevel =
  | 'self-asserted'
  | 'phone-possession'
  | 'institution-authenticated'
  | 'identity-provider-verified';
export type WalletShellMode = 'root' | 'focus';
export type HostAuthenticationPurpose = 'wallet-provisioning' | 'transfer-approval' | 'wallet-recovery';
export type HostAuthenticationResult =
  | {
      status: 'authenticated';
      proof: string;
      expiresAt: string;
      method: 'institution-sdk' | 'development-reference-host';
    }
  | { status: 'cancelled' };
export type WalletImportMethod = 'mnemonic' | 'private-key';
export type WalletProvisioningOrigin = 'created' | 'imported';

export interface PublicWalletAddressRegistration {
  addressGroupId: string;
  address: string;
}

export interface SarRecoveryRegistration {
  scheme: 'shamir-gf256';
  threshold: 2;
  shareCount: 3;
  recombinationVerified: true;
  keyCoreVersion: string;
}

export interface SarRecoveryEnvelopeRegistration {
  factorIndex: 1 | 2 | 3;
  envelopeVersion: 1;
  algorithm: 'AES-256-GCM';
  ivBase64: string;
  ciphertextBase64: string;
  aad: string;
}

export interface SecureSarWalletPayload {
  secureProvisionRef: string;
  addresses: readonly PublicWalletAddressRegistration[];
  recoveryEnvelopes: readonly SarRecoveryEnvelopeRegistration[];
  recovery: SarRecoveryRegistration;
}

export interface SecureSarWalletRegistration extends SecureSarWalletPayload {
  keyCoreAttestationProof: string;
}

export interface SecureSarWalletImportRegistration extends Omit<SecureSarWalletRegistration, 'secureProvisionRef'> {
  secureImportRef: string;
}

export type SecureWalletImportResult =
  | ({ status: 'completed' } & SecureSarWalletImportRegistration)
  | { status: 'cancelled' };

export type SecureSarWalletCreationResult =
  | ({ status: 'completed' } & SecureSarWalletRegistration)
  | { status: 'cancelled' };

export interface TenantBrand {
  logoText: string;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  radius: 'soft' | 'square';
}

export interface TenantManifest {
  schemaVersion: 1;
  tenantId: string;
  slug: string;
  institutionName: string;
  walletName: string;
  environment: 'development' | 'sandbox' | 'production';
  deploymentMode: DeploymentMode;
  presentation: {
    profileId: string;
    guideVersion: string;
    rootHeaderOwner: 'host' | 'wss';
    rootNavigationOwner: 'host' | 'wss';
    safeAreaOwner: 'host' | 'wss';
    navigation: {
      rootEntry: 'host-tabs' | 'wallet-tabs' | 'direct';
      focusedFlow: 'hide-host-chrome' | 'keep-host-chrome';
      walletMenu: 'none' | 'hamburger';
    };
  };
  brand: TenantBrand;
  identity: {
    onboardingMode: IdentityOnboardingMode;
    phoneVerification: PhoneVerificationMode;
    consentVersion: string;
  };
  enabledModules: WssModuleId[];
  keyManagement: {
    policyVersion: number;
    recoveryRequirement: RecoveryRequirement;
    defaultAdapter: KeyAdapterId;
    allowedAdapters: KeyAdapterId[];
  };
  providers: {
    execution: ExecutionAdapterId;
    compliance: 'transight' | 'mock';
    quote: 'bonanza-k-vwap' | 'mock';
  };
  chains: string[];
  assetPolicy: {
    stablecoins: string[];
  };
}

export type WssIdentityState =
  | { status: 'registration-required' }
  | {
      status: 'established';
      assuranceLevel: IdentityAssuranceLevel;
    };

export interface CreateRegistrationIntentRequest {
  name: string;
  birthDate: string;
  phone: string;
  carrierCode: MobileCarrierCode;
  consentVersion: string;
}

export interface CreateRegistrationIntentResponse {
  registrationIntentId: string;
  expiresAt: string;
}

export interface CreatePhoneChallengeResponse {
  challengeId: string;
  expiresAt: string;
  delivery: 'sms';
  developmentCode?: string;
}

export interface VerifyPhoneChallengeRequest {
  code: string;
}

export interface VerifyPhoneChallengeResponse {
  identity: Extract<WssIdentityState, { status: 'established' }>;
}

export interface WssSessionClaims {
  protocolVersion: 1;
  sessionId: string;
  tenantId: string;
  subject: string;
  subjectVersion: 1;
  keyAdapter: KeyAdapterId;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface HostCapabilities {
  handlesSafeArea: boolean;
  rendersRootHeader: boolean;
  rendersRootTabs: boolean;
  canScanQr: boolean;
  canUseContacts: boolean;
  canOpenRecovery: boolean;
  canLinkExternalWallet: boolean;
  canSecureWalletImport: boolean;
  canCreateSecureSarWallet: boolean;
}

export interface WalletProfileSummary {
  walletId: string;
  label: string;
  keyAdapter: KeyAdapterId;
  origin: WalletProvisioningOrigin;
}

export interface WalletAssetView {
  assetId: string;
  iconAssetId?: string;
  chainId?: string;
  addressGroupId?: string;
  symbol: string;
  name: string;
  network: string;
  decimals?: number;
  availableAtomic?: string;
  tokenAddress?: string;
  transferStatus?: 'enabled' | 'unavailable';
  transferUnavailableReason?: string;
  balanceAtomic: string;
  balanceDisplay: string;
  fiat?: {
    currency: 'KRW';
    display: string;
    asOf: string;
    stale: boolean;
  };
}

export interface WalletReceiveAssetView {
  assetId: string;
  iconAssetId?: string;
  chainId: string;
  addressGroupId: string;
  symbol: string;
  name: string;
  network: string;
  decimals: number;
  tokenAddress?: string;
  canonical: boolean;
  balanceStatus: 'ready' | 'unavailable' | 'sandbox';
  balanceAtomic: string;
  balanceDisplay: string;
  availableAtomic: string;
  transferStatus: 'enabled' | 'unavailable';
  transferUnavailableReason?: string;
  phoneTransferStatus?: 'enabled' | 'unavailable';
  phoneTransferUnavailableReason?: string;
  referencePrice?: {
    currency: 'KRW';
    decimal: string;
    display: string;
    asOf: string;
    stale: boolean;
  };
}

export type TransferChannel = 'address' | 'phone' | 'message';

export interface PrepareTransferRequest {
  walletId: string;
  assetId: string;
  chainId: string;
  recipient: string;
  amountAtomic: string;
  channel: TransferChannel;
  destinationTag?: string;
  complianceReason?: string;
}

export interface PreparedTransfer {
  intentId: string;
  walletId: string;
  assetId: string;
  chainId: string;
  network: string;
  assetSymbol: string;
  fromAddress: string;
  recipient: string;
  channel: TransferChannel;
  destinationTag?: string;
  amountAtomic: string;
  amountDisplay: string;
  fiatDisplay?: string;
  networkFee: {
    symbol: string;
    amountAtomic: string;
    amountDisplay: string;
    fiatDisplay?: string;
    maximum?: boolean;
  };
  gasSponsorship: {
    status: 'sponsored' | 'eligible' | 'not-eligible' | 'unavailable';
    method?: 'evm-permit-relay' | 'solana-relay' | 'tron-jit';
    message: string;
  };
  compliance: {
    status: 'allow' | 'review' | 'block' | 'unavailable';
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskScore?: number;
    reasonRequired: boolean;
    message: string;
  };
  phoneEscrow?: {
    recipientAmountAtomic: string;
    recipientAmountDisplay: string;
    escrowAmountAtomic: string;
    escrowAmountDisplay: string;
    claimFeeAtomic: string;
    claimFeeDisplay: string;
    expiresAt: string;
  };
  signingRequest?: SecureTransactionSigningRequest;
  expiresAt: string;
}

export interface SecureTransactionSigningRequest {
  intentId: string;
  walletId: string;
  chainId: string;
  network: string;
  assetSymbol: string;
  amountDisplay: string;
  fromAddress: string;
  recipient: string;
  channel: TransferChannel;
  destinationTag?: string;
  transaction:
    | EvmTransactionSigningPayload
    | {
        type: 'evm-batch';
        chainId: number;
        transactions: EvmTransactionSigningPayload[];
      }
    | {
        type: 'solana-spl';
        unsignedTransactionBase64: string;
        recentBlockhash: string;
        lastValidBlockHeight: number;
        mintAddress: string;
        sourceTokenAccount: string;
        destinationTokenAccount: string;
        amountAtomic: string;
        feeLamports: string;
      }
    | {
        type: 'solana-native';
        unsignedTransactionBase64: string;
        recentBlockhash: string;
        lastValidBlockHeight: number;
        amountLamports: string;
        feeLamports: string;
      }
    | {
        type: 'tron-trc20';
        unsignedTransactionJson: string;
        transactionId: string;
        tokenAddress: string;
        amountAtomic: string;
        feeLimitSun: string;
      }
    | {
        type: 'tron-native';
        unsignedTransactionJson: string;
        transactionId: string;
        amountSun: string;
        feeLimitSun: string;
      }
    | {
        type: 'xrpl-issued';
        payment: {
          TransactionType: 'Payment';
          Account: string;
          Destination: string;
          Amount: { currency: string; issuer: string; value: string };
          DestinationTag?: number;
          Flags: number;
          Sequence: number;
          Fee: string;
          LastLedgerSequence: number;
        };
        snapshotLedgerIndex: number;
      }
    | {
        type: 'xrpl-native';
        payment: {
          TransactionType: 'Payment';
          Account: string;
          Destination: string;
          Amount: string;
          DestinationTag?: number;
          Flags: number;
          Sequence: number;
          Fee: string;
          LastLedgerSequence: number;
        };
        snapshotLedgerIndex: number;
      }
    | {
        type: 'bitcoin-native';
        unsignedPsbtBase64: string;
        amountSatoshis: string;
        feeSatoshis: string;
        changeSatoshis: string;
        feeRateSatsPerVbyte: string;
        inputCount: number;
      };
}

export interface EvmTransactionSigningPayload {
  type: 'evm-native' | 'evm-erc20';
  purpose?: 'asset-transfer' | 'token-approval' | 'phone-escrow-deposit';
  chainId: number;
  nonce: number;
  to: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  data?: string;
}

export type SecureTransactionSigningResult =
  | {
      status: 'completed';
      intentId: string;
      signedTransaction: string;
      hostAuthorizationProof: string;
    }
  | { status: 'cancelled' };

export interface SubmitTransferRequest {
  intentId: string;
  signedTransaction: string;
  hostAuthorizationProof: string;
  idempotencyKey: string;
}

export interface TransferExecutionResult {
  intentId: string;
  status: 'submitted' | 'confirmed';
  transactionHash: string;
  explorerUrl?: string;
  delivery?: {
    channel: 'phone';
    status: 'pending' | 'sent' | 'failed';
    recipientDisplay: string;
  };
}

export interface WalletNetworkView {
  chainId: string;
  addressGroupId: string;
  network: string;
  nativeSymbol: string;
  status: 'registered' | 'pending' | 'unavailable';
  addressStatus: 'ready' | 'pending-core' | 'unavailable';
  address?: string;
}

export interface WalletValuationView {
  currency: 'KRW';
  provider: string;
  status: 'live' | 'sandbox' | 'unavailable';
  asOf: string;
}

export interface WalletRecoveryView {
  profile: 'sar-2-of-3' | 'provider-policy';
  status: 'ready' | 'pending' | 'sandbox-ready';
  policyVersion: number;
}

export type WalletHomePayload =
  | {
      status: 'absent';
      canCreate: boolean;
      canRecover: boolean;
      source: 'wallet-query';
    }
  | {
      status: 'empty';
      wallet: WalletProfileSummary;
      source: 'wallet-query';
    }
  | {
      status: 'ready';
      wallet: WalletProfileSummary;
      wallets: WalletProfileSummary[];
      totalFiat?: {
        currency: 'KRW';
        display: string;
        asOf: string;
        stale: boolean;
      };
      assets: WalletAssetView[];
      receiveAssets: WalletReceiveAssetView[];
      networks: WalletNetworkView[];
      valuation: WalletValuationView;
      recovery: WalletRecoveryView;
      source: 'wallet-query';
    }
  | {
      status: 'unavailable';
      code: string;
      canRetry: boolean;
      source: 'wallet-query';
    };

export interface WalletPresentationProps {
  manifest: TenantManifest;
  sessionKeyAdapter: KeyAdapterId;
  hostCapabilities: HostCapabilities;
  walletHome: WalletHomePayload;
  identity: WssIdentityState;
  onNavigate: (route: string) => void;
  onShellModeChange: (mode: WalletShellMode) => void;
  onRequestHostAuthentication: (purpose: HostAuthenticationPurpose) => Promise<HostAuthenticationResult>;
  onRequestSecureSarWalletCreation: () => Promise<SecureSarWalletCreationResult>;
  onRequestSecureWalletImport: (method: WalletImportMethod) => Promise<SecureWalletImportResult>;
  onCreateRegistrationIntent: (request: CreateRegistrationIntentRequest) => Promise<CreateRegistrationIntentResponse>;
  onCreatePhoneChallenge: (registrationIntentId: string) => Promise<CreatePhoneChallengeResponse>;
  onVerifyPhoneChallenge: (registrationIntentId: string, challengeId: string, request: VerifyPhoneChallengeRequest) => Promise<VerifyPhoneChallengeResponse>;
  onProvisionWallet: (request: ProvisionWalletRequest) => Promise<ProvisionWalletResponse>;
  onSelectWallet: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onPrepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
}

export type ReadyWalletHomePayload = Extract<WalletHomePayload, { status: 'ready' }>;

export interface ProvisionWalletRequest {
  idempotencyKey: string;
  keyAdapter: KeyAdapterId;
  recoverySetupAcknowledged: boolean;
  hostAuthorizationProof: string;
  source:
    | { type: 'new' }
    | ({ type: 'secure-new' } & SecureSarWalletRegistration)
    | ({ type: 'secure-import'; method: WalletImportMethod } & SecureSarWalletImportRegistration);
}

export interface ProvisionWalletResponse {
  mode: 'sandbox-contract-only' | 'development-key-core' | 'live';
  walletHome: ReadyWalletHomePayload;
}

export interface WssRuntimeBootstrap {
  protocolVersion: 1;
  session: Omit<WssSessionClaims, 'nonce'>;
  manifest: TenantManifest;
  identity: WssIdentityState;
  walletHome: WalletHomePayload;
}

export type HostToWalletMessage =
  | {
      type: 'took-wss:init';
      protocolVersion: 1;
      sessionToken: string;
      bffUrl: string;
      hostCapabilities: HostCapabilities;
    }
  | {
      type: 'took-wss:host-auth-result';
      protocolVersion: 1;
      requestId: string;
      result: HostAuthenticationResult;
    }
  | {
      type: 'took-wss:secure-import-result';
      protocolVersion: 1;
      requestId: string;
      result: SecureWalletImportResult;
    }
  | {
      type: 'took-wss:secure-sar-create-result';
      protocolVersion: 1;
      requestId: string;
      result: SecureSarWalletCreationResult;
    }
  | {
      type: 'took-wss:secure-transaction-sign-result';
      protocolVersion: 1;
      requestId: string;
      result: SecureTransactionSigningResult;
    };

export type WalletToHostMessage =
  | { type: 'took-wss:ready'; protocolVersion: 1 }
  | { type: 'took-wss:bootstrapped'; protocolVersion: 1; tenantId: string; sessionId: string }
  | { type: 'took-wss:navigation'; protocolVersion: 1; route: string }
  | { type: 'took-wss:shell-change'; protocolVersion: 1; mode: WalletShellMode }
  | { type: 'took-wss:host-auth-request'; protocolVersion: 1; requestId: string; purpose: HostAuthenticationPurpose }
  | { type: 'took-wss:secure-sar-create-request'; protocolVersion: 1; requestId: string }
  | { type: 'took-wss:secure-import-request'; protocolVersion: 1; requestId: string; method: WalletImportMethod }
  | {
      type: 'took-wss:secure-transaction-sign-request';
      protocolVersion: 1;
      requestId: string;
      request: SecureTransactionSigningRequest;
    }
  | { type: 'took-wss:error'; protocolVersion: 1; code: string };

export interface CreateSessionRequest {
  tenantId: string;
  customerRef: string;
  requestedKeyAdapter?: KeyAdapterId;
}

export interface CreateSessionResponse {
  sessionToken: string;
  expiresAt: string;
  walletUrl: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHostCapabilities(value: unknown): value is HostCapabilities {
  if (!isRecord(value)) return false;
  const keys = [
    'handlesSafeArea',
    'rendersRootHeader',
    'rendersRootTabs',
    'canScanQr',
    'canUseContacts',
    'canOpenRecovery',
    'canLinkExternalWallet',
    'canSecureWalletImport',
    'canCreateSecureSarWallet',
  ] as const;
  return keys.every((key) => typeof value[key] === 'boolean');
}

export function isWssIdentityState(value: unknown): value is WssIdentityState {
  if (!isRecord(value)) return false;
  if (value.status === 'registration-required') return true;
  return value.status === 'established'
    && (value.assuranceLevel === 'self-asserted'
      || value.assuranceLevel === 'phone-possession'
      || value.assuranceLevel === 'institution-authenticated'
      || value.assuranceLevel === 'identity-provider-verified');
}

export function isWalletHomePayload(value: unknown): value is WalletHomePayload {
  if (!isRecord(value) || value.source !== 'wallet-query' || typeof value.status !== 'string') return false;
  if (value.status === 'absent') return typeof value.canCreate === 'boolean' && typeof value.canRecover === 'boolean';
  const isWallet = (wallet: unknown): wallet is WalletProfileSummary => isRecord(wallet)
    && typeof wallet.walletId === 'string'
    && typeof wallet.label === 'string'
    && (wallet.keyAdapter === 'took-sar' || wallet.keyAdapter === 'thirdweb-user-wallet' || wallet.keyAdapter === 'fsl-mpc')
    && (wallet.origin === 'created' || wallet.origin === 'imported');
  const isFiat = (fiat: unknown) => isRecord(fiat)
    && fiat.currency === 'KRW'
    && typeof fiat.display === 'string'
    && typeof fiat.asOf === 'string'
    && typeof fiat.stale === 'boolean';
  const isAsset = (asset: unknown) => isRecord(asset)
    && typeof asset.assetId === 'string'
    && (asset.iconAssetId === undefined || typeof asset.iconAssetId === 'string')
    && (asset.chainId === undefined || typeof asset.chainId === 'string')
    && (asset.addressGroupId === undefined || typeof asset.addressGroupId === 'string')
    && typeof asset.symbol === 'string'
    && typeof asset.name === 'string'
    && typeof asset.network === 'string'
    && (asset.decimals === undefined || (Number.isInteger(asset.decimals) && Number(asset.decimals) >= 0))
    && (asset.availableAtomic === undefined || typeof asset.availableAtomic === 'string')
    && (asset.tokenAddress === undefined || typeof asset.tokenAddress === 'string')
    && (asset.transferStatus === undefined || asset.transferStatus === 'enabled' || asset.transferStatus === 'unavailable')
    && (asset.transferUnavailableReason === undefined || typeof asset.transferUnavailableReason === 'string')
    && typeof asset.balanceAtomic === 'string'
    && typeof asset.balanceDisplay === 'string'
    && (asset.fiat === undefined || isFiat(asset.fiat));
  const isNetwork = (network: unknown) => isRecord(network)
    && typeof network.chainId === 'string'
    && typeof network.addressGroupId === 'string'
    && network.addressGroupId.length > 0
    && typeof network.network === 'string'
    && typeof network.nativeSymbol === 'string'
    && (network.status === 'registered' || network.status === 'pending' || network.status === 'unavailable')
    && (network.addressStatus === 'ready' || network.addressStatus === 'pending-core' || network.addressStatus === 'unavailable')
    && (network.address === undefined || typeof network.address === 'string')
    && (network.addressStatus !== 'ready' || typeof network.address === 'string');
  const isReceiveAsset = (asset: unknown) => isRecord(asset)
    && typeof asset.assetId === 'string'
    && (asset.iconAssetId === undefined || typeof asset.iconAssetId === 'string')
    && typeof asset.chainId === 'string'
    && typeof asset.addressGroupId === 'string'
    && typeof asset.symbol === 'string'
    && typeof asset.name === 'string'
    && typeof asset.network === 'string'
    && Number.isInteger(asset.decimals)
    && Number(asset.decimals) >= 0
    && Number(asset.decimals) <= 255
    && (asset.tokenAddress === undefined || typeof asset.tokenAddress === 'string')
    && typeof asset.canonical === 'boolean'
    && (asset.balanceStatus === 'ready' || asset.balanceStatus === 'unavailable' || asset.balanceStatus === 'sandbox')
    && typeof asset.balanceAtomic === 'string'
    && /^\d+$/.test(asset.balanceAtomic)
    && typeof asset.balanceDisplay === 'string'
    && typeof asset.availableAtomic === 'string'
    && /^\d+$/.test(asset.availableAtomic)
    && (asset.transferStatus === 'enabled' || asset.transferStatus === 'unavailable')
    && (asset.transferUnavailableReason === undefined || typeof asset.transferUnavailableReason === 'string')
    && (asset.phoneTransferStatus === undefined || asset.phoneTransferStatus === 'enabled' || asset.phoneTransferStatus === 'unavailable')
    && (asset.phoneTransferUnavailableReason === undefined || typeof asset.phoneTransferUnavailableReason === 'string')
    && (asset.referencePrice === undefined || (isRecord(asset.referencePrice)
      && asset.referencePrice.currency === 'KRW'
      && typeof asset.referencePrice.decimal === 'string'
      && /^\d+(?:\.\d+)?$/.test(asset.referencePrice.decimal)
      && typeof asset.referencePrice.display === 'string'
      && typeof asset.referencePrice.asOf === 'string'
      && typeof asset.referencePrice.stale === 'boolean'));
  const isValuation = (valuation: unknown) => isRecord(valuation)
    && valuation.currency === 'KRW'
    && typeof valuation.provider === 'string'
    && (valuation.status === 'live' || valuation.status === 'sandbox' || valuation.status === 'unavailable')
    && typeof valuation.asOf === 'string';
  const isRecovery = (recovery: unknown) => isRecord(recovery)
    && (recovery.profile === 'sar-2-of-3' || recovery.profile === 'provider-policy')
    && (recovery.status === 'ready' || recovery.status === 'pending' || recovery.status === 'sandbox-ready')
    && Number.isInteger(recovery.policyVersion);
  if (value.status === 'empty') return isWallet(value.wallet);
  if (value.status === 'ready') {
    if (!isWallet(value.wallet)) return false;
    const selectedWallet = value.wallet;
    return Array.isArray(value.wallets)
      && value.wallets.length > 0
      && value.wallets.every(isWallet)
      && value.wallets.some((wallet) => isWallet(wallet) && wallet.walletId === selectedWallet.walletId)
      && (value.totalFiat === undefined || isFiat(value.totalFiat))
      && Array.isArray(value.assets)
      && value.assets.every(isAsset)
      && Array.isArray(value.receiveAssets)
      && value.receiveAssets.every(isReceiveAsset)
      && Array.isArray(value.networks)
      && value.networks.every(isNetwork)
      && isValuation(value.valuation)
      && isRecovery(value.recovery);
  }
  if (value.status === 'unavailable') return typeof value.code === 'string' && typeof value.canRetry === 'boolean';
  return false;
}

export function isHostToWalletMessage(value: unknown): value is HostToWalletMessage {
  if (!isRecord(value)) return false;
  if (value.protocolVersion !== WSS_PROTOCOL_VERSION) return false;
  if (value.type === 'took-wss:init') {
    return typeof value.sessionToken === 'string'
      && value.sessionToken.length > 20
      && typeof value.bffUrl === 'string'
      && isHostCapabilities(value.hostCapabilities);
  }
  if (value.type === 'took-wss:host-auth-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.result)) return false;
    if (value.result.status === 'cancelled') return true;
    return value.result.status === 'authenticated'
      && typeof value.result.proof === 'string'
      && value.result.proof.length > 20
      && typeof value.result.expiresAt === 'string'
      && (value.result.method === 'institution-sdk' || value.result.method === 'development-reference-host');
  }
  if (value.type === 'took-wss:secure-import-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.result)) return false;
    if (value.result.status === 'cancelled') return true;
    return value.result.status === 'completed' && isSecureSarWalletImportRegistration(value.result);
  }
  if (value.type === 'took-wss:secure-sar-create-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.result)) return false;
    if (value.result.status === 'cancelled') return true;
    return value.result.status === 'completed' && isSecureSarWalletRegistration(value.result);
  }
  if (value.type === 'took-wss:secure-transaction-sign-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.result)) return false;
    if (value.result.status === 'cancelled') return true;
    return value.result.status === 'completed'
      && typeof value.result.intentId === 'string'
      && typeof value.result.signedTransaction === 'string'
      && value.result.signedTransaction.length >= 8
      && value.result.signedTransaction.length <= 65_536
      && typeof value.result.hostAuthorizationProof === 'string'
      && value.result.hostAuthorizationProof.length > 20;
  }
  return false;
}

export function isWalletToHostMessage(value: unknown): value is WalletToHostMessage {
  if (!isRecord(value) || value.protocolVersion !== WSS_PROTOCOL_VERSION || typeof value.type !== 'string') return false;
  if (value.type === 'took-wss:ready') return true;
  if (value.type === 'took-wss:bootstrapped') return typeof value.tenantId === 'string' && typeof value.sessionId === 'string';
  if (value.type === 'took-wss:navigation') return typeof value.route === 'string';
  if (value.type === 'took-wss:shell-change') return value.mode === 'root' || value.mode === 'focus';
  if (value.type === 'took-wss:host-auth-request') {
    return typeof value.requestId === 'string'
      && (value.purpose === 'wallet-provisioning' || value.purpose === 'transfer-approval' || value.purpose === 'wallet-recovery');
  }
  if (value.type === 'took-wss:secure-sar-create-request') return typeof value.requestId === 'string';
  if (value.type === 'took-wss:secure-import-request') {
    return typeof value.requestId === 'string'
      && (value.method === 'mnemonic' || value.method === 'private-key');
  }
  if (value.type === 'took-wss:secure-transaction-sign-request') {
    return typeof value.requestId === 'string' && isSecureTransactionSigningRequest(value.request);
  }
  if (value.type === 'took-wss:error') return typeof value.code === 'string';
  return false;
}

export function isSecureTransactionSigningRequest(value: unknown): value is SecureTransactionSigningRequest {
  if (!isRecord(value)
    || typeof value.intentId !== 'string'
    || typeof value.walletId !== 'string'
    || typeof value.chainId !== 'string'
    || typeof value.network !== 'string'
    || typeof value.assetSymbol !== 'string'
    || typeof value.amountDisplay !== 'string'
    || typeof value.fromAddress !== 'string'
    || typeof value.recipient !== 'string'
    || (value.channel !== 'address' && value.channel !== 'phone' && value.channel !== 'message')
    || (value.destinationTag !== undefined && typeof value.destinationTag !== 'string')
    || !isRecord(value.transaction)) return false;
  if (value.transaction.type === 'evm-native' || value.transaction.type === 'evm-erc20') {
    return isEvmTransactionSigningPayload(value.transaction);
  }
  if (value.transaction.type === 'evm-batch') {
    const transactionBatch = value.transaction;
    const transactions = transactionBatch.transactions;
    if (!Array.isArray(transactions)) return false;
    return Number.isSafeInteger(transactionBatch.chainId)
      && transactions.length >= 2
      && transactions.length <= 3
      && transactions.every((transaction, index) => (
        isEvmTransactionSigningPayload(transaction)
        && transaction.chainId === transactionBatch.chainId
        && (index === 0 || transaction.nonce === transactions[index - 1]!.nonce + 1)
      ));
  }
  if (value.transaction.type === 'solana-spl') {
    return typeof value.transaction.unsignedTransactionBase64 === 'string'
      && value.transaction.unsignedTransactionBase64.length >= 32
      && value.transaction.unsignedTransactionBase64.length <= 16_384
      && typeof value.transaction.recentBlockhash === 'string'
      && Number.isSafeInteger(value.transaction.lastValidBlockHeight)
      && typeof value.transaction.mintAddress === 'string'
      && typeof value.transaction.sourceTokenAccount === 'string'
      && typeof value.transaction.destinationTokenAccount === 'string'
      && typeof value.transaction.amountAtomic === 'string'
      && /^\d+$/.test(value.transaction.amountAtomic)
      && typeof value.transaction.feeLamports === 'string'
      && /^\d+$/.test(value.transaction.feeLamports);
  }
  if (value.transaction.type === 'solana-native') {
    return typeof value.transaction.unsignedTransactionBase64 === 'string'
      && value.transaction.unsignedTransactionBase64.length >= 32
      && value.transaction.unsignedTransactionBase64.length <= 16_384
      && typeof value.transaction.recentBlockhash === 'string'
      && Number.isSafeInteger(value.transaction.lastValidBlockHeight)
      && typeof value.transaction.amountLamports === 'string'
      && /^\d+$/.test(value.transaction.amountLamports)
      && typeof value.transaction.feeLamports === 'string'
      && /^\d+$/.test(value.transaction.feeLamports);
  }
  if (value.transaction.type === 'tron-trc20') {
    return typeof value.transaction.unsignedTransactionJson === 'string'
      && value.transaction.unsignedTransactionJson.length >= 32
      && value.transaction.unsignedTransactionJson.length <= 32_768
      && typeof value.transaction.transactionId === 'string'
      && /^[0-9a-fA-F]{64}$/.test(value.transaction.transactionId)
      && typeof value.transaction.tokenAddress === 'string'
      && typeof value.transaction.amountAtomic === 'string'
      && /^\d+$/.test(value.transaction.amountAtomic)
      && typeof value.transaction.feeLimitSun === 'string'
      && /^\d+$/.test(value.transaction.feeLimitSun);
  }
  if (value.transaction.type === 'tron-native') {
    return typeof value.transaction.unsignedTransactionJson === 'string'
      && value.transaction.unsignedTransactionJson.length >= 32
      && value.transaction.unsignedTransactionJson.length <= 32_768
      && typeof value.transaction.transactionId === 'string'
      && /^[0-9a-fA-F]{64}$/.test(value.transaction.transactionId)
      && typeof value.transaction.amountSun === 'string'
      && /^\d+$/.test(value.transaction.amountSun)
      && typeof value.transaction.feeLimitSun === 'string'
      && /^\d+$/.test(value.transaction.feeLimitSun);
  }
  if (value.transaction.type === 'xrpl-issued') {
    const payment = value.transaction.payment;
    return isRecord(payment)
      && payment.TransactionType === 'Payment'
      && typeof payment.Account === 'string'
      && typeof payment.Destination === 'string'
      && isRecord(payment.Amount)
      && typeof payment.Amount.currency === 'string'
      && typeof payment.Amount.issuer === 'string'
      && typeof payment.Amount.value === 'string'
      && (payment.DestinationTag === undefined || (Number.isSafeInteger(payment.DestinationTag) && Number(payment.DestinationTag) >= 0))
      && Number.isSafeInteger(payment.Flags)
      && Number.isSafeInteger(payment.Sequence)
      && typeof payment.Fee === 'string'
      && /^\d+$/.test(payment.Fee)
      && Number.isSafeInteger(payment.LastLedgerSequence)
      && Number.isSafeInteger(value.transaction.snapshotLedgerIndex);
  }
  if (value.transaction.type === 'xrpl-native') {
    const payment = value.transaction.payment;
    return isRecord(payment)
      && payment.TransactionType === 'Payment'
      && typeof payment.Account === 'string'
      && typeof payment.Destination === 'string'
      && typeof payment.Amount === 'string'
      && /^\d+$/.test(payment.Amount)
      && (payment.DestinationTag === undefined || (Number.isSafeInteger(payment.DestinationTag) && Number(payment.DestinationTag) >= 0))
      && Number.isSafeInteger(payment.Flags)
      && Number.isSafeInteger(payment.Sequence)
      && typeof payment.Fee === 'string'
      && /^\d+$/.test(payment.Fee)
      && Number.isSafeInteger(payment.LastLedgerSequence)
      && Number.isSafeInteger(value.transaction.snapshotLedgerIndex);
  }
  if (value.transaction.type === 'bitcoin-native') {
    return typeof value.transaction.unsignedPsbtBase64 === 'string'
      && value.transaction.unsignedPsbtBase64.length >= 32
      && value.transaction.unsignedPsbtBase64.length <= 262_144
      && typeof value.transaction.amountSatoshis === 'string'
      && /^\d+$/.test(value.transaction.amountSatoshis)
      && typeof value.transaction.feeSatoshis === 'string'
      && /^\d+$/.test(value.transaction.feeSatoshis)
      && typeof value.transaction.changeSatoshis === 'string'
      && /^\d+$/.test(value.transaction.changeSatoshis)
      && typeof value.transaction.feeRateSatsPerVbyte === 'string'
      && /^\d+$/.test(value.transaction.feeRateSatsPerVbyte)
      && typeof value.transaction.inputCount === 'number'
      && Number.isSafeInteger(value.transaction.inputCount)
      && value.transaction.inputCount >= 1
      && value.transaction.inputCount <= 24;
  }
  return false;
}

function isEvmTransactionSigningPayload(value: unknown): value is EvmTransactionSigningPayload {
  if (!isRecord(value) || (value.type !== 'evm-native' && value.type !== 'evm-erc20')) return false;
  return Number.isSafeInteger(value.chainId)
    && Number.isSafeInteger(value.nonce)
    && (value.purpose === undefined
      || value.purpose === 'asset-transfer'
      || value.purpose === 'token-approval'
      || value.purpose === 'phone-escrow-deposit')
    && typeof value.to === 'string'
    && typeof value.value === 'string'
    && /^\d+$/.test(value.value)
    && typeof value.gasLimit === 'string'
    && /^\d+$/.test(value.gasLimit)
    && typeof value.gasPrice === 'string'
    && /^\d+$/.test(value.gasPrice)
    && (value.data === undefined || (typeof value.data === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value.data)))
    && (value.type !== 'evm-erc20' || (typeof value.data === 'string' && value.data.length >= 10));
}

function containsForbiddenWalletSecret(value: unknown): boolean {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  const forbidden = new Set([
    'entropy',
    'mnemonic',
    'mnemonicwords',
    'privatekey',
    'recoveryshare',
    'sarshare',
    'seed',
    'seedphrase',
    'plaintextshare',
    'vaultkey',
    'wrappingkey',
  ]);
  const pending: object[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = key.replace(/[^a-z]/gi, '').toLowerCase();
      if (forbidden.has(normalizedKey)) return true;
      if (isRecord(nested) || Array.isArray(nested)) pending.push(nested);
    }
  }
  return false;
}

export function isSecureSarWalletPayload(value: unknown): value is SecureSarWalletPayload {
  if (!isRecord(value)
    || containsForbiddenWalletSecret(value)
    || typeof value.secureProvisionRef !== 'string'
    || value.secureProvisionRef.length < 16
    || value.secureProvisionRef.length > 256
    || !Array.isArray(value.addresses)
    || value.addresses.length < 1
    || value.addresses.length > 32
    || !Array.isArray(value.recoveryEnvelopes)
    || value.recoveryEnvelopes.length !== 3
    || !isRecord(value.recovery)) return false;
  const groupIds = new Set<string>();
  for (const address of value.addresses) {
    if (!isRecord(address)
      || typeof address.addressGroupId !== 'string'
      || address.addressGroupId.length < 1
      || address.addressGroupId.length > 64
      || typeof address.address !== 'string'
      || address.address.length < 16
      || address.address.length > 256
      || groupIds.has(address.addressGroupId)) return false;
    groupIds.add(address.addressGroupId);
  }
  const factorIndexes = new Set<number>();
  for (const envelope of value.recoveryEnvelopes) {
    if (!isRecord(envelope)
      || (envelope.factorIndex !== 1 && envelope.factorIndex !== 2 && envelope.factorIndex !== 3)
      || factorIndexes.has(envelope.factorIndex)
      || envelope.envelopeVersion !== 1
      || envelope.algorithm !== 'AES-256-GCM'
      || typeof envelope.ivBase64 !== 'string'
      || envelope.ivBase64.length < 16
      || envelope.ivBase64.length > 64
      || typeof envelope.ciphertextBase64 !== 'string'
      || envelope.ciphertextBase64.length < 24
      || envelope.ciphertextBase64.length > 4096
      || typeof envelope.aad !== 'string'
      || envelope.aad.length < 16
      || envelope.aad.length > 512) return false;
    factorIndexes.add(envelope.factorIndex);
  }
  return value.recovery.scheme === 'shamir-gf256'
    && value.recovery.threshold === 2
    && value.recovery.shareCount === 3
    && value.recovery.recombinationVerified === true
    && typeof value.recovery.keyCoreVersion === 'string'
    && value.recovery.keyCoreVersion.length >= 3
    && value.recovery.keyCoreVersion.length <= 128;
}

export function isSecureSarWalletRegistration(value: unknown): value is SecureSarWalletRegistration {
  return isRecord(value)
    && typeof value.keyCoreAttestationProof === 'string'
    && value.keyCoreAttestationProof.length > 20
    && isSecureSarWalletPayload(value);
}

export function isSecureSarWalletImportRegistration(value: unknown): value is SecureSarWalletImportRegistration {
  if (!isRecord(value)
    || typeof value.secureImportRef !== 'string'
    || value.secureImportRef.length < 16
    || value.secureImportRef.length > 256) return false;
  return isSecureSarWalletRegistration({
    ...value,
    secureProvisionRef: value.secureImportRef,
  });
}

export function assertTenantManifest(value: TenantManifest): TenantManifest {
  if (value.schemaVersion !== 1) throw new Error('Unsupported tenant manifest version.');
  if (!value.tenantId || !value.walletName) throw new Error('Tenant identity is incomplete.');
  if (!value.presentation.profileId || !value.presentation.guideVersion) throw new Error('Tenant presentation metadata is incomplete.');
  if (value.identity.onboardingMode !== 'institution-first' && value.identity.onboardingMode !== 'phone-first') {
    throw new Error('Unsupported identity onboarding mode.');
  }
  if (value.identity.phoneVerification !== 'host'
    && value.identity.phoneVerification !== 'development-sms'
    && value.identity.phoneVerification !== 'supabase-auth-solapi') {
    throw new Error('Unsupported phone verification mode.');
  }
  if (!value.identity.consentVersion.trim()) throw new Error('Identity consent version is required.');
  if (value.environment === 'production' && value.identity.phoneVerification === 'development-sms') {
    throw new Error('Development SMS verification is forbidden in production.');
  }
  if (value.presentation.navigation.walletMenu === 'hamburger' && value.presentation.navigation.rootEntry === 'host-tabs') {
    throw new Error('A host-tab root must not add a duplicate wallet hamburger menu.');
  }
  if (!Number.isInteger(value.keyManagement.policyVersion) || value.keyManagement.policyVersion < 1) {
    throw new Error('Key policy version must be a positive integer.');
  }
  if (value.keyManagement.allowedAdapters.length === 0) throw new Error('At least one key adapter is required.');
  if (new Set(value.keyManagement.allowedAdapters).size !== value.keyManagement.allowedAdapters.length) {
    throw new Error('Allowed key adapters must be unique.');
  }
  if (!value.keyManagement.allowedAdapters.includes(value.keyManagement.defaultAdapter)) {
    throw new Error('Default key adapter must be allowed by the tenant.');
  }
  if (!value.enabledModules.includes('wallet-home')) throw new Error('wallet-home is required.');
  if (!Array.isArray(value.assetPolicy.stablecoins)
    || value.assetPolicy.stablecoins.some((symbol) => !/^[A-Z0-9]{2,12}$/.test(symbol))) {
    throw new Error('Stablecoin policy must contain uppercase asset symbols.');
  }
  if (new Set(value.assetPolicy.stablecoins).size !== value.assetPolicy.stablecoins.length) {
    throw new Error('Stablecoin policy symbols must be unique.');
  }
  const sarAdapterEnabled = value.keyManagement.allowedAdapters.includes('took-sar');
  const sarModuleEnabled = value.enabledModules.includes('sar-recovery');
  if (sarAdapterEnabled !== sarModuleEnabled) {
    throw new Error('took SAR adapter and sar-recovery module must be enabled or disabled together.');
  }
  if (value.keyManagement.recoveryRequirement === 'sar-required') {
    if (value.keyManagement.defaultAdapter !== 'took-sar' || value.keyManagement.allowedAdapters.some((id) => id !== 'took-sar')) {
      throw new Error('sar-required policy permits only took SAR.');
    }
  }
  if (value.keyManagement.recoveryRequirement === 'sar-preferred') {
    if (!sarAdapterEnabled || value.keyManagement.defaultAdapter !== 'took-sar') {
      throw new Error('sar-preferred policy requires took SAR as the enabled default.');
    }
  }
  if (value.keyManagement.recoveryRequirement === 'provider-recovery-accepted') {
    const providerEnabled = value.keyManagement.allowedAdapters.some((id) => id !== 'took-sar');
    if (!providerEnabled) throw new Error('provider-recovery-accepted policy requires a provider adapter.');
  }
  return value;
}
