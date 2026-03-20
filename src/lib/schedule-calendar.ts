/** Local calendar YYYY-MM-DD (avoids UTC day shift from `Date#toISOString`). */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** Postgres `date` / date-only strings: civil calendar day without timezone shifts. */
export function parseIsoDateOnlyPrefix(s: string): { y: number; m: number; d: number } | null {
  const m = s.trim().match(ISO_DATE_PREFIX);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * Day/month/year for placing a job on a local calendar grid.
 * Prefer `scheduled_date` as a civil date; otherwise use local components of `scheduled_start_at`.
 */
export function jobScheduleYmd(job: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
}): { y: number; m: number; d: number } | null {
  if (job.scheduled_date) {
    const p = parseIsoDateOnlyPrefix(job.scheduled_date);
    if (p) return p;
  }
  if (job.scheduled_start_at) {
    const dt = new Date(job.scheduled_start_at);
    if (Number.isNaN(dt.getTime())) return null;
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
  }
  return null;
}

/** Format date + optional time for schedule drawer / lists (local). */
export function formatJobScheduleLine(job: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
}): string | null {
  if (job.scheduled_start_at) {
    const dt = new Date(job.scheduled_start_at);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  if (job.scheduled_date) {
    const p = parseIsoDateOnlyPrefix(job.scheduled_date);
    if (!p) return null;
    return new Date(p.y, p.m - 1, p.d).toLocaleDateString(undefined, { dateStyle: "medium" });
  }
  return null;
}
