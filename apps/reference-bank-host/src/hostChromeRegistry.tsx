import { CaretLeft } from '@phosphor-icons/react';
import {
  KiwoomHostHeader,
  KiwoomHostNavigation,
  type KiwoomHostChromeProps,
} from '@took-wss/tenant-kiwoom-host-chrome';
import { JbHostHeader, JbHostNavigation, JbHostPreview } from '@took-wss/tenant-jb-host-chrome';
import { NamuHostHeader, NamuHostNavigation } from '@took-wss/tenant-namu-host-chrome';
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
};

export function getHostChromeProfile(profileId: string): HostChromeProfile {
  return hostChromeProfiles[profileId] ?? genericHostChrome;
}
