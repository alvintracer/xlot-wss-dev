import { Backspace, X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePreviewKeypadKeys } from './PreviewKeypadContext';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  layout: 'four-column' | 'three-column';
  inline?: boolean;
  autoOpen?: boolean;
}

export function SecurePinKeypad({ value, onChange, disabled = false, layout, inline = false, autoOpen = false }: Props) {
  const [open, setOpen] = useState(autoOpen);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const dotsRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const keypadId = useId();
  const previewKeys = usePreviewKeypadKeys();
  const keys = layout === 'four-column'
    ? ['1', '2', '3', '4', '5', '6', '7', '8', '', '', '9', '0']
    : previewKeys ?? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLButtonElement>('.host-pin-keypad button:not([disabled]), .host-pin-erase:not([disabled]), .host-pin-sheet__head button')?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    queueMicrotask(() => dotsRef.current?.focus());
  };
  const enter = (digit: string) => {
    if (disabled || value.length >= 6) return;
    onChange(value + digit);
    if (value.length === 5) close();
  };
  const erase = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };
  const onPadKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (/^\d$/.test(event.key)) { event.preventDefault(); enter(event.key); return; }
    if (event.key === 'Backspace') { event.preventDefault(); erase(); return; }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(sheetRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  };
  const keysView = <div className="host-pin-keypad" data-layout={layout}>
    {keys.map((key, index) => key === '' ? <span key={`space-${index}`} aria-hidden="true" /> :
      <button key={`${key}-${index}`} type="button" disabled={disabled || key !== 'delete' && key !== 'clear' && value.length >= 6}
        aria-label={key === 'delete' ? '한 자리 지우기' : key === 'clear' ? '전체 지우기' : `${key} 입력`}
        onClick={() => key === 'delete' ? erase() : key === 'clear' ? onChange('') : enter(key)}>
        {key === 'delete' ? <Backspace size={23} aria-hidden="true" /> : key === 'clear' ? '↺' : key}
      </button>)}
  </div>;
  const previewPrompt = previewKeys ? <div className="host-pin-preview-prompt"><h2>간편비밀번호를 입력해주세요</h2>
    <div className="host-pin-preview-dots" role="status" aria-label={`${value.length}자리 입력됨`}>
      {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < value.length ? 'is-filled' : ''} aria-hidden="true" />)}
    </div>
  </div> : null;

  return <div className="host-pin-entry" data-layout={layout}>
    <button
      ref={dotsRef}
      className="host-pin-dots"
      type="button"
      disabled={disabled}
      aria-label={`간편 비밀번호 입력, ${value.length}자리 입력됨`}
      aria-expanded={open}
      aria-controls={open ? keypadId : undefined}
      onClick={() => {
        if (!inline) setLayer(dotsRef.current?.closest<HTMLElement>('.host-security-layer') ?? null);
        setOpen(true);
      }}
    >
      {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < value.length ? 'is-filled' : ''} aria-hidden="true" />)}
    </button>
    {open && inline ? <div ref={sheetRef} className="host-pin-inline" id={keypadId} role="group" aria-label="간편 비밀번호 숫자 키패드" onKeyDown={onPadKeyDown}>
      {previewPrompt}
      {keysView}
      {layout === 'four-column' ? <button className="host-pin-erase" type="button" disabled={disabled || value.length === 0} onClick={erase}><Backspace size={20} aria-hidden="true" /> 한 자리 지우기</button> : null}
    </div> : null}
    {open && !inline && layer ? createPortal(<div className="host-pin-overlay" id={keypadId}>
      <button className="host-pin-overlay__scrim" type="button" aria-label="키패드 닫기" onClick={close} />
      <div ref={sheetRef} className="host-pin-sheet" role="dialog" aria-modal="true" aria-label="간편 비밀번호 숫자 키패드" onKeyDown={onPadKeyDown}>
        <div className="host-pin-sheet__head"><span>간편 비밀번호</span><button type="button" aria-label="키패드 닫기" onClick={close}><X size={20} aria-hidden="true" /></button></div>
        {previewPrompt}
        {keysView}
        {layout === 'four-column' ? <button className="host-pin-erase" type="button" disabled={disabled || value.length === 0} onClick={erase}><Backspace size={20} aria-hidden="true" /> 한 자리 지우기</button> : null}
      </div>
    </div>, layer) : null}
  </div>;
}
