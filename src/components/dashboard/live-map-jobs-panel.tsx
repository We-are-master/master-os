"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleLiveMapJobPoint } from "@/components/dashboard/schedule-live-map";
import {
  liveMapJobStatusLegend,
  type LiveMapJobStatusCategory,
} from "@/components/dashboard/live-map-marker-icons";

interface LiveMapJobsPanelProps {
  /** Jobs visible on the map for the active date window (already trade/account filtered). */
  jobPoints: ScheduleLiveMapJobPoint[];
  /** When set, only this category is scoping job pins. */
  selectedStatus: LiveMapJobStatusCategory | null;
  onStatusToggle: (category: LiveMapJobStatusCategory) => void;
  /** Selected for dispatch — kept in the panel so users can clear without leaving. */
  selectedJobIds: ReadonlySet<string>;
  onClearSelection: () => void;
  /** Same date window — jobs that have no geocoded address (can't be pinned). */
  jobsMissingLocation: number;
  /** Display label for the active date window (Today / 14 May / 14–17 May …). */
  dateLabel: string;
}

export function LiveMapJobsPanel({
  jobPoints,
  selectedStatus,
  onStatusToggle,
  selectedJobIds,
  onClearSelection,
  jobsMissingLocation,
  dateLabel,
}: LiveMapJobsPanelProps) {
  const counts = useMemo(() => {
    const map = new Map<LiveMapJobStatusCategory, number>([
      ["unassigned", 0],
      ["scheduled", 0],
      ["in_progress", 0],
      ["attention", 0],
    ]);
    for (const j of jobPoints) {
      map.set(j.statusCategory, (map.get(j.statusCategory) ?? 0) + 1);
    }
    return map;
  }, [jobPoints]);

  return (
    <div className="w-[280px] max-w-[92vw] rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-md backdrop-blur-sm dark:border-border dark:bg-card/95">
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#020040]">
          Jobs
        </span>
        <span className="text-[10px] text-[#64748B]">
          {jobPoints.length} · {dateLabel}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {liveMapJobStatusLegend().map(({ key, label, color }) => {
          const count = counts.get(key) ?? 0;
          const active = selectedStatus === key;
          const empty = count === 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onStatusToggle(key)}
              aria-pressed={active}
              disabled={empty && !active}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[11.5px] transition-colors",
                active
                  ? "bg-[#020040]/5 text-[#020040]"
                  : empty
                    ? "cursor-default text-[#94A3B8]"
                    : "text-[#020040] hover:bg-[#FAFAFB]",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    empty && !active ? "opacity-40" : "",
                  )}
                  style={{ background: color }}
                  aria-hidden
                />
                <span className="font-medium">{label}</span>
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {jobsMissingLocation > 0 || selectedJobIds.size > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[#E4E4E8] pt-1.5">
          {jobsMissingLocation > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-[#FEF3C7] px-2 py-0.5 text-[10.5px] font-medium text-[#92400E]"
              title="These jobs have no geocoded address so they can't be placed on the map."
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {jobsMissingLocation} no location
            </span>
          ) : null}
          {selectedJobIds.size > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#020040] px-2 py-0.5 text-[10.5px] font-semibold text-white">
              {selectedJobIds.size} selected
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded bg-white/15 px-1.5 py-0.5 text-[9.5px] font-medium text-white hover:bg-white/25"
              >
                Clear
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
