"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { parseISO, format, getISOWeek, isValid } from "date-fns";
import { enGB } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import type { FinancePeriodMode } from "@/lib/finance-period";

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
  /** Shown under the date inputs in range mode (e.g. pay run is one week at a time). */
  rangeHelperText?: string;
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
  rangeHelperText,
}: FinanceWeekRangeBarProps) {
  const { weekStart, weekEnd, weekLabel } = useMemo(
    () => getWeekBoundsForDate(weekAnchor),
    [weekAnchor]
  );
  const weekNum = useMemo(() => {
    const m = parseISO(weekStart);
    return isValid(m) ? getISOWeek(m) : 0;
  }, [weekStart]);
  const prettyRange = `${fmtRangeLine(weekStart)} – ${fmtRangeLine(weekEnd)}`;

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

  const pill = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
      active
        ? "bg-primary text-white shadow-sm"
        : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary"
    );

  const handleMode = (m: FinancePeriodMode) => {
    if (!showAllOption && m === "all") return;
    onModeChange(m);
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border-light bg-card/90 p-3 shadow-sm sm:p-4",
        className
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          Period
        </span>
        <div className="flex flex-wrap gap-1.5">
          {showAllOption && (
            <button type="button" className={pill(mode === "all")} onClick={() => handleMode("all")}>
              All
            </button>
          )}
          <button type="button" className={pill(mode === "week")} onClick={() => handleMode("week")}>
            Week
          </button>
          <button type="button" className={pill(mode === "range")} onClick={() => handleMode("range")}>
            Date range
          </button>
        </div>
      </div>

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

      {mode === "all" && showAllOption && (
        <p className="text-sm text-text-secondary">Showing all periods (no date filter on the list).</p>
      )}
    </div>
  );
}
