"use client";

import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRESET_OPTIONS } from "@/lib/dashboard-date-range";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { Input } from "@/components/ui/input";

export function DashboardDateToolbar() {
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
    <div className="rounded-2xl border border-border-light bg-card/60 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide inline-flex items-center gap-1.5 mr-1">
          <CalendarRange className="h-3.5 w-3.5" />
          Date range
        </span>
        {PRESET_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setPreset(opt.id)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              preset === opt.id
                ? "bg-primary text-white border-primary"
                : "bg-surface-hover text-text-secondary border-border hover:border-primary/40"
            )}
          >
            {opt.label}
          </button>
        ))}
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
        Widgets and job filter chips use: <strong className="text-text-secondary">{rangeLabel}</strong>
        {preset === "custom" && (!customFrom || !customTo) && (
          <span className="text-amber-600 dark:text-amber-400 ml-1">— pick both dates</span>
        )}
      </p>
    </div>
  );
}
