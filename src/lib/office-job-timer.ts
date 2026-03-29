import type { Job } from "@/types/database";
import { isJobOnSiteWorkStatus } from "@/lib/job-phases";

/** Frozen + current running segment (seconds). Never decreases. */
export function computeOfficeTimerElapsedSeconds(
  job: Pick<Job, "timer_elapsed_seconds" | "timer_last_started_at" | "timer_is_running">,
  nowMs: number = Date.now(),
): number {
  const base = Number(job.timer_elapsed_seconds ?? 0) || 0;
  if (!job.timer_is_running || !job.timer_last_started_at) return base;
  const seg = Math.max(0, Math.floor((nowMs - new Date(job.timer_last_started_at).getTime()) / 1000));
  return base + seg;
}

function freezeOfficeElapsed(
  job: Pick<Job, "timer_elapsed_seconds" | "timer_last_started_at" | "timer_is_running">,
  nowMs: number,
): number {
  return computeOfficeTimerElapsedSeconds(job, nowMs);
}

/** Merge into status updates from the job detail page — preserves elapsed; never resets total on resume/reopen. */
export function statusChangeOfficeTimerPatch(
  job: Pick<Job, "status" | "timer_elapsed_seconds" | "timer_last_started_at" | "timer_is_running">,
  newStatus: Job["status"],
): Partial<Job> {
  const now = new Date().toISOString();
  const nowMs = Date.now();

  const stopRunningPreserve = (): Partial<Job> => ({
    timer_elapsed_seconds: freezeOfficeElapsed(job, nowMs),
    timer_is_running: false,
    timer_last_started_at: null,
  });

  if (isJobOnSiteWorkStatus(job.status)) {
    if (newStatus === "scheduled") return stopRunningPreserve();
    if (newStatus === "final_check") return stopRunningPreserve();
    if (newStatus === "awaiting_payment" || newStatus === "cancelled" || newStatus === "completed") {
      return stopRunningPreserve();
    }
  }

  if ((job.status === "scheduled" || job.status === "late") && newStatus === "in_progress_phase1") {
    const elapsed = Number(job.timer_elapsed_seconds ?? 0) || 0;
    const hasPriorWork = elapsed > 0;
    if (hasPriorWork) {
      return { timer_last_started_at: now, timer_is_running: true };
    }
    return { timer_elapsed_seconds: 0, timer_last_started_at: now, timer_is_running: true };
  }

  if (job.status === "final_check" && newStatus === "in_progress_phase1") {
    return { timer_last_started_at: now, timer_is_running: true };
  }

  return {};
}

export function formatOfficeTimer(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
