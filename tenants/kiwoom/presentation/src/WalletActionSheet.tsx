import {
  ArrowLeft,
  ChatCircleDots,
  Check,
  DeviceMobile,
  PaperPlaneTilt,
  QrCode,
  X,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { HostCapabilities, WalletNetworkView } from '@took-wss/contracts';

export type WalletActionMode = 'receive' | 'send' | 'exchange';
type TransferChannel = 'took' | 'address';

interface WalletActionSheetProps {
  mode: WalletActionMode;
  networks: WalletNetworkView[];
  hostCapabilities: HostCapabilities;
  initialChainId?: string;
  onClose: () => void;
}

interface TransferChannelTabsProps {
  mode: 'receive' | 'send';
  channel: TransferChannel;
  onChange: (channel: TransferChannel) => void;
}

function TransferChannelTabs({ mode, channel, onChange }: TransferChannelTabsProps) {
  const tookLabel = mode === 'receive' ? '툭받기' : '툭주기';
  const addressLabel = mode === 'receive' ? '주소로 받기' : '주소로 보내기';

  return (
    <div
      className="kw-transfer-channel-tabs"
      role="tablist"
      aria-label={`${tookLabel} 방식`}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowLeft'
              ? (currentIndex - 1 + tabs.length) % tabs.length
              : (currentIndex + 1) % tabs.length;
        tabs[nextIndex]?.focus();
        onChange(nextIndex === 0 ? 'took' : 'address');
      }}
    >
      <button
        id="kw-transfer-channel-took-tab"
        type="button"
        role="tab"
        aria-selected={channel === 'took'}
        aria-controls="kw-transfer-channel-panel"
        onClick={() => onChange('took')}
      >
        {tookLabel}
      </button>
      <button
        id="kw-transfer-channel-address-tab"
        type="button"
        role="tab"
        aria-selected={channel === 'address'}
        aria-controls="kw-transfer-channel-panel"
        onClick={() => onChange('address')}
      >
        {addressLabel}
      </button>
    </div>
  );
}

function TookChannelIntro({ mode, canUseContacts }: { mode: 'receive' | 'send'; canUseContacts: boolean }) {
  const isReceive = mode === 'receive';
  return (
    <div className="kw-took-intro">
      <div className="kw-took-intro__heading">
        {isReceive ? <ChatCircleDots aria-hidden="true" /> : <PaperPlaneTilt aria-hidden="true" />}
        <div>
          <span>키움 간편 송금</span>
          <strong>{isReceive ? '주소 없이 간편하게 툭받기' : '받는 사람에게 간편하게 툭주기'}</strong>
        </div>
      </div>
      <p>
        {isReceive
          ? '휴대폰 번호나 암호화 메시지로 요청하고, 확인된 수신 경로로 안전하게 연결해요.'
          : '주소 대신 연락처나 암호화 메시지를 선택하고, 보내기 전에 수신자와 네트워크를 다시 확인해요.'}
      </p>
      <div className="kw-took-intro__methods" aria-label="지원 예정 연결 방식">
        <span><DeviceMobile aria-hidden="true" />{canUseContacts ? '휴대폰 번호' : '연락처 연동 대기'}</span>
        <span><ChatCircleDots aria-hidden="true" />E2E 메시지</span>
      </div>
    </div>
  );
}

