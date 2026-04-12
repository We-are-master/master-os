import { formatLocalYmd } from "@/lib/schedule-calendar";
import { scheduledEndFromWindow } from "@/lib/job-arrival-window";
import type { Job } from "@/types/database";

/** Civil YYYY-MM-DD for the snapshot arrival day (prefer date column, else local day from start timestamp). */
export function onHoldSnapshotArrivalYmd(job: Pick<Job, "on_hold_snapshot_scheduled_date" | "on_hold_snapshot_scheduled_start_at">): string | null {
  const d = job.on_hold_snapshot_scheduled_date;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.trim())) return d.trim().slice(0, 10);
  const start = job.on_hold_snapshot_scheduled_start_at;
  if (start) {
    const dt = new Date(start);
    if (!Number.isNaN(dt.getTime())) return formatLocalYmd(dt);
  }
  return null;
}

/** HH:mm in local time from an ISO-ish timestamp. */
export function localHmFromIsoTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const h = String(dt.getHours()).padStart(2, "0");
  const m = String(dt.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function windowMinutesFromSnapshotStartEnd(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

/**
 * When the snapshot arrival day is still strictly after "today" (local), user may resume with the same date.
 * When it is today or in the past, they must pick a date strictly after today.
 */
export function resumeRequiresStrictFutureArrivalDate(snapshotYmd: string | null): boolean {
  const today = formatLocalYmd(new Date());
  if (!snapshotYmd) return true;
  return snapshotYmd <= today;
}

export function validateResumeArrivalDate(args: {
  snapshotYmd: string | null;
  selectedYmd: string;
}): { ok: true } | { ok: false; message: string } {
  const selected = args.selectedYmd.trim().slice(0, 10);
  if (!selected) return { ok: false, message: "Set an arrival date." };
  const today = formatLocalYmd(new Date());
  if (selected < today) return { ok: false, message: "Arrival date cannot be in the past." };
  if (resumeRequiresStrictFutureArrivalDate(args.snapshotYmd) && !(selected > today)) {
    return { ok: false, message: "The saved arrival date is no longer in the future — choose a later date." };
  }
  return { ok: true };
}

/** Build schedule fields for resume from modal date/time + snapshot window + finish date. */
export function buildSchedulePatchForResume(args: {
  arrivalDateYmd: string;
  arrivalTimeHm: string;
  snapshotStartAt: string | null | undefined;
  snapshotEndAt: string | null | undefined;
  snapshotFinishDate: string | null | undefined;
  /** Used when the snapshot did not store a finish date. */
  fallbackFinishDate?: string | null;
}): Pick<Job, "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "scheduled_finish_date"> {
  const d = args.arrivalDateYmd.trim().slice(0, 10);
  const t = args.arrivalTimeHm.trim();
  const wm = windowMinutesFromSnapshotStartEnd(args.snapshotStartAt, args.snapshotEndAt);
  const scheduled_start_at = t ? `${d}T${t}:00` : null;
  let scheduled_end_at: string | null = null;
  if (scheduled_start_at && wm != null && wm > 0) {
    scheduled_end_at = scheduledEndFromWindow(d, t, wm);
  }
  const snapFinish =
    typeof args.snapshotFinishDate === "string" && args.snapshotFinishDate.trim()
      ? args.snapshotFinishDate.trim().slice(0, 10)
      : null;
  const fb =
    typeof args.fallbackFinishDate === "string" && args.fallbackFinishDate.trim()
      ? args.fallbackFinishDate.trim().slice(0, 10)
      : null;
  const finish = snapFinish ?? fb;
  return {
    scheduled_date: d || null,
    scheduled_start_at: scheduled_start_at,
    scheduled_end_at: scheduled_end_at,
    scheduled_finish_date: finish,
  } as Pick<Job, "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "scheduled_finish_date">;
}
