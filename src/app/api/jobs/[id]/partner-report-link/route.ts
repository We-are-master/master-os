import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerReportToken } from "@/lib/quote-response-token";
import { upsertShortLink } from "@/lib/short-links";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * GET /api/jobs/[id]/partner-report-link
 *
 * Returns the public report-submission URL for a job's currently assigned
 * partner. The token binds quoteId + partnerId; if the partner is later
 * reassigned this URL stops working and the office must regenerate.
 *
 * Auth: admin/manager/operator only.
 *
 * Response: 200 { url, partnerId, partnerName?, expiresAt?: null }
 *           400 if the job has no quote_id or no partner_id
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
    console.error("[partner-report-link] job lookup error:", error.message);
    return NextResponse.json({ error: "Job lookup failed." }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "Job has no partner assigned. Assign a partner before generating the report link." },
      { status: 400 },
    );
  }

  // Best-effort partner display name lookup (failures are non-fatal).
  let partnerName: string | null = null;
  const { data: partner } = await admin
    .from("partners")
    .select("contact_name, company_name")
    .eq("id", job.partner_id)
    .maybeSingle();
  if (partner) {
    partnerName =
      ((partner as { contact_name?: string | null }).contact_name?.trim() ||
        (partner as { company_name?: string | null }).company_name?.trim()) ?? null;
  }

  const token = createPartnerReportToken(String(job.id), String(job.partner_id));
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  const targetPath = `/quote/respond?token=${encodeURIComponent(token)}`;

  // Short link: one stable slug per (job, partner). Reassigning the partner
  // upserts a new slug (because entity_ref includes the partner_id), so
  // older shared links automatically stop working in the same flow.
  const { shortPath } = await upsertShortLink({
    targetPath,
    kind:       "partner_report",
    entityRef:  `job:${job.id}:partner:${job.partner_id}`,
    createdBy:  auth.user.id,
  });

  return NextResponse.json({
    url:        `${base}${shortPath}`,
    longUrl:    `${base}${targetPath}`,
    partnerId:  job.partner_id,
    partnerName,
    jobReference: job.reference,
  });
}
