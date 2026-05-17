import { canonicalArrivalSlotValues } from "@/lib/job-arrival-window";
import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";
import { addMinutesUkWallClock, ukWallClockToUtcIso } from "@/lib/utils/uk-time";
import type { JobKind, JobRecurrenceByday, JobRecurrencePattern } from "@/types/database";
import { validateRule } from "@/lib/job-recurrence";

/** Format HH:MM UK wall time for client-facing preview (stable across DST). */
function formatUkWallClockHmAmPm(hm: string): string {
  const iso = ukWallClockToUtcIso("2026-06-15", hm);
  if (!iso) return hm;
  return formatHourMinuteAmPm(new Date(iso));
}

/** Preview line for create-job modals (matches job detail copy). */
export function jobModalClientArrivalPreview(
  scheduledDate: string,
  arrivalFromHm: string,
  windowMinutesStr: string,
  opts?: { useArrivalSlots?: boolean },
): string | null {
  const d = scheduledDate.trim();
  const t = arrivalFromHm.trim();
  const wmRaw = windowMinutesStr.trim();
  if (!d || !t) return null;
  const windowMins = wmRaw ? Number(wmRaw) : NaN;
  const hasWindow = Number.isFinite(windowMins) && windowMins > 0;

  if (opts?.useArrivalSlots && hasWindow) {
    const { from, mins } = canonicalArrivalSlotValues(t, wmRaw);
    const end = addMinutesUkWallClock(d, from, Number(mins));
    if (!end.hm) return null;
    const range = `${formatUkWallClockHmAmPm(from)} – ${formatUkWallClockHmAmPm(end.hm)}`;
    return `Client & partner will see: Arrival time (${range})`;
  }

  // Form inputs are UK wall-clock — convert to a proper UTC ISO so the
  // UK-timezone formatters render the same hours back.
  const startIso = ukWallClockToUtcIso(d, t);
  if (!startIso) return null;
  if (!hasWindow) {
    return `Client & partner will see: Arrival time ${formatHourMinuteAmPm(new Date(startIso))} — choose window length for a range (2–3h typical).`;
  }
  const endIso = new Date(new Date(startIso).getTime() + windowMins * 60_000).toISOString();
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
  let scheduled_start_at: string | undefined;
  let scheduled_end_at: string | undefined;
  if (scheduled_date && hasFrom) {
    const startIso = ukWallClockToUtcIso(scheduled_date, input.arrival_from);
    if (!startIso) {
      return { ok: false, error: "Invalid date or arrival time." };
    }
    scheduled_start_at = startIso;
    if (hasWindow) {
      const endIso = new Date(new Date(startIso).getTime() + windowMins * 60_000).toISOString();
      if (!(new Date(endIso).getTime() > new Date(startIso).getTime())) {
        return { ok: false, error: "Arrival window end must be after start." };
      }
      scheduled_end_at = endIso;
    }
  }
  return { ok: true, scheduled_date, scheduled_start_at, scheduled_end_at };
}

// ─── V2: kind-aware resolver (mig 158) ─────────────────────────────────────

/**
 * Output payload that maps directly to columns on `jobs`. Consumers spread
 * this into their createJob / convertToJob payload.
 *
 * For recurring, `payload` describes the FIRST occurrence (job row to
 * insert) and `series` describes the row to insert in
 * `job_recurrence_series`. The createJobOrSeries service handles inserting
 * the series and expanding the rest.
 */
export interface JobScheduleV2Payload {
  job_kind: JobKind;
  scheduled_date?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  scheduled_finish_date?: string | null;
  expected_finish_at?: string | null;
}

/**
 * Series payload — produced by the resolver when kind=recurring. Maps to
 * `job_recurrence_series` rows. The resolver also produces a `payload` for
 * the first occurrence (anchor job).
 */
export interface JobScheduleV2SeriesPayload {
  rule: { pattern: JobRecurrencePattern; interval: number; byday?: JobRecurrenceByday[] };
  start_time: string;          // 'HH:MM:SS'
  end_time: string;            // 'HH:MM:SS'
  start_date: string;          // 'YYYY-MM-DD'
  end_date?: string | null;
  max_occurrences?: number | null;
}

export type ResolveJobModalScheduleV2Result =
  | { ok: true; payload: JobScheduleV2Payload; series?: JobScheduleV2SeriesPayload }
  | { ok: false; error: string };

/**
 * Form-side recurrence state — what the JobModalScheduleFields component
 * collects from the user before the resolver normalises it.
 */
export interface RecurrenceFormState {
  pattern: JobRecurrencePattern;
  /** Every N units of the pattern. */
  interval: number;
  /** Subset of weekdays — only meaningful when pattern='weekly'. */
  byday: JobRecurrenceByday[];
  /** Wall-clock 'HH:MM' (no seconds). */
  start_time: string;
  end_time: string;
  /** End-condition mode — only one of (end_date, max_occurrences) is used. */
  end_mode: "until" | "count";
  end_date: string;            // YYYY-MM-DD when end_mode='until'
  max_occurrences: string;     // numeric string when end_mode='count'
}

export const DEFAULT_RECURRENCE_FORM: RecurrenceFormState = {
  pattern: "weekly",
  interval: 1,
  byday: [],
  start_time: "09:00",
  end_time: "12:00",
  end_mode: "count",
  end_date: "",
  max_occurrences: "8",
};

