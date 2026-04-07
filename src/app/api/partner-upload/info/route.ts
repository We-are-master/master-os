import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerUploadToken } from "@/lib/partner-upload-resolver";

/**
 * GET /api/partner-upload/info?token=...
 * Public, no auth. Validates the token + request row, then returns the partner
 * profile fields the partner is allowed to view + edit on the public page.
 *
 * NEVER returns: bank details (write-only on this surface), internal_notes,
 * status, compliance_score, or any earnings columns.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const resolved = await resolvePartnerUploadToken(supabase, token);
  if (!resolved) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  const { data: request, error: reqErr } = await supabase
    .from("partner_document_requests")
    .select("id, partner_id, requested_doc_types, requested_docs, custom_message, expires_at, revoked_at, first_used_at, use_count")
    .eq("id", resolved.requestId)
    .maybeSingle();
  if (reqErr || !request) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  const r = request as {
    id: string;
    partner_id: string;
    requested_doc_types: string[];
    requested_docs: Array<{ id: string; name: string; description: string; docType: string }> | null;
    custom_message: string | null;
    expires_at: string;
    revoked_at: string | null;
    first_used_at: string | null;
    use_count: number;
  };

  if (r.partner_id !== resolved.partnerId) {
    /** Token payload tampered with — log and refuse. */
    console.warn("partner-upload/info: partnerId mismatch", { resolved, row: r });
    return NextResponse.json({ error: "Invalid link" }, { status: 401 });
  }
  if (r.revoked_at) {
    return NextResponse.json({ error: "This link was revoked" }, { status: 410 });
  }
  if (new Date(r.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  const { data: partner, error: partnerErr } = await supabase
    .from("partners")
    .select(
      [
        "id",
        "company_name",
        "contact_name",
        "phone",
        "trade",
        "trades",
        "partner_address",
        "uk_coverage_regions",
        "vat_number",
        "vat_registered",
        "crn",
        "utr",
        "partner_legal_type",
      ].join(", "),
    )
    .eq("id", r.partner_id)
    .maybeSingle();
  if (partnerErr || !partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  /** Existing documents (so the partner can see what we already have on file). */
  const { data: documents } = await supabase
    .from("partner_documents")
    .select("id, name, doc_type, status, expires_at, file_name, created_at")
    .eq("partner_id", r.partner_id)
    .order("created_at", { ascending: false });

  /** First-touch tracking — only mark first_used_at on the very first valid open. */
  if (!r.first_used_at) {
    void supabase
      .from("partner_document_requests")
      .update({ first_used_at: new Date().toISOString() })
      .eq("id", r.id)
      .then(({ error }) => {
        if (error) console.error("partner_document_requests first_used_at", error);
      });
  }

  return NextResponse.json({
    request: {
      id: r.id,
      requestedDocTypes: r.requested_doc_types,
      requestedDocs: Array.isArray(r.requested_docs) ? r.requested_docs : [],
      customMessage: r.custom_message,
      expiresAt: r.expires_at,
    },
    partner,
    documents: documents ?? [],
  });
}
