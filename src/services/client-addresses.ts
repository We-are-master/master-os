import { getSupabase } from "./base";
import type { ClientAddress } from "@/types/database";

export async function listAddressesByClient(clientId: string): Promise<ClientAddress[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_addresses")
    .select("*")
    .eq("client_id", clientId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientAddress[];
}

export async function createClientAddress(
  input: Omit<ClientAddress, "id" | "created_at" | "updated_at">
): Promise<ClientAddress> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_addresses")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ClientAddress;
}

export async function getClientAddress(id: string): Promise<ClientAddress | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("client_addresses").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as ClientAddress | null;
}
