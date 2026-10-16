import { describe, expect, it } from 'vitest';
import type { ReadyWalletHomePayload } from '@took-wss/contracts';
import {
  formatAtomic,
  parseAmountToAtomic,
  parseKrwToAtomic,
  parseScannedRecipient,
  ownWalletReceiveDestination,
  transferPreparationErrorMessage,
} from './WalletActionSheet';

describe('transferring between owned wallets', () => {
  const address = `0x${'b'.repeat(40)}`;
  const home = {
    wallet: { walletId: 'destination', label: '나무 월렛 2' },
    networks: [{ chainId: 'base', addressStatus: 'ready', address }],
    receiveAssets: [{ assetId: 'base-usdc', chainId: 'base' }],
  } as ReadyWalletHomePayload;

  it('uses a ready address only for the matching asset and chain', () => {
    expect(ownWalletReceiveDestination(home, { assetId: 'base-usdc', chainId: 'base' }, `0x${'a'.repeat(40)}`))
      .toEqual({ walletId: 'destination', label: '나무 월렛 2', address });
    expect(ownWalletReceiveDestination(home, { assetId: 'ethereum-usdc', chainId: 'ethereum' })).toBeNull();
    expect(ownWalletReceiveDestination(home, { assetId: 'base-usdc', chainId: 'base' }, address.toUpperCase())).toBeNull();
  });
});

describe('wallet transfer amount conversion', () => {
  it('converts token display amounts to exact atomic strings', () => {
    expect(parseAmountToAtomic('1.25', 6)).toBe('1250000');
    expect(parseAmountToAtomic('1.0000001', 6)).toBeNull();
    expect(parseAmountToAtomic('0', 6)).toBeNull();
  });

  it('converts KRW input with an exact decimal price without floating point math', () => {
    expect(parseKrwToAtomic('1,380', '1380', 6)).toBe('1000000');
    expect(parseKrwToAtomic('2,761', '1380.5', 6)).toBe('2000000');
    expect(parseKrwToAtomic('1000', undefined, 6)).toBeNull();
  });

  it('formats atomic values with bounded visible precision', () => {
    expect(formatAtomic(123456789n, 6)).toBe('123.456789');
    expect(formatAtomic(123456789n, 6, 2)).toBe('123.45');
  });
});

describe('scanned recipient addresses', () => {
  const address = `0x${'a'.repeat(40)}`;

  it('accepts a plain address on the selected network', () => {
    expect(parseScannedRecipient(address, 'base')).toBe(address);
  });

  it('requires payment URI chain to match the selected network', () => {
    expect(parseScannedRecipient(`ethereum:${address}@8453`, 'base')).toBe(address);
    expect(parseScannedRecipient(`ethereum:${address}@137`, 'base')).toBeNull();
    expect(parseScannedRecipient(`ethereum:${address}`, 'base')).toBeNull();
  });

  it('rejects QR payment requests and unrelated URLs', () => {
    expect(parseScannedRecipient(`ethereum:${address}@8453?value=100`, 'base')).toBeNull();
    expect(parseScannedRecipient(`https://example.com/${address}`, 'base')).toBeNull();
  });
});

describe('wallet transfer preparation errors', () => {
  it('asks to reselect an owned destination that no longer matches the institution record', () => {
    expect(transferPreparationErrorMessage(new Error('own_wallet_destination_invalid'), 'own-wallet'))
      .toBe('받는 내 지갑 주소를 확인하지 못했어요. 지갑을 다시 선택해 주세요.');
  });
  it('explains the missing native gas asset instead of showing a generic rejection', () => {
    expect(transferPreparationErrorMessage(new Error('insufficient_balance_for_fee'), 'address', 'ETH'))
      .toBe('네트워크 수수료로 사용할 ETH 잔액이 부족해요. 수수료 자산을 채운 뒤 다시 시도해 주세요.');
  });

  it('keeps provider failures retryable without leaking provider details', () => {
    expect(transferPreparationErrorMessage(new Error('transfer_preparation_unavailable'), 'address', 'ETH'))
      .toBe('네트워크 수수료를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  });
});
