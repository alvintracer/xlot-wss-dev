import dotenv from "dotenv";
import { createTransightClientFromEnv } from "../server.js";

dotenv.config({
  path: process.env.ENV_FILE || "/etc/took-wss-kyt.env",
  quiet: true,
  override: true,
});

try {
  const result = await createTransightClientFromEnv(process.env).screenAddress(
    "0x0000000000000000000000000000000000000000",
  );
  console.log(JSON.stringify({
    ok: true,
    providerCode: result.provider_code,
    riskScore: result.risk_score,
    sanctioned: result.is_sanctioned,
    directDenylist: result.direct_denylist,
    trackedDenylist: result.tracked_denylist,
  }));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code ?? "UNKNOWN_ERROR",
    httpStatus: error?.httpStatus ?? null,
    retryable: error?.retryable ?? false,
  }));
  process.exitCode = 1;
}
