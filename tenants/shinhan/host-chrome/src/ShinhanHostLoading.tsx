import { Wallet } from '@phosphor-icons/react';
import './loading.css';

export function ShinhanHostLoading({ phase }: { phase: 'idle' | 'loading' | 'ready' }) {
  return <div className="shinhan-ui shinhan-host-loading" data-phase={phase}>
    <div className="shinhan-host-loading__scene" aria-hidden="true">
      <span className="shinhan-host-loading__orbit" />
      <span className="shinhan-host-loading__wallet"><Wallet size={64} weight="duotone" /></span>
      <span className="shinhan-host-loading__glint shinhan-host-loading__glint--one" />
      <span className="shinhan-host-loading__glint shinhan-host-loading__glint--two" />
    </div>
    <strong>쏠지갑을 준비하고 있어요</strong>
    <p>내 지갑을 안전하게 확인하는 중이에요.</p>
    <div className="shinhan-host-loading__track" aria-hidden="true"><span /></div>
  </div>;
}
