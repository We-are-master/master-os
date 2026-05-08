import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/jobs/[id]/reports/[kind]/approve
 * Body (optional): { approve: boolean }  // default true
 *
 * Sets `<kind>_report_approved_at` + `<kind>_report_approved_by` on the job.
 * Pass `{ approve: false }` to clear the approval (back to "pending review").
 *
 * kind ∈ { 'start', 'final' }.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string }> },
) {
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

  const { id: jobId, kind } = await ctx.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  if (kind !== "start" && kind !== "final") {
    return NextResponse.json({ error: "kind must be 'start' or 'final'" }, { status: 400 });
  }

  let approve = true;
  try {
    const body = (await req.json().catch(() => null)) as { approve?: unknown } | null;
    if (body && typeof body.approve === "boolean") approve = body.approve;
  } catch {
    /* no body — default approve=true */
  }

  const atCol = `${kind}_report_approved_at`;
  const byCol = `${kind}_report_approved_by`;

  const admin = createServiceClient();
  const update = approve
    ? { [atCol]: new Date().toISOString(), [byCol]: auth.user.id }
    : { [atCol]: null, [byCol]: null };

  const { error } = await admin
    .from("jobs")
    .update(update)
    .eq("id", jobId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, kind, approved: approve });
}
