import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { ServiceRequest } from "@/types/database";

/** Enrich rows with `accounts.company_name` via client → `source_account_id`. */
async function enrichRequestsWithAccountNames(requests: ServiceRequest[]): Promise<ServiceRequest[]> {
  const clientIds = [...new Set(requests.map((r) => r.client_id).filter(Boolean))] as string[];
  if (clientIds.length === 0) return requests;
  const supabase = getSupabase();
  const { data: clients, error: cErr } = await supabase
    .from("clients")
    .select("id, source_account_id")
    .in("id", clientIds);
  if (cErr || !clients?.length) return requests;
  const accountIds = [...new Set(clients.map((c) => c.source_account_id).filter(Boolean))] as string[];
  let accountNameById = new Map<string, string>();
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, company_name")
      .in("id", accountIds)
      .is("deleted_at", null);
    accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.company_name]));
  }
  const accountNameByClientId = new Map<string, string | null>();
  for (const c of clients) {
    const nm = c.source_account_id ? accountNameById.get(c.source_account_id) ?? null : null;
    accountNameByClientId.set(c.id, nm);
  }
  return requests.map((r) => ({
    ...r,
    source_account_name: r.client_id ? accountNameByClientId.get(r.client_id) ?? null : null,
  }));
}

export async function listRequests(params: ListParams): Promise<ListResult<ServiceRequest>> {
  const result = await queryList<ServiceRequest>("service_requests", params, {
    searchColumns: ["reference", "client_name", "client_email", "property_address", "service_type"],
    defaultSort: "created_at",
  });
  const data = await enrichRequestsWithAccountNames(result.data);
  return { ...result, data };
}

export async function getRequest(id: string): Promise<ServiceRequest | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? null;
}

export async function createRequest(
  input: Omit<ServiceRequest, "id" | "reference" | "created_at" | "updated_at">
): Promise<ServiceRequest> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_request_ref");
  const { data, error } = await supabase
    .from("service_requests")
    .insert({ ...input, reference: ref })
    .select()
    .single();
  if (error) throw error;
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? (data as ServiceRequest);
}

export async function updateRequest(
  id: string,
  input: Partial<ServiceRequest>
): Promise<ServiceRequest> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? (data as ServiceRequest);
}

export async function updateRequestStatus(id: string, status: string): Promise<ServiceRequest> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Request not found or update had no effect");
  const [enriched] = await enrichRequestsWithAccountNames([data as ServiceRequest]);
  return enriched ?? (data as ServiceRequest);
}
