import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import type { ListParams } from "@/services/base";

export type FinancePeriodMode = "all" | "week" | "month" | "range";

/** Inclusive YYYY-MM-DD bounds for the calendar month containing `d` (local). */
export function getMonthBoundsForDate(d: Date): { from: string; to: string; monthLabel: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${y}-${pad(m + 1)}-01`;
  const last = new Date(y, m + 1, 0);
  const to = `${y}-${pad(m + 1)}-${pad(last.getDate())}`;
  const monthLabel = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { from, to, monthLabel };
}

/** Inclusive YYYY-MM-DD bounds for filtering date columns client-side. */
export function getFinancePeriodClosedBounds(
  mode: FinancePeriodMode,
  weekAnchor: Date,
  rangeFrom: string,
  rangeTo: string,
  monthAnchor?: Date
): { from: string; to: string } | null {
  if (mode === "all") return null;
  if (mode === "week") {
    const { weekStart, weekEnd } = getWeekBoundsForDate(weekAnchor);
    return { from: weekStart, to: weekEnd };
  }
  if (mode === "month") {
    const a = monthAnchor ?? weekAnchor;
    const { from, to } = getMonthBoundsForDate(a);
    return { from, to };
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
  dateColumn = "created_at",
  monthAnchor?: Date
): Partial<ListParams> {
  const bounds = getFinancePeriodClosedBounds(mode, weekAnchor, rangeFrom, rangeTo, monthAnchor);
  if (!bounds) return {};
  return { dateColumn, dateFrom: bounds.from, dateTo: bounds.to };
}

/** Short line for KPI card footers (matches week / month / range / all). */
export function formatFinancePeriodKpiDescription(
  mode: FinancePeriodMode,
  weekAnchor: Date,
  rangeFrom: string,
  rangeTo: string,
  monthAnchor?: Date
): string {
  if (mode === "all") return "All periods";
  if (mode === "week") {
    const { weekLabel, weekStart, weekEnd } = getWeekBoundsForDate(weekAnchor);
    return `${weekLabel} · ${weekStart}–${weekEnd}`;
  }
  if (mode === "month") {
    const a = monthAnchor ?? weekAnchor;
    const { from, to, monthLabel } = getMonthBoundsForDate(a);
    return `${monthLabel} · ${from}–${to}`;
  }
  const bounds = getFinancePeriodClosedBounds(mode, weekAnchor, rangeFrom, rangeTo, monthAnchor);
  if (!bounds) return "Pick from/to dates";
  return bounds.from === bounds.to ? bounds.from : `${bounds.from} – ${bounds.to}`;
}
