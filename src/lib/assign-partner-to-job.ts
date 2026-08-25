import { getPartnerAssignmentBlockReason, partnerAssignStatusPatch } from "@/lib/job-partner-assign";
import { deriveStoredJobFinancials } from "@/lib/job-financials";
import { notifyAssignedPartnerAboutJob } from "@/lib/notify-partner-job-push";
import { notifyPartnerJobChange } from "@/lib/notify-partner-job-zendesk";
import { updateJob } from "@/services/jobs";
import type { Job } from "@/types/database";

/**
 * Assigning a partner is one business process — gate, pricing, status bump and
 * the two partner notifications — and it used to live only inside the Jobs
 * detail page. Any other screen that wanted to assign either copied it or
 * silently skipped the notifications. This module is that process, so every
 * surface (job detail, Live View board, anything next) runs the same steps.
 */

export type PartnerAssignInput = {
  partnerId: string;
  partnerName: string;
  /** Labour agreed with the partner, before extras already on the job. Ignored on hourly jobs. */
  partnerCost: number;
  /** What the client pays for labour. Ignored on hourly jobs. */
  clientPrice: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hourly jobs price from catalog rates — the board never overwrites those. */
export function jobPricesHourly(job: Pick<Job, "job_type">): boolean {
  return job.job_type === "hourly";
}

export function buildPartnerAssignPatch(job: Job, input: PartnerAssignInput): Partial<Job> {
  const base: Partial<Job> = {
    partner_id: input.partnerId,
    partner_name: input.partnerName,
    partner_ids: [input.partnerId],
    ...partnerAssignStatusPatch(job.status),
  };

  // Hourly keeps its catalog-derived rates: assign the partner, touch no money.
  if (jobPricesHourly(job)) {
    return { ...base, ...deriveStoredJobFinancials({ ...job, ...base } as Job) };
  }

  const partnerExtras = Math.max(0, Number(job.partner_extras_amount) || 0);
  const materials = Math.max(0, Number(job.materials_cost) || 0);
  const deposit = Math.max(0, Number(job.customer_deposit) || 0);
  const clientExtras = Math.max(0, Number(job.extras_amount) || 0);

  const clientPrice = round2(Math.max(0, input.clientPrice));
  // `partner_cost` is the full partner side (labour + extras already agreed),
  // matching how the Jobs detail modal stores it.
  const partnerCost = round2(Math.max(0, input.partnerCost) + partnerExtras);

  const patch: Partial<Job> = {
    ...base,
    job_type: "fixed",
    client_price: clientPrice,
    partner_cost: partnerCost,
    partner_agreed_value: round2(partnerCost + materials),
    customer_final_payment: round2(Math.max(0, clientPrice + clientExtras - deposit)),
    hourly_client_rate: null,
    hourly_partner_rate: null,
    billed_hours: null,
  };

  return { ...patch, ...deriveStoredJobFinancials({ ...job, ...patch } as Job) };
}

/**
 * Saves the assignment and fires the partner notifications.
 * Throws with the operator-facing reason when the job isn't ready for a partner
 * (no address, no scope, no date) instead of writing a half-booked job.
 */
export async function assignPartnerToJob(job: Job, input: PartnerAssignInput): Promise<Job> {
  const block = getPartnerAssignmentBlockReason({
    ...job,
    partner_id: input.partnerId,
    partner_ids: [input.partnerId],
  });
  if (block) throw new Error(block);

  const previousPartnerId = job.partner_id ?? null;
  const updated = await updateJob(job.id, buildPartnerAssignPatch(job, input));

  if (previousPartnerId && previousPartnerId !== input.partnerId) {
    // Swap: para quem sai, a notícia é "job cancelado", sem motivo (dono,
    // 24/08). O novo dono do job não é assunto do antigo.
    notifyAssignedPartnerAboutJob({
      partnerId: previousPartnerId,
      job: updated,
      kind: "job_cancelled_by_office",
    });
    void notifyPartnerJobChange({
      jobId: updated.id,
      jobReference: updated.reference,
      kind: "cancelled",
      newStatusLabel: "Cancelled",
      skipPush: true,
      silent: true,
      targetPartnerId: previousPartnerId,
    });
  }
  notifyAssignedPartnerAboutJob({ partnerId: input.partnerId, job: updated, kind: "job_assigned" });
  // Zendesk side conversation to the partner. No-op server-side when the job
  // didn't come from Zendesk. Push already went out above.
  void notifyPartnerJobChange({
    jobId: updated.id,
    jobReference: updated.reference,
    kind: "assigned",
    skipPush: true,
  });

  return updated;
}
