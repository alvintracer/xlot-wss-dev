import {
  ArrowsDownUp,
  ArrowLeft,
  ArrowsLeftRight,
  CaretRight,
  CheckCircle,
  Copy,
  AddressBook,
  DeviceMobile,
  GasPump,
  LinkSimple,
  QrCode,
  ShareNetwork,
  ShieldCheck,
  Wallet,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExchangeExecutionResult,
  ExchangeQuote,
  HostCapabilities,
  HostRecipientPickResult,
  PrepareExchangeRequest,
  PrepareTransferRequest,
  ReadyWalletHomePayload,
  PreparedExchange,
  PreparedTransfer,
  RequestExchangeQuote,
  SecureTransactionSigningRequest,
  SecureTransactionSigningResult,
  SubmitTransferRequest,
  SubmitExchangeRequest,
  TransferExecutionResult,
  PhoneNotificationResult,
  PhoneEscrowQuote,
  TransferActivityItem,
  WalletAssetView,
  WalletNetworkView,
  WalletProfileSummary,
  WalletReceiveAssetView,
} from '@took-wss/contracts';
import { AssetIcon } from './AssetIcon';
import { ChainIcon } from './ChainIcon';
import { BusyButtonLabel } from './BusyButtonLabel';

export type WalletActionMode = 'receive' | 'send' | 'exchange';
type SendStep = 'asset' | 'network' | 'amount' | 'recipient-method' | 'own-wallet' | 'recipient' | 'review' | 'processing' | 'success';
type AmountInputMode = 'token' | 'krw';
type RecipientMode = 'address' | 'phone' | 'own-wallet';

interface OwnWalletDestination { walletId: string; label: string; address: string }

interface AssetGroup {
  symbol: string;
  name: string;
  deployments: WalletReceiveAssetView[];
}

interface WalletActionSheetProps {
  mode: WalletActionMode;
  wallet: WalletProfileSummary;
  wallets: WalletProfileSummary[];
  assets: WalletAssetView[];
  receiveAssets: WalletReceiveAssetView[];
  networks: WalletNetworkView[];
  hostCapabilities: HostCapabilities;
  initialChainId?: string;
  onPrepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  onQuotePhoneEscrow: (request: { walletId: string; assetId: string; chainId: string; amountAtomic: string }) => Promise<PhoneEscrowQuote>;
  onLoadWalletHome: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onTransactionSubmitted: (sourceWalletId: string, destinationWalletId?: string) => void;
  onRequestExchangeQuote: (request: RequestExchangeQuote) => Promise<ExchangeQuote>;
  onPrepareExchange: (request: PrepareExchangeRequest) => Promise<PreparedExchange>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onGetTransferStatus: (intentId: string) => Promise<TransferActivityItem>;
  onRetryPhoneNotification: (intentId: string) => Promise<PhoneNotificationResult>;
  onRequestRecipientPick: (mode: 'qr' | 'contacts', chainId: string) => Promise<HostRecipientPickResult>;
  onSubmitExchange: (request: SubmitExchangeRequest) => Promise<ExchangeExecutionResult>;
  onGetExchangeStatus: (intentId: string) => Promise<ExchangeExecutionResult>;
  onClose: () => void;
}

const numberFormatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const BITCOIN_ADDRESS_PATTERN = /^(?:1[1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/i;
const EVM_EXCHANGE_CHAINS = new Set(['ethereum', 'polygon', 'arbitrum', 'base', 'bnb']);

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
  if (chainId === 'bitcoin') return BITCOIN_ADDRESS_PATTERN.test(normalized);
  if (chainId === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(normalized);
  if (chainId === 'xrp') return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(normalized);
  return normalized.length >= 20;
}

export function parseScannedRecipient(value: string, chainId: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 512 || trimmed.includes('?') || trimmed.includes('#')) return null;
  if (isRecipientValid('address', trimmed, chainId)) return trimmed;
  const match = /^([a-z][a-z0-9-]*):(?:\/\/)?([^\s]+)$/i.exec(trimmed);
  if (!match) return null;
  const scheme = match[1]?.toLowerCase();
  let address = match[2];
  if (!scheme || !address) return null;
  if (scheme === 'ethereum') {
    const evmChainIds: Record<string, string> = { ethereum: '1', polygon: '137', arbitrum: '42161', base: '8453', bnb: '56' };
    const targetChainId = evmChainIds[chainId];
    if (!targetChainId) return null;
    const chainSuffix = /^(.+)@(\d+)$/.exec(address);
    if (chainSuffix) {
      if (chainSuffix[2] !== targetChainId || !chainSuffix[1]) return null;
      address = chainSuffix[1];
    } else if (chainId !== 'ethereum') return null;
  } else if (scheme !== chainId) return null;
  return isRecipientValid('address', address, chainId) ? address : null;
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

export function ownWalletReceiveDestination(
  home: ReadyWalletHomePayload,
  asset: Pick<WalletReceiveAssetView, 'assetId' | 'chainId'>,
  sourceAddress?: string,
): OwnWalletDestination | null {
  const network = home.networks.find((item) => item.chainId === asset.chainId && item.addressStatus === 'ready');
  if (!home.receiveAssets.some((item) => item.assetId === asset.assetId && item.chainId === asset.chainId)
    || !network?.address || network.address.toLowerCase() === sourceAddress?.toLowerCase()) return null;
  return { walletId: home.wallet.walletId, label: home.wallet.label, address: network.address };
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
          <ChainIcon className="kw-transfer-asset-mark" chainId={network.chainId} />
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
            <ChainIcon className="kw-transfer-asset-mark" chainId={asset.chainId} />
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
  wallets,
  receiveAssets,
  networks,
  onStartOwnTransfer,
  onClose,
}: Pick<WalletActionSheetProps, 'wallet' | 'wallets' | 'receiveAssets' | 'networks' | 'onClose'> & {
  onStartOwnTransfer: (sourceWalletId: string, asset: WalletReceiveAssetView, destinationAddress: string) => Promise<void>;
}) {
  const groups = useMemo(() => groupAssets(receiveAssets), [receiveAssets]);
  const [selectedGroup, setSelectedGroup] = useState<AssetGroup>();
  const [selectedAsset, setSelectedAsset] = useState<WalletReceiveAssetView>();
  const [copied, setCopied] = useState(false);
  const [ownSourcesOpen, setOwnSourcesOpen] = useState(false);
  const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null);
  const [ownSourceError, setOwnSourceError] = useState<string | null>(null);
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

  const chooseOwnSource = async (sourceWalletId: string) => {
    if (!selectedAsset || !address) return;
    setLoadingSourceId(sourceWalletId);
    setOwnSourceError(null);
    try { await onStartOwnTransfer(sourceWalletId, selectedAsset, address); }
    catch { setOwnSourceError('이 지갑에서는 선택한 자산을 보낼 수 없어요. 다른 지갑을 선택해 주세요.'); }
    finally { setLoadingSourceId(null); }
  };

  return (
    <>
      <FlowHeader
        title="채우기"
        canGoBack={Boolean(selectedGroup)}
        onBack={() => ownSourcesOpen ? setOwnSourcesOpen(false) : selectedAsset ? setSelectedAsset(undefined) : setSelectedGroup(undefined)}
        onClose={onClose}
      />
      <div className="kw-transfer-scroll">
        {ownSourcesOpen && selectedAsset ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{selectedAsset.network} · {selectedAsset.symbol}</p>
            <h2 id="kw-wallet-action-title">어느 내 지갑에서 보낼까요?</h2>
            <p className="kw-transfer-lead">보내는 지갑을 선택하면 금액 입력으로 이어져요.</p>
            <div className="kw-transfer-choice-list">
              {wallets.filter((candidate) => candidate.walletId !== wallet.walletId).map((candidate) => (
                <button className="kw-transfer-choice" type="button" key={candidate.walletId} disabled={loadingSourceId !== null}
                  onClick={() => void chooseOwnSource(candidate.walletId)}>
                  <Wallet className="kw-transfer-asset-mark" aria-hidden="true" />
                  <span><strong>{candidate.label}</strong><small>{loadingSourceId === candidate.walletId ? '자산을 확인하고 있어요' : '이 지갑에서 보내기'}</small></span>
                  <CaretRight aria-hidden="true" />
                </button>
              ))}
            </div>
            {ownSourceError ? <p className="kw-transfer-error" role="alert">{ownSourceError}</p> : null}
          </div>
        ) : !selectedGroup ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{wallet.label}</p>
            <h2 id="kw-wallet-action-title">어떤 자산을 채울까요?</h2>
            <p className="kw-transfer-lead">먼저 자산을 선택해 주세요.</p>
            <AssetGroupPicker groups={groups} onSelect={setSelectedGroup} />
          </div>
        ) : !selectedAsset ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{selectedGroup.name} · {selectedGroup.symbol}</p>
            <h2 id="kw-wallet-action-title">어떤 네트워크로 채울까요?</h2>
            <p className="kw-transfer-lead">보내는 곳과 같은 네트워크를 선택해 주세요.</p>
            <AssetNetworkPicker assets={selectedGroup.deployments} purpose="receive" onSelect={setSelectedAsset} />
          </div>
        ) : selectedNetwork && address ? (
          <div className="kw-transfer-page kw-receive-page">
            <p className="kw-transfer-kicker">{selectedNetwork.network} · {selectedAsset.symbol}</p>
            <h2 id="kw-wallet-action-title">이 주소로 자산을 보내주세요</h2>
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
            <button className="kw-own-wallet-primary" type="button" disabled={wallets.length < 2}
              onClick={() => { setOwnSourcesOpen(true); setOwnSourceError(null); }}>
              <Wallet aria-hidden="true" />내 지갑에서 채우기<CaretRight aria-hidden="true" />
            </button>
            {wallets.length < 2 ? <p className="kw-own-wallet-hint">다른 지갑을 추가하면 내 지갑에서 채울 수 있어요.</p> : null}
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

function KytRiskDetails({ compliance }: { compliance: PreparedTransfer['compliance'] }) {
  if (!compliance.riskCategory && !compliance.identifiedAt) return null;
  const [year, month, day] = compliance.identifiedAt?.split('-') ?? [];
  return (
    <dl className="kw-risk-evidence">
      {compliance.riskCategory ? <div><dt>위험 분류</dt><dd>{compliance.riskCategory}</dd></div> : null}
      {year && month && day ? <div><dt>위험 주소 등록일</dt><dd>{year}년 {Number(month)}월 {Number(day)}일</dd></div> : null}
    </dl>
  );
}

function TransferRiskDialog({ compliance, onCancel, onConfirm }: {
  compliance: PreparedTransfer['compliance'];
  onCancel: () => void;
  onConfirm?: () => void;
}) {
  return (
    <div className="kw-gas-dialog-layer">
      <button type="button" className="kw-gas-dialog-scrim" aria-label="위험 주소 안내 닫기" onClick={onCancel} />
      <section className="kw-gas-dialog kw-risk-dialog" role="alertdialog" aria-modal="true" aria-labelledby="kw-risk-dialog-title" aria-describedby="kw-risk-dialog-description">
        <button type="button" className="kw-gas-dialog-close" aria-label="닫기" onClick={onCancel}><X aria-hidden="true" /></button>
        <div className="kw-gas-dialog-icon kw-risk-dialog__icon"><WarningCircle aria-hidden="true" /></div>
        <h3 id="kw-risk-dialog-title">{compliance.status === 'unavailable' ? '주소 위험도를 확인하지 못했어요' : compliance.status === 'block' ? '보낼 수 없는 주소예요' : '주소 위험 신호가 확인됐어요'}</h3>
        <p id="kw-risk-dialog-description">{compliance.message}</p>
        <KytRiskDetails compliance={compliance} />
        <div className={`kw-risk-dialog__actions${onConfirm ? '' : ' kw-risk-dialog__actions--single'}`}>
          {onConfirm ? <button className="kw-risk-dialog__cancel" type="button" onClick={onCancel}>취소</button> : null}
          <button className="kw-button" type="button" autoFocus onClick={onConfirm ?? onCancel}>{onConfirm ? '그래도 보내기' : '확인'}</button>
        </div>
      </section>
    </div>
  );
}

export function transferPreparationErrorMessage(
  error: unknown,
  recipientMode: RecipientMode,
  nativeSymbol?: string,
): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'insufficient_balance') {
    return '보낼 수 있는 잔액이 부족해요. 금액을 줄여 다시 확인해 주세요.';
  }
  if (code === 'insufficient_balance_for_fee') {
    return `네트워크 수수료로 사용할 ${nativeSymbol ?? '기본 자산'} 잔액이 부족해요. 수수료 자산을 채운 뒤 다시 시도해 주세요.`;
  }
  if (code === 'insufficient_balance_for_relay_fee') {
    return '릴레이 수수료를 포함한 총 차감액이 잔액보다 커요. 보낼 금액을 조금 줄여 주세요.';
  }
  if (code === 'invalid_recipient') return '받는 주소 형식을 다시 확인해 주세요.';
  if (code === 'own_wallet_destination_invalid') return '받는 내 지갑 주소를 확인하지 못했어요. 지갑을 다시 선택해 주세요.';
  if (code === 'self_transfer_not_allowed') return '현재 지갑과 같은 주소로는 보낼 수 없어요.';
  if (code === 'asset_balance_unavailable') return '현재 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (code === 'session_refresh_unavailable' || code === 'request_rejected') {
    return '보안 세션이 만료됐어요. 지갑을 다시 열고 시도해 주세요.';
  }
  if (code === 'destination_tag_required') return '받는 곳에서 안내한 목적지 태그를 입력해 주세요.';
  if (code === 'xrpl_trustline_required') return '받는 주소에 이 자산의 신뢰선이 없어 보낼 수 없어요.';
  if (code === 'xrpl_destination_activation_minimum') return '새 XRP 주소를 활성화하기 위한 최소 금액보다 적어요.';
  if (code.includes('network_fee_unavailable') || code === 'transfer_preparation_unavailable') {
    return '네트워크 수수료를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  if (code === 'phone_escrow_network_not_supported') {
    return '이 자산과 네트워크에서는 아직 휴대폰 송금을 지원하지 않아요.';
  }
  if (code === 'phone_escrow_pilot_limit') {
    return '현재 휴대폰 송금의 1회 한도를 초과했어요. 금액을 줄여 다시 시도해 주세요.';
  }
  return recipientMode === 'phone'
    ? '휴대폰 송금 조건을 확인하지 못했어요. 번호와 잔액을 다시 확인해 주세요.'
    : '보내기 조건을 확인하지 못했어요. 입력한 주소와 금액을 다시 확인해 주세요.';
}

