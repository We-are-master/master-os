import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SKIP_STATUSES = new Set(["paid", "cancelled"]);

/**
 * PATCH /api/invoices/:id/due-date
 * Body: { date: "YYYY-MM-DD", reason: string (min 10 chars) }
 *
 * Validation:
 *   - Authenticated user (any role)
 *   - Invoice must not be paid or cancelled
 *   - date must be >= invoice.created_at (issue date)
 *   - reason must be >= 10 characters
 *
 * On success: updates due_date, writes audit_log, returns updated invoice row.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });
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

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 422 });
  }

  // Validate reason length
  if (reason.length < 10) {
    return NextResponse.json(
      { error: "reason must be at least 10 characters" },
      { status: 422 },
    );
  }

  const serverSupabase = await createServerSupabase();
  const { data: profileRow } = await serverSupabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const profile = profileRow as { role?: string; full_name?: string } | null;

  const admin = createServiceClient();

  // Fetch the invoice
  const { data: invRow, error: invErr } = await admin
    .from("invoices")
    .select("id, reference, status, due_date, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (invErr || !invRow) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const inv = invRow as {
    id: string;
    reference: string;
    status: string;
    due_date: string | null;
    created_at: string;
  };

  if (SKIP_STATUSES.has(inv.status)) {
    return NextResponse.json(
      { error: "Cannot change due date on a paid or cancelled invoice" },
      { status: 422 },
    );
  }

  // Validate date >= issue date (created_at)
  const issueDateYmd = inv.created_at.slice(0, 10);
  if (date < issueDateYmd) {
    return NextResponse.json(
      { error: `date cannot be before issue date (${issueDateYmd})` },
      { status: 422 },
    );
  }

  const prevDate = inv.due_date ? String(inv.due_date).slice(0, 10) : "";

  // Update the invoice
  const { data: updated, error: updateErr } = await admin
    .from("invoices")
    .update({ due_date: date })
    .eq("id", id)
    .select()
    .single();

  if (updateErr || !updated) {
    console.error("[due-date PATCH] update error:", updateErr);
    return NextResponse.json({ error: "Failed to update due date" }, { status: 500 });
  }

  // Write audit log
  await admin.from("audit_logs").insert({
    entity_type: "invoice",
    entity_id: id,
    entity_ref: inv.reference,
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
