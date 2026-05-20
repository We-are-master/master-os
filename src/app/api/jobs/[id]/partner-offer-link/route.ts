import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerOfferToken } from "@/lib/quote-response-token";
import { upsertShortLink } from "@/lib/short-links";
import { appBaseUrl } from "@/lib/app-base-url";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * GET /api/jobs/[id]/partner-offer-link
 *
 * Returns the public Accept/Decline URL for the assigned partner. The token
 * binds (jobId, partnerId) so the link only works for whoever is currently
 * on the job — reassigning invalidates older links automatically.
 *
 * Used by the email / side-conv builder when telling the partner the job
 * was booked to them, and by the office UI for a manual "Copy offer link".
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
  const { data: job, error } = await admin
    .from("jobs")
    .select("id, reference, partner_id")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "Job has no partner assigned. Assign one first." },
      { status: 400 },
    );
  }

  const token = createPartnerOfferToken(String(job.id), String(job.partner_id));
  const base = appBaseUrl();
  const targetPath = `/job/offer?token=${encodeURIComponent(token)}`;
  let shortPath = targetPath;
  try {
    const r = await upsertShortLink({
      targetPath,
      kind:       "partner_offer",
      entityRef:  `job:${job.id}:partner:${job.partner_id}:offer`,
      createdBy:  auth.user.id,
    });
    shortPath = r.shortPath;
  } catch (err) {
    console.error("[partner-offer-link] short link upsert failed, using long URL:", err);
  }

  return NextResponse.json({
    url:          `${base}${shortPath}`,
    longUrl:      `${base}${targetPath}`,
    partnerId:    job.partner_id,
    jobReference: job.reference,
  });
}
