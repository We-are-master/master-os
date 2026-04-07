import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerUploadToken } from "@/lib/partner-upload-token";
import { addBusinessDays } from "@/lib/business-days";
import { buildPartnerUploadEmailHTML } from "@/lib/partner-upload-email-template";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

/** Default fallback FROM if no env override is set. */
const DEFAULT_FROM_EMAIL = "Master Group <hello@wearemaster.com>";

const ALLOWED_DOC_TYPES = new Set([
  "insurance",
  "certification",
  "license",
  "contract",
  "tax",
  "id_proof",
  "other",
]);

/**
 * POST /api/partners/[id]/request-documents
 * Admin-only. Generates a tokenized self-service link, persists a `partner_document_requests`
 * row (so we can revoke / track usage), then emails the partner with the upload URL.
 *
 * Body: { docTypes?: string[]; customMessage?: string }
 * Returns: { requestId, expiresAt, sentTo, uploadUrl } on success.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id: partnerId } = await ctx.params;
  if (!partnerId || !isValidUUID(partnerId)) {
    return NextResponse.json({ error: "Invalid partner id" }, { status: 400 });
  }

  let body: { docTypes?: unknown; customMessage?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const docTypesRaw = Array.isArray(body.docTypes) ? body.docTypes : [];
  const docTypes = docTypesRaw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => ALLOWED_DOC_TYPES.has(t));
  const customMessage =
    typeof body.customMessage === "string" && body.customMessage.trim()
      ? body.customMessage.trim().slice(0, 2000)
      : null;

  const supabase = createServiceClient();

  const { data: partner, error: partnerErr } = await supabase
    .from("partners")
    .select("id, company_name, contact_name, email")
    .eq("id", partnerId)
    .maybeSingle();
  if (partnerErr || !partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  const partnerEmail = (partner as { email?: string | null }).email?.trim() ?? "";
  if (!partnerEmail) {
    return NextResponse.json(
      { error: "Partner has no email on file. Add one before sending the link." },
      { status: 422 },
    );
  }

  const expiresAt = addBusinessDays(new Date(), 7);

  /** Resolve admin display name (best-effort, non-blocking on failure). */
  let requestedByName: string | null = null;
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", auth.user.id)
      .maybeSingle();
    requestedByName =
      (prof as { full_name?: string | null; email?: string | null } | null)?.full_name?.trim() ||
      (prof as { full_name?: string | null; email?: string | null } | null)?.email?.trim() ||
      auth.user.email ||
      null;
  } catch {
    requestedByName = auth.user.email ?? null;
  }

  const { data: requestRow, error: insertErr } = await supabase
    .from("partner_document_requests")
    .insert({
      partner_id: partnerId,
      requested_doc_types: docTypes,
      custom_message: customMessage,
      requested_by: auth.user.id,
      requested_by_name: requestedByName,
      sent_to_email: partnerEmail,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, expires_at")
    .single();
  if (insertErr || !requestRow) {
    console.error("partner_document_requests insert", insertErr);
    return NextResponse.json({ error: "Failed to create request" }, { status: 500 });
  }

  const token = createPartnerUploadToken({
    requestId: (requestRow as { id: string }).id,
    partnerId,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
  const uploadUrl = `${baseUrl}/partner-upload?token=${encodeURIComponent(token)}`;

  /** Branding for the email — same source as quote emails so look stays consistent. */
  let branding: CompanyBranding;
  try {
    const { data: settings } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();
    const s = (settings ?? {}) as Record<string, unknown>;
    branding = {
      companyName: String(s.company_name ?? "Master Group"),
      logoUrl: s.logo_url ? String(s.logo_url) : undefined,
      address: String(s.address ?? "124 City Road, London, UK"),
      phone: String(s.phone ?? ""),
      email: String(s.email ?? "hello@wearemaster.com"),
      website: s.website ? String(s.website) : undefined,
      vatNumber: s.vat_number ? String(s.vat_number) : undefined,
      primaryColor: String(s.primary_color ?? "#F97316"),
      tagline: s.tagline ? String(s.tagline) : undefined,
    };
  } catch {
    branding = {
      companyName: "Master Group",
      address: "124 City Road, London, UK",
      phone: "",
      email: "hello@wearemaster.com",
      primaryColor: "#F97316",
    };
  }

  const html = buildPartnerUploadEmailHTML(branding, {
    partnerName: (partner as { contact_name?: string | null; company_name?: string | null }).contact_name?.trim() ||
      (partner as { company_name?: string | null }).company_name?.trim() ||
      "there",
    uploadUrl,
    expiresAt,
    customMessage: customMessage ?? undefined,
    requestedDocTypes: docTypes,
  });

  /** Resend send. If RESEND_API_KEY isn't set we still return success so admins
   *  can copy the link manually — but flag emailSent: false in the response. */
  const resendKey = process.env.RESEND_API_KEY?.trim();
  let emailSent = false;
  let emailError: string | null = null;

  if (resendKey) {
    try {
      const resend = new Resend(resendKey);
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
      const { error } = await resend.emails.send({
        from: fromEmail,
        to: [partnerEmail],
        subject: `${branding.companyName} — please update your documents`,
        html,
      });
      if (error) {
        emailError = error.message ?? "Resend send failed";
      } else {
        emailSent = true;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : "Email send failed";
    }
  } else {
    emailError = "RESEND_API_KEY not configured";
  }

  /** Audit log — fire-and-forget, doesn't gate the response. */
  void supabase
    .from("audit_logs")
    .insert({
      entity_type: "partner",
      entity_id: partnerId,
      entity_ref: (partner as { company_name?: string | null }).company_name ?? null,
      action: "documents_requested",
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: {
        request_id: (requestRow as { id: string }).id,
        sent_to: partnerEmail,
        doc_types: docTypes,
        email_sent: emailSent,
        requested_by: requestedByName,
      },
    })
    .then(({ error }) => {
      if (error) console.error("audit_logs insert (documents_requested)", error);
    });

  return NextResponse.json({
    success: true,
    requestId: (requestRow as { id: string }).id,
    expiresAt: (requestRow as { expires_at: string }).expires_at,
    sentTo: partnerEmail,
    uploadUrl,
    emailSent,
    emailError,
  });
}
