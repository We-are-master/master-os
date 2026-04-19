"use client";

import type { ReactNode } from "react";
import type { DateRangePreset } from "@/lib/dashboard-date-range";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DashboardDateToolbarProps {
  /** Renders on the same row as the period pills (e.g. job filters). */
  trailing?: ReactNode;
  /** Overrides the default footnote under the preset row (e.g. CEO dashboard). */
  footnote?: ReactNode;
}

const PERIOD_PILLS: { id: DateRangePreset; label: string }[] = [
  { id: "1d", label: "Today" },
  { id: "wtd", label: "Week" },
  { id: "mtd", label: "Month" },
  { id: "qtd", label: "Quarter" },
  { id: "ytd", label: "Year" },
  { id: "all", label: "All" },
  { id: "custom", label: "Custom" },
];

export function DashboardDateToolbar({ trailing, footnote }: DashboardDateToolbarProps) {
  const {
    preset,
    setPreset,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    rangeLabel,
  } = useDashboardDateRange();

  return (
    <div className="rounded-2xl border border-border-light bg-[#FAFAFB] px-4 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_PILLS.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setPreset(pill.id)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
                preset === pill.id
                  ? "bg-primary text-white"
                  : "bg-surface-hover text-text-secondary hover:bg-surface-tertiary",
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
        {trailing != null && <div className="shrink-0">{trailing}</div>}
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">From</label>
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-text-tertiary uppercase mb-1">To</label>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
          </div>
        </div>
      )}

      <p className="text-[11px] text-text-tertiary">
        {footnote ?? (
          <>
            <strong className="text-text-secondary">{rangeLabel}</strong>
            {preset === "custom" && (!customFrom || !customTo) && (
              <span className="text-amber-600 ml-1">— pick both dates</span>
            )}
          </>
        )}
      </p>
    </div>
  );
}
