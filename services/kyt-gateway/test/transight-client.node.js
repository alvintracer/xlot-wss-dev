import assert from "node:assert/strict";
import test from "node:test";
import { createAes256CbcCodec } from "../lib/aes-cbc.js";
import {
  normalizeTransightResult,
  TransightClient,
  transightTransactionNumber,
  transightTransactionTime,
} from "../lib/transight-client.js";

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const encryptionCodec = createAes256CbcCodec({
  key: "0123456789abcdef0123456789abcdef",
  iv: "abcdef0123456789",
});

const encryptedResponse = (body, status = 200) => new Response(
  encryptionCodec.encryptUtf8(JSON.stringify(body)),
  {
    status,
    headers: { "content-type": "text/plain; charset=UTF-8" },
  },
);

test("formats KST transaction time and 20-character unique transaction number", () => {
  const date = new Date("2026-09-28T00:01:02.000Z");
  assert.equal(transightTransactionTime(date), "20260928090102");
  assert.match(transightTransactionNumber(date), /^TW260928090102[0-9A-F]{6}$/);
  assert.equal(transightTransactionNumber(date).length, 20);
});

test("issues one OAuth token, calls wallet, and normalizes provider risk", async () => {
  const calls = [];
  const client = new TransightClient({
    baseUrl: "https://t-api.transight.io",
    tokenUrl: "https://t-api.transight.io/oauth/token",
    clientId: "client-id",
    clientSecret: "client-secret",
    now: () => Date.parse("2026-09-28T00:01:02.000Z"),
    rateGate: { schedule: (task) => task() },
    payloadEncryptionMode: "aes-256-cbc-base64-raw",
    encryptionCodec,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/oauth/token")) {
        return jsonResponse({
          rspCode: "A0000",
          access_token: "provider-token",
          token_type: "bearer",
          expires_in: 3600,
        });
      }
      return encryptedResponse({
        rspCode: "A0000",
        isDenylist: "N",
        riskLevel: null,
        riskScore: null,
        isTrackedDenylist: "Y",
        trackedRiskLevel: "HIGH",
        trackedRiskScore: 66.14,
        trackedRaCode2: "CS",
        trackedDenylistCount: 1,
        trackedDenylistList: [{ comments: "must not be forwarded" }],
      });
    },
  });

  const first = await client.screenAddress(
    "0x0000000000000000000000000000000000000000",
  );
  const second = await client.screenAddress(
    "0x1111111111111111111111111111111111111111",
  );

  assert.equal(calls.filter((call) => call.url.endsWith("/oauth/token")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/wallet")).length, 2);
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    scope: "ORG_CLIENT",
    grant_type: "client_credentials",
  });
  assert.equal(
    calls[1].init.headers["Content-Type"],
    "text/plain; charset=UTF-8",
  );
  assert.equal(calls[1].init.body.startsWith("{"), false);
  assert.equal(/\s/.test(calls[1].init.body), false);
  assert.equal(
    Buffer.from(calls[1].init.body, "base64").toString("base64"),
    calls[1].init.body,
  );
  const providerBody = JSON.parse(encryptionCodec.decryptUtf8(calls[1].init.body));
  assert.equal("maxHopCount" in providerBody, false);
  assert.equal(providerBody.tranDtm, "20260928090102");
  assert.equal(providerBody.tranNo.length, 20);
  assert.equal(providerBody.walletAddress, "0x0000000000000000000000000000000000000000");
  assert.deepEqual(first, {
    risk_score: 66.14,
    is_sanctioned: false,
    flags: [{
      category: "CS",
      severity: "HIGH",
      description: "1-hop 고위험 연관 주소 1건이 확인되었습니다.",
    }],
    provider: "transight",
    provider_code: "A0000",
    direct_denylist: false,
    tracked_denylist: true,
  });
  assert.equal("comments" in first, false);
  assert.equal(second.provider_code, "A0000");
});

test("direct regulatory denylist is always critical and sanctioned", () => {
  const result = normalizeTransightResult({
    rspCode: "A0000",
    isDenylist: "Y",
    dataType: "RDL",
    riskScore: 20,
    denylistDetail: {
      raCode2: "OIS",
      raCode2Kor: "공식 국제적 제재대상",
    },
    isTrackedDenylist: "N",
  });
  assert.equal(result.risk_score, 100);
  assert.equal(result.is_sanctioned, true);
  assert.equal(result.flags[0].severity, "CRITICAL");
});

test("rejects an unapproved upstream origin", () => {
  assert.throws(
    () => new TransightClient({
      baseUrl: "https://example.com",
      tokenUrl: "https://example.com/oauth/token",
      clientId: "client",
      clientSecret: "secret",
    }),
    /approved TranSight HTTPS endpoint/,
  );
});
