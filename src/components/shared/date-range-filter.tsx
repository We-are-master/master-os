"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DATE_FILTER_QUICK_OPTIONS,
  type DateFilterMode,
  type DateFilterValue,
} from "@/lib/date-range-filter";

type Variant = "segment" | "chip";

type Props = {
  value: DateFilterValue;
  onChange: (next: DateFilterValue) => void;
  /** "segment" matches Pulse's pill-group look. "chip" matches Beacon/Jobs outline-chip look. */
  variant?: Variant;
  /** When true, only the "All" chip stays visible; Today/Tomorrow/Week/Month/QTD move into the … menu. */
  compactQuickOptions?: boolean;
  className?: string;
};

/**
 * Shared 5-chip date filter (Today / Tomorrow / Week / Month / QTD) plus a "…"
 * overflow button that opens a popover with the Custom range pickers. Same
 * presentation on Pulse / Live View / Jobs / Quotes / Schedule.
 */
export function DateRangeFilter({
  value,
  onChange,
  variant = "segment",
  compactQuickOptions = false,
  className,
}: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inlineQuickOptions = compactQuickOptions
    ? DATE_FILTER_QUICK_OPTIONS.filter((opt) => opt.id === "all")
    : DATE_FILTER_QUICK_OPTIONS;
  const overflowQuickOptions = compactQuickOptions
    ? DATE_FILTER_QUICK_OPTIONS.filter((opt) => opt.id !== "all")
    : [];

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  const selectQuick = (id: DateFilterMode) => {
    onChange({ ...value, mode: id });
  };

  const isCustom = value.mode === "custom";

  if (variant === "chip") {
    return (
      <div ref={wrapRef} className={cn("relative inline-flex items-center gap-1 flex-wrap", className)}>
        {inlineQuickOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => selectQuick(opt.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors border",
              value.mode === opt.id
                ? "bg-fx-coral text-white border-fx-coral"
                : "bg-card border-fx-line text-text-primary hover:bg-fx-paper",
            )}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="More date options"
          onClick={() => setOverflowOpen((v) => !v)}
          className={cn(
            "rounded-md px-2 py-1 text-[12px] font-medium transition-colors border inline-flex items-center justify-center",
            isCustom || overflowQuickOptions.some((opt) => value.mode === opt.id)
              ? "bg-fx-coral text-white border-fx-coral"
              : "bg-card border-fx-line text-text-primary hover:bg-fx-paper",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {overflowOpen && (
          <OverflowPopover
            value={value}
            onChange={onChange}
            onClose={() => setOverflowOpen(false)}
            quickOptions={overflowQuickOptions}
          />
        )}
      </div>
    );
  }

  // segment variant — matches Pulse's bg-fx-paper-2 pill group
  return (
    <div ref={wrapRef} className={cn("relative inline-flex items-center", className)}>
      <div className="inline-flex bg-fx-paper-2 rounded-md p-[3px] gap-0.5">
        {inlineQuickOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => selectQuick(opt.id)}
            className={cn(
              "px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors",
              value.mode === opt.id
                ? "bg-card text-text-primary shadow-fx-1"
                : "bg-transparent text-fx-mute hover:text-text-primary",
            )}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="More date options"
          onClick={() => setOverflowOpen((v) => !v)}
          className={cn(
            "px-2 py-[5px] rounded text-[12.5px] font-medium transition-colors inline-flex items-center justify-center",
            isCustom || overflowQuickOptions.some((opt) => value.mode === opt.id)
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {overflowOpen && (
        <OverflowPopover
          value={value}
          onChange={onChange}
          onClose={() => setOverflowOpen(false)}
          quickOptions={overflowQuickOptions}
        />
      )}
    </div>
  );
}

function OverflowPopover({
  value,
  onChange,
  onClose,
  quickOptions = [],
}: {
  value: DateFilterValue;
  onChange: (next: DateFilterValue) => void;
  onClose: () => void;
  quickOptions?: { id: Exclude<DateFilterMode, "custom">; label: string }[];
}) {
  const isCustom = value.mode === "custom";
  return (
    <div className="absolute right-0 top-full mt-1.5 z-50 w-[260px] rounded-xl border border-fx-line bg-card shadow-fx-2 p-3 space-y-2.5">
      {quickOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {quickOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange({ ...value, mode: opt.id });
                onClose();
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors border",
                value.mode === opt.id
                  ? "bg-fx-coral text-white border-fx-coral"
                  : "bg-card border-fx-line text-text-primary hover:bg-fx-paper",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          onChange({ ...value, mode: "custom" });
        }}
        className={cn(
          "w-full text-left rounded-md px-2.5 py-1.5 text-[12.5px] font-medium border transition-colors",
          isCustom
            ? "bg-fx-coral text-white border-fx-coral"
            : "bg-card border-fx-line text-text-primary hover:bg-fx-paper",
        )}
      >
        Custom range
      </button>
      {isCustom && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10.5px] uppercase tracking-wide text-fx-mute mb-1">From</label>
            <input
              type="date"
              value={value.customFrom ?? ""}
              onChange={(e) => onChange({ ...value, customFrom: e.target.value })}
              className="w-full h-8 text-[12px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
            />
          </div>
          <div>
            <label className="block text-[10.5px] uppercase tracking-wide text-fx-mute mb-1">To</label>
            <input
              type="date"
              value={value.customTo ?? ""}
              onChange={(e) => onChange({ ...value, customTo: e.target.value })}
              className="w-full h-8 text-[12px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
            />
          </div>
        </div>
      )}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-fx-mute hover:text-text-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}
