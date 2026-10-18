import {
  ArrowClockwise,
  CaretDown,
  Eye,
  EyeSlash,
  LinkSimple,
  Plus,
  Wallet,
} from '@phosphor-icons/react';
import { useEffect, useState, type ComponentType } from 'react';
import type {
  HostCapabilities,
  HostRecipientPickResult,
  ExchangeExecutionResult,
  ExchangeQuote,
  PrepareExchangeRequest,
  PrepareTransferRequest,
  PreparedExchange,
  PreparedTransfer,
  ReadyWalletHomePayload,
  RequestExchangeQuote,
  SecureTransactionSigningRequest,
  SecureTransactionSigningResult,
  SubmitTransferRequest,
  SubmitExchangeRequest,
  TransferExecutionResult,
  TransferActivityItem,
  WalletAssetView,
  WalletHomePayload,
  WalletPaymentRequest,
  WalletProfileSummary,
} from '@took-wss/contracts';
import { WalletActionSheet, type WalletActionMode } from './WalletActionSheet';
import { WalletPayments } from './WalletPayments';
import { AssetIcon } from './AssetIcon';
import { WalletAddressList } from './WalletAddressList';
import { WalletSelectorSheet } from './WalletSelectorSheet';

interface WalletHomeProps {
  tenantId: string;
  logoText: string;
  paymentCoinLogoUrl?: string;
  incomingPaymentRequestId?: string;
  onCreatePaymentRequest: (input: { walletId: string; chainId: string; assetId: string; amountAtomic: string }) => Promise<WalletPaymentRequest>;
  onGetPaymentRequest: (id: string) => Promise<WalletPaymentRequest>;
  onListPaymentRequests: (walletId: string) => Promise<WalletPaymentRequest[]>;
  onListSpentPayments: (walletId: string) => Promise<WalletPaymentRequest[]>;
  HomeSummary?: ComponentType<ReadyWalletSummaryProps>;
  HomeServices?: ComponentType<{ walletId: string; walletLabel: string; walletAddress?: string; wallets: WalletProfileSummary[]; onFocusedOverlayChange: (focused: boolean) => void }>;
  onScanPhysicalCard?: () => Promise<import('@took-wss/contracts').PhysicalCardInfo | null>;
  onCancelPhysicalCardScan?: () => Promise<void>;
  hostCapabilities: HostCapabilities;
  walletHome: WalletHomePayload;
  onNavigate: (route: string) => void;
  onStartCreate: (intent: 'create' | 'import' | 'recover') => void;
  onAddWallet: () => void;
  onSelectWallet: (walletId: string) => Promise<void>;
  onLoadWalletHome: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onRefreshWallet: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onTransactionSubmitted: (sourceWalletId: string, destinationWalletId?: string) => void;
  onRenameWallet: (walletId: string, label: string) => Promise<void>;
  onRemoveWallet: (walletId: string, onProgress: (phase: 'authenticating' | 'removing') => void) => Promise<void>;
  onPrepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  onQuotePhoneEscrow: (request: { walletId: string; assetId: string; chainId: string; amountAtomic: string }) => Promise<import('@took-wss/contracts').PhoneEscrowQuote>;
  onRequestExchangeQuote: (request: RequestExchangeQuote) => Promise<ExchangeQuote>;
  onPrepareExchange: (request: PrepareExchangeRequest) => Promise<PreparedExchange>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onRequestRecipientPick: (mode: 'qr' | 'contacts', chainId: string) => Promise<HostRecipientPickResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onListTransferActivity: (walletId: string) => Promise<TransferActivityItem[]>;
  onGetTransferStatus: (intentId: string) => Promise<TransferActivityItem>;
  onRetryPhoneNotification: (intentId: string) => Promise<import('@took-wss/contracts').PhoneNotificationResult>;
  onPreparePhoneRefund: (transferIntentId: string) => Promise<SecureTransactionSigningRequest>;
  onSubmitPhoneRefund: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onSubmitExchange: (request: SubmitExchangeRequest) => Promise<ExchangeExecutionResult>;
  onGetExchangeStatus: (intentId: string) => Promise<ExchangeExecutionResult>;
  onFocusedOverlayChange: (focused: boolean) => void;
}

