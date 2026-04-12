import type { JobStatus } from "@/types/database";
import { isJobOnSiteWorkStatus } from "@/lib/job-phases";
import { formatLocalYmd, jobFinishYmd, jobScheduleYmd } from "@/lib/schedule-calendar";

/** Raw DB status + soft-delete; excludes completed, cancelled, and archived (deleted) jobs. */
export type JobOverdueInput = {
  status: JobStatus | string;
  deleted_at?: string | null;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  scheduled_finish_date?: string | null;
};

const EXCLUDED_FROM_OVERDUE = new Set<string>(["completed", "cancelled", "deleted", "on_hold"]);

/**
 * True when the job is behind schedule in the local calendar and not completed / cancelled / archived.
 *
 * **On-site in progress** (`in_progress_phase*`): overdue only when {@link jobFinishYmd} exists and is
 * strictly before today — i.e. the expected finish date has passed (arrival day alone does not count).
 * Other active statuses still use the visit / schedule day ({@link jobScheduleYmd}).
 */
export function isJobOverdue(job: JobOverdueInput, today: Date = new Date()): boolean {
  if (job.deleted_at) return false;
  if (EXCLUDED_FROM_OVERDUE.has(String(job.status))) return false;
  const todayStr = formatLocalYmd(today);

  if (isJobOnSiteWorkStatus(job.status as JobStatus)) {
    const finish = jobFinishYmd(job);
    if (!finish) return false;
    const finishStr = `${finish.y}-${String(finish.m).padStart(2, "0")}-${String(finish.d).padStart(2, "0")}`;
    return finishStr < todayStr;
  }

  const sched = jobScheduleYmd(job);
  if (!sched) return false;
  const schedStr = `${sched.y}-${String(sched.m).padStart(2, "0")}-${String(sched.d).padStart(2, "0")}`;
  return schedStr < todayStr;
}
