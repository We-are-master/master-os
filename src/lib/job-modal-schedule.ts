import { scheduledEndFromWindow } from "@/lib/job-arrival-window";
import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";

/** Preview line for create-job modals (matches job detail copy). */
export function jobModalClientArrivalPreview(
  scheduledDate: string,
  arrivalFromHm: string,
  windowMinutesStr: string,
): string | null {
  const d = scheduledDate.trim();
  const t = arrivalFromHm.trim();
  const wmRaw = windowMinutesStr.trim();
  if (!d || !t) return null;
  const windowMins = wmRaw ? Number(wmRaw) : NaN;
  const hasWindow = Number.isFinite(windowMins) && windowMins > 0;
  const startIso = `${d}T${t}:00`;
  if (!hasWindow) {
    return `Client & partner will see: Arrival time ${formatHourMinuteAmPm(new Date(startIso))} — choose window length for a range (2–3h typical).`;
  }
  const endIso = scheduledEndFromWindow(d, t, windowMins);
  const range = formatArrivalTimeRange(startIso, endIso);
  return range ? `Client & partner will see: Arrival time (${range})` : null;
}

export type ResolveJobModalScheduleResult =
  | { ok: true; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string }
  | { ok: false; error: string };

/** Shared rules for New Job, Quote→Job, and Request→Job modals. */
export function resolveJobModalSchedule(input: {
  scheduled_date?: string;
  arrival_from: string;
  arrival_window_mins: string;
  hasPartner: boolean;
}): ResolveJobModalScheduleResult {
  const scheduled_date = input.scheduled_date?.trim() || undefined;
  const hasFrom = !!input.arrival_from?.trim();
  const wmRaw = input.arrival_window_mins?.trim();
  const windowMins = wmRaw ? Number(wmRaw) : NaN;
  const hasWindow = Number.isFinite(windowMins) && windowMins > 0;

  if ((hasFrom && !hasWindow) || (!hasFrom && hasWindow)) {
    return { ok: false, error: "Set both arrival from and arrival window length, or leave both empty." };
  }
  if (input.hasPartner) {
    if (!scheduled_date) {
      return { ok: false, error: "Set a scheduled date before assigning a partner." };
    }
    if (!hasFrom || !hasWindow) {
      return { ok: false, error: "Set arrival from and window length when assigning a partner." };
    }
  }
  if (hasFrom && hasWindow && scheduled_date) {
    const endIso = scheduledEndFromWindow(scheduled_date, input.arrival_from, windowMins);
    const startMs = new Date(`${scheduled_date}T${input.arrival_from}:00`).getTime();
    const endMs = new Date(endIso).getTime();
    if (!(endMs > startMs)) {
      return { ok: false, error: "Arrival window end must be after start." };
    }
  }

  let scheduled_start_at: string | undefined;
  let scheduled_end_at: string | undefined;
  if (scheduled_date && hasFrom && hasWindow) {
    scheduled_start_at = `${scheduled_date}T${input.arrival_from}:00`;
    scheduled_end_at = scheduledEndFromWindow(scheduled_date, input.arrival_from, windowMins);
  } else if (scheduled_date && hasFrom) {
    scheduled_start_at = `${scheduled_date}T${input.arrival_from}:00`;
  }
  return { ok: true, scheduled_date, scheduled_start_at, scheduled_end_at };
}
