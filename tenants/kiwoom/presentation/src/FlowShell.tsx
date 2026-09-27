import { ArrowLeft, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

interface FlowShellProps {
  title: string;
  step: number;
  totalSteps: number;
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function FlowShell({ title, step, totalSteps, onBack, onClose, children, footer }: FlowShellProps) {
  const progress = `${Math.round((step / totalSteps) * 100)}%`;
  return (
    <section className="kw-screen kw-flow-screen">
      <header className="kw-header" data-testid="kiwoom-flow-header">
        {onBack ? (
          <button className="kw-icon-button kw-header__left" type="button" aria-label="이전" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : null}
        <strong className="kw-header__title">{title}</strong>
        <button className="kw-icon-button kw-header__right" type="button" aria-label="닫기" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <div className="kw-progress" aria-hidden="true"><span style={{ width: progress }} /></div>
      </header>
      <div className="kw-scroll">
        <div className="kw-page-pad kw-flow-content">{children}</div>
      </div>
      {footer ? <footer className="kw-footer kw-footer--flow">{footer}</footer> : null}
    </section>
  );
}
