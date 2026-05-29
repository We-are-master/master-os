import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  verifyPartnerJobAcceptToken,
  createPartnerReportToken,
} from "@/lib/quote-response-token";
import {
  closeSideConversation,
  createSideConversation,
  replyToSideConversation,
} from "@/lib/zendesk";
import { buildPartnerJobConfirmationEmail } from "@/lib/emails/partner-job-confirmation";
import { upsertShortLink } from "@/lib/short-links";
import { appBaseUrl } from "@/lib/app-base-url";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * POST /api/jobs/confirm-acceptance
 *
 * Public — token-authenticated. Called by the partner from the email
 * "Accept job" CTA. Token binds (jobId, partnerId).
 *
 * Body: { token: string }
 *
 * Two paths:
 *
 *   1. SPECIFIC ASSIGN — job.partner_id already equals the token's partnerId.
 *      The partner was hand-picked by the office. We just stamp
 *      partner_confirmed_at and send the "booked" follow-up on the existing
 *      side conversation thread.
 *
 *   2. AUTO-ASSIGN CLAIM — job is in status='auto_assigning' with partner_id
 *      IS NULL. The token's partnerId was one of N invited partners. We do
 *      an atomic UPDATE WHERE status='auto_assigning' AND partner_id IS NULL
 *      to ensure only the first POST wins. Then:
 *        - Mark this partner's invite as 'accepted'
 *        - Mark all other invites as 'lost' and close their side conversations
 *        - Promote the winner's side conv id to jobs.zendesk_side_conversation_id
 *        - Reply on the winner's side conv with the booked email + report link
 *      Late clicks (someone else already won) return 409 with a friendly message.
 */
