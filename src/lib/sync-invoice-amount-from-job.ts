import type { Job } from "@/types/database";
import { jobBillableRevenue, customerScheduledTotal } from "@/lib/job-financials";
import { listInvoicesLinkedToJob, updateInvoice } from "@/services/invoices";

const EPS = 0.02;

/**
 * After job billable totals change (e.g. on-site extra), bump linked non-batch invoice `amount`
 * to match the job schedule so Finance stays aligned before/after payment sync.
 */
export async function bumpLinkedInvoiceAmountsToJobSchedule(job: Job): Promise<void> {
  const billable = jobBillableRevenue(job);
  const scheduled = customerScheduledTotal(job);
  const total = Math.round(Math.max(0, Math.max(billable, scheduled)) * 100) / 100;
  if (total <= EPS) return;

  const linked = await listInvoicesLinkedToJob(job.reference, job.invoice_id);
  for (const inv of linked) {
    if (inv.status === "cancelled") continue;
    if (inv.invoice_kind === "weekly_batch") continue;
    if (inv.collection_stage_locked) continue;
    const prev = Number(inv.amount ?? 0);
    if (Math.abs(prev - total) <= EPS) continue;
    try {
      await updateInvoice(inv.id, { amount: total });
    } catch (e) {
      console.error("bumpLinkedInvoiceAmountsToJobSchedule", inv.id, e);
    }
  }
}
