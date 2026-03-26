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

export async function updateClientAddress(
  id: string,
  input: Partial<Omit<ClientAddress, "id" | "client_id" | "created_at" | "updated_at">>
): Promise<ClientAddress> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_addresses")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ClientAddress;
}

export async function setDefaultClientAddress(clientId: string, addressId: string): Promise<void> {
  const supabase = getSupabase();
  // Clear all defaults for this client, then set the chosen one.
  await supabase.from("client_addresses").update({ is_default: false }).eq("client_id", clientId);
  const { error } = await supabase.from("client_addresses").update({ is_default: true }).eq("id", addressId);
  if (error) throw new Error(error.message);
}

export async function deleteClientAddress(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("client_addresses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
