import { getSupabase } from "./base";
import type { InternalCost, SelfBill, WorkforcePayoutBreakdown } from "@/types/database";
import { getPayPeriodBounds, computeNextDueDate } from "@/lib/workforce-pay-schedule";
import { isWorkforceCostActive } from "@/lib/workforce-lifecycle";
import { buildPayoutBreakdown, calculateOwnerJobCommission } from "./workforce-commission";

function clampMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type WorkforceSelfBillRow = Pick<
  InternalCost,
  | "id"
  | "payee_name"
  | "amount"
  | "pay_frequency"
  | "payment_day_of_month"
  | "due_date"
  | "profile_id"
  | "commission_enabled"
  | "commission_rate_percent"
  | "commission_basis"
  | "lifecycle_stage"
>;

export async function ensureWorkforceSelfBillForPeriod(
  internalCostId: string,
  anchorDate: Date = new Date(),
): Promise<SelfBill | null> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("payroll_internal_costs")
    .select(
      "id, payee_name, amount, pay_frequency, payment_day_of_month, due_date, profile_id, commission_enabled, commission_rate_percent, commission_basis, lifecycle_stage",
    )
    .eq("id", internalCostId)
    .maybeSingle();
  if (error) throw error;
  if (!row || !isWorkforceCostActive(row.lifecycle_stage)) return null;

  const person = row as WorkforceSelfBillRow;
  const fixedPay = clampMoney(Math.max(0, Number(person.amount) || 0));
  const period = getPayPeriodBounds(person.pay_frequency, anchorDate);

  let commission = { basisTotal: 0, commissionAmount: 0, jobs: [] as { job_id: string; reference: string; revenue: number; gross_profit: number; commission: number }[] };
  if (person.commission_enabled && person.profile_id && person.commission_rate_percent != null && person.commission_basis) {
    commission = await calculateOwnerJobCommission({
      profileId: person.profile_id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      commissionRatePercent: person.commission_rate_percent,
      commissionBasis: person.commission_basis,
    });
  }

  const payoutBreakdown: WorkforcePayoutBreakdown | null =
    person.commission_enabled && person.commission_basis && person.commission_rate_percent != null
      ? buildPayoutBreakdown({
          fixedPay,
          commission,
          commissionBasis: person.commission_basis,
          commissionRatePercent: person.commission_rate_percent,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        })
      : null;

  const netPayout = clampMoney(fixedPay + commission.commissionAmount);
  const reference = `SB-INT-${period.weekLabel}-${person.id.replace(/-/g, "").slice(0, 8)}`;

  const payload = {
    reference,
    partner_name: (person.payee_name ?? "Internal").trim() || "Internal",
    period: period.weekStart.slice(0, 7),
    bill_origin: "internal" as const,
    internal_cost_id: person.id,
    partner_id: null,
    week_start: period.weekStart,
    week_end: period.weekEnd,
    week_label: period.weekLabel,
    payment_cadence: person.pay_frequency ?? "monthly",
    jobs_count: commission.jobs.length,
    job_value: fixedPay,
    materials: 0,
    commission: commission.commissionAmount,
    net_payout: netPayout,
    status: "pending_review" as const,
    due_date: person.due_date?.trim() || null,
    payout_breakdown: payoutBreakdown,
  };

  const { data: existing } = await supabase
    .from("self_bills")
    .select("id, status")
    .eq("bill_origin", "internal")
    .eq("internal_cost_id", person.id)
    .eq("week_start", period.weekStart)
    .maybeSingle();

  if (existing && (existing as { status: string }).status !== "paid") {
    const { data: updated, error: upErr } = await supabase
      .from("self_bills")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (upErr) throw upErr;
    return updated as SelfBill;
  }
  if (existing) return existing as SelfBill;

  const { data: inserted, error: insErr } = await supabase.from("self_bills").insert(payload).select("*").single();
  if (insErr) throw insErr;
  return inserted as SelfBill;
}

export async function generateWorkforceSelfBillsForDueWeek(anchorDate: Date = new Date()): Promise<SelfBill[]> {
  const { weekStart, weekEnd } = getPayPeriodBounds("weekly", anchorDate);
  const { data, error } = await getSupabase()
    .from("payroll_internal_costs")
    .select("id")
    .gte("due_date", weekStart)
    .lte("due_date", weekEnd)
    .gt("amount", 0);
  if (error) throw error;

  const out: SelfBill[] = [];
  for (const row of data ?? []) {
    const bill = await ensureWorkforceSelfBillForPeriod(row.id, anchorDate);
    if (bill) out.push(bill);
  }
  return out;
}

export async function advanceWorkforceDueDateAfterPayment(internalCostId: string): Promise<void> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("payroll_internal_costs")
    .select("pay_frequency, payment_day_of_month, due_date")
    .eq("id", internalCostId)
    .maybeSingle();
  if (!data) return;

  const nextDue = computeNextDueDate(
    data.pay_frequency,
    data.payment_day_of_month,
    data.due_date ? new Date(data.due_date) : new Date(),
  );

  await supabase
    .from("payroll_internal_costs")
    .update({ due_date: nextDue, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", internalCostId);
}
