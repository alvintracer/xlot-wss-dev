import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  WSS_PROTOCOL_VERSION,
  MOBILE_CARRIER_CODES,
  isSecureSarWalletRegistration,
  isSecureSarWalletImportRegistration,
  isSecureSarWalletPayload,
  isRecord,
  normalizeWalletLabel,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateRegistrationIntentRequest,
  type HostAuthenticationPurpose,
  type KeyAdapterId,
  type PrepareExchangeRequest,
  type PrepareTransferRequest,
  type ProvisionWalletRequest,
  type RequestExchangeQuote,
  type SubmitExchangeRequest,
  type SubmitTransferRequest,
  type TenantManifest,
  type WssRuntimeBootstrap,
} from '@took-wss/contracts';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { jbManifest } from '@took-wss/tenant-jb';
import { namuManifest } from '@took-wss/tenant-namu';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';
import { issueSessionToken, verifySessionToken } from './sessionToken.js';
import { resolveAppPreviewIdentity } from './appPreviewIdentity.js';
import {
  assertProofSession,
  issueSarKeyCoreProof,
  issueWalletAuthorizationProof,
  sarKeyCorePayloadHash,
  verifyHostProof,
} from './hostProof.js';
import { RegistrationError } from './phoneRegistration.js';
import { PhoneClaimError, assertInstitutionClaimPhone, getPhoneClaimInfo, requestPhoneClaimOtp, submitPhoneClaim } from './phoneEscrowClaimService.js';
import { retryPhoneEscrowNotification } from './phoneEscrowService.js';
import { getPhoneRefundSigningRequest, getPhoneRefundStatus, preparePhoneRefund, submitPhoneRefund } from './phoneEscrowRefundService.js';
import { identityRegistrationProviders, walletProvisioningProviders, walletQueryProviders } from './walletQueryProviders.js';
import { getPhoneEscrowQuote, getTransferSigningRequest, getTransferStatus, listWalletTransferActivity, prepareTransfer, prepareTransferRelayForHost, submitTransfer } from './transferService.js';
import { assertQrPaymentMatches, bindQrPaymentIntent, createQrPaymentRequest, getQrPaymentRequest, listQrPaymentRequests, listSpentQrPayments, markQrPaymentSubmitted } from './qrPaymentService.js';
import { assertOwnedWalletAddress, verifyOwnedWalletDestination } from './ownedWalletTransfer.js';
import { publicTransferPreparationError } from './transferErrors.js';
import { publicWalletProvisioningError } from './walletProvisioningErrors.js';
import { WalletRemovalError, WalletRenameError } from './databaseWalletProvider.js';
import { issueThirdwebWalletChallenge, thirdwebClientIdForTenant, verifyThirdwebWalletProof } from './thirdwebProvider.js';
import {
  SarVaultError,
  loadSarVaultShares,
  sarVaultStatus,
  startSarVaultChallenge,
  storeSarVaultShares,
  verifySarVaultFactor,
} from './sarVaultService.js';
import {
  SarVaultV2Error,
  loadSarVaultV2FactorShare,
  loadSarVaultV2PasswordShare,
  sarVaultV2Status,
  startSarVaultV2Challenge,
  storeSarVaultV2Share,
  verifySarVaultV2Factor,
} from './sarVaultV2Service.js';
import {
  getExchangeSigningRequest,
  getExchangeStatus,
  prepareExchange,
  requestExchangeQuote,
  submitExchange,
} from './exchangeService.js';

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopmentPreview = process.env.WSS_DEPLOYMENT_MODE === 'development-preview';
const port = Number(process.env.PORT || 4100);
const sessionSecret = requiredEnvironment('WSS_SESSION_SECRET', 'local-wss-session-secret-must-never-ship');
const subjectHashSecret = requiredEnvironment('WSS_SUBJECT_HASH_SECRET', 'local-wss-subject-hash-secret-must-never-ship');
const institutionApiKey = requiredEnvironment('WSS_INSTITUTION_API_KEY', 'local-wss-development-only');
const configuredWalletUrl = process.env.WSS_WALLET_URL?.trim();
const previewAccessCode = process.env.WSS_PREVIEW_ACCESS_CODE?.trim() || '';
if (isDevelopmentPreview && previewAccessCode.length < 12) {
  throw new Error('WSS_PREVIEW_ACCESS_CODE must contain at least 12 characters in development-preview mode.');
}
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
  [jbManifest.tenantId, jbManifest],
  [namuManifest.tenantId, namuManifest],
  [referenceBankManifest.tenantId, referenceBankManifest],
]);
const appPreviewTenants = new Map<string, TenantManifest>([
  [kiwoomManifest.tenantId, kiwoomManifest],
  [jbManifest.tenantId, jbManifest],
  [namuManifest.tenantId, namuManifest],
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
  if (!allowedOrigins.has(origin) && origin !== requestPublicOrigin(request)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-wss-institution-key,x-wss-preview-code');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  return true;
}

function firstForwardedHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim() || '';
}

function requestPublicOrigin(request: IncomingMessage): string | null {
  const forwardedProtocol = firstForwardedHeader(request.headers['x-forwarded-proto']);
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? forwardedProtocol
    : 'http';
  const host = firstForwardedHeader(request.headers['x-forwarded-host'])
    || firstForwardedHeader(request.headers.host);
  if (!host || !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) return null;
  return `${protocol}://${host}`;
}

function walletUrlForRequest(request: IncomingMessage, manifest: TenantManifest): string {
  if (isDevelopmentPreview) {
    const origin = requestPublicOrigin(request);
    if (!origin) throw new Error('Preview wallet origin is unavailable.');
    return `${origin}/${manifest.tenantId}/wallet`;
  }
  if (configuredWalletUrl) return configuredWalletUrl;
  if (isProduction) throw new Error('WSS_WALLET_URL is required in production.');
  return 'http://localhost:5174';
}

function isSameOriginRequest(request: IncomingMessage): boolean {
  return Boolean(request.headers.origin && request.headers.origin === requestPublicOrigin(request));
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

function isSessionAuthenticationError(message: string): boolean {
  return message === 'Missing bearer session.'
    || message === 'Malformed session token.'
    || message === 'Invalid session signature.'
    || message === 'Unsupported session token.'
    || message === 'Unsupported session protocol.'
    || message === 'Session expired.'
    || message === 'Session issued in the future.';
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
  const label = value.label === undefined ? undefined : normalizeWalletLabel(value.label);
  if (value.label !== undefined && !label) throw new WalletRenameError('invalid_wallet_label', 422);
  const source: ProvisionWalletRequest['source'] | null = value.source.type === 'new'
    ? { type: 'new' } as const
    : value.source.type === 'provider-auth'
      && typeof value.source.address === 'string'
      && /^0x[0-9a-fA-F]{40}$/.test(value.source.address)
      && typeof value.source.challenge === 'string'
      && value.source.challenge.length >= 40
      && value.source.challenge.length <= 2048
      && typeof value.source.signature === 'string'
      && /^0x[0-9a-fA-F]{130}$/.test(value.source.signature)
      && (value.source.existingWalletId === undefined
        || (typeof value.source.existingWalletId === 'string' && /^[0-9a-f-]{36}$/i.test(value.source.existingWalletId)))
      ? {
          type: 'provider-auth', address: value.source.address,
          challenge: value.source.challenge, signature: value.source.signature,
          ...(value.source.existingWalletId ? { existingWalletId: value.source.existingWalletId } : {}),
        }
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
      && isSecureSarWalletImportRegistration(value.source)
        ? {
            type: 'secure-import' as const,
            method: value.source.method as 'mnemonic' | 'private-key',
            secureImportRef: value.source.secureImportRef,
            addresses: value.source.addresses,
            recoveryEnvelopes: value.source.recoveryEnvelopes,
            recovery: value.source.recovery,
            keyCoreAttestationProof: value.source.keyCoreAttestationProof,
          }
        : null;
  if (!source) throw new Error('Invalid secure wallet import reference.');
  return {
    idempotencyKey: value.idempotencyKey,
    keyAdapter: value.keyAdapter,
    ...(label ? { label } : {}),
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
    || (value.channel !== 'address' && value.channel !== 'phone')
    || (value.destinationWalletId !== undefined && (typeof value.destinationWalletId !== 'string' || !/^[0-9a-z-]{8,160}$/i.test(value.destinationWalletId)))
    || (value.destinationTag !== undefined && typeof value.destinationTag !== 'string')
    || (value.paymentRequestId !== undefined && (typeof value.paymentRequestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.paymentRequestId)))
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

function parseExchangeQuoteRequest(value: unknown): RequestExchangeQuote {
  if (!isRecord(value)
    || typeof value.walletId !== 'string'
    || typeof value.chainId !== 'string'
    || typeof value.sellAssetId !== 'string'
    || typeof value.buyAssetId !== 'string'
    || value.sellAssetId === value.buyAssetId
    || (value.mode !== 'exact-in' && value.mode !== 'exact-out')
    || typeof value.amountAtomic !== 'string'
    || !/^\d+$/.test(value.amountAtomic)) {
    throw new Error('invalid_exchange_quote_request');
  }
  return value as unknown as RequestExchangeQuote;
}

function parsePrepareExchangeRequest(value: unknown): PrepareExchangeRequest {
  if (!isRecord(value) || typeof value.quoteId !== 'string' || value.quoteId.length < 8 || value.quoteId.length > 160) {
    throw new Error('invalid_exchange_prepare_request');
  }
  return { quoteId: value.quoteId };
}

function parseSubmitExchangeRequest(value: unknown): SubmitExchangeRequest {
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
    throw new Error('invalid_exchange_submission');
  }
  return value as unknown as SubmitExchangeRequest;
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
  if (isDevelopmentPreview) {
    if (!isSameOriginRequest(request)) throw new Error('Development preview host origin required.');
    return;
  }
  if (isProduction) throw new Error('Production host authorization provider required.');
  if (!isLoopbackRequest(request)) throw new Error('Development host origin required.');
  const providedKey = String(request.headers['x-wss-institution-key'] || '');
  if (!constantTimeEqual(providedKey, institutionApiKey)) throw new Error('Institution host authorization required.');
}

function parseHostAuthenticationPurpose(value: unknown): HostAuthenticationPurpose {
  if (!isRecord(value)
    || (value.purpose !== 'wallet-provisioning'
      && value.purpose !== 'transfer-approval'
      && value.purpose !== 'exchange-approval'
      && value.purpose !== 'wallet-recovery'
      && value.purpose !== 'wallet-removal')) {
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
    walletUrl: walletUrlForRequest(request, manifest),
  };
  sendJson(response, 201, result);
}

async function handleCreateDevelopmentPreviewSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isDevelopmentPreview || !isSameOriginRequest(request)) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  const providedCode = String(request.headers['x-wss-preview-code'] || '');
  if (!constantTimeEqual(providedCode, previewAccessCode)) {
    sendJson(response, 401, { error: 'preview_access_denied' });
    return;
  }
  const body = parseCreateSessionRequest(await readJson(request));
  const manifest = appPreviewTenants.get(body.tenantId);
  if (!manifest) {
    sendJson(response, 403, { error: 'preview_tenant_not_allowed' });
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
    walletUrl: walletUrlForRequest(request, manifest),
  };
  sendJson(response, 201, result);
}

