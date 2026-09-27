import {
  ArrowClockwise,
  CaretDown,
  Eye,
  EyeSlash,
  LinkSimple,
  Plus,
  ShieldCheck,
  Wallet,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type {
  HostCapabilities,
  ReadyWalletHomePayload,
  WalletAssetView,
  WalletHomePayload,
} from '@took-wss/contracts';
import { WalletActionSheet, type WalletActionMode } from './WalletActionSheet';
import { WalletAddressList } from './WalletAddressList';
import { WalletSelectorSheet } from './WalletSelectorSheet';

interface WalletHomeProps {
  hostCapabilities: HostCapabilities;
  walletHome: WalletHomePayload;
  onNavigate: (route: string) => void;
  onStartCreate: () => void;
  onAddWallet: () => void;
  onSelectWallet: (walletId: string) => Promise<void>;
  onFocusedOverlayChange: (focused: boolean) => void;
}

interface OpenAction {
  mode: WalletActionMode;
  chainId?: string;
}

function formatValuationTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '조회 기준';
  return `${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)} 조회 기준`;
}

function AssetRow({ asset, hideBalance, onOpen }: { asset: WalletAssetView; hideBalance: boolean; onOpen: () => void }) {
  return (
    <button className="kw-asset-row" type="button" onClick={onOpen}>
      <span className="kw-asset-icon kw-asset-icon--usd" aria-hidden="true">{asset.symbol.slice(0, 1)}</span>
      <span className="kw-asset-info">
        <strong className="kw-asset-name">{asset.name}</strong>
        <span className="kw-asset-sub">{asset.network}</span>
      </span>
      <span className="kw-asset-value">
        <strong>{hideBalance ? '••••' : asset.fiat?.display ?? '원화 환산 준비 중'}</strong>
        <small className={asset.fiat?.stale ? 'kw-muted' : undefined}>{hideBalance ? '••••' : `${asset.balanceDisplay} ${asset.symbol}${asset.fiat?.stale ? ' · 지연' : ''}`}</small>
      </span>
    </button>
  );
}

