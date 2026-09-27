import { describe, expect, it } from 'vitest';
import {
  assertTenantManifest,
  isHostToWalletMessage,
  isWalletToHostMessage,
  isWalletHomePayload,
  type HostCapabilities,
  type TenantManifest,
} from './index';

const capabilities: HostCapabilities = {
  handlesSafeArea: true,
  rendersRootHeader: true,
  rendersRootTabs: true,
  canScanQr: true,
  canUseContacts: true,
  canOpenRecovery: true,
  canLinkExternalWallet: true,
  canSecureWalletImport: true,
  canCreateSecureSarWallet: true,
};

describe('host initialization contract', () => {
  it('requires an explicit, complete host capability set', () => {
    expect(isHostToWalletMessage({
      type: 'took-wss:init',
      protocolVersion: 1,
      sessionToken: 'a-session-token-that-is-long-enough',
      bffUrl: 'https://wallet.example.com',
      hostCapabilities: capabilities,
    })).toBe(true);

    expect(isHostToWalletMessage({
      type: 'took-wss:init',
      protocolVersion: 1,
      sessionToken: 'a-session-token-that-is-long-enough',
      bffUrl: 'https://wallet.example.com',
      hostCapabilities: { ...capabilities, canScanQr: undefined },
    })).toBe(false);
  });

  it('validates shell and host authentication bridge messages without secrets', () => {
    expect(isWalletToHostMessage({ type: 'took-wss:shell-change', protocolVersion: 1, mode: 'focus' })).toBe(true);
    expect(isWalletToHostMessage({
      type: 'took-wss:host-auth-request',
      protocolVersion: 1,
      requestId: 'request-1',
      purpose: 'wallet-provisioning',
    })).toBe(true);
    expect(isHostToWalletMessage({
      type: 'took-wss:host-auth-result',
      protocolVersion: 1,
      requestId: 'request-1',
      result: {
        status: 'authenticated',
        proof: 'signed-host-authorization-proof-123456',
        expiresAt: '2026-09-27T00:05:00.000Z',
        method: 'development-reference-host',
      },
    })).toBe(true);
    expect(isHostToWalletMessage({
      type: 'took-wss:secure-sar-create-result',
      protocolVersion: 1,
      requestId: 'request-secret-leak',
      result: {
        status: 'completed',
        secureProvisionRef: 'sar-key-reference-123456',
        keyCoreAttestationProof: 'signed-key-core-attestation-proof-123456',
        mnemonicWords: Array.from({ length: 12 }, () => 'abandon'),
        addresses: [{ addressGroupId: 'evm', address: '0x0000000000000000000000000000000000000001' }],
        recoveryEnvelopes: [1, 2, 3].map((factorIndex) => ({
          factorIndex,
          envelopeVersion: 1,
          algorithm: 'AES-256-GCM',
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
      },
    })).toBe(false);
    expect(isWalletToHostMessage({
      type: 'took-wss:secure-import-request',
      protocolVersion: 1,
      requestId: 'request-2',
      method: 'mnemonic',
    })).toBe(true);
    expect(isHostToWalletMessage({
      type: 'took-wss:secure-import-result',
      protocolVersion: 1,
      requestId: 'request-2',
      result: { status: 'completed', secureImportRef: 'opaque-reference-123456' },
    })).toBe(true);
    expect(isWalletToHostMessage({
      type: 'took-wss:secure-sar-create-request',
      protocolVersion: 1,
      requestId: 'request-3',
    })).toBe(true);
    expect(isHostToWalletMessage({
      type: 'took-wss:secure-sar-create-result',
      protocolVersion: 1,
      requestId: 'request-3',
      result: {
        status: 'completed',
        secureProvisionRef: 'sar-key-reference-123456',
        keyCoreAttestationProof: 'signed-key-core-attestation-proof-123456',
        addresses: [{ addressGroupId: 'evm', address: '0x0000000000000000000000000000000000000001' }],
        recoveryEnvelopes: [1, 2, 3].map((factorIndex) => ({
          factorIndex,
          envelopeVersion: 1,
          algorithm: 'AES-256-GCM',
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
      },
    })).toBe(true);
    const signingRequest = {
      intentId: 'intent-1',
      walletId: 'wallet-1',
      chainId: 'ethereum',
      network: 'Ethereum',
      assetSymbol: 'ETH',
      amountDisplay: '0.01',
      fromAddress: '0x0000000000000000000000000000000000000002',
      recipient: '0x0000000000000000000000000000000000000001',
      transaction: {
        type: 'evm-native',
        chainId: 1,
        nonce: 0,
        to: '0x0000000000000000000000000000000000000001',
        value: '10000000000000000',
        gasLimit: '21000',
        gasPrice: '20000000000',
      },
    } as const;
    expect(isWalletToHostMessage({
      type: 'took-wss:secure-transaction-sign-request',
      protocolVersion: 1,
      requestId: 'request-4',
      request: signingRequest,
    })).toBe(true);
    const erc20SigningRequest = {
      ...signingRequest,
      assetSymbol: 'USDC',
      transaction: {
        ...signingRequest.transaction,
        type: 'evm-erc20',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        gasLimit: '65000',
        data: '0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001',
      },
    } as const;
    expect(isWalletToHostMessage({
      type: 'took-wss:secure-transaction-sign-request',
      protocolVersion: 1,
      requestId: 'request-5',
      request: erc20SigningRequest,
    })).toBe(true);
    expect(isWalletToHostMessage({
      type: 'took-wss:secure-transaction-sign-request',
      protocolVersion: 1,
      requestId: 'request-6',
      request: { ...erc20SigningRequest, transaction: { ...erc20SigningRequest.transaction, data: undefined } },
    })).toBe(false);
    expect(isHostToWalletMessage({
      type: 'took-wss:secure-transaction-sign-result',
      protocolVersion: 1,
      requestId: 'request-4',
      result: {
        status: 'completed',
        intentId: 'intent-1',
        signedTransaction: '0x1234',
        hostAuthorizationProof: 'signed-host-authorization-proof-123456',
      },
    })).toBe(true);
  });
});

describe('key management policy', () => {
  const baseManifest: Omit<TenantManifest, 'enabledModules' | 'keyManagement'> = {
    schemaVersion: 1,
    tenantId: 'test-bank',
    slug: 'test-bank-wallet',
    institutionName: 'Test Bank',
    walletName: 'Test Wallet',
    environment: 'sandbox',
    deploymentMode: 'saas',
    presentation: {
      profileId: 'test-v1',
      guideVersion: '1.0.0',
      rootHeaderOwner: 'host',
      rootNavigationOwner: 'host',
      safeAreaOwner: 'host',
      navigation: {
        rootEntry: 'host-tabs',
        focusedFlow: 'hide-host-chrome',
        walletMenu: 'none',
      },
    },
    brand: {
      logoText: 'T',
      primaryColor: '#000000',
      accentColor: '#111111',
      surfaceColor: '#ffffff',
      textColor: '#111111',
      radius: 'soft',
    },
    identity: {
      onboardingMode: 'institution-first',
      phoneVerification: 'host',
      consentVersion: 'test-consent-v1',
    },
    providers: { execution: 'took-router', compliance: 'mock', quote: 'mock' },
    chains: ['ethereum'],
    assetPolicy: { stablecoins: ['USDC'] },
  };

  it('allows a tenant to omit SAR and choose a provider wallet', () => {
    expect(() => assertTenantManifest({
      ...baseManifest,
      enabledModules: ['wallet-home'],
      keyManagement: {
        policyVersion: 1,
        recoveryRequirement: 'provider-recovery-accepted',
        defaultAdapter: 'thirdweb-user-wallet',
        allowedAdapters: ['thirdweb-user-wallet', 'fsl-mpc'],
      },
    })).not.toThrow();
  });

  it('rejects SAR configuration when its adapter and recovery module disagree', () => {
    expect(() => assertTenantManifest({
      ...baseManifest,
      enabledModules: ['wallet-home'],
      keyManagement: {
        policyVersion: 1,
        recoveryRequirement: 'sar-preferred',
        defaultAdapter: 'took-sar',
        allowedAdapters: ['took-sar'],
      },
    })).toThrow('enabled or disabled together');
  });

  it('prevents a provider adapter from being added to a SAR-required policy', () => {
    expect(() => assertTenantManifest({
      ...baseManifest,
      enabledModules: ['wallet-home', 'sar-recovery'],
      keyManagement: {
        policyVersion: 2,
        recoveryRequirement: 'sar-required',
        defaultAdapter: 'took-sar',
        allowedAdapters: ['took-sar', 'fsl-mpc'],
      },
    })).toThrow('permits only took SAR');
  });
});

describe('wallet home transport states', () => {
  it('accepts an explicit unprovisioned state without a synthetic balance', () => {
    expect(isWalletHomePayload({
      status: 'absent',
      canCreate: true,
      canRecover: true,
      source: 'wallet-query',
    })).toBe(true);
  });

  it('rejects a ready state without a wallet identity or assets', () => {
    expect(isWalletHomePayload({ status: 'ready', source: 'wallet-query' })).toBe(false);
  });

  it('accepts address-free network metadata for the selected wallet while the key core is pending', () => {
    const wallet = {
      walletId: 'wallet-1',
      label: 'Wallet',
      keyAdapter: 'took-sar',
      origin: 'created',
    } as const;
    const base = {
      status: 'ready',
      wallet,
      wallets: [wallet],
      totalFiat: { currency: 'KRW', display: '0원', asOf: '2026-09-27T00:00:00.000Z', stale: false },
      assets: [],
      receiveAssets: [],
      valuation: { currency: 'KRW', provider: 'bonanza-k-vwap', status: 'sandbox', asOf: '2026-09-27T00:00:00.000Z' },
      recovery: { profile: 'sar-2-of-3', status: 'sandbox-ready', policyVersion: 1 },
      source: 'wallet-query',
    } as const;
    const network = {
      chainId: 'ethereum',
      addressGroupId: 'evm',
      network: 'Ethereum',
      nativeSymbol: 'ETH',
      status: 'registered',
      addressStatus: 'pending-core',
    } as const;
    expect(isWalletHomePayload({ ...base, networks: [network] })).toBe(true);
    expect(isWalletHomePayload({ ...base, networks: [{ ...network, addressStatus: 'ready' }] })).toBe(false);
  });

  it('requires the selected wallet to exist in the wallet-slot index', () => {
    const selectedWallet = {
      walletId: 'wallet-1',
      label: 'Wallet 1',
      keyAdapter: 'took-sar',
      origin: 'created',
    } as const;
    const home = {
      status: 'ready',
      wallet: selectedWallet,
      wallets: [{ ...selectedWallet, walletId: 'wallet-2', label: 'Wallet 2' }],
      totalFiat: { currency: 'KRW', display: '0원', asOf: '2026-09-27T00:00:00.000Z', stale: false },
      assets: [],
      receiveAssets: [],
      networks: [],
      valuation: { currency: 'KRW', provider: 'bonanza-k-vwap', status: 'sandbox', asOf: '2026-09-27T00:00:00.000Z' },
      recovery: { profile: 'sar-2-of-3', status: 'sandbox-ready', policyVersion: 1 },
      source: 'wallet-query',
    } as const;
    expect(isWalletHomePayload(home)).toBe(false);
  });
});
