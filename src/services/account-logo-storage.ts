import { getSupabase } from "./base";

const BUCKET = "company-assets";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "image/svg+xml") return "svg";
  return "png";
}

/** Uploads to `company-assets/accounts/{accountId}/logo.{ext}` and returns the public URL. */
export async function uploadAccountLogo(accountId: string, file: File): Promise<string> {
  const type = file.type.toLowerCase() || "application/octet-stream";
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("Use JPEG, PNG, WebP, GIF or SVG.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or less.");
  }

  const supabase = getSupabase();
  const folder = `accounts/${accountId}`;

  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list(folder);
  if (listErr) throw new Error(listErr.message);

  const toRemove = (existing ?? []).map((f) => `${folder}/${f.name}`);
  if (toRemove.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(toRemove);
    if (rmErr) throw new Error(rmErr.message);
  }

  const ext = extFromMime(type);
  const path = `${folder}/logo.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: type,
    cacheControl: "3600",
  });
  if (upErr) throw new Error(upErr.message);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

/** Removes all objects under `accounts/{accountId}/` in company-assets. */
export async function removeAccountLogoFromStorage(accountId: string): Promise<void> {
  const supabase = getSupabase();
  const folder = `accounts/${accountId}`;
  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list(folder);
  if (listErr) throw new Error(listErr.message);
  const toRemove = (existing ?? []).map((f) => `${folder}/${f.name}`);
  if (toRemove.length === 0) return;
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(toRemove);
  if (rmErr) throw new Error(rmErr.message);
}
