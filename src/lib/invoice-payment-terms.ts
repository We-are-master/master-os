/**
 * Maps account payment terms (Accounts UI: Net 7/15/30/60, Due on Receipt) to days after invoice date.
 * Unknown or empty strings default to Net 30.
 */
export function daysFromPaymentTerms(paymentTerms: string | null | undefined): number {
  const raw = paymentTerms?.trim();
  if (!raw) return 30;
  if (/due\s+on\s+receipt/i.test(raw)) return 0;
  const m = raw.match(/net\s+(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return Math.min(365, Math.max(0, n));
  }
  return 30;
}

/** YYYY-MM-DD for `base` + payment terms days (UTC date components from local calendar day). */
export function dueDateIsoFromPaymentTerms(base: Date, paymentTerms: string | null | undefined): string {
  const days = daysFromPaymentTerms(paymentTerms);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
