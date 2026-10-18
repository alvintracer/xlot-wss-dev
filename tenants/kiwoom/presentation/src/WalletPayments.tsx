import { ArrowLeft, ArrowRight, ArrowsLeftRight, CaretLeft, CaretRight, Check, CopySimple, CreditCard, DownloadSimple, GearSix, Plus, QrCode, Scan, ShareNetwork, X } from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { HostRecipientPickResult, PhysicalCardInfo, PreparedTransfer, ReadyWalletHomePayload, SecureTransactionSigningRequest, SecureTransactionSigningResult, SubmitTransferRequest, TransferExecutionResult, WalletPaymentRequest, WalletReceiveAssetView } from '@took-wss/contracts';
import { formatAtomic, parseAmountToAtomic, parseKrwToAtomic } from './WalletActionSheet';
import { AssetIcon } from './AssetIcon';
import { ChainIcon } from './ChainIcon';
import { downloadPaymentEvidenceCsv } from './paymentEvidence';
import { downloadPaymentReceiptPng, paymentReceiptDetails } from './paymentReceipt';
import { walletPublicAssetUrl } from './publicAssetUrl';

const paymentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const evmChains = new Set(['ethereum', 'polygon', 'arbitrum', 'base', 'bnb']);

export function parsePaymentQr(value: string, origin: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin && !['took-wss.com', 'www.took-wss.com', 'took-wss.vercel.app', 'www.took-wss.vercel.app'].includes(url.hostname)) return null;
    const publicId = /^\/pay\/([0-9a-f-]{36})\/?$/i.exec(url.pathname)?.[1];
    if (publicId && paymentId.test(publicId)) return publicId;
    if (!/^\/(kiwoom|jb|namu)\/app\/?$/.test(url.pathname)) return null;
    const id = new URLSearchParams(url.hash.slice(1)).get('payment');
    return id && paymentId.test(id) ? id : null;
  } catch { return null; }
}

export function isOwnPaymentConfirmed(
  requestStatus: WalletPaymentRequest['status'] | undefined,
  resultStatus: TransferExecutionResult['status'] | undefined,
  submissionStarted: boolean,
): boolean {
  const ownSubmission = submissionStarted || resultStatus === 'submitted' || resultStatus === 'processing' || resultStatus === 'confirmed';
  return ownSubmission && requestStatus === 'confirmed';
}

function paymentUrl(id: string): string {
  return `${paymentHostOrigin()}/pay/${encodeURIComponent(id)}`;
}

function paymentHostOrigin(): string {
  try { return document.referrer ? new URL(document.referrer).origin : window.location.origin; }
  catch { return window.location.origin; }
}

function shortAddress(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function amountText(request: WalletPaymentRequest): string {
  return `${formatAtomic(BigInt(request.amountAtomic), request.decimals, request.decimals)} ${request.assetSymbol}`;
}
function estimatedKrw(request: WalletPaymentRequest, homes: Record<string, ReadyWalletHomePayload>): bigint | null {
  const asset = Object.values(homes).flatMap((home) => home.receiveAssets)
    .find((item) => item.assetId === request.assetId && item.chainId === request.chainId && item.referencePrice && !item.referencePrice.stale);
  const price = asset?.referencePrice?.decimal;
  if (!price || !/^\d+(?:\.\d+)?$/.test(price)) return null;
  const [whole, fraction = ''] = price.split('.');
  const units = BigInt(`${whole}${fraction}`);
  const denominator = 10n ** BigInt(request.decimals + fraction.length);
  return (BigInt(request.amountAtomic) * units + denominator / 2n) / denominator;
}
function stateText(status: WalletPaymentRequest['status']): string {
  return status === 'confirmed' ? '결제 완료' : status === 'failed' ? '결제 실패'
    : status === 'expired' ? '요청 만료' : status === 'processing' ? '결제 진행 중' : '결제 대기';
}
function paymentError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'payment_request_mismatch' || code === 'payment_request_unavailable') return '결제 요청이 변경되었거나 이미 사용 중이에요. 새 QR을 받아 주세요.';
  if (code === 'payment_request_not_found') return '결제 QR을 찾을 수 없어요.';
  if (code === 'insufficient_balance' || code === 'insufficient_balance_for_fee') return '잔액 또는 네트워크 수수료가 부족해요.';
  return '결제 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

interface Props {
  tenantId: string;
  logoText: string;
  paymentCoinLogoUrl?: string;
  walletHome: ReadyWalletHomePayload;
  incomingPaymentRequestId?: string;
  onLoadWalletHome: (walletId: string) => Promise<ReadyWalletHomePayload>;
  onSelectWallet: (walletId: string) => Promise<void>;
  onRequestRecipientPick: (mode: 'qr' | 'contacts', chainId: string) => Promise<HostRecipientPickResult>;
  onCreatePaymentRequest: (input: { walletId: string; chainId: string; assetId: string; amountAtomic: string }) => Promise<WalletPaymentRequest>;
  onGetPaymentRequest: (id: string) => Promise<WalletPaymentRequest>;
  onListPaymentRequests: (walletId: string) => Promise<WalletPaymentRequest[]>;
  onListSpentPayments: (walletId: string) => Promise<WalletPaymentRequest[]>;
  onPrepareTransfer: (request: { walletId: string; chainId: string; assetId: string; amountAtomic: string; recipient: string; channel: 'address'; paymentRequestId: string; complianceReason?: string }) => Promise<PreparedTransfer>;
  onRequestSecureTransactionSignature: (request: SecureTransactionSigningRequest) => Promise<SecureTransactionSigningResult>;
  onSubmitTransfer: (request: SubmitTransferRequest) => Promise<TransferExecutionResult>;
  onTransactionSubmitted: (sourceWalletId: string) => void;
  onFocusedOverlayChange: (focused: boolean) => void;
  onScanPhysicalCard?: () => Promise<PhysicalCardInfo | null>;
  onCancelPhysicalCardScan?: () => Promise<void>;
}

function Sheet({ title, onClose, onLeadingAction, leadingLabel, leadingIcon, children }: {
  title: string; onClose: () => void; children: ReactNode;
  onLeadingAction?: () => void; leadingLabel?: string; leadingIcon?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      const focusables = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []);
      if (!focusables.length) return;
      const first = focusables[0]; const last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [onClose]);
  return <div className="kw-payment-layer"><section className="kw-payment-sheet" role="dialog" aria-modal="true" aria-label={title}>
    <header className="kw-payment-sheet__header">{onLeadingAction ? <button className="kw-payment-sheet__leading" type="button" aria-label={leadingLabel} onClick={onLeadingAction}>{leadingIcon}</button> : null}<strong>{title}</strong><button ref={closeRef} type="button" aria-label="닫기" onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="kw-payment-sheet__body">{children}</div>
  </section></div>;
}

function PaymentProgress({ title, detail }: { title: string; detail: string }) {
  return <div className="kw-payment-progress" role="status" aria-live="polite" aria-busy="true">
    <span className="kw-payment-progress__track" aria-hidden="true"><span /></span>
    <strong>{title}</strong><p>{detail}</p>
  </div>;
}

