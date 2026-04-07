import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyPartnerUploadToken } from "@/lib/partner-upload-token";

export const runtime = "nodejs";

const BUCKET = "partner-documents";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_DOC_TYPES = new Set([
  "insurance",
  "certification",
  "license",
  "contract",
  "tax",
  "id_proof",
  "other",
]);

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "document";
  return base.slice(0, 180);
}

/**
 * POST /api/partner-upload/file
 * Public, no auth — protected only by the signed token + the request row state.
 *
 * multipart/form-data:
 *   - token: string (required)
 *   - file: File   (required, ≤10MB, allowed MIME)
 *   - docType: string (one of ALLOWED_DOC_TYPES)
 *   - name: string (display name; falls back to file.name)
 *
 * Uploads with the service-role client → bypasses bucket RLS safely because we
 * already validated the token and the active request row above.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const token = String(form.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const payload = verifyPartnerUploadToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "Use PDF, Word, or an image (JPEG, PNG, WebP, GIF)." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or less." }, { status: 413 });
  }

  const docTypeRaw = String(form.get("docType") ?? "other").trim().toLowerCase();
  const docType = ALLOWED_DOC_TYPES.has(docTypeRaw) ? docTypeRaw : "other";
  const displayName =
    String(form.get("name") ?? "").trim().slice(0, 180) || file.name || "Document";

  const supabase = createServiceClient();

  /** Re-verify the request row on every hit so revoke / expiry take effect immediately. */
  const { data: requestRow, error: reqErr } = await supabase
    .from("partner_document_requests")
    .select("id, partner_id, expires_at, revoked_at, use_count")
    .eq("id", payload.requestId)
    .maybeSingle();
  if (reqErr || !requestRow) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  const r = requestRow as {
    id: string;
    partner_id: string;
    expires_at: string;
    revoked_at: string | null;
    use_count: number;
  };
  if (r.partner_id !== payload.partnerId) {
    return NextResponse.json({ error: "Invalid link" }, { status: 401 });
  }
  if (r.revoked_at) {
    return NextResponse.json({ error: "This link was revoked" }, { status: 410 });
  }
  if (new Date(r.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }
  /** Soft cap to limit abuse if a link leaks — 30 uploads per request lifetime. */
  if (r.use_count >= 30) {
    return NextResponse.json(
      { error: "Upload limit reached for this link. Contact us for a new one." },
      { status: 429 },
    );
  }

  /** Insert the partner_documents row first to get its id (so the storage path is stable). */
  const { data: docRow, error: docErr } = await supabase
    .from("partner_documents")
    .insert({
      partner_id: r.partner_id,
      name: displayName,
      doc_type: docType,
      status: "pending",
      file_name: file.name,
      uploaded_by: "partner_self_link",
    })
    .select("id")
    .single();
  if (docErr || !docRow) {
    console.error("partner_documents insert (public)", docErr);
    return NextResponse.json({ error: "Failed to create document row" }, { status: 500 });
  }
  const docId = (docRow as { id: string }).id;

  const safeName = safeFileName(file.name);
  const path = `${r.partner_id}/${docId}/${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
    contentType: mime || "application/octet-stream",
    upsert: true,
    cacheControl: "3600",
  });
  if (uploadErr) {
    /** Roll back the row if storage failed — leaves no orphan in the UI. */
    await supabase.from("partner_documents").delete().eq("id", docId);
    console.error("partner-documents storage upload", uploadErr);
    return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from("partner_documents")
    .update({ file_path: path })
    .eq("id", docId)
    .select("id, name, doc_type, file_name, file_path, created_at")
    .single();
  if (updateErr) {
    console.error("partner_documents update file_path", updateErr);
  }

  /** Bump the request's use counters — fire-and-forget. */
  void supabase
    .from("partner_document_requests")
    .update({ use_count: r.use_count + 1, last_used_at: new Date().toISOString() })
    .eq("id", r.id)
    .then(({ error }) => {
      if (error) console.error("partner_document_requests use_count", error);
    });

  void supabase
    .from("audit_logs")
    .insert({
      entity_type: "partner",
      entity_id: r.partner_id,
      entity_ref: null,
      action: "document_uploaded_via_link",
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: {
        request_id: r.id,
        document_id: docId,
        doc_type: docType,
        file_name: file.name,
      },
    })
    .then(({ error }) => {
      if (error) console.error("audit_logs insert (document_uploaded_via_link)", error);
    });

  return NextResponse.json({
    success: true,
    document: updated ?? { id: docId, name: displayName, doc_type: docType, file_name: file.name, file_path: path },
  });
}
