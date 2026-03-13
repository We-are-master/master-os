import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { ServiceRequest } from "@/types/database";

export async function listRequests(params: ListParams): Promise<ListResult<ServiceRequest>> {
  return queryList<ServiceRequest>("service_requests", params, {
    searchColumns: ["reference", "client_name", "client_email", "property_address", "service_type"],
    defaultSort: "created_at",
  });
}

export async function getRequest(id: string): Promise<ServiceRequest | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as ServiceRequest;
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
  return data as ServiceRequest;
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
  return data as ServiceRequest;
}

export async function updateRequestStatus(id: string, status: string): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Request not found or update had no effect");
}
