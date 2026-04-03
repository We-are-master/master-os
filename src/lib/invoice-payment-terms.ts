/**
 * Maps account payment terms (Accounts UI: Net 7/15/30/60, Due on Receipt, Every N days, Fridays, 45 days)
 * to due dates. "Every N days" uses the same offset as Net N for due-date purposes; weekly consolidation is handled separately.
 * Unknown or empty strings default to Net 30.
 */

function isoDateFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function addDaysLocal(base: Date, n: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/** Next Friday on or after `base` (local calendar). If `base` is Friday, returns that day. */
export function nextFridayOnOrAfter(base: Date): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const dow = d.getDay(); // 0 Sun … 5 Fri … 6 Sat
  let add = 0;
  if (dow === 5) add = 0;
  else if (dow < 5) add = 5 - dow;
  else add = 5 - dow + 7;
  d.setDate(d.getDate() + add);
  return isoDateFromLocalDate(d);
}

export function daysFromPaymentTerms(paymentTerms: string | null | undefined): number {
  const raw = paymentTerms?.trim();
  if (!raw) return 30;
  if (/due\s+on\s+receipt/i.test(raw)) return 0;
  if (/45\s*days/i.test(raw) || /^net\s*45$/i.test(raw.trim())) return 45;
  const every = raw.match(/every\s+(\d+)\s+days/i);
  if (every) {
    const n = parseInt(every[1], 10);
    if (Number.isFinite(n)) return Math.min(365, Math.max(0, n));
  }
  const m = raw.match(/net\s+(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return Math.min(365, Math.max(0, n));
  }
  return 30;
}

/** True when account terms mean one consolidated invoice per calendar week (all jobs on that account). */
export function isWeeklyConsolidatedTerms(paymentTerms: string | null | undefined): boolean {
  const t = paymentTerms?.trim() ?? "";
  if (/every\s+\d+\s+days/i.test(t)) return true;
  if (/every\s+friday/i.test(t) && !/2\s*weeks/i.test(t)) return true;
  return false;
}

/** YYYY-MM-DD for `base` + payment terms (local calendar). */
export function dueDateIsoFromPaymentTerms(base: Date, paymentTerms: string | null | undefined): string {
  const raw = paymentTerms?.trim() ?? "";

  if (/every\s+2\s*weeks\s+on\s+friday/i.test(raw)) {
    return nextFridayOnOrAfter(addDaysLocal(base, 14));
  }
  if (/every\s+friday/i.test(raw)) {
    return nextFridayOnOrAfter(base);
  }
  if (/45\s*days/i.test(raw) || /^net\s*45$/i.test(raw.trim())) {
    return isoDateFromLocalDate(addDaysLocal(base, 45));
  }

  const days = daysFromPaymentTerms(paymentTerms);
  const d = addDaysLocal(base, days);
  return isoDateFromLocalDate(d);
}
