import { getSupabase } from "./base";

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

export async function getPayrollDocumentSignedUrl(path: string, expiresSec = 3600): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresSec);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
