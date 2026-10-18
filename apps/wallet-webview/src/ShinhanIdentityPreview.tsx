import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MobileCarrierCode } from '@took-wss/contracts';
import {
  ArrowClockwise, ArrowRight, CaretLeft, CaretRight, Check, CheckCircle, Fingerprint,
  IdentificationCard, LinkSimple, LockKey, ShieldCheck, UserCircle, Wallet, X,
} from '@phosphor-icons/react';
import './ShinhanIdentityPreview.css';

type Stage = 'intro' | 'profile' | 'phone-code' | 'app-check' | 'consent' | 'issued' | 'wallet-select'
  | 'wallet-confirm' | 'connected' | 'proof-request' | 'proof-consent' | 'proof-result' | 'cancelled';
export type WalletChoice = 'sar' | 'imported';
export interface ShinhanIdentityRecord {
  id: string;
  name: string;
  birthDate: string;
  phoneMasked: string;
  connectedWallets: WalletChoice[];
}

const wallets: Record<WalletChoice, { label: string; detail: string; address: string }> = {
  sar: { label: '내 쏠지갑', detail: '쏠지갑에서 만든 지갑', address: '0xA1B2…9C80' },
  imported: { label: '가져온 지갑', detail: '외부에서 연결한 지갑', address: '0xC3D4…4E21' },
};

const carriers = [
  ['skt', 'SKT'], ['kt', 'KT'], ['lgu-plus', 'LG U+'],
  ['skt-mvno', 'SKT 알뜰폰'], ['kt-mvno', 'KT 알뜰폰'], ['lgu-plus-mvno', 'LG U+ 알뜰폰'],
] as const satisfies ReadonlyArray<readonly [MobileCarrierCode, string]>;

const steps: Stage[] = ['intro', 'profile', 'phone-code', 'app-check', 'consent', 'issued',
  'wallet-select', 'wallet-confirm', 'proof-request', 'proof-consent', 'proof-result'];

