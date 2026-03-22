/**
 * Wall-clock parts for a date in an IANA timezone (no extra deps).
 */
export function getZonedWallClock(isoNow: Date, timeZone: string): { ymd: string; hour: number; minute: number } {
  // en-CA yields ISO-like date parts: year, month, day, hour, minute
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(isoNow);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour")) || 0;
  const minute = Number(get("minute")) || 0;
  const ymd = year && month && day ? `${year}-${month}-${day}` : "";
  return { ymd, hour, minute };
}

/** Parse "HH:mm" → minutes from midnight */
export function parseHHmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * True if current zoned time is in [target, target + windowMinutes).
 * Used with frequent cron (e.g. every 15 minutes on Vercel Pro).
 */
export function isInTimeWindow(
  wall: { hour: number; minute: number },
  targetHHmm: string,
  windowMinutes: number
): boolean {
  const target = parseHHmm(targetHHmm);
  if (target == null) return false;
  const cur = wall.hour * 60 + wall.minute;
  return cur >= target && cur < target + windowMinutes;
}

/**
 * True if zoned wall-clock is at or after HH:mm today.
 * Used when cron runs once per day (e.g. Vercel Hobby): send a slot if its scheduled time has passed and it was not yet sent.
 */
export function hasLocalTimeReachedSchedule(
  wall: { hour: number; minute: number },
  targetHHmm: string
): boolean {
  const target = parseHHmm(targetHHmm);
  if (target == null) return false;
  const cur = wall.hour * 60 + wall.minute;
  return cur >= target;
}
