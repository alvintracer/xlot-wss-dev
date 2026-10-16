import { CheckCircle, Key, LockKey, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { HostAuthenticationPurpose, SecureTransactionSigningRequest, WalletImportMethod } from '@took-wss/contracts';
import { SarVaultPanel } from './SarVaultPanel';
import { SarEnrollmentPanel } from './SarEnrollmentPanel';
import { SarUnlockPanelV2 } from './SarUnlockPanelV2';
import type { SarVaultPair } from './sarVaultCryptoV2';

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
  | { id: string; type: 'sar-enrollment'; walletId: string; secureRef: string }
  | {
      id: string; type: 'recovery-reveal'; walletId: string;
      addressGroup: 'evm' | 'solana' | 'bitcoin' | 'tron' | 'xrp'; address: string;
      mode: 'unlock' | 'display'; secret?: { kind: 'mnemonic-entropy' | 'evm-private-key'; value: string };
      phoneMasked?: string; emailMasked?: string;
    }
  | {
      id: string; type: 'exchange-signing'; walletId: string; address: string;
      phoneMasked?: string; emailMasked?: string;
    }
  | {
      id: string;
      type: 'transaction-signing';
      request: SecureTransactionSigningRequest;
      requiresRecovery: boolean;
      acceptsPrivateKey: boolean;
      vaultMode: 'setup' | 'unlock' | 'local-unlock' | 'sar-v2-unlock' | 'ready';
      phoneMasked?: string;
      emailMasked?: string;
      remoteEnrolled?: boolean;
    }
  | {
      id: string;
      type: 'wallet-import';
      method: WalletImportMethod;
    };

interface HostSecurityOverlayProps {
  view: HostSecurityView;
  hasAppPin?: boolean;
  biometricEnabled?: boolean;
  onBiometricUnlock?: () => Promise<void>;
  institutionName: string;
  institutionLabel: string;
  customerName?: string | null;
  keypadLayout: 'four-column' | 'three-column';
  onCancel: () => void;
  onApproveAuthentication: () => Promise<void>;
  onConfirmSeedBackup: () => Promise<void>;
  onConfirmWalletImport: (method: WalletImportMethod, secret: string) => Promise<void>;
  onApproveTransaction: () => Promise<void>;
  onStartSarVaultSetup: (input: { secret?: string; password: string; phone: string; email: string }) => Promise<{
    challengeId: string; purpose: 'enroll' | 'unlock'; phoneMasked: string; emailMasked: string; expiresAt: string;
  }>;
  onStartSarVaultUnlock: () => Promise<{
    challengeId: string; purpose: 'enroll' | 'unlock'; phoneMasked: string; emailMasked: string; expiresAt: string;
  }>;
  onVerifySarVaultCode: (factor: 'phone' | 'email', code: string) => Promise<{
    phoneVerified: boolean; emailVerified: boolean;
  }>;
  onCompleteSarVault: (password?: string, pin?: string) => Promise<void>;
  onSaveLocalSarVault: (masterPassword: string, pin: string) => Promise<void>;
  onUnlockExistingLocalSarVault: (input: { pin: string } | { masterPassword: string }) => Promise<void>;
  onStartSarV2Enrollment: (phone: string, email: string) => Promise<{
    challengeId: string; phoneMasked: string; emailMasked: string; expiresAt: string;
  }>;
  onVerifySarV2Code: (factor: 'phone' | 'email', code: string) => Promise<{
    phoneVerified: boolean; emailVerified: boolean;
  }>;
  onCompleteSarV2Enrollment: () => Promise<void>;
  onLocalSarUnlock: (input: { pin: string } | { masterPassword: string }) => Promise<void>;
  onStartSarV2Unlock: (pair: SarVaultPair) => Promise<{
    challengeId: string; phoneMasked: string; emailMasked: string; expiresAt: string;
  }>;
  onVerifySarV2UnlockCode: (factor: 'phone' | 'email', code: string) => Promise<{
    phoneVerified: boolean; emailVerified: boolean;
  }>;
  onCompleteSarV2Unlock: (input: { password?: string; localPin?: string }) => Promise<void>;
}

const purposeCopy: Record<HostAuthenticationPurpose, string> = {
  'wallet-provisioning': '새 지갑 등록',
  'transfer-approval': '디지털자산 보내기',
  'exchange-approval': '디지털자산 환전',
  'wallet-recovery': '지갑 복구',
  'wallet-removal': '지갑 삭제',
};

function HostBusyLabel({ children }: { children: string }) {
  return <span className="host-security-busy"><span className="host-security-spinner" aria-hidden="true" />{children}</span>;
}

export function HostSecurityOverlay({
  view,
  hasAppPin,
  biometricEnabled,
  onBiometricUnlock,
  institutionName,
  institutionLabel,
  customerName,
  keypadLayout,
  onCancel,
  onApproveAuthentication,
  onConfirmSeedBackup,
  onConfirmWalletImport,
  onApproveTransaction,
  onStartSarVaultSetup,
  onStartSarVaultUnlock,
  onVerifySarVaultCode,
  onCompleteSarVault,
  onSaveLocalSarVault,
  onUnlockExistingLocalSarVault,
  onStartSarV2Enrollment,
  onVerifySarV2Code,
  onCompleteSarV2Enrollment,
  onLocalSarUnlock,
  onStartSarV2Unlock,
  onVerifySarV2UnlockCode,
  onCompleteSarV2Unlock,
}: HostSecurityOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const secureInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [seedStep, setSeedStep] = useState<'reveal' | 'confirm'>('reveal');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretReady, setSecretReady] = useState(false);
  const autoApprovedId = useRef<string | null>(null);
  const signingMode = view.type === 'transaction-signing' ? view.vaultMode : undefined;
  const confirmationIndexes = view.type === 'sar-backup' ? view.confirmationIndexes : [];
  const allAnswersPresent = confirmationIndexes.every((index) => answers[index]?.trim());

  useEffect(() => {
    dialogRef.current?.focus();
  }, [view.id, signingMode, Boolean(error)]);

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
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : '';
      setError(reason === 'vault_locked'
        ? '보관한 지갑을 다시 열어 주세요.'
        : `${view.type === 'transaction-signing' && view.request.operation === 'exchange' ? '환전' : '보내기'} 서명을 완료하지 못했어요. 다시 시도해 주세요.`);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (view.type !== 'transaction-signing' || view.vaultMode !== 'ready'
      || view.request.operation === 'exchange' || view.request.operation === 'refund') {
      autoApprovedId.current = null;
      return;
    }
    if (autoApprovedId.current === view.id) return;
    autoApprovedId.current = view.id;
    void approveTransaction();
  }, [view, onApproveTransaction]);

  const confirmWalletImport = async () => {
    if (view.type !== 'wallet-import') return;
    const input = secureInputRef.current;
    const secret = input?.value ?? '';
    if (!secret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirmWalletImport(view.method, secret);
      if (input) input.value = '';
      setSecretReady(false);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : '';
      setError(reason === 'invalid_mnemonic'
        ? '영문 복구 단어 12·15·18·21·24개의 철자와 순서를 확인해 주세요.'
        : reason === 'invalid_private_key'
          ? '개인키 형식을 확인해 주세요. 64자리 16진수 키를 입력할 수 있어요.'
          : '지갑 정보를 확인하지 못했어요. 다시 입력해 주세요.');
      setBusy(false);
    }
  };

  // The wallet sheet already shows transfer progress. Keep signing active here
  // without mounting a second processing dialog over the same transaction.
  if (view.type === 'transaction-signing' && view.vaultMode === 'ready'
    && view.request.operation !== 'exchange' && view.request.operation !== 'refund' && !error) return null;

  return (
    <section ref={dialogRef} className="host-security-layer" role="dialog" aria-modal="true" aria-labelledby="host-security-title" tabIndex={-1}>
      <header className="host-security-header">
        <span>{institutionLabel} 보안 확인</span>
        <button type="button" aria-label="보안 확인 취소" disabled={busy} onClick={onCancel}><X size={22} /></button>
      </header>

      {view.type === 'sar-enrollment' ? (
        <SarEnrollmentPanel
          customerName={customerName}
          hasAppPin={hasAppPin}
          keypadLayout={keypadLayout}
          resumeLocal={!view.secureRef}
          onCancel={onCancel}
          onUnlockExisting={onUnlockExistingLocalSarVault}
          onSaveLocal={onSaveLocalSarVault}
          onStart={onStartSarV2Enrollment}
          onVerify={onVerifySarV2Code}
          onComplete={onCompleteSarV2Enrollment}
        />
      ) : view.type === 'exchange-signing' || view.type === 'recovery-reveal' && view.mode === 'unlock' ? (
        <SarUnlockPanelV2
          hasLocalVault={false}
          hasAppPin={hasAppPin}
          remoteAvailable
          keypadLayout={keypadLayout}
          phoneMasked={view.phoneMasked}
          emailMasked={view.emailMasked}
          onCancel={onCancel}
          onLocalUnlock={onLocalSarUnlock}
          onStartRemote={onStartSarV2Unlock}
          onVerifyRemote={onVerifySarV2UnlockCode}
          onCompleteRemote={onCompleteSarV2Unlock}
        />
      ) : view.type === 'recovery-reveal' ? (
        <>
          <div className="host-security-content host-vault-panel">
            <p className="host-security-kicker">자가복구 지갑</p>
            <h2 id="host-security-title">{view.secret?.kind === 'evm-private-key' ? '개인키를 확인해 주세요' : '복구 구문을 확인해 주세요'}</h2>
            <p>다른 사람에게 보이면 지갑의 자산에 접근할 수 있어요. 안전한 곳에 직접 기록해 주세요.</p>
            <textarea className="host-recovery-secret" readOnly aria-label={view.secret?.kind === 'evm-private-key' ? '개인키' : '복구 구문'} value={view.secret?.value ?? ''} />
          </div>
          <footer className="host-security-footer"><button className="host-security-primary" type="button" onClick={onCancel}>확인했어요</button></footer>
        </>
      ) : view.type === 'authentication' ? (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><ShieldCheck size={34} weight="regular" /></div>
            <p className="host-security-kicker">REFERENCE HOST · DEVELOPMENT</p>
            <h2 id="host-security-title">{purposeCopy[view.purpose]} 전에 고객 확인이 필요해요</h2>
            <p>이 화면은 WSS WebView가 아닌 금융사 호스트 영역입니다. 실제 연동에서는 {institutionName}의 PIN·생체 인증 SDK가 이 단계를 처리합니다.</p>
            <div className="host-security-notice">
              <LockKey size={19} aria-hidden="true" />
              <span>확인 후 발급되는 증빙은 현재 세션과 지갑 등록 용도에만 묶이며 한 번만 사용할 수 있어요.</span>
            </div>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer">
            <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy} autoFocus onClick={() => void approveAuthentication()}>
              {busy ? <HostBusyLabel>고객 확인 중이에요</HostBusyLabel> : '기기 인증으로 확인'}
            </button>
          </footer>
        </>
      ) : view.type === 'transaction-signing' && (view.vaultMode === 'local-unlock' || view.vaultMode === 'sar-v2-unlock') ? (
        <SarUnlockPanelV2
          hasLocalVault={view.vaultMode === 'local-unlock'}
          hasAppPin={hasAppPin}
          biometricEnabled={biometricEnabled}
          onBiometricUnlock={onBiometricUnlock}
          remoteAvailable={view.remoteEnrolled === true}
          keypadLayout={keypadLayout}
          phoneMasked={view.phoneMasked}
          emailMasked={view.emailMasked}
          onCancel={onCancel}
          onLocalUnlock={onLocalSarUnlock}
          onStartRemote={onStartSarV2Unlock}
          onVerifyRemote={onVerifySarV2UnlockCode}
          onCompleteRemote={onCompleteSarV2Unlock}
        />
      ) : view.type === 'transaction-signing' && view.vaultMode !== 'ready' ? (
        <SarVaultPanel
          mode={view.vaultMode === 'setup' ? 'setup' : 'unlock'}
          requiresRecovery={view.requiresRecovery}
          acceptsPrivateKey={view.acceptsPrivateKey}
          phoneMasked={view.phoneMasked}
          emailMasked={view.emailMasked}
          request={view.request}
          keypadLayout={keypadLayout}
          onCancel={onCancel}
          onStartSetup={onStartSarVaultSetup}
          onStartUnlock={onStartSarVaultUnlock}
          onVerifyCode={onVerifySarVaultCode}
          onComplete={onCompleteSarVault}
        />
      ) : view.type === 'transaction-signing' && (view.request.operation === 'exchange' || view.request.operation === 'refund') ? (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><ShieldCheck size={34} weight="regular" /></div>
            <p className="host-security-kicker">{view.request.operation === 'exchange' ? '환전 최종 확인' : '환불 최종 확인'}</p>
            <h2 id="host-security-title">{view.request.operation === 'exchange' ? '환전할 자산과 금액을 한 번 더 확인해 주세요' : '만료된 자산을 돌려받을까요?'}</h2>
            <dl className="host-transfer-summary">
              <div><dt>{view.request.operation === 'exchange' ? '보낼 자산' : '돌려받을 자산'}</dt><dd>{view.request.amountDisplay} {view.request.assetSymbol}</dd></div>
              {view.request.operation === 'exchange' ? <div><dt>받을 자산</dt><dd>{view.request.receiveAmountDisplay} {view.request.receiveAssetSymbol}</dd></div> : null}
              <div><dt>네트워크</dt><dd>{view.request.network}</dd></div>
              {view.request.operation === 'refund' ? <div><dt>돌아올 지갑</dt><dd>{view.request.recipient}</dd></div> : null}
            </dl>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer host-security-footer--split">
            <button className="host-security-secondary" type="button" disabled={busy} onClick={onCancel}>취소</button>
            <button className="host-security-primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void approveTransaction()}>
              {busy ? <HostBusyLabel>확인하고 있어요</HostBusyLabel> : view.request.operation === 'exchange' ? '인증하고 환전하기' : '인증하고 환불받기'}
            </button>
          </footer>
        </>
      ) : view.type === 'transaction-signing' ? (
        <>
          <div className="host-security-content" role="status">
            <div className="host-security-symbol" aria-hidden="true">{error ? <WarningCircle size={34} /> : <span className="host-security-spinner" />}</div>
            <p className="host-security-kicker">{view.request.operation === 'exchange' ? '환전 처리' : '보내기 처리'}</p>
            <h2 id="host-security-title">{error ? '거래를 완료하지 못했어요' : '거래를 처리하고 있어요'}</h2>
            <p>{error ? '보내기 화면에서 다시 시도해 주세요.' : '이번 거래의 서명을 확인하고 있어요. 잠시만 기다려 주세요.'}</p>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          {error ? <footer className="host-security-footer"><button className="host-security-primary" type="button" onClick={onCancel}>보내기로 돌아가기</button></footer> : null}
        </>
      ) : view.type === 'wallet-import' ? (
        <>
          <div className="host-security-content">
            <div className="host-security-symbol" aria-hidden="true"><LockKey size={32} weight="regular" /></div>
            <p className="host-security-kicker">기존 지갑 가져오기</p>
            <h2 id="host-security-title">{view.method === 'mnemonic' ? '복구 구문을' : 'EVM 개인키를'} 직접 입력해 주세요</h2>
            <p>{view.method === 'mnemonic'
              ? '기존 지갑에서 확인한 영문 복구 단어를 순서대로 입력해 주세요. 번호가 붙은 목록도 붙여넣을 수 있어요.'
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
              <span>입력한 정보는 이 기기 내부에서만 처리되며 외부로 전달되지 않습니다.</span>
            </div>
            {view.method === 'private-key' ? <p className="host-security-scope">개인키 지갑에는 EVM 계열 네트워크만 연결됩니다. 여러 체인을 함께 사용하려면 복구 구문으로 가져와 주세요.</p> : null}
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer host-security-footer--split">
            <button className="host-security-secondary" type="button" disabled={busy} onClick={onCancel}>취소</button>
            <button className="host-security-primary" type="button" disabled={!secretReady || busy} aria-busy={busy} onClick={() => void confirmWalletImport()}>
              {busy ? <HostBusyLabel>지갑을 확인하고 있어요</HostBusyLabel> : '안전하게 가져오기'}
            </button>
          </footer>
        </>
      ) : seedStep === 'reveal' ? (
        <>
          <div className="host-security-content host-security-content--seed">
            <div className="host-security-symbol" aria-hidden="true"><Key size={32} weight="regular" /></div>
            <p className="host-security-kicker">복구 구문 보관</p>
            <h2 id="host-security-title">복구 구문을 안전한 곳에 순서대로 기록해 주세요</h2>
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
            <h2 id="host-security-title">기록한 복구 단어를 다시 입력해 주세요</h2>
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
            <div className="host-security-warning"><WarningCircle size={18} aria-hidden="true" /><span>{institutionName}은 복구 구문 원문을 서버로 전송하거나 저장하지 않습니다.</span></div>
            {error ? <p className="host-security-error" role="alert">{error}</p> : null}
          </div>
          <footer className="host-security-footer host-security-footer--split">
            <button className="host-security-secondary" type="button" disabled={busy} onClick={() => { setError(null); setSeedStep('reveal'); }}>다시 보기</button>
            <button className="host-security-primary" type="button" disabled={!allAnswersPresent || busy} aria-busy={busy} onClick={() => void confirmSeed()}>
              {busy ? <HostBusyLabel>확인하고 있어요</HostBusyLabel> : '복구 구문 확인'}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
