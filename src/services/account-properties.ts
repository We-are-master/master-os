import { getSupabase, type ListParams, type ListResult } from "./base";
import { sanitizePostgrestValue } from "@/lib/supabase/sanitize";
import type { AccountProperty, AccountPropertyDocument } from "@/types/database";

export async function listAccountProperties(
  params: ListParams & { accountId?: string },
): Promise<ListResult<AccountProperty>> {
  const supabase = getSupabase();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("account_properties")
    .select("*", { count: "exact" })
    .is("deleted_at", null);

  const aid = params.accountId?.trim();
  if (aid) query = query.eq("account_id", aid);

  const searchCols = ["name", "full_address", "property_type"];
  if (params.search) {
    const safeSearch = sanitizePostgrestValue(params.search);
    if (safeSearch) {
      const orConditions = searchCols.map((col) => `${col}.ilike.%${safeSearch}%`).join(",");
      query = query.or(orConditions);
    }
  }

  const sortCol = params.sortBy ?? "created_at";
  const sortDir = params.sortDir ?? "desc";
  query = query.order(sortCol, { ascending: sortDir === "asc" });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []) as AccountProperty[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

export async function getAccountProperty(id: string): Promise<AccountProperty | null> {
  if (!id?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_properties")
    .select("*")
    .eq("id", id.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AccountProperty | null;
}

export async function createAccountProperty(
  row: Omit<AccountProperty, "id" | "created_at" | "updated_at" | "deleted_at" | "deleted_by">,
): Promise<AccountProperty> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("account_properties").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as AccountProperty;
}

export async function updateAccountProperty(
  id: string,
  patch: Partial<AccountProperty>,
): Promise<AccountProperty> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_properties")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as AccountProperty;
}

export async function softDeleteAccountProperty(id: string, deletedBy?: string): Promise<void> {
  const supabase = getSupabase();
  const payload: { deleted_at: string; deleted_by?: string } = {
    deleted_at: new Date().toISOString(),
  };
  if (deletedBy) payload.deleted_by = deletedBy;
  const { error } = await supabase.from("account_properties").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listPropertyDocuments(propertyId: string): Promise<AccountPropertyDocument[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_property_documents")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AccountPropertyDocument[];
}
