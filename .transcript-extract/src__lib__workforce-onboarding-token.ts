import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const secret =
    process.env.WORKFORCE_ONBOARDING_SECRET?.trim() ||
    process.env.PARTNER_UPLOAD_SECRET?.trim() ||
    process.env.QUOTE_RESPONSE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("WORKFORCE_ONBOARDING_SECRET must be set");
    return "dev-only-insecure-placeholder";
  }
  return secret;
}

const TOKEN_SEP = ".";
const PAYLOAD_SEP = "|";

export interface WorkforceOnboardingTokenPayload {
  requestId: string;
  payrollInternalCostId: string;
}

export function createWorkforceOnboardingToken(payload: WorkforceOnboardingTokenPayload): string {
  const raw = `${payload.requestId}${PAYLOAD_SEP}${payload.payrollInternalCostId}`;
  const encoded = Buffer.from(raw, "utf8").toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(raw).digest("base64url");
  return `${encoded}${TOKEN_SEP}${sig}`;
}

export function verifyWorkforceOnboardingToken(token: string): WorkforceOnboardingTokenPayload | null {
  const i = token.indexOf(TOKEN_SEP);
  if (i <= 0) return null;
  const encoded = token.slice(0, i);
  const sig = token.slice(i + 1);
  let raw: string;
  try {
    raw = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = raw.split(PAYLOAD_SEP);
  if (parts.length !== 2) return null;
  const [requestId, payrollInternalCostId] = parts;
  if (!requestId || !payrollInternalCostId) return null;
  const expected = createHmac("sha256", getSecret()).update(raw).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { requestId, payrollInternalCostId };
}
