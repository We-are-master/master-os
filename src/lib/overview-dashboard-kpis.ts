import { invoiceBalanceDue } from "@/lib/invoice-balance";

/** Local calendar month bounds (YYYY-MM-DD), inclusive, for tier / payment windows. */
export function localCalendarMonthYmdBounds(d = new Date()): { fromDay: string; toDay: string; monthLabel: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, "0");
  const fromDay = `${y}-${mm}-01`;
  const toDay = `${y}-${mm}-${String(last).padStart(2, "0")}`;
  const monthLabel = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { fromDay, toDay, monthLabel };
}

type InvoiceKpiRow = {
  amount?: number;
  amount_paid?: number;
  status?: string;
  due_date?: string | null;
  paid_date?: string | null;
};

/** Open balance on invoices whose due_date falls in [fromDay, toDay] (inclusive). Excludes paid/cancelled. */
export function sumInvoiceOpenBalanceByDueDateWindow(rows: InvoiceKpiRow[], fromDay: string, toDay: string): number {
  let sum = 0;
  for (const inv of rows) {
    const st = inv.status ?? "";
    if (st === "paid" || st === "cancelled") continue;
    const bal = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
    if (bal <= 0.02) continue;
    const d = (inv.due_date ?? "").slice(0, 10);
    if (d.length < 10 || d < fromDay || d > toDay) continue;
    sum += bal;
  }
  return Math.round(sum * 100) / 100;
}

/** Total outstanding customer invoice balance (no due-date window). */
export function sumInvoiceOpenBalanceOutstanding(rows: InvoiceKpiRow[]): number {
  let sum = 0;
  for (const inv of rows) {
    const st = inv.status ?? "";
    if (st === "paid" || st === "cancelled") continue;
    const bal = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
    if (bal > 0.02) sum += bal;
  }
  return Math.round(sum * 100) / 100;
}

/** Paid invoice amounts with paid_date in [fromDay, toDay] (commission / tier basis). */
export function sumPaidInvoiceAmountByPaidDateRange(rows: InvoiceKpiRow[], fromDay: string, toDay: string): number {
  let sum = 0;
  for (const inv of rows) {
    if (inv.status !== "paid") continue;
    const pd = (inv.paid_date ?? "").slice(0, 10);
    if (pd.length < 10 || pd < fromDay || pd > toDay) continue;
    sum += Number(inv.amount ?? 0);
  }
  return Math.round(sum * 100) / 100;
}

export function sumPaidInvoiceAmountAll(rows: InvoiceKpiRow[]): number {
  let sum = 0;
  for (const inv of rows) {
    if (inv.status !== "paid") continue;
    sum += Number(inv.amount ?? 0);
  }
  return Math.round(sum * 100) / 100;
}
