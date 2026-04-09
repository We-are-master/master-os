/**
 * Shared client-side upload helpers used by /join, /portal, and any other
 * form that uploads files via FormData.
 *
 * Two functions:
 * - compressImage:        canvas-based JPEG re-encode with progressive
 *                         quality reduction so files fit under Vercel's
 *                         4.5 MB API body limit
 * - sanitizeFileForUpload: workaround for iOS Safari's
 *                         "The string did not match the expected pattern"
 *                         error when FormData.append receives a File whose
 *                         name contains characters WebKit refuses to
 *                         serialise into Content-Disposition
 *
 * Both are pure client-side. Do NOT import from server components.
 */

/**
 * Compress an image File entirely on the client (canvas). Resizes so the longest
 * edge fits in `maxDim` and re-encodes as JPEG at `quality`. Skips PDFs and any
 * file the browser can't decode (e.g. HEIC on older Safari) — returns the
 * original File in those cases so the upload still proceeds.
 */
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number; targetMaxBytes?: number } = {},
): Promise<File> {
  const maxDim         = opts.maxDim         ?? 1600;
  const baseQuality    = opts.quality        ?? 0.82;
  const targetMaxBytes = opts.targetMaxBytes ?? 900_000; // ~0.9 MB

  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }
  if (file.size <= targetMaxBytes) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Fallback: <img> + object URL (older WebKit)
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload  = () => resolve(i);
        i.onerror = () => reject(new Error("decode_failed"));
        i.src = url;
      });
      const canvas = document.createElement("canvas");
      const ratio  = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width  = Math.round(img.naturalWidth  * ratio);
      canvas.height = Math.round(img.naturalHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return file; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await canvasToJpegBlob(canvas, baseQuality, targetMaxBytes);
      if (!blob) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } catch {
      return file;
    }
  }

  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width  * ratio);
  const h = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await canvasToJpegBlob(canvas, baseQuality, targetMaxBytes);
  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  startQuality: number,
  maxBytes: number,
): Promise<Blob | null> {
  const qualities = [startQuality, 0.7, 0.6, 0.5, 0.4];
  for (const q of qualities) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", q),
    );
    if (!blob) continue;
    if (blob.size <= maxBytes) return blob;
  }
  // Last attempt: aggressive downscale
  const lastCanvas = document.createElement("canvas");
  lastCanvas.width  = Math.round(canvas.width  * 0.7);
  lastCanvas.height = Math.round(canvas.height * 0.7);
  const ctx = lastCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, lastCanvas.width, lastCanvas.height);
  return new Promise<Blob | null>((resolve) =>
    lastCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.5),
  );
}

/**
 * iOS Safari throws "The string did not match the expected pattern." when
 * FormData.append receives a File whose name contains characters WebKit
 * considers invalid for Content-Disposition (HEIC capture without extension,
 * special chars, accents, etc.).
 *
 * Workaround: re-wrap the File as a fresh File with a clean ASCII filename.
 */
export function sanitizeFileForUpload(file: File, fallbackBaseName: string): File {
  const rawName = (file.name || "").trim();
  const dot     = rawName.lastIndexOf(".");
  const rawExt  = dot > 0 ? rawName.slice(dot + 1).toLowerCase() : "";

  const typeExt = (() => {
    const t = (file.type || "").toLowerCase();
    if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
    if (t.includes("png"))                       return "png";
    if (t.includes("webp"))                      return "webp";
    if (t.includes("heic") || t.includes("heif")) return "heic";
    if (t.includes("pdf"))                       return "pdf";
    return "";
  })();

  const safeExt  = (rawExt && /^[a-z0-9]{2,5}$/.test(rawExt)) ? rawExt : (typeExt || "bin");
  const safeName = `${fallbackBaseName}.${safeExt}`;
  const safeType = file.type || "application/octet-stream";

  return new File([file], safeName, { type: safeType, lastModified: Date.now() });
}
