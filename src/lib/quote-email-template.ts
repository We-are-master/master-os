import type { QuotePDFData, CompanyBranding } from "@/lib/pdf/quote-template";
import {
  buildQuoteClientEmailHTML,
  type QuoteEmailOptions,
  type QuoteClientEmailContext,
} from "@/lib/quote-client-email-template";

export type { QuoteEmailOptions, QuoteClientEmailContext };

/**
 * Builds the HTML body for the quote email (Resend).
 * Uses the Fixfy `quote-client` template (no estimated duration).
 */
export function buildQuoteEmailHTML(
  data: QuotePDFData,
  branding: CompanyBranding,
  options?: QuoteEmailOptions,
): string {
  return buildQuoteClientEmailHTML(data, branding, options, options?.context);
}
