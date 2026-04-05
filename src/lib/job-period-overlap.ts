/**
 * Shared “job activity in period” logic: overlap of execution / booking window with [fromDay, toDay] (YYYY-MM-DD).
 * Used by Executive snapshot, Jobs Management date filter, dashboard chips, and invoice linkage.
 */
export type JobPeriodOverlapRow = {
  status: string;
  created_at?: string;
  scheduled_date?: string | null;
  scheduled_finish_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  completed_date?: string | null;
};

function ymdFromDbField(s: string | null | undefined): string | null {
  if (s == null || !String(s).trim()) return null;
  const t = String(s).trim();
  return t.length >= 10 ? t.slice(0, 10) : null;
}

/**
 * Best-effort execution window:
 * start = scheduled_start_at → scheduled_date → created_at;
 * end = scheduled_finish_date → scheduled_end_at → completed_date → start.
 */
export function jobExecutionWindowYmd(row: JobPeriodOverlapRow): { start: string; end: string } {
  const created = ymdFromDbField(row.created_at) ?? "1970-01-01";
  const start =
    ymdFromDbField(row.scheduled_start_at) ??
    ymdFromDbField(row.scheduled_date) ??
    created;
  let end =
    ymdFromDbField(row.scheduled_finish_date) ??
    ymdFromDbField(row.scheduled_end_at) ??
    ymdFromDbField(row.completed_date) ??
    start;
  if (end < start) end = start;
  return { start, end };
}

const TERMINAL_JOB_STATUSES = new Set<string>(["completed", "cancelled", "deleted"]);

function hasExecutionScheduleSignal(row: JobPeriodOverlapRow): boolean {
  return Boolean(
    ymdFromDbField(row.scheduled_date) ||
      ymdFromDbField(row.scheduled_start_at) ||
      ymdFromDbField(row.scheduled_finish_date) ||
      ymdFromDbField(row.scheduled_end_at) ||
      ymdFromDbField(row.completed_date),
  );
}

/**
 * True if the job overlaps the inclusive local-day range.
 * Active jobs without schedule/finish/completion: treated as running through **toDay** (end of selected period).
 */
export function jobExecutionOverlapsYmdRange(row: JobPeriodOverlapRow, fromDay: string, toDay: string): boolean {
  const active = !TERMINAL_JOB_STATUSES.has(row.status);

  if (hasExecutionScheduleSignal(row)) {
    const { start, end } = jobExecutionWindowYmd(row);
    return start <= toDay && end >= fromDay;
  }

  if (active) {
    const start = ymdFromDbField(row.created_at) ?? "1970-01-01";
    const effectiveEnd = toDay;
    return start <= toDay && effectiveEnd >= fromDay;
  }

  const { start, end } = jobExecutionWindowYmd(row);
  return start <= toDay && end >= fromDay;
}

export function jobExecutionStartYmd(row: JobPeriodOverlapRow): string {
  return jobExecutionWindowYmd(row).start;
}

/**
 * True if the job's schedule **start day** ({@link jobExecutionStartYmd}) is within [fromDay, toDay] inclusive.
 * Used by Jobs Management "Schedule window" (Today / This week / …), not execution-span overlap.
 */
export function jobScheduleStartInYmdRange(row: JobPeriodOverlapRow, fromDay: string, toDay: string): boolean {
  const start = jobExecutionStartYmd(row);
  return start >= fromDay && start <= toDay;
}
