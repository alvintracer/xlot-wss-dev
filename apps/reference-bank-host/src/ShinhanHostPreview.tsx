import { useState } from 'react';
import { CaretLeft, CaretRight, GearSix, X } from '@phosphor-icons/react';
import { ShinhanTransferPreview, type ShinhanTransferStage } from '@took-wss/tenant-shinhan-host-chrome/transfer-preview';
import { ShinhanSimplePasswordPreview } from '@took-wss/tenant-shinhan-host-chrome/simple-password-preview';
import type { HostChromeProps } from './hostChromeRegistry';
import './ShinhanHostPreview.css';

const tabs = ['bank', 'card', 'securities', 'insurance'] as const;
const retirementArt = new URL('../../../tenants/shinhan/presentation/assets/preview/retirement-bank-preview.png', import.meta.url).href;
const bankMark = new URL('../../../tenants/shinhan/presentation/assets/preview/bank-mark-preview.png', import.meta.url).href;
const sampleAccounts = [
  { name: '입출금 계좌', number: '신한은행 · 끝 1234', balance: '1,250,000원' },
  { name: '내 자산 계좌', number: '신한은행 · 끝 5678', balance: '340,000원' },
  { name: '퇴직연금 계좌', number: '신한은행 · 끝 9012', balance: '2,000,000원' },
] as const;

// Host-app development scene. These sample accounts never enter WSS or its API.
export function ShinhanHostPreview({ activeTab = 'finance:bank', onAction }: HostChromeProps) {
  const [transferStage, setTransferStage] = useState<ShinhanTransferStage | 'pin' | null>(null);
  const [amountDigits, setAmountDigits] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const [accountPage, setAccountPage] = useState(0);
  const account = sampleAccounts[accountPage]!;
  const tab = activeTab.startsWith('finance:') ? activeTab.slice(8) : 'bank';
  const closeTransfer = () => { setTransferStage(null); setAmountDigits(''); };
  const backTransfer = () => {
    if (transferStage === 'amount' || transferStage === 'favorites') setTransferStage('recipient');
    else if (transferStage === 'confirm') setTransferStage('amount');
    else if (transferStage === 'pin') setTransferStage('confirm');
    else closeTransfer();
  };
  return <div className="shinhan-live-preview shinhan-ui" aria-label="신한 금융 화면">
    <div className="shinhan-live-preview__viewport"><div className="shinhan-live-preview__track" style={{ transform: `translateX(-${Math.max(0, tabs.indexOf(tab as typeof tabs[number])) * 25}%)` }}>
      {tabs.map((pane) => <div className="shinhan-live-preview__pane" key={pane}>
        {pane === 'bank' ? <>
          <div className="shinhan-live-preview__amount"><span>금액</span><span className="shinhan-live-preview__toggle" aria-hidden="true">₩</span><button type="button" onClick={() => setSheet('금액 편집')}>편집 <CaretRight size={16} /></button></div>
          <section className="shinhan-live-preview__card" aria-label="계좌"><div className="shinhan-live-preview__card-head"><h2>계좌</h2><button type="button" onClick={() => setSheet('전체계좌')}>전체계좌 <CaretRight size={17} /></button></div><div className="shinhan-live-preview__account"><img src={bankMark} alt="" /><div><strong>{account.name}</strong><small>{account.number}</small></div><button type="button" aria-label="계좌 설정" onClick={() => setSheet('계좌 설정')}><GearSix size={21} /></button></div><strong className="shinhan-live-preview__balance">{account.balance}</strong><button className="shinhan-live-preview__transfer" type="button" onClick={() => setTransferStage('recipient')}>이체</button></section>
          <nav className="shinhan-live-preview__dots" aria-label="계좌 넘기기"><button type="button" aria-label="이전 계좌" onClick={() => setAccountPage((page) => (page + sampleAccounts.length - 1) % sampleAccounts.length)}><CaretLeft size={21} /></button>{sampleAccounts.map((item, index) => <button key={item.number} type="button" className="shinhan-live-preview__dot" aria-label={`${index + 1}번째 계좌`} aria-current={accountPage === index ? 'true' : undefined} onClick={() => setAccountPage(index)} />)}<button type="button" aria-label="다음 계좌" onClick={() => setAccountPage((page) => (page + 1) % sampleAccounts.length)}><CaretRight size={21} /></button></nav>
          <button className="shinhan-live-preview__retirement" type="button" onClick={() => setSheet('나의 퇴직연금')}><span><strong>나의 퇴직연금 현황 확인하기</strong><small>내 자산 보기 <CaretRight size={17} /></small></span><img src={retirementArt} alt="" /></button>
        </> : <section className="shinhan-live-preview__card"><h2>{pane === 'card' ? '내 카드' : pane === 'securities' ? '총 자산' : '보험'}</h2><strong className="shinhan-live-preview__balance">조회된 내역이 없어요</strong><p>연결된 내역을 확인할 수 있어요.</p></section>}
      </div>)}
    </div></div>
    {transferStage ? <div className="shinhan-live-preview__flow">
      {transferStage === 'pin' ? <ShinhanSimplePasswordPreview onClose={backTransfer} />
        : <ShinhanTransferPreview stage={transferStage} onStage={setTransferStage} onClose={closeTransfer} onPin={() => setTransferStage('pin')} amountDigits={amountDigits} onAmountDigits={setAmountDigits} onBack={backTransfer} onPreviewAction={setSheet} />}
    </div> : null}
    {sheet ? <div className="shinhan-live-preview__sheet" role="dialog" aria-modal="true" aria-label={sheet}><button type="button" aria-label="닫기" onClick={() => setSheet(null)}><X size={22} /></button><strong>{sheet}</strong><p>서비스를 준비하고 있어요.</p><button type="button" onClick={() => { setSheet(null); onAction?.('화면을 닫았습니다.'); }}>확인</button></div> : null}
  </div>;
}
