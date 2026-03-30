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

/**
 * ISO weeks with label ≥ `{year}-W01` (e.g. 2026+), through end of next calendar year.
 * Starts scanning from Nov of the previous year so week 1 of January is included.
 */
export function weekPresetsFromYear(minCalendarYear: number): { weekStart: string; label: string }[] {
  const out: { weekStart: string; label: string }[] = [];
  const seen = new Set<string>();
  const cutoff = `${minCalendarYear}-W01`;
  const start = new Date(minCalendarYear - 1, 10, 1);
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  end.setMonth(11, 31);
  const d = new Date(start);
  while (d <= end) {
    const { weekStart, weekLabel } = getWeekBoundsForDate(d);
    if (weekLabel >= cutoff && !seen.has(weekStart)) {
      seen.add(weekStart);
      out.push({ weekStart, label: weekLabel });
    }
    d.setDate(d.getDate() + 7);
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
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
