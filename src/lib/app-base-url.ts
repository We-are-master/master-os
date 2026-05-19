/**
 * Canonical absolute URL for the OS deployment, used when building links
 * that ship to external surfaces (Zendesk side conversations, customer
 * emails, partner SMS, etc.). Those surfaces cannot resolve relative URLs
 * — Zendesk in particular prefixes a bare `/r/<slug>` with its own host
 * (`https://fixfy.zendesk.com/...`) instead of ours.
 *
 * Priority:
 *   1. `NEXT_PUBLIC_APP_URL` env var (preferred — set per environment).
 *   2. Hardcoded `https://app.getfixfy.com` production host as a defensive
 *      fallback when the env is missing.
 *
 * Always returns a trimmed, no-trailing-slash absolute URL, so callers
 * can safely do `${appBaseUrl()}${shortPath}`.
 */
const FALLBACK = "https://app.getfixfy.com";

export function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (raw) return raw;
  return FALLBACK;
}
