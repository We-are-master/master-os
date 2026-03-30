import type { Job, JobPaymentType } from "@/types/database";

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

export function customerScheduledTotal(j: Job): number {
  return Number(j.customer_deposit ?? 0) + Number(j.customer_final_payment ?? 0);
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
