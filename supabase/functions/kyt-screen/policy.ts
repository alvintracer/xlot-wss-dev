type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function riskLevel(score: number, sanctioned: boolean): RiskLevel {
  if (sanctioned || score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

export function normalizeKytProviderResult(value: unknown) {
  const payload = record(value);
  if (
    !payload || payload.provider !== "transight" ||
    payload.provider_code !== "A0000" ||
    typeof payload.risk_score !== "number" ||
    !Number.isFinite(payload.risk_score) ||
    payload.risk_score < 0 || payload.risk_score > 100 ||
    typeof payload.is_sanctioned !== "boolean" ||
    typeof payload.direct_denylist !== "boolean" ||
    typeof payload.tracked_denylist !== "boolean" ||
    !Array.isArray(payload.flags)
  ) return null;

  const score = payload.risk_score;
  const sanctioned = payload.is_sanctioned;
  const blocked = sanctioned || payload.direct_denylist || score >= 75;
  const flags = payload.flags.slice(0, 8).flatMap((item) => {
    const flag = record(item);
    if (!flag) return [];
    const category = typeof flag.category === "string"
      ? flag.category.trim().slice(0, 32)
      : "UNKNOWN";
    const severity = typeof flag.severity === "string"
      ? flag.severity.trim().slice(0, 16)
      : "LOW";
    const description = typeof flag.description === "string"
      ? flag.description.trim().slice(0, 160)
      : "";
    return [{ category: category || "UNKNOWN", severity, description }];
  });
  const addedDate =
    payload.direct_denylist && typeof payload.added_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(payload.added_date)
      ? payload.added_date
      : null;
  const riskCategory =
    payload.direct_denylist && typeof payload.ra_code2_kor === "string" &&
      payload.ra_code2_kor.trim().length <= 80
      ? payload.ra_code2_kor.trim()
      : null;
  return {
    riskScore: score,
    riskLevel: riskLevel(score, blocked),
    flags,
    isSanctioned: sanctioned,
    isBlocked: blocked,
    kytAvailable: true,
    screenedAt: Date.now(),
    ...(addedDate ? { identifiedAt: addedDate } : {}),
    ...(riskCategory ? { riskCategory } : {}),
  };
}
