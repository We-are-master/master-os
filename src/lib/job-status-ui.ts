import type { BadgeVariant } from "@/components/ui/badge";
import type { JobStatus } from "@/types/database";

/**
 * Single source of truth for job status badge colours across Jobs, Schedule, Job detail, Partners.
 *
 * Product palette:
 * - Unassigned / Lost & cancelled: red
 * - Scheduled: green
 * - In progress (incl. assigning): blue
 * - Final checks: purple (violet)
 * - Awaiting payment: yellow (amber)
 * - Late: orange (distinct from unassigned red)
 */
export const JOB_STATUS_BADGE_VARIANT: Record<JobStatus, BadgeVariant> = {
  unassigned: "danger",
  auto_assigning: "info",
  scheduled: "success",
  late: "orange",
  in_progress: "info",
  final_check: "violet",
  awaiting_payment: "warning",
  need_attention: "danger",
  on_hold: "warning",
  completed: "success",
  cancelled: "danger",
  deleted: "default",
};

export function jobStatusBadgeVariant(status: string): BadgeVariant {
  return JOB_STATUS_BADGE_VARIANT[status as JobStatus] ?? "default";
}

/**
 * Canonical UI labels for job statuses. Single source of truth across Jobs, Schedule,
 * Pulse, Beacon, Job detail. Use this instead of inventing local synonyms like
 * "On-site" or "Wrap-up" — keeps the product language consistent with the data model.
 */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  unassigned: "Unassigned",
  auto_assigning: "Assigning",
  scheduled: "Scheduled",
  late: "Late",
  in_progress: "In Progress",
  final_check: "Final Checks",
  awaiting_payment: "Awaiting Payment",
  need_attention: "Needs Attention",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
  deleted: "Deleted",
};

export function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABEL[status as JobStatus] ?? status.replace(/_/g, " ");
}

/** Partner column in Jobs list — assigned name vs auto-assign vs plain unassigned. */
export type JobPartnerListKind = "partner" | "auto_assign" | "unassigned";

export function jobPartnerListKind(job: {
  partner_id?: string | null;
  partner_name?: string | null;
  status?: string | null;
}): JobPartnerListKind {
  if (job.partner_id || job.partner_name?.trim()) return "partner";
  if (job.status === "auto_assigning") return "auto_assign";
  return "unassigned";
}

/** Accent for Jobs management tabs (underline + count chip when active). */
export type JobsManagementTabAccent =
  | "neutral"
  | "red"
  | "green"
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "slate";

export const JOBS_MANAGEMENT_TAB_ACCENTS: Record<string, JobsManagementTabAccent> = {
  all: "neutral",
  action_required: "red",
  unassigned: "red",
  scheduled: "green",
  in_progress: "blue",
  on_hold: "amber",
  final_check: "violet",
  awaiting_payment: "amber",
  completed: "emerald",
  cancelled: "red",
  deleted: "slate",
  closed: "neutral",
};
