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

function oneBillRowPerRecurringSeries(rows: PulseBillRow[]): PulseBillRow[] {
  const recurring = rows.filter((b) => !!b.is_recurring && b.status !== "rejected");
  return recurring
    .slice()
    .sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")))
    .filter(
      (bill, index, arr) =>
        arr.findIndex((row) => recurringGroupKey(asBill(row)) === recurringGroupKey(asBill(bill))) === index,
    );
}

export function computeMonthlyBillsBurn(rows: PulseBillRow[]): number {
  return oneBillRowPerRecurringSeries(rows).reduce((acc, b) => {
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
  const recurringLines: PulseRecurringExpenseLine[] = oneBillRowPerRecurringSeries(active).map((b) => {
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
