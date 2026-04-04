import type { Job, JobPaymentType } from "@/types/database";
import { computeHourlyTotals, resolveJobHourlyRates } from "@/lib/job-hourly-billing";
import { computeOfficeTimerElapsedSeconds } from "@/lib/office-job-timer";

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

/** Values to persist when financial inputs change */
export function deriveStoredJobFinancials(j: Job): Pick<Job, "margin_percent" | "service_value"> {
  const revenue = jobBillableRevenue(j);
  return {
    margin_percent: jobMarginPercent(j),
    service_value: revenue,
  };
}

export function partnerPaymentCap(j: Job): number {
  const agreed = Number(j.partner_agreed_value ?? 0);
  const cost = Number(j.partner_cost ?? 0);
  return agreed > 0 ? agreed : cost;
}

/** Partner payout + materials — rolls into weekly self-bill (even when partner is already marked paid). */
export function partnerSelfBillGrossAmount(j: Job): number {
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
  const partnerTotal = partnerPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
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
