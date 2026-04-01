import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Marks expired auto-assign jobs as unassigned so the office can reassign manually.
 * Secure with CRON_SECRET (same pattern as other cron routes).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("jobs")
    .update({
      status: "unassigned",
      auto_assign_expires_at: null,
      auto_assign_minutes: null,
      auto_assign_invited_partner_ids: null,
      updated_at: nowIso,
    })
    .eq("status", "auto_assigning")
    .is("partner_id", null)
    .not("auto_assign_expires_at", "is", null)
    .lt("auto_assign_expires_at", nowIso)
    .select("id");

  if (error) {
    console.error("[expire-auto-assign]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expiredCount: (data ?? []).length,
  });
}
