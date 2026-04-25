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
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";
import type { Account } from "@/types/database";

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
    .select("id, reference, title, client_id, client_name, property_address, status, invoice_id")
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
    return NextResponse.json(
      { error: "No billing email for this client. Add an email on the client or account before sending." },
      { status: 400 },
    );
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
  let invoiceLine = "";
  if (includeInvoice && invoiceId) {
    const { data: inv } = await admin
      .from("invoices")
      .select("reference, amount, status, due_date")
      .eq("id", invoiceId)
      .maybeSingle();
    if (inv) {
      const ir = inv as { reference?: string; amount?: number; status?: string; due_date?: string | null };
      const amt = Number(ir.amount ?? 0);
      const due = ir.due_date ? String(ir.due_date).slice(0, 10) : "";
      invoiceLine = `<p style="margin:12px 0">Invoice: <strong>${escapeHtml(ir.reference ?? "")}</strong> — ${escapeHtml(amt.toFixed(2))} GBP${due ? ` · due ${escapeHtml(due)}` : ""} · status ${escapeHtml(ir.status ?? "")}</p>`;
    }
  }

  const { data: settings } = await admin.from("company_settings").select("company_name").limit(1).maybeSingle();
  const companyName =
    settings && (settings as { company_name?: string | null }).company_name
      ? String((settings as { company_name?: string | null }).company_name)
      : "Our team";
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${companyName} <onboarding@resend.dev>`;

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 503 });
  }

  const ref = escapeHtml(String(j.reference ?? ""));
  const title = escapeHtml(String(j.title ?? "Job"));
  const site = escapeHtml(String(j.property_address ?? ""));
  const greet = escapeHtml(billing.displayName);
  const attachNote =
    includeReport && attachments.length === 0
      ? "<p style=\"color:#B45309;font-size:14px\">We could not attach report PDFs (missing files or storage). Your job is finalised; contact us if you need copies.</p>"
    : !includeReport
      ? ""
      : "";

  const invNote =
    includeInvoice && !invoiceLine
      ? "<p style=\"color:#6B6B6B;font-size:14px\">Payment / invoice details will follow if not shown above.</p>"
      : "";

  const reportSentence =
    includeReport && attachments.length > 0
      ? `Please find the final report${attachments.length === 1 ? "" : "s"} attached.`
    : includeReport
      ? "Final report files were requested; see note below if attachments are missing."
    : "No report PDFs are included in this message (per your request).";

  const invSentence = includeInvoice
    ? "Invoice and payment information is included below when available."
    : "No invoice details are included in this email (per your agreement).";

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#111;line-height:1.5;max-width:560px">
<p>Hi ${greet},</p>
<p>Your job <strong>${ref}</strong> — ${title}${site ? `<br/>${site}` : ""} — has been finalised.</p>
<p>${reportSentence}</p>
<p>${invSentence}</p>
${attachNote}
${includeInvoice ? invNote : ""}
${invoiceLine}
<p style="margin:16px 0">If you have any questions, reply to this email or call us.</p>
<p style="color:#666;font-size:13px">— ${escapeHtml(companyName)}</p>
</body></html>`;

  const resend = new Resend(resendKey);
  const { data: sent, error: sendErr } = await resend.emails.send({
    from: fromEmail,
    to: [emailTo],
    subject: `Job ${String(j.reference ?? "")} — final update`,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (sendErr) {
    console.error("final-review-email Resend:", sendErr);
    return NextResponse.json({ error: sendErr.message ?? "Email send failed" }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from("jobs")
    .update({ review_sent_at: now, review_send_method: "email" })
    .eq("id", jobId);
  if (upErr) {
    console.error("final-review-email job update:", upErr);
  }

  return NextResponse.json({
    ok: true,
    resendId: sent?.id,
    attachmentCount: attachments.length,
    to: emailTo,
    includeInvoice,
    includeReport,
  });
}
