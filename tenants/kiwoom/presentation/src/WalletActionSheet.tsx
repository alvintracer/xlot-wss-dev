import {
  ArrowLeft,
  CaretRight,
  CheckCircle,
  Copy,
  GasPump,
  ShareNetwork,
  ShieldCheck,
  Wallet,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  HostCapabilities,
  PrepareTransferRequest,
  PreparedTransfer,
  SecureTransactionSigningRequest,
  SecureTransactionSigningResult,
  SubmitTransferRequest,
  TransferExecutionResult,
  WalletAssetView,
  WalletNetworkView,
  WalletProfileSummary,
} from '@took-wss/contracts';

export type WalletActionMode = 'receive' | 'send' | 'exchange';
type SendStep = 'asset' | 'recipient' | 'amount' | 'review' | 'success';

interface WalletActionSheetProps {
  mode: WalletActionMode;
  wallet: WalletProfileSummary;
  assets: WalletAssetView[];
  networks: WalletNetworkView[];
  hostCapabilities: HostCapabilities;
  initialChainId?: string;
  onPrepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onClose: () => void;
}

const numberFormatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

function parseDisplayNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAmountToAtomic(value: string, decimals: number): string | null {
  const normalized = value.replaceAll(',', '').trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) return null;
  const atomic = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  try {
    const result = BigInt(atomic || '0');
    return result > 0n ? result.toString() : null;
  } catch {
    return null;
  }
}

function estimatedKrw(asset: WalletAssetView | undefined, amount: string): string | null {
  const assetKrw = parseDisplayNumber(asset?.fiat?.display);
  const balance = parseDisplayNumber(asset?.balanceDisplay);
  const requested = Number(amount.replaceAll(',', ''));
  if (assetKrw === null || balance === null || balance <= 0 || !Number.isFinite(requested)) return null;
  return `약 ${numberFormatter.format(assetKrw / balance * requested)}원`;
}

