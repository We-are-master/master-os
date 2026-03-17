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
