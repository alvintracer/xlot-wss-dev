import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  WSS_PROTOCOL_VERSION,
  MOBILE_CARRIER_CODES,
  isSecureSarWalletRegistration,
  isSecureSarWalletPayload,
  isRecord,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateRegistrationIntentRequest,
  type HostAuthenticationPurpose,
  type KeyAdapterId,
  type PrepareTransferRequest,
  type ProvisionWalletRequest,
  type SubmitTransferRequest,
  type TenantManifest,
  type WssRuntimeBootstrap,
} from '@took-wss/contracts';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';
import { issueSessionToken, verifySessionToken } from './sessionToken.js';
import {
  assertProofSession,
  issueSarKeyCoreProof,
  issueWalletAuthorizationProof,
  sarKeyCorePayloadHash,
  verifyHostProof,
} from './hostProof.js';
import { RegistrationError } from './phoneRegistration.js';
import { identityRegistrationProviders, walletProvisioningProviders, walletQueryProviders } from './walletQueryProviders.js';
import { getTransferSigningRequest, prepareTransfer, submitTransfer } from './transferService.js';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 4100);
const sessionSecret = requiredEnvironment('WSS_SESSION_SECRET', 'local-wss-session-secret-must-never-ship');
const subjectHashSecret = requiredEnvironment('WSS_SUBJECT_HASH_SECRET', 'local-wss-subject-hash-secret-must-never-ship');
const institutionApiKey = requiredEnvironment('WSS_INSTITUTION_API_KEY', 'local-wss-development-only');
const walletUrl = requiredEnvironment('WSS_WALLET_URL', 'http://localhost:5174');
const allowedOrigins = new Set((process.env.WSS_ALLOWED_ORIGINS || [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
].join(',')).split(',').map((value) => value.trim()).filter(Boolean));

const tenants = new Map<string, TenantManifest>([
  [kiwoomManifest.tenantId, kiwoomManifest],
  [referenceBankManifest.tenantId, referenceBankManifest],
]);

function requiredEnvironment(name: string, developmentFallback: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    if ((name === 'WSS_SESSION_SECRET' || name === 'WSS_SUBJECT_HASH_SECRET' || name === 'WSS_INSTITUTION_API_KEY') && value.length < 32) {
      throw new Error(`${name} must contain at least 32 characters.`);
    }
    return value;
  }
  if (isProduction) throw new Error(`${name} is required in production.`);
  return developmentFallback;
}

function setCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-wss-institution-key');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error('Request body too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function parseCreateSessionRequest(value: unknown): CreateSessionRequest {
  if (!isRecord(value)) throw new Error('Invalid session request.');
  if (typeof value.tenantId !== 'string' || typeof value.customerRef !== 'string') throw new Error('Tenant and customer reference are required.');
  if (value.customerRef.length < 3 || value.customerRef.length > 128) throw new Error('Invalid customer reference.');
  if (value.requestedKeyAdapter !== undefined && typeof value.requestedKeyAdapter !== 'string') throw new Error('Invalid key adapter.');
  return value as unknown as CreateSessionRequest;
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer session.');
  return authorization.slice('Bearer '.length);
}

function parseProvisionWalletRequest(value: unknown): ProvisionWalletRequest {
  if (!isRecord(value)
    || typeof value.idempotencyKey !== 'string'
    || value.idempotencyKey.length < 8
    || value.idempotencyKey.length > 128
    || (value.keyAdapter !== 'took-sar' && value.keyAdapter !== 'thirdweb-user-wallet' && value.keyAdapter !== 'fsl-mpc')
    || typeof value.recoverySetupAcknowledged !== 'boolean'
    || typeof value.hostAuthorizationProof !== 'string'
    || value.hostAuthorizationProof.length <= 20) {
    throw new Error('Invalid wallet provisioning request.');
  }
  if (!isRecord(value.source)) throw new Error('Invalid wallet provisioning source.');
  const source: ProvisionWalletRequest['source'] | null = value.source.type === 'new'
    ? { type: 'new' } as const
    : value.source.type === 'secure-new' && isSecureSarWalletRegistration(value.source)
      ? {
          type: 'secure-new' as const,
          secureProvisionRef: value.source.secureProvisionRef,
          addresses: value.source.addresses,
          recoveryEnvelopes: value.source.recoveryEnvelopes,
          recovery: value.source.recovery,
          keyCoreAttestationProof: value.source.keyCoreAttestationProof,
        }
    : value.source.type === 'secure-import'
      && (value.source.method === 'mnemonic' || value.source.method === 'private-key')
      && typeof value.source.secureImportRef === 'string'
      && value.source.secureImportRef.length >= 16
      && value.source.secureImportRef.length <= 256
        ? {
            type: 'secure-import' as const,
            method: value.source.method as 'mnemonic' | 'private-key',
            secureImportRef: value.source.secureImportRef,
          }
        : null;
  if (!source) throw new Error('Invalid secure wallet import reference.');
  return {
    idempotencyKey: value.idempotencyKey,
    keyAdapter: value.keyAdapter,
    recoverySetupAcknowledged: value.recoverySetupAcknowledged,
    hostAuthorizationProof: value.hostAuthorizationProof,
    source,
  };
}

