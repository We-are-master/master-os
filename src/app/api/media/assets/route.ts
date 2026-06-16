import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { hasValidContentKey } from "@/lib/social/content";
import type { Orientation } from "@/lib/social/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "social-media";
const ORIENTATIONS: Orientation[] = ["square", "portrait", "landscape"];

function extFromType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === "string");
  if (typeof v === "string") return v.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * Seeds the OWNED image bank with a real Fixfy photo.
 * Auth: x-api-key === MASTER_OS_CONTENT_API_KEY.
 *
 * Two ways to call:
 *  - JSON: { url, tags, theme?, alt?, orientation? } — copies the image from `url` into the bucket
 *  - multipart/form-data: file=<binary>, tags, theme?, alt?, orientation?
 *
 * Returns: { id, url, source: "own" }
 */
export async function POST(req: NextRequest) {
  if (!hasValidContentKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const contentType = req.headers.get("content-type") || "";

  let bytes: ArrayBuffer;
  let fileType = "image/jpeg";
  let tags: string[] = [];
  let theme: string | null = null;
  let alt: string | null = null;
  let orientation: Orientation = "landscape";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file field required" }, { status: 400 });
      }
      bytes = await file.arrayBuffer();
      fileType = file.type || "image/jpeg";
      tags = parseTags(form.get("tags"));
      theme = (form.get("theme") as string) || null;
      alt = (form.get("alt") as string) || null;
      const o = form.get("orientation") as string;
      if (ORIENTATIONS.includes(o as Orientation)) orientation = o as Orientation;
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      const srcUrl = typeof body.url === "string" ? body.url : "";
      if (!srcUrl) return NextResponse.json({ error: "url required" }, { status: 400 });
      const res = await fetch(srcUrl);
      if (!res.ok) return NextResponse.json({ error: "could not fetch url" }, { status: 400 });
      bytes = await res.arrayBuffer();
      fileType = res.headers.get("content-type") || "image/jpeg";
      tags = parseTags(body.tags);
      theme = typeof body.theme === "string" ? body.theme : null;
      alt = typeof body.alt === "string" ? body.alt : null;
      if (ORIENTATIONS.includes(body.orientation as Orientation)) orientation = body.orientation as Orientation;
    }
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const path = `own/${crypto.randomUUID()}.${extFromType(fileType)}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: fileType,
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: `storage: ${upErr.message}` }, { status: 500 });
  }

  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { data, error } = await admin
    .from("media_assets")
    .insert({ url: publicUrl, source: "own", tags, theme, alt, orientation })
    .select("id, url")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, url: data.url, source: "own" }, { status: 201 });
}
