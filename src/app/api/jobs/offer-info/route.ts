import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerOfferToken } from "@/lib/quote-response-token";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return d;
  }
};

/**
 * GET /api/jobs/offer-info?token=...
 *
 * Public: job summary for the partner accept/decline offer page.
 * Token must verify as a partner_offer token AND match the job's
 * current partner_id, otherwise we treat the link as no longer active.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token is required" }, { status: 400 });

  const verified = verifyPartnerOfferToken(token);
  if (!verified) return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  const { jobId, partnerId: tokenPartnerId } = verified;

  const supabase = getServiceSupabase();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, reference, title, property_address, scope, partner_id, partner_name, scheduled_start_at, scheduled_end_at, partner_cost, status, partner_offer_response, partner_offer_responded_at")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const stale = job.partner_id !== tokenPartnerId;
  const closed = job.status === "cancelled" || job.status === "completed" || job.status === "deleted";

  return NextResponse.json({
    reference:           job.reference,
    title:               job.title,
    propertyAddress:     job.property_address ?? null,
    scope:               job.scope ?? null,
    partnerName:         job.partner_name ?? null,
    arrivalStart:        fmtDate(job.scheduled_start_at ?? null),
    arrivalEnd:          fmtDate(job.scheduled_end_at ?? null),
    partnerCost:         Number(job.partner_cost) || 0,
    status:              job.status,
    partnerOfferResponse:    job.partner_offer_response ?? null,
    partnerOfferRespondedAt: job.partner_offer_responded_at ?? null,
    stale,
    closed,
  });
}
