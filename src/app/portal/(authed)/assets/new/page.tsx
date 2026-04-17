import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { getServerSupabase } from "@/lib/supabase/server-cached";
import { PortalNewAssetClient } from "./portal-new-asset-client";

export const dynamic = "force-dynamic";

export default async function PortalNewAssetPage() {
  const auth = await requirePortalUserOrRedirect();
  const supabase = await getServerSupabase();
  const { data: account } = await supabase
    .from("accounts")
    .select("id, company_name")
    .eq("id", auth.accountId)
    .maybeSingle();
  const { data: contacts } = await supabase
    .from("clients")
    .select("id, full_name, email")
    .eq("source_account_id", auth.accountId)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  return (
    <PortalNewAssetClient
      accountName={(account as { company_name?: string } | null)?.company_name ?? "Your account"}
      contacts={(contacts ?? []) as Array<{ id: string; full_name: string; email?: string | null }>}
    />
  );
}
