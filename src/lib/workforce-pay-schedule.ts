import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  isValid,
  parseISO,
  startOfMonth,
} from "date-fns";
import type { PayrollInternalPayFrequency } from "@/types/database";
import { getWeekBoundsForDate } from "./self-bill-period";

/** Company-wide workforce monthly pay day (billing / self-bill due). */
export const WORKFORCE_MONTHLY_PAY_DAY = 5;

export type PayPeriodBounds = {
  periodStart: string;
  periodEnd: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
};

export function workforcePayDayOfMonth(explicit?: number | null): number {
  const n = explicit ?? WORKFORCE_MONTHLY_PAY_DAY;
  return Math.min(28, Math.max(1, Number(n) || WORKFORCE_MONTHLY_PAY_DAY));
}

/** Pay date for a closed monthly period — day 5 of the month after period end. */
export function computeWorkforcePayDueDate(periodEndYmd: string, payDayOfMonth?: number | null): string {
  const periodEnd = parseISO(periodEndYmd.length === 10 ? `${periodEndYmd}T12:00:00` : periodEndYmd);
  const nextMonth = addMonths(startOfMonth(periodEnd), 1);
  const day = workforcePayDayOfMonth(payDayOfMonth);
  let due = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day);
  if (!isValid(due)) due = endOfMonth(nextMonth);
  return format(due, "yyyy-MM-dd");
}

/** First pay due date on or after `fromDate` (monthly cadence, default pay day 5). */
export function computeWorkforceNextDueDate(
  payDayOfMonth: number | null | undefined,
  fromDate: Date = new Date(),
): string {
  const day = workforcePayDayOfMonth(payDayOfMonth);
  const today = format(fromDate, "yyyy-MM-dd");
  let candidate = new Date(fromDate.getFullYear(), fromDate.getMonth(), day);
  if (!isValid(candidate)) candidate = endOfMonth(fromDate);
  let dueYmd = format(candidate, "yyyy-MM-dd");
  if (dueYmd < today) {
    const next = addMonths(fromDate, 1);
    candidate = new Date(next.getFullYear(), next.getMonth(), day);
    if (!isValid(candidate)) candidate = endOfMonth(next);
    dueYmd = format(candidate, "yyyy-MM-dd");
  }
  return dueYmd;
}

/**
 * Pro-rate monthly fixed pay when someone joins mid-month.
 * Example: start day 10 in a 31-day month → 22/31 of monthly amount.
 */
export function prorateMonthlyFixedPay(
  monthlyAmount: number,
  periodStartYmd: string,
  periodEndYmd: string,
  workforceStartYmd?: string | null,
): number {
  const amount = Math.max(0, Number(monthlyAmount) || 0);
  const start = workforceStartYmd?.trim().slice(0, 10);
  if (!start || start <= periodStartYmd) return Math.round(amount * 100) / 100;
  if (start > periodEndYmd) return 0;

  const periodEnd = parseISO(periodEndYmd.length === 10 ? `${periodEndYmd}T12:00:00` : periodEndYmd);
  const daysInMonth = parseInt(format(endOfMonth(periodEnd), "d"), 10);
  const startDay = parseInt(start.slice(8, 10), 10);
  if (!Number.isFinite(startDay) || startDay < 1 || daysInMonth < 1) return Math.round(amount * 100) / 100;

  const workedDays = Math.max(0, daysInMonth - startDay + 1);
  return Math.round(amount * (workedDays / daysInMonth) * 100) / 100;
}

export function effectiveWorkforcePeriodStart(
  periodStartYmd: string,
  workforceStartYmd?: string | null,
): string {
  const start = workforceStartYmd?.trim().slice(0, 10);
  if (!start || start <= periodStartYmd) return periodStartYmd;
  return start;
}

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
  return computeWorkforceNextDueDate(paymentDayOfMonth, fromDate);
}

export function parseWorkforceStartDate(
  payrollProfile: unknown,
  createdAt?: string | null,
): string | null {
  if (payrollProfile && typeof payrollProfile === "object" && payrollProfile !== null) {
    const raw = (payrollProfile as { start_date?: unknown }).start_date;
    if (typeof raw === "string" && raw.trim().length >= 10) return raw.trim().slice(0, 10);
  }
  if (createdAt?.trim()) return createdAt.trim().slice(0, 10);
  return null;
}
