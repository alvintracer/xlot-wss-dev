import { CaretLeft } from '@phosphor-icons/react';
import {
  KiwoomHostHeader,
  KiwoomHostNavigation,
  type KiwoomHostChromeProps,
} from '@took-wss/tenant-kiwoom-host-chrome';
import type { ComponentType } from 'react';

export interface HostChromeProfile {
  Header: ComponentType<KiwoomHostChromeProps>;
  Navigation: ComponentType<KiwoomHostChromeProps>;
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
};

const hostChromeProfiles: Readonly<Record<string, HostChromeProfile>> = {
  'kiwoom-simple-mode-v1': {
    Header: KiwoomHostHeader,
    Navigation: KiwoomHostNavigation,
  },
};

export function getHostChromeProfile(profileId: string): HostChromeProfile {
  return hostChromeProfiles[profileId] ?? genericHostChrome;
}
