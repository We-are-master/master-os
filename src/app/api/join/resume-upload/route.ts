import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchPartnerDocumentRules } from "@/lib/company-partner-doc-rules";
import {
  buildJoinRegistrationDocChecklist,
  resolvePartnerDocExpiresAt,
} from "@/lib/partner-required-docs";
import { partnerMissingRequiredDocs } from "@/lib/partner-docs-gate";

export const dynamic = "force-dynamic";

const BUCKET = "partner-documents";

/** Allowed file types (kept in sync with /api/join/register). */
const ALLOWED_DOC_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function safeExtForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

/**
 * POST /api/join/resume-upload  (multipart/form-data)
 *
 * Session-authed doc uploader for the /join wizard's resume flow. Each POST
 * accepts one file with `docKey` naming the requirement (matches
 * `RequiredDocDef.id` from `buildJoinRegistrationDocChecklist`). The partner
 * is resolved from the OTP-established Supabase session; no partnerId is
 * accepted from the client.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`join-resume-upload:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You need to verify by code first." }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: partner, error: partnerErr } = await service
    .from("partners")
    .select("id, status, auth_user_id, email")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email ?? ""}`)
    .is("deleted_at", null)
    .maybeSingle();
  if (partnerErr || !partner) {
    return NextResponse.json({ error: "Partner record not found." }, { status: 404 });
  }
  if (partner.status !== "onboarding") {
    return NextResponse.json(
      { error: "This partner is not currently onboarding." },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const docKey = String(form.get("docKey") ?? "").trim();
  const file = form.get("file");
  if (!docKey || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "docKey and file are required." }, { status: 400 });
  }

  const rules = await fetchPartnerDocumentRules(service);
  const checklist = buildJoinRegistrationDocChecklist(rules);
  const target = checklist.find((d) => d.id === docKey);
  if (!target) {
    return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  }

  if (file.size > MAX_DOC_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }
  if (file.type && !ALLOWED_DOC_MIME.has(file.type.toLowerCase())) {
    return NextResponse.json(
      { error: "Unsupported file type. Use JPG, PNG, WebP, HEIC, or PDF." },
      { status: 400 },
    );
  }

  const { data: docRow, error: docInsertErr } = await service
    .from("partner_documents")
    .insert({
      partner_id: partner.id,
      name: target.name,
      doc_type: target.docType,
      status: "pending",
      uploaded_by: "Join resume",
      expires_at: resolvePartnerDocExpiresAt(target.docType),
    })
    .select("id")
    .single();
  if (docInsertErr || !docRow?.id) {
    console.error("[join/resume-upload] insert error:", docInsertErr);
    return NextResponse.json({ error: "Could not save the document." }, { status: 500 });
  }

  const ext = safeExtForMime(file.type ?? "");
  const path = `${partner.id}/${docRow.id}/document.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: storageErr } = await service.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true });
  if (storageErr) {
    console.error("[join/resume-upload] storage error:", storageErr);
    return NextResponse.json(
      { error: `Upload failed: ${storageErr.message}` },
      { status: 500 },
    );
  }

  await service
    .from("partner_documents")
    .update({ file_path: path, file_name: `document.${ext}` })
    .eq("id", docRow.id);

  const missing = await partnerMissingRequiredDocs(service, partner.id);
  return NextResponse.json({ ok: true, missingDocs: missing });
}
