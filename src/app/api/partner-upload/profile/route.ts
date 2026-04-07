import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyPartnerUploadToken } from "@/lib/partner-upload-token";

/**
 * PATCH /api/partner-upload/profile
 * Public, no auth — protected by signed token + active request row.
 *
 * Updates ONLY the fields the partner is allowed to self-edit. Anything not in
 * the allow-list is silently dropped (defence in depth — never trust the body).
 *
 * Body: { token: string, patch: { ... } }
 */

const TEXT_FIELDS = new Set([
  "contact_name",
  "phone",
  "partner_address",
  "vat_number",
  "crn",
  "utr",
  "bank_sort_code",
  "bank_account_number",
  "bank_account_holder",
  "bank_name",
]);

const BOOL_FIELDS = new Set(["vat_registered"]);
const STRING_ARRAY_FIELDS = new Set(["trades", "uk_coverage_regions"]);

function sanitizePatch(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (TEXT_FIELDS.has(key)) {
      if (raw == null) {
        out[key] = null;
      } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        out[key] = trimmed.length > 0 ? trimmed.slice(0, 500) : null;
      }
    } else if (BOOL_FIELDS.has(key)) {
      if (typeof raw === "boolean") out[key] = raw;
    } else if (STRING_ARRAY_FIELDS.has(key)) {
      if (Array.isArray(raw)) {
        const arr = raw
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .slice(0, 50);
        out[key] = arr;
      }
    }
  }
  return out;
}

export async function PATCH(req: NextRequest) {
  let body: { token?: unknown; patch?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const payload = verifyPartnerUploadToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  const patch = sanitizePatch(body.patch);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  const supabase = createServiceClient();

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
  if (r.use_count >= 30) {
    return NextResponse.json(
      { error: "Update limit reached for this link." },
      { status: 429 },
    );
  }

  /** Keep `trade` (singular) in sync with `trades[0]` since the dashboard list still reads it. */
  if (Array.isArray(patch.trades) && (patch.trades as string[]).length > 0) {
    patch.trade = (patch.trades as string[])[0];
  }

  const { data: updated, error: updErr } = await supabase
    .from("partners")
    .update(patch)
    .eq("id", r.partner_id)
    .select(
      "id, contact_name, phone, partner_address, vat_number, vat_registered, crn, utr, trades, trade, uk_coverage_regions, bank_sort_code, bank_account_number, bank_account_holder, bank_name",
    )
    .single();
  if (updErr || !updated) {
    console.error("partner-upload/profile update", updErr);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

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
      action: "profile_updated_via_link",
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: {
        request_id: r.id,
        fields: Object.keys(patch),
      },
    })
    .then(({ error }) => {
      if (error) console.error("audit_logs insert (profile_updated_via_link)", error);
    });

  return NextResponse.json({ success: true, partner: updated });
}
