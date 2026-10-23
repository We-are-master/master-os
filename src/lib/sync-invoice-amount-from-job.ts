import type { Invoice, Job } from "@/types/database";
import { listInvoicesLinkedToJob, updateInvoice } from "@/services/invoices";
import { getSupabase } from "@/services/base";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { allocateInvoiceExtraToInstallment } from "@/services/invoice-payment-plan";
import { todayYmdForPaymentPlan } from "@/lib/invoice-payment-plan";

const EPS = 0.02;

export { linkedInvoiceTargetAmount, faturasDoJobQueContam } from "@/lib/invoice-target-amount";
import { linkedInvoiceTargetAmount, faturasDoJobQueContam } from "@/lib/invoice-target-amount";

/**
 * After job billable totals change (e.g. on-site extra, CCZ/parking), bump linked non-batch invoice `amount`
 * to match the job (deposit / final / combined). Runs payment sync so balance due follows without changing
 * prior payments. `collection_stage_locked` still gets amount updates; stage stays manual elsewhere.
 */
export async function bumpLinkedInvoiceAmountsToJobSchedule(job: Job): Promise<void> {
  if (!job.reference?.trim()) return;

  const linked = await listInvoicesLinkedToJob(job.reference, job.invoice_id);
  const faturaUnicaDoJob = faturasDoJobQueContam(linked) === 1;
  for (const inv of linked) {
    const target = linkedInvoiceTargetAmount(job, inv, { faturaUnicaDoJob });
    if (target == null) continue;
    const prev = Number(inv.amount ?? 0);
    if (Math.abs(prev - target) <= EPS) continue;
    const delta = Math.round((target - prev) * 100) / 100;
    try {
      await updateInvoice(inv.id, { amount: target });
      if (delta > EPS && inv.payment_plan_active) {
        await allocateInvoiceExtraToInstallment(inv.id, delta, todayYmdForPaymentPlan());
      }
    } catch (e) {
      console.error("bumpLinkedInvoiceAmountsToJobSchedule", inv.id, e);
    }
  }

  try {
    await syncInvoicesFromJobCustomerPayments(getSupabase(), job.id);
  } catch (e) {
    console.error("bumpLinkedInvoiceAmountsToJobSchedule: sync invoices", job.id, e);
  }
}
