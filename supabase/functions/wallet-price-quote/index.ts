import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};
const symbolPattern = /^[A-Z0-9._-]{1,30}$/;
const maximumAgeMs = 5 * 60_000;
const marketIds: Readonly<Record<string, string>> = {
  ETH: "ethereum",
  POL: "polygon-ecosystem-token",
  BNB: "binancecoin",
  SOL: "solana",
  BTC: "bitcoin",
  TRX: "tron",
  XRP: "ripple",
  USDC: "usd-coin",
  USDT: "tether",
  RLUSD: "ripple-usd",
  DAI: "dai",
  PYUSD: "paypal-usd",
  USDG: "global-dollar",
  USDS: "usds",
  FDUSD: "first-digital-usd",
  USDP: "paxos-standard",
  GUSD: "gemini-dollar",
  XUSD: "straitsx-xusd",
  EURC: "euro-coin",
  JPYC: "jpy-coin",
  XSGD: "xsgd",
};

interface PriceResult {
  assetKey: string;
  krw: number;
  providerKrw: "bonanza" | "market-reference" | "coinmarketcap";
  sourceCountKrw: number;
  sourceUpdatedAtKrw: string;
}

const coinMarketCapIds: Readonly<Record<string, number>> = {
  BTC: 1,
  ETH: 1027,
  USDT: 825,
  BNB: 1839,
  USDC: 3408,
  XRP: 52,
  SOL: 5426,
  TRX: 1958,
  DAI: 4943,
  POL: 28321,
  RLUSD: 34387,
  EURC: 20641,
  PYUSD: 27772,
  USDG: 33793,
  USDS: 33039,
  FDUSD: 26081,
  USDP: 3330,
  GUSD: 3306,
  XUSD: 32372,
  JPYC: 40123,
  XSGD: 8489,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 7_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function fresh(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 30_000 &&
    Date.now() - timestamp <= maximumAgeMs;
}

function bonanzaEndpoint(): string | null {
  const explicit = Deno.env.get("WSS_BONANZA_PRICES_URL") ||
    Deno.env.get("TOOK_WALLET_BONANZA_PRICES_URL") ||
    Deno.env.get("TOOK_PAY_BONANZA_PRICES_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const quote = Deno.env.get("WSS_BONANZA_QUOTE_URL") ||
    Deno.env.get("TOOK_WALLET_BONANZA_GATEWAY_URL") ||
    Deno.env.get("TOOK_PAY_BONANZA_QUOTE_URL");
  return quote?.replace(/\/quote\/?$/, "/prices").replace(/\/$/, "") ?? null;
}

async function queryBonanza(
  assetKeys: string[],
): Promise<Map<string, PriceResult>> {
  const endpoint = bonanzaEndpoint();
  if (!endpoint) return new Map();
  const token = Deno.env.get("WSS_BONANZA_GATEWAY_TOKEN") ||
    Deno.env.get("TOOK_WALLET_BONANZA_GATEWAY_TOKEN") ||
    Deno.env.get("TOOK_PAY_BONANZA_GATEWAY_TOKEN");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ assetKeys, displayCurrencies: ["KRW"] }),
  });
  if (!response.ok) throw new Error(`bonanza_${response.status}`);
  const payload = await response.json() as {
    snapshots?: Array<Record<string, unknown>>;
  };
  const result = new Map<string, PriceResult>();
  for (const snapshot of payload.snapshots ?? []) {
    const assetKey = String(snapshot.assetSymbol ?? "").toUpperCase();
    const price = Number(snapshot.referencePrice);
    const sourceCount = Number(snapshot.sourceCount);
    const observedAt = String(snapshot.sourceUpdatedAt ?? "");
    if (
      !assetKeys.includes(assetKey) ||
      snapshot.provider !== "bonanza" ||
      snapshot.upstreamCode !== "A0000" ||
      String(snapshot.currency).toUpperCase() !== "KRW" ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isInteger(sourceCount) ||
      sourceCount < 1 ||
      !fresh(observedAt)
    ) continue;
    result.set(assetKey, {
      assetKey,
      krw: price,
      providerKrw: "bonanza",
      sourceCountKrw: sourceCount,
      sourceUpdatedAtKrw: observedAt,
    });
  }
  return result;
}

