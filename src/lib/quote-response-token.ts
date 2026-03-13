import { createHmac, randomBytes } from "crypto";

const SECRET = process.env.QUOTE_RESPONSE_SECRET ?? process.env.NEXTAUTH_SECRET ?? "quote-respond-secret";
const TOKEN_SEP = ".";

/**
 * Creates a signed token for the quote response link (Accept/Reject).
 * Format: base64(quoteId).hmac(quoteId)
 */
export function createQuoteResponseToken(quoteId: string): string {
  const payload = Buffer.from(quoteId, "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(quoteId).digest("base64url");
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
  const expected = createHmac("sha256", SECRET).update(quoteId).digest("base64url");
  if (sig !== expected) return null;
  return quoteId;
}
