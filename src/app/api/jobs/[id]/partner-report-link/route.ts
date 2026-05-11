import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerReportToken } from "@/lib/quote-response-token";

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
    .select("id, reference, partner_id, partners ( contact_name, company_name )")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "Job has no partner assigned. Assign a partner before generating the report link." },
      { status: 400 },
    );
  }

  const token = createPartnerReportToken(String(job.id), String(job.partner_id));
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  const url = `${base}/quote/respond?token=${encodeURIComponent(token)}`;

  const partnerRow = (job as unknown as { partners?: { contact_name?: string | null; company_name?: string | null } | null }).partners;
  const partnerName =
    partnerRow?.contact_name?.trim() ||
    partnerRow?.company_name?.trim() ||
    null;

  return NextResponse.json({
    url,
    partnerId:  job.partner_id,
    partnerName,
    jobReference: job.reference,
  });
}
