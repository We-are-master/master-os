import { format } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import type { InternalCost, SelfBill, SelfBillStatus, WorkforcePayoutBreakdown } from "@/types/database";
import {
  computeWorkforcePayDueDate,
  effectiveWorkforcePeriodStart,
  getPayPeriodBounds,
  computeNextDueDate,
  prorateMonthlyFixedPay,
  parseWorkforceStartDate,
  WORKFORCE_MONTHLY_PAY_DAY,
} from "@/lib/workforce-pay-schedule";
import { isWorkforceCostActive, WORKFORCE_COST_ACTIVE_OR_FILTER } from "@/lib/workforce-lifecycle";
import { buildPayoutBreakdown, calculateOwnerJobCommission } from "./workforce-commission";

function clampMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const UPDATABLE_SELF_BILL_STATUSES = new Set<SelfBillStatus>([
  "accumulating",
  "pending_review",
  "needs_attention",
  "ready_to_pay",
]);

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
  | "employment_type"
  | "payroll_profile"
  | "created_at"
>;

/** Monthly workforce: accumulating until month-end cutoff, then ready_to_pay for billing (pay day 5). */
function resolveWorkforceSelfBillStatus(anchorDate: Date, periodEnd: string): SelfBillStatus {
  const today = format(anchorDate, "yyyy-MM-dd");
  if (today >= periodEnd) return "ready_to_pay";
  return "accumulating";
}

export async function ensureWorkforceSelfBillForPeriod(
  internalCostId: string,
  anchorDate: Date = new Date(),
  supabase: SupabaseClient = getSupabase(),
): Promise<SelfBill | null> {
  const { data: row, error } = await supabase
    .from("payroll_internal_costs")
    .select(
      "id, payee_name, amount, pay_frequency, payment_day_of_month, due_date, profile_id, commission_enabled, commission_rate_percent, commission_basis, lifecycle_stage, employment_type, payroll_profile, created_at",
    )
    .eq("id", internalCostId)
    .maybeSingle();
  if (error) throw error;
  if (!row || !isWorkforceCostActive(row.lifecycle_stage)) return null;

  const person = row as WorkforceSelfBillRow;
  const payFrequency = person.pay_frequency ?? "monthly";
  const period = getPayPeriodBounds(payFrequency, anchorDate);
  const workforceStart = parseWorkforceStartDate(person.payroll_profile, person.created_at);
  const monthlyFixed = clampMoney(Math.max(0, Number(person.amount) || 0));
  const fixedPay =
    payFrequency === "monthly"
      ? prorateMonthlyFixedPay(monthlyFixed, period.periodStart, period.periodEnd, workforceStart)
      : monthlyFixed;

  const commissionPeriodStart = effectiveWorkforcePeriodStart(period.periodStart, workforceStart);

  let commission = {
    basisTotal: 0,
    commissionAmount: 0,
    jobs: [] as { job_id: string; reference: string; revenue: number; gross_profit: number; commission: number }[],
  };
  if (person.commission_enabled && person.profile_id && person.commission_rate_percent != null && person.commission_basis) {
    commission = await calculateOwnerJobCommission(
      {
        profileId: person.profile_id,
        periodStart: commissionPeriodStart,
        periodEnd: period.periodEnd,
        commissionRatePercent: person.commission_rate_percent,
        commissionBasis: person.commission_basis,
      },
      supabase,
    );
  }

  const payoutBreakdown: WorkforcePayoutBreakdown | null =
    person.commission_enabled && person.commission_basis && person.commission_rate_percent != null
      ? buildPayoutBreakdown({
          fixedPay,
          commission,
          commissionBasis: person.commission_basis,
          commissionRatePercent: person.commission_rate_percent,
          periodStart: commissionPeriodStart,
          periodEnd: period.periodEnd,
        })
      : null;

  const netPayout = clampMoney(fixedPay + commission.commissionAmount);
  const reference = `SB-INT-${period.weekLabel}-${person.id.replace(/-/g, "").slice(0, 8)}`;
  const status = resolveWorkforceSelfBillStatus(anchorDate, period.periodEnd);
  const payDay = person.payment_day_of_month ?? WORKFORCE_MONTHLY_PAY_DAY;
  const dueDate =
    payFrequency === "monthly"
      ? computeWorkforcePayDueDate(period.periodEnd, payDay)
      : person.due_date?.trim() || null;

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
    payment_cadence: payFrequency,
    jobs_count: commission.jobs.length,
    job_value: fixedPay,
    materials: 0,
    commission: commission.commissionAmount,
    net_payout: netPayout,
    status,
    due_date: dueDate,
    payout_breakdown: payoutBreakdown,
  };

  const { data: existing } = await supabase
    .from("self_bills")
    .select("id, status")
    .eq("bill_origin", "internal")
    .eq("internal_cost_id", person.id)
    .eq("week_start", period.weekStart)
    .maybeSingle();

  if (existing) {
    const existingStatus = (existing as { status: SelfBillStatus }).status;
    if (!UPDATABLE_SELF_BILL_STATUSES.has(existingStatus)) {
      return existing as SelfBill;
    }
    const { data: updated, error: upErr } = await supabase
      .from("self_bills")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (upErr) throw upErr;
    return updated as SelfBill;
  }

  const { data: inserted, error: insErr } = await supabase.from("self_bills").insert(payload).select("*").single();
  if (insErr) throw insErr;
  return inserted as SelfBill;
}

/** Ensure internal self-bills for every active workforce member in the current pay period. */
export async function syncAllActiveWorkforceSelfBills(
  anchorDate: Date = new Date(),
  supabase: SupabaseClient = getSupabase(),
): Promise<SelfBill[]> {
  const { data, error } = await supabase
    .from("payroll_internal_costs")
    .select("id")
    .or(WORKFORCE_COST_ACTIVE_OR_FILTER);
  if (error) throw error;

  const out: SelfBill[] = [];
  for (const row of data ?? []) {
    const bill = await ensureWorkforceSelfBillForPeriod(row.id, anchorDate, supabase);
    if (bill) out.push(bill);
  }
  return out;
}

/** @deprecated Use syncAllActiveWorkforceSelfBills */
export async function syncAllActiveContractorSelfBills(
  anchorDate: Date = new Date(),
  supabase: SupabaseClient = getSupabase(),
): Promise<SelfBill[]> {
  return syncAllActiveWorkforceSelfBills(anchorDate, supabase);
}

/** Close monthly period — cutoff last day of month → ready_to_pay, due on pay day 5. */
export async function closeWorkforceMonthlyPeriod(anchorDate: Date = new Date()): Promise<SelfBill[]> {
  return syncAllActiveWorkforceSelfBills(anchorDate);
}

export async function generateWorkforceSelfBillsForDueWeek(anchorDate: Date = new Date()): Promise<SelfBill[]> {
  return closeWorkforceMonthlyPeriod(anchorDate);
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
    data.payment_day_of_month ?? WORKFORCE_MONTHLY_PAY_DAY,
    data.due_date ? new Date(data.due_date) : new Date(),
  );

  await supabase
    .from("payroll_internal_costs")
    .update({ due_date: nextDue, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", internalCostId);
}
