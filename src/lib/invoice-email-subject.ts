import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { displayBillingReference } from "@/lib/billing-reference";
import type { Invoice } from "@/types/database";

export function resolveInvoiceCcEmail(companyEmail?: string | null): string {
  return (
    process.env.INVOICE_CC_EMAIL?.trim() ||
    (companyEmail && String(companyEmail).trim()) ||
    "support@getfixfy.com"
  );
}

/** "Your invoice INV-2026-904 is ready": o mesmo título no assunto do e-mail e no topo do PDF. */
export function invoiceReadyTitle(reference: string): string {
  return `Your invoice ${displayBillingReference(reference)} is ready`;
}

export function buildInvoiceEmailSubject(
  invoice: Pick<Invoice, "reference" | "status" | "amount" | "amount_paid" | "stripe_payment_status" | "stripe_paid_at">,
  _jobReference?: string,
): string {
  if (isInvoicePaymentVerified(invoice)) {
    return `Payment receipt · ${displayBillingReference(invoice.reference)}`;
  }
  // Um título só para toda fatura, igual ao do PDF (dono, 13/10/2026).
  return invoiceReadyTitle(invoice.reference);
}
