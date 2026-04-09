import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/portal/account
 *
 * Allows a portal user to update a small whitelisted set of fields on
 * their account row. Strictly limited:
 *  - contact_name
 *  - finance_email
 *  - contact_number
 *  - address
 *
 * The portal user CANNOT change:
 *  - company_name (legal name — needs internal review)
 *  - email        (account-of-record contact — internal only)
 *  - industry, payment_terms, credit_limit, account_owner_id, etc.
 *
 * If they need any of those changed, they email hello@wearemaster.com.
 */
const PORTAL_ACCOUNT_WRITABLE_FIELDS = new Set<string>([
  "contact_name",
  "finance_email",
  "contact_number",
  "address",
]);

function pickAllowed(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (PORTAL_ACCOUNT_WRITABLE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Coerce + trim string fields
  const patch: Record<string, unknown> = {};
  if (typeof body.contact_name === "string") {
    const v = body.contact_name.trim();
    if (!v) return NextResponse.json({ error: "Contact name cannot be empty" }, { status: 400 });
    if (v.length > 200) return NextResponse.json({ error: "Contact name is too long" }, { status: 400 });
    patch.contact_name = v;
  }
  if (typeof body.finance_email === "string") {
    const v = body.finance_email.trim().toLowerCase();
    if (v && !v.includes("@")) {
      return NextResponse.json({ error: "Finance email is not a valid email address" }, { status: 400 });
    }
    if (v.length > 200) return NextResponse.json({ error: "Finance email is too long" }, { status: 400 });
    patch.finance_email = v || null;
  }
  if (typeof body.contact_number === "string") {
    const v = body.contact_number.trim();
    if (v.length > 60) return NextResponse.json({ error: "Phone number is too long" }, { status: 400 });
    patch.contact_number = v || null;
  }
  if (typeof body.address === "string") {
    const v = body.address.trim();
    if (v.length > 500) return NextResponse.json({ error: "Address is too long" }, { status: 400 });
    patch.address = v || null;
  }

  const safePatch = pickAllowed(patch);
  if (Object.keys(safePatch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("accounts")
    .update(safePatch)
    .eq("id", auth.accountId);

  if (error) {
    console.error("[portal/account/PATCH] update failed:", error);
    return NextResponse.json({ error: "We could not save your changes. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
