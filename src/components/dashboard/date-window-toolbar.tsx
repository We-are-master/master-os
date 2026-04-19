"use client";

import type { ReactNode } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared across Quotes KPIs, Requests/Jobs created-at or schedule windows. */
export type DateWindowPeriod = "day" | "week" | "month" | "all";

export const DATE_WINDOW_PRESETS: { value: DateWindowPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
];

export interface DateWindowToolbarProps {
  /** Which chip is active; `null` = none highlighted (e.g. custom range elsewhere). */
  value: DateWindowPeriod | null;
  onChange: (next: DateWindowPeriod) => void;
  loading?: boolean;
  /** Left label: default single line “DATE”. */
  label?: string;
  /** Optional right-side slot (e.g. Quotes KPI “Updating…”). */
  trailing?: ReactNode;
  /** Vertical Export control (Fixfy), e.g. `<Button …>`. */
  exportButton?: ReactNode;
}

export function DateWindowToolbar({
  value,
  onChange,
  loading,
  label = "DATE",
  trailing,
  exportButton = null,
}: DateWindowToolbarProps) {
  return (
    <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-stretch min-[480px]:gap-3">
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 rounded-[6px] border-[0.5px] border-[#E4E4E8] bg-white p-2.5 shadow-[0_2px_14px_rgba(2,0,64,0.06)] sm:flex-row sm:items-center sm:gap-3 sm:p-3",
        )}
      >
        <div className="flex items-center gap-2.5 shrink-0 sm:border-r sm:border-[#ECECEE] sm:pr-3 md:pr-4">
          <span
            className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-[6px] shrink-0"
            style={{ background: "#ECECEE", color: "#6B6B70" }}
          >
            <Calendar className="h-[17px] w-[17px] sm:h-[18px] sm:w-[18px]" strokeWidth={2} aria-hidden />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B70]">{label}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div
            className="flex flex-wrap gap-1.5 min-[380px]:gap-2"
            role="group"
            aria-label="Date window"
          >
            {DATE_WINDOW_PRESETS.map(({ value: v, label: chipLabel }) => {
              const active = value === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange(v)}
                  className={cn(
                    "rounded-[6px] px-3 py-[5px] text-[11px] font-medium transition-colors shrink-0",
                    active
                      ? "bg-[#ED4B00] text-white shadow-sm"
                      : "bg-transparent text-[#020040] hover:bg-surface-hover",
                  )}
                >
                  {chipLabel}
                </button>
              );
            })}
          </div>
          {loading ? (
            <span className="text-[11px] font-medium text-text-tertiary animate-pulse whitespace-nowrap sm:ml-auto">
              Updating…
            </span>
          ) : (
            trailing ?? null
          )}
        </div>
      </div>
      {exportButton}
    </div>
  );
}
