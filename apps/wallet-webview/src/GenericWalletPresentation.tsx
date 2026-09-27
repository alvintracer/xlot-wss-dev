import { ArrowClockwise, Wallet } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import type { WalletPresentationProps } from '@took-wss/contracts';

export default function GenericWalletPresentation({ manifest, walletHome, onNavigate }: WalletPresentationProps) {
  const title = walletHome.status === 'absent'
    ? '아직 지갑이 없습니다'
    : walletHome.status === 'empty'
      ? '보유 자산이 없습니다'
      : walletHome.status === 'unavailable'
        ? '자산을 불러오지 못했습니다'
        : walletHome.totalFiat?.display ?? '—';

  return (
    <main className="generic-wallet" style={{ '--tenant-primary': manifest.brand.primaryColor } as CSSProperties}>
      <div className="generic-wallet__mark" aria-hidden="true">
        {walletHome.status === 'unavailable' ? <ArrowClockwise size={34} /> : <Wallet size={34} />}
      </div>
      <h1>{title}</h1>
      <p>{manifest.walletName} 서비스 상태를 기관 세션에서 안전하게 확인했습니다.</p>
      {walletHome.status === 'absent' && walletHome.canCreate ? <button type="button" onClick={() => onNavigate('wallet/create')}>지갑 만들기</button> : null}
      {walletHome.status === 'empty' ? <button type="button" onClick={() => onNavigate('wallet/receive')}>받기</button> : null}
      {walletHome.status === 'unavailable' && walletHome.canRetry ? <button type="button" onClick={() => onNavigate('wallet/retry')}>다시 불러오기</button> : null}
    </main>
  );
}