function NetworkOptions({ networks, onSelect }: { networks: WalletNetworkView[]; onSelect: (chainId: string) => void }) {
  return (
    <div className="kw-sheet-options kw-network-options">
      {networks.map((network) => (
        <button className="kw-choice" type="button" key={network.chainId} onClick={() => onSelect(network.chainId)}>
          <span><b>{network.nativeSymbol}</b>{network.network}</span>
          <Check aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function WalletActionSheet({ mode, networks, hostCapabilities, initialChainId, onClose }: WalletActionSheetProps) {
  const [selectedChainId, setSelectedChainId] = useState(initialChainId);
  const [channel, setChannel] = useState<TransferChannel>('took');
  const [addressCopied, setAddressCopied] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const selectedNetwork = networks.find((network) => network.chainId === selectedChainId);
  const transferMode = mode === 'receive' || mode === 'send' ? mode : null;
  const actionLabel = mode === 'receive' ? '받기' : mode === 'send' ? '보내기' : '환전하기';
  const isTookChannel = transferMode !== null && channel === 'took';
  const baseTitle = mode === 'receive'
    ? isTookChannel ? '어떻게 받을까요?' : '받을 네트워크를 선택해 주세요'
    : mode === 'send'
      ? isTookChannel ? '누구에게 툭 줄까요?' : '보낼 네트워크를 선택해 주세요'
      : '환전할 네트워크를 선택해 주세요';
  const title = selectedNetwork
    ? isTookChannel
      ? `${selectedNetwork.network} ${mode === 'receive' ? '툭받기' : '툭주기'}`
      : `${selectedNetwork.network} ${mode === 'receive' ? '주소로 받기' : mode === 'send' ? '주소로 보내기' : actionLabel}`
    : baseTitle;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = layerRef.current?.querySelector<HTMLElement>('.kw-sheet');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
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

  const changeChannel = (nextChannel: TransferChannel) => {
    setChannel(nextChannel);
    setSelectedChainId(undefined);
    setAddressCopied(false);
  };

  const canCopyReceiveAddress = mode === 'receive'
    && !isTookChannel
    && selectedNetwork?.addressStatus === 'ready'
    && typeof selectedNetwork.address === 'string';

  const copyReceiveAddress = async () => {
    if (!canCopyReceiveAddress || !selectedNetwork?.address) return;
    try {
      await navigator.clipboard.writeText(selectedNetwork.address);
      setAddressCopied(true);
    } catch {
      setAddressCopied(false);
    }
  };

  return (
    <div className="kw-sheet-layer" ref={layerRef}>
      <button className="kw-sheet-scrim" type="button" aria-label="닫기" onClick={onClose} />
      <section className="kw-sheet kw-wallet-action-sheet" role="dialog" aria-modal="true" aria-labelledby="kw-wallet-action-title">
        <button className="kw-icon-button kw-sheet-close" type="button" aria-label="닫기" onClick={onClose}><X aria-hidden="true" /></button>
        {transferMode ? <TransferChannelTabs mode={transferMode} channel={channel} onChange={changeChannel} /> : null}
        <div
          id="kw-transfer-channel-panel"
          role={transferMode ? 'tabpanel' : undefined}
          aria-labelledby={transferMode ? `kw-transfer-channel-${channel}-tab` : undefined}
        >
          {selectedNetwork ? (
            <>
              <button className="kw-sheet-back" type="button" onClick={() => setSelectedChainId(undefined)}><ArrowLeft aria-hidden="true" />네트워크 다시 선택</button>
              <h2 className="kw-sheet-title" id="kw-wallet-action-title">{title}</h2>
              <p className="kw-body kw-mt-8">{selectedNetwork.nativeSymbol} · 선택한 지갑 슬롯</p>
              {mode === 'receive' ? (
                isTookChannel ? (
                  <div className="kw-status-panel kw-mt-24">
                    <ChatCircleDots aria-hidden="true" />
                    <strong>툭받기 요청 연결을 준비하고 있어요</strong>
                    <p>실제 수신 주소와 암호화 요청 링크가 모두 준비된 뒤에만 상대방에게 공유할 수 있어요.</p>
                  </div>
                ) : selectedNetwork.addressStatus === 'ready' && selectedNetwork.address ? (
                  <div className="kw-receive-address kw-mt-24">
                    <QrCode aria-hidden="true" />
                    <p className="kw-address">{selectedNetwork.address}</p>
                  </div>
                ) : (
                  <div className="kw-status-panel kw-mt-24">
                    <QrCode aria-hidden="true" />
                    <strong>수신 주소를 준비하고 있어요</strong>
                    <p>실제 키 코어가 주소를 반환하기 전에는 QR이나 임의 주소를 표시하지 않습니다.</p>
                  </div>
                )
              ) : mode === 'send' ? (
                <div className="kw-status-panel kw-mt-24">
                  {isTookChannel ? <PaperPlaneTilt aria-hidden="true" /> : null}
                  <strong>{isTookChannel ? '받는 사람 연결을 준비하고 있어요' : '보낼 수 있는 잔액이 없어요'}</strong>
                  <p>
                    {isTookChannel
                      ? '연락처 권한, 수신자 동의, 잔액·수수료·KYT 결과가 준비된 뒤 툭주기가 활성화됩니다.'
                      : '잔액·주소·수수료·KYT 견적이 준비되면 보내기 절차가 활성화됩니다.'}
                  </p>
                </div>
              ) : (
                <div className="kw-status-panel kw-mt-24">
                  <strong>환전 연결을 준비하고 있어요</strong>
                  <p>실제 K-VWAP 견적과 거래소 실행 연결이 준비되면 환전 절차가 활성화됩니다.</p>
                </div>
              )}
              <button className="kw-button kw-mt-24" type="button" disabled={!canCopyReceiveAddress} onClick={() => void copyReceiveAddress()}>
                {mode === 'receive'
                  ? isTookChannel ? '툭받기 준비 중' : canCopyReceiveAddress ? addressCopied ? '주소를 복사했어요' : '주소 복사' : '주소 준비 중'
                  : mode === 'send'
                    ? isTookChannel ? '툭주기 준비 중' : '보내기 준비 중'
                    : '환전 준비 중'}
              </button>
            </>
          ) : (
            <>
              <h2 className="kw-sheet-title" id="kw-wallet-action-title">{title}</h2>
              {transferMode && isTookChannel ? <TookChannelIntro mode={transferMode} canUseContacts={hostCapabilities.canUseContacts} /> : null}
              <p className="kw-network-options__label">{mode === 'receive' ? '받을 네트워크' : mode === 'send' ? '보낼 네트워크' : '환전할 네트워크'}</p>
              <NetworkOptions networks={networks} onSelect={setSelectedChainId} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
