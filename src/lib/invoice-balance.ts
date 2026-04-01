import type { Invoice } from "@/types/database";

const EPS = 0.02;

export function invoiceAmountPaid(inv: Pick<Invoice, "amount_paid">): number {
  return Number(inv.amount_paid ?? 0) || 0;
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
