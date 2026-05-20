import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerOfferToken } from "@/lib/quote-response-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/jobs/respond-offer    (public, token-authenticated)
 *
 * Partner accept/decline response to a job assignment offer. Token binds
 * (jobId, partnerId), so the response is always attributed to the specific
 * partner the office invited — and the link stops working the moment the
 * job is reassigned to someone else.
 *
 * Body: { token, action: "accept" | "decline", reason? }
 *
 * Side effects on jobs row:
 *   - accept  → partner_offer_response = 'accepted'
 *   - decline → partner_offer_response = 'declined'
 *               partner_offer_decline_reason = <reason>
 *               partner_id / partner_name / partner_ids cleared
 *               status moved back to 'unassigned' so the office picks it up
 *
 * Idempotency: a second click of the same outcome re-stamps the timestamp
 * but doesn't mutate anything else. Flipping from accepted → declined is
 * allowed (and clears the partner just like a first-time decline).
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`respond-offer:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { token?: string; action?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Token is required." }, { status: 400 });
  const verified = verifyPartnerOfferToken(token);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired link." }, { status: 400 });
  }
  const { jobId, partnerId: tokenPartnerId } = verified;

  const action = body.action === "accept" ? "accept" : body.action === "decline" ? "decline" : null;
  if (!action) {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'." }, { status: 400 });
  }
  const reason = action === "decline" && typeof body.reason === "string"
    ? body.reason.trim().slice(0, 4000) || null
    : null;

  const supabase = getServiceSupabase();

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, reference, status, partner_id, partner_name, partner_offer_response")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.partner_id !== tokenPartnerId) {
    return NextResponse.json(
      { error: "This offer link is no longer linked to an active assignment. Please contact the office." },
      { status: 403 },
    );
  }
  if (job.status === "cancelled" || job.status === "completed" || job.status === "deleted") {
    return NextResponse.json(
      { error: `Job is ${job.status} — offer can no longer be changed.` },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    partner_offer_response:     action === "accept" ? "accepted" : "declined",
    partner_offer_responded_at: now,
    partner_offer_decline_reason: reason,
    updated_at: now,
  };
  if (action === "decline") {
    // Free the slot so the office picks the job back up for a new partner.
    update.partner_id    = null;
    update.partner_name  = null;
    update.partner_ids   = [];
    update.status        = "unassigned";
  }

  const { error: updErr } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", jobId);
  if (updErr) {
    console.error("[respond-offer] update failed:", updErr);
    return NextResponse.json({ error: "Could not save response." }, { status: 500 });
  }

  void supabase.from("audit_logs").insert({
    entity_type: "job",
    entity_id:   jobId,
    entity_ref:  job.reference,
    action:      action === "accept" ? "partner_offer_accepted" : "partner_offer_declined",
    field_name:  "partner_offer_response",
    new_value:   action === "accept" ? "accepted" : "declined",
    metadata:    {
      source:     "public_offer_link",
      partner_id: tokenPartnerId,
      reason:     reason,
    },
  }).then(({ error }) => { if (error) console.error("audit_logs (respond-offer)", error); });

  return NextResponse.json({
    ok: true,
    action,
    jobReference: job.reference,
  });
}
