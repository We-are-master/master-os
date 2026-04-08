import { getSupabase } from "./base";

const BUCKET = "quote-invite-images";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);


/**
 * Compress and resize an image using canvas before upload.
 * - Resizes to max 1920px on the longest edge (preserves aspect ratio)
 * - Encodes as JPEG at 85% quality
 * - Skips compression for small files (<= 150 KB) to avoid quality loss on already-small images
 * - Falls back to the original File if canvas is unavailable (SSR / non-browser)
 */
async function compressImage(file: File): Promise<File | Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") return file;
  if (file.size <= 150 * 1024) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1920;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width >= height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
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

  const compressed = await compressImage(file);
  const uploadType = "image/jpeg";
  const uploadExt = "jpg";

  const path = `${folderKey.replace(/[^a-zA-Z0-9/_-]/g, "_")}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${uploadExt}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    upsert: false,
    contentType: uploadType,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload multiple images in parallel (instead of sequentially) for faster multi-photo uploads.
 */
export async function uploadQuoteInviteImages(files: File[], folderKey: string): Promise<string[]> {
  return Promise.all(files.map((f) => uploadQuoteInviteImage(f, folderKey)));
}
