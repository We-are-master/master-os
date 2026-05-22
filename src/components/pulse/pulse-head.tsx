"use client";

import { Crown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { LiveIndicator, MicroLabel } from "@/components/fx/primitives";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import type { DateFilterMode, DateFilterValue } from "@/lib/date-range-filter";
import type { DateRangePreset } from "@/lib/dashboard-date-range";

type Props = {
  firstName: string;
  todaysJobsCount?: number;
  ceoMode: boolean;
  canSeeCeo: boolean;
  onToggleCeo: (v: boolean) => void;
};

/** Shared-filter ↔ dashboard-preset mapping. The provider keeps its broader preset
 * vocabulary (7d/30d/ytd/all) for legacy callers; this just bridges the 6 user-facing modes. */
const SHARED_TO_PRESET: Record<DateFilterMode, DateRangePreset> = {
  all: "all",
  today: "1d",
  tomorrow: "tomorrow",
  week: "wtd",
  month: "mtd",
  qtd: "qtd",
  custom: "custom",
};

const PRESET_TO_SHARED: Partial<Record<DateRangePreset, DateFilterMode>> = {
  all: "all",
  "1d": "today",
  tomorrow: "tomorrow",
  wtd: "week",
  mtd: "month",
  qtd: "qtd",
  custom: "custom",
};

export function PulseHead({ firstName, todaysJobsCount, ceoMode, canSeeCeo, onToggleCeo }: Props) {
  const { preset, setPreset, customFrom, customTo, setCustomFrom, setCustomTo } = useDashboardDateRange();
  const greeting = getGreeting();
  const today = new Date();

  // Legacy presets (7d/30d/90d/ytd/all) fall through to "today" in the shared chip strip —
  // those callers still set them programmatically via the older toolbar, this UI just won't highlight one.
  const sharedValue: DateFilterValue = {
    mode: PRESET_TO_SHARED[preset] ?? "today",
    customFrom,
    customTo,
  };

  const applyShared = (next: DateFilterValue) => {
    setPreset(SHARED_TO_PRESET[next.mode]);
    if (next.mode === "custom") {
      setCustomFrom(next.customFrom ?? "");
      setCustomTo(next.customTo ?? "");
    }
  };

  return (
    <div className="flex items-end justify-between gap-6 flex-wrap">
      <div className="flex flex-col gap-1 min-w-0">
        <MicroLabel>Pulse · Operations Overview</MicroLabel>
        <h1 className="text-[26px] font-semibold tracking-[-0.015em] leading-[1.2] text-text-primary m-0">
          {greeting}, {firstName}.
        </h1>
        <p className="text-[13px] text-fx-mute m-0">
          {formatLongDate(today)}
          {typeof todaysJobsCount === "number" && (
            <> · {todaysJobsCount} active job{todaysJobsCount === 1 ? "" : "s"} today.</>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangeFilter value={sharedValue} onChange={applyShared} variant="segment" />
        {canSeeCeo && (
          <button
            type="button"
            onClick={() => onToggleCeo(!ceoMode)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md text-[13px] font-medium border transition-colors",
              ceoMode
                ? "bg-fx-navy text-white border-fx-navy"
                : "bg-card text-text-secondary border-fx-line hover:bg-fx-paper",
            )}
            title="CEO financial dashboard"
          >
            <Crown className="h-3.5 w-3.5" />
            CEO
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md text-[13px] font-medium bg-card border border-fx-line text-text-primary hover:bg-fx-paper transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        <LiveIndicator />
      </div>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
