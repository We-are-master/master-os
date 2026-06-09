import { invoiceBalanceDue } from "@/lib/invoice-balance";
import type { Invoice } from "@/types/database";

/** Client-safe — no Node/fs imports. */
export function isInvoicePaymentVerified(
  inv: Pick<Invoice, "status" | "amount" | "amount_paid" | "stripe_payment_status" | "stripe_paid_at">,
): boolean {
  if (inv.status === "paid") return true;
  if (inv.stripe_payment_status === "paid") return true;
  if (inv.stripe_paid_at?.trim()) return true;
  return invoiceBalanceDue(inv) <= 0.02;
}
