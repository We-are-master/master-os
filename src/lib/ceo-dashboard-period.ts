import type { DashboardDateBounds } from "@/lib/dashboard-date-range";

/** Same calendar length as `bounds`, ending the day before current range starts. */
export function previousPeriodBounds(bounds: DashboardDateBounds): DashboardDateBounds {
  const fromDay = bounds.fromIso.slice(0, 10);
  const toDay = bounds.toIso.slice(0, 10);
  const start = new Date(`${fromDay}T12:00:00`);
  const end = new Date(`${toDay}T12:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  prevStart.setHours(0, 0, 0, 0);
  prevEnd.setHours(23, 59, 59, 999);
  return { fromIso: prevStart.toISOString(), toIso: prevEnd.toISOString() };
}

/** % change vs previous period; undefined if not comparable. */
export function periodTrendPercent(current: number, previous: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  if (Math.abs(previous) < 0.01 && Math.abs(current) < 0.01) return undefined;
  if (Math.abs(previous) < 0.01) return undefined;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Simple end-of-period forecast: actual to date × (total days / elapsed days).
 * When range is in the future or same-day edge cases, returns actual.
 */
export function runRateForecast(
  actualToDate: number,
  bounds: DashboardDateBounds,
  now = new Date()
): number {
  const from = new Date(`${bounds.fromIso.slice(0, 10)}T00:00:00`);
  const to = new Date(`${bounds.toIso.slice(0, 10)}T23:59:59.999`);
  const totalDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const elapsedEnd = new Date(Math.min(now.getTime(), to.getTime()));
  const elapsedDays = Math.max(
    1,
    Math.round((elapsedEnd.getTime() - from.getTime()) / 86400000) + 1
  );
  if (elapsedDays >= totalDays) return actualToDate;
  const rate = actualToDate / elapsedDays;
  return Math.round(rate * totalDays * 100) / 100;
}
