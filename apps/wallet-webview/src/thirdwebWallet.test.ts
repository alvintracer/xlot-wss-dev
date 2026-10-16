import { describe, expect, it, vi } from 'vitest';
import type { Account } from 'thirdweb/wallets';
import { signThirdwebEvmTransaction, signThirdwebUsdcPermit } from './thirdwebWallet';

const address = '0x1234567890123456789012345678901234567890';

describe('thirdweb customer signing', () => {
  it('passes the server prepared legacy transaction fields unchanged', async () => {
    const signTransaction = vi.fn(async () => '0xsigned');
    const account = { address, signTransaction } as unknown as Account;
    const result = await signThirdwebEvmTransaction(account, {
      type: 'evm-erc20', chainId: 137, nonce: 12,
      to: '0x2222222222222222222222222222222222222222',
      value: '0', gasLimit: '65000', gasPrice: '21000000000', data: '0xa9059cbb',
    });
    expect(result).toBe('0xsigned');
    expect(signTransaction).toHaveBeenCalledWith({
      type: 'legacy', chainId: 137, nonce: 12,
      to: '0x2222222222222222222222222222222222222222',
      value: 0n, gas: 65000n, gasPrice: 21000000000n, data: '0xa9059cbb',
    });
  });

  it('binds a USDC permit to the customer address, chain and verified nonce', async () => {
    const signTypedData = vi.fn(async () => '0xpermit');
    const account = { address, signTypedData } as unknown as Account;
    const result = await signThirdwebUsdcPermit(account, {
      domain: { name: 'USD Coin', version: '2', chainId: 8453,
        verifyingContract: '0x3333333333333333333333333333333333333333' },
      spender: '0x4444444444444444444444444444444444444444',
      value: '1250000', nonce: '8', deadline: 1780000000,
    });
    expect(result).toBe('0xpermit');
    expect(signTypedData).toHaveBeenCalledWith(expect.objectContaining({
      primaryType: 'Permit',
      domain: expect.objectContaining({ chainId: 8453 }),
      message: {
        owner: address, spender: '0x4444444444444444444444444444444444444444',
        value: 1250000n, nonce: 8n, deadline: 1780000000n,
      },
    }));
  });
});
