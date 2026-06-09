import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import type { SelfBill } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Skipped = { id: string; reference?: string; reason: string };

/**
 * POST /api/self-bills/unapprove
 *
 * Reverts office signoff — moves a self-bill from the Approved tab back to
 * Pending. Refuses rows already paid via Wise (`wise_paid_at` set) because
 * money has already moved; those need a manual correction outside the OS.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { selfBillIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds = body.selfBillIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "selfBillIds array required" }, { status: 400 });
  }
  const ids = rawIds.filter((id): id is string => typeof id === "string" && isValidUUID(id));
  if (ids.length === 0) {
    return NextResponse.json({ error: "No valid self-bill ids" }, { status: 400 });
  }

  const admin = createServiceClient();
  const profileClient = await createClient();
  const { data: profile } = await profileClient
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const userName = profile?.full_name?.trim() || auth.user.email || "User";

  const unapprovedIds: string[] = [];
  const skipped: Skipped[] = [];

  for (const id of ids) {
    const { data: row } = await admin.from("self_bills").select("*").eq("id", id).maybeSingle();
    if (!row) {
      skipped.push({ id, reason: "Not found" });
      continue;
    }
    const sb = row as SelfBill;
    if (sb.wise_paid_at) {
      skipped.push({ id, reference: sb.reference, reason: "Already paid via Wise" });
      continue;
    }
    if (!sb.approved_at) {
      skipped.push({ id, reference: sb.reference, reason: "Not approved" });
      continue;
    }

    const { error } = await admin
      .from("self_bills")
      .update({ approved_at: null, approved_by: null })
      .eq("id", id);
    if (error) {
      skipped.push({ id, reference: sb.reference, reason: error.message });
      continue;
    }

    void admin.from("audit_logs").insert({
      entity_type: "self_bill",
      entity_id: id,
      entity_ref: sb.reference,
      action: "unapproved",
      field_name: "approved_at",
      new_value: null,
      user_id: auth.user.id,
      user_name: userName,
      metadata: { previously_approved_at: sb.approved_at, previously_approved_by: sb.approved_by ?? null },
    });

    unapprovedIds.push(id);
  }

  return NextResponse.json({ unapproved: unapprovedIds.length, unapprovedIds, skipped });
}