async function handleCreateAppPreviewSession(request: IncomingMessage, response: ServerResponse, manifest: TenantManifest): Promise<void> {
  const origin = requestPublicOrigin(request);
  if (!isDevelopmentPreview || !isSameOriginRequest(request) || !origin?.startsWith('https://')) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  const identity = resolveAppPreviewIdentity(request.headers.cookie, subjectHashSecret);
  const issued = issueSessionToken({
    tenantId: manifest.tenantId,
    customerRef: identity.customerRef,
    keyAdapter: manifest.keyManagement.defaultAdapter,
    secret: sessionSecret,
    subjectHashSecret,
  });
  if (identity.setCookie) response.setHeader('Set-Cookie', identity.setCookie);
  const result: CreateSessionResponse = {
    sessionToken: issued.token,
    expiresAt: new Date(issued.claims.expiresAt * 1000).toISOString(),
    walletUrl: walletUrlForRequest(request, manifest),
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
  if (isProduction && !isDevelopmentPreview && (walletQueryProvider.id === 'sandbox-wallet-provider'
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
    publicProviders: {
      ...(thirdwebClientIdForTenant(manifest.tenantId)
        ? { thirdwebClientId: thirdwebClientIdForTenant(manifest.tenantId) }
        : {}),
    },
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
  if (isProduction && !isDevelopmentPreview && (provider.id === 'sandbox-wallet-provider' || provider.id === 'development-postgres-wallet-provider')) {
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
  if (provisionRequest.keyAdapter === 'thirdweb-user-wallet'
    && provisionRequest.source.type !== 'provider-auth') {
    sendJson(response, 400, { error: 'provider_auth_required' });
    return;
  }
  if (provisionRequest.source.type === 'provider-auth'
    && provisionRequest.keyAdapter !== 'thirdweb-user-wallet') {
    sendJson(response, 400, { error: 'provider_auth_policy_mismatch' });
    return;
  }
  let hostAuthorization: ReturnType<typeof verifyHostProof>;
  try {
    hostAuthorization = verifyHostProof(provisionRequest.hostAuthorizationProof, sessionSecret);
  } catch (error) {
    if (error instanceof Error && error.message === 'Host proof expired.') {
      throw new Error('wallet_authorization_expired');
    }
    throw error;
  }
  assertProofSession(hostAuthorization, session);
  if (hostAuthorization.kind !== 'wallet-authorization' || hostAuthorization.purpose !== 'wallet-provisioning') {
    sendJson(response, 403, { error: 'wallet_authorization_required' });
    return;
  }
  let keyCoreAttestationId: string | undefined;
  if (provisionRequest.source.type === 'secure-new' || provisionRequest.source.type === 'secure-import') {
    let keyCoreAttestation: ReturnType<typeof verifyHostProof>;
    try {
      keyCoreAttestation = verifyHostProof(provisionRequest.source.keyCoreAttestationProof, sessionSecret);
    } catch (error) {
      if (error instanceof Error && error.message === 'Host proof expired.') {
        throw new Error('wallet_import_proof_expired');
      }
      throw error;
    }
    assertProofSession(keyCoreAttestation, session);
    const attestedPayload = provisionRequest.source.type === 'secure-new'
      ? provisionRequest.source
      : { ...provisionRequest.source, secureProvisionRef: provisionRequest.source.secureImportRef };
    if (keyCoreAttestation.kind !== 'sar-key-core'
      || keyCoreAttestation.payloadHash !== sarKeyCorePayloadHash(attestedPayload)) {
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
      ...(provisionRequest.source.type === 'provider-auth'
        ? { providerAccount: await verifyThirdwebWalletProof({
          tenantId: manifest.tenantId,
          sessionId: session.sessionId,
          address: provisionRequest.source.address,
          existingWalletId: provisionRequest.source.existingWalletId,
          challenge: provisionRequest.source.challenge,
          signature: provisionRequest.source.signature,
        }, { challengeSecret: sessionSecret, subjectHashSecret }) }
        : {}),
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
  if (isProduction && !isDevelopmentPreview && (provider.id === 'sandbox-wallet-provider'
    || provider.id === 'development-postgres-wallet-provider')) {
    sendJson(response, 503, { error: 'production_wallet_query_provider_required' });
    return;
  }
  const session = sessionFromClaims(claims);
  sendJson(response, 200, await provider.getHome({ session, manifest, walletId }));
}

async function handleIssueProviderChallenge(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  const identityProvider = manifest ? identityRegistrationProviders.get(manifest.tenantId) : null;
  if (!manifest || !identityProvider || !thirdwebClientIdForTenant(manifest.tenantId)) {
    sendJson(response, 503, { error: 'thirdweb_not_configured' });
    return;
  }
  const session = sessionFromClaims(claims);
  if ((await identityProvider.getIdentity({ session, manifest })).status !== 'established') {
    sendJson(response, 403, { error: 'identity_registration_required' });
    return;
  }
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.address !== 'string'
    || !/^0x[0-9a-fA-F]{40}$/.test(body.address)
    || (body.existingWalletId !== undefined
      && (typeof body.existingWalletId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.existingWalletId)))) {
    sendJson(response, 400, { error: 'provider_address_invalid' });
    return;
  }
  sendJson(response, 201, issueThirdwebWalletChallenge({
    tenantId: manifest.tenantId, sessionId: session.sessionId,
    address: body.address,
    ...(body.existingWalletId ? { existingWalletId: body.existingWalletId } : {}),
  }, sessionSecret));
}

async function handleVerifyProviderWallet(request: IncomingMessage, response: ServerResponse, walletId: string): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  const provider = manifest ? walletQueryProviders.get(manifest.tenantId) : null;
  if (!manifest || !provider?.verifyProviderWallet || !/^[0-9a-f-]{36}$/i.test(walletId)) {
    sendJson(response, 403, { error: 'provider_wallet_unavailable' });
    return;
  }
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.challenge !== 'string' || body.challenge.length < 40
    || body.challenge.length > 2048 || typeof body.signature !== 'string'
    || !/^0x[0-9a-fA-F]{130}$/.test(body.signature) || typeof body.address !== 'string'
    || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
    sendJson(response, 400, { error: 'provider_auth_required' });
    return;
  }
  const account = await verifyThirdwebWalletProof({
    tenantId: manifest.tenantId, sessionId: claims.sessionId,
    address: body.address, existingWalletId: walletId,
    challenge: body.challenge, signature: body.signature,
  }, { challengeSecret: sessionSecret, subjectHashSecret });
  const verified = await provider.verifyProviderWallet({
    session: sessionFromClaims(claims), manifest, walletId, account,
  });
  if (!verified) {
    sendJson(response, 403, { error: 'provider_wallet_link_conflict' });
    return;
  }
  sendJson(response, 200, { verified: true, address: account.address });
}

async function handlePrepareTransfer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const startedAt = Date.now();
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
  const ownedDestination = await verifyOwnedWalletDestination({
    provider, session, manifest, request: transferRequest,
  });
  await assertQrPaymentMatches(transferRequest);
  const prepared = await prepareTransfer({ session, home, request: transferRequest, ownedDestination });
  if (transferRequest.paymentRequestId) {
    if (prepared.compliance.status === 'allow') {
      if (!prepared.signingRequest) throw new Error('payment_request_unavailable');
      await bindQrPaymentIntent({ session, paymentRequestId: transferRequest.paymentRequestId,
        intentId: prepared.intentId, expiresAt: prepared.expiresAt });
    }
  }
  if (transferRequest.paymentRequestId) console.info('wss_qr_prepare', {
    paymentRequestId: transferRequest.paymentRequestId,
    complianceTraceId: prepared.compliance.traceId ?? null,
    complianceStatus: prepared.compliance.status,
    durationMs: Date.now() - startedAt,
  });
  sendJson(response, 201, prepared);
}

async function handlePhoneEscrowQuote(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  const provider = manifest ? walletQueryProviders.get(manifest.tenantId) : null;
  if (!manifest?.enabledModules.includes('send-receive') || !provider) throw new Error('transfer_policy_mismatch');
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.walletId !== 'string' || typeof body.assetId !== 'string'
    || typeof body.chainId !== 'string' || typeof body.amountAtomic !== 'string'
    || body.walletId.length > 160 || body.assetId.length > 160 || body.chainId.length > 64) {
    throw new Error('invalid_transfer_amount');
  }
  const session = sessionFromClaims(claims);
  const home = await provider.getHome({ session, manifest, walletId: body.walletId });
  if (home.status !== 'ready') throw new Error('wallet_not_found');
  sendJson(response, 200, await getPhoneEscrowQuote({
    home, walletId: body.walletId, assetId: body.assetId,
    chainId: body.chainId, amountAtomic: body.amountAtomic,
  }));
}

