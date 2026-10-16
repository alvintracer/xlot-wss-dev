import { describe, expect, it } from 'vitest';
import type { WalletPaymentRequest } from '@took-wss/contracts';
import { serializePaymentEvidenceCsv } from './paymentEvidence';

const payment: WalletPaymentRequest = {
  id: '946bf62a-1b83-4ed7-8396-283f8eccca12', tenantId: 'namu', walletId: 'wallet-1',
  chainId: 'base', assetId: 'base:usdc', assetSymbol: 'USDC', decimals: 6,
  amountAtomic: '1500000', recipientAddress: '0x1111111111111111111111111111111111111111',
  status: 'confirmed', createdAt: '2026-10-10T09:00:00.000Z',
  expiresAt: '2026-10-10T09:15:00.000Z', confirmedAt: '2026-10-10T09:02:00.000Z',
  referencePriceKrw: '1400', referenceAmountKrw: '2100', referencePriceAsOf: '2026-10-10T08:59:00.000Z',
  transactionHash: '0xabc',
};

describe('QR payment evidence CSV', () => {
  it('uses the server price snapshot and escapes spreadsheet formulas in wallet labels', () => {
    const csv = serializePaymentEvidenceCsv([payment, { ...payment, id: 'another', status: 'pending' }],
      { 'wallet-1': '=HYPERLINK("bad")' });
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('2026-10-10T09:02:00.000Z');
    expect(csv).toContain('1.5,2100,1400,2026-10-10T08:59:00.000Z');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });
});
