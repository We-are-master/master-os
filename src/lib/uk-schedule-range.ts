/** UK calendar schedule presets — shared by Jobs, Quotes (KPIs), and Requests (created date). */

export type ScheduleDatePreset = "all" | "today" | "tomorrow" | "week" | "month" | "custom";

const UK_TIMEZONE = "Europe/London";

export function ukTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function startOfWeekMondayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function endOfWeekSundayYmd(ymd: string): string {
  return addDaysYmd(startOfWeekMondayYmd(ymd), 6);
}

export function startOfMonthYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function endOfMonthYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** Inclusive YYYY-MM-DD bounds, or `null` when preset is `"all"`. */
export function getScheduleRangeYmd(
  preset: ScheduleDatePreset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } | null {
  if (preset === "all") return null;
  const anchor = ukTodayYmd(new Date());
  if (preset === "today") {
    return { from: anchor, to: anchor };
  }
  if (preset === "tomorrow") {
    const t = addDaysYmd(anchor, 1);
    return { from: t, to: t };
  }
  if (preset === "week") {
    return { from: startOfWeekMondayYmd(anchor), to: endOfWeekSundayYmd(anchor) };
  }
  if (preset === "month") {
    return { from: startOfMonthYmd(anchor), to: endOfMonthYmd(anchor) };
  }
  let from = customFrom.trim();
  let to = customTo.trim();
  if (from && to && from > to) [from, to] = [to, from];
  if (!from && !to) return null;
  const single = from || to;
  return { from: from || single, to: to || single };
}
