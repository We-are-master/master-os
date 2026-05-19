import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createSideConversation,
  createTicket,
  getZendeskTicketId,
  isZendeskConfigured,
  replyToSideConversation,
} from "@/lib/zendesk";
import { createPartnerReportToken } from "@/lib/quote-response-token";
import { appBaseUrl } from "@/lib/app-base-url";
import { ZD_STATUS_SCHEDULED } from "@/lib/zendesk-statuses";

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
    .select("id, reference, title, property_address, partner_id, client_name, client_email, scope, external_source, external_ref, zendesk_side_conversation_id")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (jobErr) {
    console.error("[send-partner-report-link] job lookup error:", jobErr.message);
    return NextResponse.json({ error: "Job lookup failed." }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "Job has no partner assigned." },
      { status: 400 },
    );
  }

  const { data: partner } = await admin
    .from("partners")
    .select("contact_name, company_name, email")
    .eq("id", job.partner_id)
    .maybeSingle();
  const partnerEmail = (partner as { email?: string | null } | null)?.email?.trim() ?? "";
  const partnerName =
    (partner as { company_name?: string | null } | null)?.company_name?.trim() ||
    (partner as { contact_name?: string | null } | null)?.contact_name?.trim() ||
    "there";
  if (!partnerEmail) {
    return NextResponse.json(
      { error: "Assigned partner has no email on file." },
      { status: 400 },
    );
  }

  const token = createPartnerReportToken(String(job.id), String(job.partner_id));
  const base = appBaseUrl();
  // Semantic /job/report path for partner work-report submission.
  const reportUrl = `${base}/job/report?token=${encodeURIComponent(token)}`;

  const subject = `Submit work report — ${String(job.reference ?? "")}`;
  const { html, text } = buildPartnerReportRequestEmail({
    partnerName,
    jobReference: String(job.reference ?? ""),
    jobTitle: String(job.title ?? ""),
    propertyAddress: String(job.property_address ?? ""),
    reportUrl,
  });

  let ticketId = getZendeskTicketId(job);
  const failureChain: string[] = [];

  // Path 0: No ticket yet → create a Zendesk ticket so the side
  // conversation has a parent, then proceed. We register the **partner**
  // as the requester (not the customer) because this action is explicitly
  // about routing the report link to the partner — the customer should
  // not receive a new-ticket notification. We also mark the first
  // comment as private (`public: false`) so the requester-email Zendesk
  // sends out only carries the silent placeholder we put there; the
  // actual partner-facing email is the side conv below.
  if (!ticketId && isZendeskConfigured() && partnerEmail) {
    const tCreate = await createTicket({
      subject: `Job ${job.reference ?? ""} — ${job.title ?? ""}`.trim(),
      htmlBody: `<p>Auto-created from Fixfy OS to route the work report request to the partner.</p>`,
      publicComment: false,
      requesterEmail: partnerEmail,
      requesterName: partnerName || null,
      customStatusId: ZD_STATUS_SCHEDULED,
      externalId: `job:${job.id}`,
      tags: ["fixfy_os_auto_created", "partner_report_link"],
    });
    if (tCreate.ok && tCreate.id) {
      ticketId = String(tCreate.id);
      await admin
        .from("jobs")
        .update({ external_source: "zendesk", external_ref: ticketId })
        .eq("id", jobId);
      console.log("[send-partner-report-link] auto-created partner-scoped ticket", ticketId, "for job", job.reference);
    } else {
      failureChain.push(`auto-create: ${tCreate.error ?? "unknown"}`);
    }
  } else if (!ticketId && isZendeskConfigured() && !partnerEmail) {
    failureChain.push("auto-create: no partner email to use as requester");
  }

  // Path 1: Zendesk side conversation (preferred when ticket is linked).
  if (ticketId && isZendeskConfigured()) {
    let sideConvId: string | null = (job as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null;

    // 1a) Try replying on the existing thread first.
    if (sideConvId) {
      const r = await replyToSideConversation({
        ticketId,
        sideConversationId: sideConvId,
        htmlBody: html,
        bodyText: text,
      });
      if (r.ok) {
        return NextResponse.json({ ok: true, channel: "zendesk_side_conv_reply", sideConversationId: sideConvId, reportUrl });
      }
      // Reply failed — common cause is the stored side conv lost its `to`
      // (e.g. created with the wrong/missing partner email earlier). Clear
      // the saved id and fall through to create a fresh side conv with
      // the current partner email.
      console.warn(
        "[send-partner-report-link] reply on existing side conv",
        sideConvId,
        "failed:",
        r.error,
      );
      failureChain.push(`reply: ${r.error ?? "unknown"}`);
      sideConvId = null;
    }

    // 1b) Open a new side conversation. Requires a partner email.
    if (partnerEmail) {
      const r = await createSideConversation({
        ticketId,
        toEmail: partnerEmail,
        toName: partnerName,
        subject,
        htmlBody: html,
        bodyText: text,
      });
      if (r.ok) {
        if (r.id) {
          await admin.from("jobs").update({ zendesk_side_conversation_id: r.id }).eq("id", jobId);
        }
        return NextResponse.json({ ok: true, channel: "zendesk_side_conv_open", sideConversationId: r.id ?? null, reportUrl });
      }
      failureChain.push(`create: ${r.error ?? "unknown"}`);
    } else {
      failureChain.push("create: partner has no email");
    }
  } else if (!ticketId) {
    failureChain.push("zendesk: job is not linked to a ticket");
  } else if (!isZendeskConfigured()) {
    failureChain.push("zendesk: server env vars missing");
  }

  // Path 2: Resend direct email to the partner (fallback whenever Zendesk
  // path didn't deliver — links a non-Zendesk job, missing env, or any
  // upstream 4xx/5xx). We still need a partner email.
  if (!partnerEmail) {
    return NextResponse.json(
      { error: `Could not deliver: partner has no email on file. ${failureChain.join(" · ")}` },
      { status: 400 },
    );
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json(
      {
        error:
          `Zendesk delivery failed and Resend fallback is not configured. ${failureChain.join(" · ")}`,
      },
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
    return NextResponse.json(
      { error: `${error.message ?? "Email send failed."} (zendesk: ${failureChain.join(" · ") || "ok"})` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok:        true,
    channel:   "resend",
    reportUrl,
    // Surface the upstream Zendesk failure (if any) so the operator knows
    // why we fell back to direct email instead of the ticket side conv.
    zendeskFailure: failureChain.length > 0 ? failureChain.join(" · ") : null,
  });
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
