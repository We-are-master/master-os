import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

/** Move all accumulating or draft partner buckets for a week (Monday date) into finance review. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const weekStart = typeof body.weekStart === "string" ? body.weekStart.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: "weekStart must be YYYY-MM-DD (Monday of the week)" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("self_bills")
      .update({ status: "pending_review" })
      .eq("week_start", weekStart)
      .in("status", ["accumulating", "draft"])
      .select("id");

    if (error) throw error;
    return NextResponse.json({ ok: true, moved: data?.length ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to close week";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
