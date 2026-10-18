import { CaretLeft } from '@phosphor-icons/react';
import {
  KiwoomHostHeader,
  KiwoomHostNavigation,
  type KiwoomHostChromeProps,
} from '@took-wss/tenant-kiwoom-host-chrome';
import { JbHostHeader, JbHostNavigation, JbHostPreview } from '@took-wss/tenant-jb-host-chrome';
import { NamuHostHeader, NamuHostNavigation } from '@took-wss/tenant-namu-host-chrome';
import { ShinhanHostHeader, ShinhanHostNavigation, type ShinhanFinanceTab, type ShinhanRootTab } from '@took-wss/tenant-shinhan-host-chrome';
import { ShinhanHostPreview } from './ShinhanHostPreview';
import type { ComponentType } from 'react';

export interface HostChromeProps extends KiwoomHostChromeProps {
  activeTab?: string;
  onSelectTab?: (tab: string) => void;
  customerName?: string | null;
}

export interface HostChromeProfile {
  Header: ComponentType<HostChromeProps>;
  Navigation: ComponentType<HostChromeProps>;
  Preview?: ComponentType<HostChromeProps>;
  initialTab: string;
  walletTab: string;
  walletEntryMotion?: 'slide-from-right';
}

function GenericHostHeader() {
  return <header className="bank-header"><CaretLeft size={21} aria-hidden="true" /><strong>자산</strong><span /></header>;
}

function GenericHostNavigation() {
  return <nav className="bank-tabs" aria-label="금융사 앱 기본 메뉴"><span>탐색</span><span>관심</span><strong aria-current="page">자산</strong><span>혜택</span><span>메뉴</span></nav>;
}

const genericHostChrome: HostChromeProfile = {
  Header: GenericHostHeader,
  Navigation: GenericHostNavigation,
  initialTab: 'wallet',
  walletTab: 'wallet',
};

function ShinhanHeader({ activeTab = 'finance:bank', onSelectTab, onAction, onOpenWalletSettings }: HostChromeProps) {
  const section = activeTab === 'wallet' ? 'wallet' : activeTab === 'exchange' ? 'exchange' : 'finance';
  const financeTab = activeTab.startsWith('finance:') ? activeTab.slice(8) as ShinhanFinanceTab : 'bank';
  return <ShinhanHostHeader section={section} financeTab={financeTab}
    onSettings={onOpenWalletSettings}
    onFinanceTab={(tab) => onSelectTab?.(`finance:${tab}`)}
    onBack={() => onSelectTab?.('finance:bank')}
    onAction={(action) => {
      if (action === 'wallet') onSelectTab?.('wallet');
      else if (action === 'home') onSelectTab?.('finance:bank');
      else onAction?.(`${action === 'search' ? '검색' : 'AI 상담'} 미리보기`);
    }} />;
}

function ShinhanNavigation({ activeTab = 'finance:bank', onSelectTab, onAction }: HostChromeProps) {
  if (activeTab === 'wallet') return null;
  const selected = activeTab.startsWith('finance:') ? 'finance' : activeTab as ShinhanRootTab;
  return <ShinhanHostNavigation activeTab={selected} onSelectTab={(tab) => {
    if (tab === 'finance') onSelectTab?.('finance:bank');
    else onAction?.(`${tab === 'home' ? '홈' : tab === 'products' ? '상품' : tab === 'benefits' ? '혜택' : '주식'} 미리보기`);
  }} />;
}

const hostChromeProfiles: Readonly<Record<string, HostChromeProfile>> = {
  'kiwoom-simple-mode-v1': {
    Header: KiwoomHostHeader,
    Navigation: KiwoomHostNavigation,
    initialTab: 'wallet',
    walletTab: 'wallet',
  },
  'jb-mobile-wallet-v1': {
    Header: JbHostHeader,
    Navigation: JbHostNavigation,
    Preview: JbHostPreview,
    initialTab: 'wallet',
    walletTab: 'wallet',
  },
  'namu-investment-wallet-v1': {
    Header: NamuHostHeader,
    Navigation: NamuHostNavigation,
    initialTab: 'wallet',
    walletTab: 'wallet',
  },
  'shinhan-super-sol-preview-v1': {
    Header: ShinhanHeader,
    Navigation: ShinhanNavigation,
    Preview: ShinhanHostPreview,
    initialTab: 'finance:bank',
    walletTab: 'wallet',
    walletEntryMotion: 'slide-from-right',
  },
};

export function getHostChromeProfile(profileId: string): HostChromeProfile {
  return hostChromeProfiles[profileId] ?? genericHostChrome;
}
