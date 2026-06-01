import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /r/[slug]
 *
 * Public shortener — looks up the slug in `short_links` and redirects (302)
 * to the stored `target_path`. The target carries any auth tokens it needs.
 *
 * If the slug is unknown or expired, redirects to `/quote/respond?token=invalid`
 * so the visitor sees a friendly invalid-link message (not the quote reject form).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const slugTrimmed = slug?.trim();
  if (!slugTrimmed) {
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[short-link] service client unavailable:", err);
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  const { data, error } = await supabase
    .from("short_links")
    .select("target_path, expires_at")
    .eq("slug", slugTrimmed)
    .maybeSingle();

  if (error || !data) {
    console.warn("[short-link] slug not found:", slugTrimmed, error?.message);
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  const expiresAt = (data as { expires_at?: string | null }).expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/quote/respond?token=expired", req.url), 302);
  }

  // Best-effort last-hit timestamp (don't gate the redirect on this).
  void supabase
    .from("short_links")
    .update({ last_hit_at: new Date().toISOString() })
    .eq("slug", slugTrimmed)
    .then(({ error: e }) => {
      if (e) console.error("[short-link] last_hit_at bump failed:", e.message);
    });

  const target = String((data as { target_path: string }).target_path);
  const absolute = /^https?:\/\//i.test(target)
    ? target
    : new URL(target, req.url).toString();
  return NextResponse.redirect(absolute, 302);
}
