import { describe, expect, it } from 'vitest';
import type { PrepareTransferRequest } from '@took-wss/contracts';
import { krwReferenceAmount, matchesQrPayment } from './qrPaymentService.js';

const request: PrepareTransferRequest = {
  walletId: 'wallet-one', assetId: 'base:usdc', chainId: 'base',
  recipient: '0x1111111111111111111111111111111111111111', amountAtomic: '1250000',
  channel: 'address', paymentRequestId: '946bf62a-1b83-4ed7-8396-283f8eccca12',
};
const invoice = {
  status: 'pending', expires_at: new Date('2030-01-01T00:00:00Z'),
  chain_id: 'base', asset_id: 'base:usdc', amount_atomic: '1250000',
  recipient_address: '0x1111111111111111111111111111111111111111',
};

describe('QR payment preparation binding', () => {
  it('snapshots the KRW reference with integer arithmetic', () => {
    expect(krwReferenceAmount('1500000', 6, '1400')).toBe('2100');
    expect(krwReferenceAmount('1', 6, '1400.25')).toBe('0');
  });
  it('accepts only the exact server issued amount, asset, chain and recipient', () => {
    const now = Date.parse('2029-12-31T00:00:00Z');
    expect(matchesQrPayment(request, invoice, now)).toBe(true);
    expect(matchesQrPayment({ ...request, amountAtomic: '1250001' }, invoice, now)).toBe(false);
    expect(matchesQrPayment({ ...request, assetId: 'base:eth' }, invoice, now)).toBe(false);
    expect(matchesQrPayment({ ...request, chainId: 'arbitrum' }, invoice, now)).toBe(false);
    expect(matchesQrPayment({ ...request, recipient: '0x2222222222222222222222222222222222222222' }, invoice, now)).toBe(false);
    expect(matchesQrPayment({ ...request, channel: 'phone' }, invoice, now)).toBe(false);
    expect(matchesQrPayment({ ...request, destinationWalletId: 'another-wallet' }, invoice, now)).toBe(false);
    expect(matchesQrPayment(request, { ...invoice, status: 'reserved' }, now)).toBe(false);
    expect(matchesQrPayment(request, invoice, Date.parse('2030-01-01T00:00:01Z'))).toBe(false);
  });
});
