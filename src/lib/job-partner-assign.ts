import type { Job, JobStatus } from "@/types/database";

/** When a partner is cleared, these statuses must become `unassigned` (e.g. `late` without a partner). */
export const JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED: readonly JobStatus[] = [
  "scheduled",
  "late",
  "auto_assigning",
  "in_progress_phase1",
  "in_progress_phase2",
  "in_progress_phase3",
];

/** Fields required before a partner can be assigned (or swapped) on a job. */
export type PartnerAssignGateFields = Pick<
  Job,
  "property_address" | "scope" | "scheduled_date" | "scheduled_start_at" | "partner_id" | "partner_ids"
>;

function hasScheduledDateOrStart(job: Pick<Job, "scheduled_date" | "scheduled_start_at">): boolean {
  const d = job.scheduled_date;
  if (d != null && String(d).trim() !== "") return true;
  const t = job.scheduled_start_at;
  if (t != null && String(t).trim() !== "") return true;
  return false;
}

/**
 * Returns an English error message if the job cannot have a partner assigned yet; otherwise null.
 */
export function getPartnerAssignmentBlockReason(job: PartnerAssignGateFields): string | null {
  const addr = (job.property_address ?? "").trim();
  if (!addr) {
    return "Add a property address before assigning a partner.";
  }
  const sc = (job.scope ?? "").trim();
  if (!sc) {
    return "Add a scope of work before assigning a partner.";
  }
  if (!hasScheduledDateOrStart(job)) {
    return "Set a scheduled date (and time if needed) before assigning a partner.";
  }
  return null;
}

export function jobHasPartnerSet(job: Pick<Job, "partner_id" | "partner_ids">): boolean {
  const pid = job.partner_id != null && String(job.partner_id).trim() !== "";
  if (pid) return true;
  const ids = job.partner_ids;
  return Array.isArray(ids) && ids.some((id) => id != null && String(id).trim() !== "");
}
