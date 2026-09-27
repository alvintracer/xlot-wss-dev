import {
  ArrowLeft,
  ArrowsLeftRight,
  CaretRight,
  CheckCircle,
  Copy,
  DeviceMobile,
  GasPump,
  LinkSimple,
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
  WalletReceiveAssetView,
} from '@took-wss/contracts';
import { AssetIcon } from './AssetIcon';

export type WalletActionMode = 'receive' | 'send' | 'exchange';
type SendStep = 'asset' | 'network' | 'amount' | 'recipient-method' | 'recipient' | 'review' | 'success';
type AmountInputMode = 'token' | 'krw';
type RecipientMode = 'address' | 'phone';

interface AssetGroup {
  symbol: string;
  name: string;
  deployments: WalletReceiveAssetView[];
}

interface WalletActionSheetProps {
  mode: WalletActionMode;
  wallet: WalletProfileSummary;
  assets: WalletAssetView[];
  receiveAssets: WalletReceiveAssetView[];
  networks: WalletNetworkView[];
  hostCapabilities: HostCapabilities;
  initialChainId?: string;
  onPrepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onClose: () => void;
}

const numberFormatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

function tenTo(power: number): bigint {
  return 10n ** BigInt(Math.max(0, power));
}

function parseDecimalFraction(value: string): { units: bigint; scale: bigint } | null {
  const normalized = value.replaceAll(',', '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;
  const fraction = match[2] ?? '';
  return {
    units: BigInt(`${match[1]}${fraction}`),
    scale: tenTo(fraction.length),
  };
}

export function parseAmountToAtomic(value: string, decimals: number): string | null {
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

export function parseKrwToAtomic(value: string, priceDecimal: string | undefined, decimals: number): string | null {
  const krw = parseDecimalFraction(value);
  const price = priceDecimal ? parseDecimalFraction(priceDecimal) : null;
  if (!krw || !price || krw.units <= 0n || price.units <= 0n) return null;
  const atomic = krw.units * tenTo(decimals) * price.scale / (krw.scale * price.units);
  return atomic > 0n ? atomic.toString() : null;
}

export function formatAtomic(value: bigint, decimals: number, maximumFractionDigits = 8): string {
  const base = tenTo(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0')
    .slice(0, maximumFractionDigits).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

function krwFromAtomic(asset: WalletReceiveAssetView | undefined, atomic: string | null): bigint | null {
  const price = asset?.referencePrice && !asset.referencePrice.stale
    ? parseDecimalFraction(asset.referencePrice.decimal)
    : null;
  if (!asset || !atomic || !price) return null;
  const denominator = tenTo(asset.decimals) * price.scale;
  const numerator = BigInt(atomic) * price.units;
  return (numerator + denominator / 2n) / denominator;
}

function estimatedKrwFromAtomic(asset: WalletReceiveAssetView | undefined, atomic: string | null): string | null {
  const roundedWon = krwFromAtomic(asset, atomic);
  return roundedWon === null ? null : `약 ${numberFormatter.format(roundedWon)}원`;
}

function groupAssets(assets: WalletReceiveAssetView[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  for (const asset of assets) {
    const current = groups.get(asset.symbol);
    if (current) current.deployments.push(asset);
    else groups.set(asset.symbol, { symbol: asset.symbol, name: asset.name, deployments: [asset] });
  }
  return [...groups.values()];
}

function aggregateBalance(group: AssetGroup): string {
  const ready = group.deployments.filter(({ balanceStatus }) => balanceStatus !== 'unavailable');
  if (ready.length === 0) return '조회 불가';
  const decimals = Math.max(...ready.map((asset) => asset.decimals));
  const total = ready.reduce((sum, asset) => (
    sum + safeBigInt(asset.balanceAtomic) * tenTo(decimals - asset.decimals)
  ), 0n);
  return `${formatAtomic(total, decimals)} ${group.symbol}`;
}

function isRecipientValid(mode: RecipientMode, value: string, chainId: string): boolean {
  const normalized = value.trim();
  if (mode === 'phone') return /^(?:\+82|0)1[016789]\d{7,8}$/.test(normalized.replace(/[\s-]/g, ''));
  if (chainId === 'ethereum' || chainId === 'polygon' || chainId === 'arbitrum' || chainId === 'base' || chainId === 'bnb') {
    return /^0x[0-9a-fA-F]{40}$/.test(normalized);
  }
  if (chainId === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalized);
  if (chainId === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(normalized);
  if (chainId === 'xrp') return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(normalized);
  return normalized.length >= 20;
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
          <AssetIcon className="kw-transfer-asset-mark" symbol={network.nativeSymbol} iconAssetId={`coin:${network.nativeSymbol.toLowerCase()}`} />
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

function AssetGroupPicker({ groups, onSelect }: { groups: AssetGroup[]; onSelect: (group: AssetGroup) => void }) {
  return (
    <div className="kw-transfer-choice-list">
      {groups.map((group) => (
        <button className="kw-transfer-choice" type="button" key={group.symbol} onClick={() => onSelect(group)}>
          <AssetIcon className="kw-transfer-asset-mark" symbol={group.symbol} iconAssetId={group.deployments[0]?.iconAssetId} />
          <span>
            <strong>{group.name}</strong>
            <small>{group.symbol} · {group.deployments.length}개 네트워크</small>
          </span>
          <span className="kw-transfer-choice__balance">
            <strong>{aggregateBalance(group)}</strong>
            <small>전체 네트워크</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function AssetNetworkPicker({
  assets,
  purpose,
  onSelect,
}: {
  assets: WalletReceiveAssetView[];
  purpose: 'receive' | 'send';
  onSelect: (asset: WalletReceiveAssetView) => void;
}) {
  return (
    <div className="kw-transfer-choice-list">
      {assets.map((asset) => {
        const canSelect = purpose === 'receive' || asset.transferStatus === 'enabled';
        const balanceLabel = asset.balanceStatus === 'unavailable'
          ? '잔액 조회 불가'
          : `${asset.balanceDisplay} ${asset.symbol}`;
        return (
          <button className="kw-transfer-choice" type="button" key={asset.assetId} disabled={!canSelect} onClick={() => onSelect(asset)}>
            <AssetIcon className="kw-transfer-asset-mark" symbol={asset.symbol} iconAssetId={asset.iconAssetId} />
            <span>
              <strong>{asset.network}</strong>
              <small>{asset.canonical ? '공식 발행 자산' : '브리지 자산'}{!canSelect ? ` · ${asset.transferUnavailableReason ?? '보내기 연결 준비 중'}` : ''}</small>
            </span>
            <span className="kw-transfer-choice__balance">
              <strong>{balanceLabel}</strong>
              <small>{asset.referencePrice?.stale ? '원화 시세 업데이트 필요' : asset.referencePrice?.display ?? '원화 시세 없음'}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ReceiveFlow({
  wallet,
  receiveAssets,
  networks,
  onClose,
}: Pick<WalletActionSheetProps, 'wallet' | 'receiveAssets' | 'networks' | 'onClose'>) {
  const groups = useMemo(() => groupAssets(receiveAssets), [receiveAssets]);
  const [selectedGroup, setSelectedGroup] = useState<AssetGroup>();
  const [selectedAsset, setSelectedAsset] = useState<WalletReceiveAssetView>();
  const [copied, setCopied] = useState(false);
  const selectedNetwork = networks.find((network) => network.chainId === selectedAsset?.chainId);
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
    if (!address || !selectedNetwork || !selectedAsset) return;
    const shareData = {
      title: `${selectedAsset.symbol} 받기 주소`,
      text: `${selectedNetwork.network} ${selectedAsset.symbol} 받기 주소\n${address}`,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => undefined);
      return;
    }
    await copyAddress();
  };

  return (
    <>
      <FlowHeader
        title="채우기"
        canGoBack={Boolean(selectedGroup)}
        onBack={() => selectedAsset ? setSelectedAsset(undefined) : setSelectedGroup(undefined)}
        onClose={onClose}
      />
      <div className="kw-transfer-scroll">
        {!selectedGroup ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{wallet.label}</p>
            <h2 id="kw-wallet-action-title">어떤 자산을<br />채울까요?</h2>
            <p className="kw-transfer-lead">먼저 자산을 선택해 주세요.</p>
            <AssetGroupPicker groups={groups} onSelect={setSelectedGroup} />
          </div>
        ) : !selectedAsset ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{selectedGroup.name} · {selectedGroup.symbol}</p>
            <h2 id="kw-wallet-action-title">어떤 네트워크로<br />채울까요?</h2>
            <p className="kw-transfer-lead">보내는 곳과 같은 네트워크를 선택해 주세요.</p>
            <AssetNetworkPicker assets={selectedGroup.deployments} purpose="receive" onSelect={setSelectedAsset} />
          </div>
        ) : selectedNetwork && address ? (
          <div className="kw-transfer-page kw-receive-page">
            <p className="kw-transfer-kicker">{selectedNetwork.network} · {selectedAsset.symbol}</p>
            <h2 id="kw-wallet-action-title">이 주소로<br />자산을 보내주세요</h2>
            <p className="kw-transfer-lead">반드시 {selectedNetwork.network} 네트워크의 {selectedAsset.symbol}만 보내주세요.</p>
            <div className="kw-qr-card">
              <QRCodeSVG value={address} size={176} level="M" marginSize={2} title={`${selectedAsset.symbol} 받기 주소 QR`} />
              <strong>{selectedAsset.symbol} 받기 주소</strong>
              <button type="button" onClick={() => void copyAddress()}>{abbreviatedAddress(address)}<Copy aria-hidden="true" /></button>
            </div>
            {selectedNetwork.chainId === 'xrp' ? (
              <div className="kw-transfer-warning"><WarningCircle aria-hidden="true" /><span>{selectedAsset.tokenAddress ? `${selectedAsset.symbol}를 받으려면 이 주소에 ${selectedAsset.symbol} 신뢰선이 설정되어 있어야 해요. ` : ''}거래소에서 보낼 때는 목적지 태그 입력 여부를 반드시 확인해 주세요.</span></div>
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
  receiveAssets,
  networks,
  onPrepareTransfer,
  onRequestSecureTransactionSignature,
  onSubmitTransfer,
  onClose,
}: WalletActionSheetProps) {
  const groups = useMemo(() => groupAssets(receiveAssets), [receiveAssets]);
  const [step, setStep] = useState<SendStep>('asset');
  const [selectedGroup, setSelectedGroup] = useState<AssetGroup>();
  const [asset, setAsset] = useState<WalletReceiveAssetView>();
  const [amountMode, setAmountMode] = useState<AmountInputMode>('token');
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('address');
  const [recipient, setRecipient] = useState('');
  const [destinationTag, setDestinationTag] = useState('');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [complianceReason, setComplianceReason] = useState('');
  const [result, setResult] = useState<TransferExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gasDialogOpen, setGasDialogOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const network = networks.find((candidate) => candidate.chainId === asset?.chainId);
  const amountAtomic = asset
    ? amountMode === 'token'
      ? parseAmountToAtomic(amount, asset.decimals)
      : parseKrwToAtomic(amount, asset.referencePrice?.stale ? undefined : asset.referencePrice?.decimal, asset.decimals)
    : null;
  const available = safeBigInt(asset?.availableAtomic);
  const validAmount = amountAtomic !== null && BigInt(amountAtomic) <= available;
  const secondaryAmount = asset && amountAtomic
    ? amountMode === 'token'
      ? estimatedKrwFromAtomic(asset, amountAtomic)
      : `약 ${formatAtomic(BigInt(amountAtomic), asset.decimals)} ${asset.symbol}`
    : null;
  const quoteExpired = prepared ? clock >= Date.parse(prepared.expiresAt) : false;
  const recipientValid = asset ? isRecipientValid(recipientMode, recipient, asset.chainId) : false;
  const destinationTagValid = destinationTag.length === 0
    || (/^\d{1,10}$/.test(destinationTag) && Number(destinationTag) <= 0xffff_ffff);

  useEffect(() => {
    if (step !== 'review' || !prepared) return undefined;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [prepared, step]);

  const back = () => {
    setError(null);
    if (step === 'network') {
      setSelectedGroup(undefined);
      setStep('asset');
    } else if (step === 'amount') {
      setAsset(undefined);
      setStep('network');
    } else if (step === 'recipient-method') setStep('amount');
    else if (step === 'recipient') setStep('recipient-method');
    else if (step === 'review') {
      setPrepared(null);
      setStep('recipient');
    } else onClose();
  };

  const selectGroup = (group: AssetGroup) => {
    setSelectedGroup(group);
    setStep('network');
  };

  const selectAsset = (selected: WalletReceiveAssetView) => {
    setAsset(selected);
    setRecipient('');
    setDestinationTag('');
    setAmount('');
    setAmountMode('token');
    setRecipientMode('address');
    setPrepared(null);
    setStep('amount');
  };

  const selectRecipientMode = (mode: RecipientMode) => {
    setRecipientMode(mode);
    setRecipient('');
    setDestinationTag('');
    setError(null);
    setPrepared(null);
    setStep('recipient');
  };

  const setMaximumAmount = () => {
    if (!asset || available <= 0n) return;
    if (amountMode === 'token') {
      setAmount(formatAtomic(available, asset.decimals, asset.decimals));
      return;
    }
    const maximumKrw = krwFromAtomic(asset, available.toString());
    if (maximumKrw !== null) setAmount(maximumKrw.toString());
  };

  const prepare = async () => {
    if (!asset?.chainId || !amountAtomic || !recipient.trim() || !destinationTagValid) return;
    setBusy(true);
    setError(null);
    try {
      const quote = await onPrepareTransfer({
        walletId: wallet.walletId,
        assetId: asset.assetId,
        chainId: asset.chainId,
        recipient: recipient.trim(),
        amountAtomic,
        channel: recipientMode,
        ...(asset.chainId === 'xrp' && destinationTag ? { destinationTag } : {}),
        ...(complianceReason.trim() ? { complianceReason: complianceReason.trim() } : {}),
      });
      setPrepared(quote);
      setStep('review');
    } catch {
      setError(recipientMode === 'phone'
        ? '휴대폰 송금 조건을 확인하지 못했어요. 번호, 잔액과 에스크로 지원 네트워크를 다시 확인해 주세요.'
        : '보내기 조건을 확인하지 못했어요. 주소, 잔액과 네트워크 수수료를 다시 확인해 주세요.');
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
            <p className="kw-transfer-lead">보유 여부와 관계없이 지원 자산을 선택할 수 있어요.</p>
            <AssetGroupPicker groups={groups} onSelect={selectGroup} />
          </div>
        ) : step === 'network' && selectedGroup ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{selectedGroup.name} · {selectedGroup.symbol}</p>
            <h2 id="kw-wallet-action-title">어떤 네트워크에서<br />보낼까요?</h2>
            <p className="kw-transfer-lead">네트워크별 보유 수량과 보내기 지원 상태를 확인해 주세요.</p>
            <AssetNetworkPicker assets={selectedGroup.deployments} purpose="send" onSelect={selectAsset} />
          </div>
        ) : step === 'amount' && asset ? (
          <div className="kw-transfer-page kw-transfer-form-page">
            <p className="kw-transfer-kicker">{asset.network} · {asset.symbol}</p>
            <h2 id="kw-wallet-action-title">얼마를<br />보낼까요?</h2>
            <div className="kw-amount-card">
              <div className="kw-amount-card__head">
                <span>보낼 수 있는 금액 {asset.balanceDisplay} {asset.symbol}</span>
                <button type="button" onClick={() => {
                  setAmount('');
                  setAmountMode((current) => current === 'token' ? 'krw' : 'token');
                }}><ArrowsLeftRight aria-hidden="true" />{amountMode === 'token' ? '원화로 입력' : `${asset.symbol}로 입력`}</button>
              </div>
              <label className="kw-amount-input">
                <input autoFocus inputMode="decimal" value={amount} placeholder="0" aria-label={`보낼 금액 ${amountMode === 'token' ? asset.symbol : '원화'}`} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} />
                <b>{amountMode === 'token' ? asset.symbol : '원'}</b>
              </label>
              <div className="kw-amount-card__foot">
                <small>{secondaryAmount ?? (amountMode === 'krw' && (!asset.referencePrice || asset.referencePrice.stale) ? '원화 시세를 업데이트한 뒤 입력할 수 있어요.' : '금액을 입력해 주세요.')}</small>
                <button type="button" disabled={available <= 0n} onClick={setMaximumAmount}>전액</button>
              </div>
            </div>
            {asset.balanceStatus === 'unavailable' ? (
              <div className="kw-transfer-zero-notice"><WarningCircle aria-hidden="true" /><span><strong>잔액을 확인하지 못했어요.</strong>잠시 후 다시 확인해 주세요. 조회 전에는 보내기를 진행하지 않아요.</span></div>
            ) : available === 0n ? (
              <div className="kw-transfer-zero-notice"><Wallet aria-hidden="true" /><span><strong>현재 보낼 수 있는 금액은 0원이에요.</strong>자산과 금액 입력 방식을 미리 확인할 수 있고, 잔액을 받은 뒤 바로 보낼 수 있어요.</span></div>
            ) : null}
            {!validAmount && amount ? <p className="kw-transfer-error" role="alert">보낼 수 있는 금액 안에서 입력해 주세요.</p> : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'recipient-method' && asset ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{asset.network} · {amountMode === 'krw' ? `${amount}원` : `${amount} ${asset.symbol}`}</p>
            <h2 id="kw-wallet-action-title">어떻게<br />보낼까요?</h2>
            <p className="kw-transfer-lead">지갑 주소 또는 휴대폰 번호를 선택해 주세요.</p>
            <div className="kw-recipient-methods">
              <button type="button" onClick={() => selectRecipientMode('address')}><span><LinkSimple aria-hidden="true" /></span><strong>지갑 주소로 보내기</strong><small>받는 분의 {asset.network} 주소로 보내요.</small><CaretRight aria-hidden="true" /></button>
              <button type="button" disabled={asset.phoneTransferStatus !== 'enabled'} onClick={() => selectRecipientMode('phone')}><span><DeviceMobile aria-hidden="true" /></span><strong>휴대폰 번호로 보내기</strong><small>{asset.phoneTransferStatus === 'enabled' ? '에스크로에 예치하고 안전한 수령 링크를 보내요.' : asset.phoneTransferUnavailableReason ?? '이 네트워크에서는 아직 이용할 수 없어요.'}</small><CaretRight aria-hidden="true" /></button>
            </div>
          </div>
        ) : step === 'recipient' && asset ? (
          <div className="kw-transfer-page kw-transfer-form-page">
            <p className="kw-transfer-kicker">{asset.network} · {asset.symbol}</p>
            <h2 id="kw-wallet-action-title">{recipientMode === 'address' ? <>받는 주소를<br />입력해 주세요</> : <>받는 분의 번호를<br />입력해 주세요</>}</h2>
            <label className="kw-transfer-field">
              <span>{recipientMode === 'address' ? '받는 지갑 주소' : '휴대폰 번호'}</span>
              <input
                autoFocus
                type={recipientMode === 'phone' ? 'tel' : 'text'}
                inputMode={recipientMode === 'phone' ? 'tel' : 'text'}
                autoComplete={recipientMode === 'phone' ? 'tel' : 'off'}
                autoCapitalize="none"
                spellCheck={false}
                value={recipient}
                placeholder={recipientMode === 'address' ? `${asset.network} 주소 입력` : '010-0000-0000'}
                onChange={(event) => setRecipient(event.target.value)}
              />
            </label>
            {recipientMode === 'address' && asset.chainId === 'xrp' ? (
              <label className="kw-transfer-field kw-transfer-field--secondary">
                <span>목적지 태그 (선택)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={destinationTag}
                  placeholder="거래소에서 안내한 숫자"
                  onChange={(event) => setDestinationTag(event.target.value.replace(/\D/g, '').slice(0, 10))}
                />
              </label>
            ) : null}
            <p className="kw-transfer-field-hint">{recipientMode === 'address' ? '네트워크가 다르면 자산을 찾기 어려울 수 있어요.' : '상대방은 수령 안내를 받고 본인 확인 후 자산을 받아요.'}</p>
            {recipientMode === 'address' && asset.chainId === 'xrp' ? <p className="kw-transfer-field-hint">거래소가 목적지 태그를 안내했다면 반드시 함께 입력해 주세요.</p> : null}
            {recipientMode === 'phone' ? <div className="kw-transfer-bridge-notice"><ShieldCheck aria-hidden="true" /><span><strong>받는 분이 확인한 뒤 수령해요.</strong>보낸 자산은 7일 동안 에스크로에 안전하게 보관되고, 기간 안에 받지 않으면 환불할 수 있어요.</span></div> : null}
            {recipient.length > 0 && !recipientValid ? <p className="kw-transfer-error" role="alert">{recipientMode === 'address' ? '받는 주소 형식을 다시 확인해 주세요.' : '휴대폰 번호를 다시 확인해 주세요.'}</p> : null}
            {!destinationTagValid ? <p className="kw-transfer-error" role="alert">목적지 태그는 0부터 4,294,967,295 사이의 숫자로 입력해 주세요.</p> : null}
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
              <div><dt>{prepared.channel === 'phone' ? '받는 분' : '받는 주소'}</dt><dd>{prepared.channel === 'phone' ? prepared.recipient : abbreviatedAddress(prepared.recipient)}</dd></div>
              {prepared.destinationTag !== undefined ? <div><dt>목적지 태그</dt><dd>{prepared.destinationTag}</dd></div> : null}
              <div><dt>네트워크</dt><dd>{prepared.network}</dd></div>
              <div><dt>{prepared.networkFee.maximum ? '최대 네트워크 수수료' : '네트워크 수수료'}</dt><dd>{prepared.networkFee.amountDisplay} {prepared.networkFee.symbol}{prepared.networkFee.fiatDisplay ? <small>{prepared.networkFee.fiatDisplay}</small> : null}</dd></div>
              {prepared.phoneEscrow ? <div><dt>수령 수수료</dt><dd>{prepared.phoneEscrow.claimFeeDisplay} {prepared.assetSymbol}<small>받는 금액은 {prepared.phoneEscrow.recipientAmountDisplay} {prepared.assetSymbol}</small></dd></div> : null}
              {prepared.phoneEscrow ? <div><dt>에스크로 예치</dt><dd>{prepared.phoneEscrow.escrowAmountDisplay} {prepared.assetSymbol}<small>{new Date(prepared.phoneEscrow.expiresAt).toLocaleDateString('ko-KR')}까지 수령</small></dd></div> : null}
              <div><dt>수수료 부담</dt><dd><button type="button" onClick={() => setGasDialogOpen(true)}>{prepared.gasSponsorship.status === 'sponsored' ? '서비스 부담 · 적용됨' : '고객 부담 · 상세 보기'}<CaretRight aria-hidden="true" /></button></dd></div>
              <div><dt>견적 유효시간</dt><dd>{quoteExpired ? '만료됨' : `${new Date(prepared.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}까지`}</dd></div>
            </dl>
            <div className={`kw-compliance-card kw-compliance-card--${prepared.compliance.status}`}>
              {reviewBlocked ? <WarningCircle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              <div><strong>{prepared.compliance.status === 'allow' ? prepared.channel === 'phone' ? '수령 절차 확인 완료' : '주소 확인 완료' : prepared.compliance.status === 'review' ? '추가 확인이 필요해요' : '보낼 수 없는 주소예요'}</strong><p>{prepared.compliance.message}</p></div>
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
            <h2 id="kw-wallet-action-title">{result.delivery?.status === 'sent' ? <>수령 안내를<br />보냈어요</> : <>보내기를<br />접수했어요</>}</h2>
            <p>{result.delivery?.status === 'sent' ? `${result.delivery.recipientDisplay} 번호로 수령 링크를 보냈어요.` : result.delivery?.status === 'failed' ? '자산 예치는 완료됐지만 수령 안내 발송을 다시 확인해야 해요.' : '네트워크에서 거래를 확인하고 있어요.'}</p>
            <div><span>보낸 금액</span><strong>{prepared?.amountDisplay} {asset.symbol}</strong></div>
            <button type="button" onClick={() => void navigator.clipboard.writeText(result.transactionHash)}>거래 해시 복사</button>
          </div>
        ) : null}
      </div>
      {step === 'amount' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={!validAmount} onClick={() => setStep('recipient-method')}>{asset?.balanceStatus === 'unavailable' ? '잔액 확인이 필요해요' : available <= 0n ? '보낼 잔액이 없어요' : '다음'}</button></footer>
      ) : step === 'recipient' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={!recipientValid || !destinationTagValid || busy} aria-busy={busy} onClick={() => void prepare()}>{busy ? '확인하고 있어요' : recipientMode === 'phone' ? '에스크로 조건 확인' : '보내기 조건 확인'}</button></footer>
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
