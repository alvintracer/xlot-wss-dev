import {
  consumeSmsBrand,
  domesticPhone,
  safeSmsFailureCode,
  senderNumber,
  sendSolapiOtp,
  smsPhoneKey,
  solapiAuthorization,
} from "./index.ts";

Deno.test("normalizes only Korean mobile recipients", () => {
  if (domesticPhone("+82 10-1234-5678") !== "01012345678") {
    throw new Error("E.164 recipient normalization failed");
  }
  if (domesticPhone("821012345678") !== "01012345678") {
    throw new Error("international digits recipient normalization failed");
  }
  if (domesticPhone("010-1234-5678") !== "01012345678") {
    throw new Error("national recipient normalization failed");
  }
  let rejected = false;
  try {
    domesticPhone("+14155552671");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("non-Korean recipient accepted");
});

Deno.test("normalizes the registered sender", () => {
  if (senderNumber("02-1234-5678") !== "0212345678") {
    throw new Error("sender normalization failed");
  }
});

Deno.test("creates the documented SOLAPI HMAC authorization", async () => {
  const authorization = await solapiAuthorization(
    "test-key",
    "test-secret",
    "2026-07-31T00:00:00.000Z",
    "1234567890abcdef",
  );
  const expected =
    "HMAC-SHA256 apiKey=test-key, date=2026-07-31T00:00:00.000Z, salt=1234567890abcdef, signature=0388a52bdb686f53bd3c7f205104cd62a894cfb5638095b8924661140d7ea056";
  if (authorization !== expected) throw new Error("authorization mismatch");
});

Deno.test("sends the requested tenant name without extra identifiers", async () => {
  for (
    const brandName of [
      "키움 디지털 월렛",
      "JB 디지털 지갑",
      "나무 내 지갑",
    ]
  ) {
    let captured: Request | null = null;
    await sendSolapiOtp(
      {
        apiKey: "test-key",
        apiSecret: "test-secret",
        senderNumber: "0212345678",
      },
      "+821012345678",
      "123456",
      brandName,
      (input, init) => {
        captured = new Request(input, init);
        return Promise.resolve(Response.json({
          messageList: [{ messageId: "message-1", statusCode: "2000" }],
        }));
      },
    );
    if (!captured) throw new Error("request not captured");
    const body = await (captured as Request).json();
    if (body.messages?.[0]?.to !== "01012345678") {
      throw new Error("recipient mismatch");
    }
    if (
      body.messages?.[0]?.text !==
        `[${brandName}] 인증번호는 123456입니다. 타인에게 알려주지 마세요.`
    ) {
      throw new Error("incorrect tenant SMS copy");
    }
    if (JSON.stringify(body).includes("registrationIntent")) {
      throw new Error("internal identifier leaked");
    }
  }
});

Deno.test("consumes only the matching one-use SMS context", async () => {
  const firstKey = await smsPhoneKey("+82 10-1234-5678", "lookup-secret");
  const secondKey = await smsPhoneKey("01012345678", "lookup-secret");
  if (firstKey !== secondKey || !/^[0-9a-f]{64}$/.test(firstKey)) {
    throw new Error("phone context keys differ by format");
  }
  let captured: Request | null = null;
  const brand = await consumeSmsBrand(
    "+821012345678",
    {
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-only-key",
      phoneLookupSecret: "lookup-secret",
    },
    (input, init) => {
      captured = new Request(input, init);
      return Promise.resolve(Response.json([{ brand_name: "나무 내 지갑" }]));
    },
  );
  if (brand !== "나무 내 지갑" || !captured) {
    throw new Error("context brand mismatch");
  }
  const request = captured as Request;
  if (
    request.method !== "DELETE" ||
    new URL(request.url).searchParams.get("phone_key") !== `eq.${firstKey}` ||
    request.headers.get("prefer") !== "return=representation"
  ) {
    throw new Error("context is not consumed atomically");
  }
});

Deno.test("rejects an OTP without an active delivery context", async () => {
  let rejected = false;
  try {
    await consumeSmsBrand(
      "+821012345678",
      {
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "server-only-key",
        phoneLookupSecret: "lookup-secret",
      },
      () => Promise.resolve(Response.json([])),
    );
  } catch (error) {
    rejected = safeSmsFailureCode(error) === "sms_context_missing";
  }
  if (!rejected) throw new Error("missing delivery context accepted");
});

Deno.test("keeps SOLAPI rejection diagnostics free of provider payloads", async () => {
  let failure: unknown;
  try {
    await sendSolapiOtp(
      {
        apiKey: "test-key",
        apiSecret: "test-secret",
        senderNumber: "0212345678",
      },
      "+821012345678",
      "123456",
      "키움 디지털 월렛",
      () =>
        Promise.resolve(Response.json({
          failedMessageList: [{
            statusCode: "3040",
            statusMessage: "provider detail must not be logged",
          }],
        })),
    );
  } catch (error) {
    failure = error;
  }
  if (safeSmsFailureCode(failure) !== "solapi_http_200_3040") {
    throw new Error("safe provider rejection code was not preserved");
  }
});

Deno.test("redacts unexpected errors from SMS diagnostics", () => {
  const code = safeSmsFailureCode(
    new Error("phone=01012345678 otp=123456 secret=do-not-log"),
  );
  if (code !== "unexpected") throw new Error("unexpected detail leaked");
});
