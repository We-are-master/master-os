/**
 * Pure helpers for job recurrence (mig 158).
 *
 * No DOM, no I/O — used both by the UI (preview line) and the service that
 * materialises occurrences as `jobs` rows. Mirrors the structure of
 * bill-recurrence.ts but supports `daily | weekly | monthly` with `interval`
 * and weekly `byday` (multiple weekdays per week).
 */

import type {
  JobRecurrenceByday,
  JobRecurrencePattern,
  JobRecurrenceRule,
} from "@/types/database";

/** Hard ceiling against runaway expansions. */
export const MAX_EXPANSION_OCCURRENCES = 365;

/** Eager-expand horizon when creating a series (days from start_date). */
export const DEFAULT_EXPAND_HORIZON_DAYS = 90;

/** Hour-of-day used to build local Dates from YMD strings — avoids DST edge cases. */
const SAFE_HOUR = 12;

const BYDAY_TO_JS_DAY: Record<JobRecurrenceByday, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

const JS_DAY_TO_BYDAY: Record<number, JobRecurrenceByday> = {
  0: "SU", 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA",
};

export const PATTERN_LABELS: Record<JobRecurrencePattern, string> = {
  daily:   "Daily",
  weekly:  "Weekly",
  monthly: "Monthly",
};

export const BYDAY_LABELS: Record<JobRecurrenceByday, string> = {
  MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};

export const BYDAY_ORDER: JobRecurrenceByday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

// ─── date helpers ──────────────────────────────────────────────────────────

function ymdToDate(ymd: string): Date {
  // Treat YMD as local civil day; afternoon hour avoids DST shifts.
  return new Date(`${ymd}T${String(SAFE_HOUR).padStart(2, "0")}:00:00`);
}

function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setMonth(out.getMonth() + n);
  return out;
}

function compareYmd(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ─── rule validation ───────────────────────────────────────────────────────

/** Quick sanity check used at form-submit time. Returns null when valid. */
export function validateRule(rule: JobRecurrenceRule): string | null {
  if (!rule) return "Recurrence rule is required";
  if (!["daily", "weekly", "monthly"].includes(rule.pattern)) {
    return `Unsupported pattern: ${rule.pattern}`;
  }
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    return "Interval must be a positive integer";
  }
  if (rule.pattern === "weekly" && rule.byday) {
    const ok = rule.byday.every((d) => d in BYDAY_TO_JS_DAY);
    if (!ok) return "Invalid weekday tokens in byday";
  }
  return null;
}

// ─── expansion ─────────────────────────────────────────────────────────────

export interface SeriesPayload {
  rule: JobRecurrenceRule;
  start_date: string; // YYYY-MM-DD
  end_date?: string | null;
  max_occurrences?: number | null;
}

export interface ExpandedOccurrence {
  /** YYYY-MM-DD calendar date of this occurrence. */
  date: string;
  /** 1-based index across the entire series. */
  sequence_index: number;
}

export interface ExpandOptions {
  /** Inclusive lower bound (default = series.start_date). */
  fromDate?: string;
  /** Inclusive upper bound (default = series.end_date or +90d). */
  toDate?: string;
  /** Skip occurrences whose sequence_index <= this (idempotent re-expansion). */
  skipUpToSequence?: number;
  /** Cap on the number of occurrences returned. Defaults to MAX_EXPANSION_OCCURRENCES. */
  limit?: number;
}

/**
 * Expand a recurrence series into a list of `(date, sequence_index)` tuples.
 * Pure, deterministic, idempotent. The caller is responsible for translating
 * occurrences into actual `jobs` rows.
 */
