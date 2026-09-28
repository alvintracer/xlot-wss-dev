import { CheckCircle, Key, LockKey, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { HostAuthenticationPurpose, SecureTransactionSigningRequest, WalletImportMethod } from '@took-wss/contracts';

export type HostSecurityView =
  | {
      id: string;
      type: 'authentication';
      purpose: HostAuthenticationPurpose;
    }
  | {
      id: string;
      type: 'sar-backup';
      mnemonicWords: readonly string[];
      confirmationIndexes: readonly number[];
    }
  | {
      id: string;
      type: 'transaction-signing';
      request: SecureTransactionSigningRequest;
    }
  | {
      id: string;
      type: 'wallet-import';
      method: WalletImportMethod;
    };

interface HostSecurityOverlayProps {
  view: HostSecurityView;
  onCancel: () => void;
  onApproveAuthentication: () => Promise<void>;
  onConfirmSeedBackup: () => Promise<void>;
  onConfirmWalletImport: (method: WalletImportMethod, secret: string) => Promise<void>;
  onApproveTransaction: () => Promise<void>;
}

const purposeCopy: Record<HostAuthenticationPurpose, string> = {
  'wallet-provisioning': '새 지갑 등록',
  'transfer-approval': '디지털자산 보내기',
  'wallet-recovery': '지갑 복구',
};

export function HostSecurityOverlay({
  view,
  onCancel,
  onApproveAuthentication,
  onConfirmSeedBackup,
  onConfirmWalletImport,
  onApproveTransaction,
}: HostSecurityOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const secureInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [seedStep, setSeedStep] = useState<'reveal' | 'confirm'>('reveal');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretReady, setSecretReady] = useState(false);
  const confirmationIndexes = view.type === 'sar-backup' ? view.confirmationIndexes : [];
  const allAnswersPresent = confirmationIndexes.every((index) => answers[index]?.trim());

  useEffect(() => {
    dialogRef.current?.focus();
  }, [view.id]);

  const approveAuthentication = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApproveAuthentication();
    } catch {
      setError('고객 인증 증빙을 만들지 못했어요. 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  const confirmSeed = async () => {
    if (view.type !== 'sar-backup') return;
    const matches = view.confirmationIndexes.every((index) => (
      answers[index]?.trim().toLocaleLowerCase('en-US') === view.mnemonicWords[index]?.toLocaleLowerCase('en-US')
    ));
    if (!matches) {
      setError('복구 단어가 일치하지 않아요. 기록한 내용을 다시 확인해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirmSeedBackup();
    } catch {
      setError('복구 구문 확인을 완료하지 못했어요. 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  const approveTransaction = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApproveTransaction();
    } catch {
      setError('보내기 서명을 완료하지 못했어요. 네트워크와 지갑 상태를 확인해 주세요.');
      setBusy(false);
    }
  };

  const confirmWalletImport = async () => {
    if (view.type !== 'wallet-import') return;
    const input = secureInputRef.current;
    const secret = input?.value ?? '';
    if (!secret.trim()) return;
    if (input) input.value = '';
    setSecretReady(false);
    setBusy(true);
    setError(null);
    try {
      await onConfirmWalletImport(view.method, secret);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : '';
      setError(reason === 'invalid_mnemonic'
        ? '복구 구문의 단어와 순서를 확인해 주세요.'
        : reason === 'invalid_private_key'
          ? '개인키 형식을 확인해 주세요. 64자리 16진수 키를 입력할 수 있어요.'
          : '지갑 정보를 확인하지 못했어요. 다시 입력해 주세요.');
      setBusy(false);
    }
  };

  return (
    <section ref={dialogRef} className="host-security-layer" role="dialog" aria-modal="true" aria-labelledby="host-security-title" tabIndex={-1}>
      <header className="host-security-header">
        <span>키움 보안 확인</span>
        <button type="button" aria-label="보안 확인 취소" disabled={busy} onClick={onCancel}><X size={22} /></button>
      </header>

      {view.type === 'authentication' ? (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><ShieldCheck size={34} weight="regular" /></div>
            <p className="host-security-kicker">REFERENCE HOST · DEVELOPMENT</p>
            <h2 id="host-security-title">{purposeCopy[view.purpose]} 전에<br />고객 확인이 필요해요</h2>
            <p>이 화면은 WSS WebView가 아닌 금융사 호스트 영역입니다. 실제 연동에서는 키움의 PIN·생체 인증 SDK가 이 단계를 처리합니다.</p>
            <div className="host-security-notice">
              <LockKey size={19} aria-hidden="true" />
              <span>확인 후 발급되는 증빙은 현재 세션과 지갑 등록 용도에만 묶이며 한 번만 사용할 수 있어요.</span>
            </div>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer">
            <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy} autoFocus onClick={() => void approveAuthentication()}>
              {busy ? '고객 확인 중이에요' : '기기 인증으로 확인'}
            </button>
          </footer>
        </>
      ) : view.type === 'transaction-signing' ? (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><ShieldCheck size={34} weight="regular" /></div>
            <p className="host-security-kicker">보내기 최종 확인</p>
            <h2 id="host-security-title">{view.request.channel === 'phone' ? '받는 분과 금액을' : '받는 주소와 금액을'}<br />한 번 더 확인해 주세요</h2>
            <dl className="host-transfer-summary">
              <div><dt>보낼 자산</dt><dd>{view.request.amountDisplay} {view.request.assetSymbol}</dd></div>
              <div><dt>네트워크</dt><dd>{view.request.network}</dd></div>
              <div><dt>{view.request.channel === 'phone' ? '받는 분' : '받는 주소'}</dt><dd>{view.request.recipient}</dd></div>
            </dl>
            <div className="host-security-notice">
              <LockKey size={19} aria-hidden="true" />
              <span>기기 인증이 끝나면 {view.request.transaction.type === 'evm-batch' ? '토큰 승인과 에스크로 예치에만 사용할 수 있는 서명을 만들어요.' : '이 거래 한 건에만 사용할 수 있는 서명을 만들어요.'}</span>
            </div>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer host-security-footer--split">
            <button className="host-security-secondary" type="button" disabled={busy} onClick={onCancel}>취소</button>
            <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy} autoFocus onClick={() => void approveTransaction()}>
              {busy ? '확인하고 있어요' : '인증하고 보내기'}
            </button>
          </footer>
        </>
      ) : view.type === 'wallet-import' ? (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><LockKey size={32} weight="regular" /></div>
            <p className="host-security-kicker">기존 지갑 가져오기</p>
            <h2 id="host-security-title">{view.method === 'mnemonic' ? '복구 구문을' : 'EVM 개인키를'}<br />직접 입력해 주세요</h2>
            <p>{view.method === 'mnemonic'
              ? '기존 지갑에서 확인한 12~24개 영문 단어를 순서대로 입력해 주세요.'
              : '이더리움과 EVM 호환 네트워크에서 사용하는 64자리 16진수 개인키를 입력해 주세요.'}</p>
            <label className="host-secure-import-field">
              <span>{view.method === 'mnemonic' ? '복구 구문' : '개인키'}</span>
              {view.method === 'mnemonic' ? (
                <textarea
                  ref={(node) => { secureInputRef.current = node; }}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  rows={4}
                  placeholder="영문 단어를 띄어쓰기로 구분해 입력"
                  onInput={(event) => setSecretReady(event.currentTarget.value.trim().length > 0)}
                />
              ) : (
                <input
                  ref={(node) => { secureInputRef.current = node; }}
                  autoFocus
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="0x로 시작하거나 64자리인 개인키"
                  onInput={(event) => setSecretReady(event.currentTarget.value.trim().length > 0)}
                />
              )}
            </label>
            <div className="host-security-warning">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>입력한 정보는 이 기기의 키 코어 안에서만 처리되며 WSS WebView나 키움 서버로 전달되지 않습니다.</span>
            </div>
            {view.method === 'private-key' ? <p className="host-security-scope">개인키 지갑에는 EVM 계열 네트워크만 연결됩니다. 여러 체인을 함께 사용하려면 복구 구문으로 가져와 주세요.</p> : null}
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer host-security-footer--split">
            <button className="host-security-secondary" type="button" disabled={busy} onClick={onCancel}>취소</button>
            <button className="host-security-primary" type="button" disabled={!secretReady || busy} aria-busy={busy} onClick={() => void confirmWalletImport()}>
              {busy ? '지갑을 확인하고 있어요' : '안전하게 가져오기'}
            </button>
          </footer>
        </>
      ) : seedStep === 'reveal' ? (
        <>
          <div className="host-security-content host-security-content--seed">
            <div className="host-security-symbol" aria-hidden="true"><Key size={32} weight="regular" /></div>
            <p className="host-security-kicker">복구 구문 보관</p>
            <h2 id="host-security-title">복구 구문을 안전한 곳에<br />순서대로 기록해 주세요</h2>
            <p>이 12개 단어는 지금 한 번만 보여드려요. 화면 캡처나 클라우드 메모 대신 오프라인 공간에 기록해 주세요.</p>
            <ol className="host-seed-grid" aria-label="실제 지갑 복구 구문">
              {view.mnemonicWords.map((word, index) => (
                <li className="host-seed-word" key={`${index + 1}-${word}`}><span>{index + 1}</span><strong>{word}</strong></li>
              ))}
            </ol>
            <label className="host-security-check">
              <input type="checkbox" checked={backupAcknowledged} onChange={(event) => setBackupAcknowledged(event.target.checked)} />
              <span>복구 구문을 순서대로 기록했고 누구에게도 공유하지 않겠습니다.</span>
            </label>
          </div>
          <footer className="host-security-footer">
            <button className="host-security-primary" type="button" disabled={!backupAcknowledged} onClick={() => { setError(null); setSeedStep('confirm'); }}>
              기록한 단어 확인하기
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><CheckCircle size={34} weight="regular" /></div>
            <p className="host-security-kicker">복구 구문 확인</p>
            <h2 id="host-security-title">기록한 복구 단어를<br />다시 입력해 주세요</h2>
            <p>단어 순서까지 맞아야 지갑 생성과 자가복구 설정을 계속할 수 있어요.</p>
            <div className="host-seed-confirmation">
              {view.confirmationIndexes.map((index) => (
                <label key={index}>
                  <span>{index + 1}번째 단어</span>
                  <input
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={answers[index] ?? ''}
                    onChange={(event) => setAnswers((current) => ({ ...current, [index]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="host-security-warning"><WarningCircle size={18} aria-hidden="true" /><span>키움은 복구 구문 원문을 서버로 전송하거나 저장하지 않습니다.</span></div>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer host-security-footer--split">
            <button className="host-security-secondary" type="button" disabled={busy} onClick={() => { setError(null); setSeedStep('reveal'); }}>다시 보기</button>
            <button className="host-security-primary" type="button" disabled={!allAnswersPresent || busy} aria-busy={busy} onClick={() => void confirmSeed()}>
              {busy ? '확인하고 있어요' : '복구 구문 확인'}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
