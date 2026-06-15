import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import {
  accountFinalEmailPolicyFromRow,
  canSendClientEmailWithPack,
} from "@/lib/account-final-email-policy";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { missingBillingEmailReason } from "@/lib/invoice-send-eligibility";
import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { buildInvoiceEmailHTML } from "@/lib/invoice-email-template";
import type { InvoiceTradeFeeJob } from "@/lib/invoice-trade-fee-split";
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";
import { getZendeskTicketId, isZendeskConfigured, sendCustomerCommentWithAttachments as zdSendCustomerComment } from "@/lib/zendesk";
import type { Account, Invoice } from "@/types/database";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ReportRow = {
  id: string;
  phase: number;
  pdf_url: string | null;
  uploaded_at: string | null;
  created_at: string | null;
};

function bestPerPhase(rows: ReportRow[]): ReportRow[] {
  const map = new Map<number, ReportRow>();
  for (const row of rows) {
    const prev = map.get(row.phase);
    const rowTs = new Date(row.uploaded_at ?? row.created_at ?? 0).getTime();
    const prevTs = prev ? new Date(prev.uploaded_at ?? prev.created_at ?? 0).getTime() : -1;
    if (!prev || rowTs >= prevTs) map.set(row.phase, row);
  }
  return [...map.values()].sort((a, b) => a.phase - b.phase);
}

async function accountPolicyForClient(admin: ReturnType<typeof createServiceClient>, clientId: string) {
  const { data: client } = await admin
    .from("clients")
    .select("source_account_id")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  const aid = (client as { source_account_id?: string | null } | null)?.source_account_id?.trim();
  if (!aid) {
    return accountFinalEmailPolicyFromRow(null);
  }
  const { data: acc } = await admin.from("accounts").select("*").eq("id", aid).is("deleted_at", null).maybeSingle();
  return accountFinalEmailPolicyFromRow((acc ?? null) as Account | null);
}

type Body = { includeInvoice?: boolean; includeReport?: boolean };

