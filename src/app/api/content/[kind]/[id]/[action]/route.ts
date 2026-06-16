import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { secretsMatch, FIXFY_BRAND } from "@/lib/social/content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 1-tap approval surface for the Social Media Designer queue.
 * GET /api/content/{blog|social}/{id}/{approve|reject}?token=...
 *
 * - blog approve  → status=published, published_at=now (site shows it)
 * - social approve → status=approved (n8n queue picks it up to post)
 * - reject (both)  → status=rejected
 *
 * Auth is the per-row approval_token (unguessable), so the link works straight
 * from an email/Slack message with no login.
 */
function page(title: string, body: string, accent: string = FIXFY_BRAND.orange): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="margin:0;background:${FIXFY_BRAND.off};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${FIXFY_BRAND.ink};">
<div style="max-width:520px;margin:14vh auto;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(2,0,64,.08);text-align:center;">
  <div style="width:54px;height:54px;border-radius:14px;background:${accent};margin:0 auto 22px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:800;">✓</div>
  <h1 style="font-size:24px;margin:0 0 10px;letter-spacing:-.02em;">${title}</h1>
  <p style="font-size:16px;line-height:1.5;color:${FIXFY_BRAND.gray};margin:0;">${body}</p>
  <p style="margin-top:28px;font-size:13px;color:${FIXFY_BRAND.gray};">Fixfy · Social Media Designer</p>
</div></body></html>`;
}

function html(content: string, status = 200): NextResponse {
  return new NextResponse(content, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string; action: string }> },
) {
  const { kind, id, action } = await params;
  const token = req.nextUrl.searchParams.get("token");

  if (kind !== "blog" && kind !== "social") {
    return html(page("Unknown content type", "This link is not valid.", FIXFY_BRAND.gray), 404);
  }
  if (action !== "approve" && action !== "reject") {
    return html(page("Unknown action", "This link is not valid.", FIXFY_BRAND.gray), 404);
  }

  const table = kind === "blog" ? "blog_posts" : "social_posts";
  const admin = createServiceClient();

  const { data: row } = await admin
    .from(table)
    .select("id, status, approval_token, title, caption")
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return html(page("Not found", "This content no longer exists.", FIXFY_BRAND.gray), 404);
  }
  if (!secretsMatch(token, row.approval_token as string)) {
    return html(page("Invalid link", "This approval link is invalid or expired.", FIXFY_BRAND.gray), 401);
  }

  const label = (row.title as string) || (row.caption as string) || "this content";
  const short = label.length > 80 ? label.slice(0, 80) + "…" : label;

  // Already decided — idempotent, friendly message.
  if (row.status === "published" || row.status === "approved" || row.status === "rejected") {
    const msg =
      row.status === "rejected"
        ? `“${short}” was already rejected.`
        : `“${short}” was already approved.`;
    return html(page("Already handled", msg, FIXFY_BRAND.gray));
  }

  const nowIso = new Date().toISOString();

  if (action === "reject") {
    await admin.from(table).update({ status: "rejected", updated_at: nowIso }).eq("id", id);
    return html(page("Rejected", `“${short}” won’t be published.`, FIXFY_BRAND.gray));
  }

  // approve
  if (kind === "blog") {
    await admin
      .from(table)
      .update({ status: "published", published_at: nowIso, updated_at: nowIso })
      .eq("id", id);
    return html(page("Published ✓", `“${short}” is now live on the Fixfy blog.`));
  }

  await admin.from(table).update({ status: "approved", updated_at: nowIso }).eq("id", id);
  return html(page("Approved ✓", `“${short}” is queued — the agent will post it shortly.`));
}
