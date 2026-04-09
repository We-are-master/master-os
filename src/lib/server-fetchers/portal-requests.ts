import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalRequestRow {
  id:               string;
  reference:        string;
  service_type:     string;
  status:           string;
  description:      string | null;
  property_address: string | null;
  owner_name:       string | null;
  created_at:       string;
}

/**
 * Returns the most recent service requests for an account, scoped through
 * the clients.source_account_id FK chain. Bounded at 100 rows.
 */
export async function fetchAccountRequests(accountId: string): Promise<PortalRequestRow[]> {
  const supabase = await getServerSupabase();

  const { data: clientRows } = await supabase
    .from("clients")
    .select("id")
    .eq("source_account_id", accountId)
    .is("deleted_at", null)
    .limit(1000);
  const clientIds = ((clientRows ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (clientIds.length === 0) return [];

  const { data, error } = await supabase
    .from("service_requests")
    .select("id, reference, service_type, status, description, property_address, owner_name, created_at")
    .in("client_id", clientIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];
  return data as PortalRequestRow[];
}
