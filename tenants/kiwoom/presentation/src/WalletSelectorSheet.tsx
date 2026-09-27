import { Check, Plus, Wallet, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { KeyAdapterId, WalletProfileSummary } from '@took-wss/contracts';

interface WalletSelectorSheetProps {
  wallets: WalletProfileSummary[];
  selectedWalletId: string;
  onSelect: (walletId: string) => Promise<void>;
  onAdd: () => void;
  onClose: () => void;
}

const adapterLabels: Record<KeyAdapterId, string> = {
  'took-sar': 'SAR 자가복구',
  'thirdweb-user-wallet': 'Thirdweb MPC',
  'fsl-mpc': 'FSL MPC',
};

export function WalletSelectorSheet({ wallets, selectedWalletId, onSelect, onAdd, onClose }: WalletSelectorSheetProps) {
  const [loadingWalletId, setLoadingWalletId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = layerRef.current?.querySelector<HTMLElement>('.kw-sheet');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const selectWallet = async (walletId: string) => {
    if (walletId === selectedWalletId) {
      onClose();
      return;
    }
    setLoadingWalletId(walletId);
    setError(null);
    try {
      await onSelect(walletId);
      onClose();
    } catch {
      setError('선택한 지갑의 자산을 불러오지 못했어요.');
      setLoadingWalletId(null);
    }
  };

  return (
    <div className="kw-sheet-layer" ref={layerRef}>
      <button className="kw-sheet-scrim" type="button" aria-label="닫기" onClick={onClose} />
      <section className="kw-sheet kw-wallet-selector-sheet" role="dialog" aria-modal="true" aria-labelledby="kw-wallet-selector-title">
        <button className="kw-icon-button kw-sheet-close" type="button" aria-label="닫기" onClick={onClose}><X aria-hidden="true" /></button>
        <h2 className="kw-sheet-title" id="kw-wallet-selector-title">지갑 선택</h2>
        <p className="kw-body kw-mt-8">선택한 지갑 슬롯의 자산만 조회하고 보여드려요.</p>
        <div className="kw-sheet-options kw-wallet-selector-options">
          {wallets.map((wallet) => {
            const selected = wallet.walletId === selectedWalletId;
            return (
              <button
                className="kw-choice kw-wallet-choice"
                type="button"
                key={wallet.walletId}
                aria-pressed={selected}
                disabled={loadingWalletId !== null}
                onClick={() => void selectWallet(wallet.walletId)}
              >
                <span className="kw-wallet-choice__icon"><Wallet aria-hidden="true" /></span>
                <span className="kw-wallet-choice__copy">
                  <strong>{wallet.label}</strong>
                  <small>{adapterLabels[wallet.keyAdapter]} · {wallet.origin === 'imported' ? '가져온 지갑' : '새로 만든 지갑'}</small>
                </span>
                {selected ? <Check aria-label="현재 선택" /> : loadingWalletId === wallet.walletId ? <span className="kw-caption">조회 중</span> : null}
              </button>
            );
          })}
        </div>
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
        <button className="kw-button kw-button--secondary kw-wallet-add-button kw-mt-16" type="button" onClick={onAdd}>
          <Plus aria-hidden="true" />지갑 슬롯 추가하기
        </button>
      </section>
    </div>
  );
}
