import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  hasValidContentKey,
  slugify,
  approvalUrl,
  buildSocialOgUrl,
  type ContentProduct,
} from "@/lib/social/content";
import { resolvePhoto } from "@/lib/social/media";
import { sendApprovalEmail } from "@/lib/social/approval-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRODUCTS: ContentProduct[] = ["fixfy", "trades", "general"];

/**
 * n8n → app. Creates a DRAFT blog post awaiting 1-tap approval.
 * Auth: x-api-key === MASTER_OS_CONTENT_API_KEY.
 *
 * Body: { title, body_md, excerpt?, slug?, cover_image_url?, product?, tags?,
 *         seo_title?, seo_description?, author? }
 * Returns: { id, slug, status, approval_url, reject_url, preview_url }
 */
export async function POST(req: NextRequest) {
  if (!hasValidContentKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const bodyMd = typeof body.body_md === "string" ? body.body_md.trim() : "";
  if (!title || !bodyMd) {
    return NextResponse.json({ error: "title and body_md are required" }, { status: 400 });
  }

  const product = PRODUCTS.includes(body.product as ContentProduct)
    ? (body.product as ContentProduct)
    : "general";
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 12)
    : [];

  const excerpt = typeof body.excerpt === "string" ? body.excerpt.trim() : "";

  // Build the cover. Trust a ready cover_image_url; otherwise render the brand
  // template — with a real photo when the agent asked for one (use_photo).
  let coverImageUrl: string | null =
    typeof body.cover_image_url === "string" && body.cover_image_url ? body.cover_image_url : null;
  if (!coverImageUrl) {
    let photoUrl: string | null = null;
    if (body.use_photo === true && typeof body.photo_query === "string" && body.photo_query.trim()) {
      const photo = await resolvePhoto({
        query: body.photo_query.trim(),
        theme: product,
        orientation: "landscape",
      });
      photoUrl = photo?.url ?? null;
    }
    coverImageUrl = buildSocialOgUrl({
      format: "landscape",
      bg: "navy",
      eyebrow: product === "trades" ? "FIXFY FOR PROS" : "THE FIXFY BLOG",
      title,
      sub: excerpt,
      photo: photoUrl,
    });
  }

  const admin = createServiceClient();

  // Unique slug: use provided/derived, append a short suffix on collision.
  const baseSlug = slugify(typeof body.slug === "string" && body.slug ? body.slug : title);
  let slug = baseSlug;
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await admin
      .from("blog_posts")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { data, error } = await admin
    .from("blog_posts")
    .insert({
      slug,
      title,
      body_md: bodyMd,
      excerpt: excerpt || null,
      cover_image_url: coverImageUrl,
      product,
      tags,
      seo_title: typeof body.seo_title === "string" ? body.seo_title : null,
      seo_description: typeof body.seo_description === "string" ? body.seo_description : null,
      author: typeof body.author === "string" && body.author ? body.author : "Fixfy",
      status: "draft",
    })
    .select("id, slug, status, approval_token")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "insert_failed" }, { status: 500 });
  }

  const approveUrl = approvalUrl("blog", data.id, data.approval_token, "approve");
  const rejectUrl = approvalUrl("blog", data.id, data.approval_token, "reject");

  void sendApprovalEmail({
    kind: "blog",
    title,
    body: excerpt || bodyMd.slice(0, 160),
    imageUrl: coverImageUrl,
    product,
    approveUrl,
    rejectUrl,
  });

  return NextResponse.json(
    {
      id: data.id,
      slug: data.slug,
      status: data.status,
      approval_url: approveUrl,
      reject_url: rejectUrl,
    },
    { status: 201 },
  );
}
