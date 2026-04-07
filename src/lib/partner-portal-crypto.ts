import { createHash, randomBytes } from "crypto";

/** URL token (hex). Store only `hashPartnerPortalToken(raw)` in the database. */
export function generatePartnerPortalTokenRaw(): string {
  return randomBytes(24).toString("hex");
}

/** Short lowercase code for `?code=` links (10 chars, unambiguous alphabet). */
const SHORT_CODE_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyz";

export function generatePartnerPortalShortCode(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) {
    s += SHORT_CODE_ALPHABET[bytes[i]! % SHORT_CODE_ALPHABET.length];
  }
  return s;
}

export function hashPartnerPortalToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
