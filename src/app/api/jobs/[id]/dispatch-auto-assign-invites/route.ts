import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ensureAndDispatchAutoAssignInvites,
  previewAutoAssignInvitePartners,
} from "@/lib/auto-assign-job-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/** Same gate for both verbs: the preview reads the partner list, not just a count. */
async function guard(): Promise<NextResponse | null> {
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
  return null;
}

/**
 * GET /api/jobs/[id]/dispatch-auto-assign-invites
 *
 * Dry run: how many partners the POST would invite, and who they are. Nothing
 * is written and nothing is sent. Existe para a confirmação do escritório
 * poder dizer o tamanho do disparo ANTES do push e do e-mail saírem.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await guard();
  if (denied) return denied;

  const { id: jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const result = await previewAutoAssignInvitePartners(createServiceClient(), jobId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    partnerCount: result.partnerCount,
    partnerNames: result.partnerNames,
    alreadyInvited: result.alreadyInvited,
  });
}

/**
 * POST /api/jobs/[id]/dispatch-auto-assign-invites
 *
 * After a job is created with auto-assign (OS UI or API), matches partners when
 * needed, stores auto_assign_invited_partner_ids, sends push, and opens Zendesk
 * side-conversation invites when the job is linked to a ticket.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await guard();
  if (denied) return denied;

  const { id: jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const result = await ensureAndDispatchAutoAssignInvites(supabase, jobId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    partnerCount: result.partnerCount,
    pushSent: result.pushSent,
  });
}