async function queryMarket(
  assetKeys: string[],
): Promise<Map<string, PriceResult>> {
  const pairs = assetKeys.flatMap((assetKey) =>
    marketIds[assetKey] ? [[assetKey, marketIds[assetKey]] as const] : []
  );
  if (pairs.length === 0) return new Map();
  const params = new URLSearchParams({
    ids: [...new Set(pairs.map(([, id]) => id))].join(","),
    vs_currencies: "krw",
    include_last_updated_at: "true",
  });
  const baseUrl =
    (Deno.env.get("WSS_MARKET_API_URL") || "https://api.coingecko.com").replace(
      /\/$/,
      "",
    );
  const apiKey = Deno.env.get("WSS_COINGECKO_API_KEY");
  const response = await fetchWithTimeout(
    `${baseUrl}/api/v3/simple/price?${params}`,
    {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
      },
    },
  );
  if (!response.ok) throw new Error(`market_${response.status}`);
  const payload = await response.json() as Record<
    string,
    { krw?: number; last_updated_at?: number }
  >;
  const result = new Map<string, PriceResult>();
  for (const [assetKey, id] of pairs) {
    const price = Number(payload[id]?.krw);
    const observedAtMs = Number(payload[id]?.last_updated_at) * 1_000;
    if (
      !Number.isFinite(price) || price <= 0 || !Number.isFinite(observedAtMs) ||
      observedAtMs <= 0
    ) continue;
    const observedAt = new Date(observedAtMs).toISOString();
    if (!fresh(observedAt)) continue;
    result.set(assetKey, {
      assetKey,
      krw: price,
      providerKrw: "market-reference",
      sourceCountKrw: 1,
      sourceUpdatedAtKrw: observedAt,
    });
  }
  return result;
}

interface CoinMarketCapRecord {
  id?: number;
  symbol?: string;
  last_updated?: string;
  quote?:
    | Array<{ symbol?: string; price?: number; last_updated?: string }>
    | Record<string, { price?: number; last_updated?: string }>;
}

export function parseCoinMarketCapPrices(
  payload: unknown,
  requested: readonly string[],
): Map<string, PriceResult> {
  if (!payload || typeof payload !== "object") return new Map();
  const rawData = (payload as { data?: unknown }).data;
  const records: CoinMarketCapRecord[] = Array.isArray(rawData)
    ? rawData
    : rawData && typeof rawData === "object"
    ? Object.values(rawData as Record<string, CoinMarketCapRecord>)
    : [];
  const requestedIds = new Map(
    requested.flatMap((assetKey) =>
      coinMarketCapIds[assetKey]
        ? [[coinMarketCapIds[assetKey]!, assetKey] as const]
        : []
    ),
  );
  const result = new Map<string, PriceResult>();
  for (const record of records) {
    const assetKey = record.id ? requestedIds.get(record.id) : undefined;
    if (!assetKey || record.symbol?.toUpperCase() !== assetKey) continue;
    const quote = Array.isArray(record.quote)
      ? record.quote.find((candidate) => candidate.symbol === "KRW")
      : record.quote?.KRW;
    const price = Number(quote?.price);
    const observedAt = String(quote?.last_updated ?? record.last_updated ?? "");
    if (!Number.isFinite(price) || price <= 0 || !fresh(observedAt)) continue;
    result.set(assetKey, {
      assetKey,
      krw: price,
      providerKrw: "coinmarketcap",
      sourceCountKrw: 1,
      sourceUpdatedAtKrw: observedAt,
    });
  }
  return result;
}

