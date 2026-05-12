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
  /** Hide the "Arrival time *" label when the parent renders one already. */
  hideLabel?: boolean;
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
  hideLabel = false,
}: Props) {
  const activeSlotId: ArrivalSlotId =
    matchArrivalSlot(arrivalFrom, arrivalWindowMins) ??
    nearestArrivalSlot(arrivalFrom, arrivalWindowMins);

  return (
    <div className={className}>
      {!hideLabel && (
        <label className="block text-xs font-medium text-text-secondary mb-1.5">
          Arrival time *
        </label>
      )}
      <div className={cn("flex flex-wrap gap-1.5", compact && "gap-1")}>
        {ARRIVAL_SLOTS.map((slot) => {
          const active = activeSlotId === slot.id;
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => onPick(slot.from, String(slot.mins))}
              aria-pressed={active}
              className={cn(
                "rounded-md border font-semibold transition-colors",
                compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-light bg-card text-text-secondary hover:border-primary/40 hover:text-text-primary",
              )}
            >
              {slot.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
