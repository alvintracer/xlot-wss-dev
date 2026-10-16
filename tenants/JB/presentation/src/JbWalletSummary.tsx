import { ArrowClockwise, CaretDown, CaretRight, CopySimple, Eye, EyeSlash, Plus } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { ReadyWalletHomePayload } from '@took-wss/contracts';
import type { ReadyWalletSummaryProps } from '@took-wss/tenant-kiwoom-presentation';

function shortAddress(address: string): string {
  return address.length > 23 ? `${address.slice(0, 14)}…${address.slice(-8)}` : address;
}

export function JbWalletSummary({ walletHome, balanceHidden, onToggleBalance, onOpenWalletSelector, onAddWallet, onSelectWallet, onRefreshWallet, onShowAction }: ReadyWalletSummaryProps) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | undefined>(undefined);
  const pendingWalletRef = useRef<string | null>(null);
  const [activeWalletId, setActiveWalletId] = useState(walletHome.wallet.walletId);
  const [knownHomes, setKnownHomes] = useState<Record<string, ReadyWalletHomePayload>>({});
  const [copiedWalletId, setCopiedWalletId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [loadingWalletId, setLoadingWalletId] = useState<string | null>(null);
  const wallets = walletHome.wallets.length ? walletHome.wallets : [walletHome.wallet];
  const activeIndex = Math.max(0, wallets.findIndex(({ walletId }) => walletId === activeWalletId));

  useEffect(() => {
    setKnownHomes((previous) => ({ ...previous, [walletHome.wallet.walletId]: walletHome }));
    if (pendingWalletRef.current && pendingWalletRef.current !== walletHome.wallet.walletId) return;
    setActiveWalletId(walletHome.wallet.walletId);
    setLoadingWalletId((current) => current === walletHome.wallet.walletId ? null : current);
    const track = carouselRef.current;
    const index = wallets.findIndex(({ walletId }) => walletId === walletHome.wallet.walletId);
    const card = track?.children.item(index) as HTMLElement | null;
    const firstCard = track?.firstElementChild as HTMLElement | null;
    if (track && card && firstCard) track.scrollTo({ left: card.offsetLeft - firstCard.offsetLeft, behavior: 'instant' });
  }, [walletHome]);

  useEffect(() => () => window.clearTimeout(scrollTimerRef.current), []);

  const selectWallet = async (walletId: string) => {
    if (pendingWalletRef.current === walletId || (walletId === walletHome.wallet.walletId && !pendingWalletRef.current)) return;
    setActiveWalletId(walletId);
    setSelectionError('');
    pendingWalletRef.current = walletId;
    setLoadingWalletId(knownHomes[walletId] ? null : walletId);
    try {
      await onSelectWallet(walletId);
    } catch {
      if (pendingWalletRef.current === walletId) {
        setSelectionError('지갑을 불러오지 못했어요. 다시 선택해 주세요.');
        setActiveWalletId(walletHome.wallet.walletId);
        setLoadingWalletId(null);
        const track = carouselRef.current;
        const index = wallets.findIndex((wallet) => wallet.walletId === walletHome.wallet.walletId);
        const card = track?.children.item(index) as HTMLElement | null;
        const firstCard = track?.firstElementChild as HTMLElement | null;
        if (track && card && firstCard) track.scrollTo({ left: card.offsetLeft - firstCard.offsetLeft, behavior: 'instant' });
      }
    } finally {
      if (pendingWalletRef.current === walletId) pendingWalletRef.current = null;
    }
  };

  const goToWallet = (index: number) => {
    const track = carouselRef.current;
    const card = track?.children.item(index) as HTMLElement | null;
    const firstCard = track?.firstElementChild as HTMLElement | null;
    if (track && card && firstCard) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      track.scrollTo({ left: card.offsetLeft - firstCard.offsetLeft, behavior: reduceMotion ? 'instant' : 'smooth' });
    }
    const wallet = wallets[index];
    if (wallet) void selectWallet(wallet.walletId);
  };

  const onScroll = () => {
    window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const track = carouselRef.current;
      const firstCard = track?.firstElementChild as HTMLElement | null;
      if (!track || !firstCard) return;
      const cardStep = firstCard.offsetWidth + 12;
      const index = Math.max(0, Math.min(wallets.length - 1, Math.round(track.scrollLeft / cardStep)));
      const wallet = wallets[index];
      if (wallet) void selectWallet(wallet.walletId);
    }, 100);
  };

  const copyAddress = async (walletId: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedWalletId(walletId);
    } catch {
      setCopiedWalletId(null);
      setSelectionError('주소를 복사하지 못했어요. 다시 시도해 주세요.');
    }
  };

  return (
    <section className="jb-wallet-summary" aria-label="내 지갑 요약">
      <div
        ref={carouselRef}
        className="jb-wallet-carousel"
        data-testid="jb-wallet-carousel"
        aria-label="지갑 카드"
        onScroll={onScroll}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' && activeIndex < wallets.length - 1) { event.preventDefault(); goToWallet(activeIndex + 1); }
          if (event.key === 'ArrowLeft' && activeIndex > 0) { event.preventDefault(); goToWallet(activeIndex - 1); }
        }}
        tabIndex={wallets.length > 1 ? 0 : -1}
      >
        {wallets.map((wallet, index) => {
          const home = wallet.walletId === walletHome.wallet.walletId ? walletHome : knownHomes[wallet.walletId];
          const address = home?.networks.find((network) => network.addressStatus === 'ready' && network.address)?.address;
          const selected = wallet.walletId === walletHome.wallet.walletId;
          const loading = loadingWalletId === wallet.walletId && !selected;
          return (
            <article key={wallet.walletId} className="jb-wallet-card" aria-label={`${index + 1}번째 지갑, ${wallet.label}`} aria-busy={loading}>
              <div className="jb-wallet-card__heading">
                <span className="jb-wallet-card__emblem" aria-hidden="true">✦</span>
                <button type="button" className="jb-wallet-card__wallet-name" onClick={onOpenWalletSelector} disabled={!selected}>
                  <span>{wallet.label}</span><CaretDown size={13} aria-hidden="true" />
                </button>
                {selected ? <button className="jb-wallet-card__refresh" type="button" onClick={onRefreshWallet} aria-label={`${wallet.label} 잔액 새로고침`}>
                  <ArrowClockwise size={16} aria-hidden="true" />
                </button> : null}
                {activeWalletId === wallet.walletId ? (
                  <button className="jb-wallet-card__add" type="button" onClick={onAddWallet} aria-label="지갑 추가하기">
                    <Plus size={16} weight="bold" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div className="jb-wallet-card__address">
                <span>{address ? shortAddress(address) : home ? '주소 준비 중' : '주소 확인 전'}</span>
                <button type="button" onClick={() => address && void copyAddress(wallet.walletId, address)} disabled={!address} aria-label={`${wallet.label} 주소 복사`}>
                  <CopySimple size={16} weight="bold" aria-hidden="true" />
                </button>
                {copiedWalletId === wallet.walletId ? <small role="status">복사됨</small> : null}
              </div>
              <div className="jb-wallet-card__balance">
                <strong>{balanceHidden ? '••••' : home ? home.totalFiat?.display ?? '—' : '잔액 확인 전'}</strong>
                <button type="button" onClick={onToggleBalance} aria-label={balanceHidden ? '잔액 보기' : '잔액 숨기기'} aria-pressed={balanceHidden}>
                  {balanceHidden ? <EyeSlash size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  <span>{balanceHidden ? '보기' : '숨김'}</span>
                </button>
              </div>
              <div className="jb-wallet-card__actions" aria-label="선택한 지갑 주요 기능">
                <button type="button" disabled={!selected} onClick={() => onShowAction('receive')}>채우기</button>
                <button type="button" disabled={!selected} onClick={() => onShowAction('send')}>보내기</button>
                <button type="button" disabled={!selected} onClick={() => onShowAction('exchange')}>환전하기</button>
              </div>
              <button className="jb-wallet-card__footer" type="button" disabled={!selected} onClick={() => document.getElementById('kw-selected-wallet-assets-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <span>한눈에 쏙! 자산관리의 시작</span><CaretRight size={18} aria-hidden="true" />
              </button>
              {loading ? <div className="jb-wallet-card__loading" role="status"><span className="jb-wallet-card__loading-mark" aria-hidden="true" /><strong>지갑을 불러오는 중이에요</strong><span>자산과 기능을 확인하고 있어요</span></div> : null}
            </article>
          );
        })}
      </div>
      <div className="jb-wallet-carousel__controls">
        <div className="jb-wallet-carousel__dots" aria-label="지갑 선택">
          {wallets.map((wallet, index) => <button key={wallet.walletId} type="button" aria-label={`${index + 1}번째 지갑 보기`} aria-current={activeWalletId === wallet.walletId ? 'true' : undefined} onClick={() => goToWallet(index)} />)}
        </div>
      </div>
      {selectionError ? <p className="jb-wallet-carousel__error" role="alert">{selectionError}</p> : null}
    </section>
  );
}
