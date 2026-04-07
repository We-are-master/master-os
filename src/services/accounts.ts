import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Account, Client, Invoice, Job } from "@/types/database";

const ACCOUNT_OWNER_MIGRATION_HINT =
  "This database is missing the account owner column or migration — run migration 107 (supabase/migrations/107_accounts_account_owner_id.sql), or clear Account owner and save.";
const ACCOUNT_FINANCE_EMAIL_MIGRATION_HINT =
  "This database is missing the finance email column — run migration 121 (supabase/migrations/121_accounts_finance_email.sql), or clear Finance email and save.";

function wantsAccountOwnerId(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const t = typeof value === "string" ? value.trim() : "";
  return t.length > 0;
}

function wantsFinanceEmail(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const t = typeof value === "string" ? value.trim() : "";
  return t.length > 0;
}

type AccountInsert = Omit<Account, "id" | "created_at" | "total_revenue" | "active_jobs">;

function normalizeAccountInsert(input: AccountInsert): AccountInsert {
  /** Owner is stored only as `account_owner_id` → `profiles.id`; do not persist legacy `owner_name`. */
  const { owner_name: _ignoredOwnerName, ...inputRest } = input;
  const account_owner_id =
    inputRest.account_owner_id === undefined
      ? undefined
      : inputRest.account_owner_id && String(inputRest.account_owner_id).trim()
        ? String(inputRest.account_owner_id).trim()
        : null;
  return {
    ...inputRest,
    ...(account_owner_id !== undefined ? { account_owner_id } : {}),
    email: inputRest.email.trim().toLowerCase(),
    finance_email: inputRest.finance_email?.trim().toLowerCase() || null,
    company_name: inputRest.company_name.trim(),
    contact_name: inputRest.contact_name.trim(),
    address: inputRest.address?.trim() || null,
    crn: inputRest.crn?.trim() || null,
    contact_number: inputRest.contact_number?.trim() || null,
    contract_url: inputRest.contract_url?.trim() || null,
  };
}

function normalizeAccountPatch(input: Partial<Account>): Partial<Account> {
  const next = { ...input };
  delete (next as { owner_name?: unknown }).owner_name;
  if (next.email !== undefined) next.email = next.email.trim().toLowerCase();
  if (next.finance_email !== undefined) {
    const t = typeof next.finance_email === "string" ? next.finance_email.trim() : "";
    next.finance_email = t.length > 0 ? t.toLowerCase() : null;
  }
  if (next.company_name !== undefined) next.company_name = next.company_name.trim();
  if (next.contact_name !== undefined) next.contact_name = next.contact_name.trim();
  if (next.account_owner_id !== undefined) {
    const t = typeof next.account_owner_id === "string" ? next.account_owner_id.trim() : "";
    next.account_owner_id = t.length > 0 ? t : null;
  }
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

/** Maps Postgres / PostgREST errors to a clear message (Supabase errors are plain objects, not `Error`). */
export function formatAccountDbError(error: unknown): Error {
  const rawMsg =
    error && typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : "";
  const code =
    error && typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";

  if (rawMsg || code) {
    if (code === "23505" || rawMsg.includes("duplicate key") || rawMsg.includes("unique constraint")) {
      if (rawMsg.includes("uq_accounts_email_active")) {
        return new Error("An account with this email already exists.");
      }
      if (rawMsg.includes("uq_accounts_company_name_active")) {
        return new Error("An account with this company name already exists.");
      }
      if (rawMsg.toLowerCase().includes("email")) {
        return new Error("An account with this email already exists.");
      }
      if (rawMsg.toLowerCase().includes("company_name")) {
        return new Error("An account with this company name already exists.");
      }
    }
    if (code === "23503" || rawMsg.includes("foreign key constraint") || rawMsg.includes("violates foreign key")) {
      if (rawMsg.includes("account_owner_id") || rawMsg.includes("profiles")) {
        return new Error(
          "Account owner must be a valid platform user. Clear the field or pick someone from the list.",
        );
      }
    }
    if (
      rawMsg.includes("account_owner_id") &&
      (rawMsg.includes("does not exist") || rawMsg.includes("schema cache") || rawMsg.includes("Could not find"))
    ) {
      return new Error(
        "This database is missing the account owner column or migration — run migration 107, or clear Account owner and save.",
      );
    }
    if (rawMsg) return new Error(rawMsg);
  }

  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "Database error");
}

