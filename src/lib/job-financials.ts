import type { Job, JobPaymentType } from "@/types/database";
import { computeHourlyTotals, resolveJobHourlyRates } from "@/lib/job-hourly-billing";
import { computeOfficeTimerElapsedSeconds } from "@/lib/office-job-timer";
import { sumPartnerRecordedPayoutsForCap } from "@/lib/job-payment-ledger";

/** Total billable to customer before payment schedule split (deposit + final). */
export function jobBillableRevenue(j: Pick<Job, "client_price" | "extras_amount">): number {
  return Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);
}

export function jobDirectCost(j: Pick<Job, "partner_cost" | "materials_cost">): number {
  return Number(j.partner_cost ?? 0) + Number(j.materials_cost ?? 0);
}

export function jobProfit(j: Pick<Job, "client_price" | "extras_amount" | "partner_cost" | "materials_cost">): number {
  return jobBillableRevenue(j) - jobDirectCost(j);
}

export function jobMarginPercent(j: Pick<Job, "client_price" | "extras_amount" | "partner_cost" | "materials_cost">): number {
  const revenue = jobBillableRevenue(j);
  if (revenue <= 0) return 0;
  return Math.round(((jobProfit(j) / revenue) * 1000)) / 10;
}

/** Hint shown next to partner cost: margin % matches {@link jobMarginPercent} (revenue = client + extras). */
export const SUGGESTED_PARTNER_MARGIN_HINT_PCT = 40;

/**
 * Partner labour that would yield `targetMarginPercent` gross margin on billable revenue,
 * holding materials fixed: margin = (revenue − partner − materials) / revenue.
 */
export function suggestedPartnerCostForTargetMargin(opts: {
  clientPrice: number;
  extrasAmount?: number;
  materialsCost?: number;
  targetMarginPercent: number;
}): number {
  const revenue = Number(opts.clientPrice ?? 0) + Number(opts.extrasAmount ?? 0);
  const materials = Number(opts.materialsCost ?? 0);
  if (revenue <= 0) return 0;
  const t = Math.min(100, Math.max(0, opts.targetMarginPercent));
  const partner = revenue * (1 - t / 100) - materials;
  return Math.max(0, Math.round(partner * 100) / 100);
}

/** Values to persist when financial inputs change */
export function deriveStoredJobFinancials(j: Job): Pick<Job, "margin_percent" | "service_value"> {
  const revenue = jobBillableRevenue(j);
  return {
    margin_percent: jobMarginPercent(j),
    service_value: revenue,
  };
}

export function partnerPaymentCap(j: Pick<Job, "partner_agreed_value" | "partner_cost">): number {
  const agreed = Number(j.partner_agreed_value ?? 0);
  const cost = Number(j.partner_cost ?? 0);
  return agreed > 0 ? agreed : cost;
}

/**
 * Split partner cash-out cap for the finance card: base labour vs extra payout line.
 * Uses `partner_extras_amount` when set; otherwise infers from hourly partner total vs cap (legacy extras).
 */
export function partnerCashOutDisplaySplit(
  job: Pick<Job, "partner_extras_amount" | "job_type">,
  partnerCap: number,
  hourlyPartnerLabour: number | null,
): { base: number; extra: number } {
  const recorded = Math.max(0, Number(job.partner_extras_amount ?? 0));
  const hourlyDelta =
    hourlyPartnerLabour != null && Number.isFinite(hourlyPartnerLabour)
      ? Math.round(Math.max(0, partnerCap - hourlyPartnerLabour) * 100) / 100
      : 0;
  const extra =
    recorded > 0.02
      ? Math.min(recorded, partnerCap)
      : hourlyDelta > 0.02
        ? hourlyDelta
        : 0;
  const base = Math.round(Math.max(0, partnerCap - extra) * 100) / 100;
  return { base, extra };
}

/** Partner payout + materials — rolls into weekly self-bill (even when partner is already marked paid). */
export function partnerSelfBillGrossAmount(j: Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost">): number {
  return partnerPaymentCap(j) + Number(j.materials_cost ?? 0);
}

