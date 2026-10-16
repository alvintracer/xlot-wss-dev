import { LockKey, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { ProviderWalletLoginState } from '@took-wss/contracts';
import { BusyButtonLabel } from './BusyButtonLabel';

interface Props {
  state: ProviderWalletLoginState;
  pwaOAuthRedirect: boolean;
  onConnect: (strategy?: 'google' | 'apple' | 'stored') => Promise<{ address: string }>;
  onComplete: (address: string) => Promise<void>;
  onCancel: () => void;
}

export function ProviderReconnectDialog({ state, pwaOAuthRedirect, onConnect, onComplete, onCancel }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const connectRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    connectRef.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !connecting) onCancel();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [connecting, onCancel]);

  const connect = async (strategy?: 'google' | 'apple' | 'stored') => {
    setConnecting(true);
    setLocalError(null);
    try {
      const account = await onConnect(strategy);
      await onComplete(account.address);
    } catch (error) {
      if (error != null) setLocalError('계정을 연결하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="kw-provider-login-backdrop" role="presentation" onMouseDown={() => { if (!connecting) onCancel(); }}>
      <section className="kw-provider-login" role="dialog" aria-modal="true" aria-labelledby="kw-provider-login-title"
        ref={dialogRef} onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="kw-provider-login__grabber" aria-hidden="true" />
        <header>
          <span className="kw-provider-login__mark" aria-hidden="true"><LockKey weight="regular" /></span>
          <button type="button" aria-label="닫기" disabled={connecting || state.busy} onClick={onCancel}><X aria-hidden="true" /></button>
        </header>
        <h2 id="kw-provider-login-title">기존 지갑을 연결해 주세요</h2>
        <p>거래에 서명하려면 이 지갑을 만들 때 사용한 Google, Apple 또는 이메일 계정으로 로그인해 주세요.</p>
        {state.error || localError ? <p className="kw-provider-login__error" role="alert">{state.error || localError}</p> : null}
        {pwaOAuthRedirect ? <div className="kw-pwa-auth-methods kw-mt-24" aria-label="계정 로그인 방법">
          <button ref={connectRef} type="button" disabled={connecting || state.busy} onClick={() => void connect('google')}>Google로 계속</button>
          <button type="button" disabled={connecting || state.busy} onClick={() => void connect('apple')}>Apple로 계속</button>
          <button type="button" disabled={connecting || state.busy} onClick={() => void connect()}>이메일로 계속</button>
        </div> : <button ref={connectRef} className="kw-button" type="button" disabled={connecting || state.busy}
          aria-busy={connecting || state.busy} onClick={() => void connect()}>
          {connecting || state.busy ? <BusyButtonLabel>계정을 확인하고 있어요</BusyButtonLabel> : '계정 선택하기'}
        </button>}
      </section>
    </div>
  );
}
