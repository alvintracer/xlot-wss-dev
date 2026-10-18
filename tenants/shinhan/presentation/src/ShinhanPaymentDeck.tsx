import { CreditCard, QrCode, Storefront, Wallet } from '@phosphor-icons/react';

export function ShinhanPaymentDeck({ onEasy, onSolPay, onWalletCard, onWalletPos }: {
  onEasy: () => void;
  onSolPay: () => void;
  onWalletCard: () => void;
  onWalletPos: () => void;
}) {
  return <section className="shinhan-identity-home__pay" aria-label="결제 서비스">
    <div className="shinhan-identity-home__pay-row shinhan-identity-home__pay-row--easy"><span className="shinhan-identity-home__pay-icon shinhan-identity-home__pay-icon--easy"><CreditCard size={23} weight="duotone" aria-hidden="true" /></span><span className="shinhan-identity-home__pay-copy"><strong>쏠편한 결제</strong><small>카드, 현금 없이 간편하게</small></span><button type="button" aria-label="쏠편한 결제 가입" onClick={onEasy}>가입</button></div>
    <div className="shinhan-identity-home__pay-row shinhan-identity-home__pay-row--sol"><span className="shinhan-identity-home__pay-icon shinhan-identity-home__pay-icon--sol"><QrCode size={24} weight="duotone" aria-hidden="true" /></span><span className="shinhan-identity-home__pay-copy"><strong>SOL Pay 결제</strong><small>앱카드, QR·바코드로 쉽고 빠르게</small></span><button type="button" aria-label="SOL Pay 결제" onClick={onSolPay}>결제</button></div>
    <div className="shinhan-identity-home__pay-wallet"><span className="shinhan-identity-home__pay-wallet-label">SOL Wallet</span>
      <div className="shinhan-identity-home__pay-row shinhan-identity-home__pay-row--wallet"><span className="shinhan-identity-home__pay-icon shinhan-identity-home__pay-icon--wallet"><Wallet size={23} weight="duotone" aria-hidden="true" /></span><span className="shinhan-identity-home__pay-copy"><strong>쏠지갑 결제</strong><small>월렛카드로 내 자산을 확인해요</small></span><button type="button" aria-label="쏠지갑 결제 월렛 카드 열기" onClick={onWalletCard}>열기</button></div>
      <div className="shinhan-identity-home__pay-row shinhan-identity-home__pay-row--wallet"><span className="shinhan-identity-home__pay-icon shinhan-identity-home__pay-icon--wallet"><Storefront size={23} weight="duotone" aria-hidden="true" /></span><span className="shinhan-identity-home__pay-copy"><strong>쏠지갑 POS</strong><small>QR로 결제를 요청하고 받아요</small></span><button type="button" aria-label="쏠지갑 POS 열기" onClick={onWalletPos}>열기</button></div>
    </div>
  </section>;
}