function abbreviatedAddress(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function safeBigInt(value: string | undefined): bigint {
  try {
    return /^\d+$/.test(value ?? '') ? BigInt(value!) : 0n;
  } catch {
    return 0n;
  }
}

function nativeName(network: WalletNetworkView): string {
  const labels: Record<string, string> = {
    ETH: '이더리움', POL: '폴리곤', BNB: '비앤비', SOL: '솔라나', BTC: '비트코인', TRX: '트론', XRP: '엑스알피',
  };
  return labels[network.nativeSymbol] ?? network.nativeSymbol;
}

function FlowHeader({ title, canGoBack, onBack, onClose }: { title: string; canGoBack: boolean; onBack: () => void; onClose: () => void }) {
  return (
    <header className="kw-transfer-header">
      {canGoBack ? (
        <button type="button" aria-label="이전 화면" onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
      ) : <span aria-hidden="true" />}
      <strong>{title}</strong>
      <button type="button" aria-label="닫기" onClick={onClose}><X aria-hidden="true" /></button>
    </header>
  );
}

function NetworkPicker({ networks, onSelect }: { networks: WalletNetworkView[]; onSelect: (network: WalletNetworkView) => void }) {
  return (
    <div className="kw-transfer-choice-list">
      {networks.map((network) => (
        <button
          className="kw-transfer-choice"
          type="button"
          key={network.chainId}
          disabled={network.addressStatus !== 'ready'}
          onClick={() => onSelect(network)}
        >
          <span className="kw-transfer-asset-mark" aria-hidden="true">{network.nativeSymbol.slice(0, 1)}</span>
          <span>
            <strong>{nativeName(network)}</strong>
            <small>{network.network}{network.addressStatus !== 'ready' ? ' · 주소 준비 중' : ''}</small>
          </span>
          <CaretRight aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function AssetPicker({ assets, onSelect }: { assets: WalletAssetView[]; onSelect: (asset: WalletAssetView) => void }) {
  if (assets.length === 0) {
    return (
      <div className="kw-transfer-empty">
        <Wallet aria-hidden="true" />
        <strong>보낼 수 있는 자산이 없어요</strong>
        <p>먼저 채우기에서 이 지갑의 주소를 확인하고 자산을 받아보세요.</p>
      </div>
    );
  }
  return (
    <div className="kw-transfer-choice-list">
      {assets.map((asset) => {
        const supported = Boolean(asset.chainId && asset.decimals !== undefined && asset.availableAtomic && asset.transferStatus === 'enabled');
        return (
          <button className="kw-transfer-choice" type="button" key={asset.assetId} disabled={!supported} onClick={() => onSelect(asset)}>
            <span className="kw-transfer-asset-mark" aria-hidden="true">{asset.symbol.slice(0, 1)}</span>
            <span>
              <strong>{asset.name}</strong>
              <small>{asset.network}{supported ? '' : ` · ${asset.transferUnavailableReason ?? '보내기 연동 준비 중'}`}</small>
            </span>
            <span className="kw-transfer-choice__balance">
              <strong>{asset.fiat?.display ?? '-'}</strong>
              <small>{asset.balanceDisplay} {asset.symbol}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ReceiveFlow({
  wallet,
  networks,
  initialChainId,
  onClose,
}: Pick<WalletActionSheetProps, 'wallet' | 'networks' | 'initialChainId' | 'onClose'>) {
  const [selectedNetwork, setSelectedNetwork] = useState<WalletNetworkView | undefined>(() => (
    networks.find((network) => network.chainId === initialChainId && network.addressStatus === 'ready')
  ));
  const [copied, setCopied] = useState(false);
  const address = selectedNetwork?.address;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  };

  const shareAddress = async () => {
    if (!address || !selectedNetwork) return;
    const shareData = {
      title: `${selectedNetwork.network} 받기 주소`,
      text: `${selectedNetwork.network} ${selectedNetwork.nativeSymbol} 받기 주소\n${address}`,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => undefined);
      return;
    }
    await copyAddress();
  };

  return (
    <>
      <FlowHeader title="채우기" canGoBack={Boolean(selectedNetwork)} onBack={() => setSelectedNetwork(undefined)} onClose={onClose} />
      <div className="kw-transfer-scroll">
        {!selectedNetwork ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{wallet.label}</p>
            <h2 id="kw-wallet-action-title">어떤 자산을<br />채울까요?</h2>
            <p className="kw-transfer-lead">받을 네트워크를 선택해 주세요.</p>
            <NetworkPicker networks={networks} onSelect={setSelectedNetwork} />
          </div>
        ) : address ? (
          <div className="kw-transfer-page kw-receive-page">
            <p className="kw-transfer-kicker">{selectedNetwork.network}</p>
            <h2 id="kw-wallet-action-title">이 주소로<br />자산을 보내주세요</h2>
            <p className="kw-transfer-lead">반드시 {selectedNetwork.network} 네트워크로 보내야 해요.</p>
            <div className="kw-qr-card">
              <QRCodeSVG value={address} size={176} level="M" marginSize={2} title={`${selectedNetwork.network} 받기 주소 QR`} />
              <strong>{selectedNetwork.nativeSymbol} 받기 주소</strong>
              <button type="button" onClick={() => void copyAddress()}>{abbreviatedAddress(address)}<Copy aria-hidden="true" /></button>
            </div>
            {selectedNetwork.chainId === 'xrp' ? (
              <div className="kw-transfer-warning"><WarningCircle aria-hidden="true" /><span>거래소에서 보낼 때는 목적지 태그 입력 여부를 반드시 확인해 주세요.</span></div>
            ) : null}
            <div className="kw-receive-actions">
              <button type="button" onClick={() => void copyAddress()}><Copy aria-hidden="true" />{copied ? '복사했어요' : '주소 복사'}</button>
              <button type="button" onClick={() => void shareAddress()}><ShareNetwork aria-hidden="true" />공유하기</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function GasSupportDialog({ quote, onClose }: { quote: PreparedTransfer['gasSponsorship']; onClose: () => void }) {
  return (
    <div className="kw-gas-dialog-layer">
      <button type="button" className="kw-gas-dialog-scrim" aria-label="가스비 안내 닫기" onClick={onClose} />
      <section className="kw-gas-dialog" role="dialog" aria-modal="true" aria-labelledby="kw-gas-dialog-title">
        <button type="button" className="kw-gas-dialog-close" aria-label="닫기" onClick={onClose}><X aria-hidden="true" /></button>
        <div className="kw-gas-dialog-icon"><GasPump aria-hidden="true" /></div>
        <h3 id="kw-gas-dialog-title">가스비 지원</h3>
        <p>{quote.message}</p>
        <div className="kw-gas-support-grid">
          <span>이번 보내기</span>
          <strong>{quote.status === 'sponsored' ? '가스비 지원 적용' : quote.status === 'eligible' ? '지원 가능' : '네트워크 수수료 직접 결제'}</strong>
        </div>
        <button className="kw-button" type="button" autoFocus onClick={onClose}>확인</button>
      </section>
    </div>
  );
}

function SendFlow({
  wallet,
  assets,
  networks,
  initialChainId,
  onPrepareTransfer,
  onRequestSecureTransactionSignature,
  onSubmitTransfer,
  onClose,
}: WalletActionSheetProps) {
  const initialAsset = assets.find((item) => item.chainId === initialChainId);
  const [step, setStep] = useState<SendStep>(initialAsset ? 'recipient' : 'asset');
  const [asset, setAsset] = useState<WalletAssetView | undefined>(initialAsset);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [complianceReason, setComplianceReason] = useState('');
  const [result, setResult] = useState<TransferExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gasDialogOpen, setGasDialogOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const network = networks.find((candidate) => candidate.chainId === asset?.chainId);
  const decimals = asset?.decimals;
  const amountAtomic = decimals === undefined ? null : parseAmountToAtomic(amount, decimals);
  const available = safeBigInt(asset?.availableAtomic);
  const validAmount = amountAtomic !== null && BigInt(amountAtomic) <= available;
  const krw = useMemo(() => estimatedKrw(asset, amount), [asset, amount]);
  const quoteExpired = prepared ? clock >= Date.parse(prepared.expiresAt) : false;

  useEffect(() => {
    if (step !== 'review' || !prepared) return undefined;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [prepared, step]);

  const back = () => {
    setError(null);
    if (step === 'recipient') setStep('asset');
    else if (step === 'amount') setStep('recipient');
    else if (step === 'review') {
      setPrepared(null);
      setStep('amount');
    } else onClose();
  };

  const selectAsset = (selected: WalletAssetView) => {
    setAsset(selected);
    setRecipient('');
    setAmount('');
    setPrepared(null);
    setStep('recipient');
  };

  const prepare = async () => {
    if (!asset?.chainId || !amountAtomic || !recipient.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const quote = await onPrepareTransfer({
        walletId: wallet.walletId,
        assetId: asset.assetId,
        chainId: asset.chainId,
        recipient: recipient.trim(),
        amountAtomic,
        channel: 'address',
        ...(complianceReason.trim() ? { complianceReason: complianceReason.trim() } : {}),
      });
      setPrepared(quote);
      setStep('review');
    } catch {
      setError('보내기 조건을 확인하지 못했어요. 주소, 잔액과 네트워크 수수료를 다시 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!prepared?.signingRequest || quoteExpired) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await onRequestSecureTransactionSignature(prepared.signingRequest);
      if (signature.status === 'cancelled') {
        setError('보내기가 취소됐어요.');
        return;
      }
      if (signature.intentId !== prepared.intentId) throw new Error('Transfer intent mismatch.');
      const execution = await onSubmitTransfer({
        intentId: prepared.intentId,
        signedTransaction: signature.signedTransaction,
        hostAuthorizationProof: signature.hostAuthorizationProof,
        idempotencyKey: crypto.randomUUID(),
      });
      setResult(execution);
      setStep('success');
    } catch {
      setError('거래를 전송하지 못했어요. 잔액과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const reviewBlocked = prepared?.compliance.status === 'block' || prepared?.compliance.status === 'unavailable';
  const needsReason = prepared?.compliance.status === 'review' && prepared.compliance.reasonRequired && !prepared.signingRequest;
  const title = step === 'success' ? '보내기 완료' : '보내기';

  return (
    <>
      <FlowHeader title={title} canGoBack={step !== 'asset' && step !== 'success'} onBack={back} onClose={onClose} />
      <div className="kw-transfer-scroll">
        {step === 'asset' ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{wallet.label}</p>
            <h2 id="kw-wallet-action-title">어떤 자산을<br />보낼까요?</h2>
            <p className="kw-transfer-lead">보낼 수 있는 잔액이 있는 자산만 보여드려요.</p>
            <AssetPicker assets={assets} onSelect={selectAsset} />
          </div>
        ) : step === 'recipient' && asset ? (
          <div className="kw-transfer-page kw-transfer-form-page">
            <p className="kw-transfer-kicker">{asset.network} · {asset.symbol}</p>
            <h2 id="kw-wallet-action-title">어디로<br />보낼까요?</h2>
            <label className="kw-transfer-field">
              <span>받는 지갑 주소</span>
              <input
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={recipient}
                placeholder={`${asset.network} 주소 입력`}
                onChange={(event) => setRecipient(event.target.value)}
              />
            </label>
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'amount' && asset ? (
          <div className="kw-transfer-page kw-transfer-form-page">
            <p className="kw-transfer-kicker">{asset.network} · {abbreviatedAddress(recipient)}</p>
            <h2 id="kw-wallet-action-title">얼마를<br />보낼까요?</h2>
            <div className="kw-amount-card">
              <label>
                <span>보낼 수 있는 금액 {asset.balanceDisplay} {asset.symbol}</span>
                <span className="kw-amount-input"><input autoFocus inputMode="decimal" value={amount} placeholder="0" onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))} /><b>{asset.symbol}</b></span>
              </label>
              <small>{krw ?? '원화 환산 정보 없음'}</small>
            </div>
            {!validAmount && amount ? <p className="kw-transfer-error" role="alert">보낼 수 있는 금액 안에서 입력해 주세요.</p> : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'review' && asset && prepared ? (
          <div className="kw-transfer-page kw-transfer-review-page">
            <p className="kw-transfer-kicker">최종 확인</p>
            <h2 id="kw-wallet-action-title">보내기 전에<br />확인해 주세요</h2>
            <div className="kw-transfer-hero-amount">
              <strong>{prepared.amountDisplay} {prepared.assetSymbol}</strong>
              <span>{prepared.fiatDisplay ?? '원화 환산 정보 없음'}</span>
            </div>
            <dl className="kw-transfer-review-list">
              <div><dt>받는 주소</dt><dd>{abbreviatedAddress(prepared.recipient)}</dd></div>
              <div><dt>네트워크</dt><dd>{prepared.network}</dd></div>
              <div><dt>네트워크 수수료</dt><dd>{prepared.networkFee.amountDisplay} {prepared.networkFee.symbol}{prepared.networkFee.fiatDisplay ? <small>{prepared.networkFee.fiatDisplay}</small> : null}</dd></div>
              <div><dt>수수료 부담</dt><dd><button type="button" onClick={() => setGasDialogOpen(true)}>{prepared.gasSponsorship.status === 'sponsored' ? '서비스 부담 · 적용됨' : '고객 부담 · 상세 보기'}<CaretRight aria-hidden="true" /></button></dd></div>
              <div><dt>견적 유효시간</dt><dd>{quoteExpired ? '만료됨' : `${new Date(prepared.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}까지`}</dd></div>
            </dl>
            <div className={`kw-compliance-card kw-compliance-card--${prepared.compliance.status}`}>
              {reviewBlocked ? <WarningCircle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              <div><strong>{prepared.compliance.status === 'allow' ? '주소 확인 완료' : prepared.compliance.status === 'review' ? '추가 확인이 필요해요' : '보낼 수 없는 주소예요'}</strong><p>{prepared.compliance.message}</p></div>
            </div>
            {needsReason ? (
              <label className="kw-transfer-reason">
                <span>보내는 이유</span>
                <textarea value={complianceReason} maxLength={200} placeholder="5자 이상 입력해 주세요" onChange={(event) => setComplianceReason(event.target.value)} />
              </label>
            ) : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'success' && asset && result ? (
          <div className="kw-transfer-page kw-transfer-success">
            <CheckCircle aria-hidden="true" />
            <h2 id="kw-wallet-action-title">보내기를<br />접수했어요</h2>
            <p>네트워크에서 거래를 확인하고 있어요.</p>
            <div><span>보낸 금액</span><strong>{prepared?.amountDisplay} {asset.symbol}</strong></div>
            <button type="button" onClick={() => void navigator.clipboard.writeText(result.transactionHash)}>거래 해시 복사</button>
          </div>
        ) : null}
      </div>
      {step === 'recipient' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={recipient.trim().length < 16} onClick={() => setStep('amount')}>다음</button></footer>
      ) : step === 'amount' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={!validAmount || busy} aria-busy={busy} onClick={() => void prepare()}>{busy ? '확인하고 있어요' : '보내기 조건 확인'}</button></footer>
      ) : step === 'review' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={busy || (!quoteExpired && (Boolean(reviewBlocked) || (Boolean(needsReason) && complianceReason.trim().length < 5)))} aria-busy={busy} onClick={() => void (quoteExpired || needsReason ? prepare() : execute())}>{busy ? '처리하고 있어요' : quoteExpired ? '견적 다시 확인' : needsReason ? '위험도 다시 확인' : '인증하고 보내기'}</button></footer>
      ) : step === 'success' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" onClick={onClose}>확인</button></footer>
      ) : null}
      {gasDialogOpen && prepared ? <GasSupportDialog quote={prepared.gasSponsorship} onClose={() => setGasDialogOpen(false)} /> : null}
      {network && network.addressStatus !== 'ready' ? <span className="kw-sr-only">선택한 네트워크 주소를 사용할 수 없습니다.</span> : null}
    </>
  );
}

function ExchangeFlow({ networks, onClose }: Pick<WalletActionSheetProps, 'networks' | 'onClose'>) {
  return (
    <>
      <FlowHeader title="환전하기" canGoBack={false} onBack={onClose} onClose={onClose} />
      <div className="kw-transfer-scroll"><div className="kw-transfer-page"><h2 id="kw-wallet-action-title">어떤 자산을<br />환전할까요?</h2><p className="kw-transfer-lead">거래소 연결과 원화 견적을 지원하는 네트워크를 선택해 주세요.</p><NetworkPicker networks={networks} onSelect={() => undefined} /></div></div>
    </>
  );
}

export function WalletActionSheet(props: WalletActionSheetProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layerRef.current?.querySelector<HTMLElement>('.kw-transfer-header button, .kw-transfer-choice:not(:disabled), input')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusScope = layerRef.current?.querySelector<HTMLElement>('.kw-gas-dialog') ?? layerRef.current;
      const focusable = Array.from(focusScope?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])') ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
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
  }, [props.onClose]);

  return (
    <div className="kw-transfer-layer" ref={layerRef}>
      <section className="kw-transfer-flow" role="dialog" aria-modal="true" aria-labelledby="kw-wallet-action-title">
        {props.mode === 'receive' ? <ReceiveFlow {...props} /> : props.mode === 'send' ? <SendFlow {...props} /> : <ExchangeFlow {...props} />}
      </section>
    </div>
  );
}
