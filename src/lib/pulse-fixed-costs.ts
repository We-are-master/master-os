import { recurringGroupKey } from "@/lib/bill-groups";
import { sumWorkforcePayrollAmount } from "@/lib/workforce-lifecycle";
import type { Bill, BillRecurrence, BillStatus } from "@/types/database";

/** Normalise recurring bill cadence to a monthly equivalent (matches Bills & expenses). */
export const BILL_RECURRENCE_MONTHLY_FACTOR: Record<string, number> = {
  weekly: 4.345,
  weekly_friday: 4.345,
  biweekly_friday: 2.1725,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export type PulseBillRow = {
  id: string;
  description?: string | null;
  amount?: number | null;
  is_recurring?: boolean | null;
  recurrence_interval?: BillRecurrence | string | null;
  recurring_series_id?: string | null;
  recurring_series_end_date?: string | null;
  status?: BillStatus | string | null;
  due_date?: string | null;
  category?: string | null;
};

export type PulseRecurringExpenseLine = {
  key: string;
  description: string;
  category: string | null;
  monthlyAmount: number;
  periodAmount: number;
};

export type PulseOneOffExpenseLine = {
  id: string;
  description: string;
  category: string | null;
  amount: number;
  due_date: string | null;
  status: string | null;
};

function asBill(row: PulseBillRow): Bill {
  return row as unknown as Bill;
}

/** How far back a series' last row may sit and still count as running (next row not generated yet). */
const RECURRENCE_GRACE_DAYS: Record<string, number> = {
  weekly: 10,
  weekly_friday: 10,
  biweekly_friday: 17,
  monthly: 35,
  quarterly: 95,
  yearly: 370,
};

function addDaysToDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentMonthDays(now: Date = new Date()): { fromDay: string; toDay: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { fromDay: `${y}-${pad(m + 1)}-01`, toDay: `${y}-${pad(m + 1)}-${pad(last)}` };
}

/**
 * One row per recurring series that is running in [fromDay, toDay]: the row due in the
 * period, or the latest earlier row while still inside its cadence. Series that start
 * after the period (a later price step) or ended before it are left out.
 */
function oneBillRowPerRecurringSeries(rows: PulseBillRow[], fromDay: string, toDay: string): PulseBillRow[] {
  const recurring = rows.filter((b) => !!b.is_recurring && b.status !== "rejected");
  const groups = new Map<string, PulseBillRow[]>();
  for (const bill of recurring) {
    const key = recurringGroupKey(asBill(bill)) ?? bill.id;
    const list = groups.get(key);
    if (list) list.push(bill);
    else groups.set(key, [bill]);
  }
  const out: PulseBillRow[] = [];
  for (const list of groups.values()) {
    const dated = list
      .filter((b) => !!b.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    if (dated.length === 0) {
      out.push(list[0]);
      continue;
    }
    const inPeriod = dated.find((b) => String(b.due_date).slice(0, 10) >= fromDay && String(b.due_date).slice(0, 10) <= toDay);
    if (inPeriod) {
      out.push(inPeriod);
      continue;
    }
    const before = dated.filter((b) => String(b.due_date).slice(0, 10) < fromDay).at(-1);
    if (!before) continue;
    const endDay = before.recurring_series_end_date?.slice(0, 10);
    if (endDay && endDay < fromDay) continue;
    const grace = RECURRENCE_GRACE_DAYS[String(before.recurrence_interval ?? "monthly")] ?? 35;
    if (String(before.due_date).slice(0, 10) >= addDaysToDay(fromDay, -grace)) out.push(before);
  }
  return out;
}

/** Monthly bills burn for the month of `now` (only series running that month). */
export function computeMonthlyBillsBurn(rows: PulseBillRow[], now: Date = new Date()): number {
  const { fromDay, toDay } = currentMonthDays(now);
  return oneBillRowPerRecurringSeries(rows, fromDay, toDay).reduce((acc, b) => {
    const factor = BILL_RECURRENCE_MONTHLY_FACTOR[String(b.recurrence_interval ?? "monthly")] ?? 1;
    return acc + (Number(b.amount) || 0) * factor;
  }, 0);
}

export function computeBillsFixedCostForPeriod(
  rows: PulseBillRow[],
  fromDay: string,
  toDay: string,
  allocationFactor: number,
): {
  total: number;
  recurringLines: PulseRecurringExpenseLine[];
  oneOffLines: PulseOneOffExpenseLine[];
} {
  const active = rows.filter((b) => b.status !== "rejected");
  const recurringLines: PulseRecurringExpenseLine[] = oneBillRowPerRecurringSeries(active, fromDay, toDay).map((b) => {
    const factor = BILL_RECURRENCE_MONTHLY_FACTOR[String(b.recurrence_interval ?? "monthly")] ?? 1;
    const monthlyAmount = (Number(b.amount) || 0) * factor;
    return {
      key: recurringGroupKey(asBill(b)) ?? b.id,
      description: (b.description ?? "").trim() || "Bill",
      category: b.category ?? null,
      monthlyAmount,
      periodAmount: monthlyAmount * allocationFactor,
    };
  });

  const oneOffLines: PulseOneOffExpenseLine[] = active
    .filter((b) => !b.is_recurring && b.due_date && b.due_date >= fromDay && b.due_date <= toDay)
    .map((b) => ({
      id: b.id,
      description: (b.description ?? "").trim() || "Bill",
      category: b.category ?? null,
      amount: Number(b.amount) || 0,
      due_date: b.due_date ?? null,
      status: b.status ?? null,
    }));

  const total =
    recurringLines.reduce((acc, line) => acc + line.periodAmount, 0) +
    oneOffLines.reduce((acc, line) => acc + line.amount, 0);

  return { total, recurringLines, oneOffLines };
}

export function computeWorkforceMonthlyBurn<
  T extends { amount?: number | null; lifecycle_stage?: string | null },
>(rows: T[]): number {
  return sumWorkforcePayrollAmount(rows);
}
