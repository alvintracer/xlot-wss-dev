import { Suspense } from 'react';
import { LockKey } from '@phosphor-icons/react';
import { getWalletPresentation } from './presentationRegistry';
import { useWssRuntime } from './useWssRuntime';

function RuntimeGate({ error }: { error: string | null }) {
  return (
    <main className="runtime-gate" aria-live="polite">
      <div className="runtime-mark"><LockKey size={28} weight="duotone" /></div>
      <strong>{error ? '연결을 확인해 주세요' : '안전한 지갑을 준비하고 있어요'}</strong>
      <p>{error || '기관 세션과 서비스 정책을 확인하는 중입니다.'}</p>
    </main>
  );
}

export function App() {
  const runtime = useWssRuntime();
  if (runtime.status !== 'ready') return <RuntimeGate error={runtime.error} />;

  const { manifest, walletHome } = runtime.bootstrap;
  const boundaryMismatch = (manifest.presentation.rootHeaderOwner === 'host' && !runtime.hostCapabilities.rendersRootHeader)
    || (manifest.presentation.rootNavigationOwner === 'host' && !runtime.hostCapabilities.rendersRootTabs)
    || (manifest.presentation.safeAreaOwner === 'host' && !runtime.hostCapabilities.handlesSafeArea);
  if (boundaryMismatch) return <RuntimeGate error="금융사 앱과 지갑 화면의 표시 영역 설정이 맞지 않습니다." />;

  const Presentation = getWalletPresentation(manifest.presentation.profileId);
  return (
    <Suspense fallback={<RuntimeGate error={null} />}>
      <Presentation
        manifest={manifest}
        sessionKeyAdapter={runtime.bootstrap.session.keyAdapter}
        hostCapabilities={runtime.hostCapabilities}
        walletHome={walletHome}
        onNavigate={runtime.navigate}
        onShellModeChange={runtime.setShellMode}
        onRequestHostAuthentication={runtime.requestHostAuthentication}
        onRequestSecureSarWalletCreation={runtime.requestSecureSarWalletCreation}
        onRequestSecureWalletImport={runtime.requestSecureWalletImport}
        onProvisionWallet={runtime.provisionWallet}
        onSelectWallet={runtime.selectWallet}
      />
    </Suspense>
  );
}
