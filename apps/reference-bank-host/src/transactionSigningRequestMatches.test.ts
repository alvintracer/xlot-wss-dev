import { describe, expect, it } from 'vitest';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';
import { transactionSigningRequestMatches } from './transactionSigningRequestMatches';

const request: SecureTransactionSigningRequest = {
  intentId: 'intent-1',
  walletId: 'wallet-1',
  chainId: 'ethereum',
  network: 'Ethereum',
  assetSymbol: 'ETH',
  amountDisplay: '0.01',
  fromAddress: '0x0000000000000000000000000000000000000002',
  recipient: '0x0000000000000000000000000000000000000001',
  channel: 'address',
  transaction: {
    type: 'evm-native',
    chainId: 1,
    nonce: 0,
    to: '0x0000000000000000000000000000000000000001',
    value: '10000000000000000',
    gasLimit: '21000',
    gasPrice: '20000000000',
  },
};

describe('transaction signing request comparison', () => {
  it('accepts the same payload after JSONB reorders object keys', () => {
    const reordered = {
      transaction: {
        gasPrice: '20000000000',
        to: '0x0000000000000000000000000000000000000001',
        nonce: 0,
        type: 'evm-native',
        value: '10000000000000000',
        gasLimit: '21000',
        chainId: 1,
      },
      channel: 'address',
      recipient: request.recipient,
      fromAddress: request.fromAddress,
      amountDisplay: '0.01',
      assetSymbol: 'ETH',
      network: 'Ethereum',
      chainId: 'ethereum',
      walletId: 'wallet-1',
      intentId: 'intent-1',
    };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(request));
    expect(transactionSigningRequestMatches(reordered, request)).toBe(true);
  });

  it('rejects any changed signed transaction field', () => {
    const changed = {
      ...request,
      transaction: { ...request.transaction, value: '10000000000000001' },
    };
    expect(transactionSigningRequestMatches(changed, request)).toBe(false);
  });
});
