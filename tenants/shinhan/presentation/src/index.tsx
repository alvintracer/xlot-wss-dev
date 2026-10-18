import type { WalletPresentationProps } from '@took-wss/contracts';
import WalletExperience from '@took-wss/tenant-kiwoom-presentation';
import { ShinhanWalletSummary } from './ShinhanWalletSummary';
import './styles.css';

export default function ShinhanWalletPresentation(props: WalletPresentationProps) {
  return <div className="shinhan-ui shinhan-wallet-presentation"><WalletExperience {...props} HomeSummary={ShinhanWalletSummary} /></div>;
}
