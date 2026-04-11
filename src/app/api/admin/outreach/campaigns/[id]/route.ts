import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const admin = createServiceClient();
  const [campaignResult, recipientsResult] = await Promise.all([
    admin.from("outreach_campaigns").select("*").eq("id", id).maybeSingle(),
    admin
      .from("outreach_campaign_recipients")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (campaignResult.error) {
    console.error("[outreach/campaigns/[id]] error:", campaignResult.error);
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
  }
  if (!campaignResult.data) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({
    campaign: campaignResult.data,
    recipients: recipientsResult.data ?? [],
  });
}
