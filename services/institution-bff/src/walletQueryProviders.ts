import { randomUUID } from 'node:crypto';
import type {
  CreateRegistrationIntentRequest,
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  ReadyWalletHomePayload,
  TenantManifest,
  WalletNetworkView,
  PublicWalletAddressRegistration,
  WalletProfileSummary,
  WssSessionClaims,
  WssIdentityState,
} from '@took-wss/contracts';
import type { IdentityRegistrationProvider, WalletProvisioningProvider, WalletQueryProvider } from '@took-wss/provider-adapters';
import { DevelopmentPostgresWalletProvider } from './databaseWalletProvider.js';

type Session = Omit<WssSessionClaims, 'nonce'>;

const chainCatalog: Readonly<Record<string, { addressGroupId: string; network: string; nativeSymbol: string }>> = {
  ethereum: { addressGroupId: 'evm', network: 'Ethereum', nativeSymbol: 'ETH' },
  polygon: { addressGroupId: 'evm', network: 'Polygon', nativeSymbol: 'POL' },
  arbitrum: { addressGroupId: 'evm', network: 'Arbitrum', nativeSymbol: 'ETH' },
  base: { addressGroupId: 'evm', network: 'Base', nativeSymbol: 'ETH' },
  bnb: { addressGroupId: 'evm', network: 'BNB Chain', nativeSymbol: 'BNB' },
  solana: { addressGroupId: 'solana', network: 'Solana', nativeSymbol: 'SOL' },
  bitcoin: { addressGroupId: 'bitcoin', network: 'Bitcoin', nativeSymbol: 'BTC' },
  tron: { addressGroupId: 'tron', network: 'TRON', nativeSymbol: 'TRX' },
  xrp: { addressGroupId: 'xrp', network: 'XRP Ledger', nativeSymbol: 'XRP' },
};

function absentHome(manifest: TenantManifest) {
  return {
    status: 'absent',
    canCreate: manifest.enabledModules.includes('wallet-home'),
    canRecover: manifest.enabledModules.includes('sar-recovery'),
    source: 'wallet-query',
  } as const;
}

function createSandboxNetworks(
  manifest: TenantManifest,
  addresses: readonly PublicWalletAddressRegistration[] = [],
): WalletNetworkView[] {
  const addressesByGroup = new Map(addresses.map((item) => [item.addressGroupId, item.address]));
  return manifest.chains.map((chainId) => {
    const chain = chainCatalog[chainId] ?? { addressGroupId: chainId, network: chainId, nativeSymbol: chainId.toUpperCase() };
    const address = addressesByGroup.get(chain.addressGroupId);
    return {
      chainId,
      addressGroupId: chain.addressGroupId,
      network: chain.network,
      nativeSymbol: chain.nativeSymbol,
      status: 'registered',
      addressStatus: address ? 'ready' : 'pending-core',
      ...(address ? { address } : {}),
    };
  });
}

function walletSummary(home: ReadyWalletHomePayload): WalletProfileSummary {
  return home.wallet;
}

function withWalletIndex(home: ReadyWalletHomePayload, homes: ReadyWalletHomePayload[]): ReadyWalletHomePayload {
  return { ...home, wallets: homes.map(walletSummary) };
}

class SandboxWalletProvider implements WalletQueryProvider, WalletProvisioningProvider, IdentityRegistrationProvider {
  readonly id = 'sandbox-wallet-provider';
  readonly #homes = new Map<string, ReadyWalletHomePayload[]>();
  readonly #idempotency = new Map<string, ProvisionWalletResponse>();

  async getIdentity({ manifest }: { session: Session; manifest: TenantManifest }): Promise<WssIdentityState> {
    return manifest.identity.onboardingMode === 'institution-first'
      ? { status: 'established', assuranceLevel: 'institution-authenticated' }
      : { status: 'registration-required' };
  }

  async createRegistrationIntent(_input: { session: Session; manifest: TenantManifest; request: CreateRegistrationIntentRequest }): Promise<never> {
    throw new Error('Persistent identity registration provider is required.');
  }

  async createPhoneChallenge(): Promise<never> {
    throw new Error('Persistent identity registration provider is required.');
  }

  async verifyPhoneChallenge(): Promise<never> {
    throw new Error('Persistent identity registration provider is required.');
  }

  async getHome({ session, manifest, walletId }: { session: Session; manifest: TenantManifest; walletId?: string }) {
    const homes = this.#homes.get(session.sessionId) ?? [];
    if (homes.length === 0) return absentHome(manifest);
    const selected = walletId ? homes.find((home) => home.wallet.walletId === walletId) : homes.at(-1);
    if (!selected) {
      return { status: 'unavailable', code: 'wallet_not_found', canRetry: false, source: 'wallet-query' } as const;
    }
    return withWalletIndex(selected, homes);
  }

