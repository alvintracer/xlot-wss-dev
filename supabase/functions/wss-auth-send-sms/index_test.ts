import {
  domesticPhone,
  senderNumber,
  sendSolapiOtp,
  solapiAuthorization,
} from "./index.ts";

Deno.test("normalizes only Korean mobile recipients", () => {
  if (domesticPhone("+82 10-1234-5678") !== "01012345678") {
    throw new Error("recipient normalization failed");
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

Deno.test("sends the Supabase Auth OTP without extra identifiers", async () => {
  let captured: Request | null = null;
  await sendSolapiOtp(
    {
      apiKey: "test-key",
      apiSecret: "test-secret",
      senderNumber: "0212345678",
    },
    "+821012345678",
    "123456",
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
  if (!body.messages?.[0]?.text.includes("123456")) {
    throw new Error("OTP missing");
  }
  if (JSON.stringify(body).includes("registrationIntent")) {
    throw new Error("internal identifier leaked");
  }
});
