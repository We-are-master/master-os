"use client";

import { cn } from "@/lib/utils";
import {
  ARRIVAL_SLOTS,
  type ArrivalSlotId,
  matchArrivalSlot,
  nearestArrivalSlot,
} from "@/lib/job-arrival-window";

type Props = {
  arrivalFrom: string;
  arrivalWindowMins: string;
  /** Two writes per pick: arrival_from + arrival_window_mins. Parent owns the state. */
  onPick: (from: string, mins: string) => void;
  className?: string;
  /** Compact variant for tight spots (used in Rate Type row alongside Type of Work). */
  compact?: boolean;
  /** One row of four slots, h-10 — pairs with Start Date on the same row. */
  rowLayout?: boolean;
  /** Hide the "Arrival time *" label when the parent renders one already. */
  hideLabel?: boolean;
  /** Display-only — shows active slot without allowing changes. */
  readOnly?: boolean;
};

/**
 * Fixed-slot arrival picker reused across modals + the Rate Type section in
 * CreateJobModal. Maps each slot to a single (arrival_from, arrival_window_mins)
 * pair so the schema and partner app keep their existing contract.
 */
export function ArrivalSlotPicker({
  arrivalFrom,
  arrivalWindowMins,
  onPick,
  className,
  compact = false,
  rowLayout = false,
  hideLabel = false,
  readOnly = false,
}: Props) {
  const activeSlotId: ArrivalSlotId =
    matchArrivalSlot(arrivalFrom, arrivalWindowMins) ??
    nearestArrivalSlot(arrivalFrom, arrivalWindowMins);

  return (
    <div className={className}>
      {!hideLabel && (
        <label className="block text-xs font-medium text-text-secondary mb-1.5">
          Arrival Time *
        </label>
      )}
      <div
        className={cn(
          "grid min-w-0 gap-1.5",
          rowLayout ? "grid-cols-4" : compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4",
        )}
      >
        {ARRIVAL_SLOTS.map((slot) => {
          const active = activeSlotId === slot.id;
          const className = cn(
            "w-full rounded-md border font-semibold tabular-nums text-center",
            rowLayout
              ? "flex h-10 min-h-10 items-center justify-center px-1 text-[10px] leading-tight sm:text-[11px]"
              : compact
                ? "px-1.5 py-1 text-[11px] leading-tight"
                : "px-1.5 py-2 text-[10px] leading-tight sm:px-2 sm:text-xs",
            active
              ? "border-primary bg-primary/10 text-primary shadow-[0_0_0_1px_var(--color-primary)_inset]"
              : "border-border-light bg-card text-text-secondary",
            !readOnly && !active && "transition-all hover:border-primary/40 hover:text-text-primary",
          );
          if (readOnly) {
            return (
              <div
                key={slot.id}
                className={cn(className, !active && "opacity-50")}
              >
                {slot.label}
              </div>
            );
          }
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => onPick(slot.from, String(slot.mins))}
              aria-pressed={active}
              className={className}
            >
              {slot.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