export function customerScheduledTotal(j: Job): number {
  return Number(j.customer_deposit ?? 0) + Number(j.customer_final_payment ?? 0);
}

type JobCustomerBillableForCollections = Pick<
  Job,
  | "job_type"
  | "client_price"
  | "extras_amount"
  | "customer_deposit"
  | "customer_final_payment"
  | "billed_hours"
  | "hourly_client_rate"
  | "hourly_partner_rate"
  | "partner_cost"
  | "internal_invoice_approved"
  | "status"
  | "timer_elapsed_seconds"
  | "timer_last_started_at"
  | "timer_is_running"
>;

/**
 * Customer billable total aligned with the job detail finance card (max of ticket, scheduled total, hourly-derived client+extras).
 */
export function jobCustomerBillableRevenueForCollections(j: JobCustomerBillableForCollections): number {
  const base = jobBillableRevenue(j);
  const scheduled = customerScheduledTotal(j as Job);
  if (j.job_type !== "hourly") {
    return Math.max(base, scheduled);
  }
  const { clientRate, partnerRate } = resolveJobHourlyRates(j as Job);
  const billedH = Number(j.billed_hours ?? 0);
  const approvedStage =
    Boolean(j.internal_invoice_approved) ||
    j.status === "awaiting_payment" ||
    j.status === "completed";
  const useOffice =
    j.timer_is_running ||
    (Number(j.timer_elapsed_seconds ?? 0) > 0) ||
    !!j.timer_last_started_at;
  const officeEquiv = useOffice ? computeOfficeTimerElapsedSeconds(j) : null;
  const elapsedSeconds =
    billedH > 0 && approvedStage ? Math.round(billedH * 3600) : officeEquiv ?? (Number(j.timer_elapsed_seconds ?? 0) || 0);
  const totals = computeHourlyTotals({
    elapsedSeconds,
    clientHourlyRate: clientRate,
    partnerHourlyRate: partnerRate,
  });
  const hourlyClientPlusExtras = totals.clientTotal + Number(j.extras_amount ?? 0);
  return Math.max(base, scheduled, hourlyClientPlusExtras);
}

/** Rows passed from job_payments when gating “Completed”. */
export type JobCompletionPaymentRow = {
  type: JobPaymentType | string;
  amount: number;
  /** When set, legacy partner “extra payout” notes are excluded from partner payout totals. */
  note?: string | null;
};

/**
 * Require customer collections to cover billable revenue and partner payouts to cover
 * agreed partner value (or partner_cost when no agreed value).
 */
export function canMarkJobCompletedFinancially(
  job: Job,
  customerPayments: JobCompletionPaymentRow[],
  partnerPayments: JobCompletionPaymentRow[],
): { ok: boolean; message?: string } {
  const billable = jobBillableRevenue(job);
  const customerTotal = customerPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const partnerTotal = sumPartnerRecordedPayoutsForCap(partnerPayments);
  const partnerDue = partnerPaymentCap(job);
  const eps = 0.01;

  if (billable > eps && customerTotal + eps < billable) {
    return {
      ok: false,
      message: `Customer has paid £${customerTotal.toFixed(2)}; billable revenue is £${billable.toFixed(2)}.`,
    };
  }
  if (partnerDue > eps && partnerTotal + eps < partnerDue) {
    return {
      ok: false,
      message: `Partner paid out £${partnerTotal.toFixed(2)}; agreed/cost is £${partnerDue.toFixed(2)}.`,
    };
  }
  return { ok: true };
}

/** True when recorded customer deposit + final payments cover billable revenue (for finance-driven job close). */
export function customerCollectionsSatisfyBillable(job: Job, customerPayments: JobCompletionPaymentRow[]): boolean {
  const billable = jobBillableRevenue(job);
  const eps = 0.01;
  if (billable <= eps) return true;
  const customerTotal = customerPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  return customerTotal + eps >= billable;
}
