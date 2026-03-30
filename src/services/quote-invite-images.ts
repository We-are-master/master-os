import { getSupabase } from "./base";

const BUCKET = "quote-invite-images";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

function safeExt(name: string): string {
  const e = name.split(".").pop()?.toLowerCase();
  if (e && ["jpg", "jpeg", "png", "webp", "gif"].includes(e)) return e === "jpg" ? "jpg" : e;
  return "jpg";
}

/**
 * Upload one image for a partner bid invite. `folderKey` should be stable per request/quote (e.g. service request id or quote id).
 */
export async function uploadQuoteInviteImage(file: File, folderKey: string): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Each image must be 5 MB or less.");
  }
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED.has(type)) {
    throw new Error("Use JPG, PNG, WebP or GIF images.");
  }
  const supabase = getSupabase();
  const ext = safeExt(file.name);
  const path = `${folderKey.replace(/[^a-zA-Z0-9/_-]/g, "_")}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: type || `image/${ext === "jpg" || ext === "jpeg" ? "jpeg" : ext}`,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadQuoteInviteImages(files: File[], folderKey: string): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    urls.push(await uploadQuoteInviteImage(f, folderKey));
  }
  return urls;
}
