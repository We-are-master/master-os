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

function ymdToDayNumber(ymd: string): number {
  return parseInt(ymd.slice(8, 10), 10);
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function workforceAccrualEffectiveRange(
  periodStartYmd: string,
  periodEndYmd: string,
  asOfYmd: string,
  workforceStartYmd?: string | null,
): { effectiveStart: string; effectiveEnd: string } | null {
  const asOf = asOfYmd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;

  const effectiveEnd = asOf <= periodEndYmd ? asOf : periodEndYmd;
  const start = workforceStartYmd?.trim().slice(0, 10);
  const effectiveStart =
    start && /^\d{4}-\d{2}-\d{2}$/.test(start)
      ? start > periodStartYmd
        ? start
        : periodStartYmd
      : periodStartYmd;

  if (effectiveEnd < effectiveStart) return null;
  return { effectiveStart, effectiveEnd };
}

/** Parse days_off from payroll_profile JSON. */
export function parseWorkforceDaysOff(payrollProfile: unknown): string[] {
  if (!payrollProfile || typeof payrollProfile !== "object") return [];
  const raw = (payrollProfile as { days_off?: unknown }).days_off;
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const ymd = item.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) out.add(ymd);
  }
  return [...out].sort();
}

export type WorkforcePayableDaysResult = {
  payableDays: number;
  daysOffInRange: string[];
};

/** Calendar days in range minus days off that fall within the range. */
export function countWorkforceCalendarPayableDays(
  periodStartYmd: string,
  periodEndYmd: string,
  asOfYmd: string,
  workforceStartYmd?: string | null,
  daysOffYmds: string[] = [],
): WorkforcePayableDaysResult {
  const range = workforceAccrualEffectiveRange(
    periodStartYmd,
    periodEndYmd,
    asOfYmd,
    workforceStartYmd,
  );
  if (!range) return { payableDays: 0, daysOffInRange: [] };

  const offInRange = [
    ...new Set(
      daysOffYmds
        .map((d) => d.trim().slice(0, 10))
        .filter(
          (d) =>
            /^\d{4}-\d{2}-\d{2}$/.test(d) &&
            d >= range.effectiveStart &&
            d <= range.effectiveEnd,
        ),
    ),
  ].sort();

  const calendarDays =
    Math.floor((ymdToUtcMs(range.effectiveEnd) - ymdToUtcMs(range.effectiveStart)) / 86400000) + 1;
  const payableDays = Math.max(0, calendarDays - offInRange.length);
  return { payableDays, daysOffInRange: offInRange };
}

/**
 * Daily accrual of monthly fixed pay through `asOfYmd` (inclusive).
 * Grows each day until month-end; days off in range reduce payable days.
 */
export function accrueMonthlyFixedPayToDate(
  monthlyAmount: number,
  periodStartYmd: string,
  periodEndYmd: string,
  asOfYmd: string,
  workforceStartYmd?: string | null,
  daysOffYmds?: string[] | null,
): number {
  const amount = Math.max(0, Number(monthlyAmount) || 0);
  const periodEnd = parseISO(periodEndYmd.length === 10 ? `${periodEndYmd}T12:00:00` : periodEndYmd);
  const daysInMonth = parseInt(format(endOfMonth(periodEnd), "d"), 10);
  if (daysInMonth < 1) return Math.round(amount * 100) / 100;

  const { payableDays } = countWorkforceCalendarPayableDays(
    periodStartYmd,
    periodEndYmd,
    asOfYmd,
    workforceStartYmd,
    daysOffYmds ?? [],
  );
  return Math.round(amount * (payableDays / daysInMonth) * 100) / 100;
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