function parseRegistrationIntentRequest(value: unknown): CreateRegistrationIntentRequest {
  if (!isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.birthDate !== 'string'
    || typeof value.phone !== 'string'
    || typeof value.carrierCode !== 'string'
    || !MOBILE_CARRIER_CODES.includes(value.carrierCode as (typeof MOBILE_CARRIER_CODES)[number])
    || typeof value.consentVersion !== 'string') {
    throw new RegistrationError('invalid_registration_request');
  }
  return value as unknown as CreateRegistrationIntentRequest;
}

function parsePrepareTransferRequest(value: unknown): PrepareTransferRequest {
  if (!isRecord(value)
    || typeof value.walletId !== 'string'
    || typeof value.assetId !== 'string'
    || typeof value.chainId !== 'string'
    || typeof value.recipient !== 'string'
    || typeof value.amountAtomic !== 'string'
    || value.channel !== 'address'
    || (value.destinationTag !== undefined && typeof value.destinationTag !== 'string')
    || (value.complianceReason !== undefined && typeof value.complianceReason !== 'string')) {
    throw new Error('invalid_transfer_request');
  }
  return value as unknown as PrepareTransferRequest;
}

function parseSubmitTransferRequest(value: unknown): SubmitTransferRequest {
  if (!isRecord(value)
    || typeof value.intentId !== 'string'
    || typeof value.signedTransaction !== 'string'
    || value.signedTransaction.length < 8
    || value.signedTransaction.length > 65_536
    || typeof value.hostAuthorizationProof !== 'string'
    || value.hostAuthorizationProof.length <= 20
    || typeof value.idempotencyKey !== 'string'
    || value.idempotencyKey.length < 8
    || value.idempotencyKey.length > 128) {
    throw new Error('invalid_transfer_submission');
  }
  return value as unknown as SubmitTransferRequest;
}

function sessionFromClaims(claims: ReturnType<typeof verifySessionToken>) {
  return {
    protocolVersion: claims.protocolVersion,
    sessionId: claims.sessionId,
    tenantId: claims.tenantId,
    subject: claims.subject,
    subjectVersion: claims.subjectVersion,
    keyAdapter: claims.keyAdapter,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  } as const;
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function requireDevelopmentHost(request: IncomingMessage): void {
  if (isProduction) throw new Error('Production host authorization provider required.');
  if (!isLoopbackRequest(request)) throw new Error('Development host origin required.');
  const providedKey = String(request.headers['x-wss-institution-key'] || '');
  if (!constantTimeEqual(providedKey, institutionApiKey)) throw new Error('Institution host authorization required.');
}

function parseHostAuthenticationPurpose(value: unknown): HostAuthenticationPurpose {
  if (!isRecord(value)
    || (value.purpose !== 'wallet-provisioning'
      && value.purpose !== 'transfer-approval'
      && value.purpose !== 'wallet-recovery')) {
    throw new Error('Invalid host authentication purpose.');
  }
  return value.purpose;
}

async function handleCreateSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const providedKey = String(request.headers['x-wss-institution-key'] || '');
  if (!constantTimeEqual(providedKey, institutionApiKey)) {
    sendJson(response, 401, { error: 'institution_auth_required' });
    return;
  }

  const body = parseCreateSessionRequest(await readJson(request));
  const manifest = tenants.get(body.tenantId);
  if (!manifest) {
    sendJson(response, 404, { error: 'tenant_not_found' });
    return;
  }
  const keyAdapter = (body.requestedKeyAdapter || manifest.keyManagement.defaultAdapter) as KeyAdapterId;
  if (!manifest.keyManagement.allowedAdapters.includes(keyAdapter)) {
    sendJson(response, 400, { error: 'key_adapter_not_allowed' });
    return;
  }

  const issued = issueSessionToken({
    tenantId: manifest.tenantId,
    customerRef: body.customerRef,
    keyAdapter,
    secret: sessionSecret,
    subjectHashSecret,
  });
  const result: CreateSessionResponse = {
    sessionToken: issued.token,
    expiresAt: new Date(issued.claims.expiresAt * 1000).toISOString(),
    walletUrl,
  };
  sendJson(response, 201, result);
}