async function handleSubmitTransfer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const startedAt = Date.now();
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.enabledModules.includes('send-receive')) {
    sendJson(response, 403, { error: 'transfer_policy_mismatch' });
    return;
  }
  const provider = walletQueryProviders.get(manifest.tenantId);
  if (!provider) {
    sendJson(response, 503, { error: 'wallet_query_provider_unavailable' });
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
  const submitted = await submitTransfer({
    session,
    request: submission,
    authorizationId: authorization.proofId,
    assertOwnedDestination: async (walletId, chainId, recipient) => {
      await assertOwnedWalletAddress({ provider, session, manifest, walletId, chainId, recipient });
    },
  });
  if (submitted.status === 'submitted' || submitted.status === 'processing' || submitted.status === 'confirmed') {
    try {
      await markQrPaymentSubmitted({ intentId: submission.intentId, transactionHash: submitted.transactionHash });
    } catch (error) {
      console.error('wss_qr_payment_audit_update_failed', error instanceof Error ? error.message : 'unknown');
    }
  }
  console.info('wss_transfer_submit', { intentId: submission.intentId, status: submitted.status, durationMs: Date.now() - startedAt });
  sendJson(response, 202, submitted);
}

async function exchangeContext(request: IncomingMessage) {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.enabledModules.includes('exchange-connect')) {
    throw new Error('exchange_policy_mismatch');
  }
  const provider = walletQueryProviders.get(manifest.tenantId);
  if (!provider) throw new Error('wallet_query_provider_unavailable');
  return { session: sessionFromClaims(claims), manifest, provider };
}

