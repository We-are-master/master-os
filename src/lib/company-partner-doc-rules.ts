import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFrontendSetup, resolvePartnerDocumentRules } from "@/lib/frontend-setup";
import type { PartnerDocRuleRow } from "@/lib/partner-required-docs";

/** Load merged partner document rules from `company_settings.frontend_setup`. */
export async function fetchPartnerDocumentRules(supabase: SupabaseClient): Promise<PartnerDocRuleRow[]> {
  const { data } = await supabase.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const setup = parseFrontendSetup((data as { frontend_setup?: unknown } | null)?.frontend_setup);
  return resolvePartnerDocumentRules(setup);
}