async function handleBootstrap(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.keyManagement.allowedAdapters.includes(claims.keyAdapter)) {
    sendJson(response, 403, { error: 'session_policy_mismatch' });
    return;
  }
  const walletQueryProvider = walletQueryProviders.get(manifest.tenantId);
  if (!walletQueryProvider) {
    sendJson(response, 503, { error: 'wallet_query_provider_unavailable' });
    return;
  }
  if (isProduction && (walletQueryProvider.id === 'sandbox-wallet-provider'
    || walletQueryProvider.id === 'development-postgres-wallet-provider')) {
    sendJson(response, 503, { error: 'production_wallet_query_provider_required' });
    return;
  }
  const session = sessionFromClaims(claims);
  const identityProvider = identityRegistrationProviders.get(manifest.tenantId);
  if (!identityProvider) {
    sendJson(response, 503, { error: 'identity_provider_unavailable' });
    return;
  }
  const bootstrap: WssRuntimeBootstrap = {
    protocolVersion: WSS_PROTOCOL_VERSION,
    session,
    manifest,
    identity: await identityProvider.getIdentity({ session, manifest }),
    walletHome: await walletQueryProvider.getHome({ session, manifest }),
  };
  sendJson(response, 200, bootstrap);
}

async function handleIssueDevelopmentHostAuthorization(request: IncomingMessage, response: ServerResponse): Promise<void> {
  requireDevelopmentHost(request);
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const session = sessionFromClaims(claims);
  const purpose = parseHostAuthenticationPurpose(await readJson(request));
  const issued = issueWalletAuthorizationProof({ session, purpose, secret: sessionSecret });
  sendJson(response, 201, {
    status: 'authenticated',
    proof: issued.proof,
    expiresAt: new Date(issued.claims.expiresAt * 1000).toISOString(),
    method: 'development-reference-host',
  });
}

async function handleIssueDevelopmentSarAttestation(request: IncomingMessage, response: ServerResponse): Promise<void> {
  requireDevelopmentHost(request);
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const session = sessionFromClaims(claims);
  const body = await readJson(request);
  if (!isRecord(body) || !isSecureSarWalletPayload(body.registration)) {
    throw new Error('Invalid SAR key-core registration.');
  }
  const issued = issueSarKeyCoreProof({ session, payload: body.registration, secret: sessionSecret });
  sendJson(response, 201, {
    proof: issued.proof,
    expiresAt: new Date(issued.claims.expiresAt * 1000).toISOString(),
  });
}