  async provision({ session, manifest, request }: {
    session: Session;
    manifest: TenantManifest;
    request: ProvisionWalletRequest;
  }): Promise<ProvisionWalletResponse> {
    const scopedIdempotencyKey = `${session.sessionId}:${request.idempotencyKey}`;
    const previous = this.#idempotency.get(scopedIdempotencyKey);
    if (previous) return previous;
    if (!manifest.keyManagement.allowedAdapters.includes(request.keyAdapter)) {
      throw new Error('Requested key adapter is not allowed.');
    }
    if (request.keyAdapter === 'took-sar' && !request.recoverySetupAcknowledged) {
      throw new Error('SAR recovery setup acknowledgement is required.');
    }
    if (request.source.type === 'secure-import' && request.keyAdapter !== 'took-sar') {
      throw new Error('Secure external-wallet import must enter a SAR wallet slot.');
    }
    if (request.source.type === 'secure-new' && request.keyAdapter !== 'took-sar') {
      throw new Error('Secure SAR creation must enter a SAR wallet slot.');
    }
    if (request.keyAdapter === 'took-sar' && request.source.type === 'new') {
      throw new Error('SAR wallet creation requires a completed host key-core registration.');
    }
    if (request.source.type === 'secure-new') {
      const requiredGroups = new Set(manifest.chains.map((chainId) => chainCatalog[chainId]?.addressGroupId ?? chainId));
      const registeredGroups = new Set(request.source.addresses.map(({ addressGroupId }) => addressGroupId));
      if ([...requiredGroups].some((groupId) => !registeredGroups.has(groupId))) {
        throw new Error('Host key-core registration is missing a required address group.');
      }
    }

    const homes = this.#homes.get(session.sessionId) ?? [];
    const asOf = new Date().toISOString();
    const walletNumber = homes.length + 1;
    const origin = request.source.type === 'secure-import' ? 'imported' : 'created';
    const adapterLabel = request.keyAdapter === 'took-sar'
      ? origin === 'imported' ? '가져온 자가복구 지갑' : '자가복구 지갑'
      : request.keyAdapter === 'fsl-mpc' ? 'FSL MPC 지갑' : 'Thirdweb MPC 지갑';
    const walletHome: ReadyWalletHomePayload = {
      status: 'ready',
      wallet: {
        walletId: `sandbox-wallet-${randomUUID()}`,
        label: `${adapterLabel} ${walletNumber}`,
        keyAdapter: request.keyAdapter,
        origin,
      },
      wallets: [],
      totalFiat: { currency: 'KRW', display: '0원', asOf, stale: false },
      assets: [],
      networks: createSandboxNetworks(manifest, request.source.type === 'secure-new' ? request.source.addresses : []),
      valuation: {
        currency: 'KRW',
        provider: manifest.providers.quote,
        status: 'sandbox',
        asOf,
      },
      recovery: {
        profile: request.keyAdapter === 'took-sar' ? 'sar-2-of-3' : 'provider-policy',
        status: 'sandbox-ready',
        policyVersion: manifest.keyManagement.policyVersion,
      },
      source: 'wallet-query',
    };
    homes.push(walletHome);
    this.#homes.set(session.sessionId, homes);
    const response = {
      mode: request.source.type === 'secure-new' ? 'development-key-core' : 'sandbox-contract-only',
      walletHome: withWalletIndex(walletHome, homes),
    } as const;
    this.#idempotency.set(scopedIdempotencyKey, response);
    return response;
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim();
function requiredRegistrationSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when DATABASE_URL is configured.`);
  if (name !== 'WSS_PII_ENCRYPTION_KEY' && value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}
const developmentDatabaseProvider = databaseUrl && !process.env.VITEST
  ? new DevelopmentPostgresWalletProvider(databaseUrl, {
      piiEncryptionKeyHex: requiredRegistrationSecret('WSS_PII_ENCRYPTION_KEY'),
      phoneLookupSecret: requiredRegistrationSecret('WSS_PHONE_LOOKUP_SECRET'),
      otpMacSecret: requiredRegistrationSecret('WSS_OTP_MAC_SECRET'),
    })
  : null;
const kiwoomSandboxProvider = developmentDatabaseProvider ?? new SandboxWalletProvider();
const referenceSandboxProvider = developmentDatabaseProvider ?? new SandboxWalletProvider();

export const walletQueryProviders = new Map<string, WalletQueryProvider>([
  ['kiwoom', kiwoomSandboxProvider],
  ['reference-bank', referenceSandboxProvider],
]);

export const walletProvisioningProviders = new Map<string, WalletProvisioningProvider>([
  ['kiwoom', kiwoomSandboxProvider],
  ['reference-bank', referenceSandboxProvider],
]);

export const identityRegistrationProviders = new Map<string, IdentityRegistrationProvider>([
  ['kiwoom', kiwoomSandboxProvider],
  ['reference-bank', referenceSandboxProvider],
]);
