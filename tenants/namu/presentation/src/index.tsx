import type { WalletPresentationProps } from '@took-wss/contracts';
import WalletExperience from '@took-wss/tenant-kiwoom-presentation';
import { NamuWalletSummary } from './NamuWalletSummary';
import { NamuServices } from './NamuServices';
import { cancelPhysicalCardScan, scanPhysicalCard } from './nativeDevice';
import './styles.css';

export default function NamuWalletPresentation(props: WalletPresentationProps) {
  return <div className="namu-ui namu-wallet"><WalletExperience {...props} HomeSummary={NamuWalletSummary} HomeServices={NamuServices} onScanPhysicalCard={scanPhysicalCard} onCancelPhysicalCardScan={cancelPhysicalCardScan} /></div>;
}
