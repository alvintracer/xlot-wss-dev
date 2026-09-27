import { describe, expect, it } from 'vitest';
import { kiwoomManifest } from './index';

describe('Kiwoom tenant profile', () => {
  it('uses SAR by default and offers both approved provider wallet options', () => {
    expect(kiwoomManifest.keyManagement.policyVersion).toBe(1);
    expect(kiwoomManifest.keyManagement.recoveryRequirement).toBe('sar-preferred');
    expect(kiwoomManifest.keyManagement.defaultAdapter).toBe('took-sar');
    expect(kiwoomManifest.keyManagement.allowedAdapters).toEqual([
      'took-sar',
      'thirdweb-user-wallet',
      'fsl-mpc',
    ]);
  });

  it('routes execution to FSL WIS and enables the core compliance/quote modules', () => {
    expect(kiwoomManifest.providers.execution).toBe('fsl-wis');
    expect(kiwoomManifest.enabledModules).toEqual(expect.arrayContaining(['kyt', 'k-vwap', 'gas-sponsorship', 'super-wallet']));
  });

  it('binds visible UI to the screenshot-derived Kiwoom simple-mode profile', () => {
    expect(kiwoomManifest.presentation).toEqual({
      profileId: 'kiwoom-simple-mode-v1',
      guideVersion: '1.0.0',
      rootHeaderOwner: 'host',
      rootNavigationOwner: 'host',
      safeAreaOwner: 'host',
      navigation: {
        rootEntry: 'host-tabs',
        focusedFlow: 'hide-host-chrome',
        walletMenu: 'none',
      },
    });
    expect(kiwoomManifest.brand.primaryColor).toBe('#7D3BDD');
    expect(kiwoomManifest.brand.surfaceColor).toBe('#F5F5F5');
  });
});
