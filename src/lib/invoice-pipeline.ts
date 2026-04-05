import type { Invoice, JobStatus } from "@/types/database";

/**
 * Finance tabs. **All** is first in the UI; it shows every invoice in the selected period.
 * Other tabs slice the same list by linked job status + invoice status.
 */
export const INVOICE_PIPELINE_TAB_ORDER = [
  "all",
  "audit_required",
  "ongoing",
  "review_approve",
  "awaiting_payment",
  "overdue",
  "paid",
  "cancelled",
  "deleted",
] as const;

export type InvoicePipelineTab = (typeof INVOICE_PIPELINE_TAB_ORDER)[number];

/** Job reached a handoff or terminal state — no longer "ongoing" field work. */
const JOB_CLOSED_FOR_INVOICE_PIPELINE: ReadonlySet<JobStatus> = new Set([
  "completed",
  "awaiting_payment",
  "cancelled",
  "deleted",
]);

function jobIsNotYetClosed(status: JobStatus): boolean {
  return !JOB_CLOSED_FOR_INVOICE_PIPELINE.has(status);
}

/**
 * Maps an invoice + linked job row into a finance tab (never `"all"` — that bucket is implicit).
 *
 * Job-driven flow:
 * - **Ongoing** — job still open (not completed, not awaiting payment, not cancelled).
 * - **Review & approve** — job `completed` (work finished; office review before collection).
 * - **Awaiting payment** — job `awaiting_payment` after approve (same row set as job card).
 *
 * Invoice row overrides: cancelled, audit_required, paid, overdue (clock) still win.
 */
export function invoicePipelineTab(
  inv: Invoice,
  job: { status: JobStatus } | null | undefined
): Exclude<InvoicePipelineTab, "all"> {
  if (inv.deleted_at) return "deleted";
  if (inv.status === "cancelled") return "cancelled";
  if (inv.status === "audit_required") return "audit_required";
  if (inv.status === "paid") return "paid";
  if (inv.status === "overdue") return "overdue";

  const ref = inv.job_reference?.trim();
  if (ref && job) {
    if (job.status === "cancelled") return "awaiting_payment";
    if (jobIsNotYetClosed(job.status)) return "ongoing";
    if (job.status === "completed") return "review_approve";
    if (job.status === "awaiting_payment") return "awaiting_payment";
  } else if (!ref) {
    if (inv.status === "draft") return "ongoing";
    return "awaiting_payment";
  }

  return "awaiting_payment";
}
