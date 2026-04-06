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
  in_progress_phase1: "info",
  in_progress_phase2: "info",
  in_progress_phase3: "info",
  final_check: "violet",
  awaiting_payment: "warning",
  need_attention: "danger",
  completed: "success",
  cancelled: "danger",
  deleted: "default",
};

export function jobStatusBadgeVariant(status: string): BadgeVariant {
  return JOB_STATUS_BADGE_VARIANT[status as JobStatus] ?? "default";
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
  unassigned: "red",
  scheduled: "green",
  in_progress: "blue",
  final_check: "violet",
  awaiting_payment: "amber",
  completed: "emerald",
  cancelled: "red",
  deleted: "slate",
};
