import { getSupabase } from "./base";
import type { ClientSourceAccount } from "@/types/database";
import { createAccount } from "./accounts";

/**
 * Corporate accounts for linking a client (`clients.source_account_id` → `accounts.id`).
 * Keeps `ClientSourceAccount` as `{ id, name }` for dropdowns.
 */
export async function listClientSourceAccounts(): Promise<ClientSourceAccount[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name, created_at")
    .is("deleted_at", null)
    .order("company_name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; company_name: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.company_name,
    created_at: row.created_at,
  }));
}

export async function getClientSourceAccount(id: string): Promise<ClientSourceAccount | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { id: string; company_name: string; created_at: string } | null;
  if (!row) return null;
  return { id: row.id, name: row.company_name, created_at: row.created_at };
}

/** Cria um registro em `accounts` e devolve no formato usado pelos selects de cliente. */
export async function createClientSourceAccount(input: {
  name: string;
  contact_name: string;
  email: string;
  industry?: string;
  payment_terms?: string;
}): Promise<ClientSourceAccount> {
  const account = await createAccount({
    company_name: input.name.trim(),
    contact_name: input.contact_name.trim(),
    email: input.email.trim(),
    industry: (input.industry ?? "General").trim() || "General",
    status: "onboarding",
    credit_limit: 0,
    payment_terms: (input.payment_terms ?? "Net 30").trim() || "Net 30",
  });
  return {
    id: account.id,
    name: account.company_name,
    created_at: account.created_at,
  };
}
