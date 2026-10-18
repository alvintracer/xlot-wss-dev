import type { WalletPresentationProps, WalletProfileSummary } from '@took-wss/contracts';
import WalletExperience from '@took-wss/tenant-kiwoom-presentation';
import { ShinhanWalletSummary } from './ShinhanWalletSummary';
import { ShinhanDigitalIdentityEntry } from './ShinhanDigitalIdentity';
import { ShinhanDIDIssuance } from './ShinhanDIDIssuance';
import { useState } from 'react';
import { ShinhanWalletTabsContext, type ShinhanWalletTab, useShinhanWalletTabs } from './ShinhanWalletTabs';
import './styles.css';

function ShinhanHomeServices({ walletId, wallets, onFocusedOverlayChange }: {
  walletId: string; walletLabel: string; walletAddress?: string; wallets: WalletProfileSummary[];
  onFocusedOverlayChange: (focused: boolean) => void;
}) {
  const { onRequest } = useShinhanWalletTabs();
  return onRequest ? <ShinhanDigitalIdentityEntry walletId={walletId} wallets={wallets}
    onFocusedOverlayChange={onFocusedOverlayChange} onRequest={onRequest} /> : null;
}

export default function ShinhanWalletPresentation(props: WalletPresentationProps) {
  const [tab, setTab] = useState<ShinhanWalletTab>('identity');
  return <ShinhanWalletTabsContext.Provider value={{ tab, setTab, onRequest: props.onDigitalIdentityRequest }}><div className="shinhan-ui shinhan-wallet-presentation"><WalletExperience {...props} HomeSummary={ShinhanWalletSummary} HomeServices={ShinhanHomeServices} DigitalIdentityFlow={ShinhanDIDIssuance} /></div></ShinhanWalletTabsContext.Provider>;
}
