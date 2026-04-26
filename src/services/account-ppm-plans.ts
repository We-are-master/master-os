import { getSupabase, type ListParams, type ListResult } from "./base";
import { sanitizePostgrestValue } from "@/lib/supabase/sanitize";
import type { AccountPpmPlan, PpmFrequency, PpmStatus } from "@/types/database";

const FREQUENCY_DAYS: Record<PpmFrequency, number | null> = {
  weekly:       7,
  fortnightly:  14,
  monthly:      30,
  quarterly:    90,
  semi_annual:  182,
  yearly:       365,
  custom:       null,
};

export async function listAccountPpmPlans(
  params: ListParams & {
    accountId?: string;
    propertyId?: string;
    status?: PpmStatus;
  },
): Promise<ListResult<AccountPpmPlan>> {
  const supabase = getSupabase();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("account_ppm_plans")
    .select("*", { count: "exact" })
    .is("deleted_at", null);

  const aid = params.accountId?.trim();
  if (aid) query = query.eq("account_id", aid);
  const pid = params.propertyId?.trim();
  if (pid) query = query.eq("property_id", pid);
  if (params.status) query = query.eq("status", params.status);

  if (params.search) {
    const safeSearch = sanitizePostgrestValue(params.search);
    if (safeSearch) {
      query = query.ilike("name", `%${safeSearch}%`);
    }
  }

  const sortCol = params.sortBy ?? "next_visit_date";
  const sortDir = params.sortDir ?? "asc";
  query = query.order(sortCol, { ascending: sortDir === "asc", nullsFirst: false });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []) as AccountPpmPlan[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

export async function getAccountPpmPlan(id: string): Promise<AccountPpmPlan | null> {
  if (!id?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_ppm_plans")
    .select("*")
    .eq("id", id.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AccountPpmPlan | null;
}

export interface PpmPlanInsert {
  account_id: string;
  property_id?: string | null;
  catalog_service_id?: string | null;
  name: string;
  frequency: PpmFrequency;
  frequency_days?: number | null;
  next_visit_date?: string | null;
  notes?: string | null;
}

export async function createAccountPpmPlan(input: PpmPlanInsert): Promise<AccountPpmPlan> {
  const supabase = getSupabase();
  const computedDays =
    input.frequency === "custom" ? input.frequency_days ?? null : FREQUENCY_DAYS[input.frequency];

  const { data, error } = await supabase
    .from("account_ppm_plans")
    .insert({
      account_id:         input.account_id,
      property_id:        input.property_id ?? null,
      catalog_service_id: input.catalog_service_id ?? null,
      name:               input.name.trim(),
      frequency:          input.frequency,
      frequency_days:     computedDays,
      next_visit_date:    input.next_visit_date ?? null,
      notes:              input.notes?.trim() || null,
      status:             "active",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AccountPpmPlan;
}

export async function updateAccountPpmPlan(
  id: string,
  patch: Partial<PpmPlanInsert> & { status?: PpmStatus; last_visit_date?: string | null },
): Promise<AccountPpmPlan> {
  const supabase = getSupabase();
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.frequency && patch.frequency !== "custom" && patch.frequency_days === undefined) {
    next.frequency_days = FREQUENCY_DAYS[patch.frequency];
  }
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.notes !== undefined) next.notes = patch.notes?.trim() || null;

  const { data, error } = await supabase
    .from("account_ppm_plans")
    .update(next)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AccountPpmPlan;
}

export async function deleteAccountPpmPlan(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("account_ppm_plans")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
