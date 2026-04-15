import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { getServerSupabase } from "@/lib/supabase/server-cached";
import { NewRequestClient } from "./new-request-client";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const auth = await requirePortalUserOrRedirect();
  const supabase = await getServerSupabase();
  const { data: props } = await supabase
    .from("account_properties")
    .select("id, name, full_address, primary_contact_id")
    .eq("account_id", auth.accountId)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  return (
    <NewRequestClient
      properties={(props ?? []) as Array<{ id: string; name: string; full_address: string }>}
    />
  );
}
