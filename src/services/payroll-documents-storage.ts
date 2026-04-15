import { getSupabase } from "./base";
import { getCachedSignedUrl, getCachedSignedUrlsBatch } from "@/lib/signed-url-cache";

const BUCKET = "payroll-internal-documents";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "document";
  return base.slice(0, 180);
}

/** Path: `{internalCostId}/{docKey}/{fileName}` */
export async function uploadPayrollDocumentFile(
  internalCostId: string,
  docKey: string,
  file: File
): Promise<{ path: string; file_name: string }> {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED.has(type)) {
    throw new Error("Use PDF, Word, or an image (JPEG, PNG, WebP).");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File must be 10 MB or less.");
  }
  const supabase = getSupabase();
  const fileName = safeFileName(file.name);
  const path = `${internalCostId}/${docKey}/${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  return { path, file_name: fileName };
}

export interface SignedUrlImageOptions {
  /** Render a resized thumbnail via Supabase Storage transforms (much smaller payload). */
  width?: number;
  height?: number;
  /** `cover` crops to fill; `contain` preserves aspect ratio (default `cover`). */
  resize?: "cover" | "contain" | "fill";
}

export async function getPayrollDocumentSignedUrl(
  path: string,
  expiresSec = 3600,
  transform?: SignedUrlImageOptions,
): Promise<string> {
  return getCachedSignedUrl(
    BUCKET,
    path,
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, expiresSec, transform ? { transform } : undefined);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    { width: transform?.width, height: transform?.height, ttlMs: Math.max(0, (expiresSec - 300) * 1000) },
  );
}

/**
 * Batch variant: resolves many payroll document paths efficiently.
 *
 * - Without `transform`: uses `createSignedUrls` (single HTTP round-trip for
 *   any number of paths).
 * - With `transform`: Supabase only supports image transforms on the
 *   single-URL endpoint, so we fall back to `Promise.all` of per-path
 *   `createSignedUrl` calls — each cached + deduped by the module cache
 *   so subsequent renders are instant.
 *
 * Paths that fail are omitted from the returned map.
 */
export async function getPayrollDocumentSignedUrls(
  paths: string[],
  expiresSec = 3600,
  transform?: SignedUrlImageOptions,
): Promise<Record<string, string>> {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return {};

  if (transform) {
    // Transform requires single-URL endpoint; cache makes the N parallel
    // calls effectively N→1 after the first warm cycle.
    const entries = await Promise.all(
      uniquePaths.map(async (p) => {
        try {
          return [p, await getPayrollDocumentSignedUrl(p, expiresSec, transform)] as const;
        } catch {
          return null;
        }
      }),
    );
    const out: Record<string, string> = {};
    for (const row of entries) {
      if (row) out[row[0]] = row[1];
    }
    return out;
  }

  return getCachedSignedUrlsBatch(
    BUCKET,
    uniquePaths,
    async (missing) => {
      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(missing, expiresSec);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .filter((r): r is { path: string; signedUrl: string; error: null } =>
          !!r && !!r.path && !!r.signedUrl)
        .map(({ path, signedUrl }) => ({ path, signedUrl }));
    },
    { ttlMs: Math.max(0, (expiresSec - 300) * 1000) },
  );
}
