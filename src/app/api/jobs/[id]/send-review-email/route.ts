import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { JobReportPDF } from "@/lib/pdf/job-report-pdf";
import { InvoicePreviewPDF } from "@/lib/pdf/invoice-preview-pdf";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id || !isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY)." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: job, error: jobErr } = await supabase.from("jobs").select("*").eq("id", id).single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const invoiceId = job.invoice_id?.trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "no_invoice", message: "Invoice not yet generated." }, { status: 400 });
  }

  const { data: invoice, error: invErr } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (invErr || !invoice) {
    return NextResponse.json({ error: "no_invoice", message: "Invoice not yet generated." }, { status: 400 });
  }

  let toEmail = (invoice.stripe_customer_email as string | undefined)?.trim() || null;
  if (!toEmail && job.client_id) {
    const { data: clientRow } = await supabase.from("clients").select("email").eq("id", job.client_id).maybeSingle();
    toEmail = (clientRow?.email as string | undefined)?.trim() || null;
  }
  if (!toEmail) {
    return NextResponse.json({ error: "no_client_email", message: "No client email on file for this job." }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reportPdf = await (renderToBuffer as any)(
    React.createElement(JobReportPDF, {
      job,
      startReport: job.start_report as Record<string, unknown> | null,
      finalReport: job.final_report as Record<string, unknown> | null,
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoicePdf = await (renderToBuffer as any)(React.createElement(InvoicePreviewPDF, { invoice }));

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Master OS <noreply@resend.dev>";
  const resend = new Resend(resendKey);

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Job report & invoice — ${job.reference}`,
      html: `<p>Please find your job report and invoice attached for <strong>${job.reference}</strong>.</p>`,
      attachments: [
        { filename: `job-report-${job.reference}.pdf`, content: Buffer.from(reportPdf) },
        { filename: `invoice-${invoice.reference}.pdf`, content: Buffer.from(invoicePdf) },
      ],
    });
    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: error.message ?? "Failed to send email" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, emailId: data?.id });
  } catch (e) {
    console.error("send-review-email:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send email" },
      { status: 500 },
    );
  }
}
