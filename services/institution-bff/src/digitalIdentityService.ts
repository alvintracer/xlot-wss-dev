import { createHash, createHmac, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import postgres from 'postgres';
import { verifyMessage } from 'ethers';
import { createIdentityCommitment, verifyIdentityEqualityProof, type IdentityEqualityProof } from '@took-wss/identity-proof';
import { ed25519DidKey, publicKeyFromEd25519Did, type DigitalIdentitySummary, type WssSessionClaims } from '@took-wss/contracts';
import { decryptPrivateAttribute, encryptionKeyFromHex } from './phoneRegistration.js';

type Session = Omit<WssSessionClaims, 'nonce'>;
type Sql = ReturnType<typeof postgres>;
type Source = { profileId: string; name: string; birthDate: string; phoneMasked: string; phoneVerifiedAt: string };

export class DigitalIdentityError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

function requiredHex(name: string, length: number): Buffer {
  const value = process.env[name]?.trim();
  if (!value || !new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(value)) {
    throw new DigitalIdentityError('identity_issuer_unavailable', 503);
  }
  return Buffer.from(value, 'hex');
}

function issuerKey() {
  const seed = requiredHex('WSS_DEV_IDENTITY_ISSUER_SEED_HEX', 32);
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  seed.fill(0);
  const publicKey = createPublicKey(privateKey);
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, publicKey, did: ed25519DidKey(raw) };
}

function publicKeyFromDid(did: string) {
  const raw = publicKeyFromEd25519Did(did);
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw)]), format: 'der', type: 'spki' });
}

function sourceFingerprint(source: Source): string {
  const secret = process.env.WSS_PHONE_LOOKUP_SECRET;
  if (!secret) throw new DigitalIdentityError('identity_source_unavailable', 503);
  return createHmac('sha256', secret).update(JSON.stringify([
    'took-wss-dev-identity-source-v1', source.name, source.birthDate,
    source.phoneMasked, source.phoneVerifiedAt,
  ])).digest('hex');
}

function decodeJwt(value: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  if (value.length > 12_000) throw new DigitalIdentityError('credential_invalid');
  const parts = value.split('.');
  if (parts.length !== 3) throw new DigitalIdentityError('credential_invalid');
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!header || !payload || typeof header !== 'object' || typeof payload !== 'object') throw new Error('bad');
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2]!, 'base64url') };
  } catch { throw new DigitalIdentityError('credential_invalid'); }
}

