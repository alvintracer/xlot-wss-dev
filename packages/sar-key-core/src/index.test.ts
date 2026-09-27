import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { ReferenceHostSarKeyCore } from './index';

describe('reference host SAR key core', () => {
  it('creates distinct real multichain addresses without returning secret material', async () => {
    const core = new ReferenceHostSarKeyCore();
    const first = await core.createWallet();
    const second = await core.createWallet();

    expect(first.addresses.map(({ addressGroupId }) => addressGroupId)).toEqual(['evm', 'solana', 'bitcoin', 'tron', 'xrp']);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'evm')?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'bitcoin')?.address).toMatch(/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'tron')?.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'xrp')?.address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    expect(second.addresses).not.toEqual(first.addresses);
    expect(first.recoveryEnvelopes).toHaveLength(3);
    expect(new Set(first.recoveryEnvelopes.map(({ factorIndex }) => factorIndex))).toEqual(new Set([1, 2, 3]));
    expect(first.recoveryEnvelopes.every(({ ciphertextBase64 }) => ciphertextBase64.length >= 24)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/mnemonic|privateKey|seedPhrase|recoveryShare|entropy|\bshare\b/i);
  });

  it('reconstructs the wallet through every valid two-of-three share pair', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();

    await expect(core.verifyRecovery(wallet.keyHandle, [0, 1])).resolves.toBe(true);
    await expect(core.verifyRecovery(wallet.keyHandle, [0, 2])).resolves.toBe(true);
    await expect(core.verifyRecovery(wallet.keyHandle, [1, 2])).resolves.toBe(true);
    await expect(core.verifyRecovery(wallet.keyHandle, [1, 1])).resolves.toBe(false);
  });

  it('prepares a real 12-word BIP-39 backup and can discard the uncommitted wallet', async () => {
    const core = new ReferenceHostSarKeyCore();
    const prepared = await core.prepareWallet();

    expect(prepared.mnemonicWords).toHaveLength(12);
    expect(ethers.Mnemonic.isValidMnemonic(prepared.mnemonicWords.join(' '))).toBe(true);
    expect(JSON.stringify(prepared.wallet)).not.toContain(prepared.mnemonicWords.join(' '));
    await expect(core.verifyRecovery(prepared.wallet.keyHandle, [0, 1])).resolves.toBe(true);

    await core.discardWallet(prepared.wallet.keyHandle);
    await expect(core.verifyRecovery(prepared.wallet.keyHandle, [0, 1])).resolves.toBe(false);
  });
});
