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
 * Prefer `scheduled_start_at` (same as {@link formatJobScheduleLine} and `jobExecutionWindowYmd` in job-period-overlap);
 * otherwise `scheduled_date`. If a stale `scheduled_date` disagrees with the booking timestamps, the list still
 * shows the real window — the calendar must match or jobs “disappear” from the month.
 */
export function jobScheduleYmd(job: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): { y: number; m: number; d: number } | null {
  if (job.scheduled_start_at) {
    const dt = new Date(job.scheduled_start_at);
    if (!Number.isNaN(dt.getTime())) {
      return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
    }
  }
  if (job.scheduled_date) {
    const p = parseIsoDateOnlyPrefix(job.scheduled_date);
    if (p) return p;
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

/** True if the job’s inclusive [start, finish] range overlaps a calendar month (month is 0-based). */
export function jobIntersectsLocalMonth(
  job: {
    scheduled_date?: string | null;
    scheduled_start_at?: string | null;
    scheduled_finish_date?: string | null;
    scheduled_end_at?: string | null;
  },
  year: number,
  month: number,
): boolean {
  const start = jobScheduleYmd(job);
  if (!start) return false;
  const finish = jobFinishYmd(job) ?? start;
  const ms = new Date(year, month, 1);
  const me = new Date(year, month + 1, 0);
  const s = new Date(start.y, start.m - 1, start.d);
  const e = new Date(finish.y, finish.m - 1, finish.d);
  return s <= me && e >= ms;
}

/** Hover tooltip: reference, full title, partner, address. */
export function formatScheduleCalendarBarTooltip(job: {
  reference: string;
  title: string;
  partner_name?: string | null;
  property_address?: string | null;
}): string {
  const partner = job.partner_name?.trim() ? job.partner_name.trim() : "No partner";
  const addr = (job.property_address ?? "").trim();
  return `${job.reference} · ${job.title} · ${partner}${addr ? ` · ${addr}` : ""}`;
}

function scheduleLineFinishSuffix(job: { scheduled_finish_date?: string | null }): string {
  if (!job.scheduled_finish_date) return "";
  const p = parseIsoDateOnlyPrefix(job.scheduled_finish_date);
  if (!p) return "";
  const endLabel = new Date(p.y, p.m - 1, p.d).toLocaleDateString(undefined, { dateStyle: "medium" });
  return ` · Expected finish ${endLabel}`;
}

/** Compact 12h label for client/partner-facing copy (e.g. `11AM`, `2:30PM`). */
export function formatHourMinuteAmPm(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes();
  const isPm = h24 >= 12;
  const h12 = h24 % 12 || 12;
  const suf = isPm ? "PM" : "AM";
  if (m === 0) return `${h12}${suf}`;
  return `${h12}:${String(m).padStart(2, "0")}${suf}`;
}

/** Arrival window as shown to client & partner, e.g. `11AM – 2PM`. */
export function formatArrivalTimeRange(startIso: string, endIso: string): string | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return `${formatHourMinuteAmPm(start)} – ${formatHourMinuteAmPm(end)}`;
}

function formatMediumDateFromLocalDate(d: Date): string {
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

const UK_TIMEZONE = "Europe/London";

function isoCalendarDateInUk(isoOrDate: string | Date): string | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function ymdFromDateOnlyField(s: string): string | null {
  const p = parseIsoDateOnlyPrefix(s);
  if (!p) return null;
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function addOneCalendarDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function formatMediumDateEnGbFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

/**
 * Jobs list / kanban / map: start date only.
 * Uses relative labels in UK calendar (Europe/London): Today / Tomorrow.
 */
export function formatJobScheduleListLabel(job: {
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
}): string | null {
  let startYmd: string | null = null;
  if (job.scheduled_start_at) {
    startYmd = isoCalendarDateInUk(job.scheduled_start_at);
  } else if (job.scheduled_date) {
    startYmd = ymdFromDateOnlyField(job.scheduled_date);
  }
  if (!startYmd) return null;

  const todayUk = isoCalendarDateInUk(new Date());
  if (!todayUk) return formatMediumDateEnGbFromYmd(startYmd);

  if (startYmd === todayUk) return "Today";

  const tomorrowUk = addOneCalendarDayYmd(todayUk);
  if (startYmd === tomorrowUk) return "Tomorrow";

  return formatMediumDateEnGbFromYmd(startYmd);
}

/**
 * One line for lists, emails, pushes: start date + arrival time range + optional expected finish (date only).
 * Example: `4 Apr 2026 · Arrival time 11AM – 2PM · Expected finish 6 Apr 2026`
 */
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
    const range = formatArrivalTimeRange(job.scheduled_start_at, job.scheduled_end_at);
    if (!range) return null;
    const dateStr = formatMediumDateFromLocalDate(start);
    return `${dateStr} · Arrival time ${range}${scheduleLineFinishSuffix(job)}`;
  }
  if (job.scheduled_start_at) {
    const dt = new Date(job.scheduled_start_at);
    if (Number.isNaN(dt.getTime())) return null;
    const dateStr = formatMediumDateFromLocalDate(dt);
    return `${dateStr} · Arrival time ${formatHourMinuteAmPm(dt)}${scheduleLineFinishSuffix(job)}`;
  }
  if (job.scheduled_date) {
    const p = parseIsoDateOnlyPrefix(job.scheduled_date);
    if (!p) return null;
    return `${new Date(p.y, p.m - 1, p.d).toLocaleDateString(undefined, { dateStyle: "medium" })}${scheduleLineFinishSuffix(job)}`;
  }
  return null;
}