export class DevelopmentDigitalIdentityService {
  readonly #sql: Sql;
  readonly #piiKey: Buffer;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 });
    this.#piiKey = encryptionKeyFromHex(process.env.WSS_PII_ENCRYPTION_KEY ?? '');
  }

  async #source(session: Session): Promise<Source> {
    const rows = await this.#sql<{
      profile_id: string; intent_id: string; name_ciphertext: Buffer; birth_date_ciphertext: Buffer;
      phone_ciphertext: Buffer; phone_possession_verified_at: Date; claim_source: string;
    }[]>`
      SELECT profile.id AS profile_id, intent.id AS intent_id, attributes.name_ciphertext,
        attributes.birth_date_ciphertext, attributes.phone_ciphertext,
        attributes.phone_possession_verified_at, attributes.claim_source
      FROM wss_external_identities identity
      JOIN wss_user_profiles profile ON profile.tenant_id = identity.tenant_id AND profile.id = identity.user_profile_id
      JOIN wss_user_private_attributes attributes ON attributes.tenant_id = profile.tenant_id AND attributes.user_profile_id = profile.id
      JOIN LATERAL (
        SELECT id FROM wss_registration_intents WHERE tenant_id = profile.tenant_id
          AND completed_profile_id = profile.id AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1
      ) intent ON true
      WHERE identity.tenant_id = ${session.tenantId} AND identity.issuer = 'institution-host'
        AND identity.subject_version = ${session.subjectVersion} AND identity.subject_hash = ${session.subject}
        AND identity.revoked_at IS NULL AND profile.status = 'active'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row?.phone_possession_verified_at || row.claim_source !== 'self-asserted') {
      throw new DigitalIdentityError('verified_phone_registration_required', 403);
    }
    try {
      const aad = `${session.tenantId}:${row.intent_id}:`;
      const phone = decryptPrivateAttribute(row.phone_ciphertext, this.#piiKey, `${aad}phone`);
      return {
        profileId: row.profile_id,
        name: decryptPrivateAttribute(row.name_ciphertext, this.#piiKey, `${aad}name`),
        birthDate: decryptPrivateAttribute(row.birth_date_ciphertext, this.#piiKey, `${aad}birth-date`),
        phoneMasked: `${phone.slice(0, 3)}-••••-${phone.slice(-4)}`,
        phoneVerifiedAt: row.phone_possession_verified_at.toISOString(),
      };
    } catch { throw new DigitalIdentityError('identity_source_unavailable', 503); }
  }

  async #credential(session: Session, credentialId: string) {
    const source = await this.#source(session);
    const rows = await this.#sql<{
      id: string; holder_did: string; issuer_did: string; credential_sha256: string; source_fingerprint: string | null;
      issued_at: Date; expires_at: Date; status: string;
    }[]>`
      SELECT id, holder_did, issuer_did, credential_sha256, source_fingerprint, issued_at, expires_at, status
      FROM wss_dev_identity_credentials WHERE id = ${credentialId} AND tenant_id = ${session.tenantId}
        AND user_profile_id = ${source.profileId} LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.status !== 'active' || row.expires_at <= new Date()
      || row.source_fingerprint !== sourceFingerprint(source)) {
      throw new DigitalIdentityError('credential_not_active', 404);
    }
    return { row, source };
  }

  async summary(session: Session, credentialId: string): Promise<DigitalIdentitySummary> {
    const { row, source } = await this.#credential(session, credentialId);
    const wallets = await this.#sql<{ wallet_id: string; label: string; address_display: string }[]>`
      SELECT binding.wallet_id, wallet.label, binding.address_normalized AS address_display
      FROM wss_dev_identity_wallet_bindings binding
      JOIN wss_wallets wallet ON wallet.tenant_id = binding.tenant_id AND wallet.id = binding.wallet_id
      WHERE binding.tenant_id = ${session.tenantId} AND binding.credential_id = ${credentialId}
        AND binding.revoked_at IS NULL AND wallet.status = 'active'
    `;
    return {
      credentialId: row.id, holderDid: row.holder_did, issuerDid: row.issuer_did,
      name: source.name, birthDate: source.birthDate, phoneMasked: source.phoneMasked,
      issuedAt: row.issued_at.toISOString(), expiresAt: row.expires_at.toISOString(),
      assurance: 'DEV_ASSUMED', connectedWallets: wallets.map((wallet) => ({ walletId: wallet.wallet_id, label: wallet.label, address: wallet.address_display })),
    };
  }

  async issue(session: Session, holderDid: string, accepted: boolean) {
    if (!accepted) throw new DigitalIdentityError('credential_consent_required', 403);
    try { publicKeyFromEd25519Did(holderDid); } catch { throw new DigitalIdentityError('holder_did_invalid'); }
    const source = await this.#source(session);
    const issuer = issuerKey();
    const credentialId = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const identityProof = createIdentityCommitment(source.name, source.birthDate);
    const header = { alg: 'EdDSA', typ: 'vc+jwt', kid: `${issuer.did}#${issuer.did.slice('did:key:'.length)}` };
    const payload = {
      iss: issuer.did, sub: holderDid, jti: credentialId,
      nbf: Math.floor(issuedAt.getTime() / 1000), exp: Math.floor(expiresAt.getTime() / 1000),
      vc: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        id: `urn:uuid:${credentialId}`,
        type: ['VerifiableCredential', 'TookDevIdentityCredential'],
        issuer: issuer.did, validFrom: issuedAt.toISOString(), validUntil: expiresAt.toISOString(),
        credentialSubject: { id: holderDid, identityCommitment: identityProof.commitment,
          identityProofScheme: 'noir-ultrahonk-v1',
          claimTypes: ['name', 'birthDate'],
          phonePossessionVerifiedAt: source.phoneVerifiedAt,
          nameAssurance: 'SELF_ASSERTED', birthDateAssurance: 'SELF_ASSERTED' },
        assurance: 'DEV_ASSUMED', productionEligible: false,
      },
    };
    const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const credential = `${signingInput}.${sign(null, Buffer.from(signingInput), issuer.privateKey).toString('base64url')}`;
    await this.#sql`
      INSERT INTO wss_dev_identity_credentials
        (id, tenant_id, user_profile_id, holder_did, issuer_did, credential_sha256, source_fingerprint, assurance, issued_at, expires_at)
      VALUES (${credentialId}, ${session.tenantId}, ${source.profileId}, ${holderDid}, ${issuer.did},
        ${createHash('sha256').update(credential).digest('hex')}, ${sourceFingerprint(source)}, 'DEV_ASSUMED', ${issuedAt}, ${expiresAt})
    `;
    return { credential, opening: identityProof.opening, summary: await this.summary(session, credentialId) };
  }

  async walletChallenge(session: Session, credentialId: string, walletId: string) {
    const { source } = await this.#credential(session, credentialId);
    const accounts = await this.#sql<{ address_display: string }[]>`
      SELECT account.address_display FROM wss_wallets wallet
      JOIN wss_wallet_accounts account ON account.tenant_id = wallet.tenant_id AND account.wallet_id = wallet.id
      WHERE wallet.tenant_id = ${session.tenantId} AND wallet.user_profile_id = ${source.profileId}
        AND wallet.id = ${walletId} AND wallet.status = 'active' AND account.address_group_id = 'evm' LIMIT 1
    `;
    if (!accounts[0] || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0].address_display)) throw new DigitalIdentityError('wallet_not_eligible', 404);
    const challengeId = randomUUID();
    const message = `Took WSS identity wallet binding\n\nTenant: ${session.tenantId}\nCredential: ${credentialId}\nWallet: ${walletId}\nAddress: ${accounts[0].address_display}\nNonce: ${challengeId}\nExpires: ${new Date(Date.now() + 5 * 60_000).toISOString()}`;
    await this.#sql`INSERT INTO wss_dev_identity_challenges (id, tenant_id, credential_id, wallet_id, purpose, challenge, expires_at)
      VALUES (${challengeId}, ${session.tenantId}, ${credentialId}, ${walletId}, 'wallet-binding', ${message}, ${new Date(Date.now() + 5 * 60_000)})`;
    return { challengeId, message, address: accounts[0].address_display };
  }

  async bindWallet(session: Session, credentialId: string, challengeId: string, walletSignature: string, holderSignature: string) {
    const { row, source } = await this.#credential(session, credentialId);
    if (!/^0x[0-9a-fA-F]{130}$/.test(walletSignature)) throw new DigitalIdentityError('wallet_signature_invalid');
    const challenges = await this.#sql<{ wallet_id: string; challenge: string; expires_at: Date; consumed_at: Date | null }[]>`
      SELECT wallet_id, challenge, expires_at, consumed_at FROM wss_dev_identity_challenges
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId} AND credential_id = ${credentialId}
        AND purpose = 'wallet-binding' LIMIT 1
    `;
    const challenge = challenges[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date()) throw new DigitalIdentityError('identity_challenge_expired');
    const address = /\nAddress: (0x[0-9a-fA-F]{40})\n/.exec(challenge.challenge)?.[1];
    let recovered: string | null = null;
    try { recovered = verifyMessage(challenge.challenge, walletSignature); } catch { /* invalid EVM signature */ }
    if (!address || recovered?.toLowerCase() !== address.toLowerCase()) {
      throw new DigitalIdentityError('wallet_signature_invalid');
    }
    const owned = await this.#sql<{ id: string }[]>`
      SELECT wallet.id FROM wss_wallets wallet
      JOIN wss_wallet_accounts account ON account.tenant_id = wallet.tenant_id AND account.wallet_id = wallet.id
      WHERE wallet.tenant_id = ${session.tenantId} AND wallet.id = ${challenge.wallet_id}
        AND wallet.user_profile_id = ${source.profileId} AND wallet.status = 'active'
        AND account.address_group_id = 'evm' AND account.address_normalized = ${address.toLowerCase()}
      LIMIT 1
    `;
    if (!owned[0]) throw new DigitalIdentityError('wallet_not_eligible', 404);
    let validHolder = false;
    try { validHolder = verify(null, Buffer.from(challenge.challenge), publicKeyFromDid(row.holder_did), Buffer.from(holderSignature, 'base64url')); } catch { /* invalid holder signature */ }
    if (!validHolder) throw new DigitalIdentityError('holder_signature_invalid');
    const claimed = await this.#sql<{ id: string }[]>`
      UPDATE wss_dev_identity_challenges SET consumed_at = now() WHERE id = ${challengeId}
        AND tenant_id = ${session.tenantId} AND consumed_at IS NULL AND expires_at > now() RETURNING id
    `;
    if (!claimed[0]) throw new DigitalIdentityError('identity_challenge_replayed');
    await this.#sql`
      INSERT INTO wss_dev_identity_wallet_bindings (id, tenant_id, credential_id, wallet_id, address_normalized, wallet_signature)
      VALUES (${randomUUID()}, ${session.tenantId}, ${credentialId}, ${challenge.wallet_id}, ${address.toLowerCase()}, ${walletSignature})
      ON CONFLICT (tenant_id, credential_id, wallet_id) DO UPDATE SET
        address_normalized = EXCLUDED.address_normalized, wallet_signature = EXCLUDED.wallet_signature,
        bound_at = now(), revoked_at = NULL
    `;
    return this.summary(session, credentialId);
  }

  async presentationChallenge(session: Session, credentialId: string) {
    await this.#credential(session, credentialId);
    const challengeId = randomUUID();
    const message = `Took WSS identity presentation\n\nTenant: ${session.tenantId}\nCredential: ${credentialId}\nNonce: ${challengeId}\nExpires: ${new Date(Date.now() + 5 * 60_000).toISOString()}`;
    await this.#sql`INSERT INTO wss_dev_identity_challenges (id, tenant_id, credential_id, purpose, challenge, expires_at)
      VALUES (${challengeId}, ${session.tenantId}, ${credentialId}, 'presentation', ${message}, ${new Date(Date.now() + 5 * 60_000)})`;
    return { challengeId, message };
  }

  async verifyPresentation(session: Session, credentialId: string, challengeId: string, credential: string,
    holderSignature: string, expectedName: string, expectedBirthDate: string, proof: IdentityEqualityProof) {
    const { row } = await this.#credential(session, credentialId);
    const challengeRows = await this.#sql<{ challenge: string; expires_at: Date; consumed_at: Date | null }[]>`
      SELECT challenge, expires_at, consumed_at FROM wss_dev_identity_challenges
      WHERE id = ${challengeId} AND tenant_id = ${session.tenantId} AND credential_id = ${credentialId}
        AND purpose = 'presentation' LIMIT 1
    `;
    const challenge = challengeRows[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date()) throw new DigitalIdentityError('identity_challenge_expired');
    const parsed = decodeJwt(credential);
    const issuer = issuerKey();
    const vc = parsed.payload.vc as Record<string, unknown> | undefined;
    const subject = vc?.credentialSubject as Record<string, unknown> | undefined;
    if (parsed.header.alg !== 'EdDSA' || parsed.header.typ !== 'vc+jwt'
      || parsed.payload.iss !== issuer.did || row.issuer_did !== issuer.did
      || parsed.payload.sub !== row.holder_did || parsed.payload.jti !== credentialId
      || !vc || vc.assurance !== 'DEV_ASSUMED' || vc.productionEligible !== false
      || subject?.id !== row.holder_did || typeof subject.identityCommitment !== 'string'
      || subject.identityProofScheme !== 'noir-ultrahonk-v1'
      || !Array.isArray(subject.claimTypes) || !subject.claimTypes.includes('name') || !subject.claimTypes.includes('birthDate')
      || typeof parsed.payload.nbf !== 'number' || typeof parsed.payload.exp !== 'number'
      || parsed.payload.nbf > Date.now() / 1000 || parsed.payload.exp <= Date.now() / 1000
      || createHash('sha256').update(credential).digest('hex') !== row.credential_sha256
      || !verify(null, Buffer.from(parsed.signingInput), issuer.publicKey, parsed.signature)) {
      throw new DigitalIdentityError('credential_invalid');
    }
    let validHolder = false;
    try { validHolder = verify(null, Buffer.from(challenge.challenge), publicKeyFromDid(row.holder_did), Buffer.from(holderSignature, 'base64url')); } catch { /* invalid holder signature */ }
    if (!validHolder) throw new DigitalIdentityError('holder_signature_invalid');
    if (!await verifyIdentityEqualityProof({ credentialId, nonce: challengeId,
      commitment: subject.identityCommitment, expectedName, expectedBirthDate, proof })) {
      throw new DigitalIdentityError('identity_claims_do_not_match');
    }
    const claimed = await this.#sql<{ id: string }[]>`
      UPDATE wss_dev_identity_challenges SET consumed_at = now() WHERE id = ${challengeId}
        AND tenant_id = ${session.tenantId} AND consumed_at IS NULL AND expires_at > now() RETURNING id
    `;
    if (!claimed[0]) throw new DigitalIdentityError('identity_challenge_replayed');
    return { verified: true as const, claimsMatched: true as const, assurance: 'DEV_ASSUMED' as const,
      credentialId, connectedWallets: (await this.summary(session, credentialId)).connectedWallets.length };
  }
}
