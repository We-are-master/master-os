import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Account, Client, Invoice, Job } from "@/types/database";

type AccountInsert = Omit<Account, "id" | "created_at" | "total_revenue" | "active_jobs">;

function normalizeAccountInsert(input: AccountInsert): AccountInsert {
  return {
    ...input,
    email: input.email.trim().toLowerCase(),
    company_name: input.company_name.trim(),
    contact_name: input.contact_name.trim(),
    address: input.address?.trim() || null,
    crn: input.crn?.trim() || null,
    contact_number: input.contact_number?.trim() || null,
  };
}

function normalizeAccountPatch(input: Partial<Account>): Partial<Account> {
  const next = { ...input };
  if (next.email !== undefined) next.email = next.email.trim().toLowerCase();
  if (next.company_name !== undefined) next.company_name = next.company_name.trim();
  if (next.contact_name !== undefined) next.contact_name = next.contact_name.trim();
  if (next.address !== undefined) next.address = next.address?.trim() || null;
  if (next.crn !== undefined) next.crn = next.crn?.trim() || null;
  if (next.contact_number !== undefined) next.contact_number = next.contact_number?.trim() || null;
  if (next.logo_url !== undefined) {
    const t = typeof next.logo_url === "string" ? next.logo_url.trim() : "";
    next.logo_url = t.length > 0 ? t : null;
  }
  return next;
}

/** Maps Postgres unique violations on accounts (migration 033) to a clear message. */
export function formatAccountDbError(error: unknown): Error {
  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as { message?: string }).message ?? "");
    const code = (error as { code?: string }).code;
    if (code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
      if (msg.includes("uq_accounts_email_active")) {
        return new Error("An account with this email already exists.");
      }
      if (msg.includes("uq_accounts_company_name_active")) {
        return new Error("An account with this company name already exists.");
      }
      if (msg.toLowerCase().includes("email")) {
        return new Error("An account with this email already exists.");
      }
      if (msg.toLowerCase().includes("company_name")) {
        return new Error("An account with this company name already exists.");
      }
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function listAccounts(params: ListParams): Promise<ListResult<Account>> {
  return queryList<Account>("accounts", params, {
    searchColumns: ["company_name", "contact_name", "email", "industry"],
    defaultSort: "created_at",
  });
}

export async function getAccount(id: string): Promise<Account | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("accounts").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Account | null;
}

export async function createAccount(input: AccountInsert): Promise<Account> {
  const supabase = getSupabase();
  const payload = normalizeAccountInsert(input);
  const { data, error } = await supabase.from("accounts").insert(payload).select().single();
  if (error) throw formatAccountDbError(error);
  return data as Account;
}

export async function updateAccount(id: string, input: Partial<Account>): Promise<Account> {
  const supabase = getSupabase();
  const payload = normalizeAccountPatch(input);
  const { data, error } = await supabase.from("accounts").update(payload).eq("id", id).select().single();
  if (error) throw formatAccountDbError(error);
  return data as Account;
}

/** Jobs whose client is linked to this corporate account (`clients.source_account_id`). */
export async function listJobsLinkedToAccount(accountId: string): Promise<Job[]> {
  const supabase = getSupabase();
  const { data: clients, error: cErr } = await supabase.from("clients").select("id").eq("source_account_id", accountId);
  if (cErr) throw new Error(cErr.message);
  const clientIds = (clients ?? []).map((c: { id: string }) => c.id);
  if (clientIds.length === 0) return [];
  const { data: jobs, error: jErr } = await supabase
    .from("jobs")
    .select("*")
    .in("client_id", clientIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (jErr) throw new Error(jErr.message);
  return (jobs ?? []) as Job[];
}

export async function countClientsLinkedToAccount(accountId: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("source_account_id", accountId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Clients with `source_account_id` = this corporate account. */
export async function listClientsLinkedToAccount(accountId: string): Promise<Client[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("source_account_id", accountId)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Client[];
}

/** Invoices whose `job_reference` matches any of the given job references. */
export async function listInvoicesForJobReferences(refs: string[]): Promise<Invoice[]> {
  const uniq = [...new Set(refs.filter(Boolean))];
  if (uniq.length === 0) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .in("job_reference", uniq)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data ?? []) as Invoice[];
}
