import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};
const providerUrl = Deno.env.get("WSS_TRANSIGHT_API_URL") ||
  Deno.env.get("TRANSIGHT_API_URL");
const providerKey = Deno.env.get("WSS_TRANSIGHT_API_KEY") ||
  Deno.env.get("TRANSIGHT_API_KEY");

type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

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

function riskLevel(score: number, sanctioned: boolean): RiskLevel {
  if (sanctioned || score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
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

function normalize(payload: Record<string, unknown>) {
  const score = Number(payload.risk_score ?? 0);
  const sanctioned = payload.is_sanctioned === true;
  const level = riskLevel(Number.isFinite(score) ? score : 0, sanctioned);
  return {
    riskScore: Number.isFinite(score) ? score : 0,
    riskLevel: level,
    flags: Array.isArray(payload.flags)
      ? payload.flags.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const flag = item as Record<string, unknown>;
        return [{
          category: String(flag.category ?? "UNKNOWN"),
          severity: String(flag.severity ?? "LOW"),
          description: String(flag.description ?? ""),
        }];
      })
      : [],
    isSanctioned: sanctioned,
    isBlocked: sanctioned || level === "CRITICAL",
    kytAvailable: true,
    screenedAt: Date.now(),
  };
}

serve(async (request) => {
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
    console.warn("wss_kyt_provider_unconfigured");
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
          "X-Request-ID": crypto.randomUUID(),
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
      return json({
        address: body.address,
        network: body.network,
        ...failClosed(),
      });
    }
    const result = normalize(await response.json() as Record<string, unknown>);
    return json({ address: body.address, network: body.network, ...result });
  } catch {
    return json({
      address: body.address,
      network: body.network,
      ...failClosed(),
    });
  } finally {
    clearTimeout(timeout);
  }
});
