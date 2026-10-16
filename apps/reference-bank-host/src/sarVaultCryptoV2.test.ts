import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { ReferenceHostSarKeyCore } from '@took-wss/sar-key-core';
import { decodeFactorShare, decryptPasswordShare, encryptPasswordShare, plainFactorShare } from './sarVaultCryptoV2';

describe('SAR vault v2 recovery', () => {
  it('restores the same signer with each of the three factor pairs', async () => {
    const original = new ReferenceHostSarKeyCore();
    const wallet = await original.prepareImportedMnemonic('test test test test test test test test test test test junk');
    const address = wallet.addresses.find((item) => item.addressGroupId === 'evm')!.address;
    const shares = await original.exportVaultSharesForKeyHandle(wallet.keyHandle);
    const password = await encryptPasswordShare('jb', 'wallet-1', 'long-master-password', shares.kind, shares.shares[0]);
    const phone = plainFactorShare('phone', shares.kind, shares.shares[1]);
    const email = plainFactorShare('email', shares.kind, shares.shares[2]);
    await original.discardWallet(wallet.keyHandle);

    await expect(decryptPasswordShare('jb', 'wallet-1', 'wrong-password', password))
      .rejects.toThrow('vault_password_or_envelope_invalid');
    await expect(decryptPasswordShare('kiwoom', 'wallet-1', 'long-master-password', password))
      .rejects.toThrow('vault_envelope_mismatch');

    for (const factors of [['password', 'phone'], ['password', 'email'], ['phone', 'email']] as const) {
      const restored = new ReferenceHostSarKeyCore();
      const first = factors[0] === 'password'
        ? await decryptPasswordShare('jb', 'wallet-1', 'long-master-password', password)
        : decodeFactorShare('phone', phone);
      const second = factors[1] === 'phone' ? decodeFactorShare('phone', phone)
        : decodeFactorShare('email', email);
      try {
        await restored.restoreVaultSharesForAddress([first.share, second.share], first.kind, 'evm', address);
        const signed = await restored.signEvmTransactionForAddress(address, {
          chainId: 1, nonce: 0, to: '0x0000000000000000000000000000000000000001',
          value: '1', gasLimit: '21000', gasPrice: '1',
        });
        expect(ethers.Transaction.from(signed).from).toBe(address);
        expect(await restored.revealRecoverySecretForAddress('evm', address)).toEqual({
          kind: 'mnemonic-entropy',
          value: 'test test test test test test test test test test test junk',
        });
      } finally {
        first.share.fill(0);
        second.share.fill(0);
        await restored.discardSignersForAddress('evm', address);
      }
    }
    for (const share of shares.shares) share.fill(0);
  });
});
