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

/** Start/end of inclusive local day range as UTC ISO strings for filtering `timestamptz` columns. */
export function localYmdBoundsToUtcIso(fromYmd: string, toYmd: string): { startIso: string; endIso: string } {
  const pf = parseIsoDateOnlyPrefix(fromYmd);
  const pt = parseIsoDateOnlyPrefix(toYmd);
  const fallback = new Date();
  const fy = pf?.y ?? fallback.getFullYear();
  const fm = pf?.m ?? fallback.getMonth() + 1;
  const fd = pf?.d ?? fallback.getDate();
  const ty = pt?.y ?? fallback.getFullYear();
  const tm = pt?.m ?? fallback.getMonth() + 1;
  const td = pt?.d ?? fallback.getDate();
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function addLocalCalendarDays(anchor: Date, deltaDays: number): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  d.setDate(d.getDate() + deltaDays);
  return d;
}

/** Week starting Monday (local calendar). */
export function startOfLocalWeekMonday(anchor: Date): Date {
  const c = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const day = c.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  c.setDate(c.getDate() + diff);
  return c;
}

export function endOfLocalWeekSunday(anchor: Date): Date {
  const m = startOfLocalWeekMonday(anchor);
  return new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6);
}

export function startOfLocalMonth(anchor: Date): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}

export function endOfLocalMonth(anchor: Date): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
}

/**
 * Day/month/year for placing a job on a local calendar grid.
 * Prefer `scheduled_date` as a civil date; otherwise use local components of `scheduled_start_at`.
 */
export function jobScheduleYmd(job: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
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

export function jobFinishYmd(job: {
  scheduled_finish_date?: string | null;
  scheduled_end_at?: string | null;
}): { y: number; m: number; d: number } | null {
  if (job.scheduled_finish_date) {
    const p = parseIsoDateOnlyPrefix(job.scheduled_finish_date);
    if (p) return p;
  }
  if (!job.scheduled_end_at) return null;
  const dt = new Date(job.scheduled_end_at);
  if (Number.isNaN(dt.getTime())) return null;
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function scheduleLineFinishSuffix(job: { scheduled_finish_date?: string | null }): string {
  if (!job.scheduled_finish_date) return "";
  const p = parseIsoDateOnlyPrefix(job.scheduled_finish_date);
  if (!p) return "";
  const endLabel = new Date(p.y, p.m - 1, p.d).toLocaleDateString(undefined, { dateStyle: "medium" });
  return ` · ends ${endLabel}`;
}

/** Format date + optional time for schedule drawer / lists (local). */
export function formatJobScheduleLine(job: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  scheduled_finish_date?: string | null;
}): string | null {
  if (job.scheduled_start_at && job.scheduled_end_at) {
    const start = new Date(job.scheduled_start_at);
    const end = new Date(job.scheduled_end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return `${start.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} – ${end.toLocaleTimeString(undefined, { timeStyle: "short" })}${scheduleLineFinishSuffix(job)}`;
  }
  if (job.scheduled_start_at) {
    const dt = new Date(job.scheduled_start_at);
    if (Number.isNaN(dt.getTime())) return null;
    return `${dt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${scheduleLineFinishSuffix(job)}`;
  }
  if (job.scheduled_date) {
    const p = parseIsoDateOnlyPrefix(job.scheduled_date);
    if (!p) return null;
    return `${new Date(p.y, p.m - 1, p.d).toLocaleDateString(undefined, { dateStyle: "medium" })}${scheduleLineFinishSuffix(job)}`;
  }
  return null;
}
