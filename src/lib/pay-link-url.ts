/**
 * Stable OS pay link for an invoice: `/pay/RCP-XXXX` (full balance) or
 * `/pay/RCP-XXXX?pct=50` (percentage of the open balance, e.g. a deposit).
 *
 * The amount is computed when the client clicks, not when the link is created,
 * so the same URL stays correct after the job value changes or a partial
 * payment lands. Client-safe: no Stripe import here.
 */
const PAY_LINK_BASE =
  process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
  "https://app.getfixfy.com";

export function invoicePayLinkUrl(reference: string, pct?: number): string {
  const ref = encodeURIComponent(reference.trim());
  const p = Math.round(Number(pct));
  const suffix = Number.isFinite(p) && p >= 1 && p <= 99 ? `?pct=${p}` : "";
  return `${PAY_LINK_BASE}/pay/${ref}${suffix}`;
}
