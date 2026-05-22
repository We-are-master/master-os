import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyPartnerJobAcceptToken } from "@/lib/quote-response-token";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * POST /api/jobs/confirm-acceptance
 *
 * Public — token-authenticated. Called by the partner from the email
 * "Accept job" CTA (or the /job/confirm landing page after a short-link
 * redirect). Token binds (jobId, partnerId), so a partner can only accept
 * their own job.
 *
 * Body: { token: string }
 *
 * Behaviour:
 *   - Verify the token
 *   - Stamp jobs.partner_confirmed_at (idempotent — second click is a no-op)
 *   - Fire-and-forget: POST /api/jobs/[id]/notify-partner-zendesk with
 *     kind="booked" so the OS reuses the same Side Conversation thread
 *     and sends the customer-facing booked email
 *   - Returns the job reference / partner name so the landing page can
 *     render a nice confirmation
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

  // Load minimal job + verify the partner on the token still matches the
  // partner currently on the job (could have been re-assigned).
  const { data: job } = await supabase
    .from("jobs")
    .select("id, reference, partner_id, partner_confirmed_at")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  if (job.partner_id !== partnerId) {
    return NextResponse.json(
      { ok: false, error: "partner_mismatch", message: "This job is no longer assigned to you." },
      { status: 410 },
    );
  }

  const { data: partner } = await supabase
    .from("partners")
    .select("contact_name, company_name")
    .eq("id", partnerId)
    .maybeSingle();
  const partnerLabel =
    (partner as { contact_name?: string | null; company_name?: string | null } | null)?.contact_name?.trim() ||
    (partner as { contact_name?: string | null; company_name?: string | null } | null)?.company_name?.trim() ||
    "Partner";

  const alreadyConfirmed = Boolean(job.partner_confirmed_at);

  if (!alreadyConfirmed) {
    const { error: upErr } = await supabase
      .from("jobs")
      .update({ partner_confirmed_at: new Date().toISOString() })
      .eq("id", jobId);
    if (upErr) {
      console.error("[confirm-acceptance] update failed:", upErr);
      return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
    }
  }

  // Fire-and-forget: trigger the booked email on the existing Side
  // Conversation thread. We can't use the dashboard notify endpoint (it
  // requires staff auth), so call the service-role helper directly via a
  // small internal handler. Keep it inline + simple.
  void (async () => {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || req.nextUrl.origin;
      const internalKey = process.env.INTERNAL_SYNC_SECRET?.trim();
      if (!internalKey) {
        console.warn("[confirm-acceptance] INTERNAL_SYNC_SECRET not set — skipping booked follow-up");
        return;
      }
      await fetch(`${base}/api/internal/zendesk/sync-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": internalKey },
        body: JSON.stringify({ entity: "job", entityId: jobId, event: "partner_confirmed" }),
      });
    } catch (err) {
      console.error("[confirm-acceptance] booked follow-up failed:", err);
    }
  })();

  return NextResponse.json({
    ok:           true,
    alreadyConfirmed,
    jobReference: job.reference,
    partnerLabel,
  });
}