function SendFlow({
  wallet,
  wallets,
  receiveAssets,
  networks,
  hostCapabilities,
  onLoadWalletHome,
  onTransactionSubmitted,
  onPrepareTransfer,
  onQuotePhoneEscrow,
  onRequestSecureTransactionSignature,
  onSubmitTransfer,
  onGetTransferStatus,
  onRetryPhoneNotification,
  onRequestRecipientPick,
  onClose,
  initialAssetId,
  initialOwnDestination,
}: WalletActionSheetProps & { initialAssetId?: string; initialOwnDestination?: OwnWalletDestination }) {
  const groups = useMemo(() => groupAssets(receiveAssets), [receiveAssets]);
  const initialAsset = receiveAssets.find((item) => item.assetId === initialAssetId);
  const [step, setStep] = useState<SendStep>(initialAsset ? 'amount' : 'asset');
  const [selectedGroup, setSelectedGroup] = useState<AssetGroup | undefined>(groups.find((group) => group.deployments.some((item) => item.assetId === initialAssetId)));
  const [asset, setAsset] = useState<WalletReceiveAssetView | undefined>(initialAsset);
  const [amountMode, setAmountMode] = useState<AmountInputMode>('krw');
  const [recipientMode, setRecipientMode] = useState<RecipientMode>(initialOwnDestination ? 'own-wallet' : 'address');
  const [recipient, setRecipient] = useState(initialOwnDestination?.address ?? '');
  const [ownDestination, setOwnDestination] = useState<OwnWalletDestination | null>(initialOwnDestination ?? null);
  const [loadingDestinationId, setLoadingDestinationId] = useState<string | null>(null);
  const [destinationTag, setDestinationTag] = useState('');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [complianceReason, setComplianceReason] = useState('');
  const [result, setResult] = useState<TransferExecutionResult | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [phoneQuote, setPhoneQuote] = useState<PhoneEscrowQuote | 'loading' | 'error' | null>(null);
  const phoneQuoteRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [recipientPickBusy, setRecipientPickBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gasDialogOpen, setGasDialogOpen] = useState(false);
  const [riskDialogMode, setRiskDialogMode] = useState<'notice' | 'confirm' | null>(null);
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
  const recipientValid = asset ? isRecipientValid(recipientMode, recipient, asset.chainId)
    && (recipientMode !== 'own-wallet' || Boolean(ownDestination && recipient === ownDestination.address)) : false;
  const destinationTagValid = destinationTag.length === 0
    || (/^\d{1,10}$/.test(destinationTag) && Number(destinationTag) <= 0xffff_ffff);

  const shareClaimLink = async (url: string) => {
    try {
      const canShare = typeof navigator.share === 'function';
      if (canShare) await navigator.share({ title: '자산 수령 안내', url });
      else await navigator.clipboard.writeText(url);
      setNotificationMessage(canShare ? '수령 링크를 공유했어요.' : '수령 링크를 복사했어요.');
    } catch (shareError) {
      if (!(shareError instanceof DOMException && shareError.name === 'AbortError')) {
        setNotificationMessage('수령 링크를 공유하지 못했어요. 다시 시도해 주세요.');
      }
    }
  };

  const retryNotification = async (intentId: string) => {
    setNotificationBusy(true);
    setNotificationMessage(null);
    try {
      const delivery = await onRetryPhoneNotification(intentId);
      setResult((current) => current && current.intentId === intentId ? { ...current, delivery: { channel: 'phone', ...delivery } } : current);
      setNotificationMessage(delivery.status === 'sent' ? '수령 안내 문자를 다시 보냈어요.' : '문자 발송 상태를 확인 중이에요. 수령 링크를 공유할 수도 있어요.');
    } catch (retryError) {
      const code = retryError instanceof Error ? retryError.message : '';
      setNotificationMessage(code === 'phone_escrow_sms_rate_limited'
        ? '잠시 뒤 다시 보내 주세요.'
        : code === 'phone_escrow_sms_limit_reached' ? '문자 발송 횟수를 모두 사용했어요. 수령 링크를 공유해 주세요.'
          : '문자를 다시 보내지 못했어요. 수령 링크를 공유해 주세요.');
    } finally { setNotificationBusy(false); }
  };

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
    else if (step === 'own-wallet') setStep('recipient-method');
    else if (step === 'recipient') setStep(recipientMode === 'own-wallet' ? initialOwnDestination ? 'amount' : 'own-wallet' : 'recipient-method');
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
    phoneQuoteRequest.current += 1;
    setPhoneQuote(null);
    setAsset(selected);
    setRecipient('');
    setDestinationTag('');
    setAmount('');
    setAmountMode('krw');
    setRecipientMode('address');
    setOwnDestination(null);
    setPrepared(null);
    setComplianceReason('');
    setStep('amount');
  };

  const selectRecipientMode = (mode: 'address' | 'phone') => {
    const requestId = ++phoneQuoteRequest.current;
    setPhoneQuote(mode === 'phone' ? 'loading' : null);
    setRecipientMode(mode);
    setOwnDestination(null);
    setRecipient('');
    setDestinationTag('');
    setError(null);
    setPrepared(null);
    setComplianceReason('');
    setStep('recipient');
    if (mode === 'phone' && asset && amountAtomic) {
      void onQuotePhoneEscrow({ walletId: wallet.walletId, assetId: asset.assetId, chainId: asset.chainId, amountAtomic })
        .then((quote) => { if (phoneQuoteRequest.current === requestId) setPhoneQuote(quote); })
        .catch(() => { if (phoneQuoteRequest.current === requestId) setPhoneQuote('error'); });
    }
  };

  const chooseOwnDestination = async (walletId: string) => {
    if (!asset || !network) return;
    setLoadingDestinationId(walletId);
    setError(null);
    try {
      const home = await onLoadWalletHome(walletId);
      const destination = ownWalletReceiveDestination(home, asset, network.address);
      if (!destination) throw new Error('own_wallet_destination_unavailable');
      setOwnDestination(destination);
      setRecipientMode('own-wallet');
      setRecipient(destination.address);
      setDestinationTag('');
      setPrepared(null);
      setComplianceReason('');
      setStep('recipient');
    } catch {
      setError('이 지갑에서는 선택한 네트워크의 자산을 받을 수 없어요. 다른 지갑을 선택해 주세요.');
    } finally { setLoadingDestinationId(null); }
  };

  const pickRecipient = async (mode: 'qr' | 'contacts') => {
    if (!asset || recipientPickBusy) return;
    setRecipientPickBusy(true);
    setError(null);
    try {
      const picked = await onRequestRecipientPick(mode, asset.chainId);
      if (picked.status !== 'selected') return;
      if (mode === 'qr' && picked.kind === 'address') {
        const parsed = parseScannedRecipient(picked.value, asset.chainId);
        if (!parsed) throw new Error('invalid_qr_recipient');
        setRecipient(parsed);
      } else if (mode === 'contacts' && picked.kind === 'phone' && isRecipientValid('phone', picked.value, asset.chainId)) {
        setRecipient(picked.value);
      } else throw new Error('invalid_recipient_pick');
      setPrepared(null);
    } catch {
      setError(mode === 'qr' ? '이 네트워크의 지갑 주소 QR을 읽지 못했어요. 주소를 직접 확인해 주세요.' : '연락처의 휴대폰 번호를 사용할 수 없어요. 번호를 직접 확인해 주세요.');
    } finally {
      setRecipientPickBusy(false);
    }
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
        channel: recipientMode === 'own-wallet' ? 'address' : recipientMode,
        ...(recipientMode === 'own-wallet' && ownDestination ? { destinationWalletId: ownDestination.walletId } : {}),
        ...(asset.chainId === 'xrp' && destinationTag ? { destinationTag } : {}),
        ...(complianceReason.trim() ? { complianceReason: complianceReason.trim() } : {}),
      });
      setPrepared(quote);
      setStep('review');
      if (recipientMode !== 'phone' && !complianceReason.trim()
        && (quote.compliance.status === 'review' || quote.compliance.status === 'block')) {
        setRiskDialogMode('notice');
      }
    } catch (caught) {
      setError(transferPreparationErrorMessage(caught, recipientMode, network?.nativeSymbol));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!prepared?.signingRequest || quoteExpired) return;
    setBusy(true);
    setError(null);
    setStep('processing');
    let submissionStarted = false;
    try {
      const signature = await onRequestSecureTransactionSignature(prepared.signingRequest);
      if (signature.status === 'cancelled') {
        setStep('review');
        setError('보내기가 취소됐어요.');
        return;
      }
      if (signature.status === 'wallet-ready') {
        setPrepared(null);
        setStep('amount');
        setError('지갑 보관 확인을 마쳤어요. 최신 보내기 내용을 다시 확인해 주세요.');
        return;
      }
      if (signature.intentId !== prepared.intentId) throw new Error('Transfer intent mismatch.');
      submissionStarted = true;
      const execution = await onSubmitTransfer({
        intentId: prepared.intentId,
        signedTransaction: signature.signedTransaction,
        hostAuthorizationProof: signature.hostAuthorizationProof,
        idempotencyKey: crypto.randomUUID(),
      });
      if (execution.status === 'failed') {
        setStep('review');
        setError('네트워크에서 보내기가 실패했어요. 새 조건으로 다시 확인해 주세요.');
        return;
      }
      setResult(execution);
      setStep('success');
      onTransactionSubmitted(wallet.walletId, ownDestination?.walletId);
    } catch {
      if (submissionStarted) {
        try {
          const activity = await onGetTransferStatus(prepared.intentId);
          if (activity.status === 'processing' || activity.status === 'submitted' || activity.status === 'confirmed') {
            setResult({ intentId: activity.intentId, status: activity.status, ...(activity.transactionHash ? { transactionHash: activity.transactionHash } : {}) });
            setStep('success');
            onTransactionSubmitted(wallet.walletId, ownDestination?.walletId);
            return;
          }
        } catch { /* The status remains unknown; ask the customer to check history. */ }
        setStep('review');
        setError('전송 상태를 확인하고 있어요. 보내기 내역을 확인한 뒤 다시 시도해 주세요.');
      } else {
        setStep('review');
        setError('거래 서명을 완료하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  const reviewBlocked = prepared?.compliance.status === 'block' || prepared?.compliance.status === 'unavailable';
  const riskUnavailable = prepared?.compliance.status === 'unavailable';
  const needsReason = prepared?.compliance.status === 'review' && prepared.compliance.reasonRequired && !prepared.signingRequest;
  const requestExecution = () => {
    if (prepared?.compliance.status === 'review' && !prepared.compliance.reasonRequired) {
      setRiskDialogMode('confirm');
      return;
    }
    void execute();
  };
  const title = step === 'success' ? result?.status === 'confirmed' ? '보내기 완료' : '보내기 접수' : '보내기';

  return (
    <>
      <FlowHeader title={title} canGoBack={step !== 'asset' && step !== 'processing' && step !== 'success'} onBack={back} onClose={() => { if (!busy) onClose(); }} />
      <div className="kw-transfer-scroll">
        {step === 'asset' ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{wallet.label}</p>
            <h2 id="kw-wallet-action-title">어떤 자산을 보낼까요?</h2>
            <p className="kw-transfer-lead">먼저 자산을 선택해 주세요.</p>
            <AssetGroupPicker groups={groups} onSelect={selectGroup} />
          </div>
        ) : step === 'network' && selectedGroup ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{selectedGroup.name} · {selectedGroup.symbol}</p>
            <h2 id="kw-wallet-action-title">어떤 네트워크에서 보낼까요?</h2>
            <p className="kw-transfer-lead">네트워크별 보유 수량과 보내기 지원 상태를 확인해 주세요.</p>
            <AssetNetworkPicker assets={selectedGroup.deployments} purpose="send" onSelect={selectAsset} />
          </div>
        ) : step === 'amount' && asset ? (
          <div className="kw-transfer-page kw-transfer-form-page">
            <p className="kw-transfer-kicker">{asset.network} · {asset.symbol}</p>
            <h2 id="kw-wallet-action-title">얼마를 보낼까요?</h2>
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
            <h2 id="kw-wallet-action-title">어떻게 보낼까요?</h2>
            <p className="kw-transfer-lead">보낼 방법을 선택해 주세요.</p>
            <div className="kw-recipient-methods">
              <button type="button" onClick={() => selectRecipientMode('address')}><span><LinkSimple aria-hidden="true" /></span><strong>지갑 주소로 보내기</strong><small>받는 분의 {asset.network} 주소로 보내요.</small><CaretRight aria-hidden="true" /></button>
              <button type="button" disabled={asset.phoneTransferStatus !== 'enabled'} onClick={() => selectRecipientMode('phone')}><span><DeviceMobile aria-hidden="true" /></span><strong>휴대폰 번호로 보내기</strong><small>{asset.phoneTransferStatus === 'enabled' ? '에스크로에 예치하고 안전한 수령 링크를 보내요.' : asset.phoneTransferUnavailableReason ?? '이 네트워크에서는 아직 이용할 수 없어요.'}</small><CaretRight aria-hidden="true" /></button>
              <button type="button" onClick={() => { setError(null); setStep('own-wallet'); }}><span><Wallet aria-hidden="true" /></span><strong>내 지갑으로 보내기</strong><small>나의 다른 지갑으로 편리하게 보내요.</small><CaretRight aria-hidden="true" /></button>
            </div>
          </div>
        ) : step === 'own-wallet' && asset ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{asset.network} · {asset.symbol}</p>
            <h2 id="kw-wallet-action-title">어느 내 지갑으로 보낼까요?</h2>
            <p className="kw-transfer-lead">같은 네트워크의 받을 주소를 확인해 연결해요.</p>
            <div className="kw-transfer-choice-list">
              {wallets.filter((candidate) => candidate.walletId !== wallet.walletId).map((candidate) => (
                <button className="kw-transfer-choice" type="button" key={candidate.walletId} disabled={loadingDestinationId !== null}
                  onClick={() => void chooseOwnDestination(candidate.walletId)}>
                  <Wallet className="kw-transfer-asset-mark" aria-hidden="true" />
                  <span><strong>{candidate.label}</strong><small>{loadingDestinationId === candidate.walletId ? '받는 주소를 확인하고 있어요' : '내 지갑'}</small></span>
                  <CaretRight aria-hidden="true" />
                </button>
              ))}
            </div>
            {wallets.length < 2 ? <p className="kw-transfer-lead">다른 지갑을 추가하면 내 지갑으로 보낼 수 있어요.</p> : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'recipient' && asset ? (
          <div className="kw-transfer-page kw-transfer-form-page">
            <p className="kw-transfer-kicker">{asset.network} · {asset.symbol}</p>
            <h2 id="kw-wallet-action-title">{recipientMode === 'own-wallet' ? '받는 내 지갑을 확인해 주세요' : recipientMode === 'address' ? '받는 주소를 입력해 주세요' : '받는 분의 번호를 입력해 주세요'}</h2>
            {recipientMode === 'own-wallet' && ownDestination ? <div className="kw-own-wallet-destination">
              <Wallet aria-hidden="true" /><span><strong>{ownDestination.label}</strong><small>{asset.network} · {abbreviatedAddress(ownDestination.address)}</small></span>
              <button type="button" onClick={() => setStep('own-wallet')}>변경</button>
            </div> : <label className="kw-transfer-field">
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
                onChange={(event) => { setRecipient(event.target.value); setComplianceReason(''); setPrepared(null); }}
              />
            </label>}
            {recipientMode === 'address' && hostCapabilities.canScanQr ? (
              <div className="kw-recipient-tools"><button type="button" disabled={recipientPickBusy} onClick={() => void pickRecipient('qr')}><QrCode aria-hidden="true" />QR로 주소 입력</button></div>
            ) : null}
            {recipientMode === 'phone' && hostCapabilities.canUseContacts ? (
              <div className="kw-recipient-tools"><button type="button" disabled={recipientPickBusy} onClick={() => void pickRecipient('contacts')}><AddressBook aria-hidden="true" />연락처에서 선택</button></div>
            ) : null}
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
            <p className="kw-transfer-field-hint">{recipientMode === 'own-wallet' ? '선택한 내 지갑의 받는 주소로 보내요. 네트워크와 수량을 다시 확인해 주세요.' : recipientMode === 'address' ? '네트워크가 다르면 자산을 찾기 어려울 수 있어요.' : '상대방은 수령 안내를 받고 본인 확인 후 자산을 받아요.'}</p>
            {recipientMode === 'address' && asset.chainId === 'xrp' ? <p className="kw-transfer-field-hint">거래소가 목적지 태그를 안내했다면 반드시 함께 입력해 주세요.</p> : null}
            {recipientMode === 'phone' ? <div className="kw-transfer-bridge-notice"><ShieldCheck aria-hidden="true" /><span><strong>받는 분이 확인한 뒤 수령해요.</strong>보낸 자산은 7일 동안 에스크로에 안전하게 보관되고, 기간 안에 받지 않으면 환불할 수 있어요.</span></div> : null}
            {recipientMode === 'phone' && phoneQuote === 'loading' ? <p className="kw-transfer-field-hint" role="status">수령 수수료를 확인하고 있어요.</p> : null}
            {recipientMode === 'phone' && phoneQuote === 'error' ? <p className="kw-transfer-field-hint" role="status">수수료 미리보기를 불러오지 못했어요. 다음 단계에서 다시 확인해요.</p> : null}
            {recipientMode === 'phone' && phoneQuote && typeof phoneQuote === 'object' ? (
              <div className="kw-phone-quote" aria-label="휴대폰 송금 예상 금액">
                <p><span>받는 금액</span><strong>{formatAtomic(BigInt(phoneQuote.recipientAmountAtomic), asset.decimals, asset.decimals)} {asset.symbol}</strong></p>
                <p><span>수령 수수료</span><strong>{formatAtomic(BigInt(phoneQuote.claimFeeAtomic), asset.decimals, asset.decimals)} {asset.symbol}</strong></p>
                <p><span>예상 차감액</span><strong>{formatAtomic(BigInt(phoneQuote.escrowAmountAtomic), asset.decimals, asset.decimals)} {asset.symbol}</strong></p>
                {amountAtomic && BigInt(amountAtomic) > BigInt(phoneQuote.maximumRecipientAtomic) ? (
                  <div className="kw-phone-quote__limit" role="alert">
                    <span>수수료를 포함하면 보유 금액이나 1회 한도를 넘어요. 최대 {formatAtomic(BigInt(phoneQuote.maximumRecipientAtomic), asset.decimals, asset.decimals)} {asset.symbol}까지 보낼 수 있어요.</span>
                    <button type="button" onClick={() => { setAmountMode('token'); setAmount(formatAtomic(BigInt(phoneQuote.maximumRecipientAtomic), asset.decimals, asset.decimals)); setStep('amount'); }}>금액 조정</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {recipient.length > 0 && !recipientValid ? <p className="kw-transfer-error" role="alert">{recipientMode === 'phone' ? '휴대폰 번호를 다시 확인해 주세요.' : '받는 주소 형식을 다시 확인해 주세요.'}</p> : null}
            {!destinationTagValid ? <p className="kw-transfer-error" role="alert">목적지 태그는 0부터 4,294,967,295 사이의 숫자로 입력해 주세요.</p> : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'review' && asset && prepared ? (
          <div className="kw-transfer-page kw-transfer-review-page">
            <p className="kw-transfer-kicker">최종 확인</p>
            <h2 id="kw-wallet-action-title">보내기 전에 확인해 주세요</h2>
            <div className="kw-transfer-hero-amount">
              <strong>{prepared.amountDisplay} {prepared.assetSymbol}</strong>
              <span>{prepared.fiatDisplay ?? '원화 환산 정보 없음'}</span>
            </div>
            <dl className="kw-transfer-review-list">
              {ownDestination ? <div><dt>받는 내 지갑</dt><dd>{ownDestination.label}</dd></div> : null}
              <div><dt>{prepared.channel === 'phone' ? '받는 분' : '받는 주소'}</dt><dd>{prepared.channel === 'phone' ? prepared.recipient : abbreviatedAddress(prepared.recipient)}</dd></div>
              {prepared.destinationTag !== undefined ? <div><dt>목적지 태그</dt><dd>{prepared.destinationTag}</dd></div> : null}
              <div><dt>네트워크</dt><dd>{prepared.network}</dd></div>
              <div><dt>{prepared.networkFee.maximum ? '최대 네트워크 수수료' : '네트워크 수수료'}</dt><dd>{prepared.networkFee.amountDisplay} {prepared.networkFee.symbol}{prepared.networkFee.fiatDisplay ? <small>{prepared.networkFee.fiatDisplay}</small> : null}</dd></div>
              {prepared.gasSponsorship.status === 'sponsored' && prepared.gasSponsorship.tokenFeeDisplay ? (
                <>
                  <div><dt>릴레이 수수료</dt><dd>{prepared.gasSponsorship.tokenFeeDisplay} {prepared.assetSymbol}</dd></div>
                  <div><dt>총 차감</dt><dd>{prepared.gasSponsorship.totalDebitDisplay} {prepared.assetSymbol}</dd></div>
                </>
              ) : null}
              {prepared.phoneEscrow ? <div><dt>수령 수수료</dt><dd>{prepared.phoneEscrow.claimFeeDisplay} {prepared.assetSymbol}<small>받는 금액은 {prepared.phoneEscrow.recipientAmountDisplay} {prepared.assetSymbol}</small></dd></div> : null}
              {prepared.phoneEscrow ? <div><dt>에스크로 예치</dt><dd>{prepared.phoneEscrow.escrowAmountDisplay} {prepared.assetSymbol}<small>{new Date(prepared.phoneEscrow.expiresAt).toLocaleDateString('ko-KR')}까지 수령</small></dd></div> : null}
              <div><dt>수수료 부담</dt><dd><button type="button" onClick={() => setGasDialogOpen(true)}>{prepared.gasSponsorship.status === 'sponsored' ? '서비스 부담 · 적용됨' : '고객 부담 · 상세 보기'}<CaretRight aria-hidden="true" /></button></dd></div>
              <div><dt>견적 유효시간</dt><dd>{quoteExpired ? '만료됨' : `${new Date(prepared.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}까지`}</dd></div>
            </dl>
            <div className={`kw-compliance-card kw-compliance-card--${prepared.compliance.status}`}>
              {reviewBlocked ? <WarningCircle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              <div><strong>{prepared.compliance.status === 'allow' ? prepared.destinationWalletId ? '내 지갑 확인 완료' : prepared.channel === 'phone' ? '수령 절차 확인 완료' : '주소 확인 완료' : prepared.compliance.status === 'review' ? '추가 확인이 필요해요' : prepared.compliance.status === 'unavailable' ? '주소 위험도를 확인하지 못했어요' : '보낼 수 없는 주소예요'}</strong><p>{prepared.compliance.message}</p>{prepared.compliance.status === 'unavailable' && prepared.compliance.traceId ? <small>문의 코드 {prepared.compliance.traceId}</small> : null}<KytRiskDetails compliance={prepared.compliance} /></div>
            </div>
            {needsReason ? (
              <label className="kw-transfer-reason">
                <span>보내는 이유</span>
                <textarea value={complianceReason} maxLength={200} placeholder="5자 이상 입력해 주세요" onChange={(event) => setComplianceReason(event.target.value)} />
              </label>
            ) : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'processing' ? (
          <div className="kw-transfer-page kw-transfer-success" role="status">
            <span className="kw-flow-spinner" aria-hidden="true" />
            <h2 id="kw-wallet-action-title">보내기를 처리하고 있어요</h2>
            <p>전송 상태를 확인하고 있어요. 잠시만 기다려 주세요.</p>
          </div>
        ) : step === 'success' && asset && result ? (
          <div className="kw-transfer-page kw-transfer-success">
            <CheckCircle aria-hidden="true" />
            <h2 id="kw-wallet-action-title">{result.delivery?.status === 'sent' ? '수령 안내를 보냈어요' : result.status === 'confirmed' ? '보내기를 완료했어요' : '보내기를 접수했어요'}</h2>
            <p>{result.delivery?.status === 'sent' ? `${result.delivery.recipientDisplay} 번호로 수령 링크를 보냈어요.` : result.delivery?.status === 'failed' ? '자산 예치는 완료됐지만 수령 안내 발송을 다시 확인해야 해요.' : result.status === 'confirmed' ? '네트워크에서 거래가 확인됐어요.' : result.status === 'processing' ? '전송을 처리하고 있어요. 보내기 내역에서 상태를 확인할 수 있어요.' : '네트워크에서 거래를 확인하고 있어요.'}</p>
            <div><span>보낸 금액</span><strong>{prepared?.amountDisplay} {asset.symbol}</strong></div>
            {result.delivery?.claimUrl ? <section className="kw-phone-claim-share" aria-label="수령 안내">
              <p>{result.delivery.status === 'sent' ? '수령 안내 문자를 보냈어요.' : '문자 발송을 확인하지 못했어요. 링크를 직접 공유할 수 있어요.'}</p>
              <button type="button" onClick={() => void shareClaimLink(result.delivery!.claimUrl!)}><ShareNetwork aria-hidden="true" />수령 링크 공유</button>
              {result.delivery.status !== 'sent' ? <button type="button" disabled={notificationBusy} onClick={() => void retryNotification(result.intentId)}>{notificationBusy ? '확인 중이에요' : '안내 문자 다시 보내기'}</button> : null}
              {notificationMessage ? <small role="status">{notificationMessage}</small> : null}
            </section> : null}
            {result.transactionHash ? <button type="button" onClick={() => void navigator.clipboard.writeText(result.transactionHash!)}>거래 해시 복사</button> : null}
          </div>
        ) : null}
      </div>
      {step === 'amount' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={!validAmount} onClick={() => setStep(ownDestination ? 'recipient' : 'recipient-method')}>{asset?.balanceStatus === 'unavailable' ? '잔액 확인이 필요해요' : available <= 0n ? '보낼 잔액이 없어요' : '다음'}</button></footer>
      ) : step === 'recipient' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={!recipientValid || !destinationTagValid || busy || Boolean(recipientMode === 'phone' && phoneQuote && typeof phoneQuote === 'object' && amountAtomic !== null && BigInt(amountAtomic) > BigInt(phoneQuote.maximumRecipientAtomic))} aria-busy={busy} onClick={() => void prepare()}>{busy ? <BusyButtonLabel>확인하고 있어요</BusyButtonLabel> : recipientMode === 'phone' ? '에스크로 조건 확인' : '보내기 조건 확인'}</button></footer>
      ) : step === 'review' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={busy || (!quoteExpired && (prepared?.compliance.status === 'block' || (Boolean(needsReason) && complianceReason.trim().length < 5)))} aria-busy={busy} onClick={() => quoteExpired || needsReason || riskUnavailable ? void prepare() : requestExecution()}>{busy ? <BusyButtonLabel>처리하고 있어요</BusyButtonLabel> : quoteExpired ? '견적 다시 확인' : needsReason || riskUnavailable ? '위험도 다시 확인' : '인증하고 보내기'}</button></footer>
      ) : step === 'success' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" onClick={onClose}>확인</button></footer>
      ) : null}
      {gasDialogOpen && prepared ? <GasSupportDialog quote={prepared.gasSponsorship} onClose={() => setGasDialogOpen(false)} /> : null}
      {riskDialogMode && prepared ? (
        <TransferRiskDialog
          compliance={prepared.compliance}
          onCancel={() => setRiskDialogMode(null)}
          {...(riskDialogMode === 'confirm' ? { onConfirm: () => {
            setRiskDialogMode(null);
            void execute();
          } } : {})}
        />
      ) : null}
      {network && network.addressStatus !== 'ready' ? <span className="kw-sr-only">선택한 네트워크 주소를 사용할 수 없습니다.</span> : null}
    </>
  );
}

type ExchangeStep = 'network' | 'amount' | 'asset' | 'review' | 'success';
type ExchangeSide = 'sell' | 'buy';

function exchangePair(assets: WalletReceiveAssetView[]): [WalletReceiveAssetView | undefined, WalletReceiveAssetView | undefined] {
  const enabled = assets.filter((asset) => asset.transferStatus === 'enabled' && asset.balanceStatus !== 'unavailable');
  const sell = enabled.find((asset) => safeBigInt(asset.availableAtomic) > 0n)
    ?? enabled.find((asset) => !asset.tokenAddress)
    ?? enabled[0];
  const buy = enabled.find((asset) => asset.assetId !== sell?.assetId && asset.symbol === 'USDC')
    ?? enabled.find((asset) => asset.assetId !== sell?.assetId);
  return [sell, buy];
}

function exchangeQuoteErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'exchange_provider_not_configured') {
    return '환전 서비스 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요.';
  }
  if (code === 'exchange_liquidity_unavailable') {
    return '현재 이 자산 조합은 환전 가능한 수량이 부족해요. 금액이나 자산을 바꿔 주세요.';
  }
  if (code === 'exchange_quote_unavailable') {
    return '환전 시세를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return '현재 이 조건으로 환전 경로를 찾지 못했어요. 금액이나 자산을 바꿔 주세요.';
}

function quoteInputValue(quote: ExchangeQuote | null, side: ExchangeSide, mode: AmountInputMode): string {
  const asset = side === 'sell' ? quote?.sell : quote?.buy;
  if (!asset) return '';
  if (mode === 'token') return asset.amountDisplay;
  return asset.fiatDisplay?.replace(/[^\d]/g, '') ?? '';
}

function ExchangeAssetPicker({
  assets,
  excludedAssetId,
  onSelect,
}: {
  assets: WalletReceiveAssetView[];
  excludedAssetId?: string;
  onSelect: (asset: WalletReceiveAssetView) => void;
}) {
  return (
    <div className="kw-transfer-choice-list">
      {assets.filter((asset) => asset.assetId !== excludedAssetId).map((asset) => (
        <button className="kw-transfer-choice" type="button" key={asset.assetId} onClick={() => onSelect(asset)}>
          <AssetIcon className="kw-transfer-asset-mark" symbol={asset.symbol} iconAssetId={asset.iconAssetId} />
          <span>
            <strong>{asset.name}</strong>
            <small>{asset.symbol} · {asset.network}</small>
          </span>
          <span className="kw-transfer-choice__balance">
            <strong>{asset.balanceDisplay} {asset.symbol}</strong>
            <small>{asset.referencePrice?.stale ? '원화 시세 업데이트 필요' : asset.referencePrice?.display ?? '원화 시세 없음'}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function ExchangeAmountCard({
  side,
  asset,
  value,
  unit,
  active,
  secondary,
  onActivate,
  onChange,
  onChooseAsset,
  onToggleUnit,
}: {
  side: ExchangeSide;
  asset: WalletReceiveAssetView;
  value: string;
  unit: AmountInputMode;
  active: boolean;
  secondary: string;
  onActivate: () => void;
  onChange: (value: string) => void;
  onChooseAsset: () => void;
  onToggleUnit: () => void;
}) {
  const label = side === 'sell' ? '보낼 자산' : '받을 자산';
  return (
    <section className={`kw-exchange-card${active ? ' kw-exchange-card--active' : ''}`} aria-label={label}>
      <div className="kw-exchange-card__header">
        <button type="button" className="kw-exchange-asset-button" onClick={onChooseAsset}>
          <AssetIcon className="kw-exchange-asset-icon" symbol={asset.symbol} iconAssetId={asset.iconAssetId} />
          <span><small>{label}</small><strong>{asset.symbol}</strong></span>
          <CaretRight aria-hidden="true" />
        </button>
        <span className="kw-exchange-balance">보유 {asset.balanceDisplay} {asset.symbol}</span>
      </div>
      <label className="kw-exchange-input">
        <span className="kw-sr-only">{label} {unit === 'krw' ? '원화' : asset.symbol} 금액</span>
        <input
          inputMode={unit === 'krw' ? 'numeric' : 'decimal'}
          value={value}
          placeholder="0"
          onFocus={onActivate}
          onChange={(event) => onChange(unit === 'krw'
            ? event.target.value.replace(/\D/g, '')
            : event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
        />
        <b>{unit === 'krw' ? '원' : asset.symbol}</b>
      </label>
      <div className="kw-exchange-card__footer">
        <small>{secondary}</small>
        <button type="button" onClick={onToggleUnit}><ArrowsLeftRight aria-hidden="true" />{unit === 'krw' ? `${asset.symbol}로 입력` : '원화로 입력'}</button>
      </div>
    </section>
  );
}

function ExchangeFlow({
  wallet,
  receiveAssets,
  networks,
  initialChainId,
  onRequestExchangeQuote,
  onPrepareExchange,
  onRequestSecureTransactionSignature,
  onSubmitExchange,
  onGetExchangeStatus,
  onTransactionSubmitted,
  onClose,
}: WalletActionSheetProps) {
  const eligibleNetworks = useMemo(() => networks.filter((network) => (
    EVM_EXCHANGE_CHAINS.has(network.chainId)
    && network.addressStatus === 'ready'
    && receiveAssets.filter((asset) => asset.chainId === network.chainId && asset.transferStatus === 'enabled').length >= 2
  )), [networks, receiveAssets]);
  const initialNetwork = eligibleNetworks.find((network) => network.chainId === initialChainId);
  const initialAssets = receiveAssets.filter((asset) => asset.chainId === initialNetwork?.chainId);
  const [initialSell, initialBuy] = exchangePair(initialAssets);
  const [step, setStep] = useState<ExchangeStep>(initialNetwork && initialSell && initialBuy ? 'amount' : 'network');
  const [network, setNetwork] = useState<WalletNetworkView | undefined>(initialNetwork);
  const [sellAsset, setSellAsset] = useState<WalletReceiveAssetView | undefined>(initialSell);
  const [buyAsset, setBuyAsset] = useState<WalletReceiveAssetView | undefined>(initialBuy);
  const [assetSide, setAssetSide] = useState<ExchangeSide>('sell');
  const [activeSide, setActiveSide] = useState<ExchangeSide>('sell');
  const [units, setUnits] = useState<Record<ExchangeSide, AmountInputMode>>({ sell: 'krw', buy: 'krw' });
  const [inputs, setInputs] = useState<Record<ExchangeSide, string>>({ sell: '', buy: '' });
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [prepared, setPrepared] = useState<PreparedExchange | null>(null);
  const [result, setResult] = useState<ExchangeExecutionResult | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const quoteSequence = useRef(0);
  const exchangeSubmission = useRef<SubmitExchangeRequest | null>(null);
  const chainAssets = useMemo(() => receiveAssets.filter((asset) => (
    asset.chainId === network?.chainId && asset.transferStatus === 'enabled' && asset.balanceStatus !== 'unavailable'
  )), [network?.chainId, receiveAssets]);
  const activeAsset = activeSide === 'sell' ? sellAsset : buyAsset;
  const activeInput = inputs[activeSide];
  const activeAtomic = activeAsset
    ? units[activeSide] === 'krw'
      ? parseKrwToAtomic(activeInput, activeAsset.referencePrice?.stale ? undefined : activeAsset.referencePrice?.decimal, activeAsset.decimals)
      : parseAmountToAtomic(activeInput, activeAsset.decimals)
    : null;
  const quoteExpired = quote ? clock >= Date.parse(quote.expiresAt) : false;
  const reviewExpired = prepared ? clock >= Date.parse(prepared.expiresAt) : false;

  useEffect(() => {
    if (!quote && !prepared) return undefined;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [prepared, quote]);

  useEffect(() => {
    if (step !== 'success' || !result || result.status === 'confirmed' || result.status === 'failed' || result.status === 'allowance-confirmed') return undefined;
    let active = true;
    const poll = () => {
      void onGetExchangeStatus(result.intentId).then((next) => {
        if (active) setResult(next);
      }).catch(() => undefined);
    };
    poll();
    const interval = window.setInterval(poll, 8_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [onGetExchangeStatus, result?.intentId, result?.status, step]);

  useEffect(() => {
    const sequence = ++quoteSequence.current;
    if (step !== 'amount' || !network || !sellAsset || !buyAsset || !activeAtomic) {
      setQuote(null);
      setQuoteStatus('idle');
      return undefined;
    }
    setQuote(null);
    setQuoteStatus('loading');
    setError(null);
    const timeout = window.setTimeout(() => {
      void onRequestExchangeQuote({
        walletId: wallet.walletId,
        chainId: network.chainId,
        sellAssetId: sellAsset.assetId,
        buyAssetId: buyAsset.assetId,
        mode: activeSide === 'sell' ? 'exact-in' : 'exact-out',
        amountAtomic: activeAtomic,
      }).then((nextQuote) => {
        if (quoteSequence.current !== sequence) return;
        setQuote(nextQuote);
        setQuoteStatus('ready');
      }).catch((quoteError: unknown) => {
        if (quoteSequence.current !== sequence) return;
        setQuoteStatus('error');
        setError(exchangeQuoteErrorMessage(quoteError));
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [activeAtomic, activeSide, buyAsset, network, onRequestExchangeQuote, sellAsset, step, wallet.walletId]);

  const chooseNetwork = (selected: WalletNetworkView) => {
    const [nextSell, nextBuy] = exchangePair(receiveAssets.filter((asset) => asset.chainId === selected.chainId));
    setNetwork(selected);
    setSellAsset(nextSell);
    setBuyAsset(nextBuy);
    setInputs({ sell: '', buy: '' });
    setQuote(null);
    setError(nextSell && nextBuy ? null : '이 네트워크에서 환전할 수 있는 자산 조합이 아직 없어요.');
    setStep('amount');
  };

  const back = () => {
    setError(null);
    if (step === 'asset') setStep('amount');
    else if (step === 'amount') {
      setQuote(null);
      setStep('network');
    } else if (step === 'review') {
      setPrepared(null);
      setStep('amount');
    } else onClose();
  };

  const activate = (side: ExchangeSide) => {
    if (side === activeSide) return;
    quoteSequence.current += 1;
    setActiveSide(side);
    setInputs((current) => ({ ...current, [side]: '' }));
    setQuote(null);
    setQuoteStatus('idle');
    setError(null);
  };

  const updateAmount = (side: ExchangeSide, value: string) => {
    if (side !== activeSide) setActiveSide(side);
    quoteSequence.current += 1;
    setInputs((current) => ({ ...current, [side]: value }));
    setQuote(null);
    setQuoteStatus(value ? 'loading' : 'idle');
    setError(null);
  };

  const toggleUnit = (side: ExchangeSide) => {
    quoteSequence.current += 1;
    setActiveSide(side);
    setUnits((current) => ({ ...current, [side]: current[side] === 'krw' ? 'token' : 'krw' }));
    setInputs((current) => ({ ...current, [side]: '' }));
    setQuote(null);
    setQuoteStatus('idle');
    setError(null);
  };

  const openAssetPicker = (side: ExchangeSide) => {
    setAssetSide(side);
    setStep('asset');
  };

  const chooseAsset = (asset: WalletReceiveAssetView) => {
    if (assetSide === 'sell') setSellAsset(asset);
    else setBuyAsset(asset);
    quoteSequence.current += 1;
    setActiveSide(assetSide);
    setInputs({ sell: '', buy: '' });
    setQuote(null);
    setQuoteStatus('idle');
    setError(null);
    setStep('amount');
  };

  const reversePair = () => {
    if (!sellAsset || !buyAsset) return;
    setSellAsset(buyAsset);
    setBuyAsset(sellAsset);
    setActiveSide('sell');
    setInputs({ sell: '', buy: '' });
    setQuote(null);
    setQuoteStatus('idle');
    setError(null);
  };

  const prepare = async () => {
    if (!quote || quoteExpired || !quote.balanceSufficient) return;
    setBusy(true);
    setError(null);
    try {
      const nextPrepared = await onPrepareExchange({ quoteId: quote.quoteId });
      setPrepared(nextPrepared);
      setStep('review');
    } catch {
      setQuote(null);
      setQuoteStatus('idle');
      setError('환전 정보를 다시 확인해 주세요. 시세가 바뀌었거나 견적 시간이 지났을 수 있어요.');
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!prepared || reviewExpired) return;
    setBusy(true);
    setError(null);
    try {
      if (!exchangeSubmission.current) {
        const signature = await onRequestSecureTransactionSignature(prepared.signingRequest);
        if (signature.status === 'cancelled') {
          setError('환전이 취소됐어요.');
          return;
        }
        if (signature.status === 'wallet-ready') {
          setPrepared(null);
          setQuote(null);
          setStep('amount');
          setError('지갑 보관 확인을 마쳤어요. 시세를 다시 확인해 주세요.');
          return;
        }
        if (signature.intentId !== prepared.intentId) throw new Error('Exchange intent mismatch.');
        exchangeSubmission.current = {
          intentId: prepared.intentId,
          signedTransaction: signature.signedTransaction,
          hostAuthorizationProof: signature.hostAuthorizationProof,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      const execution = await onSubmitExchange(exchangeSubmission.current);
      setResult(execution);
      setStep('success');
      onTransactionSubmitted(wallet.walletId);
    } catch {
      if (exchangeSubmission.current) {
        try {
          const status = await onGetExchangeStatus(prepared.intentId);
          setResult(status);
          setStep('success');
          onTransactionSubmitted(wallet.walletId);
          return;
        } catch { /* No durable submission is visible yet. */ }
      }
      setError('환전 거래 상태를 확인하지 못했어요. 잠시 후 같은 거래로 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const continueAfterAllowance = async () => {
    if (!prepared || prepared.stage !== 'allowance' || !network) return;
    setBusy(true);
    setError(null);
    try {
      const nextQuote = await onRequestExchangeQuote({
        walletId: wallet.walletId,
        chainId: prepared.chainId,
        sellAssetId: prepared.sell.assetId,
        buyAssetId: prepared.buy.assetId,
        mode: prepared.mode,
        amountAtomic: prepared.mode === 'exact-in' ? prepared.sell.amountAtomic : prepared.buy.amountAtomic,
      });
      if (!nextQuote.balanceSufficient) throw new Error('insufficient_exchange_balance');
      if (nextQuote.allowanceRequired) throw new Error('exchange_allowance_still_required');
      const nextPrepared = await onPrepareExchange({ quoteId: nextQuote.quoteId });
      if (nextPrepared.stage !== 'swap') throw new Error('exchange_allowance_still_required');
      exchangeSubmission.current = null;
      setResult(null);
      setQuote(nextQuote);
      setPrepared(nextPrepared);
      setStep('review');
    } catch {
      setPrepared(null);
      setResult(null);
      setQuote(null);
      setStep('amount');
      setError('토큰 승인은 완료됐어요. 현재 시세와 잔액을 다시 확인한 뒤 환전을 진행해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const sellValue = activeSide === 'sell' ? inputs.sell : quoteInputValue(quote, 'sell', units.sell);
  const buyValue = activeSide === 'buy' ? inputs.buy : quoteInputValue(quote, 'buy', units.buy);
  const sellSecondary = quote
    ? units.sell === 'krw' ? `${quote.sell.amountDisplay} ${quote.sell.symbol}` : quote.sell.fiatDisplay ?? '원화 환산 정보 없음'
    : units.sell === 'krw' ? '원화 기준으로 입력해 주세요.' : '자산 수량을 입력해 주세요.';
  const buySecondary = quote
    ? units.buy === 'krw' ? `${quote.buy.amountDisplay} ${quote.buy.symbol}` : quote.buy.fiatDisplay ?? '원화 환산 정보 없음'
    : activeSide === 'buy' ? units.buy === 'krw' ? '받고 싶은 원화 금액을 입력해 주세요.' : '받고 싶은 수량을 입력해 주세요.' : '예상 수령 금액이 표시돼요.';
  const title = step === 'success' ? '환전 접수' : '환전하기';

  return (
    <>
      <FlowHeader title={title} canGoBack={step !== 'network' && step !== 'success'} onBack={back} onClose={onClose} />
      <div className="kw-transfer-scroll">
        {step === 'network' ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{wallet.label}</p>
            <h2 id="kw-wallet-action-title">어떤 네트워크에서 환전할까요?</h2>
            <p className="kw-transfer-lead">같은 네트워크 안에서 자산을 바로 바꿀 수 있어요.</p>
            <NetworkPicker networks={eligibleNetworks} onSelect={chooseNetwork} />
            {eligibleNetworks.length === 0 ? <p className="kw-transfer-error" role="alert">현재 환전 가능한 네트워크가 없어요.</p> : null}
          </div>
        ) : step === 'asset' && network ? (
          <div className="kw-transfer-page">
            <p className="kw-transfer-kicker">{network.network}</p>
            <h2 id="kw-wallet-action-title">{assetSide === 'sell' ? '보낼 자산을 선택해 주세요' : '받을 자산을 선택해 주세요'}</h2>
            <p className="kw-transfer-lead">같은 네트워크의 지원 자산만 표시해요.</p>
            <ExchangeAssetPicker
              assets={chainAssets}
              excludedAssetId={assetSide === 'sell' ? buyAsset?.assetId : sellAsset?.assetId}
              onSelect={chooseAsset}
            />
          </div>
        ) : step === 'amount' && network && sellAsset && buyAsset ? (
          <div className="kw-transfer-page kw-exchange-page">
            <p className="kw-transfer-kicker">{network.network}</p>
            <h2 id="kw-wallet-action-title">얼마나 환전할까요?</h2>
            <p className="kw-transfer-lead">보내거나 받을 금액 중 편한 쪽을 입력해 주세요.</p>
            <div className="kw-exchange-stack">
              <ExchangeAmountCard
                side="sell"
                asset={sellAsset}
                value={sellValue}
                unit={units.sell}
                active={activeSide === 'sell'}
                secondary={sellSecondary}
                onActivate={() => activate('sell')}
                onChange={(value) => updateAmount('sell', value)}
                onChooseAsset={() => openAssetPicker('sell')}
                onToggleUnit={() => toggleUnit('sell')}
              />
              <button className="kw-exchange-reverse" type="button" aria-label="보낼 자산과 받을 자산 바꾸기" onClick={reversePair}><ArrowsDownUp aria-hidden="true" /></button>
              <ExchangeAmountCard
                side="buy"
                asset={buyAsset}
                value={buyValue}
                unit={units.buy}
                active={activeSide === 'buy'}
                secondary={buySecondary}
                onActivate={() => activate('buy')}
                onChange={(value) => updateAmount('buy', value)}
                onChooseAsset={() => openAssetPicker('buy')}
                onToggleUnit={() => toggleUnit('buy')}
              />
            </div>
            {quote ? (
              <dl className="kw-exchange-summary" aria-live="polite">
                <div><dt>적용 환율</dt><dd>{quote.rateDisplay}</dd></div>
                <div><dt>{quote.mode === 'exact-in' ? '최소 받을 수량' : '최대 보낼 수량'}</dt><dd>{quote.mode === 'exact-in' && quote.minimumBuyAmountAtomic
                  ? `${formatAtomic(BigInt(quote.minimumBuyAmountAtomic), quote.buy.decimals)} ${quote.buy.symbol}`
                  : quote.maximumSellAmountAtomic
                    ? `${formatAtomic(BigInt(quote.maximumSellAmountAtomic), quote.sell.decimals)} ${quote.sell.symbol}`
                    : '견적에 포함'}</dd></div>
                <div><dt>예상 네트워크 수수료</dt><dd>최대 {quote.networkFee.amountDisplay} {quote.networkFee.symbol}</dd></div>
              </dl>
            ) : null}
            {quoteStatus === 'loading' ? (
              <p className="kw-exchange-status" role="status">
                <span className="kw-exchange-spinner" aria-hidden="true" />
                가장 유리한 환전 경로를 찾고 있어요.
              </p>
            ) : null}
            {quoteExpired ? <p className="kw-transfer-error" role="alert">환전 정보가 바뀌었어요. 금액을 다시 입력해 주세요.</p> : null}
            {quote && !quote.balanceSufficient ? <div className="kw-transfer-zero-notice"><Wallet aria-hidden="true" /><span><strong>보낼 수 있는 잔액이 부족해요.</strong>입력 화면과 예상 수령량은 확인할 수 있지만 환전은 실행되지 않아요.</span></div> : null}
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'review' && prepared ? (
          <div className="kw-transfer-page kw-transfer-review-page">
            <p className="kw-transfer-kicker">최종 확인</p>
            <h2 id="kw-wallet-action-title">{prepared.stage === 'allowance' ? '토큰 사용을 승인해 주세요' : '환전하기 전에 확인해 주세요'}</h2>
            <div className="kw-exchange-review-hero">
              <span>{prepared.sell.amountDisplay} {prepared.sell.symbol}</span>
              <ArrowsDownUp aria-hidden="true" />
              <strong>{prepared.buy.amountDisplay} {prepared.buy.symbol}</strong>
              <small>{prepared.buy.fiatDisplay ?? '원화 환산 정보 없음'}</small>
            </div>
            <dl className="kw-transfer-review-list">
              <div><dt>네트워크</dt><dd>{prepared.network}</dd></div>
              {prepared.stage === 'swap' ? <div><dt>적용 환율</dt><dd>{prepared.rateDisplay}</dd></div> : null}
              {prepared.stage === 'swap' ? <div><dt>{prepared.mode === 'exact-in' ? '최소 받을 수량' : '최대 보낼 수량'}</dt><dd>{prepared.mode === 'exact-in' && prepared.minimumBuyAmountAtomic
                ? `${formatAtomic(BigInt(prepared.minimumBuyAmountAtomic), prepared.buy.decimals)} ${prepared.buy.symbol}`
                : prepared.maximumSellAmountAtomic
                  ? `${formatAtomic(BigInt(prepared.maximumSellAmountAtomic), prepared.sell.decimals)} ${prepared.sell.symbol}`
                  : '견적에 포함'}</dd></div> : null}
              <div><dt>네트워크 수수료</dt><dd>최대 {prepared.networkFee.amountDisplay} {prepared.networkFee.symbol}<small>{prepared.networkFee.fiatDisplay ?? '원화 환산 정보 없음'}</small></dd></div>
              <div><dt>견적 유효시간</dt><dd>{reviewExpired ? '만료됨' : `${new Date(prepared.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}까지`}</dd></div>
            </dl>
            <div className="kw-transfer-warning"><ShieldCheck aria-hidden="true" /><span>{prepared.stage === 'allowance' ? '토큰 사용 승인 뒤 새 환전 견적을 확인하고, 환전 거래에 별도로 서명해요.' : '표시된 자산과 수량으로만 기기 서명이 진행돼요. 환전 결과는 네트워크에서 확인한 뒤 반영됩니다.'}</span></div>
            {error ? <p className="kw-transfer-error" role="alert">{error}</p> : null}
          </div>
        ) : step === 'success' && result && prepared ? (
          <div className="kw-transfer-page kw-transfer-success">
            <CheckCircle weight="fill" aria-hidden="true" />
            <h2 id="kw-wallet-action-title">{result.status === 'allowance-confirmed' ? '토큰 사용을 승인했어요' : result.status === 'confirmed' ? '환전을 완료했어요' : result.status === 'failed' ? `${prepared.stage === 'allowance' ? '토큰 승인을' : '환전을'} 완료하지 못했어요` : `${prepared.stage === 'allowance' ? '토큰 승인을' : '환전을'} 확인하고 있어요`}</h2>
            <p>{result.status === 'allowance-confirmed' ? '현재 시세로 새 환전 견적을 확인해 주세요.' : result.status === 'confirmed' ? '네트워크에서 거래가 확인됐어요.' : result.status === 'failed' ? '거래가 반영되지 않았어요. 거래 내역을 확인해 주세요.' : '네트워크에서 거래 상태를 확인하고 있어요.'}</p>
            <div><span>예상 수령량</span><strong>{prepared.buy.amountDisplay} {prepared.buy.symbol}</strong></div>
            <button type="button" onClick={() => void navigator.clipboard.writeText(result.transactionHash)}>거래 해시 복사</button>
          </div>
        ) : null}
      </div>
      {step === 'amount' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={busy || !quote || quoteExpired || !quote.balanceSufficient || quoteStatus !== 'ready'} aria-busy={quoteStatus === 'loading' || busy} onClick={() => void prepare()}>{busy ? <BusyButtonLabel>확인하고 있어요</BusyButtonLabel> : quoteStatus === 'loading' ? <BusyButtonLabel>환전 경로 확인 중</BusyButtonLabel> : quote && !quote.balanceSufficient ? '보낼 잔액이 부족해요' : '환전 내용 확인'}</button></footer>
      ) : step === 'review' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={busy} aria-busy={busy} onClick={() => reviewExpired ? back() : void execute()}>{busy ? <BusyButtonLabel>처리하고 있어요</BusyButtonLabel> : reviewExpired ? '새 견적 확인' : prepared?.stage === 'allowance' ? '토큰 사용 승인하기' : '인증하고 환전하기'}</button></footer>
      ) : step === 'success' ? (
        <footer className="kw-transfer-footer"><button className="kw-button" type="button" disabled={busy} aria-busy={busy} onClick={result?.status === 'allowance-confirmed' ? () => void continueAfterAllowance() : onClose}>{busy ? <BusyButtonLabel>새 견적 확인 중</BusyButtonLabel> : result?.status === 'allowance-confirmed' ? '새 견적 확인하고 환전하기' : '확인'}</button></footer>
      ) : null}
    </>
  );
}

export function WalletActionSheet(props: WalletActionSheetProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [ownTransfer, setOwnTransfer] = useState<{
    source: ReadyWalletHomePayload;
    assetId: string;
    destination: OwnWalletDestination;
  } | null>(null);
  const startOwnTransfer = async (sourceWalletId: string, targetAsset: WalletReceiveAssetView, destinationAddress: string) => {
    const source = await props.onLoadWalletHome(sourceWalletId);
    const sourceAsset = source.receiveAssets.find((item) => item.assetId === targetAsset.assetId
      && item.chainId === targetAsset.chainId && item.transferStatus === 'enabled');
    const sourceNetwork = source.networks.find((item) => item.chainId === targetAsset.chainId && item.addressStatus === 'ready');
    if (!sourceAsset || sourceAsset.balanceStatus === 'unavailable' || safeBigInt(sourceAsset.availableAtomic) <= 0n
      || !sourceNetwork?.address || sourceNetwork.address.toLowerCase() === destinationAddress.toLowerCase()) {
      throw new Error('own_wallet_source_unavailable');
    }
    setOwnTransfer({ source, assetId: sourceAsset.assetId,
      destination: { walletId: props.wallet.walletId, label: props.wallet.label, address: destinationAddress } });
  };
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
      <section className="kw-transfer-flow" data-action={ownTransfer ? 'send' : props.mode} role="dialog" aria-modal="true" aria-labelledby="kw-wallet-action-title">
        {ownTransfer ? <SendFlow {...props} wallet={ownTransfer.source.wallet}
          receiveAssets={ownTransfer.source.receiveAssets} networks={ownTransfer.source.networks}
          initialAssetId={ownTransfer.assetId} initialOwnDestination={ownTransfer.destination} />
          : props.mode === 'receive' ? <ReceiveFlow {...props} onStartOwnTransfer={startOwnTransfer} />
            : props.mode === 'send' ? <SendFlow {...props} /> : <ExchangeFlow {...props} />}
      </section>
    </div>
  );
}
