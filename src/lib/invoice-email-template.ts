import type { Invoice } from "@/types/database";
import type { Job } from "@/types/database";
import {
  buildInvoiceClientEmailHTML,
  type InvoiceClientEmailContext,
  type InvoiceEmailOptions,
} from "@/lib/invoice-client-email-template";

export type { InvoiceClientEmailContext, InvoiceEmailOptions };

/**
 * Builds the HTML body for client invoice / payment receipt emails.
 * "Payment received" banner only when payment is verified.
 */
export function buildInvoiceEmailHTML(
  invoice: Invoice,
  context: InvoiceClientEmailContext,
  job?: Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost"> | null,
  options?: InvoiceEmailOptions,
): string {
  return buildInvoiceClientEmailHTML(invoice, context, job, options);
}