export function expandSeriesOccurrences(
  series: SeriesPayload,
  options: ExpandOptions = {},
): ExpandedOccurrence[] {
  const validation = validateRule(series.rule);
  if (validation) throw new Error(validation);

  const limit = Math.min(
    options.limit ?? MAX_EXPANSION_OCCURRENCES,
    MAX_EXPANSION_OCCURRENCES,
  );
  const skipUpTo = options.skipUpToSequence ?? 0;

  const lowerBound = options.fromDate ?? series.start_date;
  const seriesEnd = series.end_date ?? null;
  const upperBound = options.toDate
    ?? seriesEnd
    ?? dateToYmd(addDays(ymdToDate(series.start_date), DEFAULT_EXPAND_HORIZON_DAYS));

  const out: ExpandedOccurrence[] = [];
  let sequence = 0;

  const startDate = ymdToDate(series.start_date);
  const upperDate = ymdToDate(upperBound);
  const lowerYmd = lowerBound;

  if (series.rule.pattern === "daily") {
    let cur = new Date(startDate.getTime());
    while (cur.getTime() <= upperDate.getTime()) {
      sequence += 1;
      if (series.max_occurrences && sequence > series.max_occurrences) break;
      const ymd = dateToYmd(cur);
      if (compareYmd(ymd, lowerYmd) >= 0 && sequence > skipUpTo) {
        out.push({ date: ymd, sequence_index: sequence });
        if (out.length >= limit) break;
      }
      cur = addDays(cur, series.rule.interval);
    }
    return out;
  }

  if (series.rule.pattern === "weekly") {
    // Default byday = the weekday of start_date.
    const anchorJsDay = startDate.getDay();
    const bydayJs = (series.rule.byday && series.rule.byday.length > 0
      ? series.rule.byday.map((b) => BYDAY_TO_JS_DAY[b])
      : [anchorJsDay]
    ).slice().sort((a, b) => a - b);

    // Iterate week by week; week 0 = the week of start_date.
    // The series technically starts at the first occurrence ON or AFTER start_date
    // within the chosen weekdays.
    const weekStartCursor = new Date(startDate.getTime()); // any day; we offset within week
    const weekStartDayOfWeek = weekStartCursor.getDay();
    const weekZeroSunday = addDays(weekStartCursor, -weekStartDayOfWeek);

    for (let weekIndex = 0; ; weekIndex += series.rule.interval) {
      const weekSunday = addDays(weekZeroSunday, weekIndex * 7);
      if (weekSunday.getTime() > upperDate.getTime()) break;

      for (const jsDay of bydayJs) {
        const occ = addDays(weekSunday, jsDay);
        if (occ.getTime() < startDate.getTime()) continue; // before series start
        if (occ.getTime() > upperDate.getTime()) break;
        sequence += 1;
        if (series.max_occurrences && sequence > series.max_occurrences) {
          return out;
        }
        const ymd = dateToYmd(occ);
        if (compareYmd(ymd, lowerYmd) >= 0 && sequence > skipUpTo) {
          out.push({ date: ymd, sequence_index: sequence });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  if (series.rule.pattern === "monthly") {
    let cur = new Date(startDate.getTime());
    while (cur.getTime() <= upperDate.getTime()) {
      sequence += 1;
      if (series.max_occurrences && sequence > series.max_occurrences) break;
      const ymd = dateToYmd(cur);
      if (compareYmd(ymd, lowerYmd) >= 0 && sequence > skipUpTo) {
        out.push({ date: ymd, sequence_index: sequence });
        if (out.length >= limit) break;
      }
      cur = addMonths(cur, series.rule.interval);
    }
    return out;
  }

  return out;
}

/** Convenience wrapper: the very next occurrence at or after `from` (YYYY-MM-DD). */
export function nextOccurrence(
  series: SeriesPayload,
  from: string,
): ExpandedOccurrence | null {
  const list = expandSeriesOccurrences(series, { fromDate: from, limit: 1 });
  return list[0] ?? null;
}

// ─── preview line for the form UI ──────────────────────────────────────────

export interface SeriesPreviewState {
  pattern: JobRecurrencePattern;
  interval: number;
  byday?: JobRecurrenceByday[];
  start_date: string;
  end_date?: string | null;
  max_occurrences?: number | null;
}

/**
 * Human-readable summary for the form UI.
 *
 *   "Generates ~12 jobs from 2 May to 28 Jul"
 *   "Generates 8 jobs starting 2 May (8 occurrences)"
 *   "Generates ~26 jobs from 2 May (no end set — capped at 90 days for preview)"
 */
export function seriesPreview(state: SeriesPreviewState): string {
  const validation = validateRule({
    pattern: state.pattern,
    interval: state.interval,
    byday: state.byday,
  });
  if (validation) return "Invalid recurrence rule";

  const previewToYmd = state.end_date
    ?? dateToYmd(addDays(ymdToDate(state.start_date), DEFAULT_EXPAND_HORIZON_DAYS));

  let occurrences: ExpandedOccurrence[];
  try {
    occurrences = expandSeriesOccurrences({
      rule: { pattern: state.pattern, interval: state.interval, byday: state.byday },
      start_date: state.start_date,
      end_date: state.end_date,
      max_occurrences: state.max_occurrences,
    }, { toDate: previewToYmd, limit: MAX_EXPANSION_OCCURRENCES });
  } catch {
    return "Invalid recurrence rule";
  }

  if (occurrences.length === 0) return "No occurrences in range";

  const first = occurrences[0]!.date;
  const last = occurrences[occurrences.length - 1]!.date;

  if (state.max_occurrences && occurrences.length === state.max_occurrences) {
    return `Generates ${occurrences.length} jobs from ${humanDate(first)} to ${humanDate(last)} (${state.max_occurrences} occurrences)`;
  }
  if (state.end_date) {
    return `Generates ${occurrences.length} jobs from ${humanDate(first)} to ${humanDate(last)}`;
  }
  return `Generates ~${occurrences.length} jobs from ${humanDate(first)} (no end set — preview capped at 90 days)`;
}

function humanDate(ymd: string): string {
  // "2 May", "28 Jul"
  const d = ymdToDate(ymd);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Default byday for a given anchor date — used when the user picks weekly without selecting weekdays. */
export function defaultBydayForAnchor(anchorYmd: string): JobRecurrenceByday[] {
  const d = ymdToDate(anchorYmd);
  return [JS_DAY_TO_BYDAY[d.getDay()]!];
}
