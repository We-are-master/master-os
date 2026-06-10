import { format } from "date-fns";
import { getSupabase } from "./base";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPayPeriodBounds } from "@/lib/workforce-pay-schedule";
import type {
  InternalCost,
  WorkforceCommissionBasis,
  WorkforcePayoutBreakdown,
} from "@/types/database";

function clampMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type OwnerJobCommissionRow = {
  job_id: string;
  reference: string;
  revenue: number;
  gross_profit: number;
  commission: number;
};

export type CommissionCalcResult = {
  basisTotal: number;
  commissionAmount: number;
  jobs: OwnerJobCommissionRow[];
};

function jobRevenue(row: { client_price?: number | null; extras_amount?: number | null }): number {
  return clampMoney(Number(row.client_price ?? 0) + Number(row.extras_amount ?? 0));
}

export function ownerJobEligibleForWorkforceCommission(row: {
  status?: string | null;
  deleted_at?: string | null;
}): boolean {
  if (row.deleted_at) return false;
  if (row.status === "cancelled" || row.status === "deleted") return false;
  return true;
}

function jobGrossProfit(row: {
  client_price?: number | null;
  extras_amount?: number | null;
  partner_cost?: number | null;
  partner_extras_amount?: number | null;
  materials_cost?: number | null;
}): number {
  const revenue = jobRevenue(row);
  const costs =
    Number(row.partner_cost ?? 0) +
    Number(row.partner_extras_amount ?? 0) +
    Number(row.materials_cost ?? 0);
  return clampMoney(Math.max(0, revenue - costs));
}

export async function calculateOwnerJobCommission(
  input: {
    profileId: string;
    periodStart: string;
    periodEnd: string;
    commissionRatePercent: number;
    commissionBasis: WorkforceCommissionBasis;
  },
  supabase: SupabaseClient = getSupabase(),
): Promise<CommissionCalcResult> {
  const rate = Math.max(0, Math.min(100, Number(input.commissionRatePercent) || 0)) / 100;
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, reference, client_price, extras_amount, partner_cost, partner_extras_amount, materials_cost, completed_date, status, deleted_at",
    )
    .eq("owner_id", input.profileId)
    .is("deleted_at", null)
    .not("status", "in", '("cancelled","deleted")')
    .not("completed_date", "is", null)
    .gte("completed_date", input.periodStart)
    .lte("completed_date", input.periodEnd);
  if (error) throw error;

  const jobs: OwnerJobCommissionRow[] = [];
  for (const row of data ?? []) {
    if (!ownerJobEligibleForWorkforceCommission(row)) continue;
    const revenue = jobRevenue(row);
    const grossProfit = jobGrossProfit(row);
    const basis = input.commissionBasis === "revenue" ? revenue : grossProfit;
    jobs.push({
      job_id: row.id,
      reference: row.reference ?? row.id.slice(0, 8),
      revenue,
      gross_profit: grossProfit,
      commission: clampMoney(basis * rate),
    });
  }
  const basisTotal = clampMoney(jobs.reduce((s, j) => s + (input.commissionBasis === "revenue" ? j.revenue : j.gross_profit), 0));
  const commissionAmount = clampMoney(jobs.reduce((s, j) => s + j.commission, 0));
  return { basisTotal, commissionAmount, jobs };
}

export async function previewWorkforceCommission(
  person: Pick<
    InternalCost,
    "profile_id" | "commission_enabled" | "commission_rate_percent" | "commission_basis" | "pay_frequency"
  >,
  anchorDate: Date = new Date(),
): Promise<CommissionCalcResult | null> {
  if (!person.commission_enabled || !person.profile_id) return null;
  if (person.commission_rate_percent == null || !person.commission_basis) return null;
  const period = getPayPeriodBounds(person.pay_frequency, anchorDate);
  const todayYmd = format(anchorDate, "yyyy-MM-dd");
  const commissionPeriodEnd = todayYmd < period.periodEnd ? todayYmd : period.periodEnd;
  return calculateOwnerJobCommission({
    profileId: person.profile_id,
    periodStart: period.periodStart,
    periodEnd: commissionPeriodEnd,
    commissionRatePercent: person.commission_rate_percent,
    commissionBasis: person.commission_basis,
  });
}

export function buildPayoutBreakdown(input: {
  fixedPay: number;
  commission: CommissionCalcResult;
  commissionBasis: WorkforceCommissionBasis;
  commissionRatePercent: number;
  periodStart: string;
  periodEnd: string;
}): WorkforcePayoutBreakdown {
  return {
    fixed_pay: clampMoney(input.fixedPay),
    commission_amount: input.commission.commissionAmount,
    commission_basis: input.commissionBasis,
    commission_rate_percent: input.commissionRatePercent,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    basis_total: input.commission.basisTotal,
    jobs: input.commission.jobs,
  };
}
