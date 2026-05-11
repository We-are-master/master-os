import { createHmac } from "crypto";

function getSecret(): string {
  const secret =
    process.env.QUOTE_RESPONSE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Fail at request time (not build time) in production.
      throw new Error(
        "QUOTE_RESPONSE_SECRET (or NEXTAUTH_SECRET) must be set in production. " +
          "Generate one with: openssl rand -base64 32",
      );
    }
    console.warn(
      "[quote-response-token] QUOTE_RESPONSE_SECRET is not set. " +
        "Tokens are insecure and will not survive a server restart. " +
        "Set QUOTE_RESPONSE_SECRET in .env.local.",
    );
    // In local dev, use a deterministic placeholder so tokens work across
    // requests within a single process but are clearly insecure.
    return "dev-only-insecure-placeholder";
  }

  return secret;
}
const TOKEN_SEP = ".";

/**
 * Creates a signed token for the quote response link (Accept/Reject).
 * Format: base64(quoteId).hmac(quoteId)
 */
export function createQuoteResponseToken(quoteId: string): string {
  const secret = getSecret();
  const payload = Buffer.from(quoteId, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(quoteId).digest("base64url");
  return `${payload}${TOKEN_SEP}${sig}`;
}

/**
 * Verifies the token and returns the quoteId, or null if invalid.
 */
export function verifyQuoteResponseToken(token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const i = token.indexOf(TOKEN_SEP);
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  let quoteId: string;
  try {
    quoteId = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(quoteId).digest("base64url");
  if (sig !== expected) return null;
  return quoteId;
}

// ─── Partner-scoped report token ─────────────────────────────────────────────
// Used for the work-report submission link sent to the specific partner
// assigned to a job. The token binds quoteId + partnerId so a leaked link
// can only post a report for that exact partner — if the partner is
// reassigned, older links stop working.

/**
 * Creates a signed token for the partner work-report submission link.
 * Format: base64(quoteId:partnerId).hmac(quoteId:partnerId)
 */
export function createPartnerReportToken(quoteId: string, partnerId: string): string {
  const secret = getSecret();
  const joined = `${quoteId}:${partnerId}`;
  const payload = Buffer.from(joined, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(joined).digest("base64url");
  return `${payload}${TOKEN_SEP}${sig}`;
}

/**
 * Verifies a partner-report token and returns {quoteId, partnerId}, or null.
 * Distinct from verifyQuoteResponseToken: this token carries TWO ids; callers
 * must pick the right verifier based on which surface produced the link.
 */
export function verifyPartnerReportToken(token: string): { quoteId: string; partnerId: string } | null {
  if (!token || typeof token !== "string") return null;
  const i = token.indexOf(TOKEN_SEP);
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  let joined: string;
  try {
    joined = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = joined.indexOf(":");
  if (sep <= 0) return null;
  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(joined).digest("base64url");
  if (sig !== expected) return null;
  const quoteId = joined.slice(0, sep);
  const partnerId = joined.slice(sep + 1);
  if (!quoteId || !partnerId) return null;
  return { quoteId, partnerId };
}
