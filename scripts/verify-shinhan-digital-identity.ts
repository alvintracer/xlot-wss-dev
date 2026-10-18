// Synthetic development fixture. This checks the cryptographic and ownership path;
// it does not simulate a real SMS delivery or assert a legal identity check.
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import postgres from 'postgres';
import { Wallet } from 'ethers';
import { ed25519DidKey } from '../packages/contracts/src/digitalIdentity.js';
import { createIdentityEqualityProof } from '../packages/identity-proof/src/index.js';
import { encryptPrivateAttribute, encryptionKeyFromHex } from '../services/institution-bff/src/phoneRegistration.js';
import { verifySessionToken } from '../services/institution-bff/src/sessionToken.js';

const databaseUrl = process.env.DATABASE_URL;
const piiKeyHex = process.env.WSS_PII_ENCRYPTION_KEY;
const sessionSecret = process.env.WSS_SESSION_SECRET || 'local-wss-session-secret-must-never-ship';
if (!databaseUrl || !piiKeyHex) throw new Error('Development database and PII key are required.');
const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
const tenantId = 'shinhan';
const profileId = randomUUID();
const intentId = randomUUID();
const walletId = randomUUID();
const identityId = randomUUID();
const accountId = randomUUID();
const customerRef = process.env.WSS_TEST_CUSTOMER_REF || `identity-smoke-${randomUUID()}`;
const bffUrl = process.env.WSS_TEST_BFF_URL || 'http://localhost:4100';
const phoneHash = randomBytes(32);
const piiKey = encryptionKeyFromHex(piiKeyHex);
const wallet = Wallet.createRandom();
let credentialId: string | null = null;

