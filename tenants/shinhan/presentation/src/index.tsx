import type { WalletPresentationProps } from '@took-wss/contracts';
import WalletExperience from '@took-wss/tenant-kiwoom-presentation';
import { ShinhanWalletSummary } from './ShinhanWalletSummary';
import { ShinhanDigitalIdentityEntry } from './ShinhanDigitalIdentity';
import './styles.css';

export default function ShinhanWalletPresentation(props: WalletPresentationProps) {
  const HomeServices = ({ walletId, wallets, onFocusedOverlayChange }: { walletId: string; walletLabel: string; walletAddress?: string; wallets: import('@took-wss/contracts').WalletProfileSummary[]; onFocusedOverlayChange: (focused: boolean) => void }) =>
    props.onDigitalIdentityRequest
      ? <ShinhanDigitalIdentityEntry walletId={walletId} wallets={wallets}
        onFocusedOverlayChange={onFocusedOverlayChange} onRequest={props.onDigitalIdentityRequest} /> : null;
  return <div className="shinhan-ui shinhan-wallet-presentation"><WalletExperience {...props} HomeSummary={ShinhanWalletSummary} HomeServices={HomeServices} /></div>;
}
