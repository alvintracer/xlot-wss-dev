import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCoinMarketCapPrices } from "./index.ts";

Deno.test("CoinMarketCap fallback selects IDs and fresh KRW quotes", () => {
  const now = new Date().toISOString();
  const prices = parseCoinMarketCapPrices({
    data: [
      {
        id: 4943,
        symbol: "DAI",
        last_updated: now,
        quote: [{ symbol: "KRW", price: 1_353.4, last_updated: now }],
      },
      {
        id: 2308,
        symbol: "DAI",
        last_updated: now,
        quote: [{ symbol: "KRW", price: 500, last_updated: now }],
      },
    ],
  }, ["DAI"]);

  assertEquals(prices.get("DAI"), {
    assetKey: "DAI",
    krw: 1_353.4,
    providerKrw: "coinmarketcap",
    sourceCountKrw: 1,
    sourceUpdatedAtKrw: now,
  });
});

Deno.test("CoinMarketCap fallback rejects stale quotes", () => {
  const prices = parseCoinMarketCapPrices({
    data: [{
      id: 4943,
      symbol: "DAI",
      last_updated: "2020-01-01T00:00:00.000Z",
      quote: [{ symbol: "KRW", price: 1_353.4 }],
    }],
  }, ["DAI"]);

  assertEquals(prices.size, 0);
});
