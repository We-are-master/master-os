import type { Bill } from "@/types/database";
import { recurringGroupKey } from "@/lib/bill-groups";

/** "YYYY-MM" of a due date or a Date (local calendar). */
export function monthKey(d: string | Date): string {
  if (typeof d === "string") return d.slice(0, 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Month key `offset` months after `start` ("YYYY-MM"). */
export function addMonths(start: string, offset: number): string {
  const [y, m] = start.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return monthKey(d);
}

/** "Nov 26" style label for a month key. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

/**
 * A price change: from this month on (inclusive) every payment is `amount`.
 * The first step is the starting price.
 */
export type BillAmountStep = { fromMonth: string; amount: number };

/**
 * Amount of each scheduled payment of a new bill. Steps set the price from a
 * month onwards; an override changes one payment only. The result is what
 * `createBill` writes per row, so the preview and the rows read the same map.
 */
export function amountsForDueDates(
  dueDates: string[],
  steps: BillAmountStep[],
  overrides: Record<string, number> = {},
): Record<string, number> {
  const sorted = [...steps].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  const out: Record<string, number> = {};
  for (const due of dueDates) {
    if (due in overrides) {
      out[due] = overrides[due];
      continue;
    }
    const m = monthKey(due);
    let amount = sorted[0]?.amount ?? 0;
    for (const s of sorted) if (s.fromMonth <= m) amount = s.amount;
    out[due] = amount;
  }
  return out;
}

export type TimelineCell = {
  month: string;
  amount: number;
  /** Rows due in this month (to open the edit of that payment). */
  bills: Bill[];
  /** Price differs from the previous payment of the same bill. */
  changed: boolean;
  /** Last payment of the bill. */
  last: boolean;
  /** No row in the DB yet: an ongoing bill carried forward at its last amount. */
  projected: boolean;
};

export type TimelineRow = {
  key: string;
  title: string;
  isSeries: boolean;
  cells: TimelineCell[];
  /** Last due date of the bill (null when it has none). */
  endYmd: string | null;
  /** Never really ends (payroll, subscriptions): carried to the end of the timeline. */
  ongoing: boolean;
};

/** Series scheduled this far ahead are a forecast horizon, not a real end date. */
const ONGOING_HORIZON_MONTHS = 24;

/**
 * A bill that does not really end. Payroll always; any other recurring bill
 * except debit when it has no end date or is scheduled two years or more ahead
 * (subscriptions get a horizon at creation, not an end). Debit (loans,
 * financing) has a real last instalment, and so does a series that stops soon.
 */
export function isOngoingBill(last: Bill, todayMonth: string): boolean {
  if (!last.is_recurring) return false;
  if (last.category === "payroll_related") return true;
  if (last.category === "debit") return false;
  if (!last.recurring_series_end_date) return true;
  return monthKey(last.due_date) >= addMonths(todayMonth, ONGOING_HORIZON_MONTHS);
}

/**
 * One row per bill with the amount due in each month. Recurring series with the
 * same name and category share a row, so a price change saved as a second
 * series (Checkatrade £688 then £1,000) reads as one bill. Archived and rejected
 * rows are left out, like the cost KPIs.
 *
 * Without `months`, the timeline runs until the last bill that really ends
 * (loans, one-offs, short series). Ongoing bills (payroll, subscriptions) do not
 * set the end: they follow it, carried forward at their last amount where no
 * row exists yet.
 */
export function buildBillTimeline(
  bills: Bill[],
  startMonth: string,
  months?: number,
  minMonths = 6,
): {
  months: string[];
  rows: TimelineRow[];
  totals: number[];
} {
  const groups = new Map<string, Bill[]>();
  for (const b of bills) {
    if (b.archived_at || b.status === "rejected" || !b.due_date) continue;
    const k = recurringGroupKey(b)
      ? `r:${b.description.trim().toLowerCase()}|${b.category ?? ""}`
      : `one:${b.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }

  const series = [...groups].map(([key, all]) => {
    const sorted = [...all].sort((a, b) => a.due_date.localeCompare(b.due_date));
    const lastRow = sorted[sorted.length - 1];
    return { key, sorted, lastRow, ongoing: isOngoingBill(lastRow, startMonth) };
  });

  let count = months;
  if (count == null) {
    const lastFinite = series
      .filter((x) => !x.ongoing)
      .map((x) => monthKey(x.lastRow.due_date))
      .reduce((max, m) => (m > max ? m : max), startMonth);
    const [y1, m1] = startMonth.split("-").map(Number);
    const [y2, m2] = lastFinite.split("-").map(Number);
    count = Math.max(minMonths, (y2 - y1) * 12 + (m2 - m1) + 1);
  }
  const keys = Array.from({ length: count }, (_, i) => addMonths(startMonth, i));

  const rows: TimelineRow[] = [];
  for (const { key, sorted, lastRow, ongoing } of series) {
    const lastDue = lastRow.due_date;
    const lastMonth = monthKey(lastDue);
    const cells = keys.map((month): TimelineCell => {
      const inMonth = sorted.filter((b) => monthKey(b.due_date) === month);
      if (inMonth.length === 0 && ongoing && month > lastMonth) {
        return { month, amount: Number(lastRow.amount ?? 0), bills: [], changed: false, last: false, projected: true };
      }
      const first = inMonth[0];
      const prev = first ? sorted[sorted.indexOf(first) - 1] : undefined;
      return {
        month,
        amount: inMonth.reduce((t, b) => t + Number(b.amount ?? 0), 0),
        bills: inMonth,
        changed: Boolean(first && prev && Number(prev.amount) !== Number(first.amount)),
        last: !ongoing && inMonth.some((b) => b.due_date === lastDue),
        projected: false,
      };
    });
    if (cells.every((c) => c.bills.length === 0 && !c.projected)) continue;
    rows.push({
      key,
      title: sorted[0].description,
      isSeries: key.startsWith("r:"),
      cells,
      endYmd: lastDue,
      ongoing,
    });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title));
  const totals = keys.map((_, i) => rows.reduce((t, r) => t + r.cells[i].amount, 0));
  return { months: keys, rows, totals };
}
