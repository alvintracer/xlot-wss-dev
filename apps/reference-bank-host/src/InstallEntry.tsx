import { StrictMode, Suspense, lazy, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { LockKey } from '@phosphor-icons/react';
import type { InstallLandingConfig } from './InstallLanding';
import { InstallLanding, rememberWebChoice, shouldShowInstallLanding } from './InstallLanding';
import { clearPwaThirdwebReturnUrl, hasPendingPwaWalletCreation, hasPwaThirdwebReturn, readPendingPwaThirdwebRedirect } from './pwaThirdwebRedirect';
import '@took-wss/ops-ui/tokens.css';
import './styles.css';

const WalletHost = lazy(() => import('./App').then(({ App }) => ({ default: App })));
const PwaThirdwebReturn = lazy(() => import('./PwaThirdwebReturn').then(({ PwaThirdwebReturn: Component }) => ({ default: Component })));

export function mountInstallEntry(config: InstallLandingConfig): void {
  function Entry() {
    const [showInstall, setShowInstall] = useState(() => shouldShowInstallLanding(config));
    const [returnClientId] = useState(() => hasPwaThirdwebReturn()
      ? readPendingPwaThirdwebRedirect(config.tenantId)?.clientId ?? '' : null);
    const [processingReturn, setProcessingReturn] = useState(returnClientId !== null);
    const [resumingCreation, setResumingCreation] = useState(false);
    const continueInBrowser = () => { rememberWebChoice(config); setShowInstall(false); };
    if (processingReturn && returnClientId) return <Suspense fallback={<div className="install-landing__loading" style={{ background: config.colors.canvas, color: config.colors.ink, fontFamily: config.fontFamily, '--app-loading-primary': config.colors.primary, '--app-loading-primary-ink': config.colors.primaryInk } as CSSProperties} role="status"><div className="install-landing__loading-mark"><LockKey size={28} weight="duotone" /><span /></div><strong>계정을 연결하고 있어요</strong><p>잠시만 기다려 주세요.</p></div>}>
      <PwaThirdwebReturn config={config} clientId={returnClientId} onComplete={(connected) => { setResumingCreation(connected && hasPendingPwaWalletCreation(config.tenantId)); setProcessingReturn(false); setShowInstall(false); }} />
    </Suspense>;
    if (processingReturn) return <div className="install-landing__loading" style={{ background: config.colors.canvas, color: config.colors.ink, fontFamily: config.fontFamily, '--app-loading-primary': config.colors.primary, '--app-loading-primary-ink': config.colors.primaryInk } as CSSProperties} role="alert">
      <strong>계정 연결을 확인하지 못했어요</strong>
      <button type="button" onClick={() => { clearPwaThirdwebReturnUrl(); setProcessingReturn(false); setShowInstall(false); }}>지갑으로 돌아가기</button>
    </div>;
    return showInstall
      ? <InstallLanding config={config} onContinue={continueInBrowser} />
      : <Suspense fallback={<div className="install-landing__loading" style={{ background: config.colors.canvas, color: config.colors.ink, fontFamily: config.fontFamily, '--app-loading-primary': config.colors.primary } as CSSProperties} role="status"><div className="install-landing__loading-mark"><LockKey size={28} weight="duotone" /><span /></div><strong>{resumingCreation ? '새 지갑을 생성하고 있어요' : '안전한 지갑을 준비하고 있어요'}</strong><p>잠시만 기다려 주세요.</p></div>}><WalletHost resumingCreation={resumingCreation} /></Suspense>;
  }

  createRoot(document.getElementById('root')!).render(<StrictMode><Entry /></StrictMode>);
}
