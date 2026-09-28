import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createAes256CbcCodec } from "./lib/aes-cbc.js";
import { TransightClient, TransightError } from "./lib/transight-client.js";

dotenv.config({
  path: process.env.ENV_FILE || "/etc/took-wss-kyt.env",
  quiet: true,
  override: true,
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createTransightClientFromEnv(env = process.env) {
  return new TransightClient({
    baseUrl: env.TRANSIGHT_API_BASE_URL,
    tokenUrl: env.TRANSIGHT_OAUTH_TOKEN_URL,
    clientId: env.TRANSIGHT_OAUTH_CLIENT_ID,
    clientSecret: env.TRANSIGHT_OAUTH_CLIENT_SECRET,
    scope: env.TRANSIGHT_OAUTH_SCOPE || "ORG_CLIENT",
    timeoutMs: positiveInteger(env.TRANSIGHT_TIMEOUT_MS, 8_000),
    refreshAheadMs: positiveInteger(
      env.TRANSIGHT_TOKEN_REFRESH_AHEAD_MS,
      300_000,
    ),
    tpsLimit: Math.min(positiveInteger(env.TRANSIGHT_TPS_LIMIT, 8), 20),
  });
}

function gatewayError(response, error) {
  const known = error instanceof TransightError;
  const code = known ? error.code : "INTERNAL_ERROR";
  console.error("[kyt-gateway]", {
    code,
    retryable: known ? error.retryable : false,
  });
  const status = code === "INVALID_REQUEST"
    ? 400
    : code === "TIMEOUT"
    ? 504
    : code === "HTTP_429"
    ? 429
    : 502;
  return response.status(status).json({
    error: status === 400
      ? "Invalid KYT screening request."
      : "KYT screening is temporarily unavailable.",
    code,
    retryable: known ? error.retryable : false,
  });
}

export function createApp({ env = process.env, transightClient } = {}) {
  if (!env.INTERNAL_GATEWAY_TOKEN || env.INTERNAL_GATEWAY_TOKEN.length < 32) {
    throw new Error("INTERNAL_GATEWAY_TOKEN must be at least 32 characters.");
  }
  const encryptionMode = env.TRANSIGHT_PAYLOAD_ENCRYPTION_MODE || "documented-json";
  if (encryptionMode !== "documented-json") {
    throw new Error(
      "Unsupported TranSight encryption envelope. The provider contract must be explicit.",
    );
  }
  const codec = createAes256CbcCodec({
    key: env.TRANSIGHT_ENCRYPTION_KEY,
    iv: env.TRANSIGHT_ENCRYPTION_IV,
  });
  const probe = "took-wss-transight-codec-probe";
  if (codec.decryptUtf8(codec.encryptUtf8(probe)) !== probe) {
    throw new Error("TranSight AES-256-CBC material validation failed.");
  }
  const activeClient = transightClient ?? createTransightClientFromEnv(env);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(helmet());
  app.use(express.json({
    limit: "8kb",
    type: ["application/json", "application/*+json"],
  }));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: positiveInteger(env.GATEWAY_RATE_LIMIT_PER_MINUTE, 120),
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "took-wss-kyt-gateway",
      upstream: "transight",
      policy: "fail-closed",
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/v1/address/screen", async (request, response) => {
    if (!secureEqual(request.get("x-api-key"), env.INTERNAL_GATEWAY_TOKEN)) {
      return response.status(401).json({ error: "Unauthorized" });
    }
    const address = String(request.body?.address ?? "").trim();
    const asset = String(request.body?.asset ?? "").trim().toUpperCase();
    const direction = String(request.body?.direction ?? "out").toLowerCase();
    const amountUsd = Number(request.body?.amount_usd ?? 0);
    if (
      !address ||
      address.length > 200 ||
      !/^[A-Z0-9._-]{1,30}$/.test(asset) ||
      !["in", "out"].includes(direction) ||
      !Number.isFinite(amountUsd) ||
      amountUsd < 0
    ) {
      return response.status(400).json({ error: "Invalid KYT screening request." });
    }
    try {
      return response.json(await activeClient.screenAddress(address));
    } catch (error) {
      return gatewayError(response, error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });
  return app;
}

export function startServer(env = process.env) {
  const app = createApp({ env });
  const port = positiveInteger(env.PORT, 3_200);
  const host = env.HOST || "127.0.0.1";
  const server = app.listen(port, host, () => {
    console.log(`took-wss-kyt-gateway listening on ${host}:${port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

const isDirectRun = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
);

if (isDirectRun || process.env.WSS_KYT_START_SERVER === "1") {
  startServer();
}
