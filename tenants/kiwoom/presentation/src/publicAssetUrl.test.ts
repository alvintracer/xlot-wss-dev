import { describe, expect, it } from 'vitest';
import { walletPublicAssetUrl } from './publicAssetUrl';

describe('wallet public asset URLs', () => {
  it('resolves logos inside the deployed wallet WebView base path', () => {
    expect(walletPublicAssetUrl('assets/coins/eth.png', '/kiwoom/wallet/'))
      .toBe('/kiwoom/wallet/assets/coins/eth.png');
    expect(walletPublicAssetUrl('/assets/chains/solana.png', '/kiwoom/wallet'))
      .toBe('/kiwoom/wallet/assets/chains/solana.png');
  });

  it('also works at the local Vite root', () => {
    expect(walletPublicAssetUrl('assets/coins/usdc.png', '/'))
      .toBe('/assets/coins/usdc.png');
  });
});
