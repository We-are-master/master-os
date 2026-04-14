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

const NEVER_OVERDUE_BADGE = new Set<string>([
  "completed",
  "cancelled",
  "deleted",
  "on_hold",
  "final_check",
  "need_attention",
  "awaiting_payment",
]);

/** Schedule-day overdue only for pipeline before final check / payment. */
const OVERDUE_BY_SCHEDULE_DAY_STATUSES = new Set<string>([
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
]);

/**
 * Overdue badge only for Jobs Management buckets **Unassigned**, **Scheduled** (incl. `late`), and
 * **In progress** on-site phases. No badge on final check, awaiting payment, on hold, completed, etc.
 *
 * **In progress (`in_progress_phase*`):** {@link jobFinishYmd} must exist and be strictly before today.
 * **Unassigned / scheduled / late:** strictly before today on {@link jobScheduleYmd} (needs a schedule).
 */
export function isJobOverdue(job: JobOverdueInput, today: Date = new Date()): boolean {
  if (job.deleted_at) return false;
  const st = String(job.status);
  if (NEVER_OVERDUE_BADGE.has(st)) return false;
  const todayStr = formatLocalYmd(today);

  if (isJobOnSiteWorkStatus(job.status as JobStatus)) {
    const finish = jobFinishYmd(job);
    if (!finish) return false;
    const finishStr = `${finish.y}-${String(finish.m).padStart(2, "0")}-${String(finish.d).padStart(2, "0")}`;
    return finishStr < todayStr;
  }

  if (!OVERDUE_BY_SCHEDULE_DAY_STATUSES.has(st)) return false;

  const sched = jobScheduleYmd(job);
  if (!sched) return false;
  const schedStr = `${sched.y}-${String(sched.m).padStart(2, "0")}-${String(sched.d).padStart(2, "0")}`;
  return schedStr < todayStr;
}
