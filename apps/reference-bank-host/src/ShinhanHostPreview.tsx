import { useState } from 'react';
import { CaretRight, X } from '@phosphor-icons/react';
import { ShinhanTransferPreview, type ShinhanTransferStage } from '@took-wss/tenant-shinhan-host-chrome/transfer-preview';
import { ShinhanSimplePasswordPreview } from '@took-wss/tenant-shinhan-host-chrome/simple-password-preview';
import type { HostChromeProps } from './hostChromeRegistry';
import './ShinhanHostPreview.css';

const tabs = ['bank', 'card', 'securities', 'insurance'] as const;

// Host-app development scene. These sample accounts never enter WSS or its API.
export function ShinhanHostPreview({ activeTab = 'finance:bank', onAction }: HostChromeProps) {
  const [transferStage, setTransferStage] = useState<ShinhanTransferStage | 'pin' | null>(null);
  const [amountDigits, setAmountDigits] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const tab = activeTab.startsWith('finance:') ? activeTab.slice(8) : 'bank';
  const closeTransfer = () => { setTransferStage(null); setAmountDigits(''); };
  const backTransfer = () => {
    if (transferStage === 'amount' || transferStage === 'favorites') setTransferStage('recipient');
    else if (transferStage === 'confirm') setTransferStage('amount');
    else if (transferStage === 'pin') setTransferStage('confirm');
    else closeTransfer();
  };
  return <div className="shinhan-live-preview shinhan-ui" aria-label="신한 금융 화면 개발 미리보기">
    <div className="shinhan-live-preview__viewport"><div className="shinhan-live-preview__track" style={{ transform: `translateX(-${Math.max(0, tabs.indexOf(tab as typeof tabs[number])) * 25}%)` }}>
      {tabs.map((pane) => <div className="shinhan-live-preview__pane" key={pane}>
        {pane === 'bank' ? <>
          <div className="shinhan-live-preview__amount"><span>금액</span><span className="shinhan-live-preview__toggle" aria-hidden="true">₩</span><button type="button" onClick={() => setSheet('금액 편집')}>편집 <CaretRight size={16} /></button></div>
          <section className="shinhan-live-preview__card" aria-label="예시 계좌"><div className="shinhan-live-preview__card-head"><h2>계좌</h2><button type="button" onClick={() => setSheet('전체계좌')}>전체계좌 <CaretRight size={16} /></button></div><div className="shinhan-live-preview__account"><span aria-hidden="true">S</span><div><strong>입출금 예시 계좌</strong><small>예시은행 · 계좌번호 끝 1234</small></div></div><strong className="shinhan-live-preview__balance">1,250,000원</strong><button className="shinhan-live-preview__transfer" type="button" onClick={() => setTransferStage('recipient')}>이체</button></section>
          <div className="shinhan-live-preview__dots" aria-hidden="true">‹　·　<span>•</span>　·　›</div>
          <section className="shinhan-live-preview__retirement"><strong>나의 퇴직연금 현황 확인하기</strong><small>내 자산 보기　›</small></section>
        </> : <section className="shinhan-live-preview__card"><h2>{pane === 'card' ? '내 카드' : pane === 'securities' ? '총 자산' : '보험'}</h2><strong className="shinhan-live-preview__balance">조회된 내역이 없어요</strong><p>연결된 내역을 확인할 수 있어요.</p></section>}
      </div>)}
    </div></div>
    {transferStage ? <div className="shinhan-live-preview__flow">
      {transferStage === 'pin' ? <ShinhanSimplePasswordPreview onClose={backTransfer} />
        : <ShinhanTransferPreview stage={transferStage} onStage={setTransferStage} onClose={closeTransfer} onPin={() => setTransferStage('pin')} amountDigits={amountDigits} onAmountDigits={setAmountDigits} onBack={backTransfer} onPreviewAction={setSheet} />}
    </div> : null}
    {sheet ? <div className="shinhan-live-preview__sheet" role="dialog" aria-modal="true" aria-label={sheet}><button type="button" aria-label="닫기" onClick={() => setSheet(null)}><X size={22} /></button><strong>{sheet}</strong><p>이 기능은 개발 미리보기에서 준비 중이에요.</p><button type="button" onClick={() => { setSheet(null); onAction?.('미리보기를 닫았습니다.'); }}>확인</button></div> : null}
  </div>;
}
