import { useCallback, useEffect, useState } from 'react';
import type { ProvisionWalletResponse, WalletHomePayload, WalletPresentationProps } from '@took-wss/contracts';
import { CreateWalletFlow } from './CreateWalletFlow';
import { WalletHome } from './WalletHome';
import './styles.css';

export default function KiwoomWalletPresentation(props: WalletPresentationProps) {
  const [creationMode, setCreationMode] = useState<'initial' | 'add' | null>(null);
  const [focusedOverlay, setFocusedOverlay] = useState(false);
  const [provisionedHome, setProvisionedHome] = useState<WalletHomePayload | null>(null);
  const walletHome = provisionedHome ?? props.walletHome;
  const focused = creationMode !== null || focusedOverlay;

  useEffect(() => {
    props.onShellModeChange(focused ? 'focus' : 'root');
  }, [focused, props.onShellModeChange]);

  useEffect(() => () => props.onShellModeChange('root'), [props.onShellModeChange]);

  const completeProvisioning = (response: ProvisionWalletResponse) => {
    setProvisionedHome(response.walletHome);
    setCreationMode(null);
  };

  const selectWallet = async (walletId: string) => {
    const selectedHome = await props.onSelectWallet(walletId);
    setProvisionedHome(selectedHome);
  };

  const setOverlayFocus = useCallback((nextFocused: boolean) => {
    setFocusedOverlay(nextFocused);
  }, []);

  return (
    <main className="kw-root" data-presentation="kiwoom-simple-mode-v1">
      {creationMode ? (
        <CreateWalletFlow
          initialKeyAdapter={creationMode === 'initial' ? props.sessionKeyAdapter : props.manifest.keyManagement.defaultAdapter}
          manifest={props.manifest}
          mode={creationMode}
          canSecureWalletImport={props.hostCapabilities.canSecureWalletImport}
          canCreateSecureSarWallet={props.hostCapabilities.canCreateSecureSarWallet}
          identity={props.identity}
          onClose={() => setCreationMode(null)}
          onAuthenticate={() => props.onRequestHostAuthentication('wallet-provisioning')}
          onRequestSecureSarWalletCreation={props.onRequestSecureSarWalletCreation}
          onRequestSecureImport={props.onRequestSecureWalletImport}
          onCreateRegistrationIntent={props.onCreateRegistrationIntent}
          onCreatePhoneChallenge={props.onCreatePhoneChallenge}
          onVerifyPhoneChallenge={props.onVerifyPhoneChallenge}
          onProvision={props.onProvisionWallet}
          onComplete={completeProvisioning}
        />
      ) : (
        <section className="kw-screen kw-screen--root">
          <div className="kw-scroll">
            <WalletHome
              hostCapabilities={props.hostCapabilities}
              walletHome={walletHome}
              onNavigate={props.onNavigate}
              onStartCreate={() => setCreationMode('initial')}
              onAddWallet={() => setCreationMode('add')}
              onSelectWallet={selectWallet}
              onPrepareTransfer={props.onPrepareTransfer}
              onRequestSecureTransactionSignature={props.onRequestSecureTransactionSignature}
              onSubmitTransfer={props.onSubmitTransfer}
              onFocusedOverlayChange={setOverlayFocus}
            />
          </div>
        </section>
      )}
    </main>
  );
}
