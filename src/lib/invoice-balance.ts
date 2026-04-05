import type { Invoice } from "@/types/database";

const EPS = 0.02;

export function invoiceAmountPaid(inv: Pick<Invoice, "amount_paid">): number {
  return Number(inv.amount_paid ?? 0) || 0;
}

/**
 * Cash to show in “collected” KPIs: uses `amount_paid` for partials and non-paid rows;
 * for `status === "paid"`, uses at least the invoice `amount` so legacy rows still count when `amount_paid` was not backfilled.
 */
export function invoiceCollectedAmount(inv: Pick<Invoice, "status" | "amount" | "amount_paid">): number {
  const total = Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100;
  const paid = Math.round(invoiceAmountPaid(inv) * 100) / 100;
  if (inv.status === "paid") {
    return Math.max(paid, total);
  }
  return paid;
}

/** Remaining balance on the invoice row (not necessarily same as job amount due if schedules differ). */
export function invoiceBalanceDue(inv: Pick<Invoice, "amount" | "amount_paid">): number {
  const total = Number(inv.amount ?? 0) || 0;
  const paid = invoiceAmountPaid(inv);
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export function isInvoiceFullyPaidByAmount(inv: Pick<Invoice, "amount" | "amount_paid">): boolean {
  return invoiceBalanceDue(inv) <= EPS;
}
