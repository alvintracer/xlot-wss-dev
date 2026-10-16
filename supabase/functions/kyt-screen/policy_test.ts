import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normalizeKytProviderResult } from "./policy.ts";

Deno.test("direct TranSight evidence reaches the customer response without private fields", () => {
  const result = normalizeKytProviderResult({
    provider: "transight",
    provider_code: "A0000",
    risk_score: 100,
    is_sanctioned: false,
    direct_denylist: true,
    tracked_denylist: false,
    flags: [{
      category: "VP",
      severity: "CRITICAL",
      description: "보이스피싱",
    }],
    added_date: "2026-05-23",
    ra_code2_kor: "보이스피싱",
    comments: "private complaint",
    evidence_image: "private evidence",
  });
  assertEquals(result?.isBlocked, true);
  assertEquals(result?.identifiedAt, "2026-05-23");
  assertEquals(result?.riskCategory, "보이스피싱");
  assertEquals("comments" in (result ?? {}), false);
  assertEquals("evidence_image" in (result ?? {}), false);
});

Deno.test("invalid or incomplete gateway responses fail closed", () => {
  assertEquals(
    normalizeKytProviderResult({
      provider: "transight",
      provider_code: "A0000",
    }),
    null,
  );
  assertEquals(
    normalizeKytProviderResult({
      provider: "transight",
      provider_code: "A1002",
      risk_score: 0,
    }),
    null,
  );
});
