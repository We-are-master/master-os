import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  finalizeAutoAssignWinner,
  loadJobForPartnerAcceptance,
  loadPartnerForAcceptance,
  partnerDisplayName,
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
 * Called by the trade portal after an in-app auto-assign claim succeeds.
 * Finalises job_partner_invites and sends the Job booked Zendesk side conversation.
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
  const job = await loadJobForPartnerAcceptance(supabase, jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  }

  if (job.partner_id !== partnerId) {
    return NextResponse.json({ ok: false, error: "partner_mismatch" }, { status: 409 });
  }
  if (job.status !== "scheduled") {
    return NextResponse.json({ ok: false, error: "job_not_scheduled" }, { status: 409 });
  }

  const partner = await loadPartnerForAcceptance(supabase, partnerId);
  if (!partner) {
    return NextResponse.json({ ok: false, error: "partner_not_found" }, { status: 404 });
  }

  const partnerName = partner.contact_name?.trim() || partner.company_name?.trim() || null;
  const now = new Date().toISOString();

  if (!job.partner_confirmed_at) {
    await supabase
      .from("jobs")
      .update({
        partner_confirmed_at: now,
        partner_name: partnerName,
      })
      .eq("id", jobId);
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
    jobReference: job.reference,
    partnerLabel: partnerDisplayName(partner),
  });
}
