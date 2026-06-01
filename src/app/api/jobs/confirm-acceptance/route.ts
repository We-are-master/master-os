import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyPartnerJobAcceptToken } from "@/lib/quote-response-token";
import {
  finalizeAutoAssignWinner,
  loadJobForPartnerAcceptance,
  loadPartnerForAcceptance,
  partnerDisplayName,
  sendBookedSideConvReply,
} from "@/lib/job-partner-acceptance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/jobs/confirm-acceptance
 *
 * Public — token-authenticated. Called by the partner from the email
 * "Accept job" CTA. Token binds (jobId, partnerId).
 *
 * Body: { token: string }
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

  const job = await loadJobForPartnerAcceptance(supabase, jobId);
  if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });

  const partner = await loadPartnerForAcceptance(supabase, partnerId);
  if (!partner) return NextResponse.json({ ok: false, error: "partner_not_found" }, { status: 404 });

  const partnerLabel = partnerDisplayName(partner);
  const partnerName = partner.contact_name?.trim() || partner.company_name?.trim() || null;

  const isSpecific = job.partner_id === partnerId;
  const isAutoClaimable =
    job.status === "auto_assigning" &&
    job.partner_id === null &&
    (job.auto_assign_invited_partner_ids ?? []).includes(partnerId);

  if (!isSpecific && !isAutoClaimable) {
    if (job.status === "scheduled" || job.partner_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "job_taken",
          jobReference: job.reference,
          message: "This job has already been taken by another partner. Thanks for being quick!",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "partner_mismatch",
        jobReference: job.reference,
        message: "This job is no longer assigned to you.",
      },
      { status: 410 },
    );
  }

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

    if (!alreadyConfirmed) {
      void sendBookedSideConvReply({ supabase, job, partner, partnerName });
    }

    return NextResponse.json({
      ok: true,
      alreadyConfirmed,
      jobReference: job.reference,
      partnerLabel,
    });
  }

  const now = new Date().toISOString();
  const { data: claimRows, error: claimErr } = await supabase
    .from("jobs")
    .update({
      partner_id: partnerId,
      partner_name: partnerName,
      status: "scheduled",
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
    const { data: fresh } = await supabase
      .from("jobs")
      .select("status, partner_id")
      .eq("id", jobId)
      .maybeSingle();
    const taken = fresh && (fresh as { partner_id: string | null }).partner_id;
    return NextResponse.json(
      {
        ok: false,
        error: "job_taken",
        message: taken
          ? "This job has already been taken by another partner. Thanks for being quick!"
          : "This job is no longer available.",
      },
      { status: 409 },
    );
  }

  await finalizeAutoAssignWinner({
    supabase,
    jobId,
    partnerId,
    job,
    partner,
    partnerName,
  });

  return NextResponse.json({
    ok: true,
    alreadyConfirmed: false,
    jobReference: job.reference,
    partnerLabel,
    claimed: true,
  });
}
