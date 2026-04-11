import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const sb = await createClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? "50") || 50);
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? "0") || 0);

  const admin = createServiceClient();
  const { data, error, count } = await admin
    .from("outreach_campaigns")
    .select("*", { count: "exact" })
    .order("sent_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[outreach/campaigns] list error:", error);
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 });
  }

  return NextResponse.json({
    campaigns: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
