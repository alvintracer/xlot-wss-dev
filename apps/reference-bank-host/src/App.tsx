import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { ArrowsClockwise, Bank, CheckCircle, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { isRecord, tookRelayAuthorizationMessage } from '@took-wss/contracts';
import type {
  CreateSessionResponse,
  HostAuthenticationPurpose,
  HostAuthenticationResult,
  HostCapabilities,
  HostRecipientPickResult,
  KeyAdapterId,
  SecureSarWalletCreationResult,
  SecureSarVaultEnrollmentResult,
  SecureSarWalletPayload,
  SecureTransactionSigningRequest,
  SecureTransactionSigningResult,
  SecureWalletImportResult,
  WalletImportMethod,
  WalletShellMode,
  WalletToHostMessage,
  TenantManifest,
} from '@took-wss/contracts';
import { WssHostClient } from '@took-wss/host-sdk';
import { KEY_ADAPTERS } from '@took-wss/key-adapters';
import { ReferenceHostSarKeyCore, type PreparedSarWallet, type SarAddressGroupId, type SarWalletCreationResult } from '@took-wss/sar-key-core';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { kiwoomInstallLanding } from '@took-wss/tenant-kiwoom/install-landing';
import { jbManifest } from '@took-wss/tenant-jb';
import { jbInstallLanding } from '@took-wss/tenant-jb/install-landing';
import { namuManifest } from '@took-wss/tenant-namu';
import { namuInstallLanding } from '@took-wss/tenant-namu/install-landing';
import { shinhanManifest } from '@took-wss/tenant-shinhan';
import { shinhanInstallLanding } from '@took-wss/tenant-shinhan/install-landing';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';
import { getHostChromeProfile } from './hostChromeRegistry';
import { HostSecurityOverlay, type HostSecurityView } from './HostSecurityOverlay';
import { HostRecipientPicker } from './HostRecipientPicker';
import { startPwaThirdwebRedirect } from './pwaThirdwebRedirect';
import { clearIncomingClaimCode, readIncomingClaimCode } from './claimDeepLink';
import { transactionSigningRequestMatches } from './transactionSigningRequestMatches';
import { decryptSarVaultShares, encryptSarVaultShares, type EncryptedSarVaultShare } from './sarVaultCrypto';
import { decodeFactorShare, decryptPasswordShare, encryptPasswordShare, pairFactors, plainFactorShare, type PasswordShareEnvelope, type PlainFactorShare, type SarVaultPair } from './sarVaultCryptoV2';
import { createLocalSarVault, getLocalDeviceKey, openLocalSarVault, readLocalSarVault, removeLocalSarVault, replaceLocalSarVaultPin, saveLocalSarVault as writeLocalSarVault } from './localSarVault';
import { appPinScope, ensureAppPin, hasAppPin, verifyAppPin } from './appPin';
import { sarMasterPasswordError } from './sarMasterPasswordPolicy';
import { handleNativeDeviceRequest, isTrustedNativeDeviceRequest, type ExchangePersonalSignRequest } from './nativeDeviceBridge';
import { ExchangeSignLoading, ExchangeSignPanel } from './ExchangeSignPanel';
import { HostAppSettings } from './HostAppSettings';
import { PreviewKeypadProvider } from './PreviewKeypadContext';
import { biometricPinEnabled, readBiometricPin } from './nativeBiometricPin';
import { computedHexColor, setNativeSystemBarSurface } from './nativeSystemBars';

const publicPreviewEnabled = import.meta.env.VITE_WSS_PUBLIC_PREVIEW === 'true';
const previewTenant = import.meta.env.VITE_WSS_PREVIEW_TENANT || 'kiwoom';
const appOnlyPreview = publicPreviewEnabled && window.location.pathname.replace(/\/$/, '') === `/${previewTenant}/app`;
const referenceHostEnabled = import.meta.env.DEV || publicPreviewEnabled;
const bffUrl = publicPreviewEnabled
  ? `${window.location.origin}/api`
  : import.meta.env.VITE_WSS_BFF_URL || 'http://localhost:4100';
const localDevelopmentInstitutionKey = import.meta.env.DEV ? 'local-wss-development-only' : '';
const previewCustomerRef = (() => {
  if (!publicPreviewEnabled) {
    const requested = new URLSearchParams(window.location.search).get('customerRef')?.trim();
    if (requested && /^[a-zA-Z0-9._:-]{3,128}$/.test(requested)) return requested;
    return import.meta.env.DEV ? 'demo-customer-001' : '';
  }
  const storageKey = `took-wss:${previewTenant}-preview-customer`;
  let stored: string | undefined;
  try { stored = window.localStorage.getItem(storageKey)?.trim(); } catch { /* Private browsing may block storage. */ }
  if (stored && /^[a-zA-Z0-9._:-]{3,128}$/.test(stored)) return stored;
  const generated = `${previewTenant}-mobile-preview-${crypto.randomUUID()}`;
  try { window.localStorage.setItem(storageKey, generated); } catch { /* The signed cookie still scopes this session. */ }
  return generated;
})();
const hostCapabilities: HostCapabilities = {
  handlesSafeArea: true,
  rendersRootHeader: true,
  rendersRootTabs: true,
  canScanQr: true,
  canUseContacts: Boolean((navigator as Navigator & { contacts?: { select?: unknown } }).contacts?.select),
  canOpenRecovery: true,
  canLinkExternalWallet: true,
  canSecureWalletImport: referenceHostEnabled,
  canCreateSecureSarWallet: referenceHostEnabled,
};

const referenceHostSarKeyCore = new ReferenceHostSarKeyCore();

function tenantOption(manifest: TenantManifest, landing?: {
  brandName: string; iconFile: string; fontFamily: string;
  colors: { primary: string; primaryInk: string; ink: string };
}) {
  return {
    label: manifest.walletName,
    institutionName: manifest.institutionName,
    institutionLabel: manifest.brand.logoText,
    presentationProfileId: manifest.presentation.profileId,
    secureKeypadLayout: manifest.presentation.secureKeypadLayout ?? 'four-column',
    previewKeypadKeys: manifest.presentation.previewKeypadKeys,
    nativeAuthRedirectUri: manifest.presentation.nativeAuthRedirectUri,
    focusedFlow: manifest.presentation.navigation.focusedFlow,
    loadingCanvas: manifest.brand.surfaceColor,
    loadingInk: manifest.brand.textColor,
    loadingPrimary: manifest.brand.primaryColor,
    exchangeRouterBrand: {
      name: landing?.brandName ?? manifest.walletName,
      iconFile: landing?.iconFile.replace(/-512\.png$/, '-192.png') ?? 'wss-preview-192.png',
      color: landing?.colors.primary ?? manifest.brand.primaryColor,
      ink: landing?.colors.ink ?? manifest.brand.textColor,
      primaryInk: landing?.colors.primaryInk ?? manifest.brand.textColor,
      fontFamily: landing?.fontFamily ?? 'system-ui, sans-serif',
    },
    defaultAdapter: manifest.keyManagement.defaultAdapter,
    adapters: manifest.keyManagement.allowedAdapters.filter((id) => id !== 'fsl-mpc').map((id) => ({
      id,
      label: `${KEY_ADAPTERS[id].label}${id === manifest.keyManagement.defaultAdapter ? ' · 기본' : ''}`,
    })),
  };
}

const tenantOptions = {
  kiwoom: tenantOption(kiwoomManifest, kiwoomInstallLanding),
  jb: tenantOption(jbManifest, jbInstallLanding),
  namu: tenantOption(namuManifest, namuInstallLanding),
  shinhan: tenantOption(shinhanManifest, shinhanInstallLanding),
  'reference-bank': tenantOption(referenceBankManifest),
};

type TenantId = keyof typeof tenantOptions;

type SecurityCeremony =
  | Extract<HostSecurityView, { type: 'authentication' }>
  | (Extract<HostSecurityView, { type: 'sar-backup' }> & { prepared: PreparedSarWallet })
  | Extract<HostSecurityView, { type: 'sar-enrollment' }>
  | Extract<HostSecurityView, { type: 'recovery-reveal' }>
  | Extract<HostSecurityView, { type: 'exchange-signing' }>
  | Extract<HostSecurityView, { type: 'wallet-import' }>
  | Extract<HostSecurityView, { type: 'transaction-signing' }>;

type SarUnlockCeremony = Extract<SecurityCeremony, { type: 'transaction-signing' | 'recovery-reveal' | 'exchange-signing' }>;

function sarUnlockWalletId(active: SarUnlockCeremony): string {
  return active.type === 'transaction-signing' ? active.request.walletId : active.walletId;
}

function sarUnlockAddress(active: SarUnlockCeremony): { group: SarAddressGroupId; address: string } {
  if (active.type === 'recovery-reveal') return { group: active.addressGroup, address: active.address };
  if (active.type === 'exchange-signing') return { group: 'evm', address: active.address };
  return { group: signingAddressGroup(active.request), address: active.request.fromAddress };
}

function personalSignBytes(message: string): string | Uint8Array {
  if (!message.startsWith('0x')) return message;
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(message)) throw new Error('invalid_sign_message');
  return Uint8Array.from(message.slice(2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

type PendingExchangeSign = ExchangePersonalSignRequest & {
  walletLabel: string; keyAdapter: KeyAdapterId;
  localVaultAvailable: boolean;
  phoneMasked?: string; emailMasked?: string;
  error?: string;
  resolve: (signature: string) => void; reject: (error: Error) => void;
};

interface SarVaultChallenge {
  challengeId: string;
  purpose: 'enroll' | 'unlock';
  phoneMasked: string;
  emailMasked: string;
  expiresAt: string;
}

interface PendingVaultOperation {
  challengeId: string;
  purpose: 'enroll' | 'unlock';
  accessToken?: string;
  encryptedShares?: readonly [EncryptedSarVaultShare, EncryptedSarVaultShare, EncryptedSarVaultShare];
  remoteShares?: readonly [EncryptedSarVaultShare, EncryptedSarVaultShare];
  temporaryKeyHandle?: string;
  enrollmentStored?: boolean;
}

interface PendingSarV2Enrollment {
  walletId: string;
  secureRef: string;
  addressGroup?: SarAddressGroupId;
  address?: string;
  resumedSecureRef?: boolean;
  passwordEnvelope?: PasswordShareEnvelope;
  challengeId?: string;
  enrollmentToken?: string;
}

interface PendingSarV2Unlock {
  challengeId: string;
  pair: SarVaultPair;
  phoneAccessToken?: string;
  emailAccessToken?: string;
}

async function sarVaultRequest<T>(
  walletId: string,
  action: string,
  method: 'GET' | 'POST' | 'PUT',
  sessionToken: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${bffUrl}/v1/wallets/${encodeURIComponent(walletId)}/sar-vault/${action}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof result?.error === 'string' ? result.error : 'vault_unavailable');
  }
  return response.json() as Promise<T>;
}

async function sarVaultV2Request<T>(
  walletId: string, action: string, method: 'GET' | 'POST' | 'PUT',
  sessionToken: string, body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${bffUrl}/v1/wallets/${encodeURIComponent(walletId)}/sar-vault-v2/${action}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof result?.error === 'string' ? result.error : 'vault_unavailable');
  }
  return response.json() as Promise<T>;
}

