/**
 * Timezone-aware time helpers. All the bot's date logic (run window, "days
 * ahead", slot weekday) is defined in UK wall-clock, which is BST or GMT
 * depending on the season — so we resolve everything through Intl with an
 * explicit timeZone rather than the host machine's local time.
 */

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** The current calendar date (YYYY-MM-DD), hour (0-23), and weekday (Sun=0) in `tz`. */
export function tzNow(tz: string, date: Date = new Date()): { ymd: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? ymdWeekday(ymd);
  return { ymd, hour, weekday };
}

/** Weekday (Sun=0..Sat=6) for a bare calendar date. Uses UTC noon to dodge DST edges. */
export function ymdWeekday(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? -1 : d.getUTCDay();
}

/** Whole calendar days from `fromYmd` to `toYmd` (positive if `toYmd` is later). */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

/** True when `date` falls on an allowed run day AND within [runStartHour, runEndHour) in `tz`. */
export function isWithinRunWindow(
  schedule: { runDays: number[]; runStartHour: number; runEndHour: number; timezone: string },
  date: Date = new Date(),
): boolean {
  const { hour, weekday } = tzNow(schedule.timezone, date);
  if (!schedule.runDays.includes(weekday)) return false;
  return hour >= schedule.runStartHour && hour < schedule.runEndHour;
}
