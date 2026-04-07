import type { Job } from "@/types/database";
import { jobBillableRevenue } from "@/lib/job-financials";

/**
 * Schedule & Dispatch (frontend): exclude terminal / non-operational rows from calendar + KPIs.
 * Does not change API contracts — used only to filter the job list already loaded for the page.
 */
export function isJobExcludedFromScheduleView(
  job: Pick<Job, "status" | "deleted_at" | "partner_cancelled_at">,
): boolean {
  if (job.deleted_at) return true;
  const st = job.status as string;
  if (st === "deleted" || st === "cancelled" || st === "lost") return true;
  if (job.partner_cancelled_at) return true;
  return false;
}

/** Billable total for the monthly revenue KPI (same basis as job detail finance). */
export function sumScheduleMonthRevenue(
  jobs: Pick<Job, "client_price" | "extras_amount">[],
): number {
  let sum = 0;
  for (const j of jobs) {
    sum += jobBillableRevenue(j);
  }
  return Math.round(sum * 100) / 100;
}

/** Show bar as “work done”: faded + strikethrough (completed or awaiting payment). */
export function scheduleJobBarDoneVisually(job: Pick<Job, "status">): boolean {
  return job.status === "completed" || job.status === "awaiting_payment";
}

/** Extra emphasis for unassigned pipeline (attention-needed). */
export function scheduleJobNeedsAssignmentHighlight(job: Pick<Job, "status">): boolean {
  return job.status === "unassigned" || job.status === "auto_assigning";
}
