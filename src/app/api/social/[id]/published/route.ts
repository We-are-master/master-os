import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { hasValidContentKey } from "@/lib/social/content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * n8n → app. After a social post is published to the platforms, n8n records the
 * per-platform refs and marks the row published.
 * Auth: x-api-key === MASTER_OS_CONTENT_API_KEY.
 *
 * Body: { external_refs?: { linkedin?: {...}, instagram?: {...}, ... } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasValidContentKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const externalRefs =
    body.external_refs && typeof body.external_refs === "object" ? body.external_refs : {};

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("social_posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      external_refs: externalRefs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, status, published_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
