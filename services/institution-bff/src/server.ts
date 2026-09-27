import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  WSS_PROTOCOL_VERSION,
  isSecureSarWalletRegistration,
  isRecord,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type KeyAdapterId,
  type ProvisionWalletRequest,
  type TenantManifest,
  type WssRuntimeBootstrap,
} from '@took-wss/contracts';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';
import { issueSessionToken, verifySessionToken } from './sessionToken.js';
import { walletProvisioningProviders, walletQueryProviders } from './walletQueryProviders.js';

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
    || typeof value.recoverySetupAcknowledged !== 'boolean') {
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
    source,
  };
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
  const session = {
    protocolVersion: claims.protocolVersion,
    sessionId: claims.sessionId,
    tenantId: claims.tenantId,
    subject: claims.subject,
    subjectVersion: claims.subjectVersion,
    keyAdapter: claims.keyAdapter,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  } as const;
  const bootstrap: WssRuntimeBootstrap = {
    protocolVersion: WSS_PROTOCOL_VERSION,
    session,
    manifest,
    walletHome: await walletQueryProvider.getHome({ session, manifest }),
  };
  sendJson(response, 200, bootstrap);
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
  const session = {
    protocolVersion: claims.protocolVersion,
    sessionId: claims.sessionId,
    tenantId: claims.tenantId,
    subject: claims.subject,
    subjectVersion: claims.subjectVersion,
    keyAdapter: claims.keyAdapter,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  } as const;
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
  const result = await provider.provision({
    session,
    manifest,
    request: provisionRequest,
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
  const session = {
    protocolVersion: claims.protocolVersion,
    sessionId: claims.sessionId,
    tenantId: claims.tenantId,
    subject: claims.subject,
    subjectVersion: claims.subjectVersion,
    keyAdapter: claims.keyAdapter,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  } as const;
  sendJson(response, 200, await provider.getHome({ session, manifest, walletId }));
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
    if (request.method === 'POST' && url.pathname === '/v1/wallets/provision') {
      await handleProvisionWallet(request, response);
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
    const status = message.includes('session') || message.includes('token') || message.includes('expired') ? 401 : 400;
    sendJson(response, status, { error: 'request_rejected' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`took WSS Institution BFF listening on http://127.0.0.1:${port}`);
});
