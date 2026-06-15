import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  accountFinalEmailPolicyFromRow,
  type AccountFinalEmailPolicy,
} from "@/lib/account-final-email-policy";
import {
  resolveJobBillingContact,
  resolveJobForInvoiceSend,
  type JobBillingContactSnapshot,
} from "@/lib/job-billing-contact";
import { buildInvoiceEmailHTML } from "@/lib/invoice-email-template";
import { buildInvoiceEmailSubject, resolveInvoiceCcEmail } from "@/lib/invoice-email-subject";
import { invoiceAmountDueForRequest } from "@/lib/invoice-request-amount";
import { parseFrontendSetup, resolveInvoicePlatformFeePct } from "@/lib/frontend-setup";
import { loadInvoicePdfData } from "@/lib/invoice-pdf-data";
import { renderInvoicePdfBufferFromData } from "@/lib/render-invoice-pdf-buffer";
import { canSendJobInvoiceEmail } from "@/lib/invoice-send-eligibility";
import type { Account, Invoice, Job } from "@/types/database";

export { buildInvoiceEmailSubject, resolveInvoiceCcEmail } from "@/lib/invoice-email-subject";

export type InvoiceSendContext = {
  invoice: Invoice;
  job: Job | null;
  quoteReference: string | null;
  billing: JobBillingContactSnapshot;
  policy: AccountFinalEmailPolicy;
};

export async function loadInvoiceSendContext(
  admin: SupabaseClient,
  invoiceId: string,
  options?: { jobId?: string | null },
): Promise<InvoiceSendContext | { error: string; status: number }> {
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr || !invoice) {
    return { error: "Invoice not found", status: 404 };
  }

  const inv = invoice as Invoice;
  if (inv.status === "cancelled") {
    return { error: "Invoice is cancelled", status: 400 };
  }

  const jobRow = await resolveJobForInvoiceSend(admin, inv, options?.jobId);
  const job = (jobRow ?? null) as Job | null;
  let quoteReference: string | null = null;
  const quoteId = job?.quote_id ?? null;
  if (quoteId) {
    const { data: quote } = await admin.from("quotes").select("reference").eq("id", quoteId).maybeSingle();
    quoteReference = (quote as { reference?: string } | null)?.reference?.trim() ?? null;
  }

  const billing = await resolveJobBillingContact(admin, {
    id: job?.id,
    client_id: job?.client_id,
    client_name: job?.client_name ?? inv.client_name,
    quote_id: job?.quote_id,
    invoice_id: inv.id,
  });

  let policy = accountFinalEmailPolicyFromRow(null);
  const aid = billing.sourceAccountId?.trim();
  if (aid) {
    const { data: acc } = await admin.from("accounts").select("*").eq("id", aid).is("deleted_at", null).maybeSingle();
    policy = accountFinalEmailPolicyFromRow((acc ?? null) as Account | null);
  } else {
    const clientId = job?.client_id?.trim();
    if (clientId) {
      const { data: client } = await admin
        .from("clients")
        .select("source_account_id")
        .eq("id", clientId)
        .is("deleted_at", null)
        .maybeSingle();
      const sourceId = (client as { source_account_id?: string | null } | null)?.source_account_id?.trim();
      if (sourceId) {
        const { data: acc } = await admin.from("accounts").select("*").eq("id", sourceId).is("deleted_at", null).maybeSingle();
        policy = accountFinalEmailPolicyFromRow((acc ?? null) as Account | null);
      }
    }
  }

  const eligibility = canSendJobInvoiceEmail({
    invoice: inv,
    canIncludeInvoice: policy.canIncludeInvoice,
    documentEmail: billing.documentEmail,
    mode: billing.mode,
  });
  if (!eligibility.ok) {
    const detail = {
      invoiceId: inv.id,
      jobLoaded: job !== null,
      passedJobId: options?.jobId ?? null,
      resolvedJobId: job?.id ?? null,
      client_id: job?.client_id ?? null,
      quote_id: job?.quote_id ?? null,
      sourceAccountId: billing.sourceAccountId,
      documentEmail: billing.documentEmail,
      mode: billing.mode,
      canIncludeInvoice: policy.canIncludeInvoice,
    };
    console.warn("[invoice-send-email] eligibility failed", { ...detail, reason: eligibility.reason });
    const detailStr = `jobLoaded=${detail.jobLoaded} passedJobId=${detail.passedJobId ?? "null"} resolvedJobId=${detail.resolvedJobId ?? "null"} mode=${detail.mode ?? "null"} email=${detail.documentEmail ?? "null"} client=${detail.client_id ?? "null"} quote=${detail.quote_id ?? "null"} acct=${detail.sourceAccountId ?? "null"}`;
    return { error: `${eligibility.reason} [${detailStr}]`, status: 400 };
  }

  return { invoice: inv, job, quoteReference, billing, policy };
}

