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
    contract_url: input.contract_url?.trim() || null,
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
  if (next.contract_url !== undefined) {
    const t = typeof next.contract_url === "string" ? next.contract_url.trim() : "";
    next.contract_url = t.length > 0 ? t : null;
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

/** Jobs whose client is linked to this corporate account.
 *  Uses a server-side RPC (JOIN in Postgres) to avoid huge IN() URLs when
 *  there are many linked clients. Falls back to client_name ILIKE match. */
export async function listJobsLinkedToAccount(
  accountId: string,
  companyName?: string,
): Promise<Job[]> {
  const supabase = getSupabase();

  // Resolve company name if not supplied
  let name = companyName ?? "";
  if (!name) {
    const { data: acctData } = await supabase
      .from("accounts")
      .select("company_name")
      .eq("id", accountId)
      .maybeSingle();
    name = (acctData as { company_name?: string } | null)?.company_name ?? "";
  }

  // Use RPC to do the JOIN server-side — avoids URL length 400 errors with many clients
  const { data, error } = await supabase.rpc("get_jobs_for_account", {
    p_account_id: accountId,
    p_company_name: name,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function countClientsLinkedToAccount(accountId: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("source_account_id", accountId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Paginated client list for an account drawer.
 *  Tries FK (`source_account_id`) first; falls back to `full_name ILIKE %name%`. */
export async function listClientsLinkedToAccountPaged(
  accountId: string,
  companyName: string,
  page: number,
  pageSize: number,
): Promise<{ rows: Client[]; total: number; usedFallback: boolean }> {
  const supabase = getSupabase();
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // Primary: FK-based with exact count
  const { data: fkData, count: fkCount, error: fkErr } = await supabase
    .from("clients")
    .select("*", { count: "exact" })
    .eq("source_account_id", accountId)
    .is("deleted_at", null)
    .order("full_name")
    .range(from, to);
  if (fkErr) throw new Error(fkErr.message);

  if ((fkCount ?? 0) > 0 || page > 0) {
    return { rows: (fkData ?? []) as Client[], total: fkCount ?? 0, usedFallback: false };
  }

  // Fallback: name-based
  if (!companyName) return { rows: [], total: 0, usedFallback: false };

  const { data: nameData, count: nameCount, error: nameErr } = await supabase
    .from("clients")
    .select("*", { count: "exact" })
    .ilike("full_name", `%${companyName}%`)
    .is("deleted_at", null)
    .order("full_name")
    .range(from, to);
  if (nameErr) throw new Error(nameErr.message);

  return { rows: (nameData ?? []) as Client[], total: nameCount ?? 0, usedFallback: true };
}

/** Clients with `source_account_id` = this corporate account.
 *  Falls back to matching `full_name` ≈ account company name when no FK link exists.
 *  Accepts optional `companyName` to avoid a redundant account fetch. */
export async function listClientsLinkedToAccount(
  accountId: string,
  companyName?: string,
): Promise<Client[]> {
  const supabase = getSupabase();

  // 1. Clients linked via FK
  const { data: byFk, error: fkErr } = await supabase
    .from("clients")
    .select("*")
    .eq("source_account_id", accountId)
    .is("deleted_at", null)
    .order("full_name");
  if (fkErr) throw new Error(fkErr.message);

  // 2. If caller didn't supply company name, fetch it once
  let name = companyName ?? "";
  if (!name) {
    const { data: acctData } = await supabase
      .from("accounts")
      .select("company_name")
      .eq("id", accountId)
      .maybeSingle();
    name = (acctData as { company_name?: string } | null)?.company_name ?? "";
  }

  // 3. Fallback: clients whose full_name contains the account name
  const fallback: Client[] = [];
  if (name) {
    const { data: byName } = await supabase
      .from("clients")
      .select("*")
      .ilike("full_name", `%${name}%`)
      .is("deleted_at", null)
      .order("full_name");
    fallback.push(...((byName ?? []) as Client[]));
  }

  // Merge & deduplicate
  const seen = new Set<string>();
  const merged: Client[] = [];
  for (const c of [...(byFk ?? []), ...fallback]) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      merged.push(c);
    }
  }
  return merged.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
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
