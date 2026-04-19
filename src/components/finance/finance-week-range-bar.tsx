"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { parseISO, format, getISOWeek, isValid } from "date-fns";
import { enGB } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import { FINANCE_PERIOD_MODES_ORDER, getMonthBoundsForDate } from "@/lib/finance-period";
import type { FinancePeriodMode } from "@/lib/finance-period";

const PERIOD_PILL_LABEL: Record<FinancePeriodMode, string> = {
  all: "All",
  day: "Day",
  month: "Monthly",
  week: "Week",
  range: "Date range",
};

export type { FinancePeriodMode };

export interface FinanceWeekRangeBarProps {
  mode: FinancePeriodMode;
  onModeChange: (m: FinancePeriodMode) => void;
  weekAnchor: Date;
  onWeekAnchorChange: (d: Date) => void;
  rangeFrom: string;
  rangeTo: string;
  onRangeFromChange: (v: string) => void;
  onRangeToChange: (v: string) => void;
  className?: string;
  showAllOption?: boolean;
  /** When false, hides Monthly (e.g. minimal embed). Default true. */
  showMonthOption?: boolean;
  monthAnchor?: Date;
  onMonthAnchorChange?: (d: Date) => void;
  /** Replaces the default “Showing all periods…” line when mode is All. */
  allPeriodDescription?: string;
  /** Hide the "Showing all periods…" text entirely — pages that replace it with an info tooltip elsewhere. */
  hideAllDescription?: boolean;
  /** Shown under the date inputs in range mode (e.g. pay run is one week at a time). */
  rangeHelperText?: string;
  /** Hide the built-in period pills row (e.g. when using `DateWindowToolbar` above). */
  hideModePills?: boolean;
}

function fmtRangeLine(iso: string) {
  const d = parseISO(iso);
  return isValid(d) ? format(d, "MMM d, yyyy", { locale: enGB }) : iso;
}

