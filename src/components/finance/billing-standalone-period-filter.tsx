"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  billingStandaloneFilterIsActive,
  type BillingStandaloneFilterValue,
} from "@/lib/billing-standalone-filter";

type Props = {
  value: BillingStandaloneFilterValue;
  onChange: (next: BillingStandaloneFilterValue) => void;
  className?: string;
};

/** Billing control tower: All + custom range (due dates / pay periods). */
export function BillingStandalonePeriodFilter({ value, onChange, className }: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isCustom = value.mode === "custom";
  const rangeActive = billingStandaloneFilterIsActive(value);

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
        className="inline-flex rounded-lg border border-border-light bg-white p-0.5 gap-0.5"
        role="group"
        aria-label="Billing period filter"
      >
        <button
          type="button"
          onClick={() => {
            onChange({ mode: "all", customFrom: "", customTo: "" });
            setOverflowOpen(false);
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            value.mode === "all"
              ? "bg-[#020040] text-white"
              : "text-text-secondary hover:bg-surface-hover",
          )}
        >
          All
        </button>
        <button
          type="button"
          aria-label="Custom date range"
          title={rangeActive ? "Custom range active" : "Filter by date range"}
          onClick={() => {
            onChange({ ...value, mode: "custom" });
            setOverflowOpen((o) => !o);
          }}
          className={cn(
            "inline-flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
            isCustom
              ? "bg-[#020040] text-white"
              : "text-text-secondary hover:bg-surface-hover",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {overflowOpen ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[260px] rounded-xl border border-border-light bg-white shadow-lg p-3 space-y-2.5">
          <p className="text-[11px] text-text-secondary leading-snug">
            Filter invoices by <strong className="text-[#020040]">due date</strong> and self-bills by{" "}
            <strong className="text-[#020040]">pay work period</strong> (inclusive).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-text-tertiary">From</label>
              <input
                type="date"
                value={value.customFrom ?? ""}
                onChange={(e) => onChange({ ...value, mode: "custom", customFrom: e.target.value })}
                className="h-8 w-full rounded-md border border-border-light px-2 text-xs outline-none focus:border-[#ED4B00]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-text-tertiary">To</label>
              <input
                type="date"
                value={value.customTo ?? ""}
                onChange={(e) => onChange({ ...value, mode: "custom", customTo: e.target.value })}
                className="h-8 w-full rounded-md border border-border-light px-2 text-xs outline-none focus:border-[#ED4B00]"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setOverflowOpen(false)}
              className="text-[11px] text-text-tertiary hover:text-text-primary"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
