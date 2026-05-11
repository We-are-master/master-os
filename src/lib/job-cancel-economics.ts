import type { Job } from "@/types/database";

const EPS = 0.02;

/**
 * Persisted GBP the partner owes after **partner-app** cancellation (positive in DB).
 * Office-side fees are tracked only via normal client/partner extras, not snapshots here.
 */
export function partnerCancellationClawbackOwedGbp(job: Pick<Job, "status"> & Partial<Job>): number {
  if (job.status !== "cancelled") return 0;
  if (!(job.partner_cancelled_at ?? null)) return 0;
  const fee = Number(job.partner_cancellation_fee ?? 0);
  if (!(fee > EPS)) return 0;
  return Math.round(Math.max(0, fee) * 100) / 100;
}

/**
 * Snapshot fields for quoted work + partner labour — cleared on office/dashboard cancel.
 * Leaves `customer_deposit` / `customer_deposit_paid` untouched for ledger history.
 */
export function patchOfficeCancelZeroJobEconomics(): Partial<Job> {
  return {
    client_price: 0,
    extras_amount: 0,
    partner_cost: 0,
    partner_extras_amount: 0,
    materials_cost: 0,
    partner_agreed_value: 0,
    customer_final_payment: 0,
    margin_percent: 0,
    service_value: 0,
    billed_hours: null,
    hourly_client_rate: null,
    hourly_partner_rate: null,
  };
}

/**
 * Returns a Partial<Job> that captures the pre-cancel revenue + cost so the UI
 * can display "lost revenue" later (after `patchOfficeCancelZeroJobEconomics`
 * has zeroed the live fields). Pass the job as it is BEFORE applying the zero
 * patch — typically `currentJob` in the cancel handler.
 */
export function patchOfficeCancelLostSnapshot(
  currentJob: Pick<Job, "client_price" | "extras_amount" | "partner_cost">,
): Partial<Job> {
  return {
    cancelled_client_price: Number(currentJob.client_price) || 0,
    cancelled_extras_amount: Number(currentJob.extras_amount) || 0,
    cancelled_partner_cost: Number(currentJob.partner_cost) || 0,
  };
}