async function queryCoinMarketCap(
  assetKeys: string[],
): Promise<Map<string, PriceResult>> {
  const ids = assetKeys.flatMap((assetKey) =>
    coinMarketCapIds[assetKey] ? [coinMarketCapIds[assetKey]!] : []
  );
  if (ids.length === 0) return new Map();
  const apiKey = Deno.env.get("WSS_CMC_API_KEY")?.trim();
  const baseUrl = (Deno.env.get("WSS_CMC_API_URL") ||
    "https://pro-api.coinmarketcap.com").replace(/\/$/, "");
  const path = apiKey
    ? "/v3/cryptocurrency/quotes/latest"
    : "/public-api/v3/cryptocurrency/quotes/latest";
  const params = new URLSearchParams({
    id: [...new Set(ids)].join(","),
    convert: "KRW",
    skip_invalid: "true",
  });
  const response = await fetchWithTimeout(`${baseUrl}${path}?${params}`, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { "X-CMC_PRO_API_KEY": apiKey } : {}),
    },
  });
  if (!response.ok) throw new Error(`coinmarketcap_${response.status}`);
  return parseCoinMarketCapPrices(await response.json(), assetKeys);
}

async function portfolio(assetKeys: string[]) {
  let preferred = new Map<string, PriceResult>();
  try {
    preferred = await queryBonanza(assetKeys);
  } catch (error) {
    console.warn(
      "wss_quote_bonanza_unavailable",
      error instanceof Error ? error.message : "unknown",
    );
  }
  const missing = assetKeys.filter((assetKey) => !preferred.has(assetKey));
  let fallback = new Map<string, PriceResult>();
  try {
    fallback = await queryMarket(missing);
  } catch (error) {
    console.warn(
      "wss_quote_market_unavailable",
      error instanceof Error ? error.message : "unknown",
    );
  }
  const marketMissing = missing.filter((assetKey) => !fallback.has(assetKey));
  let secondaryFallback = new Map<string, PriceResult>();
  try {
    secondaryFallback = await queryCoinMarketCap(marketMissing);
  } catch (error) {
    console.warn(
      "wss_quote_coinmarketcap_unavailable",
      error instanceof Error ? error.message : "unknown",
    );
  }
  const prices = assetKeys.flatMap((assetKey) => {
    const price = preferred.get(assetKey) ?? fallback.get(assetKey) ??
      secondaryFallback.get(assetKey);
    return price ? [price] : [];
  });
  return {
    prices,
    unavailableAssets: assetKeys.filter((assetKey) =>
      !prices.some((price) => price.assetKey === assetKey)
    ),
  };
}

export async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    const body = await request.json() as {
      action?: unknown;
      assetKeys?: unknown;
      assetKey?: unknown;
      displayCurrency?: unknown;
    };
    const requested = body.action === "reference"
      ? [String(body.assetKey ?? "").trim().toUpperCase()]
      : Array.isArray(body.assetKeys)
      ? [
        ...new Set(
          body.assetKeys.map((value) => String(value).trim().toUpperCase()),
        ),
      ]
      : [];
    if (
      (body.action !== "portfolio" && body.action !== "reference") ||
      requested.length < 1 ||
      requested.length > 32 ||
      requested.some((assetKey) => !symbolPattern.test(assetKey)) ||
      (body.action === "reference" && body.displayCurrency !== "KRW")
    ) return json({ error: "invalid_quote_request" }, 400);
    const result = await portfolio(requested);
    if (body.action === "reference") {
      const price = result.prices[0];
      return price
        ? json({
          assetKey: price.assetKey,
          provider: price.providerKrw,
          referencePriceKrw: price.krw,
          sourceCount: price.sourceCountKrw,
          sourceUpdatedAt: price.sourceUpdatedAtKrw,
        })
        : json({ error: "quote_unavailable" }, 502);
    }
    return json(result);
  } catch {
    return json({ error: "quote_unavailable" }, 502);
  }
}

if (import.meta.main) serve(handle);
