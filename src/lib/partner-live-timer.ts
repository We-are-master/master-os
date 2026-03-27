import type { Job } from "@/types/database";

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

export function formatPartnerLiveTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
