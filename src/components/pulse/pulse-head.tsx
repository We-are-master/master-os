"use client";

import { Crown, Download, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { LiveIndicator, MicroLabel } from "@/components/fx/primitives";

const PRESETS = [
  { id: "1d", label: "Today" },
  { id: "wtd", label: "Week" },
  { id: "mtd", label: "Month" },
  { id: "qtd", label: "QTD" },
] as const;

type Props = {
  firstName: string;
  todaysJobsCount?: number;
  ceoMode: boolean;
  canSeeCeo: boolean;
  onToggleCeo: (v: boolean) => void;
};

export function PulseHead({ firstName, todaysJobsCount, ceoMode, canSeeCeo, onToggleCeo }: Props) {
  const { preset, setPreset } = useDashboardDateRange();
  const greeting = getGreeting();
  const today = new Date();

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
        <div className="inline-flex bg-fx-paper-2 rounded-md p-[3px] gap-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={cn(
                "px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors",
                preset === p.id
                  ? "bg-card text-text-primary shadow-fx-1"
                  : "bg-transparent text-fx-mute hover:text-text-primary",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
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
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md text-[13px] font-medium bg-fx-coral text-white hover:bg-fx-coral-h transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Job
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
