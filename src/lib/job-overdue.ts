import type { JobStatus } from "@/types/database";
import { formatLocalYmd, jobScheduleYmd } from "@/lib/schedule-calendar";

/** Raw DB status + soft-delete; excludes completed, cancelled, and archived (deleted) jobs. */
export type JobOverdueInput = {
  status: JobStatus | string;
  deleted_at?: string | null;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
};

const EXCLUDED_FROM_OVERDUE = new Set<string>(["completed", "cancelled", "deleted", "on_hold"]);

/**
 * True when the job’s schedule day (same basis as calendar/lists: {@link jobScheduleYmd})
 * is strictly before today in the local calendar, and the job is not completed, cancelled, or archived.
 */
export function isJobOverdue(job: JobOverdueInput, today: Date = new Date()): boolean {
  if (job.deleted_at) return false;
  if (EXCLUDED_FROM_OVERDUE.has(String(job.status))) return false;
  const sched = jobScheduleYmd(job);
  if (!sched) return false;
  const schedStr = `${sched.y}-${String(sched.m).padStart(2, "0")}-${String(sched.d).padStart(2, "0")}`;
  return schedStr < formatLocalYmd(today);
}
