import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Signed token for partner self-service document/profile upload links.
 * Format: base64url(payload).hmacSha256(payload)
 * Payload is `${requestId}|${partnerId}` so the verifier knows which request
 * row to check (revoke / expiry / use_count) and which partner to scope the upload to.
 *
 * The token alone never grants access — every public route also re-checks the
 * `partner_document_requests` row server-side.
 */

function getSecret(): string {
  const secret =
    process.env.PARTNER_UPLOAD_SECRET?.trim() ||
    process.env.QUOTE_RESPONSE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PARTNER_UPLOAD_SECRET (or QUOTE_RESPONSE_SECRET / NEXTAUTH_SECRET) must be set in production. " +
          "Generate one with: openssl rand -base64 32",
      );
    }
    console.warn(
      "[partner-upload-token] PARTNER_UPLOAD_SECRET is not set. Tokens are insecure in dev.",
    );
    return "dev-only-insecure-placeholder";
  }
  return secret;
}

const TOKEN_SEP = ".";
const PAYLOAD_SEP = "|";

export interface PartnerUploadTokenPayload {
  requestId: string;
  partnerId: string;
}

export function createPartnerUploadToken(payload: PartnerUploadTokenPayload): string {
  const secret = getSecret();
  const raw = `${payload.requestId}${PAYLOAD_SEP}${payload.partnerId}`;
  const encoded = Buffer.from(raw, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(raw).digest("base64url");
  return `${encoded}${TOKEN_SEP}${sig}`;
}

export function verifyPartnerUploadToken(token: string): PartnerUploadTokenPayload | null {
  if (!token || typeof token !== "string") return null;
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
  const [requestId, partnerId] = parts;
  if (!requestId || !partnerId) return null;

  const secret = getSecret();
  const expected = createHmac("sha256", secret).update(raw).digest("base64url");
  /** Constant-time comparison — prevents timing oracles on the HMAC suffix. */
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { requestId, partnerId };
}

/**
 * Short, URL-safe slug used for the WhatsApp-friendly `/p/{slug}` link.
 * 12 base32 chars ≈ 60 bits of entropy — combined with the DB lookup + Vercel rate limits,
 * this is infeasible to brute-force. We avoid base64url to keep slugs case-insensitive
 * for users typing them in (though the DB column itself is case-sensitive).
 */
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 chars (no 0/o/1/l/i to avoid confusion)
export const SLUG_LENGTH = 12;

export function generatePartnerUploadSlug(): string {
  /** Use rejection sampling on randomBytes so the distribution stays uniform. */
  const out: string[] = [];
  const buf = randomBytes(SLUG_LENGTH * 2);
  for (let i = 0; i < buf.length && out.length < SLUG_LENGTH; i++) {
    const v = buf[i];
    if (v < SLUG_ALPHABET.length * 8) {
      out.push(SLUG_ALPHABET[v % SLUG_ALPHABET.length]);
    }
  }
  while (out.length < SLUG_LENGTH) {
    /** Extremely unlikely fallback — top up with one more byte at a time. */
    const v = randomBytes(1)[0];
    if (v < SLUG_ALPHABET.length * 8) {
      out.push(SLUG_ALPHABET[v % SLUG_ALPHABET.length]);
    }
  }
  return out.join("");
}

export function isLikelyPartnerUploadSlug(value: string): boolean {
  if (!value || value.length !== SLUG_LENGTH) return false;
  for (const ch of value) {
    if (!SLUG_ALPHABET.includes(ch)) return false;
  }
  return true;
}