async function handleRequestExchangeQuote(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const context = await exchangeContext(request);
  const quoteRequest = parseExchangeQuoteRequest(await readJson(request));
  const home = await context.provider.getHome({
    session: context.session,
    manifest: context.manifest,
    walletId: quoteRequest.walletId,
  });
  if (home.status !== 'ready') {
    sendJson(response, 404, { error: 'wallet_not_found' });
    return;
  }
  sendJson(response, 201, await requestExchangeQuote({ session: context.session, home, request: quoteRequest }));
}

async function handlePrepareExchange(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const context = await exchangeContext(request);
  sendJson(response, 201, await prepareExchange({
    session: context.session,
    request: parsePrepareExchangeRequest(await readJson(request)),
  }));
}

async function handleSubmitExchange(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const context = await exchangeContext(request);
  const submission = parseSubmitExchangeRequest(await readJson(request));
  const authorization = verifyHostProof(submission.hostAuthorizationProof, sessionSecret);
  assertProofSession(authorization, context.session);
  if (authorization.kind !== 'wallet-authorization' || authorization.purpose !== 'exchange-approval') {
    sendJson(response, 403, { error: 'exchange_authorization_required' });
    return;
  }
  sendJson(response, 202, await submitExchange({
    session: context.session,
    request: submission,
    authorizationId: authorization.proofId,
  }));
}

