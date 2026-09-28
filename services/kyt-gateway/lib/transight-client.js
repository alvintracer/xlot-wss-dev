import { randomBytes } from "node:crypto";
import { RateGate } from "./rate-gate.js";

const SUCCESS_CODE = "A0000";
const AUTH_ERROR_CODES = new Set(["A1017", "A1018"]);
const RETRYABLE_CODES = new Set(["A0001", "A1001", "A1004"]);
const APPROVED_ORIGINS = new Set([
  "https://api.transight.io",
  "https://t-api.transight.io",
]);
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function kstParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function transightTransactionTime(date = new Date()) {
  const parts = kstParts(date);
  return [
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ].join("");
}

export function transightTransactionNumber(date = new Date()) {
  const timestamp = transightTransactionTime(date).slice(2);
  return `TW${timestamp}${randomBytes(3).toString("hex").toUpperCase()}`;
}

function approvedUrl(value, expectedPath, label) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !APPROVED_ORIGINS.has(url.origin) ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} is not an approved TranSight HTTPS endpoint.`);
  }
  return url;
}

async function readText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new TransightError("TranSight response is too large.", {
      code: "RESPONSE_TOO_LARGE",
    });
  }
  if (!response.body?.getReader) return response.text();

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TransightError("TranSight response is too large.", {
        code: "RESPONSE_TOO_LARGE",
      });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  const text = await readText(response, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new TransightError("TranSight returned invalid JSON.", {
      code: "INVALID_RESPONSE",
    });
  }
}

function isCanonicalBase64(value) {
  if (
    !value ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function levelScore(level) {
  switch (String(level ?? "").toUpperCase()) {
    case "SEVERE":
    case "CRITICAL":
      return 100;
    case "HIGH":
      return 66;
    case "MEDIUM":
      return 40;
    case "LOW":
      return 10;
    default:
      return 0;
  }
}

function severityFor(score, directDenylist, sanctioned) {
  if (sanctioned || directDenylist || score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

function directCategory(payload) {
  const detail = payload?.denylistDetail;
  if (!detail || typeof detail !== "object") return null;
  return String(
    detail.raCode2 ?? detail.dataType ?? payload.dataType ?? "DENYLIST",
  ).trim().toUpperCase();
}

export function normalizeTransightResult(payload) {
  const directDenylist = String(payload?.isDenylist ?? "N").toUpperCase() === "Y";
  const trackedDenylist = String(payload?.isTrackedDenylist ?? "N").toUpperCase() === "Y";
  const detail = payload?.denylistDetail && typeof payload.denylistDetail === "object"
    ? payload.denylistDetail
    : {};
  const category = directCategory(payload);
  const dataType = String(payload?.dataType ?? detail.dataType ?? "").toUpperCase();
  const sanctioned = directDenylist && (
    dataType === "RDL" || ["OIS", "SRA", "DIS"].includes(category)
  );
  const directScore = numberOrNull(payload?.riskScore);
  const trackedScore = numberOrNull(payload?.trackedRiskScore);
  let riskScore = Math.max(
    directScore ?? levelScore(payload?.riskLevel),
    trackedScore ?? levelScore(payload?.trackedRiskLevel),
  );
  if (directDenylist) riskScore = Math.max(riskScore, 100);
  if (trackedDenylist && riskScore === 0) riskScore = 50;
  riskScore = Math.max(0, Math.min(100, riskScore));

  const flags = [];
  if (directDenylist) {
    const label = String(
      detail.raCode2Kor ?? detail.raCode2Eng ?? detail.raDetail ?? dataType ?? "고위험 지갑주소",
    ).trim();
    flags.push({
      category: category || "DENYLIST",
      severity: severityFor(riskScore, true, sanctioned),
      description: label || "고위험 지갑주소로 확인되었습니다.",
    });
  }
  if (trackedDenylist) {
    const trackedCategory = String(payload?.trackedRaCode2 ?? "TRACKED_DENYLIST")
      .trim().toUpperCase();
    const count = numberOrNull(payload?.trackedDenylistCount);
    flags.push({
      category: trackedCategory || "TRACKED_DENYLIST",
      severity: severityFor(trackedScore ?? riskScore, false, false),
      description: count && count > 0
        ? `1-hop 고위험 연관 주소 ${count}건이 확인되었습니다.`
        : "1-hop 고위험 연관 주소가 확인되었습니다.",
    });
  }

  return {
    risk_score: riskScore,
    is_sanctioned: sanctioned,
    flags,
    provider: "transight",
    provider_code: String(payload?.rspCode ?? ""),
    direct_denylist: directDenylist,
    tracked_denylist: trackedDenylist,
  };
}

export class TransightError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TransightError";
    this.code = options.code ?? "UPSTREAM_ERROR";
    this.httpStatus = options.httpStatus;
    this.retryable = Boolean(options.retryable);
  }
}

export class TransightClient {
  constructor(options) {
    const baseUrl = approvedUrl(
      options.baseUrl ?? "https://api.transight.io/",
      "/",
      "TRANSIGHT_API_BASE_URL",
    );
    this.tokenUrl = approvedUrl(
      options.tokenUrl ?? new URL("/oauth/token", baseUrl).href,
      "/oauth/token",
      "TRANSIGHT_OAUTH_TOKEN_URL",
    );
    this.screenUrl = approvedUrl(
      new URL("/ts/api/denylist/wallet", baseUrl).href,
      "/ts/api/denylist/wallet",
      "TranSight wallet URL",
    );
    this.clientId = String(options.clientId ?? "").trim();
    this.clientSecret = String(options.clientSecret ?? "").trim();
    this.scope = String(options.scope ?? "ORG_CLIENT").trim();
    if (!this.clientId || !this.clientSecret) {
      throw new Error("TranSight OAuth credentials are missing.");
    }
    if (this.scope !== "ORG_CLIENT") {
      throw new Error("TranSight OAuth scope must be ORG_CLIENT.");
    }
    this.payloadEncryptionMode = String(
      options.payloadEncryptionMode ?? "aes-256-cbc-base64-raw",
    ).trim();
    if (this.payloadEncryptionMode !== "aes-256-cbc-base64-raw") {
      throw new Error("Unsupported TranSight payload encryption mode.");
    }
    this.encryptionCodec = options.encryptionCodec;
    if (
      typeof this.encryptionCodec?.encryptUtf8 !== "function" ||
      typeof this.encryptionCodec?.decryptUtf8 !== "function"
    ) {
      throw new Error("TranSight AES-256-CBC codec is missing.");
    }
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = positiveInteger(options.timeoutMs, 8_000);
    this.refreshAheadMs = positiveInteger(options.refreshAheadMs, 300_000);
    this.rateGate = options.rateGate ?? new RateGate(
      Math.min(positiveInteger(options.tpsLimit, 8), 20),
      this.now,
    );
    this.token = null;
    this.tokenPromise = null;
  }

  async screenAddress(address) {
    const walletAddress = String(address ?? "").trim();
    if (
      walletAddress.length < 20 ||
      Buffer.byteLength(walletAddress, "utf8") > 200 ||
      /\s/.test(walletAddress)
    ) {
      throw new TransightError("Invalid wallet address.", {
        code: "INVALID_REQUEST",
      });
    }
    return this.rateGate.schedule(async () => {
      const requestedAt = new Date(this.now());
      const payload = await this.#authorizedRequest({
        tranDtm: transightTransactionTime(requestedAt),
        tranNo: transightTransactionNumber(requestedAt),
        walletAddress,
      });
      return normalizeTransightResult(payload);
    });
  }

  async #authorizedRequest(body, retried = false) {
    const token = await this.#getToken();
    const encryptedBody = this.#encodeServiceRequest(body);
    const response = await this.#fetch(this.screenUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain; charset=UTF-8",
        Accept: "text/plain, application/json",
      },
      body: encryptedBody,
    });
    if (response.status === 401 && !retried) {
      this.token = null;
      return this.#authorizedRequest(body, true);
    }
    if (!response.ok) {
      throw new TransightError("TranSight screening request failed.", {
        code: `HTTP_${response.status}`,
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    const payload = await this.#decodeServiceResponse(response);
    const code = String(payload?.rspCode ?? "");
    if (AUTH_ERROR_CODES.has(code) && !retried) {
      this.token = null;
      return this.#authorizedRequest(body, true);
    }
    if (code !== SUCCESS_CODE) {
      throw new TransightError("TranSight screening returned an error.", {
        code: code || "INVALID_RESPONSE",
        retryable: RETRYABLE_CODES.has(code),
      });
    }
    return payload;
  }

  #encodeServiceRequest(body) {
    const plaintext = JSON.stringify(body);
    const ciphertext = this.encryptionCodec.encryptUtf8(plaintext);
    if (!isCanonicalBase64(ciphertext) || /\s/.test(ciphertext)) {
      throw new TransightError("TranSight request encryption failed.", {
        code: "ENCRYPTION_ERROR",
      });
    }
    return ciphertext;
  }

  async #decodeServiceResponse(response) {
    const rawText = await readText(response);
    const encoded = rawText.trim();
    if (!encoded) {
      throw new TransightError("TranSight returned an empty response.", {
        code: "INVALID_RESPONSE",
      });
    }

    let jsonText = encoded;
    if (!encoded.startsWith("{") && !encoded.startsWith("[")) {
      if (/\s/.test(encoded) || !isCanonicalBase64(encoded)) {
        throw new TransightError("TranSight returned an invalid encrypted response.", {
          code: "INVALID_RESPONSE",
        });
      }
      try {
        jsonText = this.encryptionCodec.decryptUtf8(encoded);
      } catch {
        throw new TransightError("TranSight response decryption failed.", {
          code: "DECRYPTION_ERROR",
        });
      }
    }

    try {
      const payload = JSON.parse(jsonText);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Response is not an object.");
      }
      return payload;
    } catch {
      throw new TransightError("TranSight returned invalid JSON.", {
        code: "INVALID_RESPONSE",
      });
    }
  }

  async #getToken() {
    const now = this.now();
    if (this.token && now < this.token.expiresAt - this.refreshAheadMs) {
      return this.token.value;
    }
    if (!this.tokenPromise) {
      this.tokenPromise = this.#issueToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  async #issueToken() {
    const authorization = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await this.#fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json",
      },
      body: JSON.stringify({
        scope: this.scope,
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) {
      throw new TransightError("TranSight token request failed.", {
        code: `OAUTH_HTTP_${response.status}`,
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    const payload = await readJson(response, 128 * 1024);
    if (
      (payload.rspCode && payload.rspCode !== SUCCESS_CODE) ||
      typeof payload.access_token !== "string" ||
      !payload.access_token
    ) {
      throw new TransightError("TranSight token response is invalid.", {
        code: String(payload.rspCode ?? "INVALID_TOKEN_RESPONSE"),
      });
    }
    const expiresIn = positiveInteger(payload.expires_in, 3_600);
    this.token = {
      value: payload.access_token,
      expiresAt: this.now() + expiresIn * 1_000,
    };
    return this.token.value;
  }

  async #fetch(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new TransightError(
        timedOut ? "TranSight request timed out." : "TranSight network request failed.",
        { code: timedOut ? "TIMEOUT" : "NETWORK_ERROR", retryable: true },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
