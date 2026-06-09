import { clampDepositPercent, depositAmountFromPercent } from "@/lib/quote-deposit";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import type { Invoice } from "@/types/database";

/** Balance to apply a request % against (open balance or full invoice amount). */
export function invoiceRequestBaseAmount(inv: Pick<Invoice, "amount" | "amount_paid">): number {
  const balance = invoiceBalanceDue(inv);
  const total = Math.max(0, Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100);
  return balance > 0.02 ? balance : total;
}

/** £ amount to request now for a given % of the invoice base (0–100). */
export function invoiceAmountDueForRequest(
  inv: Pick<Invoice, "amount" | "amount_paid">,
  requestPercent: number,
): { baseAmount: number; percent: number; amountDueNow: number } {
  const baseAmount = invoiceRequestBaseAmount(inv);
  const percent = clampDepositPercent(requestPercent);
  const amountDueNow = depositAmountFromPercent(baseAmount, percent);
  return { baseAmount, percent, amountDueNow };
}
