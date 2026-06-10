import { addMonths, format, parseISO, startOfMonth } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import type { InternalCost, SelfBill, SelfBillStatus, WorkforcePayoutBreakdown } from "@/types/database";
import {
  accrueMonthlyFixedPayToDate,
  countWorkforceCalendarPayableDays,
  computeWorkforcePayDueDate,
  effectiveWorkforcePeriodStart,
  getPayPeriodBounds,
  computeNextDueDate,
  parseWorkforceDaysOff,
  parseWorkforceStartDate,
  WORKFORCE_MONTHLY_PAY_DAY,
} from "@/lib/workforce-pay-schedule";
import {
  isPostgresCheckViolationError,
  isSupabaseMissingColumnError,
  parsePostgrestUnknownColumnName,
} from "@/lib/supabase-schema-compat";
import {
  isWorkforceSelfBillEligible,
  isWorkforceSelfBillSyncEligible,
  WORKFORCE_SELF_BILL_SYNC_OR_FILTER,
} from "@/lib/workforce-lifecycle";
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

const WORKFORCE_STATUS_FALLBACKS: SelfBillStatus[] = ["accumulating", "pending_review", "draft"];

async function findExistingWorkforceSelfBill(
  supabase: SupabaseClient,
  personId: string,
  periodWeekStart: string,
  reference: string,
): Promise<{ id: string; status: SelfBillStatus } | null> {
  const { data, error } = await supabase
    .from("self_bills")
    .select("id, status")
    .eq("bill_origin", "internal")
    .eq("internal_cost_id", personId)
    .eq("week_start", periodWeekStart)
    .maybeSingle();

  if (!error) return (data as { id: string; status: SelfBillStatus } | null) ?? null;

  if (isSupabaseMissingColumnError(error)) {
    const { data: byRef, error: refErr } = await supabase
      .from("self_bills")
      .select("id, status")
      .eq("reference", reference)
      .maybeSingle();
    if (refErr) throw refErr;
    return (byRef as { id: string; status: SelfBillStatus } | null) ?? null;
  }

  throw error;
}

async function writeWorkforceSelfBillRow(
  supabase: SupabaseClient,
  existingId: string | null,
  payload: Record<string, unknown>,
): Promise<SelfBill> {
  for (let statusTry = 0; statusTry <= WORKFORCE_STATUS_FALLBACKS.length; statusTry++) {
    let body: Record<string, unknown> = { ...payload };
    if (statusTry > 0) body.status = WORKFORCE_STATUS_FALLBACKS[statusTry - 1];

    for (let attempt = 0; attempt < 12; attempt++) {
      const result = existingId
        ? await supabase.from("self_bills").update(body).eq("id", existingId).select("*").single()
        : await supabase.from("self_bills").insert(body).select("*").single();

      if (!result.error && result.data) return result.data as SelfBill;

      const error = result.error;
      if (!error) break;

      if (isSupabaseMissingColumnError(error)) {
        const col = parsePostgrestUnknownColumnName(error);
        if (col && col in body) {
          delete body[col];
          if (Object.keys(body).length === 0) throw error;
          continue;
        }
      }

      if (isPostgresCheckViolationError(error) && statusTry < WORKFORCE_STATUS_FALLBACKS.length) {
        break;
      }

      throw error;
    }
  }

  throw new Error("Failed to write workforce self-bill");
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
  | "employment_type"
  | "payroll_profile"
  | "created_at"
>;

function hasExplicitWorkforceStartDate(payrollProfile: unknown): boolean {
  if (!payrollProfile || typeof payrollProfile !== "object") return false;
  const raw = (payrollProfile as { start_date?: unknown }).start_date;
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.trim());
}

const PURGEABLE_WORKFORCE_SELF_BILL_STATUSES: SelfBillStatus[] = [
  "accumulating",
  "pending_review",
  "needs_attention",
  "ready_to_pay",
  "draft",
];

/**
 * Remove workforce SB-INT drafts outside the open calendar month, and any draft for
 * contractors without an explicit payroll start_date (user must set it before accrual).
 */
export async function purgeStaleWorkforceSelfBillDrafts(
  anchorDate: Date = new Date(),
  supabase: SupabaseClient = getSupabase(),
): Promise<{ deleted: number; ids: string[] }> {
  const currentMonthStart = format(startOfMonth(anchorDate), "yyyy-MM-dd");

  const { data: people, error: peopleErr } = await supabase
    .from("payroll_internal_costs")
    .select("id, payroll_profile")
    .eq("employment_type", "self_employed");
  if (peopleErr) throw peopleErr;

  const missingStartDateIds = new Set(
    (people ?? [])
      .filter((p) => !hasExplicitWorkforceStartDate(p.payroll_profile))
      .map((p) => p.id as string),
  );

  const { data: rows, error } = await supabase
    .from("self_bills")
    .select("id, week_start, internal_cost_id, status")
    .eq("bill_origin", "internal")
    .in("status", PURGEABLE_WORKFORCE_SELF_BILL_STATUSES);
  if (error) throw error;

  const toDelete = (rows ?? []).filter((row) => {
    const ws = String(row.week_start ?? "").slice(0, 10);
    const personId = row.internal_cost_id as string | null;
    if (personId && missingStartDateIds.has(personId)) return true;
    return ws !== currentMonthStart;
  });

  const ids = toDelete.map((r) => r.id as string);
  if (ids.length === 0) return { deleted: 0, ids: [] };

  const { error: delErr } = await supabase.from("self_bills").delete().in("id", ids);
  if (delErr) throw delErr;

  return { deleted: ids.length, ids };
}

