import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const BUCKET = "company-branding";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon",
]);

const ALLOWED_KINDS = new Set(["pdf-logo", "favicon", "email-header", "sidebar-dark", "sidebar-light"]);
const ALLOWED_ROLES = new Set(["admin", "manager"]);

function extForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    case "image/x-icon":
    case "image/vnd.microsoft.icon": return "ico";
    default: return "bin";
  }
}

/**
 * POST /api/admin/branding/upload  (multipart/form-data)
 *
 * Fields:
 *   file: File (image)
 *   kind: "pdf-logo" | "favicon" | "email-header"
 *
 * Uploads to the public `company-branding` bucket under {kind}/logo.{ext}
 * (overwrites the previous file for the same kind so we don't accumulate
 * orphans). Returns the public URL.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admins / managers only" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  const file = form.get("file");
  const kind = String(form.get("kind") ?? "").trim();

  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "kind must be one of: pdf-logo, favicon, email-header, sidebar-dark, sidebar-light" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (max 5 MB)" }, { status: 413 });
  }
  const mime = (file.type || "").toLowerCase();
  if (mime && !ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "Unsupported file type. Use PNG, JPG, WebP, SVG or ICO." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const ext = extForMime(mime || "image/png");
  // Cache-busting suffix prevents customer browsers from showing the old
  // logo after a re-upload (the path stays the same so URL-only consumers
  // re-fetch automatically; the version in the path forces hard cache miss).
  const version = Date.now().toString(36);
  const path = `${kind}/logo-${version}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: mime || "application/octet-stream",
      upsert: true,
      cacheControl: "300", // 5 min — short so newly-uploaded logos appear quickly
    });
  if (uploadErr) {
    console.error("[branding/upload]", uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({
    ok: true,
    url: urlData.publicUrl,
    path,
    kind,
    size: file.size,
    contentType: mime,
  });
}
