import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { partnerMissingRequiredDocs } from "@/lib/partner-docs-gate";
import {
  claimAutoAssignJob,
  finalizeAutoAssignWinner,
  loadJobForPartnerAcceptance,
  loadPartnerForAcceptance,
  partnerDisplayName,
  partnerNameForJobRow,
} from "@/lib/job-partner-acceptance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretsMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * POST /api/internal/jobs/partner-portal-accept
 *
 * Called by the trade portal when a partner accepts an auto-assign offer in-app.
 * Performs the atomic claim, finalises invites, sends Job booked Zendesk email,
 * and syncs ticket status + form fields.
 *
 * Auth: header `x-internal-secret` must match env `INTERNAL_SYNC_SECRET`.
 * Body: { jobId: uuid, partnerId: uuid }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!expected) {
    console.error("[internal/partner-portal-accept] INTERNAL_SYNC_SECRET not configured");
    return NextResponse.json({ ok: false, error: "Endpoint not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: { jobId?: string; partnerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const jobId = body.jobId?.trim() ?? "";
  const partnerId = body.partnerId?.trim() ?? "";
  if (!isValidUUID(jobId) || !isValidUUID(partnerId)) {
    return NextResponse.json({ ok: false, error: "jobId and partnerId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const missing = await partnerMissingRequiredDocs(supabase, partnerId);
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Upload your required documents first: ${missing.join(", ")}.`,
        code: "docs_required",
      },
      { status: 403 },
    );
  }

  const job = await loadJobForPartnerAcceptance(supabase, jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  }

  const partner = await loadPartnerForAcceptance(supabase, partnerId);
  if (!partner) {
    return NextResponse.json({ ok: false, error: "partner_not_found" }, { status: 404 });
  }

  const partnerName = partnerNameForJobRow(partner);

  const claim = await claimAutoAssignJob({
    supabase,
    jobId,
    partnerId,
    partnerName,
  });

  if (!claim.claimed) {
    if (claim.reason === "job_taken") {
      return NextResponse.json(
        {
          ok: false,
          accepted: false,
          error: "job_taken",
          message: "This job has already been taken by another partner.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        accepted: false,
        error: claim.reason,
        message: "This job is no longer available.",
      },
      { status: 409 },
    );
  }

  const freshJob = (await loadJobForPartnerAcceptance(supabase, jobId)) ?? job;

  const { bookedEmail } = await finalizeAutoAssignWinner({
    supabase,
    jobId,
    partnerId,
    job: freshJob,
    partner,
    partnerName,
  });

  return NextResponse.json({
    ok: true,
    accepted: true,
    jobReference: freshJob.reference,
    partnerLabel: partnerDisplayName(partner),
    partnerId,
    partnerName,
    bookedEmail,
  });
}
