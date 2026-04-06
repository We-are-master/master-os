import type { BillRecurrence } from "@/types/database";

/** How many future rows to generate when creating a recurring bill (pre-scheduled, not chained to “mark paid”). */
export const RECURRENCE_GENERATION_COUNTS: Record<BillRecurrence, number> = {
  weekly: 26,
  weekly_friday: 26,
  biweekly_friday: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 2,
};

/** Human-readable cadence for UI (e.g. bill cards). */
export function recurrenceLabel(interval: BillRecurrence | null | undefined): string {
  if (!interval) return "—";
  const labels: Record<BillRecurrence, string> = {
    weekly: "Weekly",
    weekly_friday: "Every Friday",
    biweekly_friday: "Every 2 Fridays",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  };
  return labels[interval] ?? interval;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next Friday on or after `d` (local calendar). */
export function firstFridayOnOrAfter(d: Date): Date {
  const dow = d.getDay();
  const add = dow === 5 ? 0 : (5 - dow + 7) % 7;
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + add);
  return out;
}

export function addInterval(d: Date, interval: BillRecurrence): Date {
  const next = new Date(d.getTime());
  switch (interval) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "weekly_friday":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly_friday":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      break;
    default:
      next.setMonth(next.getMonth() + 1);
  }
  return next;
}

/** Inclusive list of due dates starting from `firstDue` (YYYY-MM-DD). */
export function generateRecurringDueDates(firstDue: string, interval: BillRecurrence, count: number): string[] {
  if (interval === "weekly_friday" || interval === "biweekly_friday") {
    const dates: string[] = [];
    let cur = new Date(firstDue + "T12:00:00");
    if (Number.isNaN(cur.getTime())) return [firstDue];
    cur = firstFridayOnOrAfter(cur);
    const stepDays = interval === "weekly_friday" ? 7 : 14;
    for (let i = 0; i < count; i++) {
      dates.push(formatLocalYmd(cur));
      const next = new Date(cur.getTime());
      next.setDate(next.getDate() + stepDays);
      cur = next;
    }
    return dates;
  }

  const dates: string[] = [];
  let cur = new Date(firstDue + "T12:00:00");
  if (Number.isNaN(cur.getTime())) return [firstDue];
  for (let i = 0; i < count; i++) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = addInterval(cur, interval);
  }
  return dates;
}

export function nextDueDateFrom(current: string, interval: BillRecurrence): string {
  const d = new Date(current + "T12:00:00");
  return addInterval(d, interval).toISOString().slice(0, 10);
}
