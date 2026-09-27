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
export type HostAuthenticationResult = 'authenticated' | 'cancelled';
export type WalletImportMethod = 'mnemonic' | 'private-key';
export type WalletProvisioningOrigin = 'created' | 'imported';
export type SecureWalletImportResult =
  | { status: 'completed'; secureImportRef: string }
  | { status: 'cancelled' };

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

export interface SecureSarWalletRegistration {
  secureProvisionRef: string;
  addresses: readonly PublicWalletAddressRegistration[];
  recoveryEnvelopes: readonly SarRecoveryEnvelopeRegistration[];
  recovery: SarRecoveryRegistration;
}

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
  symbol: string;
  name: string;
  network: string;
  balanceAtomic: string;
  balanceDisplay: string;
  fiat?: {
    currency: 'KRW';
    display: string;
    asOf: string;
    stale: boolean;
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
}

export type ReadyWalletHomePayload = Extract<WalletHomePayload, { status: 'ready' }>;

export interface ProvisionWalletRequest {
  idempotencyKey: string;
  keyAdapter: KeyAdapterId;
  recoverySetupAcknowledged: boolean;
  source:
    | { type: 'new' }
    | ({ type: 'secure-new' } & SecureSarWalletRegistration)
    | { type: 'secure-import'; method: WalletImportMethod; secureImportRef: string };
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
    };

export type WalletToHostMessage =
  | { type: 'took-wss:ready'; protocolVersion: 1 }
  | { type: 'took-wss:bootstrapped'; protocolVersion: 1; tenantId: string; sessionId: string }
  | { type: 'took-wss:navigation'; protocolVersion: 1; route: string }
  | { type: 'took-wss:shell-change'; protocolVersion: 1; mode: WalletShellMode }
  | { type: 'took-wss:host-auth-request'; protocolVersion: 1; requestId: string; purpose: HostAuthenticationPurpose }
  | { type: 'took-wss:secure-sar-create-request'; protocolVersion: 1; requestId: string }
  | { type: 'took-wss:secure-import-request'; protocolVersion: 1; requestId: string; method: WalletImportMethod }
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
    && typeof asset.symbol === 'string'
    && typeof asset.name === 'string'
    && typeof asset.network === 'string'
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
    return typeof value.requestId === 'string'
      && (value.result === 'authenticated' || value.result === 'cancelled');
  }
  if (value.type === 'took-wss:secure-import-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.result)) return false;
    if (value.result.status === 'cancelled') return true;
    return value.result.status === 'completed'
      && typeof value.result.secureImportRef === 'string'
      && value.result.secureImportRef.length >= 16
      && value.result.secureImportRef.length <= 256;
  }
  if (value.type === 'took-wss:secure-sar-create-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.result)) return false;
    if (value.result.status === 'cancelled') return true;
    return value.result.status === 'completed' && isSecureSarWalletRegistration(value.result);
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
  if (value.type === 'took-wss:error') return typeof value.code === 'string';
  return false;
}

export function isSecureSarWalletRegistration(value: unknown): value is SecureSarWalletRegistration {
  if (!isRecord(value)
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