export async function POST(req: NextRequest) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });

  const claims = verifyPartnerJobAcceptToken(token);
  if (!claims) return NextResponse.json({ ok: false, error: "invalid_or_expired_token" }, { status: 401 });

  const { jobId, partnerId } = claims;
  const supabase = createServiceClient();

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, reference, title, status, partner_id, partner_confirmed_at, client_name, property_address, scope, job_type, hourly_partner_rate, partner_cost, auto_assign_invited_partner_ids, external_source, external_ref, zendesk_side_conversation_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!jobRow) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  type JobRow = {
    id: string;
    reference: string;
    title: string | null;
    status: string;
    partner_id: string | null;
    partner_confirmed_at: string | null;
    client_name: string | null;
    property_address: string | null;
    scope: string | null;
    job_type: "hourly" | "fixed" | null;
    hourly_partner_rate: number | null;
    partner_cost: number | null;
    auto_assign_invited_partner_ids: string[] | null;
    external_source: string | null;
    external_ref: string | null;
    zendesk_side_conversation_id: string | null;
  };
  const job = jobRow as JobRow;

  const { data: partnerRow } = await supabase
    .from("partners")
    .select("id, contact_name, company_name, email, zendesk_user_id")
    .eq("id", partnerId)
    .maybeSingle();
  const partner = partnerRow as {
    id: string;
    contact_name: string | null;
    company_name: string | null;
    email: string | null;
    zendesk_user_id: string | null;
  } | null;
  if (!partner) return NextResponse.json({ ok: false, error: "partner_not_found" }, { status: 404 });

  const partnerLabel =
    partner.contact_name?.trim() ||
    partner.company_name?.trim() ||
    "Partner";
  const partnerName = partner.contact_name?.trim() || partner.company_name?.trim() || null;

  // ─── Path selection ──────────────────────────────────────────────────
  const isSpecific = job.partner_id === partnerId;
  const isAutoClaimable =
    job.status === "auto_assigning" &&
    job.partner_id === null &&
    (job.auto_assign_invited_partner_ids ?? []).includes(partnerId);

  if (!isSpecific && !isAutoClaimable) {
    // Partner mismatch — either someone else won the auto-assign race, or
    // the office reassigned this job to a different partner.
    if (job.status === "scheduled" || job.partner_id) {
      return NextResponse.json(
        {
          ok:           false,
          error:        "job_taken",
          jobReference: job.reference,
          message:      "This job has already been taken by another partner. Thanks for being quick!",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok:           false,
        error:        "partner_mismatch",
        jobReference: job.reference,
        message:      "This job is no longer assigned to you.",
      },
      { status: 410 },
    );
  }

  // ─── 1. Specific-assign path ──────────────────────────────────────────
  if (isSpecific) {
    const alreadyConfirmed = Boolean(job.partner_confirmed_at);
    if (!alreadyConfirmed) {
      const { error: upErr } = await supabase
        .from("jobs")
        .update({ partner_confirmed_at: new Date().toISOString() })
        .eq("id", jobId);
      if (upErr) {
        console.error("[confirm-acceptance] specific update failed:", upErr);
        return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
      }
    }

    // Booked follow-up — fire-and-forget on the existing side conv thread.
    void sendBookedSideConvReply({ job, partner, partnerName });

    return NextResponse.json({
      ok:           true,
      alreadyConfirmed,
      jobReference: job.reference,
      partnerLabel,
    });
  }

  // ─── 2. Auto-assign atomic claim ──────────────────────────────────────
  // Only the first POST whose UPDATE affects 1 row wins. The WHERE clause
  // guarantees: status MUST still be auto_assigning AND partner_id MUST
  // still be NULL. Any concurrent POST loses.
  const now = new Date().toISOString();
  const { data: claimRows, error: claimErr } = await supabase
    .from("jobs")
    .update({
      partner_id:           partnerId,
      partner_name:         partnerName,
      status:               "scheduled",
      partner_confirmed_at: now,
    })
    .eq("id", jobId)
    .eq("status", "auto_assigning")
    .is("partner_id", null)
    .select("id");

  if (claimErr) {
    console.error("[confirm-acceptance] claim update failed:", claimErr);
    return NextResponse.json({ ok: false, error: "claim_failed" }, { status: 500 });
  }
  if (!claimRows || claimRows.length === 0) {
    // Race lost — refresh once to surface a friendly message.
    const { data: fresh } = await supabase
      .from("jobs")
      .select("status, partner_id")
      .eq("id", jobId)
      .maybeSingle();
    const taken = fresh && (fresh as { partner_id: string | null }).partner_id;
    return NextResponse.json(
      {
        ok:      false,
        error:   "job_taken",
        message: taken
          ? "This job has already been taken by another partner. Thanks for being quick!"
          : "This job is no longer available.",
      },
      { status: 409 },
    );
  }

  // ─── Finalise the winner's invite + collect losers ────────────────────
  const { data: invitesData } = await supabase
    .from("job_partner_invites")
    .select("partner_id, zendesk_side_conversation_id, status")
    .eq("job_id", jobId);
  const invites = (invitesData ?? []) as Array<{
    partner_id: string;
    zendesk_side_conversation_id: string | null;
    status: string;
  }>;

  const winnerInvite = invites.find((i) => i.partner_id === partnerId);
  const losers = invites.filter((i) => i.partner_id !== partnerId);

  // Mark winner accepted (and capture its side conv id if we already had one)
  const winnerSideConvId = winnerInvite?.zendesk_side_conversation_id ?? null;
  if (winnerInvite) {
    await supabase
      .from("job_partner_invites")
      .update({ status: "accepted", decided_at: now })
      .eq("job_id", jobId)
      .eq("partner_id", partnerId);
  } else {
    // The partner was in auto_assign_invited_partner_ids but no invite row
    // was written (e.g. side conv create failed). Insert one now so the
    // history is complete.
    await supabase
      .from("job_partner_invites")
      .upsert({
        job_id:     jobId,
        partner_id: partnerId,
        status:     "accepted",
        invited_at: now,
        decided_at: now,
      }, { onConflict: "job_id,partner_id" });
  }

  // Mark losers + close their side convs
  if (losers.length > 0) {
    await supabase
      .from("job_partner_invites")
      .update({ status: "lost", decided_at: now })
      .eq("job_id", jobId)
      .neq("partner_id", partnerId);

    const zendeskTicketId = job.external_source === "zendesk" ? job.external_ref : null;
    if (zendeskTicketId) {
      for (const loser of losers) {
        if (!loser.zendesk_side_conversation_id) continue;
        void closeSideConversation({
          ticketId:           zendeskTicketId,
          sideConversationId: loser.zendesk_side_conversation_id,
        }).catch((err) => console.error("[confirm-acceptance] close loser side conv failed:", err));
      }
    }
  }

  // Promote winner's side conv → job's primary thread (so future status
  // notices reply on the same email chain the partner already accepted in)
  if (winnerSideConvId && !job.zendesk_side_conversation_id) {
    await supabase
      .from("jobs")
      .update({ zendesk_side_conversation_id: winnerSideConvId })
      .eq("id", jobId);
  }

  // Fire booked reply on the winner's side conv (uses the just-promoted id)
  void sendBookedSideConvReply({
    job: { ...job, status: "scheduled", partner_id: partnerId, zendesk_side_conversation_id: winnerSideConvId ?? job.zendesk_side_conversation_id },
    partner,
    partnerName,
  });

  return NextResponse.json({
    ok:           true,
    alreadyConfirmed: false,
    jobReference: job.reference,
    partnerLabel,
    claimed:      true,
  });
}

