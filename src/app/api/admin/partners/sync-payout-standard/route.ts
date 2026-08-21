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


  /**
   * Nada a limpar: parceiro não tem mais termo próprio.
   *
   * Esta rota existia para zerar `partners.payment_terms` em quem estivesse num
   * preset, de forma a herdar o padrão do Setup. Duas coisas a tornaram vazia:
   * a coluna **nunca existiu neste banco** (migração 145 não aplicada), então
   * toda chamada morria com 42703; e em 20/08/2026 o dono decidiu que a cadência
   * é uma só para todos, o que apaga o próprio conceito de override.
   *
   * Fica respondendo `ok` em vez de sumir porque Settings → Setup ainda a chama
   * ao salvar o padrão, e uma rota 404 ali viraria um erro na tela por um
   * trabalho que não precisa mais ser feito.
   */
  const updated = 0;

  return NextResponse.json({
    ok: true,
    standardTerms: newStandard,
    previousStandard,
    cleared: updated,
    totalPartners: 0,
  });
}
