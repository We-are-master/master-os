import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { hasValidContentKey } from "@/lib/social/content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * n8n polls this to fetch APPROVED social posts that are due and not yet
 * published, then posts them via the native platform nodes.
 * Auth: x-api-key === MASTER_OS_CONTENT_API_KEY.
 *
 * Query: ?limit=10
 * Returns: { count, items: [{ id, product, format, caption, hashtags,
 *           image_url, platforms, scheduled_for }] }
 */
export async function GET(req: NextRequest) {
  if (!hasValidContentKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 10, 1), 50);
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("social_posts")
    .select("id, product, format, caption, hashtags, image_url, platforms, scheduled_for")
    .eq("status", "approved")
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: data?.length ?? 0, items: data ?? [] });
}
