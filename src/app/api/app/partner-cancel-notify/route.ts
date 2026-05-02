import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getUserFromBearer } from "@/lib/supabase/bearer-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import { escapeHtmlAttr } from "@/lib/email-asset-url";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Called by the partner app after a successful `partner_cancel_job` RPC.
 * Sends one email to INTERNAL_TEAM_EMAILS (comma-separated).
 */
export async function POST(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized", message: auth.message }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string" || !isValidUUID(jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: partner } = await admin
    .from("partners")
    .select("id, contact_name, company_name, email")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();

  if (!partner?.id) {
    return NextResponse.json({ error: "Not a linked partner" }, { status: 403 });
  }

  const { data: job, error: jobErr } = await admin.from("jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.partner_id !== partner.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (job.status !== "cancelled" || !job.partner_cancelled_at) {
    return NextResponse.json({ error: "Job is not a partner cancellation" }, { status: 400 });
  }

  const cancelledAt = new Date(job.partner_cancelled_at as string).getTime();
  if (!Number.isFinite(cancelledAt) || Date.now() - cancelledAt > 5 * 60 * 1000) {
    return NextResponse.json({ error: "Cancellation is too old to notify" }, { status: 400 });
  }

  const recipients =
    process.env.INTERNAL_TEAM_EMAILS?.split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("@")) ?? [];

  if (!recipients.length || !resend) {
    return NextResponse.json({ ok: true, emailSent: false, reason: "no_recipients_or_resend" });
  }

  const ref = String(job.reference ?? jobId);
  const title = String(job.title ?? "Job");
  const fee = job.partner_cancellation_fee != null ? String(job.partner_cancellation_fee) : "—";
  const reason =
    job.partner_cancellation_reason != null && String(job.partner_cancellation_reason).trim()
      ? String(job.partner_cancellation_reason).trim()
      : "(none)";

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    new URL(req.url).origin;
  const jobUrl = `${base}/jobs/${jobId}`;

  const html = `
    <h2>Partner cancelled a job</h2>
    <p><strong>Reference:</strong> ${ref}</p>
    <p><strong>Title:</strong> ${title}</p>
    <p><strong>Client:</strong> ${String(job.client_name ?? "—")}</p>
    <p><strong>Address:</strong> ${String(job.property_address ?? "—")}</p>
    <p><strong>Cancellation fee (GBP):</strong> ${fee}</p>
    <p><strong>Partner:</strong> ${String(partner.company_name ?? partner.contact_name ?? "—")} (${String(partner.email ?? "—")})</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p><a href="${escapeHtmlAttr(jobUrl)}">Open in Fixfy OS</a></p>
  `;

  try {
    const from = process.env.RESEND_FROM_EMAIL ?? "Fixfy OS <onboarding@resend.dev>";
    await resend.emails.send({
      from,
      to: recipients,
      subject: `Partner cancelled job ${ref}`,
      html,
    });
    return NextResponse.json({ ok: true, emailSent: true });
  } catch (e) {
    console.error("partner-cancel-notify email", e);
    return NextResponse.json({ ok: false, emailSent: false, error: "send_failed" }, { status: 500 });
  }
}
