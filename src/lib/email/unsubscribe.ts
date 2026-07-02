/**
 * Signed unsubscribe tokens for cold-outbound emails. A token is
 * `base64url(email).base64url(hmac)` so the link is tamper-proof — nobody can
 * unsubscribe a third party by editing the URL.
 *
 * Secret: EMAIL_UNSUB_SECRET (falls back to CRON_SECRET so it works without
 * extra config, though a dedicated secret is recommended).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { appBaseUrl } from "@/lib/app-base-url";

function secret(): string {
  return (process.env.EMAIL_UNSUB_SECRET || process.env.CRON_SECRET || "fixfy-unsub-fallback").trim();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(email: string): string {
  return b64url(createHmac("sha256", secret()).update(email).digest());
}

export function makeUnsubscribeToken(email: string): string {
  const e = email.trim().toLowerCase();
  return `${b64url(Buffer.from(e))}.${sign(e)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [ePart, sigPart] = token.split(".");
  if (!ePart || !sigPart) return null;
  let email: string;
  try {
    email = fromB64url(ePart).toString("utf8").trim().toLowerCase();
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(email));
  const given = Buffer.from(sigPart);
  if (expected.length !== given.length) return null;
  return timingSafeEqual(expected, given) ? email : null;
}

export function unsubscribeUrl(email: string): string {
  return `${appBaseUrl()}/api/email/unsubscribe?e=${encodeURIComponent(makeUnsubscribeToken(email))}`;
}
