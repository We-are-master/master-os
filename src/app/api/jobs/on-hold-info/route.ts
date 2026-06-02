import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyPartnerOnHoldToken } from "@/lib/quote-response-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/jobs/on-hold-info?token=...   (public, token-authenticated)
 *
 * Backs the public "resolve this job" page. Verifies the partner-scoped
 * on-hold token, then returns the minimal job context the form needs to
 * render (no customer phone — privacy). Tells the page whether the job is
 * still on hold and whether a submission already exists.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  const verified = verifyPartnerOnHoldToken(token);
  if (!verified) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  }
  const { jobId, partnerId } = verified;

  const supabase = createServiceClient();
  const { data: jobRow, error } = await supabase
    .from("jobs")
    .select("id, reference, title, property_address, status, partner_id, on_hold_reason, on_hold_submission_at")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !jobRow) {
    return NextResponse.json({ error: "job_not_found" }, { status: 404 });
  }
  const job = jobRow as {
    id: string;
    reference: string;
    title: string | null;
    property_address: string | null;
    status: string;
    partner_id: string | null;
    on_hold_reason: string | null;
    on_hold_submission_at: string | null;
  };

  // Lock the link to the assigned partner — a reassigned job invalidates it.
  if (job.partner_id !== partnerId) {
    return NextResponse.json({ error: "partner_mismatch" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    jobReference: job.reference,
    jobTitle: job.title,
    propertyAddress: job.property_address,
    onHoldReason: job.on_hold_reason,
    isOnHold: job.status === "on_hold",
    alreadySubmitted: Boolean(job.on_hold_submission_at),
  });
}
