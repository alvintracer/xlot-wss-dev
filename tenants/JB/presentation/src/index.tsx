import type { WalletPresentationProps } from '@took-wss/contracts';
import WalletExperience from '@took-wss/tenant-kiwoom-presentation';
import { JbWalletSummary } from './JbWalletSummary';
import './styles.css';

export default function JbWalletPresentation(props: WalletPresentationProps) {
  return <div className="jb-wallet"><WalletExperience {...props} HomeSummary={JbWalletSummary} /></div>;
}