export type WorkforceSelfBillSyncBounds = {
  from: string;
  to: string;
};

/** Open monthly draft sync — only the calendar month containing `realToday`. */
export function workforceSelfBillSyncMonthAnchors(realToday: Date = new Date()): Date[] {
  return [startOfMonth(realToday)];
}

/** Monthly workforce: accumulating until month-end cutoff, then ready_to_pay for billing (pay day 5). */
function resolveWorkforceSelfBillStatus(realTodayYmd: string, periodEnd: string): SelfBillStatus {
  if (realTodayYmd > periodEnd) return "ready_to_pay";
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
  if (!row || !isWorkforceSelfBillSyncEligible(row.lifecycle_stage)) return null;

  const person = row as WorkforceSelfBillRow;
  if (!isWorkforceSelfBillEligible(person.employment_type)) return null;
  if (!hasExplicitWorkforceStartDate(person.payroll_profile)) return null;

  const payFrequency = person.pay_frequency ?? "monthly";
  const period = getPayPeriodBounds(payFrequency, anchorDate);
  const realTodayYmd = format(new Date(), "yyyy-MM-dd");
  const workforceStart = parseWorkforceStartDate(person.payroll_profile, person.created_at);
  if (workforceStart && period.periodEnd < workforceStart) return null;
  const accrualAsOfYmd =
    realTodayYmd < period.periodStart
      ? period.periodStart
      : realTodayYmd < period.periodEnd
        ? realTodayYmd
        : period.periodEnd;
  const daysOff = parseWorkforceDaysOff(person.payroll_profile);
  const payableMeta =
    payFrequency === "monthly"
      ? countWorkforceCalendarPayableDays(
          period.periodStart,
          period.periodEnd,
          accrualAsOfYmd,
          workforceStart,
          daysOff,
        )
      : { payableDays: 0, daysOffInRange: [] as string[] };
  const monthlyFixed = clampMoney(Math.max(0, Number(person.amount) || 0));
  const fixedPay =
    payFrequency === "monthly"
      ? accrueMonthlyFixedPayToDate(
          monthlyFixed,
          period.periodStart,
          period.periodEnd,
          accrualAsOfYmd,
          workforceStart,
          daysOff,
        )
      : monthlyFixed;

  const commissionPeriodStart = effectiveWorkforcePeriodStart(period.periodStart, workforceStart);
  const commissionPeriodEnd =
    accrualAsOfYmd < period.periodEnd ? accrualAsOfYmd : period.periodEnd;

  let commission = {
    basisTotal: 0,
    commissionAmount: 0,
    jobs: [] as { job_id: string; reference: string; revenue: number; gross_profit: number; commission: number }[],
  };
  if (
    person.commission_enabled &&
    person.profile_id &&
    person.commission_rate_percent != null &&
    person.commission_basis &&
    commissionPeriodEnd >= commissionPeriodStart
  ) {
    commission = await calculateOwnerJobCommission(
      {
        profileId: person.profile_id,
        periodStart: commissionPeriodStart,
        periodEnd: commissionPeriodEnd,
        commissionRatePercent: person.commission_rate_percent,
        commissionBasis: person.commission_basis,
      },
      supabase,
    );
  }

  const startDateMissing = !hasExplicitWorkforceStartDate(person.payroll_profile);
  const breakdownMeta = {
    workforce_start_date: workforceStart,
    start_date_missing: startDateMissing,
    payable_days: payableMeta.payableDays,
    days_off_deducted: payableMeta.daysOffInRange.length,
    days_off_dates: payableMeta.daysOffInRange,
  };
  const payoutBreakdown: WorkforcePayoutBreakdown =
    person.commission_enabled && person.commission_basis && person.commission_rate_percent != null
      ? {
          ...buildPayoutBreakdown({
            fixedPay,
            commission,
            commissionBasis: person.commission_basis,
            commissionRatePercent: person.commission_rate_percent,
            periodStart: commissionPeriodStart,
            periodEnd: commissionPeriodEnd,
          }),
          ...breakdownMeta,
        }
      : {
          fixed_pay: fixedPay,
          commission_amount: commission.commissionAmount,
          period_start: commissionPeriodStart,
          period_end: commissionPeriodEnd,
          basis_total: commission.basisTotal,
          jobs: commission.jobs,
          ...breakdownMeta,
        };

  const netPayout = clampMoney(fixedPay + commission.commissionAmount);
  const reference = `SB-INT-${period.weekLabel}-${person.id.replace(/-/g, "").slice(0, 8)}`;
  const status = resolveWorkforceSelfBillStatus(realTodayYmd, period.periodEnd);
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

  const existing = await findExistingWorkforceSelfBill(
    supabase,
    person.id,
    period.weekStart,
    reference,
  );

  if (!existing && period.periodStart > realTodayYmd) {
    return null;
  }

  if (existing) {
    if (!UPDATABLE_SELF_BILL_STATUSES.has(existing.status)) {
      const { data: frozen } = await supabase.from("self_bills").select("*").eq("id", existing.id).maybeSingle();
      return (frozen as SelfBill) ?? (existing as unknown as SelfBill);
    }
    return writeWorkforceSelfBillRow(supabase, existing.id, payload);
  }

  return writeWorkforceSelfBillRow(supabase, null, payload);
}

