import type { Invoice } from "@/types/database";
import {
  buildInvoiceClientEmail,
  buildInvoiceClientEmailHTML,
  type InvoiceClientEmail,
  type InvoiceClientEmailContext,
  type InvoiceEmailOptions,
} from "@/lib/invoice-client-email-template";
import type { InvoiceTradeFeeJob } from "@/lib/invoice-trade-fee-split";

export type { InvoiceClientEmail, InvoiceClientEmailContext, InvoiceEmailOptions };
export { buildInvoiceClientEmail };

/**
 * Builds the HTML body for client invoice / payment receipt emails.
 * "Payment received" only when payment is verified.
 */
export function buildInvoiceEmailHTML(
  invoice: Invoice,
  context: InvoiceClientEmailContext,
  job?: InvoiceTradeFeeJob | null,
  options?: InvoiceEmailOptions,
): string {
  return buildInvoiceClientEmailHTML(invoice, context, job, options);
}
