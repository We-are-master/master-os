import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/jobs/[id]/sync-zendesk-status
 *
 * Manual trigger for `syncJobZendeskStatus` — flips the linked Zendesk
 * ticket's custom_status_id to match the job's current internal status.
 * Mirrors what the DB trigger fires automatically; this endpoint exists
 * for the dashboard's "Sync status now" button so operators can test the
 * mapping without changing the job status.
 *
 * Auth: admin/manager/operator only.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
  const result = await syncJobZendeskStatus(jobId, admin);

  return NextResponse.json({
    ok: result.ok,
    synced: result.synced,
    ticketId: result.ticketId ?? null,
    customStatusId: result.customStatusId ?? null,
    skip: result.skip ?? null,
    error: result.error ?? null,
  });
}