function validBirthDate(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return false;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date < new Date() && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function CredentialCard({ record }: { record: ShinhanIdentityRecord }) {
  return <section className="shinhan-identity__id-card" aria-label="디지털 신원인증 카드">
    <div className="shinhan-identity__id-card-top"><span className="shinhan-identity__id-mark">S</span><strong>SUPER SOL</strong><span>사용 가능</span></div>
    <div className="shinhan-identity__id-card-person"><span className="shinhan-identity__id-avatar"><UserCircle size={54} weight="thin" aria-hidden="true" /></span><div><small>내 디지털 신원인증</small><strong>{record.name}</strong><span>{record.birthDate}</span></div></div>
    <div className="shinhan-identity__id-card-number"><span>디지털 ID</span><code>{record.id}</code></div>
  </section>;
}

function IdentityButton({ children, onClick, secondary = false, disabled = false }: {
  children: ReactNode; onClick: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <button className={`shinhan-identity__button${secondary ? ' shinhan-identity__button--secondary' : ''}`}
    type="button" onClick={onClick} disabled={disabled}>{children}</button>;
}

function IdentityRow({ icon, title, detail, trailing }: {
  icon: ReactNode; title: string; detail: string; trailing?: ReactNode;
}) {
  return <div className="shinhan-identity__row">
    <span className="shinhan-identity__row-icon" aria-hidden="true">{icon}</span>
    <span className="shinhan-identity__row-copy"><strong>{title}</strong><small>{detail}</small></span>
    {trailing ? <span className="shinhan-identity__row-trailing">{trailing}</span> : null}
  </div>;
}

export function ShinhanIdentityPreview({ record, onRecordChange, onClose }: {
  record: ShinhanIdentityRecord | null;
  onRecordChange: (record: ShinhanIdentityRecord) => void;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const carrierTriggerRef = useRef<HTMLButtonElement>(null);
  const carrierDialogRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<Stage>(record ? 'connected' : 'intro');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [carrier, setCarrier] = useState<MobileCarrierCode | null>(null);
  const [carrierSheetOpen, setCarrierSheetOpen] = useState(false);
  const [profileConsent, setProfileConsent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [proofConsent, setProofConsent] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletChoice>('sar');
  const connectedWallets = record?.connectedWallets ?? [];
  const currentWallet = wallets[selectedWallet];
  const stepIndex = stage === 'connected' ? -1 : steps.indexOf(stage);
  const phoneDigits = phone.replace(/\D/g, '');
  const canContinueProfile = name.trim().length >= 2 && validBirthDate(birthDate)
    && /^010\d{8}$/.test(phoneDigits) && Boolean(carrier) && profileConsent;
  const phoneMasked = /^010\d{8}$/.test(phoneDigits) ? `010-••••-${phoneDigits.slice(-4)}` : '';
  const carrierLabel = carriers.find(([code]) => code === carrier)?.[1] ?? '통신사 선택';

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = 0;
    const heading = scroll.querySelector<HTMLHeadingElement>('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [stage]);

  useEffect(() => {
    if (!carrierSheetOpen) return;
    const dialog = carrierDialogRef.current;
    const controls = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    controls[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCarrierSheetOpen(false);
        window.setTimeout(() => carrierTriggerRef.current?.focus(), 0);
      }
      if (event.key !== 'Tab' || !controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [carrierSheetOpen]);

  const closeCarrierSheet = () => {
    setCarrierSheetOpen(false);
    window.setTimeout(() => carrierTriggerRef.current?.focus(), 0);
  };

  const goBack = () => {
    if (stage === 'intro' || stage === 'issued' || stage === 'connected') {
      onClose();
      return;
    }
    const previous: Partial<Record<Stage, Stage>> = {
      profile: 'intro', 'phone-code': 'profile', 'app-check': 'phone-code', consent: 'app-check',
      'wallet-select': 'connected', 'wallet-confirm': 'wallet-select',
      'proof-request': 'connected', 'proof-consent': 'proof-request',
      'proof-result': 'connected', cancelled: 'connected',
    };
    setStage(previous[stage] ?? 'intro');
  };

  const issueCredential = () => {
    const digits = birthDate.replace(/\D/g, '');
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    onRecordChange({
      id: `SOL-${id.slice(0, 4)}-${id.slice(4)}`,
      name: name.trim(),
      birthDate: `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`,
      phoneMasked,
      connectedWallets: [],
    });
    setStage('issued');
  };

  const bindWallet = () => {
    if (!record) return;
    onRecordChange({ ...record, connectedWallets: connectedWallets.includes(selectedWallet)
      ? connectedWallets : [...connectedWallets, selectedWallet] });
    setStage('connected');
  };

  const openWalletSelect = () => {
    const next = (Object.keys(wallets) as WalletChoice[]).find((id) => !connectedWallets.includes(id));
    if (!next) return;
    setSelectedWallet(next);
    setStage('wallet-select');
  };

  return <div className="shinhan-identity" data-stage={stage} data-sheet-open={carrierSheetOpen} data-testid="shinhan-identity-preview">
    <header className="shinhan-identity__header" inert={carrierSheetOpen}>
      <button type="button" aria-label="뒤로" onClick={goBack}><CaretLeft size={25} aria-hidden="true" /></button>
      <strong>내 신원인증</strong>
      <button type="button" aria-label="쏠지갑으로 돌아가기" onClick={onClose}><X size={22} aria-hidden="true" /></button>
    </header>
    <div ref={scrollRef} className="shinhan-identity__scroll" aria-live="polite" inert={carrierSheetOpen}>
      {stepIndex >= 0 ? <div className="shinhan-identity__progress" role="progressbar" aria-label="신원인증 흐름" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={steps.length}>
        <span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
      </div> : null}

      {stage === 'intro' ? <>
        <div className="shinhan-identity__hero-icon"><IdentificationCard size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>디지털 신원인증으로 쏠지갑을 시작해요</h2>
        <p className="shinhan-identity__lead">내 정보를 확인하고 디지털 ID를 발급받은 뒤, 원하는 지갑에 연결할 수 있어요.</p>
        <section className="shinhan-identity__card">
          <IdentityRow icon={<UserCircle size={21} />} title="내 정보와 휴대폰 확인" detail="이름·생년월일을 입력하고 휴대폰을 인증해요" />
          <IdentityRow icon={<Fingerprint size={21} />} title="슈퍼쏠 인증 확인" detail="앱에서 인증 상태를 확인해요" />
          <IdentityRow icon={<IdentificationCard size={21} />} title="디지털 ID 발급" detail="내 기기에 보관하고 원하는 지갑에 연결해요" />
        </section>
      </> : null}

      {stage === 'profile' ? <>
        <div className="shinhan-identity__hero-icon"><UserCircle size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>내 정보를 확인해 주세요</h2>
        <p className="shinhan-identity__lead">이름과 생년월일을 입력하고 휴대폰 인증으로 고객 정보를 연결해요.</p>
        <section className="shinhan-identity__form" aria-label="고객 정보">
          <label><span>이름</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={40} placeholder="이름 입력" /></label>
          <label><span>생년월일</span><input value={birthDate} onChange={(event) => setBirthDate(event.target.value)} inputMode="numeric" autoComplete="bday" maxLength={10} placeholder="YYYY.MM.DD" /></label>
          <div className="shinhan-identity__form-field"><span>통신사</span><button ref={carrierTriggerRef} className="shinhan-identity__field-button" type="button" aria-haspopup="dialog" aria-expanded={carrierSheetOpen} onClick={() => setCarrierSheetOpen(true)}><strong data-empty={!carrier}>{carrierLabel}</strong><CaretRight size={18} aria-hidden="true" /></button></div>
          <label><span>휴대폰 번호</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" maxLength={13} placeholder="01012345678" /></label>
        </section>
        <label className="shinhan-identity__consent"><input type="checkbox" checked={profileConsent} onChange={(event) => setProfileConsent(event.target.checked)} /><span>고객 정보 확인과 휴대폰 인증에 동의해요.</span></label>
      </> : null}

      {stage === 'phone-code' ? <>
        <div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>휴대폰을 확인해요</h2>
        <p className="shinhan-identity__lead">{phoneMasked}로 받은 인증번호 6자리를 입력해 주세요.</p>
        <section className="shinhan-identity__form" aria-label="휴대폰 인증">
          <label><span>인증번호</span><input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="인증번호 6자리" /></label>
        </section>
        <p className="shinhan-identity__note">인증이 끝나면 입력한 정보가 내 고객 정보에 연결돼요.</p>
      </> : null}

      {stage === 'app-check' ? <>
        <div className="shinhan-identity__hero-icon"><Fingerprint size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>슈퍼쏠 인증을 확인했어요</h2>
        <p className="shinhan-identity__lead">휴대폰 인증으로 연결한 고객 정보를 디지털 신원인증 발급에 사용할게요.</p>
        <section className="shinhan-identity__card">
          <IdentityRow icon={<CheckCircle size={21} />} title="앱 인증" detail="슈퍼쏠 인증 상태 확인" trailing={<span className="shinhan-identity__pill">완료</span>} />
          <IdentityRow icon={<CheckCircle size={21} />} title="휴대폰 인증" detail={phoneMasked} trailing={<span className="shinhan-identity__pill">완료</span>} />
        </section>
      </> : null}

      {stage === 'consent' ? <>
        <div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>디지털 ID를 발급할까요?</h2>
        <p className="shinhan-identity__lead">확인한 정보를 바탕으로 디지털 신원인증을 발급하고 내 기기에 보관해요.</p>
        <section className="shinhan-identity__card shinhan-identity__detail-card">
          <div><span>확인한 정보</span><strong>이름 · 생년월일 · 휴대폰</strong></div>
          <div><span>보관 위치</span><strong>내 기기</strong></div>
          <div><span>사용 범위</span><strong>내가 동의한 요청</strong></div>
          <div><span>연결할 지갑</span><strong>직접 선택</strong></div>
        </section>
        <label className="shinhan-identity__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>신원증명 발급과 기기 보관에 동의해요.</span></label>
      </> : null}

      {stage === 'issued' ? <>
        <div className="shinhan-identity__hero-icon"><CheckCircle size={33} weight="duotone" aria-hidden="true" /></div>
        <h2>디지털 신원인증이 준비됐어요</h2>
        <p className="shinhan-identity__lead">이제 원하는 지갑을 연결해 보세요. 발급된 정보는 내 신원인증에서 다시 볼 수 있어요.</p>
        {record ? <CredentialCard record={record} /> : null}
      </> : null}

      {stage === 'wallet-select' ? <>
        <div className="shinhan-identity__hero-icon"><Wallet size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>어떤 지갑을 연결할까요?</h2>
        <p className="shinhan-identity__lead">신원증명 하나에 여러 지갑을 연결할 수 있어요. 지갑마다 한 번씩 확인해요.</p>
        <div className="shinhan-identity__wallet-list" role="radiogroup" aria-label="연결할 지갑">
          {(Object.keys(wallets) as WalletChoice[]).map((id) => <label className="shinhan-identity__wallet-option" key={id} data-selected={selectedWallet === id}>
            <input type="radio" name="identity-wallet" value={id} checked={selectedWallet === id} onChange={() => setSelectedWallet(id)} />
            <span className="shinhan-identity__wallet-avatar"><Wallet size={21} aria-hidden="true" /></span>
            <span><strong>{wallets[id].label}</strong><small>{wallets[id].detail}</small><code>{wallets[id].address}</code></span>
            {connectedWallets.includes(id) ? <span className="shinhan-identity__pill">연결됨</span> : null}
          </label>)}
        </div>
      </> : null}

      {stage === 'wallet-confirm' ? <>
        <div className="shinhan-identity__hero-icon"><LinkSimple size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>이 지갑을 연결할게요</h2>
        <p className="shinhan-identity__lead">지갑에서 한 번 승인해 주소를 직접 통제하는지 확인하는 흐름이에요.</p>
        <section className="shinhan-identity__card">
          <IdentityRow icon={<Wallet size={21} />} title={currentWallet.label} detail={currentWallet.address} />
          <IdentityRow icon={<ShieldCheck size={21} />} title="일회성 확인 요청" detail="자산 이동이나 송금은 일어나지 않아요" />
        </section>
      </> : null}

      {stage === 'connected' ? <>
        <h2>내 디지털 신원인증</h2>
        <p className="shinhan-identity__lead">디지털 ID, 연결된 지갑과 증명 가능한 정보를 확인해요.</p>
        {record ? <CredentialCard record={record} /> : null}
        <section className="shinhan-identity__overview-section" aria-labelledby="shinhan-linked-title">
          <h3 id="shinhan-linked-title">연결된 지갑 <span>{connectedWallets.length}</span></h3>
          <div className="shinhan-identity__card shinhan-identity__connected">
            {connectedWallets.length ? connectedWallets.map((id) => <IdentityRow key={id} icon={<Wallet size={21} />} title={wallets[id].label} detail={wallets[id].address} trailing={<CheckCircle size={19} aria-hidden="true" />} />)
              : <p className="shinhan-identity__empty">아직 연결된 지갑이 없어요.</p>}
          </div>
          {connectedWallets.length < Object.keys(wallets).length ? <button className="shinhan-identity__text-action" type="button" onClick={openWalletSelect}>지갑 연결하기 <ArrowRight size={17} aria-hidden="true" /></button> : null}
        </section>
        <section className="shinhan-identity__overview-section" aria-labelledby="shinhan-provable-title">
          <h3 id="shinhan-provable-title">증명 가능한 정보</h3>
          <p>요청할 때 필요한 정보만 선택해 확인할 수 있어요.</p>
          <div className="shinhan-identity__card">
            <IdentityRow icon={<UserCircle size={21} />} title="이름" detail={record?.name ?? ''} trailing={<CheckCircle size={18} aria-hidden="true" />} />
            <IdentityRow icon={<IdentificationCard size={21} />} title="생년월일" detail={record?.birthDate ?? ''} trailing={<CheckCircle size={18} aria-hidden="true" />} />
            <IdentityRow icon={<ShieldCheck size={21} />} title="휴대폰 소유 확인" detail={record?.phoneMasked ?? ''} trailing={<CheckCircle size={18} aria-hidden="true" />} />
          </div>
        </section>
      </> : null}

      {stage === 'proof-request' ? <>
        <div className="shinhan-identity__hero-icon"><ShieldCheck size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>이름과 생년월일을 확인할게요</h2>
        <p className="shinhan-identity__lead">요청한 곳과 확인할 조건을 먼저 살펴보세요.</p>
        <section className="shinhan-identity__card shinhan-identity__detail-card">
          <div><span>요청한 곳</span><strong>연동된 금융 서비스</strong></div>
          <div><span>확인할 조건</span><strong>이름 · 생년월일</strong></div>
          {connectedWallets.length ? <div><span>함께 확인</span><strong>연결된 지갑</strong></div> : null}
          <div><span>전달되는 정보</span><strong>확인 결과만</strong></div>
        </section>
      </> : null}

      {stage === 'proof-consent' ? <>
        <div className="shinhan-identity__hero-icon"><LockKey size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>이름과 생년월일 확인을 허용할까요?</h2>
        <p className="shinhan-identity__lead">{connectedWallets.length ? '이 요청에 한해 이름과 생년월일, 지갑 연결 상태를 확인해요.' : '이 요청에 한해 이름과 생년월일을 확인해요.'}</p>
        <section className="shinhan-identity__card">
          <IdentityRow icon={<ShieldCheck size={21} />} title="확인할 조건" detail="이름 · 생년월일" />
          {connectedWallets.length ? <IdentityRow icon={<Wallet size={21} />} title="연결된 지갑" detail={connectedWallets.map((id) => wallets[id].label).join(', ')} /> : null}
          <IdentityRow icon={<LockKey size={21} />} title="공개하지 않는 정보" detail="이름·생년월일 원문, 휴대폰 번호" />
        </section>
        <label className="shinhan-identity__consent"><input type="checkbox" checked={proofConsent} onChange={(event) => setProofConsent(event.target.checked)} /><span>이 요청에 한해 조건을 확인하는 데 동의해요.</span></label>
      </> : null}

      {stage === 'proof-result' ? <>
        <div className="shinhan-identity__hero-icon"><CheckCircle size={33} weight="duotone" aria-hidden="true" /></div>
        <h2>조건을 확인했어요</h2>
        <p className="shinhan-identity__lead">신원정보 원문을 공개하지 않고 결과만 전달했어요.</p>
        <section className="shinhan-identity__result">
          <span className="shinhan-identity__pill">확인 완료</span>
          <strong>이름 · 생년월일 확인 완료</strong>
          <p>요청한 정보를 확인했어요.</p>
          <div><span>요청한 곳</span><b>연동된 금융 서비스</b></div>
          <div><span>공개된 원문 정보</span><b>없음</b></div>
          {connectedWallets.length ? <div><span>연결된 지갑</span><b>{connectedWallets.length}개</b></div> : null}
        </section>
        <button className="shinhan-identity__text-action" type="button" onClick={() => { setProofConsent(false); setStage('proof-request'); }}><ArrowClockwise size={17} aria-hidden="true" /> 증명 요청 다시 보기</button>
      </> : null}

      {stage === 'cancelled' ? <>
        <div className="shinhan-identity__hero-icon"><LockKey size={31} weight="duotone" aria-hidden="true" /></div>
        <h2>요청을 취소했어요</h2>
        <p className="shinhan-identity__lead">동의하지 않으면 어떤 조건도 확인하지 않는 흐름이에요.</p>
        <section className="shinhan-identity__card"><IdentityRow icon={<ShieldCheck size={21} />} title="증명 요청" detail="취소됨 · 결과를 보내지 않음" /></section>
      </> : null}
    </div>

    <footer className="shinhan-identity__footer" inert={carrierSheetOpen}>
      {stage === 'intro' ? <IdentityButton onClick={() => setStage('profile')}>시작하기</IdentityButton> : null}
      {stage === 'profile' ? <IdentityButton onClick={() => setStage('phone-code')} disabled={!canContinueProfile}>인증번호 받기</IdentityButton> : null}
      {stage === 'phone-code' ? <IdentityButton onClick={() => setStage('app-check')} disabled={verificationCode.length !== 6}>휴대폰 인증 확인하기</IdentityButton> : null}
      {stage === 'app-check' ? <IdentityButton onClick={() => setStage('consent')}>다음</IdentityButton> : null}
      {stage === 'consent' ? <IdentityButton onClick={issueCredential} disabled={!consent}>디지털 ID 발급받기</IdentityButton> : null}
      {stage === 'issued' ? <IdentityButton onClick={openWalletSelect}>지갑 연결하기</IdentityButton> : null}
      {stage === 'wallet-select' ? <IdentityButton onClick={() => setStage('wallet-confirm')} disabled={connectedWallets.includes(selectedWallet)}>선택한 지갑 연결하기</IdentityButton> : null}
      {stage === 'wallet-confirm' ? <IdentityButton onClick={bindWallet}>지갑 연결 승인하기</IdentityButton> : null}
      {stage === 'connected' ? <IdentityButton onClick={() => setStage('proof-request')}>조건 증명하기</IdentityButton> : null}
      {stage === 'proof-request' ? <IdentityButton onClick={() => setStage('proof-consent')}>요청 내용 확인하기</IdentityButton> : null}
      {stage === 'proof-consent' ? <><IdentityButton onClick={() => setStage('proof-result')} disabled={!proofConsent}>동의하고 확인하기</IdentityButton><IdentityButton secondary onClick={() => setStage('cancelled')}>동의하지 않기</IdentityButton></> : null}
      {stage === 'proof-result' || stage === 'cancelled' ? <IdentityButton onClick={onClose}>쏠지갑으로 돌아가기</IdentityButton> : null}
    </footer>
    {carrierSheetOpen ? <div className="shinhan-identity__sheet-layer">
      <button className="shinhan-identity__sheet-scrim" type="button" aria-label="통신사 선택 닫기" onClick={closeCarrierSheet} />
      <section ref={carrierDialogRef} className="shinhan-identity__carrier-sheet" role="dialog" aria-modal="true" aria-labelledby="shinhan-carrier-title">
        <div className="shinhan-identity__sheet-handle" aria-hidden="true" />
        <header><h2 id="shinhan-carrier-title">통신사를 선택해 주세요</h2><button type="button" aria-label="닫기" onClick={closeCarrierSheet}><X size={20} aria-hidden="true" /></button></header>
        <div className="shinhan-identity__carrier-options">
          {carriers.map(([code, label]) => <button type="button" key={code} aria-pressed={carrier === code} onClick={() => { setCarrier(code); closeCarrierSheet(); }}><span>{label}</span>{carrier === code ? <Check size={18} weight="bold" aria-hidden="true" /> : null}</button>)}
        </div>
      </section>
    </div> : null}
  </div>;
}
