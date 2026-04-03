import type { Job } from "@/types/database";
import { deriveStoredJobFinancials } from "@/lib/job-financials";

/** Where the customer’s extra charge lands on the job row (maps to Finance summary lines). */
export type CustomerExtraAllocation = "labour" | "extras" | "materials";

/**
 * Increase customer-facing totals by `amount` and re-derive `customer_final_payment`
 * (final balance = labour + extras − deposit, matching the finance form).
 */
export function applyCustomerExtraPatch(job: Job, amount: number, allocation: CustomerExtraAllocation): Partial<Job> {
  const a = Math.round(amount * 100) / 100;
  if (a <= 0) return {};
  let client_price = Number(job.client_price ?? 0);
  let extras_amount = Number(job.extras_amount ?? 0);
  let materials_cost = Number(job.materials_cost ?? 0);
  const customer_deposit = Number(job.customer_deposit ?? 0);
  if (allocation === "labour") client_price += a;
  else if (allocation === "extras") extras_amount += a;
  else materials_cost += a;
  const customer_final_payment = Math.round(Math.max(0, client_price + extras_amount - customer_deposit) * 100) / 100;
  const merged = { ...job, client_price, extras_amount, materials_cost, customer_final_payment } as Job;
  return {
    client_price,
    extras_amount,
    materials_cost,
    customer_final_payment,
    ...deriveStoredJobFinancials(merged),
  };
}

export type PartnerExtraAllocation = "partner_cost" | "materials";

/**
 * Increase partner-side totals for on-site extras. `partner_cost` (default) feeds self-bill labour;
 * `materials` feeds the materials line on the weekly self-bill.
 */
export function applyPartnerExtraPatch(
  job: Job,
  amount: number,
  allocation: PartnerExtraAllocation = "partner_cost",
): Partial<Job> {
  const a = Math.round(amount * 100) / 100;
  if (a <= 0) return {};
  if (allocation === "materials") {
    const materials_cost = Number(job.materials_cost ?? 0) + a;
    const merged = { ...job, materials_cost } as Job;
    return { materials_cost, ...deriveStoredJobFinancials(merged) };
  }
  const partner_cost = Number(job.partner_cost ?? 0) + a;
  const agreed = Number(job.partner_agreed_value ?? 0);
  const patch: Partial<Job> = { partner_cost };
  if (agreed > 0.02) patch.partner_agreed_value = agreed + a;
  const merged = { ...job, ...patch } as Job;
  return { ...patch, ...deriveStoredJobFinancials(merged) };
}
