import { ArrowClockwise, CaretDown, Eye, EyeSlash, Plus } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { ReadyWalletHomePayload } from '@took-wss/contracts';
import type { ReadyWalletSummaryProps } from '@took-wss/tenant-kiwoom-presentation';

export interface NamuPortfolioCardProps {
  walletLabel: string;
  total: string;
  detail: string;
  asOf: string;
  hidden?: boolean;
  onSelectWallet?: () => void;
  onAddWallet?: () => void;
  onToggleBalance?: () => void;
  onRefresh?: () => void;
  onReceive?: () => void;
  onSend?: () => void;
  onExchange?: () => void;
  loading?: boolean;
  selected?: boolean;
}

export function NamuPortfolioCard({ walletLabel, total, detail, asOf, hidden = false, onSelectWallet, onAddWallet, onToggleBalance, onRefresh, onReceive, onSend, onExchange, loading = false, selected = true }: NamuPortfolioCardProps) {
  return <section className="namu-portfolio-card" aria-label={`${walletLabel} 자산 요약`} aria-busy={loading}>
    <div className="namu-portfolio-card__head">
      <button className="namu-portfolio-card__select" type="button" onClick={onSelectWallet} disabled={!onSelectWallet} aria-label={`${walletLabel} 선택`}>
        <strong>{walletLabel}</strong><CaretDown size={17} aria-hidden="true" />
      </button>
      <div className="namu-portfolio-card__tools">
        <span>{asOf}</span>
        <button type="button" aria-label="자산 새로고침" onClick={onRefresh} disabled={!onRefresh}><ArrowClockwise size={17} aria-hidden="true" /></button>
        <button type="button" aria-label={hidden ? '금액 보기' : '금액 숨기기'} aria-pressed={hidden} onClick={onToggleBalance} disabled={!onToggleBalance}>{hidden ? <EyeSlash size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button>
      </div>
    </div>
    <strong className="namu-portfolio-card__amount">{hidden ? '••••' : total}</strong>
    <p className="namu-portfolio-card__detail">{detail}</p>
    <div className="namu-portfolio-card__inset">
      <span>{selected ? '선택한 지갑' : '다른 지갑'}</span><strong>{walletLabel}</strong>
      <button type="button" aria-label="지갑 추가" onClick={onAddWallet} disabled={!onAddWallet}><Plus size={18} aria-hidden="true" /></button>
    </div>
    <div className="namu-portfolio-card__actions" aria-label="지갑 주요 기능">
      <button type="button" onClick={onReceive} disabled={!onReceive}>받기</button>
      <button type="button" onClick={onSend} disabled={!onSend}>보내기</button>
      <button type="button" onClick={onExchange} disabled={!onExchange}>바꾸기</button>
    </div>
    {loading ? <div className="namu-portfolio-card__loading" role="status">지갑을 불러오고 있어요</div> : null}
  </section>;
}

export function NamuWalletSummary({ walletHome, balanceHidden, onToggleBalance, onOpenWalletSelector, onAddWallet, onSelectWallet, onShowAction, onRefreshWallet }: ReadyWalletSummaryProps) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | undefined>(undefined);
  const pendingWalletRef = useRef<string | null>(null);
  const [activeWalletId, setActiveWalletId] = useState(walletHome.wallet.walletId);
  const [knownHomes, setKnownHomes] = useState<Record<string, ReadyWalletHomePayload>>({});
  const [loadingWalletId, setLoadingWalletId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const wallets = walletHome.wallets.length ? walletHome.wallets : [walletHome.wallet];
  const activeIndex = Math.max(0, wallets.findIndex(({ walletId }) => walletId === activeWalletId));

  useEffect(() => {
    setKnownHomes((previous) => ({ ...previous, [walletHome.wallet.walletId]: walletHome }));
    if (pendingWalletRef.current && pendingWalletRef.current !== walletHome.wallet.walletId) return;
    setActiveWalletId(walletHome.wallet.walletId);
    setLoadingWalletId(null);
    const track = carouselRef.current;
    const card = track?.children.item(wallets.findIndex(({ walletId }) => walletId === walletHome.wallet.walletId)) as HTMLElement | null;
    if (track && card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft - 10, behavior: 'instant' });
  }, [walletHome]);

  useEffect(() => () => window.clearTimeout(scrollTimerRef.current), []);

  const selectWallet = async (walletId: string) => {
    if (pendingWalletRef.current === walletId || walletId === walletHome.wallet.walletId && !pendingWalletRef.current) return;
    pendingWalletRef.current = walletId;
    setActiveWalletId(walletId);
    setLoadingWalletId(knownHomes[walletId] ? null : walletId);
    setSelectionError('');
    try {
      await onSelectWallet(walletId);
    } catch {
      if (pendingWalletRef.current === walletId) {
        setActiveWalletId(walletHome.wallet.walletId);
        setLoadingWalletId(null);
        setSelectionError('지갑을 불러오지 못했어요. 다시 선택해 주세요.');
        const track = carouselRef.current;
        const card = track?.children.item(wallets.findIndex(({ walletId: id }) => id === walletHome.wallet.walletId)) as HTMLElement | null;
        if (track && card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft - 10, behavior: 'instant' });
      }
    } finally {
      if (pendingWalletRef.current === walletId) pendingWalletRef.current = null;
    }
  };

  const goToWallet = (index: number) => {
    const track = carouselRef.current;
    const card = track?.children.item(index) as HTMLElement | null;
    if (track && card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft - 10, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    const wallet = wallets[index];
    if (wallet) void selectWallet(wallet.walletId);
  };

  const onScroll = () => {
    window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const track = carouselRef.current;
      const cards = track ? Array.from(track.children) as HTMLElement[] : [];
      if (!track || !cards.length) return;
      const index = cards.reduce((nearest, card, current) => Math.abs(card.offsetLeft - track.offsetLeft - 10 - track.scrollLeft) < Math.abs(cards[nearest]!.offsetLeft - track.offsetLeft - 10 - track.scrollLeft) ? current : nearest, 0);
      const wallet = wallets[index];
      if (wallet) void selectWallet(wallet.walletId);
    }, 120);
  };

  return <section className="namu-wallet-carousel" aria-label="내 지갑 슬롯">
    <div ref={carouselRef} className="namu-wallet-carousel__track" data-multiple={wallets.length > 1} data-testid="namu-wallet-carousel" aria-label="지갑 카드" onScroll={onScroll}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' && activeIndex < wallets.length - 1) { event.preventDefault(); goToWallet(activeIndex + 1); }
        if (event.key === 'ArrowLeft' && activeIndex > 0) { event.preventDefault(); goToWallet(activeIndex - 1); }
      }} tabIndex={wallets.length > 1 ? 0 : -1}>
      {wallets.map((wallet) => {
        const home = wallet.walletId === walletHome.wallet.walletId ? walletHome : knownHomes[wallet.walletId];
        const selected = wallet.walletId === walletHome.wallet.walletId;
        const timestamp = home ? new Date(home.valuation.asOf) : null;
        const asOf = timestamp && !Number.isNaN(timestamp.getTime()) ? `${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)} 기준` : '조회 기준';
        const detail = !home ? '지갑을 선택해 자산을 확인해요' : home.totalFiat?.stale ? '금액 업데이트가 지연되고 있어요' : !home.totalFiat ? '금액 정보를 사용할 수 없어요' : home.assets.length === 0 ? '보유 자산이 없어요' : `보유 자산 ${home.assets.length}개`;
        return <NamuPortfolioCard key={wallet.walletId} walletLabel={wallet.label} total={home?.totalFiat?.display ?? '—'} detail={detail} asOf={asOf} hidden={balanceHidden} selected={selected}
          loading={loadingWalletId === wallet.walletId && !selected}
          onSelectWallet={selected ? onOpenWalletSelector : undefined}
          onAddWallet={selected ? onAddWallet : undefined}
          onToggleBalance={onToggleBalance}
          onRefresh={selected ? onRefreshWallet : undefined}
          onReceive={selected ? () => onShowAction('receive') : undefined}
          onSend={selected ? () => onShowAction('send') : undefined}
          onExchange={selected ? () => onShowAction('exchange') : undefined}
        />;
      })}
    </div>
    {wallets.length > 1 ? <div className="namu-wallet-carousel__dots" aria-label="지갑 선택">
      {wallets.map((wallet, index) => <button key={wallet.walletId} type="button" aria-label={`${index + 1}번째 지갑 보기`} aria-current={activeWalletId === wallet.walletId ? 'true' : undefined} onClick={() => goToWallet(index)} />)}
    </div> : null}
    {selectionError ? <p className="namu-wallet-carousel__error" role="alert">{selectionError}</p> : null}
  </section>;
}
