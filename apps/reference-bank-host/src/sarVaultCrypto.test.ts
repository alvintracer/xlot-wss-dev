import { describe, expect, it } from 'vitest';
import { decryptSarVaultShares, encryptSarVaultShares } from './sarVaultCrypto';

describe('host SAR vault encryption', () => {
  it('encrypts three distinct shares and restores B plus C with the password', async () => {
    const material = {
      kind: 'evm-private-key' as const,
      shares: [new Uint8Array(33).fill(1), new Uint8Array(33).fill(2), new Uint8Array(33).fill(3)] as const,
    };
    const encrypted = await encryptSarVaultShares('kiwoom', 'wallet-1', 'secure-password-123', material);
    expect(encrypted.map((item) => item.ciphertextBase64)).not.toContain('AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC');
    const restored = await decryptSarVaultShares('kiwoom', 'wallet-1', 'secure-password-123', [encrypted[1], encrypted[2]]);
    expect(restored.kind).toBe('evm-private-key');
    expect(restored.shares[0]).toEqual(material.shares[1]);
    expect(restored.shares[1]).toEqual(material.shares[2]);
    restored.shares.forEach((share) => share.fill(0));
  });

  it('rejects a wrong password or wallet binding', async () => {
    const material = {
      kind: 'mnemonic-entropy' as const,
      shares: [new Uint8Array(17).fill(1), new Uint8Array(17).fill(2), new Uint8Array(17).fill(3)] as const,
    };
    const encrypted = await encryptSarVaultShares('jb', 'wallet-2', 'secure-password-123', material);
    await expect(decryptSarVaultShares('jb', 'wallet-2', 'incorrect-password', [encrypted[1], encrypted[2]]))
      .rejects.toThrow('vault_password_or_envelope_invalid');
    await expect(decryptSarVaultShares('jb', 'other-wallet', 'secure-password-123', [encrypted[1], encrypted[2]]))
      .rejects.toThrow('vault_envelope_mismatch');
  });
});
