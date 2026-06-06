import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import {
  normalizePartnerPayoutReferenceYmd,
  resolveOrgPartnerPayoutStandardTerms,
  type SelfBillDueResolveContext,
} from "@/lib/partner-payout-schedule";

export type OrgPartnerPayoutSettings = SelfBillDueResolveContext & {
  orgStandardTerms: string;
};

/** Load org partner payout schedule from `company_settings.frontend_setup` (Settings → Setup). */
export async function loadOrgPartnerPayoutSettings(
  admin: SupabaseClient,
): Promise<OrgPartnerPayoutSettings> {
  const { data } = await admin.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const setup = parseFrontendSetup((data as { frontend_setup?: unknown } | null)?.frontend_setup);
  const orgStandardTerms = resolveOrgPartnerPayoutStandardTerms(setup);
  const orgReferenceYmd = normalizePartnerPayoutReferenceYmd(setup?.partner_payout_reference_ymd);
  return { orgStandardTerms, orgReferenceYmd };
}
