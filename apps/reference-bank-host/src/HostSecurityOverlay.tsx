import { CheckCircle, Key, LockKey, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { HostAuthenticationPurpose } from '@took-wss/contracts';

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
    };

interface HostSecurityOverlayProps {
  view: HostSecurityView;
  onCancel: () => void;
  onApproveAuthentication: () => Promise<void>;
  onConfirmSeedBackup: () => Promise<void>;
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
}: HostSecurityOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [seedStep, setSeedStep] = useState<'reveal' | 'confirm'>('reveal');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError('키 코어 확인 증빙을 만들지 못했어요. 다시 시도해 주세요.');
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
      ) : seedStep === 'reveal' ? (
        <>
          <div className="host-security-content host-security-content--seed">
            <div className="host-security-symbol" aria-hidden="true"><Key size={32} weight="regular" /></div>
            <p className="host-security-kicker">HOST-OWNED SECURE VIEW</p>
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
            <p className="host-security-kicker">BACKUP CONFIRMATION</p>
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
            <div className="host-security-warning"><WarningCircle size={18} aria-hidden="true" /><span>키움과 took은 복구 구문 원문을 서버로 전송하거나 저장하지 않습니다.</span></div>
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
