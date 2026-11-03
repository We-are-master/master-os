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
};

export type TimelineRow = {
  key: string;
  title: string;
  isSeries: boolean;
  cells: TimelineCell[];
  /** Last due date of the bill (null when it has none). */
  endYmd: string | null;
  /** Ends only because we stopped scheduling (no end date on the series). */
  ongoing: boolean;
};

/**
 * One row per bill with the amount due in each month of the window. Recurring
 * series with the same name and category share a row, so a price change saved
 * as a second series (Checkatrade £688 then £1,000) reads as one bill. Archived
 * and rejected rows are left out, like the cost KPIs. Rows with nothing in the
 * window are dropped.
 */
export function buildBillTimeline(bills: Bill[], startMonth: string, months: number): {
  months: string[];
  rows: TimelineRow[];
  totals: number[];
} {
  const keys = Array.from({ length: months }, (_, i) => addMonths(startMonth, i));
  const groups = new Map<string, Bill[]>();
  for (const b of bills) {
    if (b.archived_at || b.status === "rejected" || !b.due_date) continue;
    const k = recurringGroupKey(b)
      ? `r:${b.description.trim().toLowerCase()}|${b.category ?? ""}`
      : `one:${b.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }

  const rows: TimelineRow[] = [];
  for (const [key, all] of groups) {
    const sorted = [...all].sort((a, b) => a.due_date.localeCompare(b.due_date));
    const lastDue = sorted[sorted.length - 1].due_date;
    const cells = keys.map((month): TimelineCell => {
      const inMonth = sorted.filter((b) => monthKey(b.due_date) === month);
      const first = inMonth[0];
      const prev = first ? sorted[sorted.indexOf(first) - 1] : undefined;
      return {
        month,
        amount: inMonth.reduce((t, b) => t + Number(b.amount ?? 0), 0),
        bills: inMonth,
        changed: Boolean(first && prev && Number(prev.amount) !== Number(first.amount)),
        last: inMonth.some((b) => b.due_date === lastDue),
      };
    });
    if (cells.every((c) => c.bills.length === 0)) continue;
    const head = sorted[0];
    rows.push({
      key,
      title: head.description,
      isSeries: key.startsWith("r:"),
      cells,
      endYmd: lastDue,
      ongoing: Boolean(head.is_recurring && !sorted[sorted.length - 1].recurring_series_end_date),
    });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title));
  const totals = keys.map((_, i) => rows.reduce((t, r) => t + r.cells[i].amount, 0));
  return { months: keys, rows, totals };
}
