import { describe, expect, it } from 'vitest';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { jbManifest } from '@took-wss/tenant-jb';
import { namuManifest } from '@took-wss/tenant-namu';
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
  keyCoreAttestationProof: 'key-core-attestation-proof-for-provider-test',
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

const secureImportSource = {
  type: 'secure-import',
  method: 'mnemonic',
  secureImportRef: 'opaque-secure-import-reference-001',
  keyCoreAttestationProof: 'key-core-import-attestation-proof-for-provider-test',
  addresses: secureNewSource.addresses,
  recoveryEnvelopes: secureNewSource.recoveryEnvelopes,
  recovery: secureNewSource.recovery,
} as const;

let proofSequence = 0;
function evidence(includeKeyCore = false) {
  proofSequence += 1;
  return {
    hostAuthorizationId: `00000000-0000-4000-8000-${String(proofSequence).padStart(12, '0')}`,
    ...(includeKeyCore
      ? { keyCoreAttestationId: `10000000-0000-4000-8000-${String(proofSequence).padStart(12, '0')}` }
      : {}),
  };
}

const hostAuthorizationProof = 'host-authorization-proof-for-provider-test';

describe('tenant wallet query provider', () => {
  it('persists tenant defaults, imported defaults and chosen names in wallet slots', async () => {
    const provider = walletProvisioningProviders.get('namu')!;
    const session = { ...baseSession, sessionId: 'named-namu-session', tenantId: 'namu' };
    const provision = (idempotencyKey: string, label?: string, imported = false) => provider.provision({
      manifest: namuManifest,
      session,
      request: {
        idempotencyKey,
        keyAdapter: 'took-sar',
        ...(label ? { label } : {}),
        recoverySetupAcknowledged: true,
        hostAuthorizationProof,
        source: imported ? secureImportSource : secureNewSource,
      },
      evidence: evidence(true),
    });
    const first = await provision('named-namu-001');
    expect(first.walletHome.wallet.label).toBe('나무 월렛 1');
    const second = await provision('named-namu-002', '생활비 지갑');
    expect(second.walletHome.wallet.label).toBe('생활비 지갑');
    const third = await provision('named-namu-003', undefined, true);
    expect(third.walletHome.wallet.label).toBe('가져온 월렛 1');
    expect(third.walletHome.wallets.map(({ label }) => label)).toEqual(['나무 월렛 1', '생활비 지갑', '가져온 월렛 1']);

    const jbProvider = walletProvisioningProviders.get('jb')!;
    const jb = await jbProvider.provision({
      manifest: jbManifest,
      session: { ...baseSession, sessionId: 'named-jb-session', tenantId: 'jb' },
      request: { idempotencyKey: 'named-jb-001', keyAdapter: 'took-sar', recoverySetupAcknowledged: true, hostAuthorizationProof, source: secureNewSource },
      evidence: evidence(true),
    });
    expect(jb.walletHome.wallet.label).toBe('JB 월렛 1');
  });

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
        hostAuthorizationProof,
        source: secureNewSource,
      },
      evidence: evidence(true),
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
        hostAuthorizationProof,
        source: secureNewSource,
      },
      evidence: evidence(true),
    });
    const second = await provisioner!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'multi-wallet-002',
        keyAdapter: 'fsl-mpc',
        recoverySetupAcknowledged: true,
        hostAuthorizationProof,
        source: { type: 'new' },
      },
      evidence: evidence(),
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

  it('removes only the requested empty slot and rejects proof reuse', async () => {
    const provider = walletProvisioningProviders.get('kiwoom')!;
    const query = walletQueryProviders.get('kiwoom')!;
    const session = { ...baseSession, sessionId: 'remove-wallet-session' };
    const request = (idempotencyKey: string) => ({
      manifest: kiwoomManifest,
      session,
      request: { idempotencyKey, keyAdapter: 'fsl-mpc' as const, recoverySetupAcknowledged: true, hostAuthorizationProof, source: { type: 'new' as const } },
      evidence: evidence(),
    });
    const first = await provider.provision(request('remove-wallet-001'));
    const second = await provider.provision(request('remove-wallet-002'));
    const authorizationId = evidence().hostAuthorizationId;
    const after = await query.removeWallet({ session, manifest: kiwoomManifest, walletId: second.walletHome.wallet.walletId, authorizationId });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') throw new Error('Expected remaining wallet.');
    expect(after.wallet.walletId).toBe(first.walletHome.wallet.walletId);
    expect(after.wallets).toHaveLength(1);
    await expect(query.removeWallet({ session, manifest: kiwoomManifest, walletId: first.walletHome.wallet.walletId, authorizationId })).rejects.toThrow('wallet_authorization_required');
  });

  it('renames an owned slot and keeps that name in the wallet list', async () => {
    const provider = walletProvisioningProviders.get('kiwoom')!;
    const query = walletQueryProviders.get('kiwoom')!;
    const session = { ...baseSession, sessionId: 'rename-wallet-session' };
    const created = await provider.provision({
      manifest: kiwoomManifest,
      session,
      request: { idempotencyKey: 'rename-wallet-001', keyAdapter: 'fsl-mpc', recoverySetupAcknowledged: true, hostAuthorizationProof, source: { type: 'new' } },
      evidence: evidence(),
    });
    const walletId = created.walletHome.wallet.walletId;
    const renamed = await query.renameWallet({ session, walletId, label: '여행용 지갑' });
    expect(renamed).toMatchObject({ walletId, label: '여행용 지갑' });
    const home = await query.getHome({ session, manifest: kiwoomManifest });
    expect(home.status).toBe('ready');
    if (home.status !== 'ready') throw new Error('Expected ready wallet home.');
    expect(home.wallets[0]?.label).toBe('여행용 지갑');
    await expect(query.renameWallet({ session: { ...session, sessionId: 'another-session' }, walletId, label: '잘못된 변경' })).rejects.toThrow('wallet_not_found');
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
        hostAuthorizationProof,
        source: secureImportSource,
      },
      evidence: evidence(true),
    });

    expect(result.mode).toBe('development-key-core');
    expect(result.walletHome.wallet).toMatchObject({ keyAdapter: 'took-sar', origin: 'imported' });
    expect(result.walletHome.wallets).toHaveLength(1);
    expect(result.walletHome.networks.every((network) => network.addressStatus === 'ready')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/opaque-secure-import-reference|mnemonic|privateKey|seedPhrase|recoveryShare/i);
  });

  it('registers an EVM private key import only on EVM-compatible networks', async () => {
    const provider = walletProvisioningProviders.get('kiwoom');
    const session = { ...baseSession, sessionId: 'private-key-import-session' };
    const result = await provider!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'private-key-import-001',
        keyAdapter: 'took-sar',
        recoverySetupAcknowledged: true,
        hostAuthorizationProof,
        source: {
          ...secureImportSource,
          method: 'private-key',
          secureImportRef: 'opaque-private-key-reference-001',
          addresses: secureImportSource.addresses.filter(({ addressGroupId }) => addressGroupId === 'evm'),
        },
      },
      evidence: evidence(true),
    });

    expect(result.walletHome.networks.filter(({ addressGroupId }) => addressGroupId === 'evm').every(({ addressStatus }) => addressStatus === 'ready')).toBe(true);
    expect(result.walletHome.networks.filter(({ addressGroupId }) => addressGroupId !== 'evm').every(({ addressStatus }) => addressStatus === 'pending-core')).toBe(true);
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
        hostAuthorizationProof,
        source: { type: 'new' },
      },
      evidence: evidence(),
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
        hostAuthorizationProof,
        source: { type: 'new' },
      },
      evidence: evidence(),
    })).rejects.toThrow('host key-core registration');
  });

  it('cannot reuse a consumed host authorization for a different wallet operation', async () => {
    const provider = walletProvisioningProviders.get('kiwoom');
    const session = { ...baseSession, sessionId: 'reused-host-proof-session', keyAdapter: 'fsl-mpc' as const };
    const sharedEvidence = evidence();
    await provider!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'host-proof-first-wallet',
        keyAdapter: 'fsl-mpc',
        recoverySetupAcknowledged: true,
        hostAuthorizationProof,
        source: { type: 'new' },
      },
      evidence: sharedEvidence,
    });

    await expect(provider!.provision({
      manifest: kiwoomManifest,
      session,
      request: {
        idempotencyKey: 'host-proof-second-wallet',
        keyAdapter: 'fsl-mpc',
        recoverySetupAcknowledged: true,
        hostAuthorizationProof,
        source: { type: 'new' },
      },
      evidence: sharedEvidence,
    })).rejects.toThrow('already consumed');
  });
});
