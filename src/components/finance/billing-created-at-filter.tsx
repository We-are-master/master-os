"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  billingCreatedAtFilterIsActive,
  type BillingCreatedAtFilterValue,
} from "@/lib/billing-created-at-filter";

type Props = {
  value: BillingCreatedAtFilterValue;
  onChange: (next: BillingCreatedAtFilterValue) => void;
  className?: string;
};

/**
 * Billing period: `created_at` only. Same segment pill UI as Pulse / {@link DateRangeFilter}
 * (All + overflow for custom range).
 */
export function BillingCreatedAtFilter({ value, onChange, className }: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isCustom = value.mode === "custom";
  const rangeActive = billingCreatedAtFilterIsActive(value);

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
        aria-label="Created at filter"
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
          aria-label="Created date range"
          title={rangeActive ? "Custom created range active" : "Filter by created date range"}
          onClick={() => {
            onChange({ ...value, mode: "custom" });
            setOverflowOpen((o) => !o);
          }}
          className={cn(
            "px-2 py-[5px] rounded text-[12.5px] font-medium transition-colors inline-flex items-center justify-center",
            isCustom
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {overflowOpen ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[260px] rounded-xl border border-fx-line bg-card shadow-fx-2 p-3 space-y-2.5">
          <p className="text-[11px] text-fx-mute leading-snug">
            Filter by <strong className="text-text-primary">created</strong> date (inclusive).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10.5px] uppercase tracking-wide text-fx-mute mb-1">From</label>
              <input
                type="date"
                value={value.customFrom ?? ""}
                onChange={(e) => onChange({ ...value, mode: "custom", customFrom: e.target.value })}
                className="w-full h-8 text-[12px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
              />
            </div>
            <div>
              <label className="block text-[10.5px] uppercase tracking-wide text-fx-mute mb-1">To</label>
              <input
                type="date"
                value={value.customTo ?? ""}
                onChange={(e) => onChange({ ...value, mode: "custom", customTo: e.target.value })}
                className="w-full h-8 text-[12px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setOverflowOpen(false)}
              className="text-[11px] text-fx-mute hover:text-text-primary"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
