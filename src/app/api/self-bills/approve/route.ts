import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { isSelfBillPayoutVoided } from "@/services/self-bills";
import type { SelfBill } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Skipped = { id: string; reference?: string; reason: string };

/**
 * POST /api/self-bills/approve
 *
 * Marks one or more self-bills as office-approved — the signoff that unlocks
 * the Wise payout. Idempotent: re-approving an already-approved row is a
 * no-op (counted as `skipped` with reason "Already approved"). Voided /
 * internal / unlinked / paid rows are skipped with explicit reasons so the
 * widget can surface them.
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

  const approvedIds: string[] = [];
  const skipped: Skipped[] = [];

  for (const id of ids) {
    const { data: row } = await admin.from("self_bills").select("*").eq("id", id).maybeSingle();
    if (!row) {
      skipped.push({ id, reason: "Not found" });
      continue;
    }
    const sb = row as SelfBill;
    if (isSelfBillPayoutVoided(sb)) {
      skipped.push({ id, reference: sb.reference, reason: "Void or cancelled" });
      continue;
    }
    if (sb.status === "paid" || sb.wise_paid_at) {
      skipped.push({ id, reference: sb.reference, reason: "Already paid" });
      continue;
    }
    if (sb.approved_at) {
      skipped.push({ id, reference: sb.reference, reason: "Already approved" });
      continue;
    }

    const stamp = new Date().toISOString();
    const { error } = await admin
      .from("self_bills")
      .update({ approved_at: stamp, approved_by: auth.user.id })
      .eq("id", id);
    if (error) {
      skipped.push({ id, reference: sb.reference, reason: error.message });
      continue;
    }

    void admin.from("audit_logs").insert({
      entity_type: "self_bill",
      entity_id: id,
      entity_ref: sb.reference,
      action: "approved",
      field_name: "approved_at",
      new_value: stamp,
      user_id: auth.user.id,
      user_name: userName,
      metadata: { approved_by: auth.user.id, net_payout: sb.net_payout ?? null },
    });

    approvedIds.push(id);
  }

  return NextResponse.json({ approved: approvedIds.length, approvedIds, skipped });
}