async function ownedSarWalletAddress(walletId: string, token: string): Promise<{
  group: SarAddressGroupId; address: string;
}> {
  const response = await fetch(`${bffUrl}/v1/wallets/${encodeURIComponent(walletId)}/home`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (!response.ok) throw new Error('wallet_unavailable');
  const home = await response.json() as unknown;
  if (!isRecord(home) || home.status !== 'ready' || !isRecord(home.wallet)
    || home.wallet.walletId !== walletId || home.wallet.keyAdapter !== 'took-sar'
    || !Array.isArray(home.networks)) throw new Error('wallet_unavailable');
  const networks = home.networks.filter((item: unknown) => isRecord(item)
    && typeof item.address === 'string' && item.addressStatus === 'ready') as Array<{
      addressGroupId: SarAddressGroupId; address: string;
    }>;
  const preferred = networks.find((item) => item.addressGroupId === 'evm') ?? networks[0];
  if (!preferred || !['evm', 'solana', 'bitcoin', 'tron', 'xrp'].includes(preferred.addressGroupId)) {
    throw new Error('wallet_unavailable');
  }
  return { group: preferred.addressGroupId, address: preferred.address };
}

function signingAddressGroup(request: SecureTransactionSigningRequest): SarAddressGroupId {
  const type = request.transaction.type;
  if (type.startsWith('evm-')) return 'evm';
  if (type.startsWith('solana-')) return 'solana';
  if (type.startsWith('bitcoin-')) return 'bitcoin';
  if (type.startsWith('tron-')) return 'tron';
  return 'xrp';
}

function chooseConfirmationIndexes(wordCount: number): number[] {
  const indexes = new Set<number>();
  while (indexes.size < Math.min(3, wordCount)) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    indexes.add(random % wordCount);
  }
  return [...indexes].sort((left, right) => left - right);
}

function sarPayload(prepared: PreparedSarWallet): SecureSarWalletPayload {
  return sarWalletPayload(prepared.wallet);
}

function sarWalletPayload(wallet: SarWalletCreationResult): SecureSarWalletPayload {
  return {
    secureProvisionRef: wallet.keyHandle,
    addresses: wallet.addresses,
    recoveryEnvelopes: wallet.recoveryEnvelopes,
    recovery: wallet.recovery,
  };
}