/** Ensure internal self-bills for every active workforce member in the current pay period. */
export async function syncAllActiveWorkforceSelfBills(
  anchorDate: Date = new Date(),
  supabase: SupabaseClient = getSupabase(),
): Promise<SelfBill[]> {
  return syncWorkforceSelfBillsForBounds(null, anchorDate, supabase);
}

/**
 * Ensure workforce SB-INT for the open calendar month only.
 * Billing period filters control which rows are shown — not how many drafts are created.
 * (Bounds are accepted for API compatibility but no longer backfill every month in range.)
 */
export async function syncWorkforceSelfBillsForBounds(
  _bounds: WorkforceSelfBillSyncBounds | null,
  anchorDate: Date = new Date(),
  supabase: SupabaseClient = getSupabase(),
): Promise<SelfBill[]> {
  const { data, error } = await supabase
    .from("payroll_internal_costs")
    .select("id")
    .or(WORKFORCE_SELF_BILL_SYNC_OR_FILTER)
    .eq("employment_type", "self_employed");
  if (error) throw error;

  const anchors = workforceSelfBillSyncMonthAnchors(anchorDate);
  const byBillId = new Map<string, SelfBill>();

  for (const monthAnchor of anchors) {
    for (const row of data ?? []) {
      const bill = await ensureWorkforceSelfBillForPeriod(row.id, monthAnchor, supabase);
      if (bill) byBillId.set(bill.id, bill);
    }
  }

  return [...byBillId.values()];
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

/** Create accumulating SB-INT for the calendar month after `currentPeriodWeekStart`. */
export async function ensureNextWorkforceSelfBillPeriod(
  internalCostId: string,
  currentPeriodWeekStart: string,
  supabase: SupabaseClient = getSupabase(),
): Promise<SelfBill | null> {
  const ws = currentPeriodWeekStart.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ws)) {
    return ensureWorkforceSelfBillForPeriod(internalCostId, addMonths(new Date(), 1), supabase);
  }
  const nextMonthAnchor = startOfMonth(addMonths(parseISO(`${ws}T12:00:00`), 1));
  return ensureWorkforceSelfBillForPeriod(internalCostId, nextMonthAnchor, supabase);
}

/**
 * Recompute workforce SB-INT when jobs complete/cancel (owner_id → contractor profile).
 * Refreshes current month and the month of each job's completed_date when present.
 */
export async function refreshWorkforceSelfBillsForJobIds(
  jobIds: string[],
  supabase: SupabaseClient = getSupabase(),
): Promise<void> {
  const ids = [...new Set(jobIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;

  const { data: jobs, error: jobErr } = await supabase
    .from("jobs")
    .select("owner_id, completed_date")
    .in("id", ids);
  if (jobErr) {
    console.error("refreshWorkforceSelfBillsForJobIds jobs:", jobErr);
    return;
  }

  const ownerIds = [...new Set((jobs ?? []).map((j) => j.owner_id?.trim()).filter(Boolean))] as string[];
  if (ownerIds.length === 0) return;

  const { data: people, error: peopleErr } = await supabase
    .from("payroll_internal_costs")
    .select("id, profile_id, employment_type, lifecycle_stage")
    .in("profile_id", ownerIds)
    .eq("employment_type", "self_employed");
  if (peopleErr) {
    console.error("refreshWorkforceSelfBillsForJobIds people:", peopleErr);
    return;
  }

  const anchorsByPerson = new Map<string, Set<string>>();
  const today = new Date();
  const currentMonthKey = format(startOfMonth(today), "yyyy-MM-dd");

  for (const person of people ?? []) {
    if (!isWorkforceSelfBillSyncEligible(person.lifecycle_stage)) continue;
    anchorsByPerson.set(person.id, new Set([currentMonthKey]));
  }

  for (const [personId, monthKeys] of anchorsByPerson) {
    for (const monthKey of monthKeys) {
      try {
        await ensureWorkforceSelfBillForPeriod(personId, parseISO(`${monthKey}T12:00:00`), supabase);
      } catch (e) {
        console.error("refreshWorkforceSelfBillsForJobIds ensure:", personId, monthKey, e);
      }
    }
  }
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
