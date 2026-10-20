import { format, isValid, parseISO } from "date-fns";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { invoiceAmountPaid, invoiceBalanceDue } from "@/lib/invoice-balance";
import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { splitInvoiceTradeAndFee } from "@/lib/invoice-trade-fee-split";
import { loadAccountInvoiceFormat } from "@/lib/invoice-fee-vat";
import { loadAgentReceiptParty } from "@/lib/agent-model/receipt-party";
import { buildAgentReceiptView } from "@/lib/agent-model/receipt-view";
import { displayBillingReference } from "@/lib/billing-reference";
import {
  parseFrontendSetup,
  resolveInvoicePlatformFeePct,
  resolveInvoiceStatementLogoUrl,
} from "@/lib/frontend-setup";
import {
  DEFAULT_INVOICE_PDF_LOGO_URL,
  readPublicLogoDataUri,
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
        "id, reference, title, client_id, partner_id, created_at, property_address, completed_date, quote_id, client_price, extras_amount, commission, partner_agreed_value, partner_cost, materials_cost",
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
  // Schedule A (modelo de agente): recibo em nome do profissional. Null = B, documento de sempre.
  // Fatura semanal da conta: uma linha por job, e o serviço/taxa somados job a job.
  const semanal = inv.invoice_kind === "weekly_batch" ? await dadosDaFaturaSemanal(admin, inv, platformFeePct) : null;
  const agentParty = semanal ? null : await loadAgentReceiptParty(admin, job);
  const { trade, fee } = semanal
    ? semanal.split
    : splitInvoiceTradeAndFee(invAmt, job, {
        defaultPlatformFeePct: platformFeePct,
        schedule: agentParty ? "A" : "B",
      });
  const agent = agentParty
    ? buildAgentReceiptView({
        party: agentParty,
        jobTitle: job?.title ?? inv.job_reference ?? "Service",
        clientPrice: job?.client_price,
        extrasAmount: job?.extras_amount,
        invoiceAmount: invAmt,
        paid,
      })
    : undefined;

  // Conta que pede a fatura em nome da razão social, com VAT só sobre a taxa da Fixfy (mig 323).
  const accountFormat = agentParty
    ? null
    : await loadAccountInvoiceFormat(admin, inv.source_account_id ?? billing?.sourceAccountId ?? null, fee);

  const logoSource =
    resolveInvoiceStatementLogoUrl(setup, companyRow?.logo_url) || DEFAULT_INVOICE_PDF_LOGO_URL;
  const logoUrl = (await resolveLogoDataUri(logoSource)) ?? undefined;
  // Logo para a folha branca da fatura de uma página.
  const logoDarkUrl = readPublicLogoDataUri("logos/fixfy-wordmark-navy-trim.png");

  return {
    reference: displayBillingReference(inv.reference),
    documentTitle: agent ? (paid ? "Receipt" : "Statement of Charges") : paid ? "Payment Receipt" : accountFormat ? "Invoice" : "Statement of Charges",
    clientName: accountFormat?.billTo.legalName ?? billing?.displayName ?? inv.client_name,
    contactName: accountFormat ? (billing?.displayName ?? inv.client_name) : undefined,
    billTo: accountFormat?.billTo,
    feeVat: accountFormat?.feeVat,
    jobTitle: semanal ? `Weekly invoice · ${semanal.jobs.length} job${semanal.jobs.length === 1 ? "" : "s"}` : job?.title ?? inv.job_reference ?? "Job",
    jobReference: semanal ? "" : inv.job_reference?.trim() ?? job?.reference ?? "",
    propertyAddress: semanal ? undefined : job?.property_address ?? undefined,
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
    // `jobs.service_type` não existe em produção: pedi-la derrubava a consulta inteira e a fatura
    // saía sem o job (sem endereço, sem data, taxa da Fixfy em £0). O serviço é o título do job.
    serviceType: job?.title ?? undefined,
    completionDate: semanal ? undefined : job?.completed_date ? formatDisplayDate(job.completed_date) : undefined,
    semanal: semanal ? { rotulo: semanal.rotulo, jobs: semanal.jobs } : undefined,
    tradeAmount: trade,
    feeAmount: fee,
    logoUrl,
    logoDarkUrl,
    amountDueNow: opts?.amountDueNow,
    requestPercent: opts?.requestPercent,
    agent,
  };
}

/** As linhas da fatura semanal (fatura-semanal.ts) e o serviço/taxa somados job a job. */
async function dadosDaFaturaSemanal(admin: SupabaseClient, inv: Invoice, platformFeePct: number) {
  const { linhasDaFaturaSemanal } = await import("@/lib/fatura-semanal");
  const { linhas, jobs } = await linhasDaFaturaSemanal(admin, inv.id);
  const porId = new Map(jobs.map((j) => [j.id, j]));
  const split = linhas.reduce(
    (acc, l) => {
      const s = splitInvoiceTradeAndFee(l.amount, porId.get(l.jobId) ?? null, { defaultPlatformFeePct: platformFeePct, schedule: "B" });
      return { trade: Math.round((acc.trade + s.trade) * 100) / 100, fee: Math.round((acc.fee + s.fee) * 100) / 100 };
    },
    { trade: 0, fee: 0 },
  );
  const inicio = (inv as { billing_week_start?: string | null }).billing_week_start ?? null;
  const fim = inicio ? new Date(new Date(`${inicio}T12:00:00Z`).getTime() + 6 * 864e5).toISOString().slice(0, 10) : null;
  return {
    split,
    rotulo: inicio && fim ? `${formatDisplayDate(inicio)} to ${formatDisplayDate(fim)}` : "this week",
    jobs: linhas.map((l) => ({
      reference: l.reference,
      title: l.title,
      address: l.address ?? undefined,
      completed: l.completed ? formatDisplayDate(l.completed) : undefined,
      amount: l.amount,
      reportUrl: l.reportUrl,
    })),
  };
}
