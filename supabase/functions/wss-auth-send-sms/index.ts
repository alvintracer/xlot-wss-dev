import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

interface SendSmsHookPayload {
  user?: { phone?: unknown };
  sms?: { otp?: unknown };
}

interface SolapiPayload {
  errorCode?: string;
  groupInfo?: { groupId?: string };
  messageList?: Array<{ messageId?: string; statusCode?: string }>;
  failedMessageList?: Array<{ statusCode?: string }>;
}

export interface SolapiConfiguration {
  apiKey: string;
  apiSecret: string;
  senderNumber: string;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function domesticPhone(value: string): string {
  const normalized = value.replace(/[\s()-]/g, "");
  if (/^010\d{8}$/.test(normalized)) return normalized;
  const international = normalized.match(/^\+?82(10\d{8})$/);
  if (international) return `0${international[1]}`;
  throw new Error("unsupported_recipient");
}

export function senderNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{8,12}$/.test(digits)) throw new Error("invalid_sender");
  return digits;
}

export async function solapiAuthorization(
  apiKey: string,
  apiSecret: string,
  date = new Date().toISOString(),
  salt = crypto.randomUUID().replaceAll("-", ""),
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = bytesToHex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${date}${salt}`),
    ),
  );
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function sendSolapiOtp(
  configuration: SolapiConfiguration,
  phone: string,
  otp: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!/^\d{6}$/.test(otp)) throw new Error("invalid_otp_shape");
  const response = await fetcher(
    "https://api.solapi.com/messages/v4/send-many/detail",
    {
      method: "POST",
      headers: {
        authorization: await solapiAuthorization(
          configuration.apiKey,
          configuration.apiSecret,
        ),
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        messages: [{
          to: domesticPhone(phone),
          from: senderNumber(configuration.senderNumber),
          text:
            `[키움 디지털 월렛] 인증번호는 ${otp}입니다. 타인에게 알려주지 마세요.`,
          autoTypeDetect: true,
          country: "82",
          customFields: { purpose: "wss-phone-possession" },
        }],
        showMessageList: true,
      }),
    },
  );
  const payload = await response.json().catch(() => ({})) as SolapiPayload;
  const accepted = payload.messageList?.some((message) =>
    message.statusCode === "2000" && typeof message.messageId === "string"
  );
  if (!response.ok || !accepted) {
    const rawProviderCode = payload.failedMessageList?.[0]?.statusCode ??
      payload.errorCode ?? "unknown";
    const providerCode = /^[A-Za-z0-9_-]{1,64}$/.test(rawProviderCode)
      ? rawProviderCode
      : "unknown";
    throw new Error(
      `solapi_rejected_http_${response.status}:${providerCode}`,
    );
  }
}

export function safeSmsFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "sms_hook_not_configured" ||
    message === "unsupported_recipient" ||
    message === "invalid_sender" ||
    message === "invalid_otp_shape"
  ) {
    return message;
  }
  const providerFailure = message.match(
    /^solapi_rejected_http_(\d{3}):([A-Za-z0-9_-]{1,64})$/,
  );
  if (providerFailure) {
    return `solapi_http_${providerFailure[1]}_${providerFailure[2]}`;
  }
  return "unexpected";
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("sms_hook_not_configured");
  return value;
}

function verifyHook(request: Request, payload: string): SendSmsHookPayload {
  const rawSecret = requiredEnvironment("WSS_AUTH_SEND_SMS_HOOK_SECRET");
  const hookSecret = rawSecret.replace(/^v1,whsec_/, "");
  return new Webhook(hookSecret).verify(
    payload,
    Object.fromEntries(request.headers),
  ) as SendSmsHookPayload;
}

export async function handle(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  try {
    const payload = await request.text();
    const event = verifyHook(request, payload);
    if (
      typeof event.user?.phone !== "string" ||
      typeof event.sms?.otp !== "string"
    ) {
      return json(400, { error: "invalid_hook_payload" });
    }
    await sendSolapiOtp(
      {
        apiKey: requiredEnvironment("WSS_SOLAPI_API_KEY"),
        apiSecret: requiredEnvironment("WSS_SOLAPI_API_SECRET"),
        senderNumber: requiredEnvironment("WSS_SOLAPI_SENDER_NUMBER"),
      },
      event.user.phone,
      event.sms.otp,
    );
    return json(200, {});
  } catch (error) {
    // Phone numbers, OTPs, provider payloads, and credentials are deliberately
    // excluded from logs and responses.
    console.error(JSON.stringify({
      event: "wss_auth_sms_delivery_failed",
      code: safeSmsFailureCode(error),
    }));
    return json(500, { error: "sms_delivery_failed" });
  }
}

if (import.meta.main) Deno.serve(handle);
