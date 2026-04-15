/** All UI date/time displays use Europe/London (GMT/BST). */

export const UK_TIMEZONE = "Europe/London";

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
