import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import type { ListParams } from "@/services/base";

export type FinancePeriodMode = "all" | "week" | "range";

/** Inclusive YYYY-MM-DD bounds for filtering date columns client-side. */
export function getFinancePeriodClosedBounds(
  mode: FinancePeriodMode,
  weekAnchor: Date,
  rangeFrom: string,
  rangeTo: string
): { from: string; to: string } | null {
  if (mode === "all") return null;
  if (mode === "week") {
    const { weekStart, weekEnd } = getWeekBoundsForDate(weekAnchor);
    return { from: weekStart, to: weekEnd };
  }
  const a = rangeFrom.trim();
  const b = rangeTo.trim();
  if (!a && !b) return null;
  if (a && b) return a <= b ? { from: a, to: b } : { from: b, to: a };
  const single = a || b;
  return { from: single, to: single };
}

/** Server list params for `created_at` (or another column) on finance tables. */
export function getFinanceListDateFilter(
  mode: FinancePeriodMode,
  weekAnchor: Date,
  rangeFrom: string,
  rangeTo: string,
  dateColumn = "created_at"
): Partial<ListParams> {
  const bounds = getFinancePeriodClosedBounds(mode, weekAnchor, rangeFrom, rangeTo);
  if (!bounds) return {};
  return { dateColumn, dateFrom: bounds.from, dateTo: bounds.to };
}

/** Short line for KPI card footers (matches week / range / all). */
export function formatFinancePeriodKpiDescription(
  mode: FinancePeriodMode,
  weekAnchor: Date,
  rangeFrom: string,
  rangeTo: string
): string {
  if (mode === "all") return "All periods";
  if (mode === "week") {
    const { weekLabel, weekStart, weekEnd } = getWeekBoundsForDate(weekAnchor);
    return `${weekLabel} · ${weekStart}–${weekEnd}`;
  }
  const bounds = getFinancePeriodClosedBounds(mode, weekAnchor, rangeFrom, rangeTo);
  if (!bounds) return "Pick from/to dates";
  return bounds.from === bounds.to ? bounds.from : `${bounds.from} – ${bounds.to}`;
}
