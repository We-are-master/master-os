import { getSupabase } from "./base";
import type { CommissionTier, CommissionPoolShare } from "@/types/database";

export async function listCommissionTiers(): Promise<CommissionTier[]> {
  const { data, error } = await getSupabase()
    .from("commission_tiers")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("tier_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommissionTier[];
}

export async function updateCommissionTier(
  id: string,
  updates: Partial<Pick<CommissionTier, "breakeven_amount" | "rate_percent" | "sort_order">>
): Promise<void> {
  const { error } = await getSupabase()
    .from("commission_tiers")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function createCommissionTier(input: {
  tier_number: number;
  breakeven_amount: number;
  rate_percent: number;
  sort_order?: number;
}): Promise<CommissionTier> {
  const { data, error } = await getSupabase()
    .from("commission_tiers")
    .insert({
      tier_number: input.tier_number,
      breakeven_amount: input.breakeven_amount,
      rate_percent: input.rate_percent,
      sort_order: input.sort_order ?? input.tier_number,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CommissionTier;
}

export async function listCommissionPoolShares(): Promise<CommissionPoolShare[]> {
  const { data, error } = await getSupabase()
    .from("commission_pool_shares")
    .select("*")
    .order("role", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommissionPoolShare[];
}

export async function updateCommissionPoolShare(
  id: string,
  updates: Partial<Pick<CommissionPoolShare, "share_percent">>
): Promise<void> {
  const { error } = await getSupabase()
    .from("commission_pool_shares")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Ensures default commission tiers + pool shares exist on fresh databases.
 * Safe to call repeatedly.
 */
export async function ensureCommissionConfigDefaults(): Promise<void> {
  const supabase = getSupabase();
  const [tiersRes, poolRes] = await Promise.all([
    supabase.from("commission_tiers").select("id", { count: "exact", head: true }),
    supabase.from("commission_pool_shares").select("id", { count: "exact", head: true }),
  ]);
  if (tiersRes.error) throw tiersRes.error;
  if (poolRes.error) throw poolRes.error;

  if ((tiersRes.count ?? 0) === 0) {
    const { error } = await supabase.from("commission_tiers").insert([
      { tier_number: 1, breakeven_amount: 0, rate_percent: 0, sort_order: 1 },
      { tier_number: 2, breakeven_amount: 35000, rate_percent: 10, sort_order: 2 },
      { tier_number: 3, breakeven_amount: 40000, rate_percent: 20, sort_order: 3 },
    ]);
    if (error) throw error;
  }

  if ((poolRes.count ?? 0) === 0) {
    const { error } = await supabase.from("commission_pool_shares").insert([
      { role: "head_ops", share_percent: 40 },
      { role: "am", share_percent: 40 },
      { role: "biz_dev", share_percent: 20 },
    ]);
    if (error) throw error;
  }
}

/** Current month paid invoice total (for tier comparison) */
export async function getCurrentMonthRevenue(): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const { data, error } = await getSupabase()
    .from("invoices")
    .select("amount")
    .eq("status", "paid")
    .gte("paid_date", start.toISOString().split("T")[0])
    .lt("paid_date", end.toISOString().split("T")[0]);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
}
