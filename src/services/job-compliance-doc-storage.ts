import { getSupabase } from "./base";
const BUCKET = "company-assets";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "document";
  return base.slice(0, 180);
}

export type UploadedComplianceDoc = {
  path: string;
  publicUrl: string;
  mimeType: string;
};

/** Uploads to `company-assets/jobs/{jobId}/documents/{ts}-{name}`. */
export async function uploadJobComplianceDocument(jobId: string, file: File): Promise<UploadedComplianceDoc> {
  const type = (file.type || "").toLowerCase() || "application/octet-stream";
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("Use PDF, DOC or DOCX.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Document must be 10 MB or less.");
  }

  const supabase = getSupabase();
  const fileName = safeFileName(file.name);
  const path = `jobs/${jobId}/documents/${Date.now()}-${fileName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: type,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: pub.publicUrl, mimeType: type };
}

export async function removeJobComplianceDocumentFromStorage(storagePath: string): Promise<void> {
  if (!storagePath?.trim()) return;
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(error.message);
}
