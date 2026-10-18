import { ArrowClockwise } from '@phosphor-icons/react';
import type { Ref } from 'react';
import { ShinhanPaymentDeck } from './ShinhanPaymentDeck';

const icons = {
  did: new URL('../assets/derived/identity-payment/did-credential.png', import.meta.url).href,
  mobileId: new URL('../assets/supplied/identity-payment/icon_mobile_id.png', import.meta.url).href,
  govCertificate: new URL('../assets/supplied/identity-payment/icon_gov_certificate.png', import.meta.url).href,
  bankCertificate: new URL('../assets/supplied/identity-payment/icon_bank_certificate.png', import.meta.url).href,
  digitalDocument: new URL('../assets/supplied/identity-payment/icon_digital_document.png', import.meta.url).href,
  mobileNotification: new URL('../assets/supplied/identity-payment/icon_mobile_notification.png', import.meta.url).href,
  insuranceCertificate: new URL('../assets/supplied/identity-payment/icon_insurance_certificate.png', import.meta.url).href,
  nationalSecretary: new URL('../assets/supplied/identity-payment/icon_national_secretary.png', import.meta.url).href,
  publicServices: new URL('../assets/supplied/identity-payment/icon_public_services.png', import.meta.url).href,
  payPoints: new URL('../assets/supplied/identity-payment/icon_pay_points.png', import.meta.url).href,
  airportSmartPass: new URL('../assets/supplied/identity-payment/icon_airport_smart_pass.png', import.meta.url).href,
  hiddenRefund: new URL('../assets/supplied/identity-payment/icon_hidden_refund.png', import.meta.url).href,
};
const documentItems = [
  { label: '정부 전자증명서 발급', detail: '주민등록등본 등 정부24 서류 발급', icon: icons.govCertificate },
  { label: '은행 증명서 발급', detail: '잔액증명서 등 서류 발급', icon: icons.bankCertificate },
  { label: '디지털서류함', detail: '상품 가입 등 각종 은행 서류 확인', icon: icons.digitalDocument },
  { label: '모바일 전자통지함', detail: '신한은행 계약서류 확인', icon: icons.mobileNotification },
  { label: '보험 증명서발급', detail: '증권재발행 서류 발급', icon: icons.insuranceCertificate },
] as const;
const recommendedItems = [
  { label: '국민비서', detail: '꼭 필요한 생활행정 정보 알림 받기', icon: icons.nationalSecretary },
  { label: '공공서비스 모아보기', detail: '다양한 정부 서비스를 한곳에서', icon: icons.publicServices },
  { label: '페이/포인트', detail: '흩어져 있는 포인트를 한 번에 확인', icon: icons.payPoints },
  { label: '인천공항 스마트 패스', detail: '출국 시간을 줄이고 싶다면', icon: icons.airportSmartPass },
  { label: '숨은 환급금 찾기', detail: '잠자고 있는 내 돈이 궁금하다면', icon: icons.hiddenRefund },
] as const;
const serviceIcons: Record<string, string> = Object.fromEntries([...documentItems, ...recommendedItems].map(({ label, icon }) => [label, icon]));

export function shinhanIdentityServiceIcon(label: string): string | undefined {
  return label === '모바일 신분증' ? icons.mobileId : serviceIcons[label];
}

function ServiceList({ title, items, onSelect }: {
  title: string;
  items: typeof documentItems | typeof recommendedItems;
  onSelect: (label: string) => void;
}) {
  return <section className="shinhan-identity-home__services" aria-label={title}>
    <h2>{title}</h2>
    <div className="shinhan-identity-home__menu">{items.map(({ label, detail, icon }) => <button key={label} type="button" onClick={() => onSelect(label)}>
      <span className="shinhan-identity-home__service-icon"><img src={icon} alt="" /></span>
      <span className="shinhan-identity-home__service-copy"><strong>{label}</strong><small>{detail}</small></span>
    </button>)}</div>
  </section>;
}

export function ShinhanIdentityHome({ connectedWalletCount, identityButtonRef, onIdentity, onRefresh, onAuxiliary, onWalletCard, onWalletPos }: {
  connectedWalletCount: number | null;
  identityButtonRef?: Ref<HTMLButtonElement>;
  onIdentity: () => void;
  onRefresh: () => void;
  onAuxiliary: (label: string) => void;
  onWalletCard: () => void;
  onWalletPos: () => void;
}) {
  return <div className="shinhan-identity-home">
    <section className="shinhan-identity-home__top" aria-label="신분과 결제">
      <div className="shinhan-identity-home__top-inner">
        <div className="shinhan-identity-home__heading"><h2>신분/증명</h2><button type="button" aria-label="신분/증명 새로고침" onClick={onRefresh}><ArrowClockwise size={20} aria-hidden="true" /></button></div>
        <button ref={identityButtonRef} className="shinhan-identity-home__credential shinhan-identity-home__credential--did" type="button" onClick={onIdentity}>
          <span className="shinhan-identity-home__credential-row"><span className="shinhan-identity-home__credential-visual"><img src={icons.did} alt="" /></span><strong>신한 DID</strong><span className="shinhan-identity-home__credential-action">{connectedWalletCount !== null ? '확인' : '발급'}</span></span>
          <span className="shinhan-identity-home__credential-note"><span>공개 없이 증명만, 내 디지털 신원인증</span><small>{connectedWalletCount !== null ? `연결된 지갑 ${connectedWalletCount}개` : '발급하고 지갑에 연결해요'}</small></span>
        </button>
        <div className="shinhan-identity-home__credential shinhan-identity-home__credential--mobile"><div className="shinhan-identity-home__credential-row"><span className="shinhan-identity-home__credential-visual"><img src={icons.mobileId} alt="" /></span><strong>모바일 신분증</strong><button className="shinhan-identity-home__credential-action" type="button" onClick={() => onAuxiliary('모바일 신분증')}>가입</button></div><p className="shinhan-identity-home__credential-note">실물 신분증처럼 그대로 사용해요!</p></div>
        <ShinhanPaymentDeck onEasy={() => onAuxiliary('쏠편한 결제')} onSolPay={() => onAuxiliary('SOL Pay 결제')} onWalletCard={onWalletCard} onWalletPos={onWalletPos} />
      </div>
    </section>
    <ServiceList title="전자문서 지갑" items={documentItems} onSelect={onAuxiliary} />
    <ServiceList title="추천 서비스" items={recommendedItems} onSelect={onAuxiliary} />
  </div>;
}
