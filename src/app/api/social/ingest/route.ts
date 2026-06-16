import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  hasValidContentKey,
  approvalUrl,
  buildSocialOgUrl,
  orientationForFormat,
  type ContentProduct,
  type SocialFormat,
  type SocialPlatform,
} from "@/lib/social/content";
import { resolvePhoto } from "@/lib/social/media";
import { sendApprovalEmail } from "@/lib/social/approval-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRODUCTS: ContentProduct[] = ["fixfy", "trades", "general"];
const FORMATS: SocialFormat[] = ["square", "story", "landscape"];
const PLATFORMS: SocialPlatform[] = ["linkedin", "instagram", "facebook", "x"];

/**
 * n8n → app. Creates a DRAFT social post awaiting 1-tap approval.
 * Auth: x-api-key === MASTER_OS_CONTENT_API_KEY.
 *
 * Body: { caption, platforms[], product?, format?, hashtags?, image_url?,
 *         scheduled_for? }
 * Returns: { id, status, approval_url, reject_url }
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

  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const platforms = Array.isArray(body.platforms)
    ? (body.platforms as unknown[]).filter(
        (p): p is SocialPlatform => typeof p === "string" && PLATFORMS.includes(p as SocialPlatform),
      )
    : [];

  if (!caption) {
    return NextResponse.json({ error: "caption is required" }, { status: 400 });
  }
  if (platforms.length === 0) {
    return NextResponse.json({ error: "platforms must include at least one of " + PLATFORMS.join(", ") }, { status: 400 });
  }

  const product = PRODUCTS.includes(body.product as ContentProduct)
    ? (body.product as ContentProduct)
    : "general";
  const format = FORMATS.includes(body.format as SocialFormat)
    ? (body.format as SocialFormat)
    : "square";
  const hashtags = Array.isArray(body.hashtags)
    ? (body.hashtags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 30)
    : [];

  let scheduledFor: string | null = null;
  if (typeof body.scheduled_for === "string") {
    const d = new Date(body.scheduled_for);
    if (!Number.isNaN(d.getTime())) scheduledFor = d.toISOString();
  }

  // Build the post image. If the caller passed a ready image_url, trust it.
  // Otherwise render the brand template — humanised with a real photo when the
  // agent asked for one (use_photo) and a photo is available.
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  let imageUrl: string | null = str("image_url") || null;
  if (!imageUrl) {
    const title = str("title") || caption.split("\n")[0];
    let photoUrl: string | null = null;
    if (body.use_photo === true && str("photo_query")) {
      const photo = await resolvePhoto({
        query: str("photo_query"),
        theme: product,
        orientation: orientationForFormat(format),
      });
      photoUrl = photo?.url ?? null;
    }
    imageUrl = buildSocialOgUrl({
      format,
      bg: str("bg") || "navy",
      eyebrow: str("eyebrow"),
      title,
      sub: str("sub"),
      photo: photoUrl,
    });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("social_posts")
    .insert({
      caption,
      platforms,
      product,
      format,
      hashtags,
      image_url: imageUrl,
      scheduled_for: scheduledFor,
      status: "draft",
    })
    .select("id, status, approval_token")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "insert_failed" }, { status: 500 });
  }

  const approveUrl = approvalUrl("social", data.id, data.approval_token, "approve");
  const rejectUrl = approvalUrl("social", data.id, data.approval_token, "reject");

  void sendApprovalEmail({
    kind: "social",
    title: caption.split("\n")[0].slice(0, 90),
    body: `${platforms.join(", ")} · ${format}${hashtags.length ? " · " + hashtags.slice(0, 5).map((h) => "#" + h).join(" ") : ""}`,
    imageUrl,
    product,
    approveUrl,
    rejectUrl,
  });

  return NextResponse.json(
    {
      id: data.id,
      status: data.status,
      approval_url: approveUrl,
      reject_url: rejectUrl,
    },
    { status: 201 },
  );
}
