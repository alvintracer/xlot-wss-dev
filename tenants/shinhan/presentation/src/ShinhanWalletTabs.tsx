import { createContext, useContext } from 'react';
import type { DigitalIdentityHostAction, DigitalIdentityHostResult } from '@took-wss/contracts';

export type ShinhanWalletTab = 'identity' | 'assets';
export const ShinhanWalletTabsContext = createContext<{
  tab: ShinhanWalletTab;
  setTab: (tab: ShinhanWalletTab) => void;
  displayName?: string;
  onRequest?: (action: DigitalIdentityHostAction, walletId?: string) => Promise<DigitalIdentityHostResult>;
}>({ tab: 'identity', setTab: () => undefined });
export const useShinhanWalletTabs = () => useContext(ShinhanWalletTabsContext);
