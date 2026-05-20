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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Verifies the token and returns the quoteId, or null if invalid.
 *
 * Format-strict: customer quote tokens always carry a bare UUID v4. We
 * reject anything else even when the HMAC happens to match — without this,
 * a partner-scoped token (which signs `kind:entityId:partnerId` with the
 * same secret) would round-trip as a "valid" customer token because the
 * underlying HMAC algorithm is identical.
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
  // Customer token payload MUST be a bare UUID. Reject partner tokens that
  // happen to share the HMAC algorithm + secret.
  if (!UUID_RE.test(quoteId.trim())) return null;
  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(quoteId).digest("base64url");
  if (sig !== expected) return null;
  return quoteId;
}

// ─── Partner-scoped tokens (report submission + bid) ─────────────────────────
// Both bind a primary entity id + partnerId so a leaked link can only act on
// behalf of that exact partner. A `kind` prefix distinguishes the two so a
// bid token can't be reused as a report token (and vice-versa).
//
// Bid token  → carries (quoteId, partnerId): bids are submitted on a quote
// Report token → carries (jobId, partnerId): work reports are submitted on a job.
//   Earlier prototype tied this to quoteId — switched to jobId so jobs created
//   without a parent quote can still produce a report link.

type PartnerTokenKind = "report" | "bid" | "offer";

function makePartnerToken(kind: PartnerTokenKind, entityId: string, partnerId: string): string {
  const secret = getSecret();
  const joined = `${kind}:${entityId}:${partnerId}`;
  const payload = Buffer.from(joined, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(joined).digest("base64url");
  return `${payload}${TOKEN_SEP}${sig}`;
}

function verifyPartnerToken(
  token: string,
  expectedKind: PartnerTokenKind,
): { entityId: string; partnerId: string } | null {
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
  const [kind, entityId, partnerId] = parts;
  if (kind !== expectedKind || !entityId || !partnerId) return null;
  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(joined).digest("base64url");
  if (sig !== expected) return null;
  return { entityId, partnerId };
}

export function createPartnerReportToken(jobId: string, partnerId: string): string {
  return makePartnerToken("report", jobId, partnerId);
}
export function verifyPartnerReportToken(token: string): { jobId: string; partnerId: string } | null {
  const v = verifyPartnerToken(token, "report");
  return v ? { jobId: v.entityId, partnerId: v.partnerId } : null;
}

export function createPartnerBidToken(quoteId: string, partnerId: string): string {
  return makePartnerToken("bid", quoteId, partnerId);
}
export function verifyPartnerBidToken(token: string): { quoteId: string; partnerId: string } | null {
  const v = verifyPartnerToken(token, "bid");
  return v ? { quoteId: v.entityId, partnerId: v.partnerId } : null;
}

/** Partner offer (accept/decline) token — bound to (jobId, partnerId). The
 *  public response page lets the partner accept or decline the job assignment;
 *  reassigning to another partner invalidates older links since they encode
 *  the partner_id we issued. */
export function createPartnerOfferToken(jobId: string, partnerId: string): string {
  return makePartnerToken("offer", jobId, partnerId);
}
export function verifyPartnerOfferToken(token: string): { jobId: string; partnerId: string } | null {
  const v = verifyPartnerToken(token, "offer");
  return v ? { jobId: v.entityId, partnerId: v.partnerId } : null;
}