export function FinanceWeekRangeBar({
  mode,
  onModeChange,
  weekAnchor,
  onWeekAnchorChange,
  rangeFrom,
  rangeTo,
  onRangeFromChange,
  onRangeToChange,
  className,
  showAllOption = true,
  showMonthOption = true,
  monthAnchor,
  onMonthAnchorChange,
  allPeriodDescription,
  hideAllDescription = false,
  rangeHelperText,
  hideModePills = false,
}: FinanceWeekRangeBarProps) {
  const effectiveMonthAnchor = monthAnchor ?? weekAnchor;
  const { weekStart, weekEnd, weekLabel } = useMemo(
    () => getWeekBoundsForDate(weekAnchor),
    [weekAnchor]
  );
  const weekNum = useMemo(() => {
    const m = parseISO(weekStart);
    return isValid(m) ? getISOWeek(m) : 0;
  }, [weekStart]);
  const prettyRange = `${fmtRangeLine(weekStart)} – ${fmtRangeLine(weekEnd)}`;

  const monthBounds = useMemo(() => getMonthBoundsForDate(effectiveMonthAnchor), [effectiveMonthAnchor]);

  const goPrev = () => {
    const x = new Date(weekAnchor);
    x.setDate(x.getDate() - 7);
    onWeekAnchorChange(x);
  };
  const goNext = () => {
    const x = new Date(weekAnchor);
    x.setDate(x.getDate() + 7);
    onWeekAnchorChange(x);
  };

  const goPrevMonth = () => {
    const x = new Date(effectiveMonthAnchor);
    x.setMonth(x.getMonth() - 1);
    (onMonthAnchorChange ?? onWeekAnchorChange)(x);
  };
  const goNextMonth = () => {
    const x = new Date(effectiveMonthAnchor);
    x.setMonth(x.getMonth() + 1);
    (onMonthAnchorChange ?? onWeekAnchorChange)(x);
  };

  const goPrevDay = () => {
    const x = new Date(weekAnchor);
    x.setDate(x.getDate() - 1);
    onWeekAnchorChange(x);
  };
  const goNextDay = () => {
    const x = new Date(weekAnchor);
    x.setDate(x.getDate() + 1);
    onWeekAnchorChange(x);
  };

  const dayYmd = useMemo(() => {
    const d = weekAnchor;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, [weekAnchor]);

  const pill = (active: boolean) =>
    cn(
      "rounded-[6px] px-3 py-[5px] text-[11px] font-medium transition-colors",
      active
        ? "bg-[#ED4B00] text-white shadow-sm"
        : "bg-transparent text-[#020040] hover:bg-surface-hover"
    );

  const handleMode = (m: FinancePeriodMode) => {
    if (!showAllOption && m === "all") return;
    if (!showMonthOption && m === "month") return;
    onModeChange(m);
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border-light bg-card/90 p-3 shadow-sm sm:p-4",
        className
      )}
    >
      {!hideModePills ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Period
          </span>
          <div className="flex flex-wrap gap-1.5">
            {FINANCE_PERIOD_MODES_ORDER.filter(
              (m) => (showAllOption || m !== "all") && (showMonthOption || m !== "month"),
            ).map((m) => (
              <button key={m} type="button" className={pill(mode === m)} onClick={() => handleMode(m)}>
                {PERIOD_PILL_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "day" && (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-border-light bg-background shadow-sm sm:h-auto sm:min-h-[5.5rem] sm:w-11 sm:min-w-[2.75rem] sm:px-0"
            onClick={goPrevDay}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 rounded-xl border border-border-light bg-background px-3 py-3 text-center shadow-sm sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Day</p>
            <p className="mt-1 break-words text-base font-bold leading-snug text-text-primary sm:text-lg">
              {fmtRangeLine(`${dayYmd}T12:00:00`)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-border-light bg-background shadow-sm sm:h-auto sm:min-h-[5.5rem] sm:w-11 sm:min-w-[2.75rem] sm:px-0"
            onClick={goNextDay}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {mode === "month" && showMonthOption && monthBounds && (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-border-light bg-background shadow-sm sm:h-auto sm:min-h-[5.5rem] sm:w-11 sm:min-w-[2.75rem] sm:px-0"
            onClick={goPrevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 rounded-xl border border-border-light bg-background px-3 py-3 text-center shadow-sm sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Monthly</p>
            <p className="mt-0.5 text-xs font-semibold text-text-secondary">{monthBounds.monthLabel}</p>
            <p className="mt-1 break-words text-base font-bold leading-snug text-text-primary sm:text-lg">
              {fmtRangeLine(monthBounds.from)} – {fmtRangeLine(monthBounds.to)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-border-light bg-background shadow-sm sm:h-auto sm:min-h-[5.5rem] sm:w-11 sm:min-w-[2.75rem] sm:px-0"
            onClick={goNextMonth}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {mode === "week" && (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-border-light bg-background shadow-sm sm:h-auto sm:min-h-[5.5rem] sm:w-11 sm:min-w-[2.75rem] sm:px-0"
            onClick={goPrev}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 rounded-xl border border-border-light bg-background px-3 py-3 text-center shadow-sm sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Week</p>
            <p className="mt-0.5 text-xs font-semibold text-text-secondary">
              Week {weekNum} · {weekLabel}
            </p>
            <p className="mt-1 break-words text-base font-bold leading-snug text-text-primary sm:text-lg">
              {prettyRange}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 border-border-light bg-background shadow-sm sm:h-auto sm:min-h-[5.5rem] sm:w-11 sm:min-w-[2.75rem] sm:px-0"
            onClick={goNext}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {mode === "range" && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-text-tertiary">From</label>
              <Input type="date" value={rangeFrom} onChange={(e) => onRangeFromChange(e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-text-tertiary">To</label>
              <Input type="date" value={rangeTo} onChange={(e) => onRangeToChange(e.target.value)} className="w-full" />
            </div>
          </div>
          {rangeHelperText ? <p className="text-xs text-text-tertiary">{rangeHelperText}</p> : null}
        </div>
      )}

      {mode === "all" && showAllOption && !hideAllDescription && (
        <p className="text-sm text-text-secondary">
          {allPeriodDescription ?? "Showing all periods (no date filter on the list)."}
        </p>
      )}
    </div>
  );
}
