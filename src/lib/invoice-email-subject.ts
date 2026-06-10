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

export function buildInvoiceEmailSubject(
  invoice: Pick<Invoice, "reference" | "status" | "amount" | "amount_paid" | "stripe_payment_status" | "stripe_paid_at">,
  jobReference: string,
): string {
  if (isInvoicePaymentVerified(invoice)) {
    return `Payment receipt — ${displayBillingReference(invoice.reference)}`;
  }
  return `${jobReference} Your billing is ready`;
}
