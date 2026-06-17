import { getSupabase } from "./base";
import type { AccountLegacyYearlyStat } from "@/types/database";

export async function listAccountLegacyYearlyStats(
  accountId: string,
): Promise<AccountLegacyYearlyStat[]> {
  const id = accountId?.trim();
  if (!id) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_legacy_yearly_stats")
    .select("*")
    .eq("account_id", id)
    .is("deleted_at", null)
    .order("year", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AccountLegacyYearlyStat[];
}

export interface LegacyYearlyStatUpsert {
  account_id: string;
  year: number;
  completed_jobs_count: number;
  revenue_gbp: number;
  notes?: string | null;
}

export async function upsertAccountLegacyYearlyStat(
  input: LegacyYearlyStatUpsert,
): Promise<AccountLegacyYearlyStat> {
  const supabase = getSupabase();
  const accountId = input.account_id.trim();
  const year = Math.trunc(input.year);
  const completedJobs = Math.max(0, Math.trunc(input.completed_jobs_count));
  const revenue = Math.max(0, Number(input.revenue_gbp) || 0);
  const notes = input.notes?.trim() || null;
  const now = new Date().toISOString();

  const { data: existing, error: findErr } = await supabase
    .from("account_legacy_yearly_stats")
    .select("id")
    .eq("account_id", accountId)
    .eq("year", year)
    .is("deleted_at", null)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);

  if (existing?.id) {
    const { data, error } = await supabase
      .from("account_legacy_yearly_stats")
      .update({
        completed_jobs_count: completedJobs,
        revenue_gbp: revenue,
        notes,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as AccountLegacyYearlyStat;
  }

  const { data, error } = await supabase
    .from("account_legacy_yearly_stats")
    .insert({
      account_id: accountId,
      year,
      completed_jobs_count: completedJobs,
      revenue_gbp: revenue,
      notes,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AccountLegacyYearlyStat;
}

export async function deleteAccountLegacyYearlyStat(id: string): Promise<void> {
  const rowId = id?.trim();
  if (!rowId) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("account_legacy_yearly_stats")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", rowId);
  if (error) throw new Error(error.message);
}

/** Sum of legacy revenue_gbp per account (active rows only). */
export async function fetchLegacyRevenueTotalsByAccount(): Promise<Record<string, number>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_legacy_yearly_stats")
    .select("account_id, revenue_gbp")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const totals: Record<string, number> = {};
  for (const row of data ?? []) {
    const accountId = String((row as { account_id: string }).account_id);
    totals[accountId] =
      (totals[accountId] ?? 0) + Number((row as { revenue_gbp: number }).revenue_gbp ?? 0);
  }
  return totals;
}