// ─── Booked reply helper ────────────────────────────────────────────────

interface JobForBookedReply {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  partner_id: string | null;
  client_name: string | null;
  property_address: string | null;
  scope: string | null;
  job_type: "hourly" | "fixed" | null;
  hourly_partner_rate: number | null;
  partner_cost: number | null;
  external_source: string | null;
  external_ref: string | null;
  zendesk_side_conversation_id: string | null;
}

async function sendBookedSideConvReply(args: {
  job: JobForBookedReply;
  partner: { id: string; contact_name: string | null; company_name: string | null; email: string | null; zendesk_user_id: string | null };
  partnerName: string | null;
}): Promise<void> {
  const { job, partner } = args;
  const ticketId = job.external_source === "zendesk" ? job.external_ref : null;
  if (!ticketId || !partner.email) return;

  const isHourly = job.job_type === "hourly";
  const priceDisplay = isHourly
    ? `£${Number(job.hourly_partner_rate ?? 0).toFixed(2)}/hr`
    : `£${Number(job.partner_cost ?? 0).toFixed(2)}`;
  const partnerFirstName = (partner.contact_name?.trim().split(/\s+/)[0])
    || (partner.company_name?.trim() ?? "Partner");

  const base = appBaseUrl();
  let reportUrl = `${base}/job/report?token=${encodeURIComponent(createPartnerReportToken(job.id, partner.id))}`;
  try {
    const r = await upsertShortLink({
      targetPath: `/job/report?token=${encodeURIComponent(createPartnerReportToken(job.id, partner.id))}`,
      kind:       "partner_report",
      entityRef:  `job:${job.id}:partner:${partner.id}`,
    });
    reportUrl = `${base}${r.shortPath}`;
  } catch (err) {
    console.error("[booked reply] short link failed:", err);
  }

  const email = buildPartnerJobConfirmationEmail({
    partnerFirstName,
    jobReference:    job.reference,
    jobTitle:        job.title || "Maintenance job",
    clientName:      job.client_name || "—",
    propertyAddress: job.property_address || "—",
    scope:           job.scope || "(no scope provided)",
    jobType:         isHourly ? "hourly" : "fixed",
    priceDisplay,
    reportUrl,
  });

  try {
    if (job.zendesk_side_conversation_id) {
      const r = await replyToSideConversation({
        ticketId,
        sideConversationId: job.zendesk_side_conversation_id,
        htmlBody:           email.html,
        bodyText:           email.text,
      });
      if (!r.ok) console.error("[booked reply] failed:", r.error);
    } else {
      // No prior side conv (specific-assign without prior thread) — open a new one.
      const supabase = createServiceClient();
      const r = await createSideConversation({
        ticketId,
        toEmail:  partner.email,
        toName:   partner.contact_name || partner.company_name || undefined,
        toUserId: partner.zendesk_user_id ?? undefined,
        subject:  email.subject,
        htmlBody: email.html,
        bodyText: email.text,
      });
      if (r.ok && r.id) {
        await supabase
          .from("jobs")
          .update({ zendesk_side_conversation_id: r.id })
          .eq("id", job.id);
      } else {
        console.error("[booked reply] create side conv failed:", r.error);
      }
    }
  } catch (err) {
    console.error("[booked reply] threw:", err);
  }
}
