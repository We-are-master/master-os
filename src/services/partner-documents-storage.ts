import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";

const BUCKET = "partner-documents";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MAIN = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_PREVIEW = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "application/pdf") return "pdf";
  return "bin";
}

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "document";
  return base.slice(0, 180);
}

export async function uploadPartnerDocumentFileWithSupabase(
  supabase: SupabaseClient,
  partnerId: string,
  documentId: string,
  file: File,
): Promise<{ path: string; fileName: string }> {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_MAIN.has(type)) {
    throw new Error("Use PDF, Word, or an image (JPEG, PNG, WebP, GIF).");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File must be 10 MB or less.");
  }
  const fileName = safeFileName(file.name);
  const path = `${partnerId}/${documentId}/${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  return { path, fileName };
}

export async function uploadPartnerDocumentFile(
  partnerId: string,
  documentId: string,
  file: File
): Promise<{ path: string; fileName: string }> {
  return uploadPartnerDocumentFileWithSupabase(getSupabase(), partnerId, documentId, file);
}

export async function uploadPartnerDocumentPreview(
  partnerId: string,
  documentId: string,
  file: File
): Promise<{ path: string }> {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_PREVIEW.has(type)) {
    throw new Error("Preview must be JPEG, PNG, WebP or GIF.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 10 MB or less.");
  }
  const supabase = getSupabase();
  const ext = extFromMime(type);
  const path = `${partnerId}/${documentId}/preview.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: type,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  return { path };
}

export async function removeStorageObjectsWithSupabase(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}

export async function removeStorageObjects(paths: string[]): Promise<void> {
  return removeStorageObjectsWithSupabase(getSupabase(), paths);
}

export async function getPartnerDocumentSignedUrlWithSupabase(
  supabase: SupabaseClient,
  path: string,
  expiresSec = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresSec);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function getPartnerDocumentSignedUrl(path: string, expiresSec = 3600): Promise<string> {
  // Deduped + memory-cached so repeated "open signed URL" clicks don't
  // round-trip the Storage API every time.
  return getCachedSignedUrl(
    BUCKET,
    path,
    () => getPartnerDocumentSignedUrlWithSupabase(getSupabase(), path, expiresSec),
    { ttlMs: Math.max(0, (expiresSec - 300) * 1000) },
  );
}
