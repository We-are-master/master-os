import { invoiceBalanceDue } from "@/lib/invoice-balance";

/** Terminal / non-operational job rows for CEO “Work in Progress” (excludes completed, cancelled, deleted, partner-lost). */
const CEO_WIP_EXCLUDED_STATUSES = new Set<string>(["completed", "cancelled", "deleted"]);

/**
 * Billable value of jobs currently in active operations: not completed/cancelled/deleted and not partner-cancelled (lost).
 */
export function isJobCeoWorkInProgress(row: {
  status: string;
  partner_cancelled_at?: string | null;
}): boolean {
  if (row.partner_cancelled_at) return false;
  return !CEO_WIP_EXCLUDED_STATUSES.has(row.status);
}

export function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type InvoiceBalanceRow = {
  status?: string;
  due_date?: string | null;
  amount?: number;
  amount_paid?: number;
};

/**
 * Awaiting payment: open balance with due_date >= today (local).
 * Overdue: open balance with due_date < today (local).
 * Rows without a parseable due_date count as awaiting (not assumed overdue).
 */
export function splitInvoiceOpenBalanceAwaitingVsOverdue(
  invoices: InvoiceBalanceRow[],
  todayYmdLocal: string,
): { awaiting: number; overdue: number } {
  let awaiting = 0;
  let overdue = 0;
  for (const inv of invoices) {
    const st = inv.status ?? "";
    if (st === "paid" || st === "cancelled") continue;
    const bal = invoiceBalanceDue({
      amount: Number(inv.amount ?? 0),
      amount_paid: Number(inv.amount_paid ?? 0),
    });
    if (bal <= 0.02) continue;

    const raw = (inv.due_date ?? "").trim();
    const due = raw.length >= 10 ? raw.slice(0, 10) : "";
    if (!due || due.length < 10) {
      awaiting += bal;
      continue;
    }
    if (due < todayYmdLocal) overdue += bal;
    else awaiting += bal;
  }
  return { awaiting, overdue };
}