export function App({ resumingCreation = false }: { resumingCreation?: boolean }) {
  const [incomingClaimCode, setIncomingClaimCode] = useState(() => appOnlyPreview ? readIncomingClaimCode(previewTenant) : null);
  const [incomingPaymentRequestId] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('payment');
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const recipientResolver = useRef<((result: HostRecipientPickResult) => void) | null>(null);
  const [recipientPicker, setRecipientPicker] = useState<{ chainId: string } | null>(null);
  const [tenantId, setTenantId] = useState<TenantId>(previewTenant as TenantId);
  const [keyAdapter, setKeyAdapter] = useState<KeyAdapterId>(tenantOptions[previewTenant as TenantId].defaultAdapter);
  const [hostTab, setHostTab] = useState(() => getHostChromeProfile(tenantOptions[previewTenant as TenantId].presentationProfileId).initialTab);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appBiometricEnabled, setAppBiometricEnabled] = useState(false);
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [walletScreenReady, setWalletScreenReady] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [events, setEvents] = useState<WalletToHostMessage[]>([]);
  const [hostFeedback, setHostFeedback] = useState<string | null>(null);
  const finishRecipientPick = useCallback((result: HostRecipientPickResult) => {
    const resolve = recipientResolver.current;
    recipientResolver.current = null;
    setRecipientPicker(null);
    resolve?.(result);
  }, []);

  const requestRecipientPick = useCallback(async (mode: 'qr' | 'contacts', chainId: string): Promise<HostRecipientPickResult> => {
    if (!session || recipientResolver.current) return { status: 'cancelled' };
    if (mode === 'contacts') {
      const contacts = (navigator as Navigator & {
        contacts?: { select: (properties: string[], options: { multiple: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>> };
      }).contacts;
      if (!contacts?.select) return { status: 'cancelled' };
      try {
        const selected = await contacts.select(['name', 'tel'], { multiple: false });
        const phone = selected[0]?.tel?.[0]?.trim();
        return phone ? { status: 'selected', kind: 'phone', value: phone.slice(0, 48),
          ...(selected[0]?.name?.[0] ? { label: selected[0].name[0].slice(0, 80) } : {}) } : { status: 'cancelled' };
      } catch { return { status: 'cancelled' }; }
    }
    return new Promise((resolve) => {
      recipientResolver.current = resolve;
      setRecipientPicker({ chainId });
    });
  }, [session]);

  useEffect(() => () => finishRecipientPick({ status: 'cancelled' }), [finishRecipientPick]);
  const [shellMode, setShellMode] = useState<WalletShellMode>('root');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewAccessCode, setPreviewAccessCode] = useState(() => (
    publicPreviewEnabled ? window.sessionStorage.getItem('took-wss:preview-access-code') ?? '' : ''
  ));
  const [securityCeremony, setSecurityCeremony] = useState<SecurityCeremony | null>(null);
  const [pendingExchangeSign, setPendingExchangeSign] = useState<PendingExchangeSign | null>(null);
  useEffect(() => {
    if (!session || !securityCeremony && !pendingExchangeSign) return;
    let active = true;
    void biometricPinEnabled(appPinScope(tenantId, session.sessionToken)).then((enabled) => { if (active) setAppBiometricEnabled(enabled); });
    return () => { active = false; };
  }, [securityCeremony?.id, pendingExchangeSign?.walletId, session, tenantId]);
  const pendingExchangeSignRef = useRef<PendingExchangeSign | null>(null);
  const [checkingExchangeSign, setCheckingExchangeSign] = useState(false);
  const checkingExchangeSignRef = useRef(false);
  const exchangeSignActionsRef = useRef<{ approve: (pin: string) => Promise<void>; cancel: () => void } | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const securityCeremonyRef = useRef<SecurityCeremony | null>(null);
  const sarPreparationInProgress = useRef(false);
  const autoStartAttempted = useRef(false);
  const stageRef = useRef<HTMLElement>(null);
  const authenticationResolver = useRef<((result: HostAuthenticationResult) => void) | null>(null);
  const sarResolver = useRef<((result: SecureSarWalletCreationResult) => void) | null>(null);
  const sarEnrollmentResolver = useRef<((result: SecureSarVaultEnrollmentResult) => void) | null>(null);
  const walletImportResolver = useRef<((result: SecureWalletImportResult) => void) | null>(null);
  const transactionSigningResolver = useRef<((result: SecureTransactionSigningResult) => void) | null>(null);
  const pendingVaultOperation = useRef<PendingVaultOperation | null>(null);
  const pendingSarV2Enrollment = useRef<PendingSarV2Enrollment | null>(null);
  const pendingSarV2Unlock = useRef<PendingSarV2Unlock | null>(null);
  const pendingAppPinMigration = useRef<{ scope: string; walletId: string; pin: string } | null>(null);
  const hostChrome = getHostChromeProfile(tenantOptions[tenantId].presentationProfileId);
  const HostHeader = hostChrome.Header;
  const HostNavigation = hostChrome.Navigation;
  const HostPreview = hostChrome.Preview;
  const showWallet = !HostPreview || hostTab === hostChrome.walletTab;
  const showRootChrome = shellMode === 'root' || tenantOptions[tenantId].focusedFlow === 'keep-host-chrome';

  useEffect(() => {
    if (!appOnlyPreview) return;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const originalTheme = themeColor?.content;
    const originalHtmlBackground = document.documentElement.style.backgroundColor;
    const originalBodyBackground = document.body.style.backgroundColor;
    if (shellMode === 'focus') {
      if (themeColor) themeColor.content = '#ffffff';
      document.documentElement.style.backgroundColor = '#ffffff';
      document.body.style.backgroundColor = '#ffffff';
    }
    return () => {
      if (themeColor && originalTheme !== undefined) themeColor.content = originalTheme;
      document.documentElement.style.backgroundColor = originalHtmlBackground;
      document.body.style.backgroundColor = originalBodyBackground;
    };
  }, [shellMode]);

  useEffect(() => {
    if (!appOnlyPreview) return;
    const phone = stageRef.current?.querySelector('.phone') ?? null;
    const whiteSurface = shellMode === 'focus' || appSettingsOpen || securityCeremony !== null || recipientPicker !== null || pendingExchangeSign !== null || checkingExchangeSign;
    const loadingSurface = !walletScreenReady || status === 'error';
    const canvas = tenantOptions[tenantId].loadingCanvas;
    const topColor = whiteSurface ? '#ffffff' : loadingSurface ? canvas
      : computedHexColor(phone?.querySelector(':scope > header') ?? null, canvas);
    const bottomColor = whiteSurface ? '#ffffff' : loadingSurface ? canvas
      : computedHexColor(phone?.querySelector(':scope > nav') ?? null, canvas);
    void setNativeSystemBarSurface(topColor, bottomColor).catch(() => undefined);
  }, [appSettingsOpen, checkingExchangeSign, hostTab, pendingExchangeSign, recipientPicker, securityCeremony, shellMode, status, tenantId, walletScreenReady]);

  useEffect(() => {
    if (!appOnlyPreview) return;
    const stage = stageRef.current;
    if (!stage) return;
    const updateVisibleHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      stage.style.setProperty('--host-visible-height', `${Math.round(height)}px`);
      stage.parentElement?.style.setProperty('--host-visible-height', `${Math.round(height)}px`);
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && stage.contains(focused) && focused.matches('input, textarea')) {
        const content = focused.closest('.host-security-content');
        if (content instanceof HTMLElement) {
          const inputRect = focused.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          if (inputRect.bottom > contentRect.bottom - 20) content.scrollTop += inputRect.bottom - contentRect.bottom + 20;
        }
      }
    };
    updateVisibleHeight();
    window.addEventListener('resize', updateVisibleHeight);
    window.visualViewport?.addEventListener('resize', updateVisibleHeight);
    stage.addEventListener('focusin', updateVisibleHeight);
    return () => {
      window.removeEventListener('resize', updateVisibleHeight);
      window.visualViewport?.removeEventListener('resize', updateVisibleHeight);
      stage.removeEventListener('focusin', updateVisibleHeight);
    };
  }, []);

  const showSecurityCeremony = useCallback((ceremony: SecurityCeremony | null) => {
    securityCeremonyRef.current = ceremony;
    setSecurityCeremony(ceremony);
  }, []);

  const cancelSecurityCeremony = useCallback(() => {
    const active = securityCeremonyRef.current;
    if (!active) return;
    if (active.type === 'authentication') {
      authenticationResolver.current?.({ status: 'cancelled' });
      authenticationResolver.current = null;
    } else if (active.type === 'sar-backup') {
      void referenceHostSarKeyCore.discardWallet(active.prepared.wallet.keyHandle);
      sarResolver.current?.({ status: 'cancelled' });
      sarResolver.current = null;
    } else if (active.type === 'wallet-import') {
      walletImportResolver.current?.({ status: 'cancelled' });
      walletImportResolver.current = null;
    } else if (active.type === 'sar-enrollment') {
      if (pendingSarV2Enrollment.current?.resumedSecureRef
        || pendingSarV2Enrollment.current?.passwordEnvelope) {
        void referenceHostSarKeyCore.discardWallet(pendingSarV2Enrollment.current.secureRef);
      }
      pendingSarV2Enrollment.current = null;
      sarEnrollmentResolver.current?.({ status: 'cancelled' });
      sarEnrollmentResolver.current = null;
    } else if (active.type === 'recovery-reveal') {
      pendingSarV2Unlock.current = null;
      void referenceHostSarKeyCore.discardSignersForAddress(active.addressGroup, active.address);
    } else if (active.type === 'exchange-signing') {
      pendingSarV2Unlock.current = null;
      void referenceHostSarKeyCore.discardSignersForAddress('evm', active.address);
      const pending = pendingExchangeSignRef.current;
      pendingExchangeSignRef.current = null;
      setPendingExchangeSign(null);
      pending?.reject(new Error('서명을 취소했어요.'));
    } else {
      if (active.type === 'transaction-signing' && (active.vaultMode === 'local-unlock'
        || active.vaultMode === 'sar-v2-unlock' || active.vaultMode === 'ready')) {
        void referenceHostSarKeyCore.discardSignersForAddress(signingAddressGroup(active.request), active.request.fromAddress);
      }
      pendingSarV2Unlock.current = null;
      if (pendingVaultOperation.current?.temporaryKeyHandle) {
        void referenceHostSarKeyCore.discardWallet(pendingVaultOperation.current.temporaryKeyHandle);
      }
      pendingVaultOperation.current = null;
      transactionSigningResolver.current?.({ status: 'cancelled' });
      transactionSigningResolver.current = null;
    }
    pendingAppPinMigration.current = null;
    showSecurityCeremony(null);
  }, [showSecurityCeremony]);

  const issueDevelopmentHostAuthorization = useCallback(async (
    purpose: HostAuthenticationPurpose,
    activeSessionToken: string,
  ): Promise<Extract<HostAuthenticationResult, { status: 'authenticated' }>> => {
    const response = await fetch(`${bffUrl}/v1/development/host-authorizations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeSessionToken}`,
        'Content-Type': 'application/json',
        'x-wss-institution-key': localDevelopmentInstitutionKey,
      },
      body: JSON.stringify({ purpose }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Host authorization was rejected.');
    const result = await response.json() as unknown;
    if (!isRecord(result)
      || result.status !== 'authenticated'
      || typeof result.proof !== 'string'
      || typeof result.expiresAt !== 'string'
      || result.method !== 'development-reference-host') {
      throw new Error('Unsupported host authorization response.');
    }
    if (sessionTokenRef.current !== activeSessionToken) {
      throw new Error('Host session changed during authorization.');
    }
    return result as Extract<HostAuthenticationResult, { status: 'authenticated' }>;
  }, []);

  const requestHostAuthentication = useCallback(async (purpose: HostAuthenticationPurpose): Promise<HostAuthenticationResult> => {
    if (!referenceHostEnabled
      || !session
      || !sessionTokenRef.current
      || securityCeremonyRef.current) {
      return { status: 'cancelled' };
    }
    if (purpose === 'wallet-provisioning') {
      try {
        const result = await issueDevelopmentHostAuthorization(purpose, sessionTokenRef.current);
        setHostFeedback(`현재 ${tenantOptions[tenantId].institutionLabel} 세션에 지갑 등록용 일회용 증빙을 연결했습니다.`);
        return result;
      } catch {
        return { status: 'cancelled' };
      }
    }
    return new Promise((resolve) => {
      authenticationResolver.current = resolve;
      showSecurityCeremony({ id: crypto.randomUUID(), type: 'authentication', purpose });
    });
  }, [issueDevelopmentHostAuthorization, session, showSecurityCeremony]);

  const approveHostAuthentication = useCallback(async () => {
    const active = securityCeremonyRef.current;
    if (!session || !sessionTokenRef.current || active?.type !== 'authentication' || !authenticationResolver.current) {
      throw new Error('No active host authentication ceremony.');
    }
    const activeId = active.id;
    const activeSessionToken = sessionTokenRef.current;
    const resolve = authenticationResolver.current;
    const result = await issueDevelopmentHostAuthorization(active.purpose, activeSessionToken);
    if (sessionTokenRef.current !== activeSessionToken
      || securityCeremonyRef.current?.id !== activeId
      || authenticationResolver.current !== resolve) return;
    authenticationResolver.current = null;
    showSecurityCeremony(null);
    setHostFeedback('현재 세션에 묶인 일회용 고객 인증 증빙을 발급했습니다.');
    resolve(result);
  }, [issueDevelopmentHostAuthorization, session, showSecurityCeremony]);

  const requestSecureSarWalletCreation = useCallback(async (): Promise<SecureSarWalletCreationResult> => {
    if (!referenceHostEnabled
      || !session
      || !sessionTokenRef.current
      || securityCeremonyRef.current
      || sarPreparationInProgress.current) return { status: 'cancelled' };
    const activeSessionToken = sessionTokenRef.current;
    sarPreparationInProgress.current = true;
    let prepared: PreparedSarWallet;
    try {
      prepared = await referenceHostSarKeyCore.prepareWallet();
    } finally {
      sarPreparationInProgress.current = false;
    }
    if (sessionTokenRef.current !== activeSessionToken || securityCeremonyRef.current) {
      await referenceHostSarKeyCore.discardWallet(prepared.wallet.keyHandle);
      return { status: 'cancelled' };
    }
    return new Promise((resolve) => {
      sarResolver.current = resolve;
      showSecurityCeremony({
        id: crypto.randomUUID(),
        type: 'sar-backup',
        mnemonicWords: prepared.mnemonicWords,
        confirmationIndexes: chooseConfirmationIndexes(prepared.mnemonicWords.length),
        prepared,
      });
    });
  }, [session, showSecurityCeremony]);

  const confirmSeedBackup = useCallback(async () => {
    const active = securityCeremonyRef.current;
    if (!session || !sessionTokenRef.current || active?.type !== 'sar-backup' || !sarResolver.current) {
      throw new Error('No active SAR backup ceremony.');
    }
    const activeId = active.id;
    const activeSessionToken = sessionTokenRef.current;
    const resolve = sarResolver.current;
    const registration = sarPayload(active.prepared);
    const response = await fetch(`${bffUrl}/v1/development/sar-key-core-attestations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeSessionToken}`,
        'Content-Type': 'application/json',
        'x-wss-institution-key': localDevelopmentInstitutionKey,
      },
      body: JSON.stringify({ registration }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('SAR key-core attestation was rejected.');
    const result = await response.json() as unknown;
    if (!isRecord(result) || typeof result.proof !== 'string' || typeof result.expiresAt !== 'string') {
      throw new Error('Unsupported SAR key-core attestation response.');
    }
    if (sessionTokenRef.current !== activeSessionToken
      || securityCeremonyRef.current?.id !== activeId
      || sarResolver.current !== resolve) return;
    sarResolver.current = null;
    showSecurityCeremony(null);
    setHostFeedback(null);
    resolve({ status: 'completed', ...registration, keyCoreAttestationProof: result.proof });
  }, [session, showSecurityCeremony]);

  const requestSecureWalletImport = useCallback(async (
    method: WalletImportMethod,
  ): Promise<SecureWalletImportResult> => {
    if (!referenceHostEnabled
      || !session
      || !sessionTokenRef.current
      || securityCeremonyRef.current
      || walletImportResolver.current) return { status: 'cancelled' };
    return new Promise((resolve) => {
      walletImportResolver.current = resolve;
      showSecurityCeremony({ id: crypto.randomUUID(), type: 'wallet-import', method });
    });
  }, [session, showSecurityCeremony]);

  const confirmSecureWalletImport = useCallback(async (
    method: WalletImportMethod,
    secret: string,
  ) => {
    const active = securityCeremonyRef.current;
    const resolve = walletImportResolver.current;
    if (!session || !sessionTokenRef.current || active?.type !== 'wallet-import' || active.method !== method || !resolve) {
      throw new Error('No active wallet import ceremony.');
    }
    const activeId = active.id;
    const activeSessionToken = sessionTokenRef.current;
    let wallet: SarWalletCreationResult | null = null;
    try {
      wallet = method === 'mnemonic'
        ? await referenceHostSarKeyCore.prepareImportedMnemonic(secret)
        : await referenceHostSarKeyCore.prepareImportedEvmPrivateKey(secret);
      const registration = sarWalletPayload(wallet);
      const response = await fetch(`${bffUrl}/v1/development/sar-key-core-attestations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeSessionToken}`,
          'Content-Type': 'application/json',
          'x-wss-institution-key': localDevelopmentInstitutionKey,
        },
        body: JSON.stringify({ registration }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('SAR key-core attestation was rejected.');
      const result = await response.json() as unknown;
      if (!isRecord(result) || typeof result.proof !== 'string' || typeof result.expiresAt !== 'string') {
        throw new Error('Unsupported SAR key-core attestation response.');
      }
      if (sessionTokenRef.current !== activeSessionToken
        || securityCeremonyRef.current?.id !== activeId
        || walletImportResolver.current !== resolve) {
        await referenceHostSarKeyCore.discardWallet(wallet.keyHandle);
        return;
      }
      walletImportResolver.current = null;
      showSecurityCeremony(null);
      setHostFeedback(method === 'mnemonic'
        ? '기존 지갑의 공개 주소를 확인하고 자가복구 설정을 준비했습니다.'
        : 'EVM 지갑 주소를 확인하고 자가복구 설정을 준비했습니다.');
      resolve({
        status: 'completed',
        secureImportRef: wallet.keyHandle,
        addresses: wallet.addresses,
        recoveryEnvelopes: wallet.recoveryEnvelopes,
        recovery: wallet.recovery,
        keyCoreAttestationProof: result.proof,
      });
    } catch (error) {
      if (wallet) await referenceHostSarKeyCore.discardWallet(wallet.keyHandle);
      throw error;
    }
  }, [session, showSecurityCeremony]);

  const requestSecureSarVaultEnrollment = useCallback(async (
    walletId: string, secureRef: string,
  ): Promise<SecureSarVaultEnrollmentResult> => {
    const activeToken = sessionTokenRef.current;
    if (!referenceHostEnabled || !session || !activeToken
      || securityCeremonyRef.current || sarEnrollmentResolver.current) return { status: 'cancelled' };
    const existing = await sarVaultV2Request<{ enrolled: boolean }>(walletId, 'status', 'GET', activeToken);
    if (sessionTokenRef.current !== activeToken || securityCeremonyRef.current) return { status: 'cancelled' };
    if (existing.enrolled) {
      if (secureRef) await referenceHostSarKeyCore.discardWallet(secureRef);
      return { status: 'completed' };
    }
    const material = secureRef
      ? await referenceHostSarKeyCore.exportVaultSharesForKeyHandle(secureRef).catch(() => null)
      : null;
    if (material) for (const share of material.shares) share.fill(0);
    const resumeLocal = !material;
    if (resumeLocal && !readLocalSarVault(tenantId, walletId)) return { status: 'cancelled' };
    const ownedAddress = resumeLocal ? await ownedSarWalletAddress(walletId, activeToken) : null;
    if (sessionTokenRef.current !== activeToken || securityCeremonyRef.current) return { status: 'cancelled' };
    pendingSarV2Enrollment.current = {
      walletId, secureRef: resumeLocal ? '' : secureRef,
      ...(ownedAddress ? { addressGroup: ownedAddress.group, address: ownedAddress.address } : {}),
    };
    return new Promise((resolve) => {
      sarEnrollmentResolver.current = resolve;
      showSecurityCeremony({ id: crypto.randomUUID(), type: 'sar-enrollment', walletId, secureRef: resumeLocal ? '' : secureRef });
    });
  }, [session, showSecurityCeremony, tenantId]);

  const unlockExistingLocalSarVault = useCallback(async (input: { pin: string } | { masterPassword: string }) => {
    const active = securityCeremonyRef.current;
    const pending = pendingSarV2Enrollment.current;
    if (active?.type !== 'sar-enrollment' || !pending || pending.secureRef
      || !pending.addressGroup || !pending.address) throw new Error('vault_ceremony_missing');
    const record = readLocalSarVault(tenantId, pending.walletId);
    if (!record) throw new Error('local_vault_unavailable');
    const material = 'pin' in input
      ? await (async () => {
          const key = await getLocalDeviceKey(tenantId, pending.walletId, false);
          if (!key) throw new Error('local_vault_unavailable');
          return openLocalSarVault(tenantId, pending.walletId, record, { pin: input.pin, deviceKey: key });
        })()
      : await openLocalSarVault(tenantId, pending.walletId, record, input);
    try {
      const resumedKeyHandle = await referenceHostSarKeyCore.resumeWalletFromVaultShares(
        material.shares, material.kind, pending.addressGroup, pending.address,
      );
      if (securityCeremonyRef.current?.id !== active.id) {
        await referenceHostSarKeyCore.discardWallet(resumedKeyHandle);
        return;
      }
      pending.secureRef = resumedKeyHandle;
      pending.resumedSecureRef = true;
    } finally {
      for (const share of material.shares) share.fill(0);
    }
  }, [tenantId]);

  const saveLocalSarVault = useCallback(async (masterPassword: string, pin: string) => {
    if (sarMasterPasswordError(masterPassword)) throw new Error('vault_password_policy_invalid');
    const active = securityCeremonyRef.current;
    const pending = pendingSarV2Enrollment.current;
    if (active?.type !== 'sar-enrollment' || !pending || pending.walletId !== active.walletId
      || !pending.secureRef || active.secureRef && pending.secureRef !== active.secureRef) {
      throw new Error('vault_ceremony_missing');
    }
    const material = await referenceHostSarKeyCore.exportVaultSharesForKeyHandle(pending.secureRef);
    try {
      await ensureAppPin(appPinScope(tenantId, sessionTokenRef.current), pin);
      const deviceKey = await getLocalDeviceKey(tenantId, pending.walletId, true);
      if (!deviceKey) throw new Error('local_vault_unavailable');
      const localRecord = await createLocalSarVault(
        tenantId, pending.walletId, masterPassword, pin, material, deviceKey,
      );
      const passwordEnvelope = await encryptPasswordShare(
        tenantId, pending.walletId, masterPassword, material.kind, material.shares[0],
      );
      if (securityCeremonyRef.current?.id !== active.id || pendingSarV2Enrollment.current !== pending) {
        throw new Error('vault_ceremony_missing');
      }
      writeLocalSarVault(localRecord);
      pending.passwordEnvelope = passwordEnvelope;
    } finally {
      for (const share of material.shares) share.fill(0);
    }
  }, [tenantId]);

  const startSarV2Enrollment = useCallback(async (phone: string, email: string) => {
    const active = securityCeremonyRef.current;
    const pending = pendingSarV2Enrollment.current;
    const token = sessionTokenRef.current;
    if (!token || active?.type !== 'sar-enrollment' || !pending?.passwordEnvelope) {
      throw new Error('vault_ceremony_missing');
    }
    const started = await sarVaultV2Request<SarVaultChallenge>(
      pending.walletId, 'challenges', 'POST', token, { phone, email },
    );
    if (started.purpose !== 'enroll') throw new Error('vault_already_enrolled');
    pending.challengeId = started.challengeId;
    return started;
  }, []);

  const verifySarV2Code = useCallback(async (factor: 'phone' | 'email', code: string) => {
    const pending = pendingSarV2Enrollment.current;
    const token = sessionTokenRef.current;
    if (!token || !pending?.challengeId || securityCeremonyRef.current?.type !== 'sar-enrollment') {
      throw new Error('vault_ceremony_missing');
    }
    const result = await sarVaultV2Request<{
      phoneVerified: boolean; emailVerified: boolean; enrollmentToken?: string;
    }>(pending.walletId, 'verify', 'POST', token, {
      challengeId: pending.challengeId, factor, code,
    });
    if (result.enrollmentToken) pending.enrollmentToken = result.enrollmentToken;
    return result;
  }, []);

  const completeSarV2Enrollment = useCallback(async () => {
    const active = securityCeremonyRef.current;
    const pending = pendingSarV2Enrollment.current;
    const token = sessionTokenRef.current;
    const resolve = sarEnrollmentResolver.current;
    if (!token || active?.type !== 'sar-enrollment' || !pending?.challengeId
      || !pending.enrollmentToken || !pending.passwordEnvelope || !resolve) {
      throw new Error('vault_authorization_required');
    }
    let status = await sarVaultV2Request<{ enrolled: boolean }>(pending.walletId, 'status', 'GET', token);
    if (!status.enrolled) {
      const parameters = { challengeId: pending.challengeId, enrollmentToken: pending.enrollmentToken };
      await sarVaultV2Request(pending.walletId, 'shares/password', 'PUT', token, {
        ...parameters, share: pending.passwordEnvelope,
      });
      const material = await referenceHostSarKeyCore.exportVaultSharesForKeyHandle(pending.secureRef);
      try {
        for (const [factor, share] of [
          ['phone', material.shares[1]], ['email', material.shares[2]],
        ] as const) {
          await sarVaultV2Request(pending.walletId, `shares/${factor}`, 'PUT', token, {
            ...parameters, share: plainFactorShare(factor, material.kind, share),
          });
        }
      } finally {
        for (const share of material.shares) share.fill(0);
      }
      status = await sarVaultV2Request<{ enrolled: boolean }>(pending.walletId, 'status', 'GET', token);
    }
    if (!status.enrolled) throw new Error('vault_enrollment_incomplete');
    if (securityCeremonyRef.current?.id !== active.id || sarEnrollmentResolver.current !== resolve) return;
    await referenceHostSarKeyCore.discardWallet(pending.secureRef);
    pendingSarV2Enrollment.current = null;
    sarEnrollmentResolver.current = null;
    showSecurityCeremony(null);
    setHostFeedback('이 기기 보관과 자가복구 설정을 완료했습니다.');
    resolve({ status: 'completed' });
  }, [showSecurityCeremony]);

  const requestSecureTransactionSignature = useCallback(async (
    request: SecureTransactionSigningRequest,
  ): Promise<SecureTransactionSigningResult> => {
    if (!referenceHostEnabled
      || !session
      || !sessionTokenRef.current
      || securityCeremonyRef.current
      || transactionSigningResolver.current) return { status: 'cancelled' };
    const approvalPath = request.operation === 'exchange' ? 'exchanges' : request.operation === 'refund' ? 'refunds' : 'transfers';
    const activeSessionToken = sessionTokenRef.current;
    const response = await fetch(`${bffUrl}/v1/${approvalPath}/${encodeURIComponent(request.intentId)}/approval-payload`, {
      headers: { Authorization: `Bearer ${activeSessionToken}` },
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'cancelled' };
    const verifiedRequest = await response.json() as unknown;
    if (!transactionSigningRequestMatches(verifiedRequest, request)
      || sessionTokenRef.current !== activeSessionToken) return { status: 'cancelled' };
    const v2Status = await sarVaultV2Request<{
      enrolled: boolean;
      phoneMasked?: string;
      emailMasked?: string;
    }>(verifiedRequest.walletId, 'status', 'GET', activeSessionToken);
    const vaultStatus = v2Status.enrolled ? null : await sarVaultRequest<{
      enrolled: boolean;
      phoneMasked?: string;
      emailMasked?: string;
    }>(verifiedRequest.walletId, 'status', 'GET', activeSessionToken);
    if (sessionTokenRef.current !== activeSessionToken) return { status: 'cancelled' };
    const addressGroup = signingAddressGroup(verifiedRequest);
    const hasLocalVault = readLocalSarVault(tenantId, verifiedRequest.walletId) !== null;
    if (v2Status.enrolled || vaultStatus?.enrolled || hasLocalVault) {
      await referenceHostSarKeyCore.discardSignersForAddress(addressGroup, verifiedRequest.fromAddress);
    }
    return new Promise((resolve) => {
      transactionSigningResolver.current = resolve;
      const hasSigner = referenceHostSarKeyCore.hasSignerForAddress(addressGroup, verifiedRequest.fromAddress);
      showSecurityCeremony({
        id: crypto.randomUUID(),
        type: 'transaction-signing',
        request: verifiedRequest,
        requiresRecovery: !hasSigner,
        acceptsPrivateKey: addressGroup === 'evm',
        vaultMode: v2Status.enrolled || hasLocalVault
          ? hasLocalVault ? 'local-unlock' : 'sar-v2-unlock'
          : vaultStatus?.enrolled ? 'unlock' : 'setup',
        phoneMasked: v2Status.enrolled ? v2Status.phoneMasked : vaultStatus?.phoneMasked,
        emailMasked: v2Status.enrolled ? v2Status.emailMasked : vaultStatus?.emailMasked,
        remoteEnrolled: v2Status.enrolled,
      });
    });
  }, [session, showSecurityCeremony, tenantId]);

  const requestRecoveryReveal = useCallback(async (walletId: string) => {
    const token = sessionTokenRef.current;
    if (!token || securityCeremonyRef.current) return;
    try {
      const status = await sarVaultV2Request<{
        enrolled: boolean; phoneMasked?: string; emailMasked?: string;
      }>(walletId, 'status', 'GET', token);
      if (!status.enrolled) {
        if (readLocalSarVault(tenantId, walletId)) {
          void requestSecureSarVaultEnrollment(walletId, '').catch(() => {
            setHostFeedback('자가복구 설정을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
          });
        } else {
          setHostFeedback('이 기기에 보관한 정보가 없어요. 복구 구문으로 기존 지갑을 다시 가져와 주세요.');
        }
        return;
      }
      const preferred = await ownedSarWalletAddress(walletId, token);
      if (sessionTokenRef.current !== token || securityCeremonyRef.current) return;
      showSecurityCeremony({
        id: crypto.randomUUID(), type: 'recovery-reveal', walletId,
        addressGroup: preferred.group, address: preferred.address,
        mode: 'unlock', phoneMasked: status.phoneMasked, emailMasked: status.emailMasked,
      });
    } catch {
      setHostFeedback('복구 정보를 열지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }, [requestSecureSarVaultEnrollment, showSecurityCeremony, tenantId]);

  const finishSarV2Unlock = useCallback(async (
    active: SarUnlockCeremony,
    material: { kind: 'mnemonic-entropy' | 'evm-private-key'; shares: [Uint8Array, Uint8Array] },
  ) => {
    const { group, address } = sarUnlockAddress(active);
    try {
      await referenceHostSarKeyCore.restoreVaultSharesForAddress(
        material.shares, material.kind, group, address,
      );
    } finally {
      for (const share of material.shares) share.fill(0);
    }
    if (securityCeremonyRef.current?.id !== active.id) {
      await referenceHostSarKeyCore.discardSignersForAddress(group, address);
      return;
    }
    if (active.type === 'exchange-signing') {
      const pending = pendingExchangeSignRef.current;
      if (!pending || pending.walletId !== active.walletId
        || pending.address.toLowerCase() !== active.address.toLowerCase()) {
        await referenceHostSarKeyCore.discardSignersForAddress(group, address);
        throw new Error('서명 요청이 바뀌었어요.');
      }
      let signature: string;
      let decoded: string | Uint8Array | undefined;
      try {
        decoded = personalSignBytes(pending.message);
        signature = await referenceHostSarKeyCore.signEvmMessageForAddress(active.address, decoded);
      } finally {
        if (decoded instanceof Uint8Array) decoded.fill(0);
        await referenceHostSarKeyCore.discardSignersForAddress(group, address);
      }
      if (securityCeremonyRef.current?.id !== active.id || pendingExchangeSignRef.current !== pending) return;
      pendingSarV2Unlock.current = null;
      pendingExchangeSignRef.current = null;
      showSecurityCeremony(null);
      pending.resolve(signature);
      return;
    }
    pendingSarV2Unlock.current = null;
    if (active.type === 'recovery-reveal') {
      try {
        const secret = await referenceHostSarKeyCore.revealRecoverySecretForAddress(group, address);
        if (securityCeremonyRef.current?.id === active.id) {
          showSecurityCeremony({ ...active, mode: 'display', secret });
        }
      } finally {
        await referenceHostSarKeyCore.discardSignersForAddress(group, address);
      }
    } else {
      showSecurityCeremony({ ...active, vaultMode: 'ready' });
    }
  }, [showSecurityCeremony]);

  const localSarUnlock = useCallback(async (input: { pin: string; legacy?: boolean } | { masterPassword: string }) => {
    const active = securityCeremonyRef.current;
    if (active?.type !== 'transaction-signing' || active.vaultMode !== 'local-unlock') {
      throw new Error('vault_ceremony_missing');
    }
    const walletId = active.request.walletId;
    const record = readLocalSarVault(tenantId, walletId);
    if (!record) throw new Error('local_vault_unavailable');
    const scope = appPinScope(tenantId, sessionTokenRef.current);
    const deviceKey = 'pin' in input ? await getLocalDeviceKey(tenantId, walletId, false) : null;
    if ('pin' in input && !deviceKey) throw new Error('local_vault_unavailable');
    let material: Awaited<ReturnType<typeof openLocalSarVault>>;
    if ('pin' in input && input.legacy) {
      const migration = pendingAppPinMigration.current;
      if (!migration || migration.scope !== scope || migration.walletId !== walletId || !await verifyAppPin(scope, migration.pin)) throw new Error('app_pin_migration_expired');
      material = await openLocalSarVault(tenantId, walletId, record, { pin: input.pin, deviceKey: deviceKey! });
      try { writeLocalSarVault(await replaceLocalSarVaultPin(tenantId, walletId, record, material, migration.pin, deviceKey!)); }
      catch { for (const share of material.shares) share.fill(0); throw new Error('local_vault_unavailable'); }
      pendingAppPinMigration.current = null;
    } else if ('pin' in input) {
      if (hasAppPin(scope) && !await verifyAppPin(scope, input.pin)) throw new Error('app_pin_invalid');
      try { material = await openLocalSarVault(tenantId, walletId, record, { pin: input.pin, deviceKey: deviceKey! }); }
      catch (error) {
        if (hasAppPin(scope) && error instanceof Error && error.message === 'local_vault_unlock_failed') {
          pendingAppPinMigration.current = { scope, walletId, pin: input.pin };
          throw new Error('app_pin_migration_needed');
        }
        throw error;
      }
      if (!hasAppPin(scope)) await ensureAppPin(scope, input.pin);
    } else material = await openLocalSarVault(tenantId, walletId, record, input);
    await finishSarV2Unlock(active, material);
  }, [finishSarV2Unlock, tenantId]);

  const startSarV2Unlock = useCallback(async (pair: SarVaultPair) => {
    const active = securityCeremonyRef.current;
    const token = sessionTokenRef.current;
    if (!token || !active || (active.type !== 'transaction-signing' && active.type !== 'recovery-reveal' && active.type !== 'exchange-signing')
      || active.type === 'recovery-reveal' && active.mode !== 'unlock'
      || active.type === 'transaction-signing' && active.vaultMode !== 'local-unlock'
        && active.vaultMode !== 'sar-v2-unlock') {
      throw new Error('vault_ceremony_missing');
    }
    const started = await sarVaultV2Request<SarVaultChallenge>(
      sarUnlockWalletId(active), 'challenges', 'POST', token, { pair },
    );
    if (started.purpose !== 'unlock') throw new Error('vault_not_enrolled');
    pendingSarV2Unlock.current = { challengeId: started.challengeId, pair };
    return started;
  }, []);

  const verifySarV2UnlockCode = useCallback(async (factor: 'phone' | 'email', code: string) => {
    const active = securityCeremonyRef.current;
    const operation = pendingSarV2Unlock.current;
    const token = sessionTokenRef.current;
    if (!token || !active || (active.type !== 'transaction-signing' && active.type !== 'recovery-reveal' && active.type !== 'exchange-signing') || !operation
      || !pairFactors(operation.pair).includes(factor)) throw new Error('vault_ceremony_missing');
    const result = await sarVaultV2Request<{
      phoneVerified: boolean; emailVerified: boolean; factorAccessToken?: string;
    }>(sarUnlockWalletId(active), 'verify', 'POST', token, {
      challengeId: operation.challengeId, factor, code,
    });
    if (result.factorAccessToken) {
      if (factor === 'phone') operation.phoneAccessToken = result.factorAccessToken;
      else operation.emailAccessToken = result.factorAccessToken;
    }
    return result;
  }, []);

  const completeSarV2Unlock = useCallback(async (input: { password?: string; localPin?: string }) => {
    const active = securityCeremonyRef.current;
    const operation = pendingSarV2Unlock.current;
    const token = sessionTokenRef.current;
    if (!token || !active || (active.type !== 'transaction-signing' && active.type !== 'recovery-reveal' && active.type !== 'exchange-signing') || !operation) {
      throw new Error('vault_ceremony_missing');
    }
    const walletId = sarUnlockWalletId(active);
    const factors = pairFactors(operation.pair);
    let first: { kind: 'mnemonic-entropy' | 'evm-private-key'; share: Uint8Array } | null = null;
    let second: { kind: 'mnemonic-entropy' | 'evm-private-key'; share: Uint8Array } | null = null;
    try {
      const load = async (factor: 'password' | 'phone' | 'email') => {
        if (factor === 'password') {
          if (!input.password) throw new Error('vault_password_too_short');
          const response = await sarVaultV2Request<{ envelope: PasswordShareEnvelope }>(
            walletId, 'password-share', 'GET', token,
          );
          return decryptPasswordShare(tenantId, walletId, input.password, response.envelope);
        }
        const factorAccessToken = factor === 'phone' ? operation.phoneAccessToken : operation.emailAccessToken;
        if (!factorAccessToken) throw new Error('vault_authorization_required');
        const response = await sarVaultV2Request<PlainFactorShare>(
          walletId, `unlock/${factor}`, 'POST', token,
          { challengeId: operation.challengeId, factorAccessToken },
        );
        return decodeFactorShare(factor, response);
      };
      let localDeviceKey: CryptoKey | null = null;
      if (input.localPin) {
        if (!/^\d{6}$/.test(input.localPin) || !input.password) throw new Error('local_vault_invalid');
        await ensureAppPin(appPinScope(tenantId, sessionTokenRef.current), input.localPin);
        if (operation.pair === 'phone-email') {
          const response = await sarVaultV2Request<{ envelope: PasswordShareEnvelope }>(
            walletId, 'password-share', 'GET', token,
          );
          const checked = await decryptPasswordShare(tenantId, walletId, input.password, response.envelope);
          checked.share.fill(0);
        }
        try { localDeviceKey = await getLocalDeviceKey(tenantId, walletId, true);
          if (!localDeviceKey) throw new Error('local_vault_unavailable'); }
        catch { setHostFeedback('이 기기에 지갑을 보관하지 못했어요. 이번 작업은 계속 진행해요.'); }
      }
      first = await load(factors[0]);
      second = await load(factors[1]);
      if (first.kind !== second.kind) throw new Error('vault_shares_invalid');
      let localRecord: Awaited<ReturnType<typeof createLocalSarVault>> | null = null;
      if (localDeviceKey && input.localPin && input.password) {
        try { localRecord = await createLocalSarVault(tenantId, walletId, input.password, input.localPin,
          { kind: first.kind, shares: [first.share, second.share] }, localDeviceKey); }
        catch { setHostFeedback('이 기기에 지갑을 보관하지 못했어요. 이번 작업은 계속 진행해요.'); }
      }
      await finishSarV2Unlock(active, { kind: first.kind, shares: [first.share, second.share] });
      if (localRecord && sessionTokenRef.current === token) {
        try { writeLocalSarVault(localRecord); }
        catch { setHostFeedback('이 기기에 지갑을 보관하지 못했어요. 다음 서명 전에 다시 설정해 주세요.'); }
      }
    } finally {
      first?.share.fill(0);
      second?.share.fill(0);
    }
  }, [finishSarV2Unlock, tenantId]);

  const approveTransaction = useCallback(async () => {
    const active = securityCeremonyRef.current;
    const resolve = transactionSigningResolver.current;
    if (!session || !sessionTokenRef.current || active?.type !== 'transaction-signing' || !resolve) {
      throw new Error('No active transaction signing ceremony.');
    }
    const activeId = active.id;
    const activeSessionToken = sessionTokenRef.current;
    if (!referenceHostSarKeyCore.hasSignerForAddress(signingAddressGroup(active.request), active.request.fromAddress)) {
      throw new Error('vault_locked');
    }
    try {
    const authorization = await issueDevelopmentHostAuthorization(
      active.request.operation === 'exchange' ? 'exchange-approval' : 'transfer-approval',
      activeSessionToken,
    );
    const transaction = active.request.transaction;
    const signedTransaction = transaction.type === 'evm-permit-relay'
      ? await (async () => {
          const walletAuthSignature = await referenceHostSarKeyCore.signEvmMessageForAddress(
            active.request.fromAddress,
            tookRelayAuthorizationMessage(transaction.transfer),
          );
          const relayResponse = await fetch(`${bffUrl}/v1/transfers/${encodeURIComponent(active.request.intentId)}/relay-prepare`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${activeSessionToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAuthSignature }),
            cache: 'no-store',
          });
          if (!relayResponse.ok) throw new Error('relay_preparation_failed');
          const relay = await relayResponse.json() as {
            transferId?: string; chainId?: number; tokenAddress?: string; recipient?: string; spender?: string;
            totalAmount?: string; fee?: string; recipientReceives?: string; nonce?: string; deadline?: number;
            domain?: { name?: string; version?: string; chainId?: number; verifyingContract?: string };
          };
          if (sessionTokenRef.current !== activeSessionToken || securityCeremonyRef.current?.id !== activeId
            || relay.transferId !== transaction.transfer.id
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
            || relay.deadline !== Math.floor(Date.parse(transaction.transfer.expiresAt) / 1000)) {
            throw new Error('relay_preparation_mismatch');
          }
          const permitSignature = await referenceHostSarKeyCore.signEvmPermitForAddress(active.request.fromAddress, {
            domain: {
              name: relay.domain.name,
              version: relay.domain.version,
              chainId: relay.domain.chainId,
              verifyingContract: relay.domain.verifyingContract!,
            },
            spender: relay.spender,
            value: transaction.totalAmountAtomic,
            nonce: relay.nonce,
            deadline: relay.deadline,
          });
          return JSON.stringify({ walletAuthSignature, permitSignature });
        })()
      : transaction.type === 'evm-batch'
      ? JSON.stringify(await Promise.all(transaction.transactions.map((item) => (
          referenceHostSarKeyCore.signEvmTransactionForAddress(active.request.fromAddress, item)
        ))))
      : transaction.type === 'solana-spl' || transaction.type === 'solana-native'
      ? await referenceHostSarKeyCore.signSolanaTransactionForAddress(
          active.request.fromAddress,
          transaction.unsignedTransactionBase64,
          transaction.type === 'solana-spl' ? transaction.sponsorFeePayer : undefined,
        )
      : transaction.type === 'bitcoin-native'
        ? await referenceHostSarKeyCore.signBitcoinTransactionForAddress(
            active.request.fromAddress,
            transaction.unsignedPsbtBase64,
          )
      : transaction.type === 'tron-trc20' || transaction.type === 'tron-native'
        ? await referenceHostSarKeyCore.signTronTransactionForAddress(
            active.request.fromAddress,
            transaction.unsignedTransactionJson,
          )
        : transaction.type === 'xrpl-issued' || transaction.type === 'xrpl-native'
          ? await referenceHostSarKeyCore.signXrplTransactionForAddress(
              active.request.fromAddress,
              transaction.payment,
            )
          : await referenceHostSarKeyCore.signEvmTransactionForAddress(
              active.request.fromAddress,
              transaction,
            );
    if (sessionTokenRef.current !== activeSessionToken
      || securityCeremonyRef.current?.id !== activeId
      || transactionSigningResolver.current !== resolve) return;
    await referenceHostSarKeyCore.discardSignersForAddress(signingAddressGroup(active.request), active.request.fromAddress);
    transactionSigningResolver.current = null;
    pendingVaultOperation.current = null;
    pendingSarV2Unlock.current = null;
    showSecurityCeremony(null);
    setHostFeedback('기기에서 거래 서명을 완료했습니다.');
    resolve({
      status: 'completed',
      intentId: active.request.intentId,
      signedTransaction,
      hostAuthorizationProof: authorization.proof,
    });
    } catch (error) {
      await referenceHostSarKeyCore.discardSignersForAddress(signingAddressGroup(active.request), active.request.fromAddress);
      if (securityCeremonyRef.current?.id === activeId) {
        showSecurityCeremony({
          ...active,
          vaultMode: readLocalSarVault(tenantId, active.request.walletId)
            ? 'local-unlock' : active.remoteEnrolled ? 'sar-v2-unlock' : 'unlock',
        });
      }
      throw error;
    }
  }, [issueDevelopmentHostAuthorization, session, showSecurityCeremony, tenantId]);

  const startSarVaultSetup = useCallback(async (input: {
    secret?: string;
    password: string;
    phone: string;
    email: string;
  }): Promise<SarVaultChallenge> => {
    const active = securityCeremonyRef.current;
    const token = sessionTokenRef.current;
    if (!token || active?.type !== 'transaction-signing' || active.vaultMode !== 'setup') {
      throw new Error('vault_ceremony_missing');
    }
    const addressGroup = signingAddressGroup(active.request);
    let temporaryKeyHandle: string | undefined;
    if (!referenceHostSarKeyCore.hasSignerForAddress(addressGroup, active.request.fromAddress)) {
      if (!input.secret) throw new Error('recovery_required');
      const imported = addressGroup === 'evm' && /^(?:0x)?[0-9a-fA-F]{64}$/.test(input.secret)
        ? await referenceHostSarKeyCore.prepareImportedEvmPrivateKey(input.secret)
        : await referenceHostSarKeyCore.prepareImportedMnemonic(input.secret);
      const matching = imported.addresses.some(({ addressGroupId, address }) => addressGroupId === addressGroup
        && (addressGroup === 'evm' ? address.toLowerCase() === active.request.fromAddress.toLowerCase() : address === active.request.fromAddress));
      if (!matching) {
        await referenceHostSarKeyCore.discardWallet(imported.keyHandle);
        throw new Error('recovery_address_mismatch');
      }
      temporaryKeyHandle = imported.keyHandle;
    }
    try {
      const material = await referenceHostSarKeyCore.exportVaultSharesForAddress(addressGroup, active.request.fromAddress);
      let encryptedShares: readonly [EncryptedSarVaultShare, EncryptedSarVaultShare, EncryptedSarVaultShare];
      try {
        encryptedShares = await encryptSarVaultShares(tenantId, active.request.walletId, input.password, material);
      } finally {
        for (const share of material.shares) share.fill(0);
      }
      const started = await sarVaultRequest<SarVaultChallenge>(active.request.walletId, 'challenges', 'POST', token, {
        phone: input.phone,
        email: input.email,
      });
      pendingVaultOperation.current = {
        challengeId: started.challengeId,
        purpose: 'enroll',
        encryptedShares,
        ...(temporaryKeyHandle ? { temporaryKeyHandle } : {}),
      };
      return started;
    } catch (error) {
      if (temporaryKeyHandle) await referenceHostSarKeyCore.discardWallet(temporaryKeyHandle);
      throw error;
    }
  }, [tenantId]);

  const startSarVaultUnlock = useCallback(async (): Promise<SarVaultChallenge> => {
    const active = securityCeremonyRef.current;
    const token = sessionTokenRef.current;
    if (!token || active?.type !== 'transaction-signing' || active.vaultMode !== 'unlock') {
      throw new Error('vault_ceremony_missing');
    }
    const started = await sarVaultRequest<SarVaultChallenge>(active.request.walletId, 'challenges', 'POST', token, {});
    pendingVaultOperation.current = { challengeId: started.challengeId, purpose: 'unlock' };
    return started;
  }, []);

  const verifySarVaultCode = useCallback(async (factor: 'phone' | 'email', code: string) => {
    const active = securityCeremonyRef.current;
    const operation = pendingVaultOperation.current;
    const token = sessionTokenRef.current;
    if (!token || active?.type !== 'transaction-signing' || !operation) throw new Error('vault_ceremony_missing');
    const result = await sarVaultRequest<{
      phoneVerified: boolean;
      emailVerified: boolean;
      accessToken?: string;
    }>(active.request.walletId, 'verify', 'POST', token, {
      challengeId: operation.challengeId,
      factor,
      code,
    });
    if (result.accessToken) operation.accessToken = result.accessToken;
    return result;
  }, []);

  const completeSarVault = useCallback(async (password?: string, pin?: string) => {
    const active = securityCeremonyRef.current;
    const operation = pendingVaultOperation.current;
    const token = sessionTokenRef.current;
    const resolve = transactionSigningResolver.current;
    if (!token || active?.type !== 'transaction-signing' || !operation?.accessToken || !resolve) {
      throw new Error('vault_authorization_required');
    }
    if (operation.purpose === 'enroll' && !operation.enrollmentStored) {
      if (!operation.encryptedShares) throw new Error('vault_ceremony_missing');
      await sarVaultRequest(active.request.walletId, 'shares', 'PUT', token, {
        challengeId: operation.challengeId,
        accessToken: operation.accessToken,
        shareB: operation.encryptedShares[1],
        shareC: operation.encryptedShares[2],
      });
      operation.enrollmentStored = true;
      try {
        window.localStorage.setItem(
          `took-wss:sar-vault-a:${tenantId}:${active.request.walletId}`,
          JSON.stringify(operation.encryptedShares[0]),
        );
      } catch {
        setHostFeedback('기기 저장소에 복구 조각을 보관하지 못했어요. 휴대폰·이메일 인증으로 복구할 수 있어요.');
      }
    }
    if (operation.purpose === 'unlock') {
      if (!password) throw new Error('vault_password_too_short');
      if (!operation.remoteShares) {
        const response = await sarVaultRequest<{
          shareB: EncryptedSarVaultShare;
          shareC: EncryptedSarVaultShare;
        }>(active.request.walletId, 'unlock', 'POST', token, {
          challengeId: operation.challengeId,
          accessToken: operation.accessToken,
        });
        operation.remoteShares = [response.shareB, response.shareC];
      }
      const material = await decryptSarVaultShares(tenantId, active.request.walletId, password, operation.remoteShares);
      try {
        await referenceHostSarKeyCore.restoreVaultSharesForAddress(
          material.shares,
          material.kind,
          signingAddressGroup(active.request),
          active.request.fromAddress,
        );
        if (pin) {
          if (securityCeremonyRef.current?.id !== active.id || transactionSigningResolver.current !== resolve) {
            throw new Error('vault_ceremony_missing');
          }
          await ensureAppPin(appPinScope(tenantId, sessionTokenRef.current), pin);
          const deviceKey = await getLocalDeviceKey(tenantId, active.request.walletId, true);
          if (!deviceKey) throw new Error('local_vault_unavailable');
          const record = await createLocalSarVault(tenantId, active.request.walletId, password, pin, material, deviceKey);
          if (securityCeremonyRef.current?.id !== active.id || transactionSigningResolver.current !== resolve) {
            throw new Error('vault_ceremony_missing');
          }
          try { writeLocalSarVault(record); }
          catch { throw new Error('local_vault_unavailable'); }
        }
      } finally {
        for (const share of material.shares) share.fill(0);
      }
    }
    if (securityCeremonyRef.current?.id !== active.id || transactionSigningResolver.current !== resolve) {
      await referenceHostSarKeyCore.discardSignersForAddress(
        signingAddressGroup(active.request), active.request.fromAddress,
      );
      return;
    }
    pendingVaultOperation.current = null;
    showSecurityCeremony({ ...active, vaultMode: 'ready' });
  }, [showSecurityCeremony, tenantId]);

  const selectTenant = (nextTenant: TenantId) => {
    cancelSecurityCeremony();
    setTenantId(nextTenant);
    setHostTab(getHostChromeProfile(tenantOptions[nextTenant].presentationProfileId).initialTab);
    setKeyAdapter(tenantOptions[nextTenant].defaultAdapter);
    setSession(null);
    setWalletScreenReady(false);
    setCustomerName(null);
    sessionTokenRef.current = null;
    setEvents([]);
    setHostFeedback(null);
    setShellMode('root');
    setStatus('idle');
  };

  const selectKeyAdapter = (nextAdapter: KeyAdapterId) => {
    cancelSecurityCeremony();
    setKeyAdapter(nextAdapter);
    setSession(null);
    setCustomerName(null);
    sessionTokenRef.current = null;
    setEvents([]);
    setShellMode('root');
    setStatus('idle');
  };

  const issueSession = useCallback(async (): Promise<CreateSessionResponse> => {
      if (!publicPreviewEnabled && !localDevelopmentInstitutionKey) {
        throw new Error('Reference Host requires an institution backend outside local development.');
      }
      const accessCode = previewAccessCode.trim();
      if (publicPreviewEnabled && !appOnlyPreview && accessCode.length < 12) {
        throw new Error('Preview access code is required.');
      }
      const requestSession = (path: string, useAccessCode: boolean) => fetch(`${bffUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(publicPreviewEnabled
            ? useAccessCode ? { 'x-wss-preview-code': accessCode } : {}
            : { 'x-wss-institution-key': localDevelopmentInstitutionKey }),
        },
        ...(useAccessCode || !publicPreviewEnabled
          ? { body: JSON.stringify({ tenantId, customerRef: previewCustomerRef, requestedKeyAdapter: keyAdapter }) }
          : {}),
      });
      const useAccessCode = !appOnlyPreview || accessCode.length >= 12;
      let response = await requestSession(
        publicPreviewEnabled
          ? useAccessCode ? '/v1/development/preview-sessions' : `/v1/development/${tenantId}-app-sessions`
          : '/v1/sessions',
        useAccessCode,
      );
      if (appOnlyPreview && useAccessCode && !response.ok) {
        window.sessionStorage.removeItem('took-wss:preview-access-code');
        response = await requestSession(`/v1/development/${tenantId}-app-sessions`, false);
      }
      if (!response.ok) throw new Error('Session request rejected.');
      const createdSession = await response.json() as CreateSessionResponse;
      if (publicPreviewEnabled && !appOnlyPreview) {
        window.sessionStorage.setItem('took-wss:preview-access-code', accessCode);
      }
      return createdSession;
  }, [keyAdapter, previewAccessCode, tenantId]);

  const createSession = async () => {
    cancelSecurityCeremony();
    sessionTokenRef.current = null;
    setSession(null);
    setCustomerName(null);
    setStatus('loading');
    setEvents([]);
    setShellMode('root');
    try {
      const createdSession = await issueSession();
      sessionTokenRef.current = createdSession.sessionToken;
      setSession(createdSession);
      setStatus('ready');
    } catch {
      setSession(null);
      sessionTokenRef.current = null;
      setStatus('error');
    }
  };

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const renewed = await issueSession();
    sessionTokenRef.current = renewed.sessionToken;
    return renewed.sessionToken;
  }, [issueSession]);

  useEffect(() => {
    if (!appOnlyPreview || autoStartAttempted.current) return;
    autoStartAttempted.current = true;
    void createSession();
  }, []);

  useEffect(() => {
    if (!appOnlyPreview || !session || walletScreenReady || status === 'error') return;
    const timeout = window.setTimeout(() => setStatus('error'), 20_000);
    return () => window.clearTimeout(timeout);
  }, [session, walletScreenReady, status]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !session) return;
    const walletOrigin = new URL(session.walletUrl).origin;
    let appUrlListener: PluginListenerHandle | null = null;
    let disposed = false;
    const nativeAuthRedirectUri = tenantOptions[tenantId].nativeAuthRedirectUri;
    const nativeAuthScheme = nativeAuthRedirectUri ? new URL(nativeAuthRedirectUri).protocol : null;
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && nativeAuthScheme) {
      const nativeApp = registerPlugin<{
        addListener(eventName: 'appUrlOpen', listener: (event: { url: string }) => void): Promise<PluginListenerHandle>;
      }>('App');
      void nativeApp.addListener('appUrlOpen', (event) => {
        let callback: URL;
        try { callback = new URL(event.url); } catch { return; }
        if (callback.protocol !== nativeAuthScheme || callback.hostname !== 'auth'
          || event.url.length > 60_000 || !callback.searchParams.has('state')
          || !(callback.searchParams.has('authResult') || callback.searchParams.has('authCookie'))) return;
        frame.contentWindow?.postMessage({ type: 'took-wss:native-thirdweb-return', url: event.url }, walletOrigin);
      }).then((listener) => {
        if (disposed) void listener.remove();
        else appUrlListener = listener;
      }).catch(() => undefined);
    }
    const requestMpcSignature = (walletId: string, address: string, message: string): Promise<string> => new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => { window.removeEventListener('message', onResult); reject(new Error('서명 요청 시간이 지났어요.')); }, 300_000);
      const onResult = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.origin !== walletOrigin
          || event.data?.type !== 'took-wss:exchange-personal-sign-result'
          || event.data.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener('message', onResult);
        if (event.data.ok && /^0x[0-9a-fA-F]{130}$/.test(event.data.signature)) resolve(event.data.signature);
        else reject(new Error(typeof event.data.error === 'string' ? event.data.error : 'thirdweb_auth_failed'));
      };
      window.addEventListener('message', onResult);
      frame.contentWindow?.postMessage({ type: 'took-wss:exchange-personal-sign', requestId, walletId, address, message }, walletOrigin);
    });
    const onPersonalSign = async (request: ExchangePersonalSignRequest): Promise<string> => {
      const token = sessionTokenRef.current;
      if (!token || pendingExchangeSignRef.current || securityCeremonyRef.current || checkingExchangeSignRef.current) {
        throw new Error('지갑 확인이 진행 중이에요.');
      }
      checkingExchangeSignRef.current = true;
      setCheckingExchangeSign(true);
      let verifiedWallet: { label: string; keyAdapter: KeyAdapterId };
      let localVaultAvailable = false;
      let remoteStatus: { enrolled: boolean; phoneMasked?: string; emailMasked?: string } | null = null;
      try {
        const response = await fetch(`${bffUrl}/v1/wallets/${encodeURIComponent(request.walletId)}/home`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        });
        if (!response.ok || sessionTokenRef.current !== token) throw new Error('현재 월렛을 확인하지 못했어요.');
        const home = await response.json() as unknown;
        if (!isRecord(home) || home.status !== 'ready' || !isRecord(home.wallet)
          || home.wallet.walletId !== request.walletId
          || typeof home.wallet.label !== 'string'
          || (home.wallet.keyAdapter !== 'took-sar' && home.wallet.keyAdapter !== 'thirdweb-user-wallet')
          || !Array.isArray(home.networks)
          || !home.networks.some((network: unknown) => isRecord(network) && network.addressGroupId === 'evm'
            && typeof network.address === 'string' && network.address.toLowerCase() === request.address.toLowerCase())) {
          throw new Error('현재 월렛 주소와 연결 요청이 일치하지 않아요.');
        }
        verifiedWallet = home.wallet as { label: string; keyAdapter: KeyAdapterId };
        localVaultAvailable = verifiedWallet.keyAdapter === 'took-sar'
          && readLocalSarVault(tenantId, request.walletId) !== null
          && await getLocalDeviceKey(tenantId, request.walletId, false) !== null;
        if (verifiedWallet.keyAdapter === 'took-sar' && !localVaultAvailable) {
          remoteStatus = await sarVaultV2Request<{
            enrolled: boolean; phoneMasked?: string; emailMasked?: string;
          }>(request.walletId, 'status', 'GET', token);
          if (!remoteStatus.enrolled) throw new Error('이 기기의 지갑 정보가 없어요. 먼저 지갑을 복구해 주세요.');
        }
        if (sessionTokenRef.current !== token) throw new Error('고객 연결이 만료됐어요. 다시 시도해 주세요.');
      } catch (error) {
        checkingExchangeSignRef.current = false;
        setCheckingExchangeSign(false);
        throw error;
      }
      return new Promise<string>((resolve, reject) => {
        const pending: PendingExchangeSign = { ...request, walletLabel: verifiedWallet.label,
          keyAdapter: verifiedWallet.keyAdapter, localVaultAvailable,
          phoneMasked: remoteStatus?.phoneMasked, emailMasked: remoteStatus?.emailMasked, resolve, reject };
        pendingExchangeSignRef.current = pending;
        setPendingExchangeSign(pending);
        checkingExchangeSignRef.current = false;
        setCheckingExchangeSign(false);
      });
    };
    const approveExchangeSign = async (pin: string, legacy = false) => {
      const pending = pendingExchangeSignRef.current;
      if (!pending) throw new Error('서명 요청이 없어요.');
      let signature: string;
      if (pending.keyAdapter === 'thirdweb-user-wallet') {
        setPendingExchangeSign(null);
        try { signature = await requestMpcSignature(pending.walletId, pending.address, pending.message); }
        catch (caught) {
          if (pendingExchangeSignRef.current === pending) {
            setPendingExchangeSign({ ...pending, error: '이 월렛에 연결된 계정으로 다시 로그인해 주세요.' });
          }
          throw caught;
        }
      } else {
        if (!pending.localVaultAvailable) {
          setPendingExchangeSign(null);
          showSecurityCeremony({ id: crypto.randomUUID(), type: 'exchange-signing',
            walletId: pending.walletId, address: pending.address,
            phoneMasked: pending.phoneMasked, emailMasked: pending.emailMasked });
          return;
        }
        const record = readLocalSarVault(tenantId, pending.walletId);
        const key = await getLocalDeviceKey(tenantId, pending.walletId, false);
        if (!record || !key) throw new Error('이 기기의 지갑을 먼저 복구해 주세요.');
        const scope = appPinScope(tenantId, sessionTokenRef.current);
        if (legacy) {
          const migration = pendingAppPinMigration.current;
          if (!migration || migration.scope !== scope || migration.walletId !== pending.walletId || !await verifyAppPin(scope, migration.pin)) throw new Error('app_pin_migration_expired');
        } else if (hasAppPin(scope) && !await verifyAppPin(scope, pin)) throw new Error('app_pin_invalid');
        let material: Awaited<ReturnType<typeof openLocalSarVault>>;
        try { material = await openLocalSarVault(tenantId, pending.walletId, record, { pin, deviceKey: key }); }
        catch (error) {
          if (!legacy && hasAppPin(scope) && error instanceof Error && error.message === 'local_vault_unlock_failed') {
            pendingAppPinMigration.current = { scope, walletId: pending.walletId, pin };
            throw new Error('app_pin_migration_needed');
          }
          throw error;
        }
        if (legacy) {
          try { writeLocalSarVault(await replaceLocalSarVaultPin(tenantId, pending.walletId, record, material, pendingAppPinMigration.current!.pin, key)); }
          catch { for (const share of material.shares) share.fill(0); throw new Error('local_vault_unavailable'); }
          pendingAppPinMigration.current = null;
        } else if (!hasAppPin(scope)) await ensureAppPin(scope, pin);
        let handle: string | undefined;
        const decoded = personalSignBytes(pending.message);
        try {
          handle = await referenceHostSarKeyCore.resumeWalletFromVaultShares(material.shares, material.kind, 'evm', pending.address);
          signature = await referenceHostSarKeyCore.signEvmMessageForAddress(pending.address, decoded);
        } finally {
          for (const share of material.shares) share.fill(0);
          if (decoded instanceof Uint8Array) decoded.fill(0);
          if (handle) await referenceHostSarKeyCore.discardWallet(handle);
        }
      }
      if (pendingExchangeSignRef.current !== pending) throw new Error('서명 요청이 바뀌었어요.');
      pendingExchangeSignRef.current = null;
      setPendingExchangeSign(null);
      pending.resolve(signature);
    };
    const cancelExchangeSign = () => {
      const pending = pendingExchangeSignRef.current;
      pendingExchangeSignRef.current = null;
      pendingAppPinMigration.current = null;
      setPendingExchangeSign(null);
      pending?.reject(new Error('서명을 취소했어요.'));
    };
    exchangeSignActionsRef.current = { approve: approveExchangeSign, cancel: cancelExchangeSign };
    const onNativeRequest = (event: MessageEvent) => {
      if (!isTrustedNativeDeviceRequest(event, frame.contentWindow, walletOrigin)) return;
      const { requestId } = event.data;
      void handleNativeDeviceRequest(event.data, tenantOptions[tenantId].exchangeRouterBrand, onPersonalSign).then(
        (result) => frame.contentWindow?.postMessage({ type: 'took-wss:native-result', requestId, ok: true, result }, walletOrigin),
        (error: unknown) => frame.contentWindow?.postMessage({ type: 'took-wss:native-result', requestId, ok: false,
          error: error instanceof Error ? error.message : '기기 기능을 실행하지 못했어요.' }, walletOrigin),
      );
    };
    window.addEventListener('message', onNativeRequest);
    const client = new WssHostClient({
      frame,
      walletOrigin,
      sessionToken: session.sessionToken,
      bffUrl,
      hostCapabilities,
      onEvent: (event) => {
        if (event.type === 'took-wss:oauth-redirect-request' && appOnlyPreview
          && (window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: fullscreen)').matches
            || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))) {
          const reportRedirectStatus = (status: 'started' | 'failed') => frame.contentWindow?.postMessage({
            type: 'took-wss:oauth-redirect-status', protocolVersion: 1,
            requestId: event.requestId, status,
          }, new URL(session.walletUrl).origin);
          reportRedirectStatus('started');
          void startPwaThirdwebRedirect({ tenantId, clientId: event.clientId, strategy: event.strategy })
            .catch(() => {
              reportRedirectStatus('failed');
              setHostFeedback('계정 로그인 화면을 열지 못했어요. 다시 시도해 주세요.');
            });
        }
        if (event.type === 'took-wss:shell-change') { setShellMode(event.mode); setWalletScreenReady(true); }
        if (event.type === 'took-wss:wallet-removed') void removeLocalSarVault(tenantId, event.walletId).catch(() => {
          setHostFeedback('이 기기의 지갑 보관 정보를 지우지 못했어요. 저장소를 확인해 주세요.');
        });
        if (event.type === 'took-wss:navigation') {
          if (event.route === 'claim-closed') {
            clearIncomingClaimCode(tenantId);
            setIncomingClaimCode(null);
          }
          const recovery = event.route.match(/^wallets\/([0-9a-f-]{36})\/recovery-secret$/i);
          if (recovery) void requestRecoveryReveal(recovery[1]!);
        }
        if (event.type === 'took-wss:error' && event.code === 'BOOTSTRAP_FAILED') setStatus('error');
        if ((event.type === 'took-wss:bootstrapped' || event.type === 'took-wss:identity-established') && event.displayName) setCustomerName(event.displayName);
        setEvents((current) => [...current.slice(-5), event]);
      },
      requestSessionRefresh: refreshSession,
      requestAuthentication: requestHostAuthentication,
      requestSecureSarWalletCreation,
      requestSecureSarVaultEnrollment,
      requestSecureTransactionSignature,
      requestRecipientPick,
      requestSecureWalletImport,
    });
    client.start();
    return () => {
      disposed = true;
      if (appUrlListener) void appUrlListener.remove();
      window.removeEventListener('message', onNativeRequest);
      exchangeSignActionsRef.current = null;
      client.stop();
    };
  }, [refreshSession, requestHostAuthentication, requestRecipientPick, requestRecoveryReveal, requestSecureSarWalletCreation, requestSecureSarVaultEnrollment, requestSecureTransactionSignature, requestSecureWalletImport, session, tenantId]);

  useEffect(() => {
    if (!hostFeedback) return;
    const timeout = window.setTimeout(() => setHostFeedback(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [hostFeedback]);

  return (
    <PreviewKeypadProvider keys={tenantOptions[tenantId].previewKeypadKeys}><main data-tenant={tenantId} className={`host-page${publicPreviewEnabled ? ' host-page--public-preview' : ''}${appOnlyPreview ? ' host-page--app-only' : ''}${appOnlyPreview && shellMode === 'focus' ? ' host-page--focus-surface' : ''}${session ? ' host-page--session-ready' : ''}`}>
      {!appOnlyPreview ? <section className="control-panel ops-editorial-grid">
        <div className="eyebrow"><ShieldCheck size={15} weight="fill" /> WSS REFERENCE HOST</div>
        <h1>금융사 앱 안에 지갑을 안전하게.</h1>
        <p className="intro">브랜드, 서비스 모듈, 키 관리 방식을 조합하고 동일한 WSS WebView를 기관 앱 안에 삽입합니다.</p>

        {publicPreviewEnabled ? (
          <div className="public-preview-note">
            <strong>{tenantOptions[tenantId].label} 모바일 프리뷰</strong>
            <p>접근 코드를 입력하면 이 기기 전용 개발 세션으로 시작합니다.</p>
          </div>
        ) : (
          <label>
            <span>Tenant profile</span>
            <select value={tenantId} onChange={(event) => selectTenant(event.target.value as TenantId)}>
              {Object.entries(tenantOptions).map(([id, option]) => <option value={id} key={id}>{option.label}</option>)}
            </select>
          </label>
        )}

        <fieldset>
          <legend>Key management</legend>
          {tenantOptions[tenantId].adapters.map((adapter) => (
            <label className="radio-row" key={adapter.id}>
              <input type="radio" name="key-adapter" value={adapter.id} checked={keyAdapter === adapter.id} onChange={() => selectKeyAdapter(adapter.id)} />
              <span><LockKey size={18} />{adapter.label}</span>
            </label>
          ))}
        </fieldset>

        {publicPreviewEnabled ? (
          <label className="preview-access-field">
            <span>Preview access code</span>
            <input
              type="password"
              autoComplete="current-password"
              value={previewAccessCode}
              placeholder="프리뷰 접근 코드"
              onChange={(event) => {
                setPreviewAccessCode(event.target.value);
                if (status === 'error') setStatus('idle');
              }}
            />
          </label>
        ) : null}

        <button className="launch-button" type="button" disabled={status === 'loading'} onClick={createSession}>
          {status === 'loading' ? <ArrowsClockwise className="spin" size={19} /> : <Bank size={19} weight="fill" />}
          {session ? '새 세션 발급하기' : '은행앱에서 월렛 열기'}
        </button>

        {publicPreviewEnabled && status === 'error' ? <p className="preview-access-error">접근 코드 또는 WSS 연결 상태를 확인해 주세요.</p> : null}

        <div className="boundary-note">
          <strong>상용 연동 경계</strong>
          <p>{publicPreviewEnabled
            ? '이 배포는 xlot-wss-dev 전용 제안·초기 기능 검증 환경입니다. 실제 금융사 운영 세션이 아닙니다.'
            : '세션 발급은 금융사 서버에서 수행합니다. 브라우저의 개발용 키는 로컬 Reference Host에서만 사용됩니다.'}</p>
        </div>

        <div className="event-log" aria-live="polite">
          <strong>Bridge events</strong>
          {events.length === 0 ? <span>아직 수신한 이벤트가 없습니다.</span> : events.map((event, index) => <span key={`${event.type}-${index}`}><CheckCircle size={13} />{event.type}</span>)}
        </div>
      </section> : null}

      <section ref={stageRef} className="device-stage" aria-label="금융사 모바일 앱 프리뷰">
        <div
          className={`phone ${showRootChrome ? 'phone--root' : 'phone--focus'}`}
          data-host-chrome={tenantOptions[tenantId].presentationProfileId}
          data-shell-mode={shellMode}
          data-host-tab={hostTab}
        >
          {!appOnlyPreview ? <div className="phone-status"><span>9:41</span><span>● ● ▰</span></div> : null}
          {showRootChrome ? <HostHeader onAction={setHostFeedback} onOpenWalletSettings={() => setAppSettingsOpen(true)} activeTab={hostTab} onSelectTab={setHostTab} customerName={customerName} /> : null}
          {session ? (
            <>
              <iframe ref={frameRef} src={incomingClaimCode ? `${session.walletUrl}#claim=${encodeURIComponent(incomingClaimCode)}` : incomingPaymentRequestId ? `${session.walletUrl}#payment=${encodeURIComponent(incomingPaymentRequestId)}` : session.walletUrl} title={`${tenantOptions[tenantId].label} WebView`} allow="clipboard-write" style={!showWallet ? { display: 'none' } : appOnlyPreview && !walletScreenReady ? { visibility: 'hidden' } : undefined} />
              {!showWallet && HostPreview ? <HostPreview activeTab={hostTab} onSelectTab={setHostTab} onAction={setHostFeedback} /> : null}
            </>
          ) : (
            !showWallet && HostPreview ? <HostPreview activeTab={hostTab} onSelectTab={setHostTab} onAction={setHostFeedback} /> : appOnlyPreview ? null : (
              <div className="host-placeholder">
                <Bank size={38} weight="duotone" />
                <strong>{tenantOptions[tenantId].label}</strong>
                <p>기관 세션을 발급하면 동일한 영역에 WSS WebView가 열립니다.</p>
                {status === 'error' ? <em>BFF 연결을 확인해 주세요.</em> : null}
              </div>
            )
          )}
          {showRootChrome ? <HostNavigation onAction={setHostFeedback} activeTab={hostTab} onSelectTab={setHostTab} /> : null}
          {appSettingsOpen ? <HostAppSettings scope={session ? appPinScope(tenantId, session.sessionToken) : null}
            keypadLayout={tenantOptions[tenantId].secureKeypadLayout}
            hasPin={session ? hasAppPin(appPinScope(tenantId, session.sessionToken)) : false}
            onBiometricChange={setAppBiometricEnabled}
            onClose={() => setAppSettingsOpen(false)} /> : null}
          {appOnlyPreview && (!walletScreenReady || status === 'error') ? (
            <div className="app-entry" role="status" aria-live="polite" style={{
              '--app-loading-canvas': tenantOptions[tenantId].loadingCanvas,
              '--app-loading-ink': tenantOptions[tenantId].loadingInk,
              '--app-loading-primary': tenantOptions[tenantId].loadingPrimary,
            } as CSSProperties}>
              <div className="app-entry-mark" aria-hidden="true"><LockKey size={28} weight="duotone" />{status !== 'error' ? <span className="app-entry-spinner" /> : null}</div>
              <h1>{status === 'error' ? '지갑을 열지 못했어요' : resumingCreation ? '새 지갑을 생성하고 있어요' : '안전한 지갑을 준비하고 있어요'}</h1>
              <p>{status === 'error' ? '연결 상태를 확인하고 다시 시도해 주세요.' : '잠시만 기다려 주세요.'}</p>
              {status === 'error' ? <button type="button" onClick={() => void createSession()}>다시 시도</button> : null}
            </div>
          ) : null}
          {securityCeremony ? (
            <HostSecurityOverlay
              key={securityCeremony.id}
              view={securityCeremony}
              hasAppPin={session ? hasAppPin(appPinScope(tenantId, session.sessionToken)) : false}
              biometricEnabled={appBiometricEnabled}
              onBiometricUnlock={async () => {
                const scope = appPinScope(tenantId, sessionTokenRef.current);
                await localSarUnlock({ pin: await readBiometricPin(scope) });
              }}
              institutionName={tenantOptions[tenantId].institutionName}
              institutionLabel={tenantOptions[tenantId].institutionLabel}
              customerName={customerName}
              keypadLayout={tenantOptions[tenantId].secureKeypadLayout}
              onCancel={cancelSecurityCeremony}
              onApproveAuthentication={approveHostAuthentication}
              onConfirmSeedBackup={confirmSeedBackup}
              onConfirmWalletImport={confirmSecureWalletImport}
              onApproveTransaction={approveTransaction}
              onStartSarVaultSetup={startSarVaultSetup}
              onStartSarVaultUnlock={startSarVaultUnlock}
              onVerifySarVaultCode={verifySarVaultCode}
              onCompleteSarVault={completeSarVault}
              onSaveLocalSarVault={saveLocalSarVault}
              onUnlockExistingLocalSarVault={unlockExistingLocalSarVault}
              onStartSarV2Enrollment={startSarV2Enrollment}
              onVerifySarV2Code={verifySarV2Code}
              onCompleteSarV2Enrollment={completeSarV2Enrollment}
              onLocalSarUnlock={localSarUnlock}
              onStartSarV2Unlock={startSarV2Unlock}
              onVerifySarV2UnlockCode={verifySarV2UnlockCode}
              onCompleteSarV2Unlock={completeSarV2Unlock}
            />
          ) : null}
          {recipientPicker ? <HostRecipientPicker
            chainId={recipientPicker.chainId}
            onSelect={(value) => finishRecipientPick({ status: 'selected', kind: 'address', value })}
            onCancel={() => finishRecipientPick({ status: 'cancelled' })}
          /> : null}
          {checkingExchangeSign ? <ExchangeSignLoading color={tenantOptions[tenantId].exchangeRouterBrand.color} /> : null}
          {pendingExchangeSign ? <ExchangeSignPanel
            exchangeName={pendingExchangeSign.exchange === 'bithumb' ? '빗썸' : '코인원'}
            walletLabel={pendingExchangeSign.walletLabel}
            message={pendingExchangeSign.message}
            initialError={pendingExchangeSign.error}
            requiresPin={pendingExchangeSign.keyAdapter === 'took-sar' && pendingExchangeSign.localVaultAvailable}
            color={tenantOptions[tenantId].exchangeRouterBrand.color}
            keypadLayout={tenantOptions[tenantId].secureKeypadLayout}
            onApprove={(pin) => exchangeSignActionsRef.current?.approve(pin) ?? Promise.reject(new Error('서명 요청이 끝났어요.'))}
            onBiometricApprove={appBiometricEnabled && pendingExchangeSign.localVaultAvailable ? async () => {
              const pin = await readBiometricPin(appPinScope(tenantId, sessionTokenRef.current));
              await (exchangeSignActionsRef.current?.approve(pin) ?? Promise.reject(new Error('서명 요청이 끝났어요.')));
            } : undefined}
            onCancel={() => exchangeSignActionsRef.current?.cancel()}
          /> : null}
          <div className="host-feedback" role="status" aria-live="polite">{hostFeedback}</div>
        </div>
      </section>
    </main></PreviewKeypadProvider>
  );
}