async function handleProvisionWallet(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.keyManagement.allowedAdapters.includes(claims.keyAdapter)) {
    sendJson(response, 403, { error: 'session_policy_mismatch' });
    return;
  }
  const provider = walletProvisioningProviders.get(manifest.tenantId);
  if (!provider) {
    sendJson(response, 503, { error: 'wallet_provisioning_provider_unavailable' });
    return;
  }
  if (isProduction && (provider.id === 'sandbox-wallet-provider' || provider.id === 'development-postgres-wallet-provider')) {
    sendJson(response, 503, { error: 'production_wallet_provisioning_provider_required' });
    return;
  }
  const session = sessionFromClaims(claims);
  const provisionRequest = parseProvisionWalletRequest(await readJson(request));
  if (!manifest.keyManagement.allowedAdapters.includes(provisionRequest.keyAdapter)) {
    sendJson(response, 400, { error: 'key_adapter_not_allowed' });
    return;
  }
  if (provisionRequest.source.type === 'secure-import' && provisionRequest.keyAdapter !== 'took-sar') {
    sendJson(response, 400, { error: 'secure_import_requires_sar' });
    return;
  }
  if (provisionRequest.source.type === 'secure-new' && provisionRequest.keyAdapter !== 'took-sar') {
    sendJson(response, 400, { error: 'secure_sar_creation_requires_sar' });
    return;
  }
  const hostAuthorization = verifyHostProof(provisionRequest.hostAuthorizationProof, sessionSecret);
  assertProofSession(hostAuthorization, session);
  if (hostAuthorization.kind !== 'wallet-authorization' || hostAuthorization.purpose !== 'wallet-provisioning') {
    sendJson(response, 403, { error: 'wallet_authorization_required' });
    return;
  }
  let keyCoreAttestationId: string | undefined;
  if (provisionRequest.source.type === 'secure-new') {
    const keyCoreAttestation = verifyHostProof(provisionRequest.source.keyCoreAttestationProof, sessionSecret);
    assertProofSession(keyCoreAttestation, session);
    if (keyCoreAttestation.kind !== 'sar-key-core'
      || keyCoreAttestation.payloadHash !== sarKeyCorePayloadHash(provisionRequest.source)) {
      sendJson(response, 403, { error: 'key_core_attestation_required' });
      return;
    }
    keyCoreAttestationId = keyCoreAttestation.proofId;
  }
  const result = await provider.provision({
    session,
    manifest,
    request: provisionRequest,
    evidence: {
      hostAuthorizationId: hostAuthorization.proofId,
      ...(keyCoreAttestationId ? { keyCoreAttestationId } : {}),
    },
  });
  sendJson(response, 201, result);
}

async function handleWalletHome(request: IncomingMessage, response: ServerResponse, walletId: string): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest) {
    sendJson(response, 403, { error: 'session_policy_mismatch' });
    return;
  }
  if (walletId.length < 8 || walletId.length > 160) {
    sendJson(response, 400, { error: 'invalid_wallet_id' });
    return;
  }
  const provider = walletQueryProviders.get(manifest.tenantId);
  if (!provider) {
    sendJson(response, 503, { error: 'wallet_query_provider_unavailable' });
    return;
  }
  if (isProduction && (provider.id === 'sandbox-wallet-provider'
    || provider.id === 'development-postgres-wallet-provider')) {
    sendJson(response, 503, { error: 'production_wallet_query_provider_required' });
    return;
  }
  const session = sessionFromClaims(claims);
  sendJson(response, 200, await provider.getHome({ session, manifest, walletId }));
}

async function handlePrepareTransfer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.enabledModules.includes('send-receive') || !manifest.enabledModules.includes('kyt')) {
    sendJson(response, 403, { error: 'transfer_policy_mismatch' });
    return;
  }
  const provider = walletQueryProviders.get(manifest.tenantId);
  if (!provider) {
    sendJson(response, 503, { error: 'wallet_query_provider_unavailable' });
    return;
  }
  const session = sessionFromClaims(claims);
  const transferRequest = parsePrepareTransferRequest(await readJson(request));
  const home = await provider.getHome({ session, manifest, walletId: transferRequest.walletId });
  if (home.status !== 'ready') {
    sendJson(response, 404, { error: 'wallet_not_found' });
    return;
  }
  sendJson(response, 201, await prepareTransfer({ session, home, request: transferRequest }));
}

async function handleSubmitTransfer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.enabledModules.includes('send-receive')) {
    sendJson(response, 403, { error: 'transfer_policy_mismatch' });
    return;
  }
  const session = sessionFromClaims(claims);
  const submission = parseSubmitTransferRequest(await readJson(request));
  const authorization = verifyHostProof(submission.hostAuthorizationProof, sessionSecret);
  assertProofSession(authorization, session);
  if (authorization.kind !== 'wallet-authorization' || authorization.purpose !== 'transfer-approval') {
    sendJson(response, 403, { error: 'transfer_authorization_required' });
    return;
  }
  sendJson(response, 202, await submitTransfer({
    session,
    request: submission,
    authorizationId: authorization.proofId,
  }));
}

async function handleTransferApprovalPayload(request: IncomingMessage, response: ServerResponse, intentId: string): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.enabledModules.includes('send-receive')) {
    sendJson(response, 403, { error: 'transfer_policy_mismatch' });
    return;
  }
  if (intentId.length < 8 || intentId.length > 160) {
    sendJson(response, 400, { error: 'invalid_transfer_intent' });
    return;
  }
  sendJson(response, 200, getTransferSigningRequest({ session: sessionFromClaims(claims), intentId }));
}

