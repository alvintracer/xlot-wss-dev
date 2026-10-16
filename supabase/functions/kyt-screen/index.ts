import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { normalizeKytProviderResult } from "./policy.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-wss-kyt-trace",
  "Content-Type": "application/json",
};
const providerUrl = Deno.env.get("WSS_TRANSIGHT_API_URL") ||
  Deno.env.get("TRANSIGHT_API_URL");
const providerKey = Deno.env.get("WSS_TRANSIGHT_API_KEY") ||
  Deno.env.get("TRANSIGHT_API_KEY");

interface ScreenRequest {
  address: string;
  network: string;
  direction: "in" | "out";
  amount_usd?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function failClosed() {
  return {
    riskScore: -1,
    riskLevel: "CRITICAL" as const,
    flags: [{
      category: "KYT_UNAVAILABLE",
      severity: "HIGH",
      description: "위험도 분석을 완료할 수 없습니다.",
    }],
    isSanctioned: false,
    isBlocked: true,
    kytAvailable: false,
    screenedAt: Date.now(),
  };
}

function providerAsset(network: string): string {
  const mapped: Readonly<Record<string, string>> = {
    ethereum: "ETH",
    polygon: "POL",
    arbitrum: "ETH",
    base: "ETH",
    bnb: "BNB",
    solana: "SOL",
    bitcoin: "BTC",
    tron: "TRX",
    xrp: "XRP",
  };
  return mapped[network.toLowerCase()] ?? network.toUpperCase();
}

serve(async (request) => {
  const suppliedTrace = request.headers.get("x-wss-kyt-trace");
  const traceId = suppliedTrace && /^[0-9a-f-]{36}$/i.test(suppliedTrace)
    ? suppliedTrace
    : crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  let body: ScreenRequest;
  try {
    body = await request.json() as ScreenRequest;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (
    !body.address?.trim() ||
    body.address.length > 256 ||
    !body.network?.trim() ||
    body.network.length > 64 ||
    (body.direction !== "in" && body.direction !== "out")
  ) return json({ error: "invalid_request" }, 400);
  if (!providerUrl || !providerKey) {
    console.warn("wss_kyt_provider_unconfigured", { traceId });
    return json({
      address: body.address,
      network: body.network,
      ...failClosed(),
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${providerUrl.replace(/\/$/, "")}/v1/address/screen`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": providerKey,
          "X-Request-ID": traceId,
        },
        body: JSON.stringify({
          address: body.address.trim(),
          asset: providerAsset(body.network),
          direction: body.direction,
          amount_usd:
            Number.isFinite(body.amount_usd) && Number(body.amount_usd) >= 0
              ? Number(body.amount_usd)
              : 0,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      let providerCode = "unknown";
      try {
        const failure = await response.json() as { code?: unknown };
        if (
          typeof failure.code === "string" &&
          /^[A-Z0-9_]{1,40}$/.test(failure.code)
        ) providerCode = failure.code;
      } catch { /* Do not log upstream response bodies. */ }
      console.warn("wss_kyt_gateway_failure", {
        traceId,
        status: response.status,
        providerCode,
      });
      return json({
        address: body.address,
        network: body.network,
        ...failClosed(),
      });
    }
    const result = normalizeKytProviderResult(await response.json());
    if (!result) console.warn("wss_kyt_gateway_invalid_response", { traceId });
    return json({
      address: body.address,
      network: body.network,
      ...(result ?? failClosed()),
    });
  } catch (error) {
    console.warn("wss_kyt_gateway_request_failed", {
      traceId,
      failure: error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : "request_or_parse_error",
    });
    return json({
      address: body.address,
      network: body.network,
      ...failClosed(),
    });
  } finally {
    clearTimeout(timeout);
  }
});
