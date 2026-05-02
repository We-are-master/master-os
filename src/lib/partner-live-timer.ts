import type { Job } from "@/types/database";
import { isJobOnSiteWorkStatus } from "@/lib/job-phases";

/** Seed live timer when staff sets job to phase 1 from Fixfy OS (partner app uses the same columns via RPC). */
export function officePartnerTimerStartPatch(): Pick<
  Job,
  | "partner_timer_started_at"
  | "partner_timer_ended_at"
  | "partner_timer_accum_paused_ms"
  | "partner_timer_is_paused"
  | "partner_timer_pause_began_at"
> {
  const now = new Date().toISOString();
  return {
    partner_timer_started_at: now,
    partner_timer_ended_at: null,
    partner_timer_accum_paused_ms: 0,
    partner_timer_is_paused: false,
    partner_timer_pause_began_at: null,
  };
}

/** End on-site timer when work is finished (final check, invoice, completed, or pause back to scheduled). */
export function officePartnerTimerEndPatch(): Pick<Job, "partner_timer_ended_at" | "partner_timer_is_paused" | "partner_timer_pause_began_at"> {
  return {
    partner_timer_ended_at: new Date().toISOString(),
    partner_timer_is_paused: false,
    partner_timer_pause_began_at: null,
  };
}

/** Full timer reset — used when the job goes back to unassigned (partner removed / re-queued for auto-assign). */
export function officePartnerTimerResetPatch(): Pick<
  Job,
  | "partner_timer_started_at"
  | "partner_timer_ended_at"
  | "partner_timer_accum_paused_ms"
  | "partner_timer_is_paused"
  | "partner_timer_pause_began_at"
> {
  return {
    partner_timer_started_at: null,
    partner_timer_ended_at: null,
    partner_timer_accum_paused_ms: 0,
    partner_timer_is_paused: false,
    partner_timer_pause_began_at: null,
  };
}

type TimerFields = Pick<
  Job,
  | "partner_timer_started_at"
  | "partner_timer_ended_at"
  | "partner_timer_accum_paused_ms"
  | "partner_timer_is_paused"
  | "partner_timer_pause_began_at"
>;

/** Active work ms (excludes paused time). Null if timer never started. */
export function computePartnerLiveTimerActiveMs(job: TimerFields, nowMs: number = Date.now()): number | null {
  const started = job.partner_timer_started_at;
  if (!started) return null;

  const startMs = new Date(started).getTime();
  const endedAt = job.partner_timer_ended_at;

  if (endedAt) {
    const endMs = new Date(endedAt).getTime();
    const accum = Number(job.partner_timer_accum_paused_ms ?? 0) || 0;
    return Math.max(0, endMs - startMs - accum);
  }

  let accumPaused = Number(job.partner_timer_accum_paused_ms ?? 0) || 0;
  if (job.partner_timer_is_paused && job.partner_timer_pause_began_at) {
    accumPaused += Math.max(0, nowMs - new Date(job.partner_timer_pause_began_at).getTime());
  }

  return Math.max(0, nowMs - startMs - accumPaused);
}

export function isPartnerLiveTimerRunning(job: TimerFields): boolean {
  return !!(job.partner_timer_started_at && !job.partner_timer_ended_at);
}

/** Timer fields to merge when changing job status from office or bulk actions. */
export function statusChangePartnerTimerPatch(
  job: Pick<Job, "status" | "partner_timer_started_at" | "partner_timer_ended_at">,
  newStatus: Job["status"],
): Partial<Job> {
  const patch: Partial<Job> = {};
  const wasOnSite = isJobOnSiteWorkStatus(job.status);
  const running = isPartnerLiveTimerRunning(job);

  /** Back to unassigned / auto-assign — full reset so re-assigning a partner starts from 0. */
  if (newStatus === "unassigned" || newStatus === "auto_assigning") {
    return officePartnerTimerResetPatch();
  }

  /** Reopen from final check — resume without resetting partner start / accum. */
  if (newStatus === "in_progress_phase1" && job.status === "final_check") {
    return {
      partner_timer_ended_at: null,
      partner_timer_is_paused: false,
      partner_timer_pause_began_at: null,
    };
  }

  /** Resume after office pause (scheduled) — do not apply fresh start patch if work already ended once. */
  if (
    newStatus === "in_progress_phase1" &&
    (job.status === "scheduled" || job.status === "late" || job.status === "on_hold") &&
    job.partner_timer_ended_at
  ) {
    return {
      partner_timer_ended_at: null,
      partner_timer_is_paused: false,
      partner_timer_pause_began_at: null,
    };
  }

  if (newStatus === "in_progress_phase1" && (!wasOnSite || job.partner_timer_ended_at)) {
    Object.assign(patch, officePartnerTimerStartPatch());
  }
  if (
    running &&
    (newStatus === "final_check" ||
      newStatus === "awaiting_payment" ||
      newStatus === "completed" ||
      (newStatus === "scheduled" && wasOnSite) ||
      newStatus === "on_hold" ||
      newStatus === "cancelled")
  ) {
    Object.assign(patch, officePartnerTimerEndPatch());
  }
  return patch;
}

export function formatPartnerLiveTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