interface OpenAction {
  mode: WalletActionMode;
  chainId?: string;
}

export interface ReadyWalletSummaryProps {
  walletHome: ReadyWalletHomePayload;
  balanceHidden: boolean;
  onToggleBalance: () => void;
  onOpenWalletSelector: () => void;
  onAddWallet: () => void;
  onSelectWallet: (walletId: string) => Promise<void>;
  onRefreshWallet: () => void;
  onShowAction: (mode: WalletActionMode) => void;
  onNavigate: (route: string) => void;
}

function formatValuationTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '조회 기준';
  return `${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)} 조회 기준`;
}

function transferActivityStatus(item: TransferActivityItem): string {
  switch (item.phoneEscrowStatus) {
    case 'ready': return '수령 대기';
    case 'claiming': return '수령 처리 중';
    case 'claimed': return '수령 완료';
    case 'refund-available': return '환불 가능';
    case 'refunding': return '환불 처리 중';
    case 'refunded': return '환불 완료';
    default: break;
  }
  switch (item.status) {
    case 'confirmed': return '전송 완료';
    case 'submitted': return '전송 확정 대기';
    case 'processing': return '전송 처리 중';
    case 'failed': return '전송 실패';
    case 'expired': return '요청 만료';
    case 'approval-required': return '전송 승인 필요';
  }
}

function AssetRow({ asset, hideBalance, onOpen }: { asset: WalletAssetView; hideBalance: boolean; onOpen: () => void }) {
  return (
    <button className="kw-asset-row" type="button" onClick={onOpen}>
      <AssetIcon className="kw-asset-icon" symbol={asset.symbol} iconAssetId={asset.iconAssetId} />
      <span className="kw-asset-info">
        <strong className="kw-asset-name">{asset.name}</strong>
        <span className="kw-asset-sub">{asset.network}</span>
      </span>
      <span className="kw-asset-value">
        <strong>{hideBalance ? '••••' : asset.fiat?.display ?? '-'}</strong>
        <small className={asset.fiat?.stale ? 'kw-muted' : undefined}>{hideBalance ? '••••' : `${asset.balanceDisplay} ${asset.symbol}${asset.fiat?.stale ? ' · 지연' : ''}`}</small>
      </span>
    </button>
  );
}

