import { CaretRight, Check, DotsThree, PencilSimple, Plus, Trash, Wallet, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { KeyAdapterId, WalletProfileSummary } from '@took-wss/contracts';
import { BusyButtonLabel } from './BusyButtonLabel';

interface WalletSelectorSheetProps {
  wallets: WalletProfileSummary[];
  selectedWalletId: string;
  onSelect: (walletId: string) => Promise<void>;
  onRename: (walletId: string, label: string) => Promise<void>;
  onRemove: (walletId: string, onProgress: (phase: 'authenticating' | 'removing') => void) => Promise<void>;
  onAdd: () => void;
  onClose: () => void;
}

const adapterLabels: Record<KeyAdapterId, string> = {
  'took-sar': '자가복구',
  'thirdweb-user-wallet': '간편 연동',
  'fsl-mpc': '기관 연동',
};

export function WalletSelectorSheet({ wallets, selectedWalletId, onSelect, onRename, onRemove, onAdd, onClose }: WalletSelectorSheetProps) {
  const [loadingWalletId, setLoadingWalletId] = useState<string | null>(null);
  const [actionWalletId, setActionWalletId] = useState<string | null>(null);
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [removalWalletId, setRemovalWalletId] = useState<string | null>(null);
  const [removeProgress, setRemoveProgress] = useState<'authenticating' | 'removing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const moreButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const closeActionFocusRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = loadingWalletId !== null;

  useEffect(() => {
    if (removeProgress) layerRef.current?.querySelector<HTMLElement>('.kw-wallet-remove-progress')?.focus();
  }, [removeProgress]);

  useEffect(() => {
    if (actionWalletId) firstActionRef.current?.focus();
    else if (closeActionFocusRef.current) {
      moreButtonsRef.current.get(closeActionFocusRef.current)?.focus();
      closeActionFocusRef.current = null;
    }
  }, [actionWalletId]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = layerRef.current?.querySelector<HTMLElement>('.kw-sheet');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
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

  const removeWallet = async () => {
    if (!removalWalletId) return;
    setLoadingWalletId(removalWalletId);
    setRemoveProgress('authenticating');
    setError(null);
    try {
      await onRemove(removalWalletId, setRemoveProgress);
      onClose();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : '';
      setError(code === 'wallet_activity_pending' ? '진행 중인 보내기·환전·휴대폰 수령이 끝난 뒤 삭제할 수 있어요.'
          : code === 'wallet_removal_cancelled' ? '고객 인증이 취소됐어요.'
            : '지갑을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
      setRemoveProgress(null);
      setLoadingWalletId(null);
    }
  };

  const closeActions = (walletId: string) => {
    closeActionFocusRef.current = walletId;
    setActionWalletId(null);
  };

  const renameWallet = async () => {
    if (!editingWalletId) return;
    const label = draftLabel.trim();
    if (!label || Array.from(label).length > 30 || /[\u0000-\u001f\u007f]/.test(label)) {
      setError('지갑 이름은 1~30자로 입력해 주세요.');
      return;
    }
    setLoadingWalletId(editingWalletId);
    setError(null);
    try {
      await onRename(editingWalletId, label);
      setEditingWalletId(null);
      setDraftLabel('');
      setStatusMessage('지갑 이름을 바꿨어요.');
    } catch {
      setError('지갑 이름을 바꾸지 못했어요. 다시 시도해 주세요.');
    } finally { setLoadingWalletId(null); }
  };

  return (
    <div className="kw-sheet-layer" ref={layerRef}>
      <button className="kw-sheet-scrim" type="button" aria-label="닫기" disabled={loadingWalletId !== null} onClick={onClose} />
      <section className="kw-sheet kw-wallet-selector-sheet" role="dialog" aria-modal="true" aria-labelledby="kw-wallet-selector-title" tabIndex={-1}>
        <button className="kw-icon-button kw-sheet-close" type="button" aria-label="닫기" disabled={loadingWalletId !== null} onClick={onClose}><X aria-hidden="true" /></button>
        <h2 className="kw-sheet-title" id="kw-wallet-selector-title">{removeProgress ? '지갑 삭제 중' : removalWalletId ? '지갑 삭제' : editingWalletId ? '지갑 이름 변경' : '지갑 선택'}</h2>
        {!removalWalletId && !editingWalletId ? <p className="kw-body kw-mt-8">선택한 지갑의 자산만 조회하고 보여드려요.</p> : null}
        {removeProgress ? <div className="kw-wallet-remove-progress" role="status" tabIndex={-1}>
          <span className="kw-flow-spinner" aria-hidden="true" />
          <strong>{removeProgress === 'authenticating' ? '고객 인증을 기다리고 있어요' : '지갑을 삭제하고 있어요'}</strong>
          <p>{removeProgress === 'authenticating' ? '인증을 마치면 진행 중인 거래를 확인할게요.' : '지갑 정보를 정리하고 있어요. 잠시만 기다려 주세요.'}</p>
        </div> : editingWalletId ? <form className="kw-wallet-rename-form" onSubmit={(event) => { event.preventDefault(); void renameWallet(); }}>
          <label htmlFor="kw-wallet-rename-input">지갑 이름 바꾸기</label>
          <input id="kw-wallet-rename-input" autoFocus value={draftLabel} maxLength={30} disabled={loadingWalletId !== null} onChange={(event) => setDraftLabel(event.target.value)} />
          <div><button className="kw-button kw-button--secondary" type="button" disabled={loadingWalletId !== null} onClick={() => { setEditingWalletId(null); setError(null); }}>취소</button>
            <button className="kw-button" type="submit" disabled={loadingWalletId !== null || !draftLabel.trim()} aria-busy={loadingWalletId !== null}>{loadingWalletId ? <BusyButtonLabel>저장 중</BusyButtonLabel> : '저장'}</button></div>
        </form> : removalWalletId ? <div className="kw-wallet-remove-confirm">
          <strong>{wallets.find(({ walletId }) => walletId === removalWalletId)?.label}을 삭제할까요?</strong>
          <p>잔액이 있어도 지갑 목록과 이 기기의 보관 정보를 삭제할 수 있어요. 자산은 블록체인에 남지만 복구 구문이나 개인키를 따로 보관하지 않았다면 다시 접근할 수 없어요. 진행 중인 거래가 있으면 삭제할 수 없어요.</p>
          <div><button className="kw-button kw-button--secondary" type="button" disabled={loadingWalletId !== null} onClick={() => { setRemovalWalletId(null); setError(null); }}>취소</button>
            <button className="kw-button kw-wallet-remove-confirm__submit" type="button" disabled={loadingWalletId !== null} aria-busy={loadingWalletId !== null} onClick={() => void removeWallet()}>{loadingWalletId ? <BusyButtonLabel>삭제 중</BusyButtonLabel> : '인증하고 삭제'}</button></div>
        </div> : <div className="kw-sheet-options kw-wallet-selector-options">
          {wallets.map((wallet) => {
            const selected = wallet.walletId === selectedWalletId;
            return (
              <div className="kw-wallet-choice-row" key={wallet.walletId} data-actions-open={actionWalletId === wallet.walletId} data-selected={selected}>
              <button
                className="kw-choice kw-wallet-choice"
                type="button"
                aria-pressed={selected}
                disabled={loadingWalletId !== null || actionWalletId === wallet.walletId}
                aria-busy={loadingWalletId === wallet.walletId}
                onClick={() => void selectWallet(wallet.walletId)}
              >
                <span className="kw-wallet-choice__icon"><Wallet aria-hidden="true" /></span>
                <span className="kw-wallet-choice__copy">
                  <strong>{wallet.label}</strong>
                  <small>{adapterLabels[wallet.keyAdapter]} · {wallet.origin === 'imported' ? '가져온 지갑' : '새로 만든 지갑'}</small>
                </span>
                {selected ? <Check aria-label="현재 선택" /> : loadingWalletId === wallet.walletId ? <span className="kw-wallet-choice-loading"><span className="kw-button-spinner" aria-hidden="true" />조회 중</span> : null}
              </button>
              <button className="kw-wallet-choice-more" type="button" aria-label={`${wallet.label} 더보기`} aria-expanded={actionWalletId === wallet.walletId} aria-controls={`kw-wallet-actions-${wallet.walletId}`} disabled={loadingWalletId !== null || actionWalletId === wallet.walletId}
                ref={(element) => { if (element) moreButtonsRef.current.set(wallet.walletId, element); else moreButtonsRef.current.delete(wallet.walletId); }}
                onClick={() => { setActionWalletId(wallet.walletId); setStatusMessage(null); setError(null); }}><DotsThree size={25} weight="bold" aria-hidden="true" /></button>
              <div className="kw-wallet-choice-actions" id={`kw-wallet-actions-${wallet.walletId}`} aria-hidden={actionWalletId !== wallet.walletId}>
                <button className="kw-wallet-choice-action" type="button" aria-label={`${wallet.label} 이름 바꾸기`} disabled={actionWalletId !== wallet.walletId || loadingWalletId !== null} ref={actionWalletId === wallet.walletId ? firstActionRef : undefined}
                  onClick={() => { setEditingWalletId(wallet.walletId); setDraftLabel(wallet.label); setActionWalletId(null); setError(null); }}><PencilSimple size={19} aria-hidden="true" /><span>이름 변경</span></button>
                <button className="kw-wallet-choice-action kw-wallet-choice-action--danger" type="button" aria-label={`${wallet.label} 삭제`} disabled={actionWalletId !== wallet.walletId || loadingWalletId !== null}
                  onClick={() => { setRemovalWalletId(wallet.walletId); setActionWalletId(null); setError(null); }}><Trash size={19} aria-hidden="true" /><span>삭제</span></button>
                <button className="kw-wallet-choice-action kw-wallet-choice-action--close" type="button" aria-label="메뉴 닫기" disabled={actionWalletId !== wallet.walletId || loadingWalletId !== null} onClick={() => closeActions(wallet.walletId)}><CaretRight size={19} aria-hidden="true" /></button>
              </div>
              </div>
            );
          })}
        </div>}
        {error ? <p className="kw-error kw-mt-12" role="alert">{error}</p> : null}
        {statusMessage ? <p className="kw-wallet-selector-status" role="status">{statusMessage}</p> : null}
        {!removalWalletId && !editingWalletId ? <button className="kw-button kw-button--secondary kw-wallet-add-button kw-mt-16" type="button" onClick={onAdd}>
          <Plus aria-hidden="true" />지갑 추가하기
        </button> : null}
      </section>
    </div>
  );
}