export async function renderInvoicePdfBuffer(
  admin: SupabaseClient,
  invoiceId: string,
  opts?: { amountDueNow?: number; requestPercent?: number },
): Promise<{ buffer: Buffer; reference: string } | { error: string }> {
  const data = await loadInvoicePdfData(admin, invoiceId, opts);
  if (!data) return { error: "Could not load invoice PDF data" };
  const buffer = await renderInvoicePdfBufferFromData(data);
  return { buffer, reference: String(data.reference ?? "invoice") };
}

export type SendInvoiceEmailResult =
  | { ok: true; to: string; cc: string[]; resendId?: string }
  | { error: string; status: number };

export async function sendInvoiceEmail(
  admin: SupabaseClient,
  invoiceId: string,
  options: { userId: string; userName: string; requestPercent?: number; jobId?: string | null },
): Promise<SendInvoiceEmailResult> {
  const ctx = await loadInvoiceSendContext(admin, invoiceId, { jobId: options.jobId });
  if ("error" in ctx && "status" in ctx) {
    return { error: ctx.error, status: ctx.status };
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return { error: "RESEND_API_KEY not configured", status: 503 };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromEmail) {
    return { error: "RESEND_FROM_EMAIL not configured", status: 503 };
  }

  const { data: company } = await admin
    .from("company_settings")
    .select("email, company_name, frontend_setup")
    .limit(1)
    .maybeSingle();
  const tradeFeeOptions = {
    defaultPlatformFeePct: resolveInvoicePlatformFeePct(
      parseFrontendSetup((company as { frontend_setup?: unknown } | null)?.frontend_setup),
    ),
  };
  const emailTo = ctx.billing.documentEmail!.trim();
  const ccEmail = resolveInvoiceCcEmail(company?.email);
  const ccList = ccEmail.toLowerCase() !== emailTo.toLowerCase() ? [ccEmail] : [];

  const { invoice: inv, job, quoteReference, billing } = ctx;
  const request =
    options.requestPercent != null
      ? invoiceAmountDueForRequest(inv, options.requestPercent)
      : invoiceAmountDueForRequest(inv, 100);
  const emailOptsBase =
    request.percent < 100
      ? { amountDueNow: request.amountDueNow, requestPercent: request.percent }
      : undefined;
  const emailOpts = emailOptsBase
    ? { ...emailOptsBase, tradeFeeOptions }
    : { tradeFeeOptions };

  const pdfResult = await renderInvoicePdfBuffer(admin, invoiceId, emailOptsBase);
  if ("error" in pdfResult) {
    return { error: pdfResult.error, status: 500 };
  }

  const html = buildInvoiceEmailHTML(
    inv,
    {
      clientName: billing.displayName,
      jobTitle: job?.title ?? inv.job_reference ?? "Job",
      propertyAddress: job?.property_address ?? null,
      serviceType: (job as { service_type?: string | null } | null)?.service_type ?? null,
      completionDate: job?.completed_date ?? inv.created_at,
      quoteReference,
    },
    job,
    emailOpts,
  );

  const jobRef = job?.reference ?? inv.job_reference ?? "Job";
  const subject = buildInvoiceEmailSubject(inv, jobRef);
  const safeName = pdfResult.reference.replace(/[^\w.-]+/g, "_");

  const resend = new Resend(resendKey);
  const { data: emailResult, error: emailError } = await resend.emails.send({
    from: fromEmail,
    to: [emailTo],
    cc: ccList.length > 0 ? ccList : undefined,
    subject,
    html,
    attachments: [
      {
        filename: `${safeName}.pdf`,
        content: pdfResult.buffer,
        contentType: "application/pdf",
      },
    ],
  });

  if (emailError) {
    const message =
      typeof emailError === "object" && emailError && "message" in emailError
        ? String((emailError as { message: unknown }).message)
        : "Email delivery failed";
    return { error: message, status: 502 };
  }

  if (inv.status === "draft") {
    const { error: statusErr } = await admin
      .from("invoices")
      .update({ status: "pending" })
      .eq("id", invoiceId);
    if (statusErr) {
      return { error: "Email sent but invoice status could not be updated", status: 500 };
    }
  }

  void admin.from("audit_logs").insert({
    entity_type: "invoice",
    entity_id: invoiceId,
    entity_ref: inv.reference,
    action: "bulk_update",
    field_name: "email_sent",
    new_value: emailTo,
    user_id: options.userId,
    user_name: options.userName,
    metadata: {
      email_to: emailTo,
      cc: ccList,
      resend_id: emailResult?.id,
      channel: "resend",
      request_percent: request?.percent ?? 100,
      amount_due_now: request?.amountDueNow ?? invoiceAmountDueForRequest(inv, 100).amountDueNow,
    },
  });

  return { ok: true, to: emailTo, cc: ccList, resendId: emailResult?.id };
}