function DefaultWalletSummary({ walletHome, balanceHidden, onToggleBalance, onOpenWalletSelector, onAddWallet, onShowAction, onRefreshWallet }: ReadyWalletSummaryProps) {
  const valuationLabel = walletHome.valuation.status === 'live' && walletHome.valuation.provider === 'bonanza'
    ? '자산 조회 기준 · KVWAP'
    : walletHome.valuation.status === 'live' && walletHome.valuation.provider === 'hybrid'
      ? '자산 조회 기준 · KVWAP + 보조시세'
      : walletHome.valuation.status === 'live'
        ? '자산 조회 기준 · 보조시세'
        : '자산 조회 기준 · KVWAP 확인 중';
  return (
    <section className="kw-digital-asset-summary" aria-labelledby="kw-balance-title">
      <div className="kw-digital-asset-summary__topline">
        <div className="kw-wallet-context-actions">
          <button className="kw-wallet-selector" type="button" onClick={onOpenWalletSelector}>
            <span id="kw-balance-title">{walletHome.wallet.label}</span><CaretDown aria-hidden="true" />
          </button>
          <button className="kw-wallet-add-inline" type="button" aria-label="지갑 추가하기" onClick={onAddWallet}><Plus aria-hidden="true" /></button>
        </div>
        <div className="kw-summary-tools" aria-label="자산 조회 도구">
          <button type="button" aria-label={balanceHidden ? '잔액 보기' : '잔액 숨기기'} aria-pressed={balanceHidden} onClick={onToggleBalance}>
            {balanceHidden ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
          <button type="button" aria-label="잔액 새로고침" onClick={onRefreshWallet}><ArrowClockwise aria-hidden="true" /></button>
        </div>
      </div>
      <strong className="kw-hero">{balanceHidden ? '••••' : walletHome.totalFiat?.display ?? '—'}</strong>
      <p className="kw-caption kw-mt-8 kw-valuation-caption">
        {formatValuationTime(walletHome.valuation.asOf)} · {valuationLabel}
        {walletHome.valuation.status !== 'live' ? <span className="kw-valuation-spinner" aria-hidden="true" /> : null}
        {walletHome.totalFiat?.stale ? ' · 업데이트 지연' : ''}
      </p>
      <div className="kw-asset-action-rail" aria-label="선택한 지갑 주요 기능">
        <button type="button" onClick={() => onShowAction('receive')}>채우기</button>
        <button type="button" onClick={() => onShowAction('send')}>보내기</button>
        <button type="button" onClick={() => onShowAction('exchange')}>환전하기</button>
      </div>
    </section>
  );
}

function AbsentWallet({ hostCapabilities, walletHome, onStartCreate }: WalletHomeProps) {
  if (walletHome.status !== 'absent') return null;
  const canRecover = walletHome.canRecover && hostCapabilities.canOpenRecovery;
  return (
    <div className="kw-wallet-home">
      <section className="kw-card kw-wallet-home__intro" aria-labelledby="kw-empty-title">
        <div className="kw-empty-illustration" aria-hidden="true"><Wallet className="kw-icon" weight="regular" /></div>
        <h1 id="kw-empty-title">아직 지갑이 없어요</h1>
        <p className="kw-body">새 지갑을 만들거나<br />기존 지갑을 가져와 시작해 보세요.</p>
        <div className="kw-inline-notice kw-mt-24">
          <span>지갑마다 복구 방법을 설정해요.<br />선택한 지갑의 자산만 표시합니다.</span>
        </div>
        <div className="kw-wallet-home__actions">
          <button className="kw-button" type="button" disabled={!walletHome.canCreate} onClick={() => onStartCreate('create')}>첫 지갑 추가하기</button>
        </div>
        <div className="kw-wallet-home__quiet-actions">
          {canRecover ? <button className="kw-link" type="button" onClick={() => onStartCreate('recover')}>기존 지갑 복구하기</button> : null}
          {hostCapabilities.canSecureWalletImport ? (
            <button className="kw-link" type="button" onClick={() => onStartCreate('import')}>
              <LinkSimple className="kw-icon kw-icon--small" aria-hidden="true" />외부 지갑 가져오기
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReadyWallet({
  tenantId,
  logoText,
  paymentCoinLogoUrl,
  incomingPaymentRequestId,
  onCreatePaymentRequest,
  onGetPaymentRequest,
  onListPaymentRequests,
  onListSpentPayments,
  HomeSummary = DefaultWalletSummary,
  HomeServices,
  onScanPhysicalCard,
  onCancelPhysicalCardScan,
  hostCapabilities,
  walletHome,
  onNavigate,
  onAddWallet,
  onSelectWallet,
  onLoadWalletHome,
  onRefreshWallet,
  onTransactionSubmitted,
  onRenameWallet,
  onRemoveWallet,
  onPrepareTransfer,
  onQuotePhoneEscrow,
  onRequestExchangeQuote,
  onPrepareExchange,
  onRequestSecureTransactionSignature,
  onRequestRecipientPick,
  onSubmitTransfer,
  onListTransferActivity,
  onGetTransferStatus,
  onRetryPhoneNotification,
  onPreparePhoneRefund,
  onSubmitPhoneRefund,
  onSubmitExchange,
  onGetExchangeStatus,
  onFocusedOverlayChange,
}: {
  tenantId: string;
  logoText: string;
  paymentCoinLogoUrl?: string;
  incomingPaymentRequestId?: string;
  onCreatePaymentRequest: WalletHomeProps['onCreatePaymentRequest'];
  onGetPaymentRequest: WalletHomeProps['onGetPaymentRequest'];
  onListPaymentRequests: WalletHomeProps['onListPaymentRequests'];
  onListSpentPayments: WalletHomeProps['onListSpentPayments'];
  HomeSummary?: ComponentType<ReadyWalletSummaryProps>;
  HomeServices?: ComponentType<{ walletId: string; walletLabel: string; walletAddress?: string; wallets: WalletProfileSummary[]; onFocusedOverlayChange: (focused: boolean) => void }>;
  onScanPhysicalCard?: WalletHomeProps['onScanPhysicalCard'];
  onCancelPhysicalCardScan?: WalletHomeProps['onCancelPhysicalCardScan'];
  hostCapabilities: HostCapabilities;
  walletHome: ReadyWalletHomePayload;
  onNavigate: (route: string) => void;
  onAddWallet: () => void;
  onSelectWallet: (walletId: string) => Promise<void>;
  onLoadWalletHome: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onRefreshWallet: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onTransactionSubmitted: (sourceWalletId: string, destinationWalletId?: string) => void;
  onRenameWallet: (walletId: string, label: string) => Promise<void>;
  onRemoveWallet: (walletId: string, onProgress: (phase: 'authenticating' | 'removing') => void) => Promise<void>;
  onPrepareTransfer: (request: PrepareTransferRequest) => Promise<PreparedTransfer>;
  onQuotePhoneEscrow: (request: { walletId: string; assetId: string; chainId: string; amountAtomic: string }) => Promise<import('@took-wss/contracts').PhoneEscrowQuote>;
  onRequestExchangeQuote: (request: RequestExchangeQuote) => Promise<ExchangeQuote>;
  onPrepareExchange: (request: PrepareExchangeRequest) => Promise<PreparedExchange>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onRequestRecipientPick: (mode: 'qr' | 'contacts', chainId: string) => Promise<HostRecipientPickResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onListTransferActivity: (walletId: string) => Promise<TransferActivityItem[]>;
  onGetTransferStatus: (intentId: string) => Promise<TransferActivityItem>;
  onRetryPhoneNotification: (intentId: string) => Promise<import('@took-wss/contracts').PhoneNotificationResult>;
  onPreparePhoneRefund: (transferIntentId: string) => Promise<SecureTransactionSigningRequest>;
  onSubmitPhoneRefund: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onSubmitExchange: (request: SubmitExchangeRequest) => Promise<ExchangeExecutionResult>;
  onGetExchangeStatus: (intentId: string) => Promise<ExchangeExecutionResult>;
  onFocusedOverlayChange: (focused: boolean) => void;
}) {
  const [openAction, setOpenAction] = useState<OpenAction | null>(null);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [activity, setActivity] = useState<TransferActivityItem[]>([]);
  const [activityState, setActivityState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  const [refundMessage, setRefundMessage] = useState<string | null>(null);
  const [noticeBusyId, setNoticeBusyId] = useState<string | null>(null);
  useEffect(() => () => onFocusedOverlayChange(false), [onFocusedOverlayChange]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const listed = await onListTransferActivity(walletHome.wallet.walletId);
        const pending = listed.filter((item) => item.status === 'processing' || item.status === 'submitted'
          || item.phoneEscrowStatus === 'refunding').slice(0, 4);
        const updates = await Promise.all(pending.map(async (item) => {
          try { return await onGetTransferStatus(item.intentId); } catch { return item; }
        }));
        const byId = new Map(updates.map((item) => [item.intentId, item]));
        if (active) {
          setActivity(listed.map((item) => byId.get(item.intentId) ?? item));
          setActivityState('ready');
        }
      } catch {
        if (active) setActivityState('error');
      }
    };
    setActivity([]);
    setActivityState('loading');
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [walletHome.wallet.walletId, onListTransferActivity, onGetTransferStatus, activityRefresh]);

  const showAction = (mode: WalletActionMode, chainId?: string) => {
    setOpenAction({ mode, chainId });
    onFocusedOverlayChange(true);
  };
  const closeAction = () => {
    setOpenAction(null);
    onFocusedOverlayChange(false);
  };
  const transactionSubmitted = (sourceWalletId: string, destinationWalletId?: string) => {
    onTransactionSubmitted(sourceWalletId, destinationWalletId);
    setActivityRefresh((value) => value + 1);
  };
  const openWalletSelector = () => {
    setWalletSelectorOpen(true);
    onFocusedOverlayChange(true);
  };
  const closeWalletSelector = () => {
    setWalletSelectorOpen(false);
    onFocusedOverlayChange(false);
  };
  const addWallet = () => {
    setWalletSelectorOpen(false);
    onFocusedOverlayChange(false);
    onAddWallet();
  };
  const refund = async (transferIntentId: string) => {
    setRefundBusyId(transferIntentId);
    setRefundMessage(null);
    onFocusedOverlayChange(true);
    try {
      const prepared = await onPreparePhoneRefund(transferIntentId);
      const signature = await onRequestSecureTransactionSignature(prepared);
      if (signature.status === 'cancelled') {
        setRefundMessage('환불 인증이 취소됐어요.');
        return;
      }
      if (signature.status === 'wallet-ready') {
        setRefundMessage('지갑 보관 확인을 마쳤어요. 환불을 다시 눌러 주세요.');
        return;
      }
      if (signature.intentId !== prepared.intentId) throw new Error('Refund intent mismatch.');
      await onSubmitPhoneRefund({
        intentId: prepared.intentId,
        signedTransaction: signature.signedTransaction,
        hostAuthorizationProof: signature.hostAuthorizationProof,
        idempotencyKey: crypto.randomUUID(),
      });
      onTransactionSubmitted(walletHome.wallet.walletId);
      setRefundMessage('환불 거래를 접수했어요. 네트워크 확인 후 내역에 반영돼요.');
      setActivityRefresh((value) => value + 1);
    } catch {
      setRefundMessage('환불 상태를 확인하지 못했어요. 내역을 새로고침한 뒤 다시 확인해 주세요.');
    } finally {
      setRefundBusyId(null);
      onFocusedOverlayChange(false);
    }
  };
  const shareClaimLink = async (url: string) => {
    try {
      const canShare = typeof navigator.share === 'function';
      if (canShare) await navigator.share({ title: '자산 수령 안내', url });
      else await navigator.clipboard.writeText(url);
      setRefundMessage(canShare ? '수령 링크를 공유했어요.' : '수령 링크를 복사했어요.');
    } catch (shareError) {
      if (!(shareError instanceof DOMException && shareError.name === 'AbortError')) {
        setRefundMessage('수령 링크를 공유하지 못했어요. 다시 시도해 주세요.');
      }
    }
  };
  const retryNotification = async (intentId: string) => {
    setNoticeBusyId(intentId);
    setRefundMessage(null);
    try {
      const delivery = await onRetryPhoneNotification(intentId);
      setRefundMessage(delivery.status === 'sent' ? '수령 안내 문자를 다시 보냈어요.' : '문자 발송 상태를 확인 중이에요.');
      setActivityRefresh((value) => value + 1);
    } catch (retryError) {
      const code = retryError instanceof Error ? retryError.message : '';
      setRefundMessage(code === 'phone_escrow_sms_rate_limited' ? '잠시 뒤 다시 보내 주세요.'
        : code === 'phone_escrow_sms_limit_reached' ? '문자 발송 횟수를 모두 사용했어요. 수령 링크를 공유해 주세요.'
          : '문자를 다시 보내지 못했어요. 수령 링크를 공유해 주세요.');
    } finally { setNoticeBusyId(null); }
  };
  const recoveryLabel = walletHome.recovery.profile === 'sar-2-of-3'
    ? walletHome.wallet.origin === 'imported' ? '가져온 지갑 · 자가복구' : '자가복구'
    : walletHome.wallet.keyAdapter === 'fsl-mpc' ? '기관 연동 보호' : '간편 연동 보호';
  const readyNetworkCount = walletHome.networks.filter(({ addressStatus }) => addressStatus === 'ready').length;

  return (
    <div className="kw-wallet-home">
      <HomeSummary
        walletHome={walletHome}
        balanceHidden={balanceHidden}
        onToggleBalance={() => setBalanceHidden((hidden) => !hidden)}
        onOpenWalletSelector={openWalletSelector}
        onAddWallet={onAddWallet}
        onSelectWallet={onSelectWallet}
        onRefreshWallet={() => { void onRefreshWallet(walletHome.wallet.walletId).catch(() => undefined); }}
        onShowAction={showAction}
        onNavigate={onNavigate}
      />

      <section className="kw-card kw-selected-wallet-card" aria-labelledby="kw-selected-wallet-assets-title">
        <div className="kw-selected-wallet-card__heading">
          <div>
            <h2 id="kw-selected-wallet-assets-title">보유 자산</h2>
            <p>{recoveryLabel} · 지원 네트워크 {readyNetworkCount}개</p>
          </div>
          <span>{walletHome.assets.length}개</span>
        </div>
        <WalletAddressList networks={walletHome.networks} />
        {walletHome.recovery.profile === 'sar-2-of-3' ? (
          <button className="kw-link" type="button" onClick={() => onNavigate(`wallets/${walletHome.wallet.walletId}/recovery-secret`)}>
            자가복구 관리
          </button>
        ) : null}
        {walletHome.assets.length > 0 ? (
          <div className="kw-asset-list kw-selected-wallet-assets">
            {walletHome.assets.map((asset) => (
              <AssetRow
                key={asset.assetId}
                asset={asset}
                hideBalance={balanceHidden}
                onOpen={() => onNavigate(`wallets/${walletHome.wallet.walletId}/assets/${encodeURIComponent(asset.assetId)}`)}
              />
            ))}
          </div>
        ) : (
          <div className="kw-wallet-assets-empty">
            <Wallet aria-hidden="true" />
            <strong>아직 보유한 자산이 없어요</strong>
            <p>채우기를 눌러 이 지갑으로 디지털자산을 받아보세요.</p>
          </div>
        )}
      </section>

      <WalletPayments
        tenantId={tenantId}
        logoText={logoText}
        paymentCoinLogoUrl={paymentCoinLogoUrl}
        walletHome={walletHome}
        incomingPaymentRequestId={incomingPaymentRequestId}
        onLoadWalletHome={onLoadWalletHome}
        onSelectWallet={onSelectWallet}
        onRequestRecipientPick={onRequestRecipientPick}
        onCreatePaymentRequest={onCreatePaymentRequest}
        onGetPaymentRequest={onGetPaymentRequest}
        onListPaymentRequests={onListPaymentRequests}
        onListSpentPayments={onListSpentPayments}
        onPrepareTransfer={onPrepareTransfer}
        onRequestSecureTransactionSignature={onRequestSecureTransactionSignature}
        onSubmitTransfer={onSubmitTransfer}
        onTransactionSubmitted={transactionSubmitted}
        onFocusedOverlayChange={onFocusedOverlayChange}
        onScanPhysicalCard={onScanPhysicalCard}
        onCancelPhysicalCardScan={onCancelPhysicalCardScan}
      />

      {HomeServices ? <HomeServices walletId={walletHome.wallet.walletId} walletLabel={walletHome.wallet.label} walletAddress={walletHome.networks.find((network) => network.addressGroupId === 'evm' && network.addressStatus === 'ready')?.address} wallets={walletHome.wallets} onFocusedOverlayChange={onFocusedOverlayChange} /> : null}

      <section className="kw-card kw-transfer-activity" aria-labelledby="kw-transfer-activity-title">
        <div className="kw-transfer-activity__heading">
          <h2 id="kw-transfer-activity-title">보내기 내역</h2>
          <button type="button" aria-label="보내기 내역 새로고침" onClick={() => setActivityRefresh((value) => value + 1)}><ArrowClockwise aria-hidden="true" /></button>
        </div>
        {refundMessage ? <p className="kw-transfer-activity__message" role="status">{refundMessage}</p> : null}
        {activityState === 'loading' ? <p className="kw-caption">내역을 불러오고 있어요.</p>
          : activityState === 'error' ? <p className="kw-caption">내역을 불러오지 못했어요. 새로고침해 주세요.</p>
            : activity.length === 0 ? <p className="kw-caption">아직 보낸 내역이 없어요.</p>
              : <ul className="kw-transfer-activity__list">{activity.map((item) => (
                <li key={item.intentId}>
                  <span className="kw-transfer-activity__mark" aria-hidden="true">↗</span>
                  <span className="kw-transfer-activity__detail">
                    <strong>{item.channel === 'phone' ? '휴대폰으로 보내기' : '보내기'} · {item.network}</strong>
                    <small>{item.recipientDisplay.length > 24 ? `${item.recipientDisplay.slice(0, 10)}…${item.recipientDisplay.slice(-8)}` : item.recipientDisplay}</small>
                    <small>{new Date(item.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</small>
                    <small data-status={item.status}>{transferActivityStatus(item)}</small>
                  </span>
                  <span className="kw-transfer-activity__value">
                    <strong>{balanceHidden ? '••••' : item.fiatDisplay ?? '원화 금액 확인 중'}</strong>
                    {item.phoneEscrowClaimUrl ? <button type="button" className="kw-transfer-activity__refund" onClick={() => void shareClaimLink(item.phoneEscrowClaimUrl!)}>수령 링크 공유</button> : null}
                    {item.phoneEscrowClaimUrl && item.phoneEscrowSmsStatus !== 'sent' ? <button type="button" className="kw-transfer-activity__refund" disabled={noticeBusyId !== null} onClick={() => void retryNotification(item.intentId)}>{noticeBusyId === item.intentId ? '확인 중' : '문자 다시 보내기'}</button> : null}
                    {item.phoneEscrowStatus === 'refund-available' ? <button type="button" className="kw-transfer-activity__refund" disabled={refundBusyId !== null} onClick={() => void refund(item.intentId)}>{refundBusyId === item.intentId ? '확인 중' : '환불받기'}</button> : null}
                  </span>
                </li>
              ))}</ul>}
      </section>

      {openAction ? (
        <WalletActionSheet
          key={`${openAction.mode}-${openAction.chainId ?? 'select'}`}
          mode={openAction.mode}
          wallet={walletHome.wallet}
          wallets={walletHome.wallets}
          assets={walletHome.assets}
          receiveAssets={walletHome.receiveAssets}
          networks={walletHome.networks}
          hostCapabilities={hostCapabilities}
          initialChainId={openAction.chainId}
          onPrepareTransfer={onPrepareTransfer}
          onQuotePhoneEscrow={onQuotePhoneEscrow}
          onLoadWalletHome={onLoadWalletHome}
          onTransactionSubmitted={transactionSubmitted}
          onRequestExchangeQuote={onRequestExchangeQuote}
          onPrepareExchange={onPrepareExchange}
          onRequestSecureTransactionSignature={onRequestSecureTransactionSignature}
          onRequestRecipientPick={onRequestRecipientPick}
          onSubmitTransfer={onSubmitTransfer}
          onGetTransferStatus={onGetTransferStatus}
          onRetryPhoneNotification={onRetryPhoneNotification}
          onSubmitExchange={onSubmitExchange}
          onGetExchangeStatus={onGetExchangeStatus}
          onClose={closeAction}
        />
      ) : null}
      {walletSelectorOpen ? (
        <WalletSelectorSheet
          wallets={walletHome.wallets}
          selectedWalletId={walletHome.wallet.walletId}
          onSelect={onSelectWallet}
          onRename={onRenameWallet}
          onRemove={onRemoveWallet}
          onAdd={addWallet}
          onClose={closeWalletSelector}
        />
      ) : null}
    </div>
  );
}

export function WalletHome(props: WalletHomeProps) {
  const { walletHome, onNavigate } = props;
  if (walletHome.status === 'absent') return <AbsentWallet {...props} />;
  if (walletHome.status === 'unavailable') {
    return (
      <div className="kw-wallet-home">
        <section className="kw-card kw-wallet-home__intro" aria-labelledby="kw-unavailable-title">
          <div className="kw-empty-illustration" aria-hidden="true"><ArrowClockwise className="kw-icon" /></div>
          <h1 id="kw-unavailable-title">자산을 불러오지 못했어요</h1>
          <p className="kw-body">잠시 후 다시 확인해 주세요. 표시가 지연되어도 실제 자산에는 영향을 주지 않습니다.</p>
          {walletHome.canRetry ? <button className="kw-button kw-mt-24" type="button" onClick={() => onNavigate('wallet/retry')}>다시 불러오기</button> : null}
        </section>
      </div>
    );
  }
  if (walletHome.status === 'empty') {
    return (
      <div className="kw-wallet-home">
        <section className="kw-card kw-wallet-home__intro" aria-labelledby="kw-no-assets-title">
          <div className="kw-empty-illustration" aria-hidden="true"><Wallet className="kw-icon" /></div>
          <h1 id="kw-no-assets-title">보유한 자산이 없어요</h1>
          <p className="kw-body">받을 주소를 확인해 첫 디지털자산을 받아보세요.</p>
          <button className="kw-button kw-mt-24" type="button" onClick={() => onNavigate('wallet/receive')}>받기</button>
        </section>
      </div>
    );
  }
  return (
    <ReadyWallet
      tenantId={props.tenantId}
      logoText={props.logoText}
      paymentCoinLogoUrl={props.paymentCoinLogoUrl}
      incomingPaymentRequestId={props.incomingPaymentRequestId}
      onCreatePaymentRequest={props.onCreatePaymentRequest}
      onGetPaymentRequest={props.onGetPaymentRequest}
      onListPaymentRequests={props.onListPaymentRequests}
      onListSpentPayments={props.onListSpentPayments}
      HomeSummary={props.HomeSummary}
      HomeServices={props.HomeServices}
      onScanPhysicalCard={props.onScanPhysicalCard}
      onCancelPhysicalCardScan={props.onCancelPhysicalCardScan}
      hostCapabilities={props.hostCapabilities}
      walletHome={walletHome}
      onNavigate={onNavigate}
      onAddWallet={props.onAddWallet}
      onSelectWallet={props.onSelectWallet}
      onLoadWalletHome={props.onLoadWalletHome}
      onRefreshWallet={props.onRefreshWallet}
      onTransactionSubmitted={props.onTransactionSubmitted}
      onRenameWallet={props.onRenameWallet}
      onRemoveWallet={props.onRemoveWallet}
      onPrepareTransfer={props.onPrepareTransfer}
      onQuotePhoneEscrow={props.onQuotePhoneEscrow}
      onRequestExchangeQuote={props.onRequestExchangeQuote}
      onPrepareExchange={props.onPrepareExchange}
      onRequestSecureTransactionSignature={props.onRequestSecureTransactionSignature}
      onRequestRecipientPick={props.onRequestRecipientPick}
      onSubmitTransfer={props.onSubmitTransfer}
      onListTransferActivity={props.onListTransferActivity}
      onGetTransferStatus={props.onGetTransferStatus}
      onRetryPhoneNotification={props.onRetryPhoneNotification}
      onPreparePhoneRefund={props.onPreparePhoneRefund}
      onSubmitPhoneRefund={props.onSubmitPhoneRefund}
      onSubmitExchange={props.onSubmitExchange}
      onGetExchangeStatus={props.onGetExchangeStatus}
      onFocusedOverlayChange={props.onFocusedOverlayChange}
    />
  );
}
