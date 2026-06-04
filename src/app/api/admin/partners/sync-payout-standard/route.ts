import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import {
  normalizePartnerPayoutStandardTerms,
  ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  PARTNER_PAYOUT_PRESET_VALUES,
} from "@/lib/partner-payout-schedule";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);
const CHUNK = 200;

/**
 * POST /api/admin/partners/sync-payout-standard
 *
 * Clears `partners.payment_terms` for profiles on a preset schedule so they inherit
 * the org standard from Settings → Setup (blank = Standard in Final review).
 *
 * Body: { standardTerms?: string; previousStandard?: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or manager required" }, { status: 403 });
  }

  let body: { standardTerms?: string; previousStandard?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body ok */
  }

  const admin = createServiceClient();
  const { data: settingsRow } = await admin.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const setup = parseFrontendSetup(settingsRow?.frontend_setup ?? null);
  const newStandard = normalizePartnerPayoutStandardTerms(body.standardTerms ?? setup.partner_payout_standard_terms);
  const previousStandard = normalizePartnerPayoutStandardTerms(
    body.previousStandard ?? setup.partner_payout_standard_terms ?? ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  );

  const presetSet = new Set(PARTNER_PAYOUT_PRESET_VALUES);
  const matchTerms = new Set([previousStandard, newStandard, ...PARTNER_PAYOUT_PRESET_VALUES]);

  const { data: partners, error: listErr } = await admin.from("partners").select("id, payment_terms");
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 400 });

  const toClear = (partners ?? []).filter((p) => {
    const terms = (p as { payment_terms?: string | null }).payment_terms?.trim() ?? "";
    if (!terms) return false;
    return matchTerms.has(terms) || presetSet.has(terms);
  });

  const ids = toClear.map((p) => (p as { id: string }).id).filter(Boolean);
  let updated = 0;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error } = await admin.from("partners").update({ payment_terms: null }).in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    updated += chunk.length;
  }

  return NextResponse.json({
    ok: true,
    standardTerms: newStandard,
    previousStandard,
    cleared: updated,
    totalPartners: partners?.length ?? 0,
  });
}
