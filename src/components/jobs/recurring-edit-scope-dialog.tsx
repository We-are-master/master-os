"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Repeat, CalendarRange, Layers } from "lucide-react";

export type RecurrenceEditScope = "this_only" | "this_and_following" | "entire_series";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Friendly label shown in the dialog title — e.g. "schedule change" or "cancellation". */
  actionLabel?: string;
  /**
   * Sequence index of the job being edited within its series. Used in copy
   * ("Visit 3 of 8" hint).
   */
  sequenceIndex?: number | null;
  /** Total visits in the series (best-effort hint — not enforced). */
  totalOccurrences?: number | null;
  onConfirm: (scope: RecurrenceEditScope) => void | Promise<void>;
};

/**
 * Dialog the operator sees when they save a change to a recurring job.
 * Three exclusive scopes:
 *
 *   • this_only          → detach the row, apply edits to it alone
 *   • this_and_following → apply to this + future, possibly forking a new series
 *   • entire_series      → update the series rule itself + regenerate future
 *
 * Reused by both the edit flow and the cancel flow (parent passes a different
 * `actionLabel`).
 */
export function RecurringEditScopeDialog({
  open,
  onClose,
  actionLabel = "change",
  sequenceIndex,
  totalOccurrences,
  onConfirm,
}: Props) {
  const [busyScope, setBusyScope] = useState<RecurrenceEditScope | null>(null);

  async function handle(scope: RecurrenceEditScope) {
    setBusyScope(scope);
    try {
      await onConfirm(scope);
    } finally {
      setBusyScope(null);
    }
  }

  const seqHint =
    sequenceIndex && totalOccurrences
      ? `Visit ${sequenceIndex} of ${totalOccurrences}.`
      : sequenceIndex
        ? `Visit ${sequenceIndex} in the series.`
        : "Part of a recurring series.";

  return (
    <Modal open={open} onClose={onClose} title={`Apply ${actionLabel} to…`} size="md">
      <div className="space-y-3 p-2">
        <p className="text-xs text-text-secondary">
          <Repeat className="inline h-3 w-3 mr-1 -mt-0.5" />
          {seqHint} Choose where this {actionLabel} should apply.
        </p>

        <ScopeButton
          icon={<CalendarRange className="h-4 w-4" />}
          title="This visit only"
          description="Detach this occurrence and apply the change here. Future visits in the series stay untouched."
          busy={busyScope === "this_only"}
          disabled={busyScope !== null}
          onClick={() => handle("this_only")}
        />
        <ScopeButton
          icon={<Layers className="h-4 w-4" />}
          title="This and future visits"
          description="Apply the change to this visit and every future occurrence in the series. Past completed visits are not affected."
          busy={busyScope === "this_and_following"}
          disabled={busyScope !== null}
          onClick={() => handle("this_and_following")}
        />
        <ScopeButton
          icon={<Repeat className="h-4 w-4" />}
          title="Entire series"
          description="Apply to every active visit (past and future), and update the series template. Use carefully."
          busy={busyScope === "entire_series"}
          disabled={busyScope !== null}
          onClick={() => handle("entire_series")}
          danger
        />

        <div className="flex justify-end pt-2 border-t border-border-light">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busyScope !== null}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ScopeButton({
  icon, title, description, onClick, busy, disabled, danger,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full rounded-xl border bg-card p-3 text-left transition-colors",
        "flex items-start gap-3",
        danger
          ? "border-amber-300 hover:border-amber-500 hover:bg-amber-50/40 dark:border-amber-700/50 dark:hover:bg-amber-950/30"
          : "border-border-light hover:border-primary/40 hover:bg-surface-hover/40",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <span className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        danger ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200" : "bg-primary/10 text-primary",
      )}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">
          {title}
          {busy ? <span className="ml-2 text-[10px] font-normal text-text-tertiary">applying…</span> : null}
        </p>
        <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
  );
}