async function handleExchangeApprovalPayload(request: IncomingMessage, response: ServerResponse, intentId: string): Promise<void> {
  const context = await exchangeContext(request);
  if (intentId.length < 8 || intentId.length > 160) throw new Error('invalid_exchange_intent');
  sendJson(response, 200, getExchangeSigningRequest({ session: context.session, intentId }));
}

async function handleExchangeStatus(request: IncomingMessage, response: ServerResponse, intentId: string): Promise<void> {
  const context = await exchangeContext(request);
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new Error('invalid_exchange_intent');
  sendJson(response, 200, await getExchangeStatus({ session: context.session, intentId }));
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
  sendJson(response, 200, await getTransferSigningRequest({ session: sessionFromClaims(claims), intentId }));
}

async function handleTransferRelayPrepare(request: IncomingMessage, response: ServerResponse, intentId: string): Promise<void> {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest || !manifest.enabledModules.includes('send-receive') || !manifest.enabledModules.includes('gas-sponsorship')) {
    sendJson(response, 403, { error: 'transfer_policy_mismatch' });
    return;
  }
  if (intentId.length < 8 || intentId.length > 160) throw new Error('invalid_transfer_intent');
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.walletAuthSignature !== 'string'
    || !/^0x[0-9a-fA-F]{130}$/.test(body.walletAuthSignature)) throw new Error('relay_signature_invalid');
  sendJson(response, 200, await prepareTransferRelayForHost({
    session: sessionFromClaims(claims), intentId, walletAuthSignature: body.walletAuthSignature,
  }));
}

