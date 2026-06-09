import { addDays, addMonths, addWeeks, format, parseISO, startOfMonth, endOfMonth, isValid } from "date-fns";
import type { PayrollInternalPayFrequency } from "@/types/database";
import { getWeekBoundsForDate } from "./self-bill-period";

export type PayPeriodBounds = {
  periodStart: string;
  periodEnd: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
};

export function getPayPeriodBounds(
  payFrequency: PayrollInternalPayFrequency | null | undefined,
  anchorDate: Date,
): PayPeriodBounds {
  const freq = payFrequency ?? "monthly";
  if (freq === "weekly") {
    const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(anchorDate);
    return { periodStart: weekStart, periodEnd: weekEnd, weekStart, weekEnd, weekLabel };
  }
  if (freq === "biweekly") {
    const { weekStart } = getWeekBoundsForDate(anchorDate);
    const start = parseISO(weekStart);
    const epoch = parseISO("2024-01-01");
    const weeksSince = Math.floor((start.getTime() - epoch.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const biStart = weeksSince % 2 === 0 ? weekStart : format(addWeeks(start, -1), "yyyy-MM-dd");
    const biEnd = format(addDays(parseISO(biStart), 13), "yyyy-MM-dd");
    const labelWeek = getWeekBoundsForDate(parseISO(biStart));
    return {
      periodStart: biStart,
      periodEnd: biEnd,
      weekStart: biStart,
      weekEnd: biEnd,
      weekLabel: `${labelWeek.weekLabel}-BI`,
    };
  }
  const monthStart = format(startOfMonth(anchorDate), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(anchorDate), "yyyy-MM-dd");
  return {
    periodStart: monthStart,
    periodEnd: monthEnd,
    weekStart: monthStart,
    weekEnd: monthEnd,
    weekLabel: format(anchorDate, "yyyy-MM"),
  };
}

export function computeNextDueDate(
  payFrequency: PayrollInternalPayFrequency | null | undefined,
  paymentDayOfMonth: number | null | undefined,
  fromDate: Date = new Date(),
): string {
  const freq = payFrequency ?? "monthly";
  if (freq === "weekly") return format(addWeeks(fromDate, 1), "yyyy-MM-dd");
  if (freq === "biweekly") return format(addWeeks(fromDate, 2), "yyyy-MM-dd");
  const day = Math.min(28, Math.max(1, paymentDayOfMonth ?? 28));
  let next = addMonths(fromDate, 1);
  next = new Date(next.getFullYear(), next.getMonth(), day);
  if (!isValid(next)) next = endOfMonth(next);
  return format(next, "yyyy-MM-dd");
}
