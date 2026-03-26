import { getSupabase } from "./base";

const BUCKET = "company-assets";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "report";
  return base.slice(0, 180);
}

export async function uploadManualJobReport(jobId: string, file: File): Promise<{ path: string; publicUrl: string; mimeType: string }> {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("Use PDF, DOC, DOCX or image files (JPG, PNG, WebP, GIF).");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Report file must be 10 MB or less.");
  }

  const supabase = getSupabase();
  const fileName = safeFileName(file.name);
  const path = `jobs/${jobId}/manual-reports/${Date.now()}-${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: pub.publicUrl, mimeType: type };
}
