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

// ─── Partner-scoped tokens (report submission + bid) ─────────────────────────
// Both bind quoteId + partnerId so a leaked link can only act on behalf of
// that exact partner. A `kind` prefix distinguishes the two so a bid token
// can't be reused as a report token (and vice-versa).

type PartnerTokenKind = "report" | "bid";

function makePartnerToken(kind: PartnerTokenKind, quoteId: string, partnerId: string): string {
  const secret = getSecret();
  const joined = `${kind}:${quoteId}:${partnerId}`;
  const payload = Buffer.from(joined, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(joined).digest("base64url");
  return `${payload}${TOKEN_SEP}${sig}`;
}

function verifyPartnerToken(
  token: string,
  expectedKind: PartnerTokenKind,
): { quoteId: string; partnerId: string } | null {
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
  const parts = joined.split(":");
  if (parts.length < 3) return null;
  const [kind, quoteId, partnerId] = parts;
  if (kind !== expectedKind || !quoteId || !partnerId) return null;
  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(joined).digest("base64url");
  if (sig !== expected) return null;
  return { quoteId, partnerId };
}

/** Backwards-compatible verifier that accepts the pre-`kind:` two-part
 * partner-report token alongside the new prefixed form. New code should
 * prefer createPartnerReportToken (which now emits the prefixed form). */
function verifyLegacyPartnerToken(token: string): { quoteId: string; partnerId: string } | null {
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
  const parts = joined.split(":");
  if (parts.length !== 2) return null;
  const [quoteId, partnerId] = parts;
  if (!quoteId || !partnerId) return null;
  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(joined).digest("base64url");
  if (sig !== expected) return null;
  return { quoteId, partnerId };
}

export function createPartnerReportToken(quoteId: string, partnerId: string): string {
  return makePartnerToken("report", quoteId, partnerId);
}
export function verifyPartnerReportToken(token: string): { quoteId: string; partnerId: string } | null {
  return verifyPartnerToken(token, "report") ?? verifyLegacyPartnerToken(token);
}

export function createPartnerBidToken(quoteId: string, partnerId: string): string {
  return makePartnerToken("bid", quoteId, partnerId);
}
export function verifyPartnerBidToken(token: string): { quoteId: string; partnerId: string } | null {
  return verifyPartnerToken(token, "bid");
}
