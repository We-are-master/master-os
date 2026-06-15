import type { Invoice } from "@/types/database";
import {
  buildInvoiceClientEmailHTML,
  type InvoiceClientEmailContext,
  type InvoiceEmailOptions,
} from "@/lib/invoice-client-email-template";
import type { InvoiceTradeFeeJob } from "@/lib/invoice-trade-fee-split";

export type { InvoiceClientEmailContext, InvoiceEmailOptions };

/**
 * Builds the HTML body for client invoice / payment receipt emails.
 * "Payment received" banner only when payment is verified.
 */
export function buildInvoiceEmailHTML(
  invoice: Invoice,
  context: InvoiceClientEmailContext,
  job?: InvoiceTradeFeeJob | null,
  options?: InvoiceEmailOptions,
): string {
  return buildInvoiceClientEmailHTML(invoice, context, job, options);
}
