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

/** Tooltip copy for the recurring schedule checkbox in Add bill. */
export function recurringScheduleHintText(): string {
  return (
    `Not tied to "mark paid". We pre-create up to ${RECURRENCE_GENERATION_COUNTS.weekly} weekly / ` +
    `${RECURRENCE_GENERATION_COUNTS.monthly} monthly / ${RECURRENCE_GENERATION_COUNTS.quarterly} quarterly / ` +
    `${RECURRENCE_GENERATION_COUNTS.yearly} yearly lines ahead (no automatic extension after that — add a new bill if you need more horizon). ` +
    `Approve once to approve every occurrence still pending in this series; pay each period when due, or skip/exclude in the pay run if you do not pay that month.`
  );
}

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

function dueDateWithinEnd(ymd: string, endDateYmd?: string | null): boolean {
  const end = endDateYmd?.trim();
  if (!end) return true;
  return ymd <= end;
}

/** Inclusive list of due dates starting from `firstDue` (YYYY-MM-DD), capped at `endDateYmd` when set. */
export function generateRecurringDueDates(
  firstDue: string,
  interval: BillRecurrence,
  count: number,
  endDateYmd?: string | null,
): string[] {
  if (interval === "weekly_friday" || interval === "biweekly_friday") {
    const dates: string[] = [];
    let cur = new Date(firstDue + "T12:00:00");
    if (Number.isNaN(cur.getTime())) return dueDateWithinEnd(firstDue, endDateYmd) ? [firstDue] : [];
    cur = firstFridayOnOrAfter(cur);
    const stepDays = interval === "weekly_friday" ? 7 : 14;
    for (let i = 0; i < count; i++) {
      const ymd = formatLocalYmd(cur);
      if (!dueDateWithinEnd(ymd, endDateYmd)) break;
      dates.push(ymd);
      const next = new Date(cur.getTime());
      next.setDate(next.getDate() + stepDays);
      cur = next;
    }
    return dates;
  }

  const dates: string[] = [];
  let cur = new Date(firstDue + "T12:00:00");
  if (Number.isNaN(cur.getTime())) return dueDateWithinEnd(firstDue, endDateYmd) ? [firstDue] : [];
  for (let i = 0; i < count; i++) {
    const ymd = formatLocalYmd(cur);
    if (!dueDateWithinEnd(ymd, endDateYmd)) break;
    dates.push(ymd);
    cur = addInterval(cur, interval);
  }
  return dates;
}

export function nextDueDateFrom(current: string, interval: BillRecurrence): string {
  const d = new Date(current + "T12:00:00");
  return addInterval(d, interval).toISOString().slice(0, 10);
}
