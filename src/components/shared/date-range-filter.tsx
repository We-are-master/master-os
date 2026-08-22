"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DATE_FILTER_MENU_OPTIONS,
  dateFilterLabel,
  localYmd,
  type DateFilterMode,
  type DateFilterValue,
} from "@/lib/date-range-filter";

type Props = {
  value: DateFilterValue;
  onChange: (next: DateFilterValue) => void;
  className?: string;
};

/**
 * The date picker of the OS. One chip carrying the active window, one "…" that
 * holds every option: All, Today, Yesterday, Tomorrow, This week, Next week,
 * This month, Next month, and a Range split into On (single day) / Between.
 *
 * There is deliberately one look and no variants. Pulse, Live View, Jobs and
 * Quotes each used to render a different strip of chips over the same data, so
 * the same filter read differently on every tab.
 */
export function DateRangeFilter({ value, onChange, className }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div ref={wrapRef} className={cn("relative inline-flex items-center", className)}>
      <div className="inline-flex bg-fx-paper-2 rounded-md p-[3px] gap-0.5">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded bg-card px-3 py-[5px] text-[12.5px] font-medium text-text-primary shadow-fx-1 transition-colors"
        >
          {dateFilterLabel(value) || "Today"}
        </button>
        <button
          type="button"
          aria-label="More date options"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            "inline-flex items-center justify-center rounded px-2 py-[5px] text-[12.5px] font-medium transition-colors",
            menuOpen
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {menuOpen && <CompactMenu value={value} onChange={onChange} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

/**
 * Compact "…" menu: every window in one list, with the range split into
 * "On" (a single day) and "Between" (a window). Nothing is applied until the
 * range is complete, so a half-typed date never blanks the board.
 */
function CompactMenu({
  value,
  onChange,
  onClose,
}: {
  value: DateFilterValue;
  onChange: (next: DateFilterValue) => void;
  onClose: () => void;
}) {
  const isCustom = value.mode === "custom";
  const sameDay = isCustom && !!value.customFrom && value.customFrom === value.customTo;
  const [rangeKind, setRangeKind] = useState<"on" | "between">(sameDay ? "on" : "between");
  const [rangeOpen, setRangeOpen] = useState(isCustom);
  const today = localYmd(new Date());
  const [onDate, setOnDate] = useState(sameDay ? value.customFrom! : today);
  const [fromDate, setFromDate] = useState(value.customFrom || today);
  const [toDate, setToDate] = useState(value.customTo || today);

  const pick = (mode: DateFilterMode) => {
    onChange({ ...value, mode });
    onClose();
  };

  const applyRange = () => {
    if (rangeKind === "on") {
      if (!onDate) return;
      onChange({ mode: "custom", customFrom: onDate, customTo: onDate });
    } else {
      if (!fromDate || !toDate) return;
      // Tolerate a reversed window instead of silently returning zero rows.
      const [a, b] = fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate];
      onChange({ mode: "custom", customFrom: a, customTo: b });
    }
    onClose();
  };

  const rowClass = (active: boolean) =>
    cn(
      "w-full rounded-md px-2.5 py-[7px] text-left text-[12.5px] font-medium transition-colors",
      active ? "bg-fx-coral text-white" : "text-text-primary hover:bg-fx-paper",
    );

  return (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-[236px] rounded-xl border border-fx-line bg-card p-1.5 shadow-fx-2">
      {DATE_FILTER_MENU_OPTIONS.map((opt) => (
        <button key={opt.id} type="button" onClick={() => pick(opt.id)} className={rowClass(value.mode === opt.id)}>
          {opt.label}
        </button>
      ))}
      <div className="my-1 h-px bg-fx-line" />
      <button
        type="button"
        onClick={() => setRangeOpen((v) => !v)}
        className={rowClass(isCustom && !rangeOpen)}
      >
        Range
      </button>
      {rangeOpen && (
        <div className="space-y-2 px-1 pb-1 pt-2">
          <div className="inline-flex w-full gap-0.5 rounded-md bg-fx-paper-2 p-[3px]">
            {(["on", "between"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setRangeKind(k)}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-[12px] font-medium capitalize transition-colors",
                  rangeKind === k
                    ? "bg-card text-text-primary shadow-fx-1"
                    : "bg-transparent text-fx-mute hover:text-text-primary",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          {rangeKind === "on" ? (
            <input
              type="date"
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className="h-8 w-full rounded-md border border-fx-line bg-card px-2 text-[12px] outline-none focus:border-fx-coral"
            />
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="date"
                aria-label="From"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 w-full rounded-md border border-fx-line bg-card px-2 text-[12px] outline-none focus:border-fx-coral"
              />
              <input
                type="date"
                aria-label="To"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 w-full rounded-md border border-fx-line bg-card px-2 text-[12px] outline-none focus:border-fx-coral"
              />
            </div>
          )}
          <button
            type="button"
            onClick={applyRange}
            className="w-full rounded-md bg-fx-coral px-2.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
