import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  CreatePhoneChallengeResponse,
  CreateRegistrationIntentRequest,
  CreateRegistrationIntentResponse,
  IdentityAssuranceLevel,
  ProvisionWalletRequest,
  ProvisionWalletResponse,
  ReadyWalletHomePayload,
  TenantManifest,
  WalletNetworkView,
  WalletProfileSummary,
  WssSessionClaims,
  VerifyPhoneChallengeResponse,
  WssIdentityState,
} from '@took-wss/contracts';
import type { IdentityRegistrationProvider, WalletProvisioningProvider, WalletQueryProvider } from '@took-wss/provider-adapters';
import {
  RegistrationError,
  consentEvidenceHash,
  decryptPrivateAttribute,
  encryptPrivateAttribute,
  encryptionKeyFromHex,
  generateOtp,
  normalizeRegistrationInput,
  otpMac,
  phoneLookupHash,
  providerSubjectHash,
  koreanPhoneE164,
  sessionIdHash,
  verifyOtpMac,
} from './phoneRegistration.js';
import { SupabasePhoneAuthClient } from './supabasePhoneAuth.js';
import { queryWalletPortfolio } from './assetPortfolio.js';

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

export interface RegistrationSecurityConfig {
  piiEncryptionKeyHex: string;
  phoneLookupSecret: string;
  otpMacSecret: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export class DevelopmentPostgresWalletProvider implements WalletQueryProvider, WalletProvisioningProvider, IdentityRegistrationProvider {
  readonly id = 'development-postgres-wallet-provider';
  readonly #sql: ReturnType<typeof postgres>;
  readonly #piiEncryptionKey: Buffer;
  readonly #phoneLookupSecret: string;
  readonly #otpMacSecret: string;
  readonly #supabasePhoneAuth: SupabasePhoneAuthClient;
  #boundaryChecked = false;

  constructor(databaseUrl: string, security: RegistrationSecurityConfig) {
    this.#sql = postgres(databaseUrl, { max: 5, prepare: false, idle_timeout: 20 });
    this.#piiEncryptionKey = encryptionKeyFromHex(security.piiEncryptionKeyHex);
    this.#phoneLookupSecret = security.phoneLookupSecret;
    this.#otpMacSecret = security.otpMacSecret;
    this.#supabasePhoneAuth = new SupabasePhoneAuthClient(
      security.supabaseUrl,
      security.supabasePublishableKey,
    );
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

  async #findProfile(session: Session): Promise<{ profileId: string; assuranceLevel: IdentityAssuranceLevel } | null> {
    await this.#assertDevelopmentBoundary();
    const existing = await this.#sql<{ user_profile_id: string; assurance_level: string }[]>`
      SELECT identity.user_profile_id, profile.assurance_level
      FROM wss_external_identities identity
      JOIN wss_user_profiles profile
        ON profile.tenant_id = identity.tenant_id AND profile.id = identity.user_profile_id
      WHERE identity.tenant_id = ${session.tenantId}
        AND identity.issuer = 'institution-host'
        AND identity.subject_version = ${session.subjectVersion}
        AND identity.subject_hash = ${session.subject}
        AND identity.revoked_at IS NULL
        AND profile.status = 'active'
      LIMIT 1
    `;
    return existing[0]
      ? { profileId: existing[0].user_profile_id, assuranceLevel: existing[0].assurance_level as IdentityAssuranceLevel }
      : null;
  }

  async #resolveProfile(session: Session, manifest: TenantManifest): Promise<string | null> {
    const found = await this.#findProfile(session);
    if (found) {
      await this.#sql`
        UPDATE wss_external_identities
        SET last_seen_at = now()
        WHERE tenant_id = ${session.tenantId}
          AND issuer = 'institution-host'
          AND subject_version = ${session.subjectVersion}
          AND subject_hash = ${session.subject}
      `;
      return found.profileId;
    }
    if (manifest.identity.onboardingMode === 'phone-first') return null;

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

  async getIdentity({ session, manifest }: { session: Session; manifest: TenantManifest }): Promise<WssIdentityState> {
    const profileId = await this.#resolveProfile(session, manifest);
    if (!profileId) return { status: 'registration-required' };
    const found = await this.#findProfile(session);
    return {
      status: 'established',
      assuranceLevel: (found?.assuranceLevel ?? 'institution-authenticated') as Extract<WssIdentityState, { status: 'established' }>['assuranceLevel'],
    };
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
    const networks = networksForManifest(manifest, addresses);
    const portfolio = await queryWalletPortfolio(networks);
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
      ...(portfolio.totalFiat ? { totalFiat: portfolio.totalFiat } : {}),
      assets: portfolio.assets,
      networks,
      valuation: portfolio.valuation,
      recovery: {
        profile: selected.key_adapter === 'took-sar' ? 'sar-2-of-3' : 'provider-policy',
        status: 'sandbox-ready',
        policyVersion: manifest.keyManagement.policyVersion,
      },
      source: 'wallet-query',
    };
  }

  async getHome({ session, manifest, walletId }: { session: Session; manifest: TenantManifest; walletId?: string }) {
    const profileId = await this.#resolveProfile(session, manifest);
    if (!profileId) return absentHome(manifest);
    const home = await this.#readyHome(profileId, manifest, walletId);
    if (home) return home;
    if (walletId) return { status: 'unavailable', code: 'wallet_not_found', canRetry: false, source: 'wallet-query' } as const;
    return absentHome(manifest);
  }

  async provision({ session, manifest, request, evidence }: {
    session: Session;
    manifest: TenantManifest;
    request: ProvisionWalletRequest;
    evidence: { hostAuthorizationId: string; keyCoreAttestationId?: string };
  }): Promise<ProvisionWalletResponse> {
    if (!manifest.keyManagement.allowedAdapters.includes(request.keyAdapter)) throw new Error('Requested key adapter is not allowed.');
    if (request.keyAdapter === 'took-sar' && !request.recoverySetupAcknowledged) throw new Error('SAR recovery setup acknowledgement is required.');
    if (request.keyAdapter === 'took-sar' && request.source.type === 'new') throw new Error('SAR wallet creation requires a completed host key-core registration.');
    if ((request.source.type === 'secure-new' || request.source.type === 'secure-import') && request.keyAdapter !== 'took-sar') {
      throw new Error('Secure key-core sources require a SAR wallet slot.');
    }

    const profileId = await this.#resolveProfile(session, manifest);
    if (!profileId) throw new RegistrationError('identity_registration_required');
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
      const consumedAuthorizations = await transaction<{ id: string }[]>`
        SELECT id FROM wss_wallets
        WHERE tenant_id = ${manifest.tenantId}
          AND host_authorization_id = ${evidence.hostAuthorizationId}
        LIMIT 1
      `;
      if (consumedAuthorizations[0]) throw new Error('Wallet authorization proof was already consumed.');
      if (request.source.type === 'secure-new') {
        if (!evidence.keyCoreAttestationId) throw new Error('Key-core attestation proof is required.');
        const consumedKeyCoreAttestations = await transaction<{ id: string }[]>`
          SELECT id FROM wss_wallets
          WHERE tenant_id = ${manifest.tenantId}
            AND key_core_attestation_id = ${evidence.keyCoreAttestationId}
          LIMIT 1
        `;
        if (consumedKeyCoreAttestations[0]) throw new Error('Key-core attestation proof was already consumed.');
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
          provisioning_origin, status, label, provisioning_idempotency_key, secure_provision_ref_hash,
          host_authorization_id, key_core_attestation_id
        ) VALUES (
          ${walletId}, ${manifest.tenantId}, ${profileId}, ${manifest.keyManagement.policyVersion},
          ${request.keyAdapter}, ${origin}, 'active', ${`${adapterLabel} ${walletNumber}`},
          ${request.idempotencyKey}, ${secureRefHash}, ${evidence.hostAuthorizationId},
          ${evidence.keyCoreAttestationId ?? null}
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
          ${transaction.json({
            keyAdapter: request.keyAdapter,
            origin,
            hostAuthorization: 'one-time-proof',
            keyCoreAttestation: evidence.keyCoreAttestationId ? 'one-time-proof' : 'not-applicable',
          })}
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

  async createRegistrationIntent({ session, manifest, request }: {
    session: Session;
    manifest: TenantManifest;
    request: CreateRegistrationIntentRequest;
  }): Promise<CreateRegistrationIntentResponse> {
    await this.#assertDevelopmentBoundary();
    if (manifest.identity.onboardingMode !== 'phone-first') throw new RegistrationError('phone_registration_not_enabled');
    if (await this.#findProfile(session)) throw new RegistrationError('identity_already_established');
    const normalized = normalizeRegistrationInput(request, manifest.identity.consentVersion);
    const intentId = randomUUID();
    const lookupHash = phoneLookupHash(session.tenantId, normalized.phone, this.#phoneLookupSecret);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const aadPrefix = `${session.tenantId}:${intentId}`;
    const encryptedName = encryptPrivateAttribute(normalized.name, this.#piiEncryptionKey, `${aadPrefix}:name`);
    const encryptedBirthDate = encryptPrivateAttribute(normalized.birthDate, this.#piiEncryptionKey, `${aadPrefix}:birth-date`);
    const encryptedPhone = encryptPrivateAttribute(normalized.phone, this.#piiEncryptionKey, `${aadPrefix}:phone`);

    await this.#sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.tenantId}:registration:${session.subject}`}, 0))`;
      const recent = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM wss_registration_intents intent
        JOIN wss_registration_session_bindings binding
          ON binding.tenant_id = intent.tenant_id AND binding.registration_intent_id = intent.id
        WHERE intent.tenant_id = ${session.tenantId}
          AND binding.institution_subject_hash = ${session.subject}
          AND binding.subject_version = ${session.subjectVersion}
          AND intent.created_at > now() - interval '10 minutes'
      `;
      if (Number(recent[0]?.count ?? '0') >= 5) throw new RegistrationError('registration_rate_limited');
      await transaction`
        UPDATE wss_registration_intents intent
        SET status = 'cancelled', name_ciphertext = NULL, birth_date_ciphertext = NULL,
            phone_ciphertext = NULL, pii_purged_at = now(), updated_at = now()
        FROM wss_registration_session_bindings binding
        WHERE binding.tenant_id = intent.tenant_id
          AND binding.registration_intent_id = intent.id
          AND intent.tenant_id = ${session.tenantId}
          AND binding.institution_subject_hash = ${session.subject}
          AND binding.subject_version = ${session.subjectVersion}
          AND intent.status = 'pending'
      `;
      await transaction`
        INSERT INTO wss_registration_intents (
          id, tenant_id, status, name_ciphertext, birth_date_ciphertext, phone_ciphertext,
          phone_lookup_hash, carrier_code, encryption_key_version, consent_version, expires_at
        ) VALUES (
          ${intentId}, ${session.tenantId}, 'pending', ${encryptedName}, ${encryptedBirthDate},
          ${encryptedPhone}, ${lookupHash}, ${normalized.carrierCode}, 1,
          ${normalized.consentVersion}, ${expiresAt}
        )
      `;
      await transaction`
        INSERT INTO wss_registration_session_bindings (
          tenant_id, registration_intent_id, institution_subject_hash, subject_version, session_id_hash
        ) VALUES (
          ${session.tenantId}, ${intentId}, ${session.subject}, ${session.subjectVersion},
          ${sessionIdHash(session.tenantId, session.sessionId, this.#otpMacSecret)}
        )
      `;
    });
    return { registrationIntentId: intentId, expiresAt: expiresAt.toISOString() };
  }

  async createPhoneChallenge({ session, manifest, registrationIntentId }: {
    session: Session;
    manifest: TenantManifest;
    registrationIntentId: string;
  }): Promise<CreatePhoneChallengeResponse> {
    await this.#assertDevelopmentBoundary();
    if (manifest.identity.onboardingMode !== 'phone-first') throw new RegistrationError('phone_registration_not_enabled');
    const challengeId = randomUUID();
    const wantsSupabaseAuth = manifest.identity.phoneVerification === 'supabase-auth-solapi';
    let usesSupabaseAuth = wantsSupabaseAuth;
    let code = wantsSupabaseAuth ? null : generateOtp();
    const expiresAt = new Date(Date.now() + 3 * 60_000);
    await this.#sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.tenantId}:challenge:${registrationIntentId}`}, 0))`;
      const intents = await transaction<{ status: string; expires_at: Date; phone_ciphertext: Buffer }[]>`
        SELECT intent.status, intent.expires_at, intent.phone_ciphertext
        FROM wss_registration_intents intent
        JOIN wss_registration_session_bindings binding
          ON binding.tenant_id = intent.tenant_id AND binding.registration_intent_id = intent.id
        WHERE intent.tenant_id = ${session.tenantId}
          AND intent.id = ${registrationIntentId}
          AND binding.institution_subject_hash = ${session.subject}
          AND binding.subject_version = ${session.subjectVersion}
          AND binding.session_id_hash = ${sessionIdHash(session.tenantId, session.sessionId, this.#otpMacSecret)}
        FOR UPDATE OF intent
      `;
      const intent = intents[0];
      if (!intent) throw new RegistrationError('registration_intent_not_found');
      if (intent.status !== 'pending' || new Date(intent.expires_at) <= new Date()) throw new RegistrationError('registration_intent_expired');
      const recent = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM wss_phone_challenges
        WHERE tenant_id = ${session.tenantId}
          AND registration_intent_id = ${registrationIntentId}
          AND created_at > now() - interval '10 minutes'
      `;
      if (Number(recent[0]?.count ?? '0') >= 3) throw new RegistrationError('challenge_rate_limited');
      if (usesSupabaseAuth) {
        if (!intent.phone_ciphertext) throw new RegistrationError('registration_intent_expired');
        const phone = decryptPrivateAttribute(
          intent.phone_ciphertext,
          this.#piiEncryptionKey,
          `${session.tenantId}:${registrationIntentId}:phone`,
        );
        try {
          await this.#supabasePhoneAuth.requestOtp(koreanPhoneE164(phone));
        } catch (error) {
          const canUsePreview = manifest.environment !== 'production'
            && error instanceof RegistrationError
            && error.code === 'phone_delivery_unavailable';
          if (!canUsePreview) throw error;
          usesSupabaseAuth = false;
          code = generateOtp();
        }
      }
      await transaction`
        UPDATE wss_phone_challenges SET status = 'cancelled'
        WHERE tenant_id = ${session.tenantId}
          AND registration_intent_id = ${registrationIntentId}
          AND status = 'issued'
      `;
      await transaction`
        INSERT INTO wss_phone_challenges (
          id, tenant_id, registration_intent_id, status, otp_mac, mac_key_version,
          max_attempts, expires_at, delivery_channel, delivery_provider, sent_at,
          verification_provider
        ) VALUES (
          ${challengeId}, ${session.tenantId}, ${registrationIntentId}, 'issued',
          ${code ? otpMac(session.tenantId, challengeId, code, this.#otpMacSecret) : null},
          ${code ? 1 : null}, 5,
          ${expiresAt}, 'sms',
          ${usesSupabaseAuth ? 'supabase-auth-solapi' : code ? 'development-preview' : 'host'}, now(),
          ${usesSupabaseAuth ? 'supabase-auth' : 'wss-mac'}
        )
      `;
    });
    return {
      challengeId,
      expiresAt: expiresAt.toISOString(),
      delivery: 'sms',
      ...(manifest.environment !== 'production'
        && manifest.identity.phoneVerification !== 'host'
        && code
        ? { developmentCode: code }
        : {}),
    };
  }

  async verifyPhoneChallenge({ session, manifest, registrationIntentId, challengeId, code }: {
    session: Session;
    manifest: TenantManifest;
    registrationIntentId: string;
    challengeId: string;
    code: string;
  }): Promise<VerifyPhoneChallengeResponse> {
    await this.#assertDevelopmentBoundary();
    if (!/^\d{6}$/.test(code)) throw new RegistrationError('invalid_verification_code');
    let rejectionCode: string | null = null;
    let verifiedAccessToken: string | null = null;
    await this.#sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.tenantId}:registration:${session.subject}`}, 0))`;
      const rows = await transaction<{
        challenge_status: string;
        otp_mac: Buffer | null;
        attempt_count: number;
        max_attempts: number;
        challenge_expires_at: Date;
        intent_status: string;
        intent_expires_at: Date;
        name_ciphertext: Buffer;
        birth_date_ciphertext: Buffer;
        phone_ciphertext: Buffer;
        phone_lookup_hash: Buffer;
        carrier_code: string;
        encryption_key_version: number;
        consent_version: string;
        verification_provider: 'wss-mac' | 'supabase-auth';
      }[]>`
        SELECT challenge.status AS challenge_status, challenge.otp_mac, challenge.attempt_count,
          challenge.max_attempts, challenge.expires_at AS challenge_expires_at,
          intent.status AS intent_status, intent.expires_at AS intent_expires_at,
          intent.name_ciphertext, intent.birth_date_ciphertext, intent.phone_ciphertext,
          intent.phone_lookup_hash, intent.carrier_code, intent.encryption_key_version, intent.consent_version,
          challenge.verification_provider
        FROM wss_phone_challenges challenge
        JOIN wss_registration_intents intent
          ON intent.tenant_id = challenge.tenant_id AND intent.id = challenge.registration_intent_id
        JOIN wss_registration_session_bindings binding
          ON binding.tenant_id = intent.tenant_id AND binding.registration_intent_id = intent.id
        WHERE challenge.tenant_id = ${session.tenantId}
          AND challenge.registration_intent_id = ${registrationIntentId}
          AND challenge.id = ${challengeId}
          AND binding.institution_subject_hash = ${session.subject}
          AND binding.subject_version = ${session.subjectVersion}
          AND binding.session_id_hash = ${sessionIdHash(session.tenantId, session.sessionId, this.#otpMacSecret)}
        FOR UPDATE OF challenge, intent
      `;
      const row = rows[0];
      if (!row) throw new RegistrationError('phone_challenge_not_found');
      if (row.challenge_status !== 'issued' || row.intent_status !== 'pending') throw new RegistrationError('phone_challenge_not_active');
      if (new Date(row.challenge_expires_at) <= new Date() || new Date(row.intent_expires_at) <= new Date()) {
        await transaction`UPDATE wss_phone_challenges SET status = 'expired' WHERE tenant_id = ${session.tenantId} AND id = ${challengeId}`;
        rejectionCode = 'phone_challenge_expired';
        return;
      }
      let verifiedProviderSubjectHash: string | null = null;
      let verificationFailure: string | null = null;
      if (row.verification_provider === 'supabase-auth') {
        if (manifest.identity.phoneVerification !== 'supabase-auth-solapi') {
          throw new RegistrationError('phone_verification_policy_mismatch');
        }
        try {
          const phone = decryptPrivateAttribute(
            row.phone_ciphertext,
            this.#piiEncryptionKey,
            `${session.tenantId}:${registrationIntentId}:phone`,
          );
          const verified = await this.#supabasePhoneAuth.verifyOtp(koreanPhoneE164(phone), code);
          if (!verifyOtpMac(
            row.phone_lookup_hash,
            phoneLookupHash(session.tenantId, verified.phone, this.#phoneLookupSecret),
          )) {
            verificationFailure = 'verified_phone_mismatch';
          } else {
            verifiedAccessToken = verified.accessToken;
            verifiedProviderSubjectHash = providerSubjectHash(
              session.tenantId,
              verified.providerSubject,
              this.#phoneLookupSecret,
            );
          }
        } catch (error) {
          if (error instanceof RegistrationError
            && error.code === 'phone_verification_unavailable') throw error;
          verificationFailure = error instanceof RegistrationError ? error.code : 'phone_verification_unavailable';
        }
      } else if (!row.otp_mac || !verifyOtpMac(
        row.otp_mac,
        otpMac(session.tenantId, challengeId, code, this.#otpMacSecret),
      )) {
        verificationFailure = 'verification_code_mismatch';
      }
      if (verificationFailure) {
        const blocked = row.attempt_count + 1 >= row.max_attempts;
        await transaction`
          UPDATE wss_phone_challenges
          SET attempt_count = attempt_count + 1, status = ${blocked ? 'blocked' : 'issued'}
          WHERE tenant_id = ${session.tenantId} AND id = ${challengeId}
        `;
        rejectionCode = blocked ? 'phone_challenge_blocked' : verificationFailure;
        return;
      }

      const profileId = randomUUID();
      await transaction`
        INSERT INTO wss_user_profiles (id, tenant_id, status, assurance_level)
        VALUES (${profileId}, ${session.tenantId}, 'active', 'phone-possession')
      `;
      await transaction`
        INSERT INTO wss_external_identities (
          id, tenant_id, user_profile_id, issuer, subject_hash, subject_version, assurance_level
        ) VALUES (
          ${randomUUID()}, ${session.tenantId}, ${profileId}, 'institution-host', ${session.subject},
          ${session.subjectVersion}, 'institution-authenticated'
        )
      `;
      await transaction`
        INSERT INTO wss_user_private_attributes (
          tenant_id, user_profile_id, name_ciphertext, birth_date_ciphertext, phone_ciphertext,
          phone_lookup_hash, carrier_code, claim_source, phone_possession_verified_at, encryption_key_version
        ) VALUES (
          ${session.tenantId}, ${profileId}, ${row.name_ciphertext}, ${row.birth_date_ciphertext},
          ${row.phone_ciphertext}, ${row.phone_lookup_hash}, ${row.carrier_code}, 'self-asserted', now(),
          ${row.encryption_key_version}
        )
      `;
      await transaction`
        INSERT INTO wss_consent_records (
          id, tenant_id, user_profile_id, purpose_code, document_version, accepted_at, evidence_hash
        ) VALUES (
          ${randomUUID()}, ${session.tenantId}, ${profileId}, 'wallet-profile-and-phone-possession',
          ${row.consent_version}, now(),
          ${consentEvidenceHash({ tenantId: session.tenantId, registrationIntentId, subjectHash: session.subject, consentVersion: row.consent_version })}
        )
      `;
      await transaction`
        UPDATE wss_phone_challenges
        SET status = 'verified', verified_at = now(),
          provider_subject_hash = ${verifiedProviderSubjectHash}
        WHERE tenant_id = ${session.tenantId} AND id = ${challengeId}
      `;
      await transaction`
        UPDATE wss_registration_intents
        SET status = 'completed', completed_profile_id = ${profileId}, name_ciphertext = NULL,
          birth_date_ciphertext = NULL, phone_ciphertext = NULL, pii_purged_at = now(), updated_at = now()
        WHERE tenant_id = ${session.tenantId} AND id = ${registrationIntentId}
      `;
      await transaction`
        INSERT INTO wss_audit_events (
          id, tenant_id, event_type, actor_type, actor_ref_hash,
          user_profile_id, correlation_id, metadata
        ) VALUES (
          ${randomUUID()}, ${session.tenantId}, 'identity.phone-possession-verified',
          'institution-subject', ${session.subject}, ${profileId}, ${session.sessionId},
          ${transaction.json({
            consentVersion: row.consent_version,
            carrierCode: row.carrier_code,
            phoneVerificationProvider: row.verification_provider,
          })}
        )
      `;
    }).finally(async () => {
      if (verifiedAccessToken) await this.#supabasePhoneAuth.revoke(verifiedAccessToken);
    });
    if (rejectionCode) throw new RegistrationError(rejectionCode);
    return { identity: { status: 'established', assuranceLevel: 'phone-possession' } };
  }
}
