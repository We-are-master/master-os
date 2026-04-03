import { getSupabase } from "./base";
import type { InternalCost, SelfBill } from "@/types/database";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";

export type InternalSelfBillLine = { kind: "deduction" | "extra"; label: string; amount: number };

function clampMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listInternalSelfBillsForCost(internalCostId: string): Promise<SelfBill[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("self_bills")
    .select("*")
    .eq("bill_origin", "internal")
    .eq("internal_cost_id", internalCostId)
    .order("week_start", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SelfBill[];
}

export type CreateInternalSelfBillInput = {
  internalCost: Pick<InternalCost, "id" | "payee_name" | "pay_frequency">;
  /** Gross pay for this period (before deductions, before extras). */
  baseAmount: number;
  lines: InternalSelfBillLine[];
  /** Anchor date inside the pay week (defaults to today). */
  anchorDate?: Date;
};

/**
 * Creates a self-bill row for an internal contractor/employee payment run.
 * Uses job_value = base, commission = sum(deductions), materials = sum(extras), net = base + extras - deductions.
 */
export async function createInternalSelfBill(input: CreateInternalSelfBillInput): Promise<SelfBill> {
  const { internalCost, baseAmount, lines } = input;
  const anchor = input.anchorDate ?? new Date();
  const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(anchor);

  const base = clampMoney(Math.max(0, Number(baseAmount) || 0));
  let deductions = 0;
  let extras = 0;
  for (const row of lines) {
    const a = clampMoney(Math.abs(Number(row.amount) || 0));
    if (row.kind === "deduction") deductions += a;
    else extras += a;
  }
  deductions = clampMoney(deductions);
  extras = clampMoney(extras);
  const net = clampMoney(base + extras - deductions);

  const short = internalCost.id.replace(/-/g, "").slice(0, 8);
  const reference = `SB-INT-${weekLabel}-${short}`;

  const cadence = internalCost.pay_frequency ?? "monthly";

  const supabase = getSupabase();
  const row = {
    reference,
    partner_name: (internalCost.payee_name ?? "Internal").trim() || "Internal",
    period: weekStart.slice(0, 7),
    bill_origin: "internal" as const,
    internal_cost_id: internalCost.id,
    partner_id: null,
    week_start: weekStart,
    week_end: weekEnd,
    week_label: weekLabel,
    payment_cadence: cadence,
    jobs_count: 0,
    job_value: base,
    materials: extras,
    commission: deductions,
    net_payout: net,
    status: "pending_review" as const,
  };

  const { data, error } = await supabase.from("self_bills").insert(row).select("*").single();
  if (error) throw error;
  return data as SelfBill;
}
