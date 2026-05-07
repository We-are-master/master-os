/** All UI date/time displays use Europe/London (GMT/BST). */

export const UK_TIMEZONE = "Europe/London";

/**
 * Instant when the UK wall clock reads 00:00:00 at the start of `YYYY-MM-DD` in Europe/London.
 * Used for schedule-day-only fields (no time-of-day) in duration math.
 */
export function ukYmdStartOfWallClockDayMs(ymd: string): number | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const dtfYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dtfHms = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const [y, mo, da] = t.split("-").map(Number);
  const noonUtc = Date.UTC(y, mo - 1, da, 12, 0, 0);
  for (let ms = noonUtc - 36 * 3600000; ms <= noonUtc + 36 * 3600000; ms += 1000) {
    if (dtfYmd.format(new Date(ms)) !== t) continue;
    const parts = dtfHms.formatToParts(new Date(ms));
    const hh = parts.find((p) => p.type === "hour")?.value;
    const mm = parts.find((p) => p.type === "minute")?.value;
    const ss = parts.find((p) => p.type === "second")?.value;
    if (hh === "00" && mm === "00" && ss === "00") return ms;
  }
  return null;
}

export function formatBritishDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** e.g. "08:00" or "8:00 am" style — uses en-GB 12h clock in London. */
export function formatBritishTimeOnly(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatBritishDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Compact 12h clock for schedules (matches legacy "11AM", "2:30PM" — no space before AM/PM).
 */
export function formatBritishHourMinuteAmPmCompact(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  let hour = "";
  let minute = "";
  let dayPeriod = "";
  for (const p of parts) {
    if (p.type === "hour") hour = p.value;
    if (p.type === "minute") minute = p.value;
    if (p.type === "dayPeriod") dayPeriod = p.value.replace(/\./g, "").toUpperCase();
  }
  if (!hour || !dayPeriod) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: UK_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  }
  if (minute === "00") return `${hour}${dayPeriod}`;
  return `${hour}:${minute}${dayPeriod}`;
}
