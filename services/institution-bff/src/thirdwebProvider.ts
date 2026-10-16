import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'ethers';

interface ThirdwebProject {
  clientId: string;
  secretKey: string;
}

interface VerificationSecrets {
  challengeSecret: string;
  subjectHashSecret: string;
}

interface ChallengeClaims {
  version: 1;
  tenantId: string;
  sessionId: string;
  address: string;
  existingWalletId?: string;
  nonce: string;
  expiresAt: number;
}

function projectForTenant(tenantId: string): ThirdwebProject | null {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(tenantId)) return null;
  const namespace = `WSS_THIRDWEB_${tenantId.replace(/-/g, '_').toUpperCase()}`;
  const tenantClientId = process.env[`${namespace}_CLIENT_ID`]?.trim();
  const tenantSecretKey = process.env[`${namespace}_SECRET_KEY`]?.trim();
  const hasTenantOverride = Boolean(tenantClientId || tenantSecretKey);
  const clientId = hasTenantOverride ? tenantClientId : process.env.WSS_THIRDWEB_CLIENT_ID?.trim();
  const secretKey = hasTenantOverride ? tenantSecretKey : process.env.WSS_THIRDWEB_CLIENT_SECRET?.trim();
  if (!clientId || !secretKey || !/^[A-Za-z0-9_-]{8,160}$/.test(clientId)) return null;
  return { clientId, secretKey };
}

export function thirdwebClientIdForTenant(tenantId: string): string | undefined {
  return projectForTenant(tenantId)?.clientId;
}

function challengeMessage(claims: ChallengeClaims): string {
  return [
    'Took Institutional Wallet',
    'Thirdweb wallet connection',
    `Institution: ${claims.tenantId}`,
    `Session: ${claims.sessionId}`,
    `Address: ${claims.address}`,
    `Wallet: ${claims.existingWalletId ?? 'new'}`,
    `Nonce: ${claims.nonce}`,
    `Expires: ${new Date(claims.expiresAt).toISOString()}`,
  ].join('\n');
}

export function issueThirdwebWalletChallenge(input: {
  tenantId: string;
  sessionId: string;
  address: string;
  existingWalletId?: string;
}, challengeSecret: string): { challenge: string; message: string; expiresAt: string } {
  const project = projectForTenant(input.tenantId);
  if (!project || challengeSecret.length < 32) throw new Error('thirdweb_not_configured');
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.address)) throw new Error('provider_address_invalid');
  if (input.existingWalletId && !/^[0-9a-f-]{36}$/i.test(input.existingWalletId)) throw new Error('provider_wallet_not_found');
  const claims: ChallengeClaims = {
    version: 1, tenantId: input.tenantId, sessionId: input.sessionId,
    address: input.address.toLowerCase(),
    ...(input.existingWalletId ? { existingWalletId: input.existingWalletId } : {}),
    nonce: randomUUID(), expiresAt: Date.now() + 2 * 60_000,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const mac = createHmac('sha256', challengeSecret)
    .update(`wss-thirdweb-challenge:v1:${payload}`).digest('base64url');
  return {
    challenge: `${payload}.${mac}`,
    message: challengeMessage(claims),
    expiresAt: new Date(claims.expiresAt).toISOString(),
  };
}

export interface VerifiedThirdwebAccount {
  subjectHash: string;
  address: string;
}

export async function verifyThirdwebWalletProof(input: {
  tenantId: string;
  sessionId: string;
  address: string;
  existingWalletId?: string;
  challenge: string;
  signature: string;
}, secrets: VerificationSecrets, request: typeof fetch = fetch): Promise<VerifiedThirdwebAccount> {
  const project = projectForTenant(input.tenantId);
  if (!project || secrets.challengeSecret.length < 32 || secrets.subjectHashSecret.length < 32) {
    throw new Error('thirdweb_not_configured');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.address)
    || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)
    || input.challenge.length > 2048) throw new Error('provider_proof_invalid');
  const [payload, suppliedMac, extra] = input.challenge.split('.');
  if (!payload || !suppliedMac || extra || !/^[A-Za-z0-9_-]+$/.test(payload)
    || !/^[A-Za-z0-9_-]+$/.test(suppliedMac)) throw new Error('provider_proof_invalid');
  const expectedMac = createHmac('sha256', secrets.challengeSecret)
    .update(`wss-thirdweb-challenge:v1:${payload}`).digest('base64url');
  const left = Buffer.from(suppliedMac);
  const right = Buffer.from(expectedMac);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('provider_proof_invalid');
  let claims: ChallengeClaims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ChallengeClaims; }
  catch { throw new Error('provider_proof_invalid'); }
  if (claims.version !== 1 || claims.tenantId !== input.tenantId
    || claims.sessionId !== input.sessionId
    || claims.address !== input.address.toLowerCase()
    || claims.existingWalletId !== input.existingWalletId
    || typeof claims.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.nonce)
    || !Number.isFinite(claims.expiresAt)
    || claims.expiresAt < Date.now()
    || claims.expiresAt > Date.now() + 2 * 60_000) throw new Error('provider_proof_invalid');
  try {
    if (verifyMessage(challengeMessage(claims), input.signature).toLowerCase() !== claims.address) {
      throw new Error('provider_proof_invalid');
    }
  } catch { throw new Error('provider_proof_invalid'); }

  const url = new URL('https://api.thirdweb.com/v1/wallets/user');
  url.searchParams.set('address', input.address);
  const response = await request(url, {
    method: 'GET',
    headers: { 'x-secret-key': project.secretKey, 'Cache-Control': 'no-store' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('thirdweb_auth_failed');
  const body = await response.json() as {
    result?: { wallets?: {
      userId?: unknown; address?: unknown;
      profiles?: { type?: unknown; emailVerified?: unknown }[];
    }[] };
  };
  const account = body?.result?.wallets?.find((wallet) =>
    typeof wallet.address === 'string' && wallet.address.toLowerCase() === claims.address);
  if (!account || typeof account.userId !== 'string' || account.userId.length < 1
    || !Array.isArray(account.profiles)
    || !account.profiles.some((profile) => (profile.type === 'email' && profile.emailVerified === true)
      || profile.type === 'google' || profile.type === 'apple')) {
    throw new Error('thirdweb_identity_mismatch');
  }
  return {
    subjectHash: createHmac('sha256', secrets.subjectHashSecret)
      .update(`wss-thirdweb-user:v1:${input.tenantId}\u0000${project.clientId}\u0000${account.userId}`).digest('hex'),
    address: input.address,
  };
}
