import { startOfWeek, endOfWeek, format, getISOWeek, getISOWeekYear, parseISO, isValid } from "date-fns";

/** UK-style business week: Monday 00:00 → Sunday end-of-day (displayed as week_end date). */
export function getWeekBoundsForDate(d: Date): { weekStart: string; weekEnd: string; weekLabel: string } {
  const start = startOfWeek(d, { weekStartsOn: 1 });
  const end = endOfWeek(d, { weekStartsOn: 1 });
  const weekStart = format(start, "yyyy-MM-dd");
  const weekEnd = format(end, "yyyy-MM-dd");
  const weekLabel = `${getISOWeekYear(start)}-W${String(getISOWeek(start)).padStart(2, "0")}`;
  return { weekStart, weekEnd, weekLabel };
}

/** Next Monday after Sunday close — informational copy for UI. */
export function weekPeriodHelpText(): string {
  return "Each period runs Monday 00:00 through Sunday 23:59 (local date). A new period opens every Monday.";
}

export function parseDateRangeOrWeek(input: { from?: string; to?: string }): { weekStartMin?: string; weekStartMax?: string } {
  const from = input.from?.trim();
  const to = input.to?.trim();
  if (from && to) {
    const a = parseISO(from);
    const b = parseISO(to);
    if (!isValid(a) || !isValid(b)) return {};
    return {
      weekStartMin: format(a, "yyyy-MM-dd"),
      weekStartMax: format(b, "yyyy-MM-dd"),
    };
  }
  if (from) {
    const a = parseISO(from);
    if (!isValid(a)) return {};
    return { weekStartMin: format(a, "yyyy-MM-dd") };
  }
  if (to) {
    const b = parseISO(to);
    if (!isValid(b)) return {};
    return { weekStartMax: format(b, "yyyy-MM-dd") };
  }
  return {};
}
