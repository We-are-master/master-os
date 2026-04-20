import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/self-bills/:id/due-date
 * Body: { date: "YYYY-MM-DD", reason: string (min 10 chars) }
 *
 * Allowed on any status — the user explicitly confirmed any stage.
 * Writes an audit_log entry for traceability.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing self-bill id" }, { status: 400 });
  }

  let date: string;
  let reason: string;
  try {
    const body = await req.json();
    date = typeof body.date === "string" ? body.date.trim() : "";
    reason = typeof body.reason === "string" ? body.reason.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 422 });
  }

  if (reason.length < 10) {
    return NextResponse.json(
      { error: "reason must be at least 10 characters" },
      { status: 422 },
    );
  }

  const serverSupabase = await createServerSupabase();
  const { data: profileRow } = await serverSupabase
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const profile = profileRow as { full_name?: string } | null;

  const admin = createServiceClient();

  const { data: sbRow, error: sbErr } = await admin
    .from("self_bills")
    .select("id, reference, status, due_date, created_at")
    .eq("id", id)
    .maybeSingle();

  if (sbErr || !sbRow) {
    return NextResponse.json({ error: "Self-bill not found" }, { status: 404 });
  }

  const sb = sbRow as {
    id: string;
    reference: string;
    status: string;
    due_date: string | null;
    created_at: string;
  };

  const prevDate = sb.due_date ? String(sb.due_date).slice(0, 10) : "";

  const { data: updated, error: updateErr } = await admin
    .from("self_bills")
    .update({ due_date: date })
    .eq("id", id)
    .select()
    .single();

  if (updateErr || !updated) {
    console.error("[self-bills due-date PATCH]", updateErr);
    return NextResponse.json({ error: "Failed to update due date" }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    entity_type: "self_bill",
    entity_id: id,
    entity_ref: sb.reference,
    action: "updated",
    field_name: "due_date",
    old_value: prevDate,
    new_value: date,
    user_id: auth.user.id,
    user_name: profile?.full_name ?? null,
    metadata: { reason },
  });

  return NextResponse.json(updated);
}