async function identityContext(request: IncomingMessage) {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest) throw new RegistrationError('session_policy_mismatch');
  const provider = identityRegistrationProviders.get(manifest.tenantId);
  if (!provider) throw new RegistrationError('identity_provider_unavailable');
  if (isProduction && provider.id === 'development-postgres-wallet-provider') {
    throw new RegistrationError('production_identity_provider_required');
  }
  return { session: sessionFromClaims(claims), manifest, provider };
}

async function handleCreateRegistrationIntent(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const context = await identityContext(request);
  const result = await context.provider.createRegistrationIntent({
    session: context.session,
    manifest: context.manifest,
    request: parseRegistrationIntentRequest(await readJson(request)),
  });
  sendJson(response, 201, result);
}

async function handleCreatePhoneChallenge(
  request: IncomingMessage,
  response: ServerResponse,
  registrationIntentId: string,
): Promise<void> {
  const context = await identityContext(request);
  const result = await context.provider.createPhoneChallenge({
    session: context.session,
    manifest: context.manifest,
    registrationIntentId,
  });
  if (!isLoopbackRequest(request)) delete result.developmentCode;
  sendJson(response, 201, result);
}

async function handleVerifyPhoneChallenge(
  request: IncomingMessage,
  response: ServerResponse,
  registrationIntentId: string,
  challengeId: string,
): Promise<void> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.code !== 'string') throw new RegistrationError('invalid_verification_code');
  const context = await identityContext(request);
  const result = await context.provider.verifyPhoneChallenge({
    session: context.session,
    manifest: context.manifest,
    registrationIntentId,
    challengeId,
    code: body.code,
  });
  sendJson(response, 200, result);
}

const server = createServer(async (request, response) => {
  if (!setCors(request, response)) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'took-wss-institution-bff' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/sessions') {
      await handleCreateSession(request, response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/runtime/bootstrap') {
      await handleBootstrap(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/development/host-authorizations') {
      await handleIssueDevelopmentHostAuthorization(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/development/sar-key-core-attestations') {
      await handleIssueDevelopmentSarAttestation(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/registration/intents') {
      await handleCreateRegistrationIntent(request, response);
      return;
    }
    const challengeMatch = url.pathname.match(/^\/v1\/registration\/intents\/([^/]+)\/challenges$/);
    if (request.method === 'POST' && challengeMatch) {
      await handleCreatePhoneChallenge(request, response, decodeURIComponent(challengeMatch[1]!));
      return;
    }
    const verificationMatch = url.pathname.match(/^\/v1\/registration\/intents\/([^/]+)\/challenges\/([^/]+)\/verify$/);
    if (request.method === 'POST' && verificationMatch) {
      await handleVerifyPhoneChallenge(
        request,
        response,
        decodeURIComponent(verificationMatch[1]!),
        decodeURIComponent(verificationMatch[2]!),
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/wallets/provision') {
      await handleProvisionWallet(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers/prepare') {
      await handlePrepareTransfer(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers/submit') {
      await handleSubmitTransfer(request, response);
      return;
    }
    const transferApprovalMatch = url.pathname.match(/^\/v1\/transfers\/([^/]+)\/approval-payload$/);
    if (request.method === 'GET' && transferApprovalMatch) {
      await handleTransferApprovalPayload(request, response, decodeURIComponent(transferApprovalMatch[1]!));
      return;
    }
    const walletHomeMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/home$/);
    if (request.method === 'GET' && walletHomeMatch) {
      await handleWalletHome(request, response, decodeURIComponent(walletHomeMatch[1]!));
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof RegistrationError) {
      const status = error.code.includes('rate_limited') ? 429
        : error.code.includes('not_found') ? 404
          : error.code.includes('required') || error.code.includes('policy_mismatch') ? 403
            : 400;
      sendJson(response, status, { error: error.code });
      return;
    }
    const status = message.includes('session') || message.includes('token') || message.includes('expired') ? 401 : 400;
    sendJson(response, status, { error: 'request_rejected' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`took WSS Institution BFF listening on http://127.0.0.1:${port}`);
});