/** After final review: email billing contact; body lists report PDFs and/or invoice per request. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  let body: Body = {};
  try {
    const raw = (await req.json()) as unknown;
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      if (typeof o.includeInvoice === "boolean") body.includeInvoice = o.includeInvoice;
      if (typeof o.includeReport === "boolean") body.includeReport = o.includeReport;
    }
  } catch {
    body = {};
  }
  const includeInvoice = body.includeInvoice !== false;
  const includeReport = body.includeReport !== false;

  const supabase = await createClient();
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, reference, title, client_id, client_name, property_address, status, invoice_id, quote_id, service_type, completed_date, client_price, extras_amount, commission, partner_agreed_value, partner_cost, materials_cost, external_source, external_ref",
    )
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const j = job as Record<string, unknown>;
  const clientId = typeof j.client_id === "string" ? j.client_id : null;
  if (!clientId) {
    return NextResponse.json({ error: "Job has no client" }, { status: 400 });
  }

  const admin = createServiceClient();
  const policy = await accountPolicyForClient(admin, clientId);
  if (!canSendClientEmailWithPack(policy)) {
    return NextResponse.json(
      { error: "This account does not allow client completion emails. Update Billing on the account." },
      { status: 400 },
    );
  }
  if (includeInvoice && !policy.canIncludeInvoice) {
    return NextResponse.json({ error: "Invoice content is not allowed for this account." }, { status: 400 });
  }
  if (includeReport && !policy.canIncludeReport) {
    return NextResponse.json({ error: "Report attachments are not allowed for this account." }, { status: 400 });
  }
  if (!includeInvoice && !includeReport) {
    return NextResponse.json(
      { error: "Select at least one of invoice or report for the client email, or use internal only." },
      { status: 400 },
    );
  }

  const billing = await resolveNominalBillingParty(admin, {
    clientId,
    fallbackName: typeof j.client_name === "string" ? j.client_name : "Client",
    fallbackEmail: null,
  });
  const emailTo = billing.documentEmail?.trim();
  if (!emailTo) {
    return NextResponse.json({ error: missingBillingEmailReason(billing.mode) }, { status: 400 });
  }

  const { data: reportRows, error: rErr } = await admin
    .from("job_reports")
    .select("id, phase, pdf_url, uploaded_at, created_at")
    .eq("job_id", jobId);
  if (rErr) {
    return NextResponse.json({ error: "Could not load reports" }, { status: 500 });
  }
  const reports = bestPerPhase((reportRows ?? []) as ReportRow[]);

  const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
  if (includeReport) {
    for (const r of reports) {
      if (!r.pdf_url?.trim()) continue;
      const path = jobReportPdfPathFromStoredUrl(r.pdf_url);
      if (!path) continue;
      const { data: blob, error: dlErr } = await admin.storage.from("job-reports").download(path);
      if (dlErr || !blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      const safe = String(j.reference ?? "job").replace(/[^\w.-]+/g, "_");
      attachments.push({
        filename: `${safe}-report-${r.phase}.pdf`,
        content: buf,
        contentType: "application/pdf",
      });
    }
  }

  const invoiceId = typeof j.invoice_id === "string" ? j.invoice_id : null;
  let invoiceRow: Invoice | null = null;
  let quoteReference: string | null = null;

  if (includeInvoice && invoiceId) {
    const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    invoiceRow = (inv ?? null) as Invoice | null;
  }

  const quoteId = typeof j.quote_id === "string" ? j.quote_id : null;
  if (quoteId) {
    const { data: quote } = await admin.from("quotes").select("reference").eq("id", quoteId).maybeSingle();
    quoteReference = (quote as { reference?: string } | null)?.reference?.trim() ?? null;
  }

  const { data: settings } = await admin.from("company_settings").select("company_name").limit(1).maybeSingle();
  const companyName =
    settings && (settings as { company_name?: string | null }).company_name
      ? String((settings as { company_name?: string | null }).company_name)
      : "Our team";
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${companyName} <onboarding@resend.dev>`;

  // Channel selection: prefer Zendesk if the job came from a ticket and the
  // env is configured; only require RESEND_API_KEY for the Resend fallback.
  const zdTicketId = getZendeskTicketId(j as { external_source?: string | null; external_ref?: string | null });
  const useZendesk = Boolean(zdTicketId && isZendeskConfigured());

  if (zdTicketId && !isZendeskConfigured()) {
    console.warn("[final-review-email] Job linked to Zendesk ticket", zdTicketId, "but Zendesk env is not configured. Falling back to Resend.");
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!useZendesk && !resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 503 });
  }

  const ref = String(j.reference ?? "");
  const title = String(j.title ?? "Job");
  const missingReportNote =
    includeReport && attachments.length === 0
      ? "We could not attach report PDFs (missing files or storage). Your job is finalised; contact us if you need copies."
      : "";

  const tradeFeeJob: InvoiceTradeFeeJob | null =
    typeof j.client_price === "number"
      ? {
          client_price: j.client_price,
          extras_amount: typeof j.extras_amount === "number" ? j.extras_amount : undefined,
          commission: typeof j.commission === "number" ? j.commission : 0,
          partner_agreed_value: typeof j.partner_agreed_value === "number" ? j.partner_agreed_value : 0,
          partner_cost: typeof j.partner_cost === "number" ? j.partner_cost : 0,
          materials_cost: typeof j.materials_cost === "number" ? j.materials_cost : 0,
        }
      : null;

  let html: string;
  if (includeInvoice && invoiceRow) {
    html = buildInvoiceEmailHTML(
      invoiceRow,
      {
        clientName: billing.displayName,
        jobTitle: title,
        propertyAddress: typeof j.property_address === "string" ? j.property_address : null,
        serviceType: typeof j.service_type === "string" ? j.service_type : null,
        completionDate:
          typeof j.completed_date === "string"
            ? j.completed_date
            : new Date().toISOString().slice(0, 10),
        quoteReference,
      },
      tradeFeeJob,
      {
        reportAttachmentCount: includeReport ? attachments.length : 0,
        missingReportNote: missingReportNote || undefined,
      },
    );
  } else {
    const reportSentence =
      includeReport && attachments.length > 0
        ? `Please find the final report${attachments.length === 1 ? "" : "s"} attached.`
        : includeReport
          ? "Final report files were requested; see note below if attachments are missing."
          : "No report PDFs are included in this message (per your request).";

    html = `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#111;line-height:1.5;max-width:560px">
<p>Hi ${escapeHtml(billing.displayName)},</p>
<p>Your job <strong>${escapeHtml(ref)}</strong> — ${escapeHtml(title)} — has been finalised.</p>
<p>${reportSentence}</p>
${missingReportNote ? `<p style="color:#B45309;font-size:14px">${escapeHtml(missingReportNote)}</p>` : ""}
<p style="margin:16px 0">If you have any questions, reply to this email or call us.</p>
<p style="color:#666;font-size:13px">— ${escapeHtml(companyName)}</p>
</body></html>`;
  }

  const emailSubject = includeInvoice && invoiceRow
    ? isInvoicePaymentVerified(invoiceRow)
      ? `Payment receipt — ${invoiceRow.reference}`
      : `Invoice ${invoiceRow.reference} — ${ref}`
    : `Job ${ref} — final update`;

  let channel: "zendesk" | "resend";
  let resendId: string | undefined;

  if (useZendesk) {
    try {
      await zdSendCustomerComment({
        ticketId:    zdTicketId!,
        htmlBody:    html,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      channel = "zendesk";
    } catch (err) {
      console.error("final-review-email Zendesk:", err);
      return NextResponse.json(
        { error: "Failed to deliver via Zendesk", detail: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  } else {
    const resend = new Resend(resendKey!);
    const { data: sent, error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: [emailTo],
      subject: emailSubject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (sendErr) {
      console.error("final-review-email Resend:", sendErr);
      return NextResponse.json({ error: sendErr.message ?? "Email send failed" }, { status: 502 });
    }
    channel = "resend";
    resendId = sent?.id;
  }

  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from("jobs")
    .update({ review_sent_at: now, review_send_method: channel === "zendesk" ? "zendesk" : "email" })
    .eq("id", jobId);
  if (upErr) {
    console.error("final-review-email job update:", upErr);
  }

  return NextResponse.json({
    ok: true,
    channel,
    resendId,
    ticketId: channel === "zendesk" ? zdTicketId : undefined,
    attachmentCount: attachments.length,
    to: emailTo,
    includeInvoice,
    includeReport,
  });
}
