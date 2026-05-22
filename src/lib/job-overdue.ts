import type { JobStatus } from "@/types/database";
import { formatLocalYmd, jobScheduleYmd } from "@/lib/schedule-calendar";

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
  "in_progress",
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
 * Overdue badge only for Jobs Management buckets **Unassigned**, **Scheduled** (incl. `late`).
 * No badge once work has started (`in_progress`), final check, awaiting payment, on hold, completed, etc.
 *
 * **Unassigned / scheduled / late:** strictly before today on {@link jobScheduleYmd} (needs a schedule).
 */
export function isJobOverdue(job: JobOverdueInput, today: Date = new Date()): boolean {
  if (job.deleted_at) return false;
  const st = String(job.status);
  if (NEVER_OVERDUE_BADGE.has(st)) return false;
  const todayStr = formatLocalYmd(today);

  if (!OVERDUE_BY_SCHEDULE_DAY_STATUSES.has(st)) return false;

  const sched = jobScheduleYmd(job);
  if (!sched) return false;
  const schedStr = `${sched.y}-${String(sched.m).padStart(2, "0")}-${String(sched.d).padStart(2, "0")}`;
  return schedStr < todayStr;
}
