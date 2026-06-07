import { format, isValid, parseISO } from "date-fns";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { invoiceAmountPaid, invoiceBalanceDue } from "@/lib/invoice-balance";
import { isInvoicePaymentVerified } from "@/lib/invoice-client-email-template";
import { partnerSelfBillGrossAmount } from "@/lib/job-financials";
import type { InvoicePdfData } from "@/lib/pdf/invoice-template";
import type { Invoice, Job } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

function formatDisplayDate(iso?: string | null): string {
  if (!iso?.trim()) return "—";
  const d = parseISO(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!isValid(d)) return iso.slice(0, 10);
  return format(d, "d MMM yyyy");
}

function splitTradeAndFee(
  chargedAmount: number,
  job?: Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost"> | null,
): { trade: number; fee: number } {
  const total = Math.max(0, Math.round(chargedAmount * 100) / 100);
  if (!job || total <= 0) return { trade: total, fee: 0 };
  const partnerGross = Math.round(partnerSelfBillGrossAmount(job) * 100) / 100;
  const trade = Math.max(0, Math.min(total, partnerGross));
  const fee = Math.max(0, Math.round((total - trade) * 100) / 100);
  return { trade, fee };
}

export async function loadInvoicePdfData(
  admin: SupabaseClient,
  invoiceId: string,
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
        "id, reference, title, client_id, property_address, service_type, completed_date, quote_id, partner_agreed_value, partner_cost, materials_cost",
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
  const { trade, fee } = splitTradeAndFee(invAmt, job);

  return {
    reference: inv.reference,
    documentTitle: paid ? "Payment Receipt" : "Invoice",
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
  };
}
