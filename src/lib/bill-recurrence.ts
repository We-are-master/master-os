import type { BillRecurrence } from "@/types/database";

/** How many future rows to generate when creating a recurring bill (pre-scheduled, not chained to “mark paid”). */
export const RECURRENCE_GENERATION_COUNTS: Record<BillRecurrence, number> = {
  weekly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 2,
};

export function addInterval(d: Date, interval: BillRecurrence): Date {
  const next = new Date(d.getTime());
  switch (interval) {
    case "weekly":
      next.setDate(next.getDate() + 7);
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
