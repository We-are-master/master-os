import type { Job, JobStatus } from "@/types/database";
import { JOB_ONSITE_PROGRESS_STATUSES } from "@/lib/job-phases";

/** When a partner is cleared, these statuses must become `unassigned` (e.g. `late` without a partner). */
export const JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED: readonly JobStatus[] = [
  "scheduled",
  "late",
  "auto_assigning",
  "in_progress",
];

/** Pre-booked pipeline steps that become `scheduled` when a partner is first assigned. */
export const JOB_STATUSES_SCHEDULE_ON_PARTNER_ASSIGN: readonly JobStatus[] = [
  "unassigned",
  "auto_assigning",
  "on_hold",
];

const ON_HOLD_CLEAR_PATCH: Partial<Job> = {
  on_hold_previous_status: null,
  on_hold_at: null,
  on_hold_reason: null,
  on_hold_reason_preset_id: null,
  on_hold_complaint_description: null,
  on_hold_snapshot_scheduled_date: null,
  on_hold_snapshot_scheduled_start_at: null,
  on_hold_snapshot_scheduled_end_at: null,
  on_hold_snapshot_scheduled_finish_date: null,
};

/** Clear auto-assign broadcast state once a partner is picked (manual or accept). */
export function clearAutoAssignQueuePatch(): Partial<Job> {
  return {
    auto_assign_invited_partner_ids: null,
    auto_assign_expires_at: null,
  };
}

/**
 * When the office assigns a partner from the pre-booked queue, bump the job to
 * `scheduled` so Zendesk syncs to Scheduled (not Auto-Assigning / On Hold).
 */
export function partnerAssignStatusPatch(beforeStatus: JobStatus): Partial<Job> {
  if (!JOB_STATUSES_SCHEDULE_ON_PARTNER_ASSIGN.includes(beforeStatus)) return {};
  const patch: Partial<Job> = { status: "scheduled", ...clearAutoAssignQueuePatch() };
  if (beforeStatus === "on_hold") {
    Object.assign(patch, ON_HOLD_CLEAR_PATCH);
  }
  return patch;
}

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

/**
 * True when the row is still "booked" in the DB (`scheduled` / `late` / on-site) but has no partner.
 * Those jobs belong in the Unassigned tab until a partner is set (not Scheduled / In progress).
 */
export function jobIsBookedPipelineWithoutPartner(
  job: Pick<Job, "status" | "partner_id" | "partner_ids">,
): boolean {
  if (jobHasPartnerSet(job)) return false;
  const st = job.status;
  return (
    st === "scheduled" ||
    st === "late" ||
    (JOB_ONSITE_PROGRESS_STATUSES as readonly string[]).includes(st)
  );
}

/**
 * Status shown in badges / lists when the DB row is still booked (`late`, `scheduled`, …) but there is no partner.
 * Business logic elsewhere should keep using `job.status` until `updateJob` or migration aligns the row.
 */
export function effectiveJobStatusForDisplay(
  job: Pick<Job, "status" | "partner_id" | "partner_ids">,
): JobStatus {
  /** Stale rows: partner set but status never bumped from pre-booked queue. */
  if (
    jobHasPartnerSet(job) &&
    (job.status === "unassigned" || job.status === "auto_assigning" || job.status === "on_hold")
  ) {
    return "scheduled";
  }
  if (jobIsBookedPipelineWithoutPartner(job)) return "unassigned";
  return job.status;
}