/**
 * Kind-aware schedule resolver introduced by mig 158.
 *
 * - One-off (default): unchanged from `resolveJobModalSchedule` — start_date +
 *   arrival window. `scheduled_finish_date` is unset (calendar shows a single
 *   day). `expected_finish_at` is null.
 *
 * - Multi-day: start_date + start_time + end_date + end_time. Both
 *   `scheduled_finish_date` (date, for portal compat) and `expected_finish_at`
 *   (timestamptz, the actual end time) are populated. Arrival window is
 *   collapsed: `scheduled_start_at` = start_date+start_time on day 1,
 *   `scheduled_end_at` = end_date+end_time (used by partner app & calendar
 *   to render the bar across days).
 *
 * - Recurring: not supported here yet — handled by the recurring service in
 *   Etapa 6 (this resolver only validates and rejects).
 */
export function resolveJobModalScheduleV2(input: {
  kind: JobKind;
  // one-off fields
  scheduled_date?: string;
  arrival_from?: string;
  arrival_window_mins?: string;
  hasPartner: boolean;
  // multi-day fields
  end_date?: string;
  end_time?: string;
  // recurring fields
  recurrence?: RecurrenceFormState;
}): ResolveJobModalScheduleV2Result {
  if (input.kind === "recurring") {
    const start_date = input.scheduled_date?.trim() || "";
    if (!start_date) {
      return { ok: false, error: "Recurring jobs need a start date." };
    }
    const r = input.recurrence;
    if (!r) {
      return { ok: false, error: "Missing recurrence settings." };
    }
    if (!r.start_time?.trim() || !r.end_time?.trim()) {
      return { ok: false, error: "Set both start and end time for recurring jobs." };
    }
    if (r.end_time <= r.start_time) {
      return { ok: false, error: "Recurring end time must be after start time." };
    }
    const interval = Number.isFinite(r.interval) && r.interval >= 1
      ? Math.floor(r.interval)
      : 1;
    const byday = r.pattern === "weekly" && r.byday.length > 0 ? r.byday : undefined;
    const ruleErr = validateRule({ pattern: r.pattern, interval, byday });
    if (ruleErr) return { ok: false, error: ruleErr };

    let end_date: string | null = null;
    let max_occurrences: number | null = null;
    if (r.end_mode === "until") {
      const ed = r.end_date?.trim() || "";
      if (!ed) return { ok: false, error: "Set the end date for the recurring series." };
      if (ed < start_date) return { ok: false, error: "End date must be on or after the start date." };
      end_date = ed;
    } else {
      const n = Number(r.max_occurrences);
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, error: "Set the number of occurrences for the recurring series." };
      }
      max_occurrences = Math.floor(n);
    }

    // First occurrence (anchor job): single-day window using start/end times.
    const occStartIso = ukWallClockToUtcIso(start_date, r.start_time);
    const occEndIso = ukWallClockToUtcIso(start_date, r.end_time);
    if (!occStartIso || !occEndIso) {
      return { ok: false, error: "Invalid recurring start/end time." };
    }

    return {
      ok: true,
      payload: {
        job_kind: "recurring",
        scheduled_date: start_date,
        scheduled_start_at: occStartIso,
        scheduled_end_at: occEndIso,
        scheduled_finish_date: start_date,
        expected_finish_at: occEndIso,
      },
      series: {
        rule: { pattern: r.pattern, interval, byday },
        start_time: `${r.start_time}:00`,
        end_time: `${r.end_time}:00`,
        start_date,
        end_date,
        max_occurrences,
      },
    };
  }

  if (input.kind === "multi_day") {
    const start_date = input.scheduled_date?.trim() || "";
    const start_time = input.arrival_from?.trim() || "";
    const end_date = input.end_date?.trim() || "";
    const end_time = input.end_time?.trim() || "";

    if (!start_date || !start_time || !end_date || !end_time) {
      return { ok: false, error: "Multi-day jobs need a start date+time and an end date+time." };
    }
    const startIso = ukWallClockToUtcIso(start_date, start_time);
    const endIso = ukWallClockToUtcIso(end_date, end_time);
    if (!startIso || !endIso) {
      return { ok: false, error: "Invalid date/time format." };
    }
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (endMs <= startMs) {
      return { ok: false, error: "Multi-day end date/time must be after the start." };
    }

    return {
      ok: true,
      payload: {
        job_kind: "multi_day",
        scheduled_date: start_date,
        scheduled_start_at: startIso,
        scheduled_end_at: endIso,
        scheduled_finish_date: end_date,
        expected_finish_at: endIso,
      },
    };
  }

  // one_off (default) — delegate to legacy resolver and lift the result.
  const legacy = resolveJobModalSchedule({
    scheduled_date: input.scheduled_date,
    arrival_from: input.arrival_from ?? "",
    arrival_window_mins: input.arrival_window_mins ?? "",
    hasPartner: input.hasPartner,
  });
  if (!legacy.ok) return { ok: false, error: legacy.error };

  return {
    ok: true,
    payload: {
      job_kind: "one_off",
      scheduled_date: legacy.scheduled_date,
      scheduled_start_at: legacy.scheduled_start_at,
      scheduled_end_at: legacy.scheduled_end_at,
      scheduled_finish_date: null,
      expected_finish_at: null,
    },
  };
}
