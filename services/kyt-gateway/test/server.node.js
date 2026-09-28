import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";

const testEnv = {
  INTERNAL_GATEWAY_TOKEN: "a".repeat(64),
  TRANSIGHT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  TRANSIGHT_ENCRYPTION_IV: "abcdef0123456789",
  TRANSIGHT_PAYLOAD_ENCRYPTION_MODE: "documented-json",
};

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test("health is public but screening requires the independent gateway key", async (context) => {
  const calls = [];
  const app = createApp({
    env: testEnv,
    transightClient: {
      async screenAddress(address) {
        calls.push(address);
        return {
          risk_score: 0,
          is_sanctioned: false,
          flags: [],
          provider: "transight",
          provider_code: "A0000",
          direct_denylist: false,
          tracked_denylist: false,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);
  context.after(() => server.close());

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).policy, "fail-closed");

  const unauthorized = await fetch(`${baseUrl}/v1/address/screen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: "0x0000000000000000000000000000000000000000",
      asset: "ETH",
      direction: "out",
      amount_usd: 0,
    }),
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${baseUrl}/v1/address/screen`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": testEnv.INTERNAL_GATEWAY_TOKEN,
    },
    body: JSON.stringify({
      address: "0x0000000000000000000000000000000000000000",
      asset: "ETH",
      direction: "out",
      amount_usd: 0,
    }),
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).provider_code, "A0000");
  assert.equal(calls.length, 1);
});