function AbsentWallet({ hostCapabilities, walletHome, onNavigate, onStartCreate }: WalletHomeProps) {
  if (walletHome.status !== 'absent') return null;
  const canRecover = walletHome.canRecover && hostCapabilities.canOpenRecovery;
  return (
    <div className="kw-wallet-home">
      <section className="kw-card kw-wallet-home__intro" aria-labelledby="kw-empty-title">
        <div className="kw-empty-illustration" aria-hidden="true"><Wallet className="kw-icon" weight="regular" /></div>
        <h1 id="kw-empty-title">아직 지갑이 없어요</h1>
        <p className="kw-body">새 지갑을 만들거나 기존 비수탁 지갑을 가져와 첫 지갑 슬롯을 추가해 보세요.</p>
        <div className="kw-inline-notice kw-mt-24">
          <ShieldCheck className="kw-icon kw-icon--small" weight="regular" aria-hidden="true" />
          <span>지갑마다 키 관리 방식과 복구 정책을 독립적으로 적용하고, 선택한 지갑의 자산만 조회합니다.</span>
        </div>
        <div className="kw-wallet-home__actions">
          <button className="kw-button" type="button" disabled={!walletHome.canCreate} onClick={onStartCreate}>첫 지갑 추가하기</button>
        </div>
        <div className="kw-wallet-home__quiet-actions">
          {canRecover ? <button className="kw-link" type="button" onClick={() => onNavigate('wallet/recovery')}>기존 SAR 지갑 복구하기</button> : null}
          {hostCapabilities.canSecureWalletImport ? (
            <button className="kw-link" type="button" onClick={onStartCreate}>
              <LinkSimple className="kw-icon kw-icon--small" aria-hidden="true" />외부 지갑 가져오기
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReadyWallet({
  hostCapabilities,
  walletHome,
  onNavigate,
  onAddWallet,
  onSelectWallet,
  onFocusedOverlayChange,
}: {
  hostCapabilities: HostCapabilities;
  walletHome: ReadyWalletHomePayload;
  onNavigate: (route: string) => void;
  onAddWallet: () => void;
  onSelectWallet: (walletId: string) => Promise<void>;
  onFocusedOverlayChange: (focused: boolean) => void;
}) {
  const [openAction, setOpenAction] = useState<OpenAction | null>(null);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  useEffect(() => () => onFocusedOverlayChange(false), [onFocusedOverlayChange]);

  const showAction = (mode: WalletActionMode, chainId?: string) => {
    setOpenAction({ mode, chainId });
    onFocusedOverlayChange(true);
  };
  const closeAction = () => {
    setOpenAction(null);
    onFocusedOverlayChange(false);
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
  const valuationLabel = walletHome.valuation.status === 'live'
    ? 'K-VWAP 원화 기준'
    : walletHome.valuation.status === 'sandbox'
      ? 'K-VWAP 샌드박스 기준'
      : '원화 평가 연결 대기';
  const recoveryLabel = walletHome.recovery.profile === 'sar-2-of-3'
    ? walletHome.wallet.origin === 'imported' ? '가져온 지갑 · SAR 자가복구' : 'SAR 자가복구'
    : walletHome.wallet.keyAdapter === 'fsl-mpc' ? 'FSL MPC' : 'Thirdweb MPC';

  return (
    <div className="kw-wallet-home">
      <section className="kw-digital-asset-summary" aria-labelledby="kw-balance-title">
        <div className="kw-digital-asset-summary__topline">
          <div className="kw-wallet-context-actions">
            <button className="kw-wallet-selector" type="button" onClick={openWalletSelector}>
              <span id="kw-balance-title">{walletHome.wallet.label}</span><CaretDown aria-hidden="true" />
            </button>
            <button className="kw-wallet-add-inline" type="button" aria-label="지갑 추가하기" onClick={onAddWallet}><Plus aria-hidden="true" /></button>
          </div>
          <div className="kw-summary-tools" aria-label="자산 조회 도구">
            <button type="button" aria-label={balanceHidden ? '잔액 보기' : '잔액 숨기기'} aria-pressed={balanceHidden} onClick={() => setBalanceHidden((hidden) => !hidden)}>
              {balanceHidden ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
            <button type="button" aria-label="잔액 새로고침" onClick={() => onNavigate(`wallets/${walletHome.wallet.walletId}/refresh`)}><ArrowClockwise aria-hidden="true" /></button>
          </div>
        </div>
        <strong className="kw-hero">{balanceHidden ? '••••' : walletHome.totalFiat?.display ?? '원화 환산 준비 중'}</strong>
        <p className="kw-caption kw-mt-8">{formatValuationTime(walletHome.valuation.asOf)} · {valuationLabel}{walletHome.totalFiat?.stale ? ' · 업데이트 지연' : ''}</p>
        <div className="kw-asset-action-rail" aria-label="선택한 지갑 주요 기능">
          <button type="button" onClick={() => showAction('receive')}>채우기</button>
          <button type="button" onClick={() => showAction('send')}>보내기</button>
          <button type="button" onClick={() => showAction('exchange')}>환전하기</button>
        </div>
      </section>

      <section className="kw-card kw-selected-wallet-card" aria-labelledby="kw-selected-wallet-assets-title">
        <div className="kw-selected-wallet-card__heading">
          <div>
            <h2 id="kw-selected-wallet-assets-title">보유 자산</h2>
            <p>{recoveryLabel} · 지원 네트워크 {walletHome.networks.length}개</p>
          </div>
          <span>{walletHome.assets.length}개</span>
        </div>
        <div className="kw-selected-wallet-scope">
          <ShieldCheck aria-hidden="true" />
          <span>현재 선택한 지갑 슬롯의 자산만 보여드려요.</span>
        </div>
        <WalletAddressList networks={walletHome.networks} />
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
        {walletHome.valuation.status === 'sandbox' ? (
          <div className="kw-inline-notice kw-inline-notice--neutral kw-mt-20">
            <ShieldCheck className="kw-icon kw-icon--small" aria-hidden="true" />
            <span>현재 자산 조회는 계약 검증용 샌드박스입니다. 실제 자산과 시세는 선택한 지갑 ID로 키 코어·K-VWAP을 조회한 뒤 표시됩니다.</span>
          </div>
        ) : null}
      </section>

      {openAction ? (
        <WalletActionSheet
          key={`${openAction.mode}-${openAction.chainId ?? 'select'}`}
          mode={openAction.mode}
          networks={walletHome.networks}
          hostCapabilities={hostCapabilities}
          initialChainId={openAction.chainId}
          onClose={closeAction}
        />
      ) : null}
      {walletSelectorOpen ? (
        <WalletSelectorSheet
          wallets={walletHome.wallets}
          selectedWalletId={walletHome.wallet.walletId}
          onSelect={onSelectWallet}
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
      hostCapabilities={props.hostCapabilities}
      walletHome={walletHome}
      onNavigate={onNavigate}
      onAddWallet={props.onAddWallet}
      onSelectWallet={props.onSelectWallet}
      onFocusedOverlayChange={props.onFocusedOverlayChange}
    />
  );
}
