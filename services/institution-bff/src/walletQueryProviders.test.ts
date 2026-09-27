import { describe, expect, it } from 'vitest';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { walletProvisioningProviders, walletQueryProviders } from './walletQueryProviders';

const baseSession = {
  protocolVersion: 1,
  sessionId: 'base-session',
  tenantId: 'kiwoom',
  subject: 'opaque-subject',
  subjectVersion: 1,
  keyAdapter: 'took-sar',
  issuedAt: 1,
  expiresAt: 2,
} as const;

const secureNewSource = {
  type: 'secure-new',
  secureProvisionRef: 'sar-key-reference-123456',
  addresses: [
    { addressGroupId: 'evm', address: '0x0000000000000000000000000000000000000001' },
    { addressGroupId: 'solana', address: '11111111111111111111111111111111' },
    { addressGroupId: 'bitcoin', address: '1111111111111111111114oLvT2' },
    { addressGroupId: 'tron', address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8' },
    { addressGroupId: 'xrp', address: 'rrrrrrrrrrrrrrrrrrrrrhoLvTp' },
  ],
  recoveryEnvelopes: [1, 2, 3].map((factorIndex) => ({
    factorIndex: factorIndex as 1 | 2 | 3,
    envelopeVersion: 1 as const,
    algorithm: 'AES-256-GCM' as const,
    ivBase64: 'AAAAAAAAAAAAAAAA',
    ciphertextBase64: 'AAAAAAAAAAAAAAAAAAAAAAAA',
    aad: `sar-key-core-v1:sar-key-reference-123456:factor-${factorIndex}`,
  })),
  recovery: {
    scheme: 'shamir-gf256',
    threshold: 2,
    shareCount: 3,
    recombinationVerified: true,
    keyCoreVersion: 'sar-key-core-v1',
  },
} as const;

describe('tenant wallet query provider', () => {
  it('returns W00 absent instead of a fabricated sandbox portfolio', async () => {
    const provider = walletQueryProviders.get('kiwoom');
    expect(provider).toBeDefined();

    const home = await provider!.getHome({
      manifest: kiwoomManifest,
      session: { ...baseSession, sessionId: 'absent-session', keyAdapter: 'fsl-mpc' },
    });

    expect(home).toEqual({
      status: 'absent',
      canCreate: true,
      canRecover: true,
      source: 'wallet-query',
    });
    expect(home).not.toHaveProperty('totalFiat');
    expect(home).not.toHaveProperty('assets');
  });

  it('registers host-derived public addresses without receiving secret material', async () => {
    const provider = walletProvisioningProviders.get('kiwoom');
    expect(provider).toBeDefined();
    const session = { ...baseSession, sessionId: 'sar-wallet-session' };
    const result = await provider!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'provision-test-001',
        keyAdapter: 'took-sar',
        recoverySetupAcknowledged: true,
        source: secureNewSource,
      },
    });

    expect(result.mode).toBe('development-key-core');
    expect(result.walletHome.wallets).toHaveLength(1);
    expect(result.walletHome.wallet.origin).toBe('created');
    expect(result.walletHome.networks).toHaveLength(9);
    expect(new Set(result.walletHome.networks.map((network) => network.addressGroupId))).toEqual(new Set(['evm', 'solana', 'bitcoin', 'tron', 'xrp']));
    expect(result.walletHome.totalFiat?.display).toBe('0원');
    expect(result.walletHome.valuation).toMatchObject({ provider: 'bonanza-k-vwap', status: 'sandbox' });
    expect(result.walletHome.recovery).toMatchObject({ profile: 'sar-2-of-3', status: 'sandbox-ready' });
    expect(result.walletHome.networks.every((network) => network.addressStatus === 'ready' && typeof network.address === 'string')).toBe(true);
    expect(new Set(result.walletHome.networks.filter((network) => network.addressGroupId === 'evm').map((network) => network.address))).toEqual(new Set([secureNewSource.addresses[0].address]));
    expect(JSON.stringify(result)).not.toContain(secureNewSource.secureProvisionRef);
    expect(JSON.stringify(result)).not.toMatch(/mnemonic|privateKey|seedPhrase|recoveryShare/i);
  });

  it('adds independent wallet slots and queries only the selected wallet details', async () => {
    const provisioner = walletProvisioningProviders.get('kiwoom');
    const query = walletQueryProviders.get('kiwoom');
    const session = { ...baseSession, sessionId: 'multi-wallet-session' };
    const first = await provisioner!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'multi-wallet-001',
        keyAdapter: 'took-sar',
        recoverySetupAcknowledged: true,
        source: secureNewSource,
      },
    });
    const second = await provisioner!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'multi-wallet-002',
        keyAdapter: 'fsl-mpc',
        recoverySetupAcknowledged: true,
        source: { type: 'new' },
      },
    });

    expect(second.walletHome.wallets).toHaveLength(2);
    expect(second.walletHome.wallet.keyAdapter).toBe('fsl-mpc');
    const selected = await query!.getHome({ manifest: kiwoomManifest, session, walletId: first.walletHome.wallet.walletId });
    expect(selected.status).toBe('ready');
    if (selected.status !== 'ready') throw new Error('Expected ready wallet home.');
    expect(selected.wallet.walletId).toBe(first.walletHome.wallet.walletId);
    expect(selected.wallets).toHaveLength(2);
    expect(selected.assets).toEqual(first.walletHome.assets);
  });

  it('registers a secure mnemonic import as one imported SAR wallet slot', async () => {
    const provider = walletProvisioningProviders.get('kiwoom');
    const session = { ...baseSession, sessionId: 'import-wallet-session' };
    const result = await provider!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'import-wallet-001',
        keyAdapter: 'took-sar',
        recoverySetupAcknowledged: true,
        source: {
          type: 'secure-import',
          method: 'mnemonic',
          secureImportRef: 'opaque-secure-import-reference-001',
        },
      },
    });

    expect(result.walletHome.wallet).toMatchObject({ keyAdapter: 'took-sar', origin: 'imported' });
    expect(result.walletHome.wallets).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/opaque-secure-import-reference|mnemonic|privateKey|seedPhrase|recoveryShare/i);
  });

  it('requires SAR setup acknowledgement for the took SAR adapter', async () => {
    const provider = walletProvisioningProviders.get('kiwoom');
    await expect(provider!.provision({
      manifest: kiwoomManifest,
      session: { ...baseSession, sessionId: 'missing-sar-ack' },
      request: {
        idempotencyKey: 'provision-test-002',
        keyAdapter: 'took-sar',
        recoverySetupAcknowledged: false,
        source: { type: 'new' },
      },
    })).rejects.toThrow('SAR recovery setup acknowledgement');
  });

  it('rejects a SAR creation that bypasses the host key core', async () => {
    const provider = walletProvisioningProviders.get('kiwoom');
    await expect(provider!.provision({
      manifest: kiwoomManifest,
      session: { ...baseSession, sessionId: 'bypassed-key-core' },
      request: {
        idempotencyKey: 'provision-test-003',
        keyAdapter: 'took-sar',
        recoverySetupAcknowledged: true,
        source: { type: 'new' },
      },
    })).rejects.toThrow('host key-core registration');
  });
});
