import { describe, expect, it } from 'vitest';
import { createLocalSarVault, openLocalSarVault, replaceLocalSarVaultPin } from './localSarVault';
import { decryptPasswordShare, encryptPasswordShare } from './sarVaultCryptoV2';

describe('PWA local SAR vault', () => {
  it('opens new local and recovery envelopes with the same master password', async () => {
    const deviceKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const material = {
      kind: 'mnemonic-entropy' as const,
      shares: [new Uint8Array(17).fill(1), new Uint8Array(17).fill(2), new Uint8Array(17).fill(3)] as const,
    };
    const password = 'SharedMaster!9';
    const localVault = await createLocalSarVault('namu', 'wallet-shared', password, '482931', material, deviceKey);
    const recoveryEnvelope = await encryptPasswordShare('namu', 'wallet-shared', password, material.kind, material.shares[0]);
    expect(localVault.master.saltBase64).not.toBe(recoveryEnvelope.saltBase64);
    const local = await openLocalSarVault('namu', 'wallet-shared', localVault, { masterPassword: password });
    const recovery = await decryptPasswordShare('namu', 'wallet-shared', password, recoveryEnvelope);
    expect(local.shares[0]).toEqual(recovery.share);
    local.shares.forEach((share) => share.fill(0));
    recovery.share.fill(0);
  });

  it('still opens legacy wallets with a separate recovery password', async () => {
    const deviceKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const material = {
      kind: 'mnemonic-entropy' as const,
      shares: [new Uint8Array(17).fill(1), new Uint8Array(17).fill(2), new Uint8Array(17).fill(3)] as const,
    };
    const localVault = await createLocalSarVault('namu', 'wallet-separated', 'local-master-password', '482931', material, deviceKey);
    const recoveryEnvelope = await encryptPasswordShare('namu', 'wallet-separated', 'different-recovery-password', material.kind, material.shares[0]);
    await expect(openLocalSarVault('namu', 'wallet-separated', localVault, { masterPassword: 'different-recovery-password' }))
      .rejects.toThrow('local_vault_unlock_failed');
    await expect(decryptPasswordShare('namu', 'wallet-separated', 'local-master-password', recoveryEnvelope))
      .rejects.toThrow('vault_password_or_envelope_invalid');
    const local = await openLocalSarVault('namu', 'wallet-separated', localVault, { masterPassword: 'local-master-password' });
    const recovery = await decryptPasswordShare('namu', 'wallet-separated', 'different-recovery-password', recoveryEnvelope);
    expect(local.shares[0]).toEqual(recovery.share);
    local.shares.forEach((share) => share.fill(0));
    recovery.share.fill(0);
  });
  it('unlocks either with the master password or this device key and PIN', async () => {
    const deviceKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const material = {
      kind: 'mnemonic-entropy' as const,
      shares: [new Uint8Array(17).fill(1), new Uint8Array(17).fill(2), new Uint8Array(17).fill(3)] as const,
    };
    const vault = await createLocalSarVault('jb', 'wallet-1', 'master-password-123', '482931', material, deviceKey);
    expect(JSON.stringify(vault)).not.toContain('AQEBAQEBAQEBAQEBAQEBAQE=');
    const master = await openLocalSarVault('jb', 'wallet-1', vault, { masterPassword: 'master-password-123' });
    const pin = await openLocalSarVault('jb', 'wallet-1', vault, { pin: '482931', deviceKey });
    expect(master.shares).toEqual(pin.shares);
    expect(master.shares[0]).toEqual(material.shares[0]);
    expect(master.shares[1]).toEqual(material.shares[1]);
    master.shares.forEach((share) => share.fill(0));
    pin.shares.forEach((share) => share.fill(0));
  });

  it('rejects wrong credentials, another device key, and another wallet binding', async () => {
    const deviceKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const anotherKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const material = {
      kind: 'evm-private-key' as const,
      shares: [new Uint8Array(33).fill(1), new Uint8Array(33).fill(2), new Uint8Array(33).fill(3)] as const,
    };
    const vault = await createLocalSarVault('kiwoom', 'wallet-2', 'master-password-123', '482931', material, deviceKey);
    await expect(openLocalSarVault('kiwoom', 'wallet-2', vault, { masterPassword: 'wrong-password' }))
      .rejects.toThrow('local_vault_unlock_failed');
    await expect(openLocalSarVault('kiwoom', 'wallet-2', vault, { pin: '482931', deviceKey: anotherKey }))
      .rejects.toThrow('local_vault_unlock_failed');
    await expect(openLocalSarVault('kiwoom', 'another-wallet', vault, { pin: '482931', deviceKey }))
      .rejects.toThrow('local_vault_invalid');
  });

  it('moves an existing wallet to its institution app PIN without changing its master envelope', async () => {
    const deviceKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const material = { kind: 'mnemonic-entropy' as const, shares: [new Uint8Array(17).fill(4), new Uint8Array(17).fill(5), new Uint8Array(17).fill(6)] as const };
    const old = await createLocalSarVault('namu', 'wallet-migrate', 'MasterPass!9', '123456', material, deviceKey);
    const opened = await openLocalSarVault('namu', 'wallet-migrate', old, { pin: '123456', deviceKey });
    const migrated = await replaceLocalSarVaultPin('namu', 'wallet-migrate', old, opened, '654321', deviceKey);
    expect(migrated.master).toEqual(old.master);
    await expect(openLocalSarVault('namu', 'wallet-migrate', migrated, { pin: '123456', deviceKey })).rejects.toThrow('local_vault_unlock_failed');
    const appPin = await openLocalSarVault('namu', 'wallet-migrate', migrated, { pin: '654321', deviceKey });
    const master = await openLocalSarVault('namu', 'wallet-migrate', migrated, { masterPassword: 'MasterPass!9' });
    expect(appPin.shares).toEqual(opened.shares);
    expect(master.shares).toEqual(opened.shares);
    opened.shares.forEach((share) => share.fill(0));
    appPin.shares.forEach((share) => share.fill(0));
    master.shares.forEach((share) => share.fill(0));
  });
});
