import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /r/[slug]
 *
 * Public shortener — looks up the slug in `short_links` and redirects (302)
 * to the stored `target_path`. The target carries any auth tokens it needs.
 *
 * If the slug is unknown or expired, redirects to `/quote/respond` with a
 * generic invalid-link state so the visitor sees a friendly message rather
 * than a raw 404 page.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const slugTrimmed = slug?.trim();
  if (!slugTrimmed) {
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("short_links")
    .select("target_path, expires_at")
    .eq("slug", slugTrimmed)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  const expiresAt = (data as { expires_at?: string | null }).expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/quote/respond?token=expired", req.url), 302);
  }

  // Best-effort hit-count bump (don't gate the redirect on this).
  void supabase
    .from("short_links")
    .update({ hit_count: 1, last_hit_at: new Date().toISOString() })
    .eq("slug", slugTrimmed)
    .then(({ error: e }) => {
      if (e) console.error("[short-link] hit_count bump failed:", e.message);
    });

  const target = String((data as { target_path: string }).target_path);
  const absolute = /^https?:\/\//i.test(target)
    ? target
    : new URL(target, req.url).toString();
  return NextResponse.redirect(absolute, 302);
}
