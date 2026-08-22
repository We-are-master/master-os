"use client";

import { cn } from "@/lib/utils";

export type SegmentedOption = {
  id: string;
  label: string;
  /** Optional count chip after the label. */
  count?: number;
};

/**
 * The OS segmented switch: one recessed track, the active segment raised on the
 * card surface. Same shape as the date picker and the List / Kanban switch, so
 * "pick one of these" looks the same everywhere.
 *
 * It replaces an older pill variant that drew a tinted, gradient-filled bar —
 * that one read as a highlighted alert rather than a control.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-fx-paper-2 p-[3px]", className)}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-[5px] text-[12.5px]",
              active
                ? "bg-card text-text-primary shadow-fx-1"
                : "bg-transparent text-fx-mute hover:text-text-primary",
            )}
          >
            {opt.label}
            {opt.count !== undefined ? (
              <span
                className={cn(
                  "rounded px-1 py-0.5 font-mono text-[10px] tabular-nums",
                  active ? "bg-fx-paper-2 text-text-secondary" : "bg-card/60 text-fx-mute",
                )}
              >
                {opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