async function identityContext(request: IncomingMessage) {
  const claims = verifySessionToken(bearerToken(request), sessionSecret);
  const manifest = tenants.get(claims.tenantId);
  if (!manifest) throw new RegistrationError('session_policy_mismatch');
  const provider = identityRegistrationProviders.get(manifest.tenantId);
  if (!provider) throw new RegistrationError('identity_provider_unavailable');
  if (isProduction && !isDevelopmentPreview && provider.id === 'development-postgres-wallet-provider') {
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

export async function handleBffRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!setCors(request, response)) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const routedPath = url.searchParams.get('path');
  if (url.pathname === '/api' && routedPath && /^[a-z0-9/_-]+$/i.test(routedPath)) {
    url.pathname = `/${routedPath.replace(/^\/+/, '')}`;
  } else if (url.pathname === '/api') url.pathname = '/';
  else if (url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice('/api'.length);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'took-wss-institution-bff' });
      return;
    }
    const claimMatch = url.pathname.match(/^\/v1\/claims\/([^/]+)(?:\/(otp|submit))?$/);
    if (claimMatch) {
      const code = decodeURIComponent(claimMatch[1]!);
      const action = claimMatch[2];
      if (request.method === 'GET' && !action) {
        sendJson(response, 200, await getPhoneClaimInfo(code));
        return;
      }
      if (request.method === 'POST' && (action === 'otp' || action === 'submit')) {
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.phone !== 'string' || body.phone.length > 24) throw new PhoneClaimError('invalid_claim_request');
        if (action === 'otp') {
          await requestPhoneClaimOtp(code, body.phone);
          sendJson(response, 202, { status: 'sent' });
          return;
        }
        if (typeof body.otp !== 'string' || typeof body.recipient !== 'string' || body.recipient.length > 80) throw new PhoneClaimError('invalid_claim_request');
        sendJson(response, 202, await submitPhoneClaim({ code, phone: body.phone, otp: body.otp, recipient: body.recipient }));
        return;
      }
    }
    const institutionClaimMatch = url.pathname.match(/^\/v1\/claims\/([^/]+)\/institution-(otp|submit)$/);
    if (request.method === 'POST' && institutionClaimMatch) {
      const code = decodeURIComponent(institutionClaimMatch[1]!);
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      const provider = manifest ? walletQueryProviders.get(manifest.tenantId) : null;
      const identityProvider = manifest ? identityRegistrationProviders.get(manifest.tenantId) : null;
      if (!manifest?.enabledModules.includes('send-receive') || !provider || !identityProvider
        || (isProduction && !isDevelopmentPreview && (provider.id === 'sandbox-wallet-provider'
          || provider.id === 'development-postgres-wallet-provider'))) {
        throw new PhoneClaimError('claim_service_unavailable', 503);
      }
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.phone !== 'string' || body.phone.length > 24) throw new PhoneClaimError('invalid_claim_request');
      const session = sessionFromClaims(claims);
      if ((await identityProvider.getIdentity({ session, manifest })).status !== 'established') {
        throw new PhoneClaimError('institution_identity_required', 403);
      }
      const phone = await assertInstitutionClaimPhone(session, body.phone);
      if (institutionClaimMatch[2] === 'otp') {
        await requestPhoneClaimOtp(code, phone, manifest.tenantId);
        sendJson(response, 202, { status: 'sent' });
        return;
      }
      if (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp)
        || typeof body.walletId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.walletId)) {
        throw new PhoneClaimError('invalid_claim_request');
      }
      const claim = await getPhoneClaimInfo(code);
      if (claim.status !== 'ready' || !manifest.chains.includes(claim.network)) throw new PhoneClaimError('claim_wallet_network_unavailable', 422);
      // The browser supplies a wallet ID only. Its address is resolved from the authenticated tenant profile.
      const recipient = await provider.getOwnedReceiveAddress({ session, manifest, walletId: body.walletId, chainId: claim.network });
      if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new PhoneClaimError('claim_wallet_network_unavailable', 422);
      sendJson(response, 202, await submitPhoneClaim({ code, phone, otp: body.otp, recipient }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/sessions') {
      await handleCreateSession(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/development/preview-sessions') {
      await handleCreateDevelopmentPreviewSession(request, response);
      return;
    }
    const appPreviewMatch = url.pathname.match(/^\/v1\/development\/([a-z0-9-]+)-app-sessions$/);
    const appPreviewManifest = appPreviewMatch ? appPreviewTenants.get(appPreviewMatch[1] || '') : null;
    if (request.method === 'POST' && (url.pathname === '/v1/development/app-sessions' || appPreviewManifest)) {
      await handleCreateAppPreviewSession(request, response, appPreviewManifest || kiwoomManifest);
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
    if (request.method === 'POST' && url.pathname === '/v1/wallets/provider-challenges') {
      await handleIssueProviderChallenge(request, response);
      return;
    }
    const providerVerificationMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/provider-verify$/);
    if (request.method === 'POST' && providerVerificationMatch) {
      await handleVerifyProviderWallet(request, response, decodeURIComponent(providerVerificationMatch[1]!));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers/prepare') {
      await handlePrepareTransfer(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/payments/requests') {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      const provider = manifest ? walletQueryProviders.get(manifest.tenantId) : null;
      if (!manifest?.enabledModules.includes('send-receive') || !provider) throw new Error('payment_unavailable');
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.walletId !== 'string' || typeof body.chainId !== 'string'
        || typeof body.assetId !== 'string' || typeof body.amountAtomic !== 'string') throw new Error('invalid_payment_request');
      const session = sessionFromClaims(claims);
      const home = await provider.getHome({ session, manifest, walletId: body.walletId });
      if (home.status !== 'ready') throw new Error('wallet_not_found');
      sendJson(response, 201, await createQrPaymentRequest({ session, home, chainId: body.chainId,
        assetId: body.assetId, amountAtomic: body.amountAtomic }));
      return;
    }
    const paymentRequestMatch = url.pathname.match(/^\/v1\/payments\/requests\/([^/]+)$/);
    if (request.method === 'GET' && paymentRequestMatch) {
      verifySessionToken(bearerToken(request), sessionSecret);
      sendJson(response, 200, await getQrPaymentRequest(decodeURIComponent(paymentRequestMatch[1]!)));
      return;
    }
    const paymentListMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/payments$/);
    if (request.method === 'GET' && paymentListMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      sendJson(response, 200, await listQrPaymentRequests({ session: sessionFromClaims(claims), walletId: decodeURIComponent(paymentListMatch[1]!) }));
      return;
    }
    const paymentSpentMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/payments\/spent$/);
    if (request.method === 'GET' && paymentSpentMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      sendJson(response, 200, await listSpentQrPayments({ session: sessionFromClaims(claims), walletId: decodeURIComponent(paymentSpentMatch[1]!) }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/phone-escrows/quote') {
      await handlePhoneEscrowQuote(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers/submit') {
      await handleSubmitTransfer(request, response);
      return;
    }
    const transferStatusMatch = url.pathname.match(/^\/v1\/transfers\/([^/]+)\/status$/);
    const phoneNotificationMatch = url.pathname.match(/^\/v1\/phone-escrows\/([^/]+)\/notify$/);
    if (request.method === 'POST' && phoneNotificationMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      if (!manifest?.enabledModules.includes('send-receive')) throw new Error('transfer_policy_mismatch');
      sendJson(response, 200, await retryPhoneEscrowNotification({
        session: sessionFromClaims(claims),
        transferIntentId: decodeURIComponent(phoneNotificationMatch[1]!),
      }));
      return;
    }
    const refundPrepareMatch = url.pathname.match(/^\/v1\/phone-escrows\/([^/]+)\/refund\/prepare$/);
    const refundStatusMatch = url.pathname.match(/^\/v1\/phone-escrows\/([^/]+)\/refund\/status$/);
    const refundApprovalMatch = url.pathname.match(/^\/v1\/refunds\/([^/]+)\/approval-payload$/);
    const refundSubmitMatch = url.pathname.match(/^\/v1\/refunds\/([^/]+)\/submit$/);
    if ((request.method === 'POST' && (refundPrepareMatch || refundSubmitMatch))
      || (request.method === 'GET' && (refundStatusMatch || refundApprovalMatch))) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      if (!manifest?.enabledModules.includes('send-receive')) throw new Error('transfer_policy_mismatch');
      const session = sessionFromClaims(claims);
      if (refundPrepareMatch) {
        sendJson(response, 201, await preparePhoneRefund({ session, transferIntentId: decodeURIComponent(refundPrepareMatch[1]!) }));
        return;
      }
      if (refundStatusMatch) {
        sendJson(response, 200, await getPhoneRefundStatus({ session, transferIntentId: decodeURIComponent(refundStatusMatch[1]!) }));
        return;
      }
      if (refundApprovalMatch) {
        sendJson(response, 200, await getPhoneRefundSigningRequest({ session, refundIntentId: decodeURIComponent(refundApprovalMatch[1]!) }));
        return;
      }
      if (refundSubmitMatch) {
        const submission = parseSubmitTransferRequest(await readJson(request));
        if (submission.intentId !== decodeURIComponent(refundSubmitMatch[1]!)) throw new Error('phone_refund_intent_mismatch');
        const authorization = verifyHostProof(submission.hostAuthorizationProof, sessionSecret);
        assertProofSession(authorization, session);
        if (authorization.kind !== 'wallet-authorization' || authorization.purpose !== 'transfer-approval') throw new Error('transfer_authorization_required');
        sendJson(response, 202, await submitPhoneRefund({ session, request: submission, authorizationId: authorization.proofId }));
        return;
      }
    }
    if (request.method === 'GET' && transferStatusMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      if (!manifest?.enabledModules.includes('send-receive')) throw new Error('transfer_policy_mismatch');
      sendJson(response, 200, await getTransferStatus({ session: sessionFromClaims(claims), intentId: decodeURIComponent(transferStatusMatch[1]!) }));
      return;
    }
    const transferActivityMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/activity$/);
    if (request.method === 'GET' && transferActivityMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      if (!manifest?.enabledModules.includes('send-receive')) throw new Error('transfer_policy_mismatch');
      const walletId = decodeURIComponent(transferActivityMatch[1]!);
      if (walletId.length < 8 || walletId.length > 160) throw new Error('invalid_wallet_id');
      sendJson(response, 200, await listWalletTransferActivity({ session: sessionFromClaims(claims), walletId }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/exchanges/quotes') {
      await handleRequestExchangeQuote(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/exchanges/prepare') {
      await handlePrepareExchange(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/exchanges/submit') {
      await handleSubmitExchange(request, response);
      return;
    }
    const exchangeApprovalMatch = url.pathname.match(/^\/v1\/exchanges\/([^/]+)\/approval-payload$/);
    if (request.method === 'GET' && exchangeApprovalMatch) {
      await handleExchangeApprovalPayload(request, response, decodeURIComponent(exchangeApprovalMatch[1]!));
      return;
    }
    const exchangeStatusMatch = url.pathname.match(/^\/v1\/exchanges\/([^/]+)\/status$/);
    if (request.method === 'GET' && exchangeStatusMatch) {
      await handleExchangeStatus(request, response, decodeURIComponent(exchangeStatusMatch[1]!));
      return;
    }
    const transferApprovalMatch = url.pathname.match(/^\/v1\/transfers\/([^/]+)\/approval-payload$/);
    if (request.method === 'GET' && transferApprovalMatch) {
      await handleTransferApprovalPayload(request, response, decodeURIComponent(transferApprovalMatch[1]!));
      return;
    }
    const transferRelayMatch = url.pathname.match(/^\/v1\/transfers\/([^/]+)\/relay-prepare$/);
    if (request.method === 'POST' && transferRelayMatch) {
      await handleTransferRelayPrepare(request, response, decodeURIComponent(transferRelayMatch[1]!));
      return;
    }
    const sarVaultV2Match = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/sar-vault-v2\/(status|challenges|verify|password-share|shares\/(?:password|phone|email)|unlock\/(?:phone|email))$/);
    if (sarVaultV2Match) {
      const walletId = decodeURIComponent(sarVaultV2Match[1]!);
      const action = sarVaultV2Match[2]!;
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const session = sessionFromClaims(claims);
      if (request.method === 'GET' && action === 'status') {
        sendJson(response, 200, await sarVaultV2Status(session, walletId));
        return;
      }
      if (request.method === 'POST' && action === 'challenges') {
        const body = await readJson(request);
        if (!isRecord(body)) throw new SarVaultV2Error('invalid_vault_request');
        sendJson(response, 201, await startSarVaultV2Challenge(session, walletId, body));
        return;
      }
      if (request.method === 'POST' && action === 'verify') {
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.challengeId !== 'string'
          || (body.factor !== 'phone' && body.factor !== 'email') || typeof body.code !== 'string') {
          throw new SarVaultV2Error('invalid_vault_request');
        }
        sendJson(response, 200, await verifySarVaultV2Factor(session, walletId, body.challengeId, body.factor, body.code));
        return;
      }
      if (request.method === 'PUT' && action.startsWith('shares/')) {
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.challengeId !== 'string'
          || typeof body.enrollmentToken !== 'string') throw new SarVaultV2Error('invalid_vault_request');
        const factor = action.slice('shares/'.length) as 'password' | 'phone' | 'email';
        sendJson(response, 200, await storeSarVaultV2Share(
          session, walletId, body.challengeId, body.enrollmentToken, factor, body.share,
        ));
        return;
      }
      if (request.method === 'GET' && action === 'password-share') {
        sendJson(response, 200, await loadSarVaultV2PasswordShare(session, walletId));
        return;
      }
      if (request.method === 'POST' && action.startsWith('unlock/')) {
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.challengeId !== 'string'
          || typeof body.factorAccessToken !== 'string') throw new SarVaultV2Error('invalid_vault_request');
        const factor = action.slice('unlock/'.length) as 'phone' | 'email';
        sendJson(response, 200, await loadSarVaultV2FactorShare(
          session, walletId, body.challengeId, factor, body.factorAccessToken,
        ));
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    const sarVaultMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/sar-vault\/(status|challenges|verify|shares|unlock)$/);
    if (sarVaultMatch) {
      const walletId = decodeURIComponent(sarVaultMatch[1]!);
      const action = sarVaultMatch[2]!;
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const session = sessionFromClaims(claims);
      if (request.method === 'GET' && action === 'status') {
        sendJson(response, 200, await sarVaultStatus(session, walletId));
        return;
      }
      if (request.method === 'POST' && action === 'challenges') {
        const body = await readJson(request);
        if (!isRecord(body)) throw new SarVaultError('invalid_vault_request');
        sendJson(response, 201, await startSarVaultChallenge(session, walletId, body));
        return;
      }
      if (request.method === 'POST' && action === 'verify') {
        const body = await readJson(request);
        if (!isRecord(body)
          || typeof body.challengeId !== 'string'
          || (body.factor !== 'phone' && body.factor !== 'email')
          || typeof body.code !== 'string') throw new SarVaultError('invalid_vault_request');
        sendJson(response, 200, await verifySarVaultFactor(session, walletId, body.challengeId, body.factor, body.code));
        return;
      }
      if (request.method === 'PUT' && action === 'shares') {
        const body = await readJson(request);
        if (!isRecord(body)
          || typeof body.challengeId !== 'string'
          || typeof body.accessToken !== 'string') throw new SarVaultError('invalid_vault_request');
        await storeSarVaultShares(session, walletId, body.challengeId, body.accessToken, body.shareB, body.shareC);
        sendJson(response, 201, { stored: true });
        return;
      }
      if (request.method === 'POST' && action === 'unlock') {
        const body = await readJson(request);
        if (!isRecord(body)
          || typeof body.challengeId !== 'string'
          || typeof body.accessToken !== 'string') throw new SarVaultError('invalid_vault_request');
        sendJson(response, 200, await loadSarVaultShares(session, walletId, body.challengeId, body.accessToken));
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    const walletHomeMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)\/home$/);
    if (request.method === 'GET' && walletHomeMatch) {
      await handleWalletHome(request, response, decodeURIComponent(walletHomeMatch[1]!));
      return;
    }
    const walletRemovalMatch = url.pathname.match(/^\/v1\/wallets\/([^/]+)$/);
    if (request.method === 'PATCH' && walletRemovalMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const provider = walletQueryProviders.get(claims.tenantId);
      if (!provider) throw new WalletRenameError('wallet_provider_unavailable', 503);
      const walletId = decodeURIComponent(walletRemovalMatch[1]!);
      if (!/^[0-9a-f-]{36}$/i.test(walletId) && !/^sandbox-wallet-[0-9a-f-]{36}$/i.test(walletId)) throw new WalletRenameError('invalid_wallet_id', 400);
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.label !== 'string') throw new WalletRenameError('invalid_wallet_label', 422);
      const label = body.label.trim();
      if (!label || Array.from(label).length > 30 || /[\u0000-\u001f\u007f]/.test(label)) throw new WalletRenameError('invalid_wallet_label', 422);
      sendJson(response, 200, await provider.renameWallet({ session: sessionFromClaims(claims), walletId, label }));
      return;
    }
    if (request.method === 'DELETE' && walletRemovalMatch) {
      const claims = verifySessionToken(bearerToken(request), sessionSecret);
      const manifest = tenants.get(claims.tenantId);
      const provider = walletQueryProviders.get(claims.tenantId);
      if (!manifest || !provider) throw new Error('wallet_provider_unavailable');
      const walletId = decodeURIComponent(walletRemovalMatch[1]!);
      if (!/^[0-9a-f-]{36}$/i.test(walletId) && !/^sandbox-wallet-[0-9a-f-]{36}$/i.test(walletId)) throw new Error('invalid_wallet_id');
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.hostAuthorizationProof !== 'string') throw new Error('wallet_authorization_required');
      const authorization = verifyHostProof(body.hostAuthorizationProof, sessionSecret);
      assertProofSession(authorization, sessionFromClaims(claims));
      if (authorization.kind !== 'wallet-authorization' || authorization.purpose !== 'wallet-removal') throw new Error('wallet_authorization_required');
      sendJson(response, 200, await provider.removeWallet({ session: sessionFromClaims(claims), manifest, walletId, authorizationId: authorization.proofId }));
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof PhoneClaimError) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (error instanceof SarVaultError) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (error instanceof SarVaultV2Error) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (error instanceof RegistrationError) {
      const status = error.code.includes('rate_limited') ? 429
        : error.code.includes('not_found') ? 404
          : error.code.includes('required') || error.code.includes('policy_mismatch') ? 403
            : 400;
      sendJson(response, status, { error: error.code });
      return;
    }
    if (error instanceof WalletRemovalError) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (error instanceof WalletRenameError) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (message === 'exchange_provider_not_configured') {
      sendJson(response, 503, { error: message });
      return;
    }
    if (request.method === 'POST' && /^\/v1\/phone-escrows\/[^/]+\/notify$/.test(url.pathname)) {
      const status = message === 'phone_escrow_sms_rate_limited' || message === 'phone_escrow_sms_limit_reached' ? 429 : 409;
      sendJson(response, status, { error: message.startsWith('phone_escrow_') ? message : 'phone_escrow_notification_unavailable' });
      return;
    }
    if (message === 'exchange_liquidity_unavailable') {
      sendJson(response, 422, { error: message });
      return;
    }
    if (message.startsWith('exchange_quote_provider_')) {
      sendJson(response, 502, { error: 'exchange_quote_unavailable' });
      return;
    }
    if (isSessionAuthenticationError(message)) {
      sendJson(response, 401, { error: 'request_rejected' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers/prepare') {
      const publicError = publicTransferPreparationError(error);
      sendJson(response, publicError.status, { error: publicError.code });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/phone-escrows/quote') {
      const publicError = publicTransferPreparationError(error);
      sendJson(response, publicError.status, { error: publicError.code });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers/submit'
      && message === 'own_wallet_destination_invalid') {
      sendJson(response, 400, { error: message });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/wallets/provision') {
      const publicError = publicWalletProvisioningError(error);
      const databaseError = error as { code?: unknown; constraint_name?: unknown } | null;
      console.warn(JSON.stringify({
        event: 'wss_wallet_provision_failed',
        code: publicError.code,
        ...(typeof databaseError?.code === 'string' ? { sqlState: databaseError.code } : {}),
        ...(typeof databaseError?.constraint_name === 'string' ? { constraint: databaseError.constraint_name } : {}),
      }));
      sendJson(response, publicError.status, { error: publicError.code });
      return;
    }
    const status = 400;
    sendJson(response, status, { error: 'request_rejected' });
  }
}

if (!process.env.VERCEL) {
  const server = createServer(handleBffRequest);
  server.listen(port, '127.0.0.1', () => {
    console.log(`took WSS Institution BFF listening on http://127.0.0.1:${port}`);
  });
}
