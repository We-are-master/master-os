import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * GET /api/jobs/[id]/zendesk-events
 *
 * Returns the Zendesk push + side-conversation log for a job (most recent
 * first), plus whether a side conversation has been opened on the job.
 * Used by the job detail page to surface real-time delivery status.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, external_source, external_ref, zendesk_side_conversation_id")
    .eq("id", jobId)
    .maybeSingle();

  const job = jobRow as {
    id: string;
    external_source: string | null;
    external_ref: string | null;
    zendesk_side_conversation_id: string | null;
  } | null;

  const { data: rows } = await supabase
    .from("job_zendesk_events")
    .select("id, kind, status_at_event, push_ok, push_tokens_sent, push_error, zendesk_ok, zendesk_message_id, zendesk_error, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    ok: true,
    isZendeskJob: job?.external_source === "zendesk" && Boolean(job?.external_ref),
    ticketId: job?.external_source === "zendesk" ? job?.external_ref ?? null : null,
    sideConversationId: job?.zendesk_side_conversation_id ?? null,
    events: (rows ?? []) as Array<{
      id: string;
      kind: string;
      status_at_event: string | null;
      push_ok: boolean;
      push_tokens_sent: number;
      push_error: string | null;
      zendesk_ok: boolean;
      zendesk_message_id: string | null;
      zendesk_error: string | null;
      created_at: string;
    }>,
  });
}
