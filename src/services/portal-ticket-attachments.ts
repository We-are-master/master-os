/**
 * Client-side helpers for uploading ticket attachments from the portal.
 *
 * Uploads happen directly to the `ticket-attachments` Supabase Storage
 * bucket (created in migration 133) using the portal user's session
 * token — RLS policies on the bucket allow any authenticated user to
 * insert (same as today). The resulting storage path is included in the
 * ticket message payload and resolved to a signed URL at render time.
 */

import { getSupabase } from "./base";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";

const BUCKET = "ticket-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const ALLOWED_PREFIXES = ["image/", "application/pdf", "text/", "application/msword", "application/vnd.openxmlformats"];

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "file";
  return base.slice(0, 180);
}

export interface TicketAttachmentUpload {
  path: string;
  name: string;
  type: string;
  size: number;
}

export async function uploadTicketAttachment(ticketId: string, file: File): Promise<TicketAttachmentUpload> {
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_PREFIXES.some((p) => type.startsWith(p))) {
    throw new Error("Unsupported file type. Use images, PDFs, or documents.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File must be 10 MB or less.");
  }

  const supabase = getSupabase();
  const fileName = safeFileName(file.name);
  const path = `${ticketId}/${Date.now()}-${fileName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return { path, name: fileName, type, size: file.size };
}

/** Resolve a stored path to a signed URL (cached, deduped). */
export async function getTicketAttachmentUrl(path: string): Promise<string> {
  return getCachedSignedUrl(
    BUCKET,
    path,
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    { ttlMs: 55 * 60 * 1000 },
  );
}
