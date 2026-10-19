import type { Job } from "@/types/database";
import { isJobOnSiteWorkStatus } from "@/lib/job-phases";

/** Frozen + current running segment (seconds). Never decreases. */
export function computeOfficeTimerElapsedSeconds(
  job: Pick<Job, "timer_elapsed_seconds" | "timer_last_started_at" | "timer_is_running"> &
    Partial<Pick<Job, "partner_timer_started_at" | "partner_timer_ended_at" | "partner_timer_accum_paused_ms">>,
  nowMs: number = Date.now(),
): number {
  const base = Number(job.timer_elapsed_seconds ?? 0) || 0;
  if (!job.timer_is_running || !job.timer_last_started_at) {
    if (base > 0) return base;
    /**
     * Sem timer do escritório (as colunas `timer_*` nem existem no banco hoje), vale
     * a janela do parceiro: entrada e saída, menos as pausas. É onde o Edit job
     * finances grava o horário de um job por hora (19/10/2026); sem isto o job por
     * hora cobrava sempre o mínimo de 1h ("Logged: 0s").
     */
    const ini = job.partner_timer_started_at ? new Date(job.partner_timer_started_at).getTime() : NaN;
    const fim = job.partner_timer_ended_at ? new Date(job.partner_timer_ended_at).getTime() : NaN;
    if (Number.isFinite(ini) && Number.isFinite(fim) && fim > ini) {
      const pausas = Number(job.partner_timer_accum_paused_ms ?? 0) || 0;
      return Math.max(0, Math.floor((fim - ini - pausas) / 1000));
    }
    return base;
  }
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
    if (newStatus === "scheduled" || newStatus === "on_hold") return stopRunningPreserve();
    if (newStatus === "final_check") return stopRunningPreserve();
    if (newStatus === "awaiting_payment" || newStatus === "cancelled" || newStatus === "completed") {
      return stopRunningPreserve();
    }
  }

  /** Mark completed — freeze elapsed (awaiting_payment is not on-site, so handle explicitly). */
  if (job.status === "awaiting_payment" && newStatus === "completed") {
    return stopRunningPreserve();
  }

  /** Reopen completed (or payment step) to scheduled — keep total frozen until Start Job resumes. */
  if (newStatus === "scheduled" && (job.status === "completed" || job.status === "awaiting_payment")) {
    return stopRunningPreserve();
  }

  if ((job.status === "scheduled" || job.status === "late" || job.status === "on_hold") && newStatus === "in_progress") {
    const elapsed = Number(job.timer_elapsed_seconds ?? 0) || 0;
    const hasPriorWork = elapsed > 0;
    if (hasPriorWork) {
      return { timer_last_started_at: now, timer_is_running: true };
    }
    return { timer_elapsed_seconds: 0, timer_last_started_at: now, timer_is_running: true };
  }

  if (job.status === "final_check" && newStatus === "in_progress") {
    return { timer_last_started_at: now, timer_is_running: true };
  }

  return {};
}

export function formatOfficeTimer(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const d = Math.floor(totalSeconds / 86400);
  const remAfterDays = totalSeconds % 86400;
  const h = Math.floor(remAfterDays / 3600);
  const m = Math.floor((remAfterDays % 3600) / 60);
  const s = remAfterDays % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
