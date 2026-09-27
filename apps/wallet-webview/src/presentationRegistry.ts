import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { WalletPresentationProps } from '@took-wss/contracts';

type WalletPresentation = LazyExoticComponent<ComponentType<WalletPresentationProps>>;

const genericPresentation = lazy(() => import('./GenericWalletPresentation'));
const presentations: Record<string, WalletPresentation> = {
  'kiwoom-simple-mode-v1': lazy(() => import('@took-wss/tenant-kiwoom-presentation')),
  'wss-reference-bank-v1': genericPresentation,
};

export function getWalletPresentation(profileId: string): WalletPresentation {
  return presentations[profileId] ?? genericPresentation;
}
