import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  accountFinalEmailPolicyFromRow,
  type AccountFinalEmailPolicy,
} from "@/lib/account-final-email-policy";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { buildInvoiceEmailHTML } from "@/lib/invoice-email-template";
import { isInvoicePaymentVerified } from "@/lib/invoice-client-email-template";
import { loadInvoicePdfData } from "@/lib/invoice-pdf-data";
import { renderInvoicePdfBufferFromData } from "@/lib/render-invoice-pdf-buffer";
import {
  canSendJobInvoiceEmail,
  type InvoiceSendEligibilityInput,
} from "@/lib/invoice-send-eligibility";
import type { Account, Invoice, Job } from "@/types/database";

export {
  canSendJobInvoiceEmail,
  canSendJobSelfBillEmail,
  type InvoiceSendEligibilityInput,
  type SelfBillSendEligibilityInput,
  type SendEligibility,
} from "@/lib/invoice-send-eligibility";

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
    return `Payment receipt — ${invoice.reference}`;
  }
  return `Invoice ${invoice.reference} — ${jobReference}`;
}

export type InvoiceSendContext = {
  invoice: Invoice;
  job: Job | null;
  quoteReference: string | null;
  billing: Awaited<ReturnType<typeof resolveNominalBillingParty>>;
  policy: AccountFinalEmailPolicy;
};

export async function loadInvoiceSendContext(
  admin: SupabaseClient,
  invoiceId: string,
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

  let job: Job | null = null;
  let quoteReference: string | null = null;
  let clientId: string | null = null;

  if (inv.job_reference?.trim()) {
    const { data: jobRow } = await admin
      .from("jobs")
      .select(
        "id, reference, title, client_id, client_name, property_address, service_type, completed_date, quote_id, partner_agreed_value, partner_cost, materials_cost, internal_invoice_approved",
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
    : {
        displayName: inv.client_name?.trim() || "Client",
        documentEmail: null,
        sourceAccountId: null,
        mode: "end_client" as const,
      };

  let policy = accountFinalEmailPolicyFromRow(null);
  const aid = billing.sourceAccountId?.trim();
  if (aid) {
    const { data: acc } = await admin.from("accounts").select("*").eq("id", aid).is("deleted_at", null).maybeSingle();
    policy = accountFinalEmailPolicyFromRow((acc ?? null) as Account | null);
  } else if (clientId) {
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

  const eligibility = canSendJobInvoiceEmail({
    invoice: inv,
    jobInternalInvoiceApproved: Boolean(job?.internal_invoice_approved),
    canIncludeInvoice: policy.canIncludeInvoice,
    documentEmail: billing.documentEmail,
  });
  if (!eligibility.ok) {
    return { error: eligibility.reason, status: 400 };
  }

  return { invoice: inv, job, quoteReference, billing, policy };
}

export async function renderInvoicePdfBuffer(
  admin: SupabaseClient,
  invoiceId: string,
): Promise<{ buffer: Buffer; reference: string } | { error: string }> {
  const data = await loadInvoicePdfData(admin, invoiceId);
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
  options: { userId: string; userName: string },
): Promise<SendInvoiceEmailResult> {
  const ctx = await loadInvoiceSendContext(admin, invoiceId);
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

  const { data: company } = await admin.from("company_settings").select("email, company_name").limit(1).maybeSingle();
  const emailTo = ctx.billing.documentEmail!.trim();
  const ccEmail = resolveInvoiceCcEmail(company?.email);
  const ccList = ccEmail.toLowerCase() !== emailTo.toLowerCase() ? [ccEmail] : [];

  const pdfResult = await renderInvoicePdfBuffer(admin, invoiceId);
  if ("error" in pdfResult) {
    return { error: pdfResult.error, status: 500 };
  }

  const { invoice: inv, job, quoteReference, billing } = ctx;
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

  void admin.from("audit_logs").insert({
    entity_type: "invoice",
    entity_id: invoiceId,
    entity_ref: inv.reference,
    action: "bulk_update",
    field_name: "email_sent",
    new_value: emailTo,
    user_id: options.userId,
    user_name: options.userName,
    metadata: { email_to: emailTo, cc: ccList, resend_id: emailResult?.id, channel: "resend" },
  });

  return { ok: true, to: emailTo, cc: ccList, resendId: emailResult?.id };
}
