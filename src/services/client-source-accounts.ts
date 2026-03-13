import { getSupabase } from "./base";
import type { ClientSourceAccount } from "@/types/database";

/** Lista todos os accounts de origem (para dropdowns) */
export async function listClientSourceAccounts(): Promise<ClientSourceAccount[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_source_accounts")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientSourceAccount[];
}

export async function getClientSourceAccount(id: string): Promise<ClientSourceAccount | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_source_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ClientSourceAccount | null;
}

export async function createClientSourceAccount(
  input: Omit<ClientSourceAccount, "id" | "created_at">
): Promise<ClientSourceAccount> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("client_source_accounts")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ClientSourceAccount;
}
