import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  ReadyWalletHomePayload,
  TenantManifest,
  WalletNetworkView,
  WalletProfileSummary,
  WssSessionClaims,
} from '@took-wss/contracts';
import type { WalletProvisioningProvider, WalletQueryProvider } from '@took-wss/provider-adapters';

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

interface WalletRow {
  id: string;
  label: string;
  key_adapter: WalletProfileSummary['keyAdapter'];
  provisioning_origin: WalletProfileSummary['origin'];
}

function networksForManifest(
  manifest: TenantManifest,
  addresses: ReadonlyMap<string, string>,
): WalletNetworkView[] {
  return manifest.chains.map((chainId) => {
    const chain = chainCatalog[chainId] ?? { addressGroupId: chainId, network: chainId, nativeSymbol: chainId.toUpperCase() };
    const address = addresses.get(chain.addressGroupId);
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

function absentHome(manifest: TenantManifest) {
  return {
    status: 'absent',
    canCreate: manifest.enabledModules.includes('wallet-home'),
    canRecover: manifest.enabledModules.includes('sar-recovery'),
    source: 'wallet-query',
  } as const;
}

export class DevelopmentPostgresWalletProvider implements WalletQueryProvider, WalletProvisioningProvider {
  readonly id = 'development-postgres-wallet-provider';
  readonly #sql: ReturnType<typeof postgres>;
  #boundaryChecked = false;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5, prepare: false, idle_timeout: 20 });
  }

  async #assertDevelopmentBoundary(): Promise<void> {
    if (this.#boundaryChecked) return;
    const rows = await this.#sql<{ project_name: string; environment: string; purpose: string; sar_storage_mode: string }[]>`
      SELECT project_name, environment, purpose, sar_storage_mode
      FROM wss_deployment_metadata
      WHERE singleton = true
    `;
    const metadata = rows[0];
    if (!metadata
      || metadata.project_name !== 'xlot-wss-dev'
      || metadata.environment !== 'development'
      || metadata.purpose !== 'proposal-and-early-function-sandbox'
      || metadata.sar_storage_mode !== 'single-project-encrypted') {
      throw new Error('The configured database is not the approved WSS development project.');
    }
    this.#boundaryChecked = true;
  }

  async #resolveProfile(session: Session): Promise<string> {
    await this.#assertDevelopmentBoundary();
    return this.#sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.tenantId}:${session.subjectVersion}:${session.subject}`}, 0))`;
      const existing = await transaction<{ user_profile_id: string }[]>`
        SELECT user_profile_id
        FROM wss_external_identities
        WHERE tenant_id = ${session.tenantId}
          AND issuer = 'institution-host'
          AND subject_version = ${session.subjectVersion}
          AND subject_hash = ${session.subject}
          AND revoked_at IS NULL
        LIMIT 1
      `;
      if (existing[0]) {
        await transaction`
          UPDATE wss_external_identities
          SET last_seen_at = now()
          WHERE tenant_id = ${session.tenantId}
            AND issuer = 'institution-host'
            AND subject_version = ${session.subjectVersion}
            AND subject_hash = ${session.subject}
        `;
        return existing[0].user_profile_id;
      }

      const profileId = randomUUID();
      await transaction`
        INSERT INTO wss_user_profiles (id, tenant_id, status, assurance_level)
        VALUES (${profileId}, ${session.tenantId}, 'active', 'institution-authenticated')
      `;
      await transaction`
        INSERT INTO wss_external_identities (
          id, tenant_id, user_profile_id, issuer, subject_hash, subject_version, assurance_level
        ) VALUES (
          ${randomUUID()}, ${session.tenantId}, ${profileId}, 'institution-host', ${session.subject},
          ${session.subjectVersion}, 'institution-authenticated'
        )
      `;
      return profileId;
    });
  }

  async #ensurePolicy(manifest: TenantManifest): Promise<void> {
    const digest = createHash('sha256').update(JSON.stringify(manifest.keyManagement)).digest('hex');
    await this.#sql`
      INSERT INTO wss_key_policy_versions (
        tenant_id, policy_version, recovery_requirement, default_adapter,
        allowed_adapters, manifest_digest, status, activated_at
      ) VALUES (
        ${manifest.tenantId}, ${manifest.keyManagement.policyVersion},
        ${manifest.keyManagement.recoveryRequirement}, ${manifest.keyManagement.defaultAdapter},
        ${this.#sql.json(manifest.keyManagement.allowedAdapters)}, ${digest}, 'active', now()
      )
      ON CONFLICT (tenant_id, policy_version) DO NOTHING
    `;
  }

  async #readyHome(profileId: string, manifest: TenantManifest, walletId?: string): Promise<ReadyWalletHomePayload | null> {
    const walletRows = await this.#sql<WalletRow[]>`
      SELECT id, label, key_adapter, provisioning_origin
      FROM wss_wallets
      WHERE tenant_id = ${manifest.tenantId}
        AND user_profile_id = ${profileId}
        AND status = 'active'
      ORDER BY created_at ASC, id ASC
    `;
    if (walletRows.length === 0) return null;
    const selected = walletId ? walletRows.find((wallet) => wallet.id === walletId) : walletRows.at(-1);
    if (!selected) return null;

    const accountRows = await this.#sql<{ address_group_id: string; address_display: string }[]>`
      SELECT address_group_id, address_display
      FROM wss_wallet_accounts
      WHERE tenant_id = ${manifest.tenantId} AND wallet_id = ${selected.id}
    `;
    const addresses = new Map(accountRows.map((account) => [account.address_group_id, account.address_display]));
    const asOf = new Date().toISOString();
    const summaries: WalletProfileSummary[] = walletRows.map((wallet) => ({
      walletId: wallet.id,
      label: wallet.label,
      keyAdapter: wallet.key_adapter,
      origin: wallet.provisioning_origin,
    }));
    const wallet = summaries.find((summary) => summary.walletId === selected.id)!;
    return {
      status: 'ready',
      wallet,
      wallets: summaries,
      totalFiat: { currency: 'KRW', display: '0원', asOf, stale: false },
      assets: [],
      networks: networksForManifest(manifest, addresses),
      valuation: { currency: 'KRW', provider: manifest.providers.quote, status: 'sandbox', asOf },
      recovery: {
        profile: selected.key_adapter === 'took-sar' ? 'sar-2-of-3' : 'provider-policy',
        status: 'sandbox-ready',
        policyVersion: manifest.keyManagement.policyVersion,
      },
      source: 'wallet-query',
    };
  }

  async getHome({ session, manifest, walletId }: { session: Session; manifest: TenantManifest; walletId?: string }) {
    const profileId = await this.#resolveProfile(session);
    const home = await this.#readyHome(profileId, manifest, walletId);
    if (home) return home;
    if (walletId) return { status: 'unavailable', code: 'wallet_not_found', canRetry: false, source: 'wallet-query' } as const;
    return absentHome(manifest);
  }

  async provision({ session, manifest, request }: {
    session: Session;
    manifest: TenantManifest;
    request: ProvisionWalletRequest;
  }): Promise<ProvisionWalletResponse> {
    if (!manifest.keyManagement.allowedAdapters.includes(request.keyAdapter)) throw new Error('Requested key adapter is not allowed.');
    if (request.keyAdapter === 'took-sar' && !request.recoverySetupAcknowledged) throw new Error('SAR recovery setup acknowledgement is required.');
    if (request.keyAdapter === 'took-sar' && request.source.type === 'new') throw new Error('SAR wallet creation requires a completed host key-core registration.');
    if ((request.source.type === 'secure-new' || request.source.type === 'secure-import') && request.keyAdapter !== 'took-sar') {
      throw new Error('Secure key-core sources require a SAR wallet slot.');
    }

    const profileId = await this.#resolveProfile(session);
    await this.#ensurePolicy(manifest);
    let walletId = '';
    await this.#sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${manifest.tenantId}:${profileId}:${request.idempotencyKey}`}, 0))`;
      const previous = await transaction<{ id: string }[]>`
        SELECT id FROM wss_wallets
        WHERE tenant_id = ${manifest.tenantId}
          AND user_profile_id = ${profileId}
          AND provisioning_idempotency_key = ${request.idempotencyKey}
        LIMIT 1
      `;
      if (previous[0]) {
        walletId = previous[0].id;
        return;
      }

      const countRows = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM wss_wallets
        WHERE tenant_id = ${manifest.tenantId} AND user_profile_id = ${profileId}
      `;
      const walletNumber = Number(countRows[0]?.count ?? '0') + 1;
      const origin = request.source.type === 'secure-import' ? 'imported' : 'created';
      const adapterLabel = request.keyAdapter === 'took-sar'
        ? origin === 'imported' ? '가져온 자가복구 지갑' : '자가복구 지갑'
        : request.keyAdapter === 'fsl-mpc' ? 'FSL MPC 지갑' : 'Thirdweb MPC 지갑';
      walletId = randomUUID();
      const secureRefHash = request.source.type === 'secure-new' || request.source.type === 'secure-import'
        ? createHash('sha256').update(request.source.type === 'secure-new' ? request.source.secureProvisionRef : request.source.secureImportRef).digest('hex')
        : null;
      await transaction`
        INSERT INTO wss_wallets (
          id, tenant_id, user_profile_id, key_policy_version, key_adapter,
          provisioning_origin, status, label, provisioning_idempotency_key, secure_provision_ref_hash
        ) VALUES (
          ${walletId}, ${manifest.tenantId}, ${profileId}, ${manifest.keyManagement.policyVersion},
          ${request.keyAdapter}, ${origin}, 'active', ${`${adapterLabel} ${walletNumber}`},
          ${request.idempotencyKey}, ${secureRefHash}
        )
      `;

      if (request.source.type === 'secure-new') {
        const addressesByGroup = new Map(request.source.addresses.map((item) => [item.addressGroupId, item.address]));
        for (const chainId of manifest.chains) {
          const chain = chainCatalog[chainId] ?? { addressGroupId: chainId, network: chainId, nativeSymbol: chainId.toUpperCase() };
          const address = addressesByGroup.get(chain.addressGroupId);
          if (!address) throw new Error(`Missing public address group: ${chain.addressGroupId}`);
          await transaction`
            INSERT INTO wss_wallet_accounts (
              id, tenant_id, wallet_id, chain_id, address_group_id, address_normalized, address_display
            ) VALUES (
              ${randomUUID()}, ${manifest.tenantId}, ${walletId}, ${chainId}, ${chain.addressGroupId},
              ${chain.addressGroupId === 'evm' ? address.toLowerCase() : address}, ${address}
            )
          `;
        }
        await transaction`
          INSERT INTO wss_sar_recovery_profiles (
            id, tenant_id, wallet_id, protocol_version, threshold, share_count,
            status, key_core_version, storage_mode, policy_metadata
          ) VALUES (
            ${randomUUID()}, ${manifest.tenantId}, ${walletId}, 1,
            ${request.source.recovery.threshold}, ${request.source.recovery.shareCount}, 'active',
            ${request.source.recovery.keyCoreVersion}, 'single-project-development',
            ${transaction.json({ scheme: request.source.recovery.scheme, recombinationVerified: request.source.recovery.recombinationVerified })}
          )
        `;
        for (const envelope of request.source.recoveryEnvelopes) {
          await transaction`
            INSERT INTO wss_dev_sar_envelopes (
              tenant_id, wallet_id, share_index, envelope_version, algorithm,
              iv_base64, ciphertext_base64, aad
            ) VALUES (
              ${manifest.tenantId}, ${walletId}, ${envelope.factorIndex}, ${envelope.envelopeVersion},
              ${envelope.algorithm}, ${envelope.ivBase64}, ${envelope.ciphertextBase64}, ${envelope.aad}
            )
          `;
        }
      }

      await transaction`
        INSERT INTO wss_audit_events (
          id, tenant_id, event_type, actor_type, actor_ref_hash,
          user_profile_id, wallet_id, correlation_id, metadata
        ) VALUES (
          ${randomUUID()}, ${manifest.tenantId}, 'wallet.provisioned', 'institution-subject',
          ${session.subject}, ${profileId}, ${walletId}, ${session.sessionId},
          ${transaction.json({ keyAdapter: request.keyAdapter, origin })}
        )
      `;
    });

    const walletHome = await this.#readyHome(profileId, manifest, walletId);
    if (!walletHome) throw new Error('Persisted wallet could not be loaded.');
    return {
      mode: request.source.type === 'secure-new' ? 'development-key-core' : 'sandbox-contract-only',
      walletHome,
    };
  }
}
