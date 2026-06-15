import { format, isValid, parseISO } from "date-fns";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { invoiceAmountPaid, invoiceBalanceDue } from "@/lib/invoice-balance";
import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { splitInvoiceTradeAndFee } from "@/lib/invoice-trade-fee-split";
import { displayBillingReference } from "@/lib/billing-reference";
import {
  parseFrontendSetup,
  resolveInvoicePlatformFeePct,
  resolveInvoiceStatementLogoUrl,
} from "@/lib/frontend-setup";
import {
  DEFAULT_INVOICE_PDF_LOGO_URL,
  resolveLogoDataUri,
} from "@/lib/pdf/resolve-logo-data-uri";
import type { InvoicePdfData } from "@/lib/pdf/invoice-template";
import type { Invoice, Job } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

function formatDisplayDate(iso?: string | null): string {
  if (!iso?.trim()) return "—";
  const d = parseISO(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!isValid(d)) return iso.slice(0, 10);
  return format(d, "d MMM yyyy");
}

export type LoadInvoicePdfOptions = {
  amountDueNow?: number;
  requestPercent?: number;
};

export async function loadInvoicePdfData(
  admin: SupabaseClient,
  invoiceId: string,
  opts?: LoadInvoicePdfOptions,
): Promise<InvoicePdfData | null> {
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr || !invoice) return null;

  const inv = invoice as Invoice;
  let job: Job | null = null;
  let quoteReference: string | null = null;
  let clientId: string | null = null;

  if (inv.job_reference?.trim()) {
    const { data: jobRow } = await admin
      .from("jobs")
      .select(
        "id, reference, title, client_id, property_address, service_type, completed_date, quote_id, client_price, extras_amount, commission, partner_agreed_value, partner_cost, materials_cost",
      )
      .eq("reference", inv.job_reference.trim())
      .is("deleted_at", null)
      .maybeSingle();
    job = (jobRow ?? null) as Job | null;
    clientId = job?.client_id ?? null;

    const quoteId = job?.quote_id ?? null;
    if (quoteId) {
      const { data: quote } = await admin.from("quotes").select("reference").eq("id", quoteId).maybeSingle();
      quoteReference = (quote as { reference?: string } | null)?.reference?.trim() ?? null;
    }
  }

  const billing = clientId
    ? await resolveNominalBillingParty(admin, {
        clientId,
        fallbackName: inv.client_name,
        fallbackEmail: null,
      })
    : null;

  const invAmt = Math.max(0, Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100);
  const paidAmt = Math.round(invoiceAmountPaid(inv) * 100) / 100;
  const balanceDue = invoiceBalanceDue(inv);
  const paid = isInvoicePaymentVerified(inv);
  const partial = !paid && paidAmt > 0.02;
  const { data: company } = await admin
    .from("company_settings")
    .select("logo_url, frontend_setup")
    .limit(1)
    .maybeSingle();
  const companyRow = company as { logo_url?: string | null; frontend_setup?: unknown } | null;
  const setup = parseFrontendSetup(companyRow?.frontend_setup);
  const platformFeePct = resolveInvoicePlatformFeePct(setup);
  const { trade, fee } = splitInvoiceTradeAndFee(invAmt, job, { defaultPlatformFeePct: platformFeePct });

  const logoSource =
    resolveInvoiceStatementLogoUrl(setup, companyRow?.logo_url) || DEFAULT_INVOICE_PDF_LOGO_URL;
  const logoUrl = (await resolveLogoDataUri(logoSource)) ?? undefined;

  return {
    reference: displayBillingReference(inv.reference),
    documentTitle: paid ? "Payment Receipt" : "Statement of Charges",
    clientName: billing?.displayName ?? inv.client_name,
    jobTitle: job?.title ?? inv.job_reference ?? "Job",
    jobReference: inv.job_reference?.trim() ?? job?.reference ?? "",
    propertyAddress: job?.property_address ?? undefined,
    issueDate: formatDisplayDate(inv.created_at),
    dueDate: formatDisplayDate(inv.due_date),
    paymentDate: paid
      ? formatDisplayDate(inv.stripe_paid_at ?? inv.paid_date ?? inv.last_payment_date)
      : undefined,
    amount: invAmt,
    balanceDue,
    paid,
    partial,
    paidAmount: paidAmt,
    quoteReference: quoteReference ?? undefined,
    serviceType: (job as { service_type?: string | null } | null)?.service_type ?? undefined,
    completionDate: job?.completed_date ? formatDisplayDate(job.completed_date) : undefined,
    tradeAmount: trade,
    feeAmount: fee,
    logoUrl,
    amountDueNow: opts?.amountDueNow,
    requestPercent: opts?.requestPercent,
  };
}
