import { ArrowClockwise, CaretDown, Eye, EyeSlash, Plus } from '@phosphor-icons/react';
import type { ReadyWalletSummaryProps } from '@took-wss/tenant-kiwoom-presentation';
import { useShinhanWalletTabs } from './ShinhanWalletTabs';

export function ShinhanWalletSummary({ walletHome, balanceHidden, onToggleBalance, onOpenWalletSelector, onAddWallet, onShowAction, onRefreshWallet }: ReadyWalletSummaryProps) {
  const { tab, setTab } = useShinhanWalletTabs();
  const total = walletHome.totalFiat?.display ?? '—';
  const detail = walletHome.totalFiat?.stale ? '금액을 업데이트하고 있어요' : !walletHome.totalFiat ? '금액 정보를 확인할 수 없어요' : walletHome.assets.length === 0 ? '보유 자산이 없어요' : `보유 자산 ${walletHome.assets.length}개`;
  return <div className="shinhan-wallet-home-head"><nav className="shinhan-wallet-tabs" aria-label="쏠지갑 메뉴" data-active={tab}>
    <button type="button" aria-current={tab === 'identity' ? 'page' : undefined} onClick={() => setTab('identity')}>신원·결제</button>
    <button type="button" aria-current={tab === 'assets' ? 'page' : undefined} onClick={() => setTab('assets')}>디지털자산</button>
  </nav>{tab === 'assets' ? <section className="shinhan-wallet-summary" aria-label="내 지갑 자산 요약">
    <div className="shinhan-wallet-summary__head">
      <button className="shinhan-wallet-summary__selector" type="button" onClick={onOpenWalletSelector}>
        <span>{walletHome.wallet.label}</span><CaretDown size={18} aria-hidden="true" />
      </button>
      <div className="shinhan-wallet-summary__tools">
        <button type="button" aria-label="금액 새로고침" onClick={onRefreshWallet}><ArrowClockwise size={19} aria-hidden="true" /></button>
        <button type="button" aria-label={balanceHidden ? '금액 보기' : '금액 숨기기'} aria-pressed={balanceHidden} onClick={onToggleBalance}>
          {balanceHidden ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
    </div>
    <p className="shinhan-wallet-summary__eyebrow">전체 자산</p>
    <strong className="shinhan-wallet-summary__amount">{balanceHidden ? '••••' : total}</strong>
    <p className="shinhan-wallet-summary__detail">{detail}</p>
    <div className="shinhan-wallet-summary__selected">
      <span><small>선택한 지갑</small><strong>{walletHome.wallet.label}</strong></span>
      <button type="button" aria-label="지갑 추가" onClick={onAddWallet}><Plus size={20} aria-hidden="true" /></button>
    </div>
    <div className="shinhan-wallet-summary__actions" aria-label="지갑 주요 기능">
      <button type="button" onClick={() => onShowAction('receive')}>받기</button>
      <button type="button" onClick={() => onShowAction('send')}>보내기</button>
      <button type="button" onClick={() => onShowAction('exchange')}>바꾸기</button>
    </div>
  </section> : null}</div>;
}
