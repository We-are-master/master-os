import { getSupabase } from "./base";

const BUCKET = "company-assets";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "photo";
  return base.slice(0, 120);
}

/** Upload one site photo for a service request; returns public URL for `photo_urls[]`. */
export async function uploadRequestSitePhoto(requestId: string, file: File): Promise<{ publicUrl: string }> {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("Use JPG, PNG, WebP or GIF images only.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Each photo must be 5 MB or less.");
  }

  const supabase = getSupabase();
  const fileName = safeFileName(file.name);
  const path = `service-requests/${requestId}/site-photos/${Date.now()}-${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { publicUrl: pub.publicUrl };
}
