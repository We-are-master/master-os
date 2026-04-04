import type { Invoice, JobStatus } from "@/types/database";

/** Finance tabs aligned with self-bill workflow + job lifecycle. */
export const INVOICE_PIPELINE_TAB_ORDER = [
  "audit_required",
  "ongoing",
  "review_approve",
  "awaiting_payment",
  "overdue",
  "paid",
  "all",
  "cancelled",
] as const;

export type InvoicePipelineTab = (typeof INVOICE_PIPELINE_TAB_ORDER)[number];

/** Job still in field / office pipeline before completed handoff. */
const JOB_OPEN_STATUSES: ReadonlySet<JobStatus> = new Set([
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
  "in_progress_phase1",
  "in_progress_phase2",
  "in_progress_phase3",
  "final_check",
  "need_attention",
]);

/**
 * Maps an invoice + linked job row into a finance tab.
 * Precedence: cancelled → audit_required → paid → overdue → job phase → unlinked draft.
 */
export function invoicePipelineTab(
  inv: Invoice,
  job: { status: JobStatus } | null | undefined
): Exclude<InvoicePipelineTab, "all"> {
  if (inv.status === "cancelled") return "cancelled";
  if (inv.status === "audit_required") return "audit_required";
  if (inv.status === "paid") return "paid";
  if (inv.status === "overdue") return "overdue";

  const ref = inv.job_reference?.trim();
  if (ref && job) {
    if (job.status === "cancelled") return "awaiting_payment";
    if (JOB_OPEN_STATUSES.has(job.status)) return "ongoing";
    if (job.status === "completed") return "review_approve";
    if (job.status === "awaiting_payment") return "awaiting_payment";
  } else if (!ref) {
    if (inv.status === "draft") return "ongoing";
    return "awaiting_payment";
  }

  return "awaiting_payment";
}
