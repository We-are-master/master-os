import { getSupabase } from "./base";
import type { CommissionRun, CommissionRunItem, CommissionTier, CommissionPoolShare } from "@/types/database";
import { listCommissionTiers, listCommissionPoolShares, getCurrentMonthRevenue } from "./tiers";
import { listTeamMembers } from "./teams";

export async function listCommissionRuns(): Promise<CommissionRun[]> {
  const { data, error } = await getSupabase()
    .from("commission_runs")
    .select("*")
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommissionRun[];
}

export async function getCommissionRunWithItems(runId: string): Promise<{ run: CommissionRun; items: CommissionRunItem[] }> {
  const supabase = getSupabase();
  const { data: run, error: runErr } = await supabase.from("commission_runs").select("*").eq("id", runId).single();
  if (runErr || !run) throw new Error("Commission run not found");

  const { data: rows, error: itemsErr } = await supabase
    .from("commission_run_items")
    .select("*, team_members(full_name)")
    .eq("commission_run_id", runId);
  if (itemsErr) throw itemsErr;

  const items = (rows ?? []).map((r: CommissionRunItem & { team_members: { full_name: string } | null }) => ({
    ...r,
    team_member_name: r.team_members?.full_name,
    team_members: undefined,
  })) as CommissionRunItem[];

  return { run: run as CommissionRun, items };
}

/** Paid invoices total in date range (for tier calculation). */
async function getPaidInvoicesTotal(from: string, to: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("invoices")
    .select("amount")
    .eq("status", "paid")
    .gte("paid_date", from)
    .lte("paid_date", to);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number(r.amount), 0);
}

/** Compute commission for a single tier band. */
function tierCommission(revenue: number, tiers: CommissionTier[]): { totalCommission: number; breakdown: Record<number, number> } {
  const sorted = [...tiers].sort((a, b) => a.breakeven_amount - b.breakeven_amount);
  let total = 0;
  const breakdown: Record<number, number> = {};
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const bandStart = prev.breakeven_amount;
    const bandEnd = curr.breakeven_amount;
    if (revenue <= bandStart) break;
    const inBand = Math.min(revenue, bandEnd) - bandStart;
    const rate = prev.rate_percent / 100;
    const commission = inBand * rate;
    total += commission;
    breakdown[curr.tier_number] = (breakdown[curr.tier_number] ?? 0) + commission;
  }
  if (revenue > sorted[sorted.length - 1].breakeven_amount) {
    const last = sorted[sorted.length - 1];
    const inBand = revenue - last.breakeven_amount;
    const commission = inBand * (last.rate_percent / 100);
    total += commission;
    breakdown[last.tier_number] = (breakdown[last.tier_number] ?? 0) + commission;
  }
  return { totalCommission: total, breakdown };
}

/** Create a new commission run (draft) and populate items from tiers + pool. */
export async function createCommissionRun(periodStart: string, periodEnd: string): Promise<CommissionRun> {
  const [tiers, poolShares, members, revenue] = await Promise.all([
    listCommissionTiers(),
    listCommissionPoolShares(),
    listTeamMembers(),
    getPaidInvoicesTotal(periodStart, periodEnd),
  ]);

  const { totalCommission, breakdown } = tierCommission(revenue, tiers);
  const shareByRole: Record<string, number> = {};
  for (const p of poolShares) {
    shareByRole[p.role] = (p.share_percent / 100) * totalCommission;
  }

  const amShare = (shareByRole["am"] ?? 0) / Math.max(1, members.filter((m) => m.role === "am").length);
  const bizShare = (shareByRole["biz_dev"] ?? 0) / Math.max(1, members.filter((m) => m.role === "biz_dev").length);
  const headOpsShare = shareByRole["head_ops"] ?? 0;

  const supabase = getSupabase();
  const { data: run, error: runErr } = await supabase
    .from("commission_runs")
    .insert({ period_start: periodStart, period_end: periodEnd, status: "draft" })
    .select()
    .single();
  if (runErr) throw runErr;

  const items: Omit<CommissionRunItem, "id" | "created_at" | "updated_at" | "team_member_name">[] = [];
  for (const m of members) {
    if (m.status !== "active") continue;
    let commission_amount = 0;
    if (m.role === "am") commission_amount = amShare;
    else if (m.role === "biz_dev") commission_amount = bizShare;
    else if (m.role === "head_ops") commission_amount = headOpsShare;
    items.push({
      commission_run_id: (run as CommissionRun).id,
      team_member_id: m.id,
      base_salary: m.base_salary ?? undefined,
      commission_amount,
      tier_detail: { revenue, breakdown },
    });
  }

  if (items.length > 0) {
    await supabase.from("commission_run_items").insert(items.map(({ commission_run_id, team_member_id, base_salary, commission_amount, tier_detail }) => ({
      commission_run_id,
      team_member_id,
      base_salary,
      commission_amount,
      tier_detail,
    })));
  }

  return run as CommissionRun;
}

export async function updateCommissionRunItem(
  itemId: string,
  updates: Partial<Pick<CommissionRunItem, "commission_amount">>
): Promise<void> {
  const { error } = await getSupabase()
    .from("commission_run_items")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

export async function approveCommissionRun(runId: string, approvedById: string): Promise<void> {
  const { error } = await getSupabase()
    .from("commission_runs")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_by_id: approvedById, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw error;
}
