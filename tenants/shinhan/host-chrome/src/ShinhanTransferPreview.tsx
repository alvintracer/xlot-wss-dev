import { useState, type ReactNode } from 'react';
import { Camera, CaretDown, CaretLeft, CaretRight, MagnifyingGlass, PencilSimple, Star, Warning, X } from '@phosphor-icons/react';
import './shinhanTransferPreview.css';

export type ShinhanTransferStage = 'recipient' | 'amount' | 'confirm' | 'favorites';

const exampleRecipient = '예시 받는 분';
const exampleAccount = '테스트은행 · •••• 0000';
const exampleSource = '입출금 예시 계좌';
const availableAmount = 1_250_000;
const formatWon = (digits: string) => `${Number(digits || '0').toLocaleString('ko-KR')}원`;

function FlowHeader({ onBack, onClose, children }: { onBack: () => void; onClose: () => void; children?: ReactNode }) {
  return <header className="shinhan-transfer__header"><button type="button" aria-label="뒤로" onClick={onBack}><CaretLeft size={27} aria-hidden="true" /></button><div>{children}</div><button type="button" aria-label="닫기" onClick={onClose}><X size={25} aria-hidden="true" /></button></header>;
}

export function ShinhanTransferPreview({ stage, onStage, onClose, onPin, amountDigits, onAmountDigits, onBack, onPreviewAction }: {
  stage: ShinhanTransferStage;
  onStage: (stage: ShinhanTransferStage) => void;
  onClose: () => void;
  onPin: () => void;
  amountDigits: string;
  onAmountDigits: (digits: string) => void;
  onBack: () => void;
  onPreviewAction: (name: string) => void;
}) {
  const [section, setSection] = useState<'recent' | 'mine' | 'favorites'>('recent');
  const [accountInput, setAccountInput] = useState('');
  const [favoriteAdded, setFavoriteAdded] = useState(true);
  const [favoriteExtraOpen, setFavoriteExtraOpen] = useState(false);
  const selectRecipient = () => { onAmountDigits(''); onStage('amount'); };
  const pressAmountKey = (key: string) => onAmountDigits(key === 'delete' ? amountDigits.slice(0, -1) : `${amountDigits}${key}`.replace(/^0+(?=\d)/, '').slice(0, 9));
  const setQuickAmount = (increment: number) => onAmountDigits(String(Math.min(availableAmount, Number(amountDigits || '0') + increment)));

  return <div className="shinhan-transfer" data-stage={stage} data-testid="shinhan-transfer-preview">
    {stage === 'recipient' ? <>
      <FlowHeader onBack={onBack} onClose={onClose}><button type="button" onClick={() => onPreviewAction('다건이체')}>다건이체</button><button type="button" onClick={() => onPreviewAction('연락처')}>연락처</button></FlowHeader>
      <div className="shinhan-transfer__scroll">
        <div className="shinhan-transfer__recipient-intro"><h2>누구에게 보낼까요?</h2><button type="button" aria-label="받는 분 검색" onClick={() => document.getElementById('shinhan-recipient-input')?.focus()}><MagnifyingGlass size={24} aria-hidden="true" /></button></div>
        <form className="shinhan-transfer__account-entry" onSubmit={(event) => { event.preventDefault(); if (accountInput) selectRecipient(); }}><label htmlFor="shinhan-recipient-input" className="sr-only">받는 계좌번호</label><input id="shinhan-recipient-input" inputMode="numeric" autoComplete="off" value={accountInput} onChange={(event) => setAccountInput(event.target.value.replace(/\D/g, '').slice(0, 20))} placeholder="계좌번호 직접 입력" /><button type={accountInput ? 'submit' : 'button'} aria-label={accountInput ? '입력한 계좌로 계속' : '계좌번호 스캔 미리보기'} onClick={accountInput ? undefined : () => onPreviewAction('계좌번호 스캔')}>
          {accountInput ? <CaretRight size={22} aria-hidden="true" /> : <Camera size={22} aria-hidden="true" />}
        </button></form>
        <button className="shinhan-transfer__recent-link" type="button" onClick={selectRecipient}><strong>최근 보낸 계좌</strong>로 이체하기 <CaretRight size={20} aria-hidden="true" /></button>
        <div className="shinhan-transfer__section-list">
          <div className="shinhan-transfer__section-head"><strong>자주쓰는 계좌</strong><button type="button" onClick={() => onStage('favorites')}>편집</button><button type="button" className="shinhan-transfer__section-count" onClick={() => setSection(section === 'favorites' ? 'recent' : 'favorites')}>{favoriteAdded ? '1개' : '0개'} <CaretDown size={16} aria-hidden="true" /></button></div>
          {section === 'favorites' && favoriteAdded ? <button className="shinhan-transfer__person" type="button" onClick={selectRecipient}><span className="shinhan-transfer__bank-mark">H</span><span><strong>{exampleRecipient}</strong><small>{exampleAccount}</small></span><Star size={20} aria-hidden="true" /></button> : null}
          <div className="shinhan-transfer__section-head"><strong>내 계좌</strong><button type="button" className="shinhan-transfer__section-count" onClick={() => setSection(section === 'mine' ? 'recent' : 'mine')}>1개 <CaretDown size={16} aria-hidden="true" /></button></div>
          {section === 'mine' ? <button className="shinhan-transfer__person" type="button" onClick={selectRecipient}><span className="shinhan-transfer__bank-mark">H</span><span><strong>{exampleSource}</strong><small>예시은행 · •••• 1234</small></span><CaretRight size={19} aria-hidden="true" /></button> : null}
          <div className="shinhan-transfer__section-head"><strong>최근</strong><button type="button" className="shinhan-transfer__section-count" onClick={() => setSection(section === 'recent' ? 'mine' : 'recent')}>1개 <CaretDown size={16} aria-hidden="true" /></button></div>
          {section === 'recent' ? <button className="shinhan-transfer__person" type="button" onClick={selectRecipient}><span className="shinhan-transfer__bank-mark">H</span><span><strong>{exampleRecipient}</strong><small>{exampleAccount}</small></span><Star size={21} aria-hidden="true" /></button> : null}
        </div>
      </div>
    </> : null}

    {stage === 'favorites' ? <>
      <FlowHeader onBack={onBack} onClose={onClose}><strong>자주쓰는 계좌 편집</strong></FlowHeader>
      <div className="shinhan-transfer__favorites"><div className="shinhan-transfer__favorites-count">전체 <strong>{favoriteAdded ? '01건' : '00건'}</strong><button type="button" onClick={() => onPreviewAction('목록편집')}>목록편집</button></div>{favoriteAdded ? <div className="shinhan-transfer__favorite-card"><div><span className="shinhan-transfer__bank-mark">H</span><span><strong>{exampleRecipient}</strong><small>{exampleAccount}</small></span><button type="button" aria-label="자주쓰는 계좌 삭제" onClick={() => setFavoriteAdded(false)}><X size={20} aria-hidden="true" /></button></div><button type="button" aria-expanded={favoriteExtraOpen} onClick={() => setFavoriteExtraOpen(value => !value)}>추가정보 <CaretDown size={19} aria-hidden="true" /></button>{favoriteExtraOpen ? <p>예시은행 · 계좌번호 끝 0000</p> : null}</div> : <p>등록된 계좌가 없어요.</p>}</div>
      <div className="shinhan-transfer__footer shinhan-transfer__footer--split"><button type="button" onClick={() => { setFavoriteAdded(true); onStage('recipient'); }}>추가하기</button><button type="button" onClick={() => onStage('recipient')}>저장</button></div>
    </> : null}

    {stage === 'amount' ? <>
      <FlowHeader onBack={onBack} onClose={onClose} />
      <div className="shinhan-transfer__amount-main"><div className="shinhan-transfer__source"><strong>{exampleSource}</strong><span>계좌에서 <CaretDown size={18} aria-hidden="true" /></span></div><div className="shinhan-transfer__destination"><strong>{exampleRecipient} 계좌로</strong><small>{exampleAccount}</small></div><div className="shinhan-transfer__amount-prompt"><strong className={amountDigits ? 'has-amount' : undefined}>{amountDigits ? formatWon(amountDigits) : '얼마를 보낼까요?'}</strong><small>출금가능금액 <u>{availableAmount.toLocaleString('ko-KR')}원</u></small></div></div>
      <div className="shinhan-transfer__amount-bottom"><div className="shinhan-transfer__quick">{[['+1만',10000],['+5만',50000],['+10만',100000],['전액',availableAmount]].map(([label,value]) => <button key={label} type="button" onClick={() => label === '전액' ? onAmountDigits(String(availableAmount)) : setQuickAmount(Number(value))}>{label}</button>)}</div><div className="shinhan-transfer__number-pad">{['1','2','3','4','5','6','7','8','9','00','0','delete'].map(key => <button key={key} type="button" aria-label={key === 'delete' ? '한 자리 지우기' : `숫자 ${key}`} onClick={() => pressAmountKey(key)}>{key === 'delete' ? <span className="shinhan-transfer__delete">⌫</span> : key}</button>)}</div><button className="shinhan-transfer__primary" type="button" disabled={!amountDigits || Number(amountDigits) === 0} onClick={() => onStage('confirm')}>다음</button></div>
    </> : null}

    {stage === 'confirm' ? <>
      <FlowHeader onBack={onBack} onClose={onClose} />
      <div className="shinhan-transfer__confirm"><div className="shinhan-transfer__confirm-icon" aria-hidden="true">↗</div><h2>{exampleRecipient}님 계좌로<br />{formatWon(amountDigits || '100')} 보낼까요?</h2><p>수수료 무료</p><div className="shinhan-transfer__warning"><Warning size={18} weight="fill" aria-hidden="true" />받는 계좌를 다시 확인해주세요.</div><dl><div><dt>보내는 계좌</dt><dd>예시은행 · •••• 1234</dd></div><div><dt>받는 계좌</dt><dd>{exampleAccount}</dd></div><div><dt>받는 분 메모</dt><dd>{exampleRecipient} <PencilSimple size={16} aria-hidden="true" /></dd></div></dl></div>
      <div className="shinhan-transfer__footer"><button className="shinhan-transfer__primary" type="button" onClick={onPin}>보내기</button></div>
    </> : null}
  </div>;
}
