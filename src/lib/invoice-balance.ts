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

/**
 * Matches Invoice drawer “ledger bridge”: when the invoice is linked to a job and we know total
 * customer payments on that job (`customer_deposit` + `customer_final`), effective paid is
 * `min(invoice amount, max(amount_paid on invoice row, job ledger sum))` — same as `InvoiceDetailDrawer`.
 */
export function invoiceBalanceDueWithJobCustomerPaid(
  inv: Pick<Invoice, "amount" | "amount_paid" | "job_reference">,
  jobCustomerPaidSum: number | undefined,
): number {
  const ref = inv.job_reference?.trim();
  if (!ref || jobCustomerPaidSum === undefined || !Number.isFinite(jobCustomerPaidSum)) {
    return invoiceBalanceDue(inv);
  }
  const invAmt = Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100;
  const rowPaid = Math.round(invoiceAmountPaid(inv) * 100) / 100;
  const ledger = Math.round(jobCustomerPaidSum * 100) / 100;
  const effectivePaid = Math.min(invAmt, Math.max(rowPaid, ledger));
  return Math.max(0, Math.round((invAmt - effectivePaid) * 100) / 100);
}

export function isInvoiceFullyPaidByAmount(inv: Pick<Invoice, "amount" | "amount_paid">): boolean {
  return invoiceBalanceDue(inv) <= EPS;
}