function PaymentCoinEffect({ logoUrl, direction }: { logoUrl?: string; direction: 'send' | 'receive' }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 1750);
    return () => window.clearTimeout(timeout);
  }, []);
  if (!visible) return null;
  return <div className={`kw-payment-coin-effect kw-payment-coin-effect--${direction}`} aria-hidden="true">
    <span className="kw-payment-coin-effect__trail" />
    <span className="kw-payment-coin-effect__coin">{logoUrl ? <img src={walletPublicAssetUrl(logoUrl)} alt="" /> : <CreditCard size={30} weight="fill" />}</span>
    <span className="kw-payment-coin-effect__ring" />
  </div>;
}

function PaymentReceiptScreen({ payment, direction, walletLabel, onBack, onClose }: {
  payment: WalletPaymentRequest; direction: 'sent' | 'received'; walletLabel?: string;
  onBack: () => void; onClose: () => void;
}) {
  const [error, setError] = useState('');
  const details = paymentReceiptDetails(payment, direction, walletLabel);
  return <Sheet title="결제 영수증" onClose={onClose} onLeadingAction={onBack} leadingLabel="결제 내역으로" leadingIcon={<ArrowLeft aria-hidden="true" />}>
    <article className="kw-payment-receipt">
      <span className="kw-payment-receipt__eyebrow">WALLET PAYMENT</span>
      <h2>{details.title}</h2><strong className="kw-payment-receipt__amount">{details.amount}</strong>
      <div className="kw-payment-receipt__rows">{details.rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p>{details.note}</p>
    </article>
    {error ? <p className="kw-payment-message" role="alert">{error}</p> : null}
    <button className="kw-button kw-payment-primary" type="button" onClick={() => void downloadPaymentReceiptPng(payment, direction, walletLabel)
      .then(() => setError('')).catch(() => setError('영수증 이미지를 저장하지 못했어요. 다시 시도해 주세요.'))}>
      <DownloadSimple size={18} aria-hidden="true" /> 영수증 이미지 저장·공유
    </button>
  </Sheet>;
}

function WalletCardSheet({ props, onClose }: { props: Props; onClose: () => void }) {
  const storageKey = `took-wss:card-${props.onScanPhysicalCard ? 'physical' : 'showcase'}:${props.tenantId}:${props.walletHome.wallets[0]?.walletId ?? props.walletHome.wallet.walletId}`;
  const [physicalCard, setPhysicalCard] = useState<PhysicalCardInfo | null>(() => {
    if (!props.onScanPhysicalCard) return null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${storageKey}:card`) ?? 'null') as PhysicalCardInfo | null;
      return saved && /^[0-9a-f]{32}$/i.test(saved.cardIdHex) && saved.lifecycle === 'KEY_READY' ? saved : null;
    } catch { return null; }
  });
  const [registered, setRegistered] = useState(() => {
    if (props.onScanPhysicalCard) return false;
    try { return window.localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState('');
  const scanActiveRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scanActiveRef.current && props.onCancelPhysicalCardScan) void props.onCancelPhysicalCardScan().catch(() => undefined);
    };
  }, [props.onCancelPhysicalCardScan]);
  const [linked, setLinked] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(`${storageKey}:wallets`) ?? '[]') as unknown;
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && props.walletHome.wallets.some((wallet) => wallet.walletId === id)) : [];
    } catch { return []; }
  });
  const [chainLinks, setChainLinks] = useState<Record<string, string[]>>({});
  const [homes, setHomes] = useState<Record<string, ReadyWalletHomePayload>>({ [props.walletHome.wallet.walletId]: props.walletHome });
  const [spent, setSpent] = useState<WalletPaymentRequest[]>([]);
  const [spendState, setSpendState] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading');
  const [receipt, setReceipt] = useState<WalletPaymentRequest | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    try { window.localStorage.setItem(`${storageKey}:wallets`, JSON.stringify(linked)); } catch { /* Private mode remains usable. */ }
    for (const walletId of linked) {
      if (homes[walletId]) continue;
      void props.onLoadWalletHome(walletId).then((home) => setHomes((old) => ({ ...old, [walletId]: home }))).catch(() => undefined);
    }
    setSpendState('loading');
    void Promise.allSettled(props.walletHome.wallets.map((wallet) => props.onListSpentPayments(wallet.walletId)))
      .then((results) => {
        setSpent(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setSpendState(results.every((result) => result.status === 'rejected') ? 'error'
          : results.some((result) => result.status === 'rejected') ? 'partial' : 'ready');
      });
  }, [linked, props.onLoadWalletHome, props.onListSpentPayments, props.walletHome.wallets]);
  useEffect(() => {
    try { setChainLinks(JSON.parse(window.localStorage.getItem(`${storageKey}:chains`) ?? '{}') as Record<string, string[]>); }
    catch { setChainLinks({}); }
  }, []);
  const toggleChain = (walletId: string, chainId: string) => {
    setChainLinks((old) => {
      const next = { ...old, [walletId]: old[walletId]?.includes(chainId)
        ? old[walletId]!.filter((id) => id !== chainId) : [...(old[walletId] ?? []), chainId] };
      try { window.localStorage.setItem(`${storageKey}:chains`, JSON.stringify(next)); } catch { /* Keep this session. */ }
      return next;
    });
  };
  const month = new Date(); month.setDate(1); month.setMonth(month.getMonth() + monthOffset);
  const monthly = spent.filter((item) => new Date(item.createdAt).getFullYear() === month.getFullYear()
    && new Date(item.createdAt).getMonth() === month.getMonth());
  const settledMonthly = monthly.filter((item) => item.status === 'confirmed');
  const linkedCount = linked.reduce((count, walletId) => count + (chainLinks[walletId]?.length ?? 0), 0);
  const cardReady = registered || physicalCard !== null;
  const registerCard = async () => {
    setCardBusy(true);
    setCardError('');
    scanActiveRef.current = true;
    try {
      const scanned = await props.onScanPhysicalCard?.();
      if (!mountedRef.current) return;
      if (scanned) {
        setPhysicalCard(scanned);
        try { window.localStorage.setItem(`${storageKey}:card`, JSON.stringify(scanned)); } catch { /* A scan remains usable this session. */ }
      } else setRegistered(true);
      setLinked([props.walletHome.wallet.walletId]);
      const initialChains = props.walletHome.networks.filter((network) => network.addressStatus === 'ready' && evmChains.has(network.chainId)).map((network) => network.chainId);
      setChainLinks((old) => ({ ...old, [props.walletHome.wallet.walletId]: initialChains }));
      try { window.localStorage.setItem(`${storageKey}:chains`, JSON.stringify({ ...chainLinks, [props.walletHome.wallet.walletId]: initialChains })); } catch { /* Keep this session. */ }
      if (!props.onScanPhysicalCard) {
        try { window.localStorage.setItem(storageKey, '1'); } catch { /* Keep this session. */ }
      }
    } catch (error) { if (mountedRef.current) setCardError(error instanceof Error ? error.message : '카드를 읽지 못했어요. 다시 시도해 주세요.'); }
    finally { scanActiveRef.current = false; if (mountedRef.current) setCardBusy(false); }
  };
  if (receipt) return <PaymentReceiptScreen payment={receipt} direction="sent" onBack={() => setReceipt(null)} onClose={onClose} />;
  return <Sheet title="월렛 카드" onClose={onClose}>
    <div className={`kw-wallet-card-visual${cardReady ? '' : ' kw-wallet-card-visual--locked'}`}>
      <div className="kw-wallet-card-visual__shine" aria-hidden="true" />
      <div className="kw-wallet-card-visual__top"><span>WALLET CARD</span><CreditCard size={25} weight="duotone" aria-hidden="true" /></div>
      <div className="kw-wallet-card-visual__chip" aria-hidden="true" />
      <div className="kw-wallet-card-visual__bottom"><strong>{props.logoText}</strong><span>{cardReady ? `${linked.length}개 월렛 · ${linkedCount}개 체인` : '나의 월렛을 연결해 보세요'}</span></div>
      {!cardReady ? <button className="kw-wallet-card-visual__register" type="button" disabled={cardBusy} onClick={() => void registerCard()}><Plus size={22} aria-hidden="true" /><span>{cardBusy ? '카드를 태그해 주세요' : '카드 등록하기'}</span></button> : null}
    </div>
    {cardError ? <p className="kw-payment-note" role="alert">{cardError}</p> : null}
    {physicalCard ? <p className="kw-payment-note">NFC 카드 확인됨 · {physicalCard.cardIdHex.slice(0, 8)}…{physicalCard.cardIdHex.slice(-6)}. 결제 서명은 아직 연결되지 않았어요.</p>
      : <p className="kw-payment-note">연결된 지갑과 결제 내역을 여기서 확인할 수 있어요.</p>}
    {cardReady ? <section className="kw-payment-block" aria-labelledby="kw-card-wallets-title">
      <div className="kw-payment-block__heading"><h3 id="kw-card-wallets-title">연결된 월렛 관리</h3><small>{linked.length}개 월렛</small></div>
      <div className="kw-card-wallet-list">{props.walletHome.wallets.map((wallet) => {
        const active = linked.includes(wallet.walletId);
        const home = homes[wallet.walletId];
        const chains = home?.networks.filter((network) => network.addressStatus === 'ready' && evmChains.has(network.chainId)) ?? [];
        return <div className="kw-card-wallet" key={wallet.walletId}>
          <button type="button" className="kw-card-wallet__row" aria-pressed={active} onClick={() => setLinked((old) => active ? old.filter((id) => id !== wallet.walletId) : [...old, wallet.walletId])}>
            <span className="kw-card-wallet__icon"><CreditCard size={19} aria-hidden="true" /></span><span><strong>{wallet.label}</strong><small>{active ? '카드 화면에 연결됨' : '탭해서 연결'}</small></span><span className="kw-card-wallet__check">{active ? <Check size={16} weight="bold" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}</span>
          </button>
          {active ? <div className="kw-card-wallet__chains">{chains.length ? chains.map((network) => <button type="button" key={network.chainId}
            aria-pressed={chainLinks[wallet.walletId]?.includes(network.chainId) ?? false} onClick={() => toggleChain(wallet.walletId, network.chainId)}>{network.network}</button>) : <small>연결 가능한 EVM 체인을 확인 중이에요.</small>}</div> : null}
        </div>;
      })}</div>
    </section> : null}
    <section className="kw-payment-block" aria-labelledby="kw-card-spend-title">
      <div className="kw-payment-block__heading"><h3 id="kw-card-spend-title">쓴 금액</h3><div className="kw-payment-month"><button type="button" aria-label="이전 달" onClick={() => setMonthOffset((value) => value - 1)}><CaretLeft aria-hidden="true" /></button><strong>{month.getMonth() + 1}월</strong><button type="button" aria-label="다음 달" disabled={monthOffset >= 0} onClick={() => setMonthOffset((value) => value + 1)}><CaretRight aria-hidden="true" /></button></div></div>
      <strong className="kw-payment-spend">{spendState === 'loading' ? '내역 확인 중' : spendState === 'error' ? '내역 확인 필요' : settledMonthly.length === 0 ? '0원' : settledMonthly.every((item) => item.referenceAmountKrw || estimatedKrw(item, homes) !== null)
        ? `약 ${settledMonthly.reduce((sum, item) => sum + (item.referenceAmountKrw ? BigInt(item.referenceAmountKrw) : estimatedKrw(item, homes) ?? 0n), 0n).toLocaleString('ko-KR')}원` : '원화 합계 확인 중'}</strong>
      <small className="kw-payment-note">QR 결제 내역을 함께 보여줘요. 카드 결제는 연결된 뒤 표시됩니다. 원화 금액은 요청 시점의 참고액을 우선 사용해요.</small>
      {spendState === 'partial' ? <p className="kw-payment-note" role="status">일부 월렛 내역을 불러오지 못했어요. 확인된 내역을 먼저 표시합니다.</p> : null}
      <div className="kw-payment-history">{spendState === 'loading' ? <p>결제 내역을 불러오고 있어요.</p> : spendState === 'error' ? <p>결제 내역을 불러오지 못했어요. 다시 열어 주세요.</p> : monthly.length === 0 ? <p>이번 달 결제 내역이 없어요.</p> : (showAll ? monthly : monthly.slice(0, 3)).map((item) => <div key={item.id}><span><strong>QR 결제</strong><small>{new Date(item.createdAt).toLocaleDateString('ko-KR')} · {stateText(item.status)}</small></span><b>{amountText(item)}</b>{item.status === 'confirmed' ? <button type="button" className="kw-payment-history__receipt" onClick={() => setReceipt(item)}>영수증</button> : null}</div>)}</div>
      {monthly.length > 3 ? <button className="kw-payment-more" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? '접기' : '내역 더보기'} <ArrowRight size={16} aria-hidden="true" /></button> : null}
    </section>
  </Sheet>;
}

type PosPage = 'main' | 'asset' | 'chain' | 'manage' | 'evidence';
type PosUnit = 'krw' | 'token';

function posAssets(home: ReadyWalletHomePayload | null): WalletReceiveAssetView[] {
  if (!home) return [];
  return home.receiveAssets.filter((asset) => evmChains.has(asset.chainId) && asset.transferStatus === 'enabled'
    && home.networks.some((network) => network.chainId === asset.chainId && network.addressStatus === 'ready'));
}

function posReferenceKrw(atomic: string, asset: WalletReceiveAssetView): string | null {
  const price = asset.referencePrice;
  if (!price || price.stale || !/^\d+(?:\.\d+)?$/.test(price.decimal)) return null;
  const [whole, fraction = ''] = price.decimal.split('.');
  const denominator = 10n ** BigInt(asset.decimals + fraction.length);
  return ((BigInt(atomic) * BigInt(`${whole}${fraction}`) + denominator / 2n) / denominator).toString();
}

function PosSheet({ props, onClose, onOpenCard }: { props: Props; onClose: () => void; onOpenCard: () => void }) {
  const storageKey = `took-wss:pos-defaults:${props.tenantId}:${props.walletHome.wallets[0]?.walletId ?? props.walletHome.wallet.walletId}`;
  const [defaults] = useState<{ walletId?: string; symbol?: string; chainId?: string }>(() => {
    try { return JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as { walletId?: string; symbol?: string; chainId?: string }; }
    catch { return {}; }
  });
  const [walletId, setWalletId] = useState(() => props.walletHome.wallets.some((wallet) => wallet.walletId === defaults.walletId)
    ? defaults.walletId! : props.walletHome.wallet.walletId);
  const [loadedHome, setLoadedHome] = useState<ReadyWalletHomePayload | null>(null);
  const [walletError, setWalletError] = useState('');
  const [page, setPage] = useState<PosPage>('main');
  const [tab, setTab] = useState<'qr' | 'card'>('qr');
  const [symbol, setSymbol] = useState(defaults.symbol ?? 'USDC');
  const [chainId, setChainId] = useState(defaults.chainId ?? '');
  const [unit, setUnit] = useState<PosUnit>('krw');
  const [amount, setAmount] = useState('');
  const [request, setRequest] = useState<WalletPaymentRequest | null>(null);
  const [recent, setRecent] = useState<WalletPaymentRequest[]>([]);
  const [receipt, setReceipt] = useState<WalletPaymentRequest | null>(null);
  const [evidenceReload, setEvidenceReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [evidence, setEvidence] = useState<WalletPaymentRequest[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState(() => { const date = new Date(); date.setDate(1); return date.toLocaleDateString('sv-SE'); });
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const home = walletId === props.walletHome.wallet.walletId ? props.walletHome
    : loadedHome?.wallet.walletId === walletId ? loadedHome : null;
  const assets = posAssets(home);
  const symbols = [...new Set(assets.map((item) => item.symbol))];
  const selectedSymbol = symbols.includes(symbol) ? symbol : assets.find((item) => item.symbol === 'USDC')?.symbol ?? symbols[0];
  const chainAssets = assets.filter((item) => item.symbol === selectedSymbol);
  const asset = chainAssets.find((item) => item.chainId === chainId) ?? chainAssets[0];
  const amountAtomic = asset ? unit === 'krw'
    ? parseKrwToAtomic(amount, asset.referencePrice?.stale ? undefined : asset.referencePrice?.decimal, asset.decimals)
    : parseAmountToAtomic(amount, asset.decimals) : null;
  const secondaryAmount = amountAtomic && asset ? unit === 'krw'
    ? `약 ${formatAtomic(BigInt(amountAtomic), asset.decimals, asset.decimals)} ${asset.symbol}`
    : (() => { const krw = posReferenceKrw(amountAtomic, asset); return krw ? `약 ${BigInt(krw).toLocaleString('ko-KR')}원` : null; })() : null;
  const filteredEvidence = evidence.filter((item) => {
    const day = new Date(item.confirmedAt ?? item.createdAt).toLocaleDateString('sv-SE');
    return day >= dateFrom && day <= dateTo;
  });
  const selectedEvidence = filteredEvidence.filter((item) => selectedIds.has(item.id));

  useEffect(() => {
    if (walletId === props.walletHome.wallet.walletId) return;
    let active = true;
    setWalletError('');
    void props.onLoadWalletHome(walletId).then((next) => { if (active) setLoadedHome(next); })
      .catch(() => { if (active) setWalletError('월렛 정보를 불러오지 못했어요. 다시 선택해 주세요.'); });
    return () => { active = false; };
  }, [walletId, props.walletHome.wallet.walletId, props.onLoadWalletHome]);
  useEffect(() => {
    if (!home) return;
    void props.onListPaymentRequests(home.wallet.walletId).then(setRecent).catch(() => setRecent([]));
  }, [home?.wallet.walletId, props.onListPaymentRequests]);
  useEffect(() => {
    if (page !== 'evidence') return;
    let active = true;
    setEvidenceLoading(true); setMessage('');
    void Promise.allSettled(props.walletHome.wallets.map((wallet) => props.onListPaymentRequests(wallet.walletId)))
      .then((results) => {
        if (!active) return;
        if (results.some((item) => item.status === 'rejected')) setMessage('일부 월렛의 결제 내역을 불러오지 못했어요.');
        const rows = results.flatMap((item) => item.status === 'fulfilled' ? item.value : [])
          .filter((item) => item.status === 'confirmed').sort((a, b) => (b.confirmedAt ?? b.createdAt).localeCompare(a.confirmedAt ?? a.createdAt));
        setEvidence(rows); setSelectedIds(new Set(rows.map((item) => item.id))); setEvidenceLoading(false);
      });
    return () => { active = false; };
  }, [page, props.onListPaymentRequests, props.walletHome.wallets, evidenceReload]);
  useEffect(() => {
    if (!request || request.status === 'confirmed' || request.status === 'failed' || request.status === 'expired') return;
    let stopped = false;
    let timer: number;
    const refresh = async () => {
      let nextStatus = request.status;
      try {
        const next = await props.onGetPaymentRequest(request.id);
        if (stopped) return;
        nextStatus = next.status;
        setRequest(next);
        if (next.status === 'confirmed') {
          props.onTransactionSubmitted(request.walletId);
          void props.onListPaymentRequests(request.walletId).then((rows) => { if (!stopped) setRecent(rows); }).catch(() => undefined);
        }
      } catch { /* Keep the current state and retry. */ }
      if (!stopped && nextStatus !== 'confirmed' && nextStatus !== 'failed' && nextStatus !== 'expired') {
        timer = window.setTimeout(() => void refresh(), nextStatus === 'processing' ? 2000 : 3000);
      }
    };
    timer = window.setTimeout(() => void refresh(), request.status === 'processing' ? 1000 : 2500);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [request?.id, request?.status, props.onGetPaymentRequest, props.onListPaymentRequests]);

  const create = async () => {
    if (!home || !asset || !amountAtomic) { setMessage(unit === 'krw' && !asset?.referencePrice ? '원화 시세가 없어 자산 수량으로 입력해 주세요.' : '받을 금액을 다시 확인해 주세요.'); return; }
    setBusy(true); setMessage('');
    try { setRequest(await props.onCreatePaymentRequest({ walletId: home.wallet.walletId, chainId: asset.chainId, assetId: asset.assetId, amountAtomic })); }
    catch (error) { setMessage(paymentError(error)); }
    finally { setBusy(false); }
  };
  const share = async () => {
    if (!request) return;
    const url = paymentUrl(request.id);
    try {
      if (navigator.share) await navigator.share({ title: '월렛 POS 결제 요청', url });
      else { await navigator.clipboard.writeText(url); setMessage('결제 링크를 복사했어요.'); }
    } catch { setMessage('링크를 공유하지 못했어요.'); }
  };
  const toggleUnit = () => {
    if (asset && amountAtomic) {
      const converted = unit === 'krw' ? formatAtomic(BigInt(amountAtomic), asset.decimals, asset.decimals)
        : posReferenceKrw(amountAtomic, asset);
      setAmount(converted ?? '');
    } else setAmount('');
    setUnit((current) => current === 'krw' ? 'token' : 'krw');
    setMessage('');
  };
  const saveDefaults = () => {
    if (!home || !asset) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify({ walletId: home.wallet.walletId, symbol: asset.symbol, chainId: asset.chainId })); }
    catch { setMessage('기본 설정을 이 기기에 저장하지 못했어요.'); return; }
    setMessage('기본 받기 설정을 저장했어요.'); setPage('main');
  };
  const exportEvidence = () => {
    if (!selectedEvidence.length) return;
    const labels = Object.fromEntries(props.walletHome.wallets.map((wallet) => [wallet.walletId, wallet.label]));
    downloadPaymentEvidenceCsv(selectedEvidence, labels, `wss-pos-${dateFrom}-${dateTo}.csv`);
    setMessage('선택한 결제 증빙 CSV를 저장했어요.');
  };
  const back = page === 'evidence' ? () => setPage('manage') : page !== 'main' ? () => setPage('main') : undefined;
  const title = page === 'asset' ? '받을 자산 선택' : page === 'chain' ? '받을 체인 선택'
    : page === 'manage' ? 'POS 관리' : page === 'evidence' ? '결제 증빙' : '월렛 POS';

  if (receipt) return <PaymentReceiptScreen payment={receipt} direction="received"
    walletLabel={props.walletHome.wallets.find((wallet) => wallet.walletId === receipt.walletId)?.label}
    onBack={() => setReceipt(null)} onClose={onClose} />;
  return <Sheet title={title} onClose={onClose}
    onLeadingAction={back ?? (request ? undefined : () => setPage('manage'))}
    leadingLabel={back ? '이전 화면' : 'POS 관리'} leadingIcon={back ? <ArrowLeft aria-hidden="true" /> : <GearSix aria-hidden="true" />}>
    {page === 'asset' ? <div className="kw-pos-choice-page">
      <h2>어떤 자산으로 받을까요?</h2><p>자산을 선택하면 결제 화면으로 돌아가요.</p>
      <div className="kw-transfer-choice-list">{symbols.map((candidate) => {
        const group = assets.filter((item) => item.symbol === candidate);
        return <button type="button" className="kw-transfer-choice" key={candidate} onClick={() => {
          setSymbol(candidate);
          if (!group.some((item) => item.chainId === chainId)) setChainId(group[0]?.chainId ?? '');
          setAmount(''); setPage('main');
        }}><AssetIcon className="kw-transfer-asset-mark" symbol={candidate} iconAssetId={group[0]?.iconAssetId} />
          <span><strong>{group[0]?.name ?? candidate}</strong><small>{candidate} · {group.length}개 네트워크</small></span>
          {candidate === selectedSymbol ? <Check aria-label="선택됨" /> : <CaretRight aria-hidden="true" />}</button>;
      })}</div>
    </div> : page === 'chain' ? <div className="kw-pos-choice-page">
      <h2>어떤 체인으로 받을까요?</h2><p>결제자가 같은 체인에서 보내야 해요.</p>
      <div className="kw-transfer-choice-list">{chainAssets.map((candidate) => <button type="button" className="kw-transfer-choice" key={candidate.assetId} onClick={() => {
        setChainId(candidate.chainId); setAmount(''); setPage('main');
      }}><ChainIcon className="kw-transfer-asset-mark" chainId={candidate.chainId} />
        <span><strong>{candidate.network}</strong><small>{candidate.symbol} · {candidate.referencePrice?.stale ? '시세 업데이트 필요' : candidate.referencePrice?.display ?? '원화 시세 없음'}</small></span>
        {candidate.chainId === asset?.chainId ? <Check aria-label="선택됨" /> : <CaretRight aria-hidden="true" />}</button>)}</div>
    </div> : page === 'manage' ? <div className="kw-pos-manage">
      <h2>기본 받기 설정</h2><p className="kw-payment-note">POS를 열면 선택한 월렛과 자산·체인을 먼저 보여줘요. 설정은 이 기기에 저장돼요.</p>
      <section className="kw-payment-block"><h3>결제 받을 월렛</h3><div className="kw-transfer-choice-list">{props.walletHome.wallets.map((wallet) =>
        <button type="button" className="kw-transfer-choice" key={wallet.walletId} onClick={() => { setWalletId(wallet.walletId); setAmount(''); }}>
          <CreditCard className="kw-transfer-asset-mark" aria-hidden="true" /><span><strong>{wallet.label}</strong><small>{wallet.walletId === walletId ? '선택한 월렛' : '탭해서 선택'}</small></span>
          {wallet.walletId === walletId ? <Check aria-label="선택됨" /> : <CaretRight aria-hidden="true" />}</button>)}</div></section>
      <div className="kw-pos-default-summary"><span>기본 자산·체인</span><strong>{asset ? `${asset.symbol} · ${asset.network}` : '월렛 정보를 확인 중이에요'}</strong><button type="button" onClick={() => setPage('main')}>결제 화면에서 바꾸기 <ArrowRight size={16} aria-hidden="true" /></button></div>
      {walletError ? <p className="kw-payment-message" role="alert">{walletError}</p> : null}
      <button className="kw-button kw-payment-primary" type="button" disabled={!home || !asset} onClick={saveDefaults}>기본 설정 저장</button>
      <section className="kw-payment-block kw-pos-evidence-entry"><div><DownloadSimple size={23} aria-hidden="true" /><span><strong>결제 증빙과 영수증</strong><small>확정된 QR 결제를 확인하고 저장해요</small></span></div><button type="button" onClick={() => setPage('evidence')}>내역 선택 <CaretRight size={16} aria-hidden="true" /></button></section>
      {message ? <p className="kw-payment-message" role="status">{message}</p> : null}
    </div> : page === 'evidence' ? <div className="kw-pos-evidence">
      <h2>결제 증빙 CSV</h2><p className="kw-payment-note">월렛별 최근 60건에서 확정된 QR 결제를 모았어요. 요청 시점의 원화 참고가가 없으면 해당 칸은 비워 둡니다.</p>
      <div className="kw-pos-evidence__period"><label>시작일<input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} /></label><label>종료일<input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} /></label></div>
      <div className="kw-pos-evidence__summary"><strong>{selectedEvidence.length} / {filteredEvidence.length}건 선택</strong><button type="button" onClick={() => setSelectedIds(new Set(filteredEvidence.map((item) => item.id)))}>전체 선택</button><button type="button" onClick={() => setSelectedIds(new Set())}>선택 해제</button></div>
      {evidenceLoading ? <p className="kw-payment-note">결제 내역을 불러오고 있어요.</p> : filteredEvidence.length ? <div className="kw-pos-evidence__list">{filteredEvidence.map((item) => <div className="kw-pos-evidence__item" key={item.id}><label><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{amountText(item)}</strong><small>{new Date(item.confirmedAt ?? item.createdAt).toLocaleDateString('ko-KR')} · {item.chainId}</small></span><b>{item.referenceAmountKrw ? `${BigInt(item.referenceAmountKrw).toLocaleString('ko-KR')}원` : '원화 미확인'}</b></label><button type="button" onClick={() => setReceipt(item)}>영수증 보기</button></div>)}</div> : <p className="kw-payment-note">선택한 기간에 확정된 QR 결제가 없어요.</p>}
      {message ? <p className="kw-payment-message" role="alert">{message} <button type="button" onClick={() => setEvidenceReload((count) => count + 1)}>다시 불러오기</button></p> : null}
      <button className="kw-button kw-payment-primary" type="button" disabled={evidenceLoading || selectedEvidence.length === 0} onClick={exportEvidence}>선택 내역 CSV 저장</button>
      <p className="kw-payment-note">세무 검토를 위한 참고 자료예요. 전자세금계산서나 공식 영수증은 아니에요.</p>
    </div> : <>
      <div className="kw-pos-tabs" role="tablist" aria-label="결제 받기 방식"><button type="button" role="tab" aria-selected={tab === 'qr'} onClick={() => setTab('qr')}><QrCode size={18} aria-hidden="true" />QR</button><button type="button" role="tab" aria-selected={tab === 'card'} onClick={() => setTab('card')}><CreditCard size={18} aria-hidden="true" />카드</button></div>
      {tab === 'card' ? <div className="kw-pos-card-preview"><div className="kw-pos-card-preview__icon"><CreditCard size={44} weight="duotone" aria-hidden="true" /></div><h2>카드로 결제 받기</h2><p>월렛 카드 결제 화면을 미리 볼 수 있어요. 실물 카드 승인과 NFC 결제는 아직 연결되지 않았어요.</p><button type="button" className="kw-pos-card-preview__link" onClick={onOpenCard}>월렛 카드 보기 <ArrowRight size={17} aria-hidden="true" /></button><button type="button" className="kw-button kw-payment-primary" onClick={() => setTab('qr')}>QR로 결제 받기</button></div> : !request ? <>
        <div className="kw-pos-intro"><h2>금액만 입력하면 바로 QR</h2><p>받을 월렛과 자산을 확인한 뒤 결제 금액을 입력해 주세요.</p></div>
        <div className="kw-pos-wallet"><span>받는 월렛</span><strong>{home?.wallet.label ?? '월렛을 불러오고 있어요'}</strong><button type="button" onClick={() => setPage('manage')}>변경</button></div>
        <div className="kw-pos-selectors"><button type="button" onClick={() => setPage('asset')} disabled={!asset}><AssetIcon className="kw-transfer-asset-mark" symbol={asset?.symbol ?? ''} iconAssetId={asset?.iconAssetId} /><span><small>받을 자산</small><strong>{asset?.name ?? '선택 불가'}</strong></span><CaretRight size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => setPage('chain')} disabled={!asset}><ChainIcon className="kw-transfer-asset-mark" chainId={asset?.chainId ?? ''} /><span><small>받을 체인</small><strong>{asset?.network ?? '선택 불가'}</strong></span><CaretRight size={18} aria-hidden="true" /></button></div>
        <div className="kw-pos-amount-card"><div className="kw-pos-amount-card__heading"><strong>받을 금액</strong><button type="button" onClick={toggleUnit} disabled={!asset}><ArrowsLeftRight size={15} aria-hidden="true" />{unit === 'krw' ? `${asset?.symbol ?? '자산'}로 입력` : '원화로 입력'}</button></div>
          <label className="kw-payment-amount-input"><span className="kw-sr-only">받을 금액 {unit === 'krw' ? '원화' : asset?.symbol}</span><input type="text" inputMode={unit === 'krw' ? 'numeric' : 'decimal'} placeholder="0" value={amount} onChange={(event) => setAmount(unit === 'krw' ? event.target.value.replace(/\D/g, '') : event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} /><strong>{unit === 'krw' ? '원' : asset?.symbol}</strong></label>
          <small>{secondaryAmount ?? (unit === 'krw' && (!asset?.referencePrice || asset.referencePrice.stale)
            ? '원화 시세가 없어요. 자산 수량으로 입력해 주세요.' : amount ? '입력 가능한 금액과 소수 자릿수를 확인해 주세요.' : '금액을 입력해 주세요.')}</small></div>
        {walletError ? <p className="kw-payment-message" role="alert">{walletError}</p> : null}
        {message ? <p className="kw-payment-message" role="alert">{message}</p> : null}
        <button className="kw-button kw-payment-primary" type="button" disabled={!home || !asset || !amountAtomic || busy} onClick={() => void create()}>{busy ? 'QR을 만들고 있어요' : '결제 QR 만들기'}</button>
        {recent.length ? <section className="kw-payment-block"><h3>최근 받은 결제</h3><div className="kw-payment-history">{recent.slice(0, 3).map((item) => <div key={item.id}><span><strong>{stateText(item.status)}</strong><small>{new Date(item.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</small></span><b>{amountText(item)}</b>{item.status === 'confirmed' ? <button type="button" className="kw-payment-history__receipt" onClick={() => setReceipt(item)}>영수증</button> : null}</div>)}</div></section> : null}
      </> : <>
        <div className="kw-pos-request-heading"><span className={`kw-pos-status kw-pos-status--${request.status}`}>{stateText(request.status)}</span><h2>{amountText(request)}</h2><p>{request.referenceAmountKrw ? `요청 시점 약 ${BigInt(request.referenceAmountKrw).toLocaleString('ko-KR')}원 · ` : ''}{request.chainId} · {props.walletHome.wallets.find((wallet) => wallet.walletId === request.walletId)?.label ?? '받는 월렛'}</p></div>
        {request.status === 'confirmed' ? <div className="kw-payment-result kw-payment-result--celebrate" role="status"><PaymentCoinEffect logoUrl={props.paymentCoinLogoUrl} direction="receive" /><strong>결제를 받았어요</strong><p>{amountText(request)} 결제가 완료됐어요.</p><button type="button" className="kw-payment-receipt-link" onClick={() => setReceipt(request)}>영수증 보기 <ArrowRight size={16} aria-hidden="true" /></button></div> : null}
        <div className={`kw-pos-qr${request.status !== 'pending' ? ' kw-pos-qr--inactive' : ''}`}>
          <QRCodeSVG value={paymentUrl(request.id)} size={216} marginSize={1} role="img" aria-label={request.status === 'pending' ? '결제 요청 QR 코드' : '사용할 수 없는 결제 QR 코드'} />
          {request.status !== 'pending' ? <span className="kw-pos-qr__overlay">{request.status === 'confirmed' ? '결제 완료 · 사용된 QR' : request.status === 'processing' ? '결제 진행 중' : request.status === 'expired' ? '만료된 QR' : '사용할 수 없는 QR'}</span> : null}
        </div>
        {request.status === 'processing' ? <PaymentProgress title={request.processingStage === 'approval' ? '결제자가 승인하고 있어요' : '결제를 확인하고 있어요'} detail={request.processingStage === 'approval' ? '승인이 끝나면 결제 결과를 이어서 확인해요.' : '네트워크 확인이 끝나면 자동으로 완료돼요.'} />
          : <p className="kw-pos-qr-caption">{request.status === 'pending' ? '상대방이 QR을 스캔하면 결제 내용을 확인하고 서명해요.' : request.status === 'confirmed' ? '이번 QR 결제가 완료됐어요. 새 결제에는 새 QR을 만들어 주세요.' : '새 QR을 만들어 다시 요청해 주세요.'}</p>}
        {request.status === 'pending' ? <p className="kw-payment-note">{new Date(request.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지 유효해요.</p> : null}
        {request.transactionHash ? <p className="kw-pos-hash">거래 {shortAddress(request.transactionHash)}</p> : null}
        {request.status === 'pending' ? <div className="kw-payment-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(paymentUrl(request.id)).then(() => setMessage('결제 링크를 복사했어요.')).catch(() => setMessage('링크를 복사하지 못했어요.'))}><CopySimple size={18} aria-hidden="true" />링크 복사</button><button type="button" onClick={() => void share()}><ShareNetwork size={18} aria-hidden="true" />공유</button></div> : null}
        {message ? <p className="kw-payment-message" role="status">{message}</p> : null}
        <button className="kw-button kw-payment-primary" type="button" onClick={() => { setRequest(null); setAmount(''); setMessage(''); }}>새 QR 만들기</button>
      </>}
    </>}
  </Sheet>;
}

function CheckoutSheet({ props, id, onClose }: { props: Props; id: string; onClose: () => void }) {
  const [request, setRequest] = useState<WalletPaymentRequest | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [result, setResult] = useState<TransferExecutionResult | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitUnknown, setSubmitUnknown] = useState(false);
  const transactionReportedRef = useRef(false);
  const [phase, setPhase] = useState<'review' | 'preparing' | 'signing' | 'submitting' | 'confirming'>('review');
  const [error, setError] = useState('');
  useEffect(() => { void props.onGetPaymentRequest(id).then(setRequest).catch((caught) => setError(paymentError(caught))); }, [id, props.onGetPaymentRequest]);
  useEffect(() => {
    if ((!submitUnknown && result?.status !== 'submitted' && result?.status !== 'processing' && result?.status !== 'confirmed') || request?.status === 'confirmed' || request?.status === 'failed') return;
    let stopped = false;
    let timer: number;
    const refresh = async () => {
      let final = false;
      try {
        const next = await props.onGetPaymentRequest(id);
        if (stopped) return;
        setRequest(next);
        if (next.status === 'confirmed' && prepared) {
          setResult((current) => ({ intentId: prepared.intentId, status: 'confirmed', transactionHash: next.transactionHash ?? current?.transactionHash }));
          setSubmitUnknown(false);
          if (!transactionReportedRef.current) {
            transactionReportedRef.current = true;
            props.onTransactionSubmitted(props.walletHome.wallet.walletId);
          }
          final = true;
        } else if (next.status === 'failed') {
          setSubmitUnknown(false);
          setError('네트워크에서 결제를 완료하지 못했어요. 새 QR로 다시 시도해 주세요.');
          final = true;
        }
      } catch { /* Keep checking the same payment without asking for another signature. */ }
      if (!stopped && !final) timer = window.setTimeout(() => void refresh(), 2000);
    };
    timer = window.setTimeout(() => void refresh(), 1200);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [id, prepared, result?.status, request?.status, submitUnknown, props.onGetPaymentRequest]);
  const asset = props.walletHome.receiveAssets.find((item) => item.assetId === request?.assetId && item.chainId === request.chainId);
  const available = asset ? BigInt(asset.availableAtomic) >= BigInt(request?.amountAtomic ?? '0') : false;
  const prepare = async () => {
    if (!request) return;
    setBusy(true); setPhase('preparing'); setError('');
    try {
      const ready = await props.onPrepareTransfer({ walletId: props.walletHome.wallet.walletId,
      chainId: request.chainId, assetId: request.assetId, amountAtomic: request.amountAtomic,
      recipient: request.recipientAddress, channel: 'address', paymentRequestId: request.id,
      ...(reason.trim() ? { complianceReason: reason.trim() } : {}) });
      setPrepared(ready);
      if (ready.signingRequest) await pay(ready);
      else setPhase('review');
    } catch (caught) { setError(paymentError(caught)); setPhase('review'); }
    finally { setBusy(false); }
  };
  const pay = async (ready: PreparedTransfer) => {
    if (!ready.signingRequest) return;
    setBusy(true); setPhase('signing'); setError('');
    let submissionStarted = false;
    try {
      const signature = await props.onRequestSecureTransactionSignature(ready.signingRequest);
      if (signature.status === 'cancelled') { setError('인증이 취소됐어요.'); return; }
      if (signature.status === 'wallet-ready') { setPrepared(null); setError('지갑 연결을 확인했어요. 결제 조건을 다시 확인해 주세요.'); return; }
      if (signature.status !== 'completed' || signature.intentId !== ready.intentId) { setError('결제 인증 결과를 확인하지 못했어요.'); return; }
      setPhase('submitting');
      setSubmitUnknown(true);
      submissionStarted = true;
      const submitted = await props.onSubmitTransfer({ intentId: ready.intentId,
        signedTransaction: signature.signedTransaction, hostAuthorizationProof: signature.hostAuthorizationProof,
        idempotencyKey: crypto.randomUUID() });
      if (submitted.status === 'failed') { setSubmitUnknown(false); setError('네트워크에서 결제가 실패했어요. 새 QR을 받아 다시 시도해 주세요.'); return; }
      setResult((current) => current?.status === 'confirmed' ? current : submitted);
      if (submitted.status === 'confirmed') setSubmitUnknown(false);
      else setPhase('confirming');
      if (submitted.status === 'confirmed' && !transactionReportedRef.current) {
        transactionReportedRef.current = true;
        props.onTransactionSubmitted(props.walletHome.wallet.walletId);
      }
    } catch (caught) { setError(submissionStarted ? '결제 접수를 확인하고 있어요. 다시 서명하지 말고 잠시 기다려 주세요.' : paymentError(caught)); if (submissionStarted) setPhase('confirming'); }
    finally { setBusy(false); }
  };
  const confirmed = isOwnPaymentConfirmed(request?.status, result?.status, submitUnknown);
  const confirming = (submitUnknown || result?.status === 'submitted' || result?.status === 'processing' || result?.status === 'confirmed') && !confirmed && request?.status !== 'failed';
  if (receiptOpen && request?.status === 'confirmed') return <PaymentReceiptScreen payment={request} direction="sent"
    walletLabel={props.walletHome.wallet.label} onBack={() => setReceiptOpen(false)} onClose={onClose} />;
  return <Sheet title="QR 결제" onClose={onClose}>
    {!request ? <div className="kw-pos-intro"><QrCode size={34} aria-hidden="true" /><h2>결제를 확인하고 있어요</h2>{error ? <p role="alert">{error}</p> : <PaymentProgress title="QR 내용을 불러오고 있어요" detail="결제 금액과 받는 주소를 확인해요." />}</div> : <>
      <div className="kw-pos-request-heading"><span className={`kw-pos-status kw-pos-status--${request.status}`}>{stateText(request.status)}</span><h2>{amountText(request)}</h2><p>{request.chainId} 네트워크</p></div>
      <dl className="kw-payment-detail"><div><dt>결제 월렛</dt><dd>{props.walletHome.wallet.label}</dd></div><div><dt>받는 주소</dt><dd>{shortAddress(request.recipientAddress)}</dd></div><div><dt>결제 유효 시간</dt><dd>{new Date(request.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지</dd></div>{prepared ? <div><dt>네트워크 수수료</dt><dd>{prepared.networkFee.amountDisplay} {prepared.networkFee.symbol}</dd></div> : null}</dl>
      {request.status !== 'pending' && !prepared && !result && !submitUnknown ? <p className="kw-payment-message">{request.status === 'processing' ? '이미 결제가 진행 중인 QR이에요.' : '이 QR은 더 이상 결제할 수 없어요.'}</p> : null}
      {!asset && request.status === 'pending' ? <p className="kw-payment-message">이 월렛은 요청한 자산을 지원하지 않아요. 다른 월렛을 선택해 주세요.</p> : null}
      {asset && !available && request.status === 'pending' ? <p className="kw-payment-message">결제할 잔액이 부족해요.</p> : null}
      {prepared ? <div className={`kw-payment-compliance kw-payment-compliance--${prepared.compliance.status}`}><strong>{prepared.compliance.status === 'allow' ? '받는 주소 확인 완료' : '추가 확인이 필요해요'}</strong><p>{prepared.compliance.message}</p></div> : null}
      {prepared?.compliance.reasonRequired ? <label className="kw-payment-field"><span>보내는 이유</span><textarea minLength={5} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="5자 이상 입력해 주세요" /></label> : null}
      {props.walletHome.wallets.length > 1 && !result && !submitUnknown ? <details className="kw-payment-wallet-switch"><summary>다른 월렛으로 결제</summary>{props.walletHome.wallets.filter((wallet) => wallet.walletId !== props.walletHome.wallet.walletId).map((wallet) => <button key={wallet.walletId} type="button" onClick={() => { setPrepared(null); void props.onSelectWallet(wallet.walletId); }}>{wallet.label}<ArrowRight size={15} aria-hidden="true" /></button>)}</details> : null}
      {confirmed ? <div className="kw-payment-result kw-payment-result--celebrate" role="status"><PaymentCoinEffect logoUrl={props.paymentCoinLogoUrl} direction="send" /><strong>결제가 완료됐어요</strong><p>{amountText(request)} 결제가 POS에 반영됐어요.</p>{request.status === 'confirmed' ? <button type="button" className="kw-payment-receipt-link" onClick={() => setReceiptOpen(true)}>영수증 보기 <ArrowRight size={16} aria-hidden="true" /></button> : null}</div>
        : confirming ? <PaymentProgress title="결제를 완료하고 있어요" detail="네트워크와 POS에서 결제를 확인해요. 잠시만 기다려 주세요." />
          : busy ? <PaymentProgress title={phase === 'preparing' ? '결제 조건을 확인하고 있어요' : phase === 'signing' ? '지갑에서 서명하고 있어요' : '결제를 보내고 있어요'} detail={phase === 'signing' ? '보안 확인을 마치면 결제가 진행돼요.' : '이 화면을 유지해 주세요.'} /> : null}
      {error ? <p className="kw-payment-message" role="alert">{error}</p> : null}
      {!result && !submitUnknown && (request.status === 'pending' || request.status === 'processing' && prepared !== null) ? <button className="kw-button kw-payment-primary" type="button" disabled={busy || !asset || !available || (prepared !== null && prepared.compliance.status !== 'allow' && !(prepared.compliance.status === 'review' && reason.trim().length >= 5))}
        onClick={() => void (prepared?.signingRequest ? pay(prepared) : prepare())}>{busy ? '결제를 진행하고 있어요' : prepared?.compliance.status === 'review' ? '사유 확인 후 결제하기' : '승인하고 결제하기'}</button> : null}
      {confirmed ? <button className="kw-button kw-payment-primary" type="button" onClick={onClose}>확인</button> : null}
    </>}
  </Sheet>;
}

export function WalletPayments(props: Props) {
  const [screen, setScreen] = useState<'card' | 'pos' | 'checkout' | null>(props.incomingPaymentRequestId ? 'checkout' : null);
  const [checkoutId, setCheckoutId] = useState<string | null>(props.incomingPaymentRequestId ?? null);
  const [scanMessage, setScanMessage] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  useEffect(() => { props.onFocusedOverlayChange(screen !== null); return () => props.onFocusedOverlayChange(false); }, [screen, props.onFocusedOverlayChange]);
  const close = useCallback(() => {
    setScreen(null); setCheckoutId(null);
    try {
      if (window.parent !== window && new URLSearchParams(window.parent.location.hash.slice(1)).has('payment')) {
        window.parent.history.replaceState(window.parent.history.state, '', window.parent.location.pathname + window.parent.location.search);
      }
      if (new URLSearchParams(window.location.hash.slice(1)).has('payment')) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    } catch { /* Browser navigation remains usable. */ }
  }, []);
  const scan = async () => {
    setScanBusy(true); setScanMessage('');
    try {
      const picked = await props.onRequestRecipientPick('qr', 'payment');
      if (picked.status !== 'selected') return;
      const id = parsePaymentQr(picked.value, paymentHostOrigin());
      if (!id) { setScanMessage('월렛 POS 결제 QR이 아니에요.'); return; }
      setCheckoutId(id); setScreen('checkout');
    } catch { setScanMessage('카메라를 열지 못했어요. 다시 시도해 주세요.'); }
    finally { setScanBusy(false); }
  };
  return <>
    <section className="kw-card kw-payment-section" aria-labelledby="kw-payment-section-title">
      <div className="kw-payment-section__heading"><div><h2 id="kw-payment-section-title">결제</h2><p>내 월렛으로 간편하게</p></div><button type="button" className="kw-payment-scan" aria-label="결제 QR 스캔" disabled={scanBusy} onClick={() => void scan()}><Scan size={23} weight="bold" aria-hidden="true" /></button></div>
      <div className="kw-payment-tiles"><button type="button" onClick={() => setScreen('card')}><span className="kw-payment-emoji" aria-hidden="true">💳</span><strong>월렛 카드</strong><CaretRight size={16} aria-hidden="true" /></button><button type="button" onClick={() => setScreen('pos')}><span className="kw-payment-emoji" aria-hidden="true">🏪</span><strong>월렛 POS</strong><CaretRight size={16} aria-hidden="true" /></button></div>
      {scanMessage ? <p className="kw-payment-message" role="alert">{scanMessage}</p> : null}
    </section>
    {screen === 'card' ? <WalletCardSheet props={props} onClose={close} /> : null}
    {screen === 'pos' ? <PosSheet props={props} onClose={close} onOpenCard={() => setScreen('card')} /> : null}
    {screen === 'checkout' && checkoutId ? <CheckoutSheet props={props} id={checkoutId} onClose={close} /> : null}
  </>;
}
