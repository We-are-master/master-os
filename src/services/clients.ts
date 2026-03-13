import { queryList, getSupabase, type ListParams, type ListResult } from "./base";
import type { Client } from "@/types/database";

export async function listClients(params: ListParams): Promise<ListResult<Client>> {
  return queryList<Client>("clients", params, {
    searchColumns: ["full_name", "email", "phone", "city", "address"],
    defaultSort: "created_at",
  });
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Client | null;
}

export async function createClient(data: Omit<Client, "id" | "created_at" | "updated_at" | "total_spent" | "jobs_count" | "last_job_date">): Promise<Client> {
  const supabase = getSupabase();
  const { data: result, error } = await supabase
    .from("clients")
    .insert(data)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result as Client;
}

export async function updateClient(id: string, data: Partial<Client>): Promise<Client> {
  const supabase = getSupabase();
  const { data: result, error } = await supabase
    .from("clients")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result as Client;
}

export async function deleteClient(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
