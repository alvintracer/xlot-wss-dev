import { useState } from 'react';
import { ArrowCounterClockwise, ArrowLeft, X } from '@phosphor-icons/react';
import './simple-password-preview.css';

/** Local host-owned visual preview. Only the number of taps is held; no PIN digits are collected. */
export function ShinhanSimplePasswordPreview({ onClose }: { onClose: () => void }) {
  const [enteredCount, setEnteredCount] = useState(0);
  const keys = ['1', '0', '4', '3', '2', '8', '9', '6', '7', 'clear', '5', 'delete'] as const;
  return <section className="shinhan-simple-password-preview" aria-label="간편비밀번호 입력 화면" data-testid="shinhan-simple-password-preview">
    <div className="shinhan-simple-password-preview__top"><button type="button" aria-label="간편비밀번호 입력 닫기" onClick={onClose}><X size={22} aria-hidden="true" /></button></div>
    <div className="shinhan-simple-password-preview__prompt"><h2>간편비밀번호를 입력해주세요</h2><div className="shinhan-simple-password-preview__dots" role="status" aria-label={`${enteredCount}자리 입력됨`}>{Array.from({ length: 6 }, (_, index) => <span key={index} data-filled={index < enteredCount} aria-hidden="true" />)}</div></div>
    <div className="shinhan-simple-password-preview__keys" aria-label="숫자 패드">{keys.map((key) => <button key={key} type="button" aria-label={key === 'clear' ? '입력 지우기' : key === 'delete' ? '한 자리 지우기' : `숫자 ${key}`} onClick={() => setEnteredCount((count) => key === 'clear' ? 0 : key === 'delete' ? Math.max(0, count - 1) : Math.min(6, count + 1))}>{key === 'clear' ? <ArrowCounterClockwise size={25} aria-hidden="true" /> : key === 'delete' ? <ArrowLeft size={25} aria-hidden="true" /> : key}</button>)}</div>
  </section>;
}
