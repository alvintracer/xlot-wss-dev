// Development-only ciphertext retrieval for the xlot-wss-dev SAR vertical slice.
// This function must never receive a mnemonic, private key, entropy, plaintext
// Shamir share, wrapping key, or completed recovery secret.

interface WssSessionClaims {
  protocolVersion: 1;
  sessionId: string;
  tenantId: string;
  subject: string;
  subjectVersion: 1;
  keyAdapter: "took-sar" | "thirdweb-user-wallet" | "fsl-mpc";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

interface DeploymentMetadataRow {
  project_name: string;
  environment: string;
  purpose: string;
  sar_storage_mode: string;
}

interface ExternalIdentityRow {
  user_profile_id: string;
}

interface WalletRow {
  id: string;
  key_adapter: string;
  status: string;
}

interface EnvelopeRow {
  share_index: 1 | 2 | 3;
  envelope_version: 1;
  algorithm: "AES-256-GCM";
  iv_base64: string;
  ciphertext_base64: string;
  aad: string;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedOrigins = new Set(
  (Deno.env.get("WSS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function json(status: number, body: unknown, origin?: string): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return undefined;
  if (!allowedOrigins.has(origin)) {
    throw new HttpError(403, "origin_not_allowed");
  }
  return origin;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function verifyWssSession(request: Request): Promise<WssSessionClaims> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "session_required");
  }
  const token = authorization.slice("Bearer ".length);
  const [headerPart, claimsPart, signaturePart, ...extra] = token.split(".");
  if (!headerPart || !claimsPart || !signaturePart || extra.length > 0) {
    throw new HttpError(401, "invalid_session");
  }

  const secret = Deno.env.get("WSS_SESSION_SECRET")?.trim();
  if (!secret || secret.length < 32) {
    throw new HttpError(503, "vault_not_configured");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${headerPart}.${claimsPart}`),
    ),
  );
  let provided: Uint8Array;
  try {
    provided = decodeBase64Url(signaturePart);
  } catch {
    throw new HttpError(401, "invalid_session");
  }
  if (!equalBytes(expected, provided)) {
    throw new HttpError(401, "invalid_session");
  }

  try {
    const header = decodeJsonPart<{ alg?: unknown; typ?: unknown }>(headerPart);
    if (header.alg !== "HS256" || header.typ !== "JWT") {
      throw new Error("unsupported header");
    }
    const claims = decodeJsonPart<WssSessionClaims>(claimsPart);
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.protocolVersion !== 1 ||
      claims.subjectVersion !== 1 ||
      typeof claims.sessionId !== "string" ||
      typeof claims.tenantId !== "string" ||
      claims.tenantId.length < 1 ||
      claims.tenantId.length > 64 ||
      typeof claims.subject !== "string" ||
      claims.subject.length < 32 ||
      claims.subject.length > 128 ||
      typeof claims.nonce !== "string" ||
      typeof claims.issuedAt !== "number" ||
      typeof claims.expiresAt !== "number" ||
      claims.expiresAt <= now ||
      claims.issuedAt > now + 30 ||
      claims.expiresAt - claims.issuedAt > 600 ||
      !["took-sar", "thirdweb-user-wallet", "fsl-mpc"].includes(
        claims.keyAdapter,
      )
    ) {
      throw new Error("invalid claims");
    }
    return claims;
  } catch {
    throw new HttpError(401, "invalid_session");
  }
}

async function restRows<T>(
  table: string,
  query: URLSearchParams,
): Promise<T[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(503, "vault_not_configured");
  }
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?${query.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) throw new HttpError(503, "vault_unavailable");
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new HttpError(503, "vault_unavailable");
  return body as T[];
}

async function assertDevelopmentBoundary(): Promise<void> {
  if (Deno.env.get("WSS_DEPLOYMENT_MODE") !== "development") {
    throw new HttpError(503, "development_vault_disabled");
  }
  const query = new URLSearchParams({
    select: "project_name,environment,purpose,sar_storage_mode",
    singleton: "eq.true",
    limit: "1",
  });
  const [metadata] = await restRows<DeploymentMetadataRow>(
    "wss_deployment_metadata",
    query,
  );
  if (
    !metadata ||
    metadata.project_name !== "xlot-wss-dev" ||
    metadata.environment !== "development" ||
    metadata.purpose !== "proposal-and-early-function-sandbox" ||
    metadata.sar_storage_mode !== "single-project-encrypted"
  ) {
    throw new HttpError(503, "development_boundary_mismatch");
  }
}

async function resolveOwnedSarWallet(
  claims: WssSessionClaims,
  walletId: string,
): Promise<void> {
  const identityQuery = new URLSearchParams({
    select: "user_profile_id",
    tenant_id: `eq.${claims.tenantId}`,
    issuer: "eq.institution-host",
    subject_version: `eq.${claims.subjectVersion}`,
    subject_hash: `eq.${claims.subject}`,
    revoked_at: "is.null",
    limit: "1",
  });
  const [identity] = await restRows<ExternalIdentityRow>(
    "wss_external_identities",
    identityQuery,
  );
  if (!identity) throw new HttpError(404, "wallet_not_found");

  const walletQuery = new URLSearchParams({
    select: "id,key_adapter,status",
    id: `eq.${walletId}`,
    tenant_id: `eq.${claims.tenantId}`,
    user_profile_id: `eq.${identity.user_profile_id}`,
    key_adapter: "eq.took-sar",
    status: "eq.active",
    limit: "1",
  });
  const [wallet] = await restRows<WalletRow>("wss_wallets", walletQuery);
  if (!wallet) throw new HttpError(404, "wallet_not_found");
}

async function handle(request: Request): Promise<Response> {
  const origin = allowedOrigin(request);
  if (request.method === "OPTIONS") {
    const response = new Response(null, { status: 204 });
    if (origin) {
      response.headers.set("access-control-allow-origin", origin);
      response.headers.set(
        "access-control-allow-headers",
        "authorization,content-type",
      );
      response.headers.set("access-control-allow-methods", "GET,OPTIONS");
      response.headers.set("access-control-max-age", "600");
      response.headers.set("vary", "Origin");
    }
    return response;
  }
  if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");

  if (Deno.env.get("WSS_DEPLOYMENT_MODE") !== "development") {
    throw new HttpError(503, "development_vault_disabled");
  }
  const claims = await verifyWssSession(request);
  await assertDevelopmentBoundary();
  const walletId = new URL(request.url).searchParams.get("walletId") ?? "";
  if (!uuidPattern.test(walletId)) {
    throw new HttpError(400, "invalid_wallet_id");
  }
  await resolveOwnedSarWallet(claims, walletId);

  const envelopeQuery = new URLSearchParams({
    select:
      "share_index,envelope_version,algorithm,iv_base64,ciphertext_base64,aad",
    tenant_id: `eq.${claims.tenantId}`,
    wallet_id: `eq.${walletId}`,
    order: "share_index.asc",
  });
  const rows = await restRows<EnvelopeRow>(
    "wss_dev_sar_envelopes",
    envelopeQuery,
  );
  if (
    rows.length !== 3 || new Set(rows.map((row) => row.share_index)).size !== 3
  ) {
    throw new HttpError(409, "recovery_envelopes_incomplete");
  }

  return json(200, {
    walletId,
    storageMode: "single-project-development",
    envelopes: rows.map((row) => ({
      factorIndex: row.share_index,
      envelopeVersion: row.envelope_version,
      algorithm: row.algorithm,
      ivBase64: row.iv_base64,
      ciphertextBase64: row.ciphertext_base64,
      aad: row.aad,
    })),
  }, origin);
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : "internal_error";
    let origin: string | undefined;
    try {
      origin = allowedOrigin(request);
    } catch {
      origin = undefined;
    }
    return json(status, { error: code }, origin);
  }
});
