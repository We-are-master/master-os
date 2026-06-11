import type { Job } from "@/types/database";

const EPS = 0.02;

function roundGbp(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export type OfficeCancelFeeChoices = {
  chargeClient: boolean;
  clientFeeGbp: number | null;
  partnerFee: boolean;
  partnerFlow: "owes" | "paid" | null;
  partnerFeeGbp: number | null;
};

/** Snapshot fields for office cancel fee rails (client invoice + partner self-bill). */
export function buildCancellationFeeJobPatch(choices: OfficeCancelFeeChoices): Partial<Job> {
  const clientGbp =
    choices.chargeClient && choices.clientFeeGbp != null && choices.clientFeeGbp > EPS
      ? roundGbp(choices.clientFeeGbp)
      : null;
  const partnerOwes =
    choices.partnerFee && choices.partnerFlow === "owes" && choices.partnerFeeGbp != null && choices.partnerFeeGbp > EPS
      ? roundGbp(choices.partnerFeeGbp)
      : null;
  const partnerPaid =
    choices.partnerFee && choices.partnerFlow === "paid" && choices.partnerFeeGbp != null && choices.partnerFeeGbp > EPS
      ? roundGbp(choices.partnerFeeGbp)
      : null;

  let party: NonNullable<Job["cancellation_fee_party"]> = "none";
  if (clientGbp && (partnerOwes || partnerPaid)) party = "both";
  else if (clientGbp) party = "client";
  else if (partnerOwes || partnerPaid) party = "partner";

  return {
    cancellation_fee_party: party,
    cancellation_fee_client_gbp: clientGbp,
    cancellation_fee_partner_gbp: partnerOwes,
    partner_cancellation_compensation_gbp: partnerPaid,
    cancellation_fee_gbp: clientGbp ?? partnerOwes ?? partnerPaid ?? null,
  };
}

/** Office cancel: partner owes Fixfy (clawback on weekly self-bill). */
export function officeCancellationPartnerClawbackGbp(
  job: Pick<Job, "status" | "partner_cancelled_at"> & Partial<Job>,
): number {
  if (job.status !== "cancelled") return 0;
  if (job.partner_cancelled_at) return 0;
  const fee = Number(job.cancellation_fee_partner_gbp ?? 0);
  if (!(fee > EPS)) return 0;
  return roundGbp(fee);
}

/** Office cancel: Fixfy pays partner (additive on weekly self-bill). */
export function officeCancellationPartnerPayoutGbp(
  job: Pick<Job, "status" | "partner_cancelled_at"> & Partial<Job>,
): number {
  if (job.status !== "cancelled") return 0;
  if (job.partner_cancelled_at) return 0;
  const comp = Number(job.partner_cancellation_compensation_gbp ?? 0);
  if (!(comp > EPS)) return 0;
  return roundGbp(comp);
}

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
export type SelfBillCancellationFeeLine = {
  label: string;
  signedAmount: number;
  kind: "clawback" | "compensation";
};

/** Display line for cancelled job fee on self-bill UI / PDF. */
export function selfBillJobCancellationFeeLine(
  job: Pick<
    Job,
    | "status"
    | "reference"
    | "partner_cancelled_at"
    | "cancellation_fee_partner_gbp"
    | "partner_cancellation_fee"
    | "partner_cancellation_compensation_gbp"
  >,
): SelfBillCancellationFeeLine | null {
  if (job.status !== "cancelled") return null;
  const clawback =
    partnerCancellationClawbackOwedGbp(job) + officeCancellationPartnerClawbackGbp(job);
  if (clawback > EPS) {
    return {
      label: "(Cancelled - Fee Applied)",
      signedAmount: -clawback,
      kind: "clawback",
    };
  }
  const comp = officeCancellationPartnerPayoutGbp(job);
  if (comp > EPS) {
    return {
      label: "(Cancelled - Compensation)",
      signedAmount: comp,
      kind: "compensation",
    };
  }
  return null;
}

export function selfBillCancellationFeeTotals(
  jobs: Array<
    Pick<
      Job,
      | "status"
      | "partner_cancelled_at"
      | "cancellation_fee_partner_gbp"
      | "partner_cancellation_fee"
      | "partner_cancellation_compensation_gbp"
    >
  >,
): { clawbackTotal: number; compensationTotal: number } {
  let clawbackTotal = 0;
  let compensationTotal = 0;
  for (const j of jobs) {
    if (j.status !== "cancelled") continue;
    clawbackTotal += partnerCancellationClawbackOwedGbp(j) + officeCancellationPartnerClawbackGbp(j);
    compensationTotal += officeCancellationPartnerPayoutGbp(j);
  }
  return {
    clawbackTotal: roundGbp(clawbackTotal),
    compensationTotal: roundGbp(compensationTotal),
  };
}

export function patchOfficeCancelLostSnapshot(
  currentJob: Pick<Job, "client_price" | "extras_amount" | "partner_cost">,
): Partial<Job> {
  return {
    cancelled_client_price: Number(currentJob.client_price) || 0,
    cancelled_extras_amount: Number(currentJob.extras_amount) || 0,
    cancelled_partner_cost: Number(currentJob.partner_cost) || 0,
  };
}
