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
          Arrival time *
        </label>
      )}
      <div
        className={cn(
          compact ? "grid grid-cols-2 gap-1" : "flex min-w-0 flex-nowrap gap-1 overflow-x-auto sm:gap-1.5",
        )}
      >
        {ARRIVAL_SLOTS.map((slot) => {
          const active = activeSlotId === slot.id;
          const className = cn(
            "rounded-md border font-semibold tabular-nums text-center whitespace-nowrap",
            compact
              ? "px-1.5 py-1 text-[11px]"
              : "min-w-0 flex-1 px-1 py-2 text-[10px] leading-tight sm:px-2 sm:py-2 sm:text-xs",
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
