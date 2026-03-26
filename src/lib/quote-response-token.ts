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