async function api(path: string, token: string, body?: Record<string, unknown>) {
  const response = await fetch(`${bffUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() as Record<string, unknown> };
}

try {
  const marker = await sql<{ project_name: string; environment: string }[]>`
    SELECT project_name, environment FROM wss_deployment_metadata WHERE singleton = true
  `;
  if (marker[0]?.project_name !== 'xlot-wss-dev' || marker[0]?.environment !== 'development') {
    throw new Error('Synthetic identity test requires the xlot-wss-dev development database.');
  }
  const session = await fetch(`${bffUrl}/v1/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wss-institution-key': 'local-wss-development-only' },
    body: JSON.stringify({ tenantId, customerRef, requestedKeyAdapter: 'took-sar' }),
  });
  if (!session.ok) throw new Error(`Session failed: ${session.status}`);
  const { sessionToken } = await session.json() as { sessionToken: string };
  const claims = verifySessionToken(sessionToken, sessionSecret);
  const holder = generateKeyPairSync('ed25519');
  const holderDid = ed25519DidKey(holder.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));

  const before = await api('/v1/digital-identity/credentials', sessionToken, { holderDid, accepted: true });
  if (before.status !== 403 || before.data.error !== 'verified_phone_registration_required') {
    throw new Error('Issuance was not blocked without verified registration.');
  }

  await sql`INSERT INTO wss_user_profiles (id, tenant_id, status, assurance_level)
    VALUES (${profileId}, ${tenantId}, 'active', 'phone-possession')`;
  await sql`INSERT INTO wss_external_identities
    (id, tenant_id, user_profile_id, issuer, subject_hash, subject_version, assurance_level)
    VALUES (${identityId}, ${tenantId}, ${profileId}, 'institution-host', ${claims.subject}, 1, 'institution-authenticated')`;
  await sql`INSERT INTO wss_registration_intents
    (id, tenant_id, status, phone_lookup_hash, carrier_code, encryption_key_version, consent_version,
      completed_profile_id, expires_at, pii_purged_at)
    VALUES (${intentId}, ${tenantId}, 'completed', ${phoneHash}, 'skt', 1, 'identity-smoke-test',
      ${profileId}, ${new Date(Date.now() + 3600_000)}, now())`;
  await sql`INSERT INTO wss_user_private_attributes
    (tenant_id, user_profile_id, name_ciphertext, birth_date_ciphertext, phone_ciphertext,
      phone_lookup_hash, carrier_code, claim_source, phone_possession_verified_at, encryption_key_version)
    VALUES (${tenantId}, ${profileId},
      ${encryptPrivateAttribute('테스트사용자', piiKey, `${tenantId}:${intentId}:name`)},
      ${encryptPrivateAttribute('1990-04-18', piiKey, `${tenantId}:${intentId}:birth-date`)},
      ${encryptPrivateAttribute('01000000000', piiKey, `${tenantId}:${intentId}:phone`)},
      ${phoneHash}, 'skt', 'self-asserted', now(), 1)`;
  await sql`INSERT INTO wss_key_policy_versions
    (tenant_id, policy_version, recovery_requirement, default_adapter, allowed_adapters, manifest_digest, status)
    VALUES (${tenantId}, 1, 'sar-required', 'took-sar', '["took-sar"]'::jsonb,
      ${createHash('sha256').update('identity-smoke').digest('hex')}, 'draft')`;
  await sql`INSERT INTO wss_wallets
    (id, tenant_id, user_profile_id, key_policy_version, key_adapter, provisioning_origin,
      status, label, provisioning_idempotency_key)
    VALUES (${walletId}, ${tenantId}, ${profileId}, 1, 'took-sar', 'created', 'active', '검증 지갑', ${randomUUID()})`;
  await sql`INSERT INTO wss_wallet_accounts
    (id, tenant_id, wallet_id, chain_id, address_group_id, address_normalized, address_display)
    VALUES (${accountId}, ${tenantId}, ${walletId}, 'ethereum', 'evm', ${wallet.address.toLowerCase()}, ${wallet.address})`;

  const issued = await api('/v1/digital-identity/credentials', sessionToken, { holderDid, accepted: true });
  if (issued.status !== 201 || typeof issued.data.credential !== 'string') throw new Error(`Issuance failed: ${issued.status} ${issued.data.error}`);
  const credential = issued.data.credential;
  const opening = issued.data.opening as string;
  const summary = issued.data.summary as { credentialId: string; name: string; birthDate: string; connectedWallets: unknown[] };
  credentialId = summary.credentialId;
  if (summary.name !== '테스트사용자' || summary.birthDate !== '1990-04-18') throw new Error('Server source did not match verified profile.');

  const path = `/v1/digital-identity/credentials/${credentialId}`;
  const challenge = await api(`${path}/presentation-challenges`, sessionToken, {});
  if (challenge.status !== 201) throw new Error('Presentation challenge failed.');
  const holderSignature = sign(null, Buffer.from(challenge.data.message as string), holder.privateKey).toString('base64url');
  const vcPayload = JSON.parse(Buffer.from(credential.split('.')[1]!, 'base64url').toString('utf8')) as {
    vc: { credentialSubject: { identityCommitment: string } };
  };
  if (JSON.stringify(vcPayload).includes('테스트사용자') || JSON.stringify(vcPayload).includes('1990-04-18')) {
    throw new Error('The presentation credential contains raw name or birth date.');
  }
  const proof = await createIdentityEqualityProof({ credentialId, nonce: challenge.data.challengeId as string,
    commitment: vcPayload.vc.credentialSubject.identityCommitment, opening,
    expectedName: summary.name, expectedBirthDate: summary.birthDate });
  const verified = await api(`${path}/presentations`, sessionToken, {
    challengeId: challenge.data.challengeId, credential, holderSignature,
    expectedName: summary.name, expectedBirthDate: summary.birthDate, proof,
  });
  if (verified.status !== 200 || verified.data.verified !== true || verified.data.claimsMatched !== true) {
    throw new Error(`Signed credential and private equality proof verification failed: ${verified.status} ${JSON.stringify(verified.data)}`);
  }
  const replay = await api(`${path}/presentations`, sessionToken, {
    challengeId: challenge.data.challengeId, credential, holderSignature,
    expectedName: summary.name, expectedBirthDate: summary.birthDate, proof,
  });
  if (replay.status === 200) throw new Error('Presentation challenge replay was accepted.');

  const badChallenge = await api(`${path}/presentation-challenges`, sessionToken, {});
  const badSignature = sign(null, Buffer.from(badChallenge.data.message as string), holder.privateKey).toString('base64url');
  const badProof = await createIdentityEqualityProof({ credentialId, nonce: badChallenge.data.challengeId as string,
    commitment: vcPayload.vc.credentialSubject.identityCommitment, opening,
    expectedName: summary.name, expectedBirthDate: summary.birthDate });
  const tampered = await api(`${path}/presentations`, sessionToken, {
    challengeId: badChallenge.data.challengeId, credential: credential.slice(0, -2) + 'aa', holderSignature: badSignature,
    expectedName: summary.name, expectedBirthDate: summary.birthDate, proof: badProof,
  });
  if (tampered.status === 200) throw new Error('Tampered credential was accepted.');

  const mismatch = await api(`${path}/presentations`, sessionToken, {
    challengeId: badChallenge.data.challengeId, credential, holderSignature: badSignature,
    expectedName: '다른사람', expectedBirthDate: summary.birthDate, proof: badProof,
  });
  if (mismatch.status === 200) throw new Error('Mismatched name was accepted.');

  const bindingChallenge = await api(`${path}/wallet-challenges`, sessionToken, { walletId });
  if (bindingChallenge.status !== 201) throw new Error('Wallet challenge failed.');
  const bindingMessage = bindingChallenge.data.message as string;
  const binding = await api(`${path}/wallet-bindings`, sessionToken, {
    challengeId: bindingChallenge.data.challengeId,
    walletSignature: await wallet.signMessage(bindingMessage),
    holderSignature: sign(null, Buffer.from(bindingMessage), holder.privateKey).toString('base64url'),
  });
  if (binding.status !== 200 || (binding.data.connectedWallets as unknown[])?.length !== 1) {
    throw new Error(`Wallet binding failed: ${binding.status} ${binding.data.error}`);
  }
  console.log('Shinhan digital identity: OTP evidence gate, signed VC, private name/birth proof, replay/tamper/mismatch rejection, wallet binding passed.');
  const holdMs = Number(process.env.WSS_TEST_HOLD_MS || 0);
  if (holdMs > 0 && holdMs <= 180_000) {
    console.log(`Synthetic fixture available for ${holdMs} ms; it will be removed automatically.`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }
} catch (error) {
  console.error('Shinhan identity verification failed:', error);
  const diagnostic = await sql<{ issued_at: Date; expires_at: Date; updated_at: Date; status: string }[]>`
    SELECT credential.issued_at, credential.expires_at, attributes.updated_at, credential.status
    FROM wss_dev_identity_credentials credential
    JOIN wss_user_private_attributes attributes ON attributes.tenant_id = credential.tenant_id
      AND attributes.user_profile_id = credential.user_profile_id
    WHERE credential.tenant_id = ${tenantId} AND credential.user_profile_id = ${profileId}
  `;
  if (diagnostic[0]) console.error('Credential timing:', {
    issued: diagnostic[0].issued_at.toISOString(), expires: diagnostic[0].expires_at.toISOString(),
    sourceUpdated: diagnostic[0].updated_at.toISOString(), status: diagnostic[0].status,
  });
  throw error;
} finally {
  await sql`DELETE FROM wss_dev_identity_wallet_bindings WHERE tenant_id = ${tenantId}
    AND credential_id IN (SELECT id FROM wss_dev_identity_credentials WHERE tenant_id = ${tenantId} AND user_profile_id = ${profileId})`;
  await sql`DELETE FROM wss_dev_identity_challenges WHERE tenant_id = ${tenantId}
    AND credential_id IN (SELECT id FROM wss_dev_identity_credentials WHERE tenant_id = ${tenantId} AND user_profile_id = ${profileId})`;
  await sql`DELETE FROM wss_dev_identity_credentials WHERE tenant_id = ${tenantId} AND user_profile_id = ${profileId}`;
  await sql`DELETE FROM wss_wallet_accounts WHERE tenant_id = ${tenantId} AND id = ${accountId}`;
  await sql`DELETE FROM wss_wallets WHERE tenant_id = ${tenantId} AND id = ${walletId}`;
  await sql`DELETE FROM wss_key_policy_versions WHERE tenant_id = ${tenantId} AND manifest_digest = ${createHash('sha256').update('identity-smoke').digest('hex')}`;
  await sql`DELETE FROM wss_user_private_attributes WHERE tenant_id = ${tenantId} AND user_profile_id = ${profileId}`;
  await sql`DELETE FROM wss_registration_intents WHERE tenant_id = ${tenantId} AND id = ${intentId}`;
  await sql`DELETE FROM wss_external_identities WHERE tenant_id = ${tenantId} AND id = ${identityId}`;
  await sql`DELETE FROM wss_user_profiles WHERE tenant_id = ${tenantId} AND id = ${profileId}`;
  await sql.end();
}
