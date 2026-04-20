/**
 * Maps account payment terms to due dates.
 * Supports:
 *   - Standard: Net 7/15/30/60/45, Due on Receipt, Every N days, Every Friday, Every 2 weeks on Friday
 *   - Cycle-based: "Monthly cutoff N pay Weekday" and "Every 2 weeks cutoff Weekday pay Weekday"
 * Unknown/empty strings default to Net 30.
 */

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

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

/** Next occurrence of `weekdayName` on or after `base` (local calendar). Returns base if already that day. */
function nextWeekdayOnOrAfter(base: Date, weekdayName: string): string {
  const target = WEEKDAY_NAMES.indexOf(weekdayName.toLowerCase() as typeof WEEKDAY_NAMES[number]);
  if (target === -1) return nextFridayOnOrAfter(base);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const add = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  return isoDateFromLocalDate(d);
}

/** Next Friday on or after `base` (local calendar). If `base` is Friday, returns that day. */
export function nextFridayOnOrAfter(base: Date): string {
  return nextWeekdayOnOrAfter(base, "friday");
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

/** True when account terms mean one consolidated invoice per calendar week. */
export function isWeeklyConsolidatedTerms(paymentTerms: string | null | undefined): boolean {
  const t = paymentTerms?.trim() ?? "";
  if (/every\s+\d+\s+days/i.test(t)) return true;
  if (/every\s+friday/i.test(t) && !/2\s*weeks/i.test(t)) return true;
  return false;
}

/** YYYY-MM-DD for `base` + payment terms (local calendar). */
export function dueDateIsoFromPaymentTerms(base: Date, paymentTerms: string | null | undefined): string {
  const raw = paymentTerms?.trim() ?? "";

  // ── Cycle-based: "Monthly cutoff N pay Weekday" ──────────────────────────
  // e.g. "Monthly cutoff 26 pay Friday"
  // Jobs completed ≤ day N → next Weekday after day N this month
  // Jobs completed > day N → next Weekday after day N next month
  const monthlyCutoff = raw.match(/monthly\s+cutoff\s+(\d+)\s+pay\s+(\w+)/i);
  if (monthlyCutoff) {
    const cutoffDay = Math.min(28, Math.max(1, parseInt(monthlyCutoff[1], 10)));
    const payWeekday = monthlyCutoff[2].toLowerCase();
    let cycleMonth = base.getMonth();
    let cycleYear = base.getFullYear();
    if (base.getDate() > cutoffDay) {
      cycleMonth++;
      if (cycleMonth > 11) { cycleMonth = 0; cycleYear++; }
    }
    const cutoffDate = new Date(cycleYear, cycleMonth, cutoffDay);
    return nextWeekdayOnOrAfter(cutoffDate, payWeekday);
  }

  // ── Cycle-based: "Every 2 weeks cutoff Weekday pay Weekday [ref YYYY-MM-DD]"
  // Optional "ref" anchor date makes the 14-day rhythm deterministic.
  // Without it, falls back to weekday-comparison heuristic (may be off by a week).
  const biweeklyCutoff = raw.match(/every\s+2\s+weeks?\s+cutoff\s+(\w+)\s+pay\s+(\w+)(?:\s+ref\s+(\d{4}-\d{2}-\d{2}))?/i);
  if (biweeklyCutoff) {
    const cutoffWeekday = biweeklyCutoff[1].toLowerCase();
    const payWeekday   = biweeklyCutoff[2].toLowerCase();
    const refStr       = biweeklyCutoff[3];

    if (refStr) {
      // Precise path: count 14-day periods from refDate to base
      const refDate  = new Date(refStr + "T00:00:00");
      const baseLocal = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const daysDiff  = Math.round((baseLocal.getTime() - refDate.getTime()) / 86_400_000);
      if (daysDiff >= 0) {
        const periods   = Math.ceil(daysDiff / 14);  // 0 when base==refDate
        const nextCutoff = addDaysLocal(refDate, periods * 14);
        return nextWeekdayOnOrAfter(nextCutoff, payWeekday);
      }
      // base is before refDate — fall through to heuristic
    }

    // Heuristic fallback (no ref date stored)
    const cutoffNum = WEEKDAY_NAMES.indexOf(cutoffWeekday as typeof WEEKDAY_NAMES[number]);
    if (cutoffNum !== -1) {
      // Mon-based comparison: Mon=0…Sun=6
      const normalBase   = (base.getDay() + 6) % 7;
      const normalCutoff = (cutoffNum + 6) % 7;
      const anchor = normalBase > normalCutoff ? addDaysLocal(base, 14) : base;
      return nextWeekdayOnOrAfter(anchor, payWeekday);
    }
  }

  // ── Legacy patterns ───────────────────────────────────────────────────────
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
  return isoDateFromLocalDate(addDaysLocal(base, days));
}
