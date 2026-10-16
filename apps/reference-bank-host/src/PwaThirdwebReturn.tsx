import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createThirdwebClient } from 'thirdweb';
import { AutoConnect, ThirdwebProvider } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';
import type { InstallLandingConfig } from './InstallLanding';
import { clearPendingPwaThirdwebRedirect, clearPendingPwaWalletCreation, clearPwaThirdwebReturnUrl } from './pwaThirdwebRedirect';

export function PwaThirdwebReturn({ config, clientId, onComplete }: {
  config: InstallLandingConfig;
  clientId: string;
  onComplete: (connected: boolean) => void;
}) {
  const [error, setError] = useState(false);
  const client = useMemo(() => createThirdwebClient({ clientId }), [clientId]);
  const wallets = useMemo(() => [inAppWallet({ hidePrivateKeyExport: true })], []);
  useEffect(() => {
    const timeout = window.setTimeout(() => setError(true), 30_000);
    return () => window.clearTimeout(timeout);
  }, []);
  const finish = (connected: boolean) => {
    clearPwaThirdwebReturnUrl();
    clearPendingPwaThirdwebRedirect(config.tenantId);
    if (!connected) clearPendingPwaWalletCreation(config.tenantId);
    onComplete(connected);
  };
  return (
    <ThirdwebProvider>
      {!error ? <AutoConnect client={client} wallets={wallets} onConnect={() => finish(true)} onTimeout={() => setError(true)} /> : null}
      <div className="install-landing__loading" style={{ background: config.colors.canvas, color: config.colors.ink, fontFamily: config.fontFamily, '--app-loading-primary': config.colors.primary, '--app-loading-primary-ink': config.colors.primaryInk } as CSSProperties} role="status">
        <strong>{error ? '계정 연결을 완료하지 못했어요' : '계정을 연결하고 있어요'}</strong>
        {error ? <button type="button" onClick={() => finish(false)}>지갑으로 돌아가기</button> : <p>잠시만 기다려 주세요.</p>}
      </div>
    </ThirdwebProvider>
  );
}
