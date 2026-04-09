import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerPortalCredential } from "@/lib/partner-portal-session";
import { normalizeUkAccountNumberInput, normalizeUkSortCodeInput, validatePartnerBankDetails } from "@/lib/uk-bank-details";

export const dynamic = "force-dynamic";

/**
 * Strict allowlist of partner columns this endpoint may write.
 * Keep in sync with the field extraction in PATCH below — any column not
 * in this set is silently dropped, even if `partners` schema gains new
 * fields. Defends against mass assignment if the route ever evolves.
 */
const PARTNER_PROFILE_WRITABLE_FIELDS = new Set<string>([
  "contact_name",
  "company_name",
  "phone",
  "partner_address",
  "vat_number",
  "crn",
  "utr",
  "vat_registered",
  "bank_sort_code",
  "bank_account_number",
  "bank_account_holder",
  "bank_name",
]);

function pickAllowedFields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PARTNER_PROFILE_WRITABLE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const credential = code || token;
  if (!credential) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const session = await resolvePartnerPortalCredential(credential);
  if (!session) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 401 });
  }

  const contactName = typeof body.contactName === "string" ? body.contactName.trim() : undefined;
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;
  const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
  const partnerAddress = typeof body.partnerAddress === "string" ? body.partnerAddress.trim() : undefined;
  const vatNumber = typeof body.vatNumber === "string" ? body.vatNumber.trim() : undefined;
  const crn = typeof body.crn === "string" ? body.crn.trim() : undefined;
  const utr = typeof body.utr === "string" ? body.utr.trim() : undefined;
  const vatRegistered =
    typeof body.vatRegistered === "boolean" ? body.vatRegistered : undefined;

  const bankSortCode = typeof body.bankSortCode === "string" ? body.bankSortCode : undefined;
  const bankAccountNumber = typeof body.bankAccountNumber === "string" ? body.bankAccountNumber : undefined;
  const bankAccountHolder = typeof body.bankAccountHolder === "string" ? body.bankAccountHolder : undefined;
  const bankName = typeof body.bankName === "string" ? body.bankName : undefined;

  const patch: Record<string, unknown> = {};
  if (contactName !== undefined) patch.contact_name = contactName;
  if (companyName !== undefined) patch.company_name = companyName;
  if (phone !== undefined) patch.phone = phone || null;
  if (partnerAddress !== undefined) patch.partner_address = partnerAddress || null;
  if (vatNumber !== undefined) patch.vat_number = vatNumber || null;
  if (crn !== undefined) patch.crn = crn || null;
  if (utr !== undefined) patch.utr = utr || null;
  if (vatRegistered !== undefined) patch.vat_registered = vatRegistered;

  if (
    bankSortCode !== undefined ||
    bankAccountNumber !== undefined ||
    bankAccountHolder !== undefined ||
    bankName !== undefined
  ) {
    const sortDigits = normalizeUkSortCodeInput(bankSortCode ?? "");
    const accountDigits = normalizeUkAccountNumberInput(bankAccountNumber ?? "");
    const holder = typeof bankAccountHolder === "string" ? bankAccountHolder : "";
    const bname = typeof bankName === "string" ? bankName : "";
    const bankVal = validatePartnerBankDetails({
      sortDigits,
      accountDigits,
      accountHolder: holder,
      bankName: bname,
    });
    if (!bankVal.ok) {
      return NextResponse.json({ error: bankVal.message }, { status: 400 });
    }
    const anyBank =
      sortDigits.length > 0 ||
      accountDigits.length > 0 ||
      holder.trim().length > 0 ||
      bname.trim().length > 0;
    if (anyBank) {
      patch.bank_sort_code = sortDigits || null;
      patch.bank_account_number = accountDigits || null;
      patch.bank_account_holder = holder.trim() || null;
      patch.bank_name = bname.trim() || null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  // Defense in depth: drop any field not in the writable allowlist before
  // sending to Postgres. The fields are already explicitly built above,
  // but this guards against future drift.
  const safePatch = pickAllowedFields(patch);
  if (Object.keys(safePatch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("partners").update(safePatch).eq("id", session.partnerId);
  if (error) {
    console.error("[partner-upload/profile] update failed:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
