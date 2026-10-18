import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import type { ProvisionWalletResponse, WalletHomePayload, WalletPresentationProps } from '@took-wss/contracts';
import { CreateWalletFlow } from './CreateWalletFlow';
import { InstitutionPhoneClaimFlow } from './InstitutionPhoneClaimFlow';
import { ProviderReconnectDialog } from './ProviderReconnectDialog';
import { WalletHome } from './WalletHome';
import type { ReadyWalletSummaryProps } from './WalletHome';
import { useFocusedFieldVisibility } from './useFocusedFieldVisibility';
import { clearPwaWalletCreationResume, readPwaWalletCreationResume } from './pwaAuthResume';
import './styles.css';

export type { ReadyWalletSummaryProps } from './WalletHome';

export default function KiwoomWalletPresentation(props: WalletPresentationProps & { HomeSummary?: ComponentType<ReadyWalletSummaryProps>; HomeServices?: ComponentType<{ walletId: string; walletLabel: string; walletAddress?: string; wallets: import('@took-wss/contracts').WalletProfileSummary[]; onFocusedOverlayChange: (focused: boolean) => void }>; onScanPhysicalCard?: () => Promise<import('@took-wss/contracts').PhysicalCardInfo | null>; onCancelPhysicalCardScan?: () => Promise<void> }) {
  const rootRef = useRef<HTMLElement>(null);
  useFocusedFieldVisibility(rootRef);
  const [initialResume] = useState(() => props.pwaOAuthRedirect && props.identity.status === 'established'
    ? readPwaWalletCreationResume(props.manifest.tenantId) : null);
  const [creationMode, setCreationMode] = useState<'initial' | 'add' | null>(initialResume?.mode ?? null);
  const [creationIntent, setCreationIntent] = useState<'create' | 'import' | 'recover'>(initialResume?.entryIntent ?? 'create');
  const [resumeWalletLabel, setResumeWalletLabel] = useState<string | undefined>(initialResume?.walletLabel);
  const [focusedOverlay, setFocusedOverlay] = useState(false);
  const [provisionedHome, setProvisionedHome] = useState<WalletHomePayload | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState(props.incomingClaimCode ?? null);
  const walletSelectionRequestRef = useRef(0);
  const walletHome = provisionedHome ?? props.walletHome;
  const focused = creationMode !== null || claimCode !== null || focusedOverlay || props.providerLogin !== null;

  useEffect(() => {
    props.onShellModeChange(focused ? 'focus' : 'root');
  }, [focused, props.onShellModeChange]);

  useEffect(() => () => props.onShellModeChange('root'), [props.onShellModeChange]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!props.pwaOAuthRedirect || props.identity.status !== 'established') return;
    if (initialResume) {
      clearPwaWalletCreationResume(props.manifest.tenantId);
      return;
    }
    const resume = readPwaWalletCreationResume(props.manifest.tenantId);
    if (!resume) return;
    clearPwaWalletCreationResume(props.manifest.tenantId);
    setResumeWalletLabel(resume.walletLabel);
    setCreationIntent(resume.entryIntent);
    setCreationMode(resume.mode);
  }, [initialResume, props.identity.status, props.manifest.tenantId, props.pwaOAuthRedirect]);

  const completeProvisioning = (response: ProvisionWalletResponse, outcome: 'created' | 'loaded') => {
    walletSelectionRequestRef.current += 1;
    setProvisionedHome(response.walletHome);
    if (outcome === 'created') setToast(response.walletHome.wallet.origin === 'imported' ? '가져온 지갑을 연결했어요.' : '새 지갑을 만들었어요.');
    setResumeWalletLabel(undefined);
    setCreationMode(null);
  };

  const selectWallet = async (walletId: string) => {
    const request = ++walletSelectionRequestRef.current;
    const selectedHome = await props.onSelectWallet(walletId);
    if (request === walletSelectionRequestRef.current) setProvisionedHome(selectedHome);
    return selectedHome;
  };

  const refreshWallet = async (walletId: string) => {
    const request = ++walletSelectionRequestRef.current;
    try {
      const refreshed = await props.onRefreshWallet(walletId);
      if (request === walletSelectionRequestRef.current && walletHome.status === 'ready' && walletHome.wallet.walletId === walletId) {
        setProvisionedHome(refreshed);
      }
      return refreshed;
    } catch (error) {
      setToast('잔액을 새로고침하지 못했어요. 다시 시도해 주세요.');
      throw error;
    }
  };

  const transactionSubmitted = (sourceWalletId: string, destinationWalletId?: string) => {
    props.onInvalidateWallets(destinationWalletId ? [sourceWalletId, destinationWalletId] : [sourceWalletId]);
    if (walletHome.status === 'ready') void refreshWallet(walletHome.wallet.walletId).catch(() => undefined);
  };

  const removeWallet = async (walletId: string, onProgress: (phase: 'authenticating' | 'removing') => void) => {
    const authentication = await props.onRequestHostAuthentication('wallet-removal');
    if (authentication.status !== 'authenticated') throw new Error('wallet_removal_cancelled');
    onProgress('removing');
    const home = await props.onRemoveWallet(walletId, authentication.proof);
    walletSelectionRequestRef.current += 1;
    setProvisionedHome(home);
  };

  const renameWallet = async (walletId: string, label: string) => {
    const renamed = await props.onRenameWallet(walletId, label);
    setProvisionedHome((current) => {
      const home = current ?? props.walletHome;
      if (home.status !== 'ready') return home;
      return {
        ...home,
        wallet: home.wallet.walletId === walletId ? renamed : home.wallet,
        wallets: home.wallets.map((wallet) => wallet.walletId === walletId ? renamed : wallet),
      };
    });
  };

  const setOverlayFocus = useCallback((nextFocused: boolean) => {
    setFocusedOverlay(nextFocused);
  }, []);

  return (
    <main ref={rootRef} className="kw-root" data-presentation={props.manifest.presentation.profileId}>
      {creationMode ? (
        <CreateWalletFlow
          initialKeyAdapter={creationMode === 'initial' ? props.sessionKeyAdapter : props.manifest.keyManagement.defaultAdapter}
          manifest={props.manifest}
          mode={creationMode}
          entryIntent={creationIntent}
          resumeWalletLabel={resumeWalletLabel}
          pwaOAuthRedirect={props.pwaOAuthRedirect}
          thirdwebClientId={props.thirdwebClientId}
          onConnectThirdweb={props.onConnectThirdweb}
          onCreateThirdwebProof={props.onCreateThirdwebProof}
          onLoadExistingWallet={props.onSelectWallet}
          existingWallets={walletHome.status === 'ready' ? walletHome.wallets : []}
          canSecureWalletImport={props.hostCapabilities.canSecureWalletImport}
          canCreateSecureSarWallet={props.hostCapabilities.canCreateSecureSarWallet}
          identity={props.identity}
          onClose={() => { setResumeWalletLabel(undefined); setCreationMode(null); }}
          onAuthenticate={() => props.onRequestHostAuthentication('wallet-provisioning')}
          onRequestSecureSarWalletCreation={props.onRequestSecureSarWalletCreation}
          onRequestSecureSarVaultEnrollment={props.onRequestSecureSarVaultEnrollment}
          onRequestSecureImport={props.onRequestSecureWalletImport}
          onCreateRegistrationIntent={props.onCreateRegistrationIntent}
          onCreatePhoneChallenge={props.onCreatePhoneChallenge}
          onVerifyPhoneChallenge={props.onVerifyPhoneChallenge}
          onDigitalIdentityRequest={props.onDigitalIdentityRequest}
          onProvision={props.onProvisionWallet}
          onComplete={completeProvisioning}
        />
      ) : claimCode ? (
        <InstitutionPhoneClaimFlow
          code={claimCode}
          identity={props.identity}
          walletHome={walletHome}
          onGetInfo={props.onGetPhoneClaimInfo}
          onRequestOtp={props.onRequestInstitutionPhoneClaimOtp}
          onSubmit={props.onSubmitInstitutionPhoneClaim}
          onSelectWallet={selectWallet}
          onCreateWallet={() => { setResumeWalletLabel(undefined); setCreationIntent('create'); setCreationMode(walletHome.status === 'ready' ? 'add' : 'initial'); }}
          onClose={() => { setClaimCode(null); props.onNavigate('claim-closed'); }}
        />
      ) : (
        <section className="kw-screen kw-screen--root">
          <div className="kw-scroll">
            <WalletHome
              tenantId={props.manifest.tenantId}
              logoText={props.manifest.brand.logoText}
              paymentCoinLogoUrl={props.manifest.brand.paymentCoinLogoUrl}
              incomingPaymentRequestId={props.incomingPaymentRequestId}
              onCreatePaymentRequest={props.onCreatePaymentRequest}
              onGetPaymentRequest={props.onGetPaymentRequest}
              onListPaymentRequests={props.onListPaymentRequests}
              onListSpentPayments={props.onListSpentPayments}
              HomeSummary={props.HomeSummary}
              HomeServices={props.HomeServices}
              onScanPhysicalCard={props.onScanPhysicalCard}
              onCancelPhysicalCardScan={props.onCancelPhysicalCardScan}
              hostCapabilities={props.hostCapabilities}
              walletHome={walletHome}
              onNavigate={props.onNavigate}
              onStartCreate={(intent) => { setResumeWalletLabel(undefined); setCreationIntent(intent); setCreationMode('initial'); }}
              onAddWallet={() => { setResumeWalletLabel(undefined); setCreationIntent('create'); setCreationMode('add'); }}
              onSelectWallet={async (walletId) => { await selectWallet(walletId); }}
              onLoadWalletHome={props.onSelectWallet}
              onRefreshWallet={refreshWallet}
              onTransactionSubmitted={transactionSubmitted}
              onRenameWallet={renameWallet}
              onRemoveWallet={removeWallet}
              onPrepareTransfer={props.onPrepareTransfer}
              onQuotePhoneEscrow={props.onQuotePhoneEscrow}
              onRequestExchangeQuote={props.onRequestExchangeQuote}
              onPrepareExchange={props.onPrepareExchange}
              onRequestSecureTransactionSignature={props.onRequestSecureTransactionSignature}
              onRequestRecipientPick={props.onRequestRecipientPick}
              onSubmitTransfer={props.onSubmitTransfer}
              onListTransferActivity={props.onListTransferActivity}
              onGetTransferStatus={props.onGetTransferStatus}
              onRetryPhoneNotification={props.onRetryPhoneNotification}
              onPreparePhoneRefund={props.onPreparePhoneRefund}
              onSubmitPhoneRefund={props.onSubmitPhoneRefund}
              onSubmitExchange={props.onSubmitExchange}
              onGetExchangeStatus={props.onGetExchangeStatus}
              onFocusedOverlayChange={setOverlayFocus}
            />
          </div>
        </section>
      )}
      {props.providerLogin ? <ProviderReconnectDialog state={props.providerLogin}
        pwaOAuthRedirect={props.pwaOAuthRedirect}
        onConnect={props.onConnectThirdweb} onComplete={props.onCompleteProviderLogin}
        onCancel={props.onCancelProviderLogin} /> : null}
      {toast ? <div className="kw-toast" role="status" aria-live="polite">{toast}</div> : null}
    </main>
  );
}
