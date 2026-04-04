import type { Invoice, Job } from "@/types/database";
import { customerScheduledTotal, jobCustomerBillableRevenueForCollections } from "@/lib/job-financials";
import { inferInvoiceKind } from "@/lib/invoice-collection";
import { listInvoicesLinkedToJob, updateInvoice } from "@/services/invoices";
import { getSupabase } from "@/services/base";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";

const EPS = 0.02;

/**
 * Target `invoices.amount` for a row linked to this job after job-side totals change
 * (extras, CCZ/parking → extras_amount, deposit/final schedule, hourly collections).
 */
export function linkedInvoiceTargetAmount(job: Job, inv: Invoice): number | null {
  if (inv.status === "cancelled") return null;
  if (inv.invoice_kind === "weekly_batch") return null;

  const billable = jobCustomerBillableRevenueForCollections(job);
  const scheduled = customerScheduledTotal(job);
  const fullTotal = Math.round(Math.max(0, Math.max(billable, scheduled)) * 100) / 100;

  const schedDep = Number(job.customer_deposit ?? 0);
  const schedFin = Number(job.customer_final_payment ?? 0);

  /** `weekly_batch` already returned null above — narrowed out here. */
  const kind =
    inv.invoice_kind && inv.invoice_kind !== "other" ? inv.invoice_kind : inferInvoiceKind(job, inv);

  if (kind === "deposit") {
    return schedDep > EPS ? Math.round(schedDep * 100) / 100 : null;
  }
  if (kind === "final") {
    return schedFin > EPS ? Math.round(schedFin * 100) / 100 : null;
  }
  return fullTotal > EPS ? fullTotal : null;
}

/**
 * After job billable totals change (e.g. on-site extra, CCZ/parking), bump linked non-batch invoice `amount`
 * to match the job (deposit / final / combined). Runs payment sync so balance due follows without changing
 * prior payments. `collection_stage_locked` still gets amount updates; stage stays manual elsewhere.
 */
export async function bumpLinkedInvoiceAmountsToJobSchedule(job: Job): Promise<void> {
  if (!job.reference?.trim()) return;

  const linked = await listInvoicesLinkedToJob(job.reference, job.invoice_id);
  for (const inv of linked) {
    const target = linkedInvoiceTargetAmount(job, inv);
    if (target == null) continue;
    const prev = Number(inv.amount ?? 0);
    if (Math.abs(prev - target) <= EPS) continue;
    try {
      await updateInvoice(inv.id, { amount: target });
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