export async function listAccounts(params: ListParams): Promise<ListResult<Account>> {
  return queryList<Account>("accounts", params, {
    searchColumns: ["company_name", "contact_name", "email", "finance_email", "industry"],
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
  const first = await supabase.from("accounts").insert(payload).select().single();
  if (!first.error) return first.data as Account;

  if (
    isSupabaseMissingColumnError(first.error, "account_owner_id") &&
    Object.prototype.hasOwnProperty.call(payload, "account_owner_id")
  ) {
    if (wantsAccountOwnerId(payload.account_owner_id)) {
      throw new Error(ACCOUNT_OWNER_MIGRATION_HINT);
    }
    const { account_owner_id: _a, ...rest } = payload;
    const retry = await supabase.from("accounts").insert(rest).select().single();
    if (retry.error) throw formatAccountDbError(retry.error);
    return retry.data as Account;
  }

  if (
    isSupabaseMissingColumnError(first.error, "finance_email") &&
    Object.prototype.hasOwnProperty.call(payload, "finance_email")
  ) {
    if (wantsFinanceEmail(payload.finance_email)) {
      throw new Error(ACCOUNT_FINANCE_EMAIL_MIGRATION_HINT);
    }
    const { finance_email: _f, ...rest } = payload;
    const retry = await supabase.from("accounts").insert(rest).select().single();
    if (retry.error) throw formatAccountDbError(retry.error);
    return retry.data as Account;
  }

  throw formatAccountDbError(first.error);
}

export async function updateAccount(id: string, input: Partial<Account>): Promise<Account> {
  const supabase = getSupabase();
  const payload = normalizeAccountPatch(input);
  const first = await supabase.from("accounts").update(payload).eq("id", id).select().single();
  if (!first.error) return first.data as Account;

  if (
    isSupabaseMissingColumnError(first.error, "account_owner_id") &&
    Object.prototype.hasOwnProperty.call(payload, "account_owner_id")
  ) {
    if (wantsAccountOwnerId(payload.account_owner_id)) {
      throw new Error(ACCOUNT_OWNER_MIGRATION_HINT);
    }
    const { account_owner_id: _a, ...rest } = payload;
    const retry = await supabase.from("accounts").update(rest).eq("id", id).select().single();
    if (retry.error) throw formatAccountDbError(retry.error);
    return retry.data as Account;
  }

  if (
    isSupabaseMissingColumnError(first.error, "finance_email") &&
    Object.prototype.hasOwnProperty.call(payload, "finance_email")
  ) {
    if (wantsFinanceEmail(payload.finance_email)) {
      throw new Error(ACCOUNT_FINANCE_EMAIL_MIGRATION_HINT);
    }
    const { finance_email: _f, ...rest } = payload;
    const retry = await supabase.from("accounts").update(rest).eq("id", id).select().single();
    if (retry.error) throw formatAccountDbError(retry.error);
    return retry.data as Account;
  }

  throw formatAccountDbError(first.error);
}

/**
 * When a client has no corporate account, create one from the client name and link it.
 * Idempotent if `source_account_id` is already set. Used so revenue rollups always have an account id.
 */
export async function ensureSourceAccountForClient(
  supabase: ReturnType<typeof getSupabase>,
  clientId: string,
): Promise<string | null> {
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("id, full_name, email, source_account_id")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (cErr || !client) return null;

  const row = client as {
    id: string;
    full_name: string;
    email?: string | null;
    source_account_id?: string | null;
  };
  if (row.source_account_id) {
    const { data: active } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", row.source_account_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (active?.id) return row.source_account_id;
    const { error: clearErr } = await supabase
      .from("clients")
      .update({ source_account_id: null })
      .eq("id", clientId);
    if (clearErr) return null;
  }

  const company = row.full_name?.trim() || "Client";
  const safeEmail = (
    row.email?.trim() || `linked+${row.id.replace(/-/g, "")}@client-auto.master-os.internal`
  ).toLowerCase();

  async function linkAccount(accountId: string): Promise<string> {
    const { error: uErr } = await supabase.from("clients").update({ source_account_id: accountId }).eq("id", clientId);
    if (uErr) throw new Error(uErr.message);
    return accountId;
  }

  try {
    const account = await createAccount({
      company_name: company,
      contact_name: company,
      email: safeEmail,
      finance_email: null,
      address: null,
      crn: null,
      contact_number: null,
      industry: "General",
      status: "onboarding",
      credit_limit: 0,
      payment_terms: "Net 30",
      logo_url: null,
      contract_url: null,
    });
    return await linkAccount(account.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("email") || msg.includes("company name") || msg.includes("duplicate")) {
      const { data: byEmail } = await supabase
        .from("accounts")
        .select("id")
        .eq("email", safeEmail)
        .is("deleted_at", null)
        .maybeSingle();
      if (byEmail?.id) return await linkAccount((byEmail as { id: string }).id);

      const { data: byCo } = await supabase
        .from("accounts")
        .select("id")
        .eq("company_name", company)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (byCo?.id) return await linkAccount((byCo as { id: string }).id);
    }
    return null;
  }
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
