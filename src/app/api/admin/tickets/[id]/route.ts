import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES     = new Set(["admin", "manager", "operator"]);
const ALLOWED_STATUSES  = new Set(["open", "in_progress", "awaiting_customer", "resolved", "closed"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

/**
 * PATCH /api/admin/tickets/[id]
 * Body: { status?, assigned_to?, priority?, job_id? }
 *
 * Staff-only. Update ticket metadata (status, assignment, priority, job link).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!ALLOWED_ROLES.has((profile as { role?: string } | null)?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: ticketId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.status === "string" && ALLOWED_STATUSES.has(body.status)) {
    patch.status = body.status;
  }
  if (typeof body.priority === "string" && ALLOWED_PRIORITIES.has(body.priority)) {
    patch.priority = body.priority;
  }
  if (body.assigned_to === null || (typeof body.assigned_to === "string" && body.assigned_to.trim())) {
    patch.assigned_to = body.assigned_to === null ? null : body.assigned_to;
  }
  if (body.job_id === null || (typeof body.job_id === "string" && body.job_id.trim())) {
    patch.job_id = body.job_id === null ? null : body.job_id;
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", ticketId);

  if (error) {
    console.error("[admin/tickets/PATCH] update failed:", error);
    return NextResponse.json({ error: "Could not update the ticket." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
