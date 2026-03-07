import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Account } from "@/types/database";

export async function listAccounts(params: ListParams): Promise<ListResult<Account>> {
  return queryList<Account>("accounts", params, {
    searchColumns: ["company_name", "contact_name", "email", "industry"],
    defaultSort: "created_at",
  });
}

export async function createAccount(
  input: Omit<Account, "id" | "created_at" | "total_revenue" | "active_jobs">
): Promise<Account> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}

export async function updateAccount(id: string, input: Partial<Account>): Promise<Account> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}
