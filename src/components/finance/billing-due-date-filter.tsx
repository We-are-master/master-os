"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  billingDueDateFilterIsActive,
  type BillingDueDateFilterValue,
  type OrgPayoutScheduleCtx,
} from "@/lib/billing-due-date-filter";

type Props = {
  value: BillingDueDateFilterValue;
  onChange: (next: BillingDueDateFilterValue) => void;
  todayYmd: string;
  orgSchedule?: OrgPayoutScheduleCtx;
  className?: string;
};

/**
 * Payment due filter for Self-Billing Ready / Overdue tabs.
 */
export function BillingDueDateFilter({ value, onChange, todayYmd, orgSchedule, className }: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rangeActive = billingDueDateFilterIsActive(value, todayYmd, orgSchedule);

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  return (
    <div ref={wrapRef} className={cn("relative inline-flex items-center", className)}>
      <div
        className="inline-flex bg-fx-paper-2 rounded-md p-[3px] gap-0.5"
        role="group"
        aria-label="Payment due filter"
      >
        <button
          type="button"
          onClick={() => {
            onChange({ mode: "all", customFrom: "", customTo: "" });
            setOverflowOpen(false);
          }}
          className={cn(
            "px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors",
            value.mode === "all"
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => {
            onChange({ mode: "this_friday", customFrom: "", customTo: "" });
            setOverflowOpen(false);
          }}
          className={cn(
            "px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors whitespace-nowrap",
            value.mode === "this_friday"
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          This Friday
        </button>
        <button
          type="button"
          onClick={() => {
            onChange({ mode: "next_friday", customFrom: "", customTo: "" });
            setOverflowOpen(false);
          }}
          className={cn(
            "px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors whitespace-nowrap",
            value.mode === "next_friday"
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          Next Friday
        </button>
        <button
          type="button"
          aria-label="Custom due date range"
          onClick={() => setOverflowOpen((o) => !o)}
          className={cn(
            "inline-flex items-center justify-center px-2 py-[5px] rounded text-[12.5px] font-medium transition-colors",
            value.mode === "custom" && rangeActive
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {overflowOpen ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-border-light bg-card p-3 shadow-lg">
          <p className="mb-2 text-[11px] font-semibold text-text-secondary">Custom due range</p>
          <div className="space-y-2">
            <label className="block text-[10px] text-text-tertiary">
              From
              <input
                type="date"
                className="mt-0.5 w-full rounded border border-border-light px-2 py-1 text-xs"
                value={value.customFrom ?? ""}
                onChange={(e) => onChange({ ...value, mode: "custom", customFrom: e.target.value })}
              />
            </label>
            <label className="block text-[10px] text-text-tertiary">
              To
              <input
                type="date"
                className="mt-0.5 w-full rounded border border-border-light px-2 py-1 text-xs"
                value={value.customTo ?? ""}
                onChange={(e) => onChange({ ...value, mode: "custom", customTo: e.target.value })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
