import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createSideConversation,
  getZendeskTicketId,
  isZendeskConfigured,
  replyToSideConversation,
} from "@/lib/zendesk";
import { createPartnerReportToken } from "@/lib/quote-response-token";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/jobs/[id]/send-partner-report-link
 *
 * Delivers the partner-scoped report URL to the assigned partner:
 *   - Zendesk-linked job → posts on the existing side conversation
 *     (creates one if it doesn't exist yet) so the office sees the same
 *     thread the partner sees.
 *   - Non-Zendesk job → falls back to Resend direct email.
 *
 * Auth: admin/manager/operator only.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .select(`
      id, reference, title, property_address, partner_id,
      external_source, external_ref, zendesk_side_conversation_id,
      partners ( contact_name, company_name, email )
    `)
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "Job has no partner assigned." },
      { status: 400 },
    );
  }

  const partner = (job as unknown as {
    partners?: { contact_name?: string | null; company_name?: string | null; email?: string | null } | null;
  }).partners;
  const partnerEmail = partner?.email?.trim() ?? "";
  const partnerName = partner?.company_name?.trim() || partner?.contact_name?.trim() || "there";
  if (!partnerEmail) {
    return NextResponse.json(
      { error: "Assigned partner has no email on file." },
      { status: 400 },
    );
  }

  const token = createPartnerReportToken(String(job.id), String(job.partner_id));
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  const reportUrl = `${base}/quote/respond?token=${encodeURIComponent(token)}`;

  const subject = `Submit work report — ${String(job.reference ?? "")}`;
  const { html, text } = buildPartnerReportRequestEmail({
    partnerName,
    jobReference: String(job.reference ?? ""),
    jobTitle: String(job.title ?? ""),
    propertyAddress: String(job.property_address ?? ""),
    reportUrl,
  });

  const ticketId = getZendeskTicketId(job);

  // Path 1: Zendesk linked → side conversation (preferred channel).
  if (ticketId && isZendeskConfigured()) {
    let sideConvId: string | null = (job as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null;
    if (sideConvId) {
      const r = await replyToSideConversation({
        ticketId,
        sideConversationId: sideConvId,
        htmlBody: html,
        bodyText: text,
      });
      if (!r.ok) {
        return NextResponse.json({ error: r.error ?? "Could not reply on side conversation." }, { status: 502 });
      }
      return NextResponse.json({ ok: true, channel: "zendesk_side_conv_reply", sideConversationId: sideConvId, reportUrl });
    }
    const r = await createSideConversation({
      ticketId,
      toEmail: partnerEmail,
      toName: partnerName,
      subject,
      htmlBody: html,
      bodyText: text,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.error ?? "Could not open side conversation." }, { status: 502 });
    }
    if (r.id) {
      sideConvId = r.id;
      await admin.from("jobs").update({ zendesk_side_conversation_id: r.id }).eq("id", jobId);
    }
    return NextResponse.json({ ok: true, channel: "zendesk_side_conv_open", sideConversationId: sideConvId, reportUrl });
  }

  // Path 2: Resend direct email fallback.
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json(
      { error: "No delivery channel: job is not Zendesk-linked and RESEND_API_KEY is not configured." },
      { status: 503 },
    );
  }
  const resend = new Resend(resendKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Fixfy <reports@example.com>";
  const { error } = await resend.emails.send({
    from: fromEmail,
    to: [partnerEmail],
    subject,
    html,
    text,
  });
  if (error) {
    return NextResponse.json({ error: error.message ?? "Email send failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, channel: "resend", reportUrl });
}

function buildPartnerReportRequestEmail(args: {
  partnerName:     string;
  jobReference:    string;
  jobTitle:        string;
  propertyAddress: string;
  reportUrl:       string;
}): { html: string; text: string } {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const safe = {
    name: esc(args.partnerName),
    ref: esc(args.jobReference),
    title: esc(args.jobTitle),
    address: esc(args.propertyAddress),
    url: esc(args.reportUrl),
  };
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;max-width:600px;">
  <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#3A3A55;">Hi ${safe.name},</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#3A3A55;">
    Please submit the work report for <strong>${safe.ref}</strong> — ${safe.title}.
  </p>
  <p style="margin:0 0 14px;font-size:13px;color:#6B6B70;">📍 ${safe.address}</p>
  <p style="margin:22px 0;">
    <a href="${safe.url}" style="display:inline-block;background:#020040;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:14px;">Open report form</a>
  </p>
  <p style="margin:14px 0 0;font-size:12px;color:#6B6B70;">
    No app needed — the form runs in your browser. Photos are resized automatically before upload.
  </p>
</div>
  `.replace(/>\s+</g, "><").trim();
  const text =
    `Hi ${args.partnerName},\n\n` +
    `Please submit the work report for ${args.jobReference} — ${args.jobTitle}.\n` +
    `${args.propertyAddress}\n\n` +
    `Open report form: ${args.reportUrl}\n\n` +
    `No app needed — runs in the browser.`;
  return { html, text };
}
