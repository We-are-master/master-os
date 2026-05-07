import { queryList, getSupabase, softDeleteById, type ListParams, type ListResult } from "./base";
import type { Client } from "@/types/database";
import { isUuid } from "@/lib/utils";

export async function listClients(params: ListParams): Promise<ListResult<Client>> {
  return queryList<Client>("clients", params, {
    searchColumns: ["full_name", "email", "phone", "city", "address"],
    defaultSort: "created_at",
  });
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Client | null;
}

/**
 * Matches quote list / drawer “linked account” resolution (`batchResolveLinkedAccountLabels`):
 * `clients.source_account_id`, else exact `accounts.email`, else ilike fallback.
 */
export async function resolveCorporateAccountIdForClient(clientId: string): Promise<string | null> {
  const id = clientId.trim();
  if (!id) return null;
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("clients")
    .select("source_account_id, email")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !row) return null;
  const sid = (row as { source_account_id?: string | null }).source_account_id?.trim();
  if (sid) return sid;
  const email = (row as { email?: string | null }).email?.trim();
  if (!email) return null;
  const { data: exact } = await supabase.from("accounts").select("id").eq("email", email).is("deleted_at", null).maybeSingle();
  const exactId = (exact as { id?: string } | null)?.id?.trim();
  if (exactId) return exactId;
  const { data: loose } = await supabase.from("accounts").select("id").ilike("email", email).is("deleted_at", null).maybeSingle();
  return (loose as { id?: string } | null)?.id?.trim() || null;
}

export async function createClient(data: Omit<Client, "id" | "created_at" | "updated_at" | "total_spent" | "jobs_count" | "last_job_date">): Promise<Client> {
  const supabase = getSupabase();
  const rawSid = data.source_account_id;
  const trimmedSid = rawSid == null || rawSid === "" ? "" : String(rawSid).trim();
  if (trimmedSid !== "" && !isUuid(trimmedSid)) {
    throw new Error("Invalid linked account ID (must be an account UUID).");
  }
  const payload = {
    ...data,
    source_account_id: trimmedSid === "" ? null : trimmedSid,
  };
  const { data: result, error } = await supabase
    .from("clients")
    .insert(payload)
    .select()
    .single();
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("clients_source_account_id_fkey")) {
      throw new Error(
        "Linked account is invalid for this database. Either pick an account that exists in Accounts, or run migration 032 (clients.source_account_id must reference accounts, not client_source_accounts)."
      );
    }
    throw new Error(msg);
  }
  return result as Client;
}

export async function updateClient(id: string, data: Partial<Client>): Promise<Client> {
  const supabase = getSupabase();
  const payload: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue;
    if (key === "source_account_id") {
      if (val === null || val === "") {
        payload.source_account_id = null;
      } else {
        const t = String(val).trim();
        if (!t) payload.source_account_id = null;
        else if (!isUuid(t)) throw new Error("Invalid linked account ID (must be an account UUID).");
        else payload.source_account_id = t;
      }
      continue;
    }
    payload[key] = val;
  }

  const { data: result, error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result as Client;
}

export async function deleteClient(id: string): Promise<void> {
  await softDeleteById("clients", id);
}

/** Contacts (clients) belonging to a corporate account — used for property site managers & portal. */
export async function listContactsForAccount(accountId: string): Promise<Client[]> {
  if (!accountId?.trim()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("source_account_id", accountId.trim())
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Client[];
}
