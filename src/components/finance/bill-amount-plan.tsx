"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { addMonths, monthKey, monthLabel } from "@/lib/bill-timeline";

/** A price change typed in the form (amount still a string while editing). */
export type DraftAmountStep = { fromMonth: string; amount: string };

const WINDOW = 6;

/**
 * "Amount over time" for a new recurring bill: price changes from a month on,
 * plus a month-by-month preview where one payment can get its own amount.
 * The parent owns the state and turns it into the per-due-date map with
 * `amountsForDueDates`, which is also what this preview reads.
 */
export function BillAmountPlan({
  dueDates,
  amounts,
  firstMonth,
  baseAmount,
  steps,
  onStepsChange,
  overrides,
  onOverridesChange,
}: {
  dueDates: string[];
  /** Resolved amount per due date (same map the save uses). */
  amounts: Record<string, number>;
  firstMonth: string;
  /** Starting amount, used as the default for a new price change. */
  baseAmount: string;
  steps: DraftAmountStep[];
  onStepsChange: (next: DraftAmountStep[]) => void;
  overrides: Record<string, string>;
  onOverridesChange: (next: Record<string, string>) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const lastMonth = dueDates.length ? monthKey(dueDates[dueDates.length - 1]) : firstMonth;
  const span = useMemo(() => {
    const [y1, m1] = firstMonth.split("-").map(Number);
    const [y2, m2] = lastMonth.split("-").map(Number);
    return (y2 - y1) * 12 + (m2 - m1) + 1;
  }, [firstMonth, lastMonth]);
  const stepMonths = new Set(steps.map((s) => s.fromMonth));

  const months = Array.from({ length: WINDOW }, (_, i) => addMonths(firstMonth, offset + i));
  const datesIn = (m: string) => dueDates.filter((d) => monthKey(d) === m);

  const addStep = () => {
    const from = steps.length ? addMonths(steps[steps.length - 1].fromMonth, 6) : addMonths(firstMonth, 6);
    const last = steps[steps.length - 1]?.amount ?? baseAmount;
    onStepsChange([...steps, { fromMonth: from, amount: last }]);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border-light bg-surface-hover/40 px-3 py-3">
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-secondary">Price changes</p>
        {steps.length === 0 ? (
          <p className="text-[11px] text-text-tertiary leading-snug">
            Same amount every time. Add a change if the price goes up or down from a given month.
          </p>
        ) : (
          steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11px] text-text-tertiary">From</span>
              <Input
                type="month"
                aria-label="Price change month"
                value={s.fromMonth}
                min={addMonths(firstMonth, 1)}
                onChange={(e) => onStepsChange(steps.map((x, j) => (j === i ? { ...x, fromMonth: e.target.value } : x)))}
              />
              <Input
                type="number"
                step="0.01"
                min={0}
                aria-label="New amount"
                value={s.amount}
                onChange={(e) => onStepsChange(steps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Remove price change"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => onStepsChange(steps.filter((_, j) => j !== i))}
              />
            </div>
          ))
        )}
        <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3 w-3" />} onClick={addStep}>
          Add price change
        </Button>
      </div>

      <div className="space-y-2 border-t border-border-light pt-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-text-secondary">By month</p>
          <span className="text-[11px] text-text-tertiary">Click a month to change only that payment</span>
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Previous months"
              disabled={offset === 0}
              icon={<ChevronLeft className="h-3.5 w-3.5" />}
              onClick={() => setOffset((o) => Math.max(0, o - WINDOW))}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Next months"
              disabled={offset + WINDOW >= span}
              icon={<ChevronRight className="h-3.5 w-3.5" />}
              onClick={() => setOffset((o) => o + WINDOW)}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {months.map((m) => {
            const ds = datesIn(m);
            const total = ds.reduce((t, d) => t + (amounts[d] ?? 0), 0);
            const overridden = ds.some((d) => d in overrides);
            const changed = !overridden && stepMonths.has(m) && ds.length > 0;
            return (
              <button
                key={m}
                type="button"
                disabled={ds.length === 0}
                onClick={() => setOpenMonth((cur) => (cur === m ? null : m))}
                className={cn(
                  "flex flex-col items-start rounded-md border px-2 py-1.5 text-left text-[11px] text-text-tertiary",
                  openMonth === m ? "border-primary" : overridden ? "border-[var(--info)]" : "border-transparent",
                  ds.length ? "bg-card hover:bg-surface-hover" : "bg-transparent",
                )}
              >
                {monthLabel(m)}
                <span
                  className={cn(
                    "text-[13px] font-semibold tabular-nums",
                    ds.length === 0
                      ? "text-text-tertiary"
                      : overridden
                        ? "text-[var(--info)]"
                        : changed
                          ? "text-amber-600"
                          : "text-text-primary",
                  )}
                >
                  {ds.length ? formatCurrency(total) : "·"}
                </span>
                {ds.length > 1 ? <span>{ds.length} payments</span> : overridden ? <span>only this one</span> : changed ? <span>new price</span> : null}
              </button>
            );
          })}
        </div>
        {openMonth ? (
          <div className="space-y-1.5 rounded-md bg-card px-2.5 py-2">
            {datesIn(openMonth).map((d) => (
              <div key={d} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] tabular-nums text-text-secondary">{formatDate(d)}</span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  aria-label={`Amount due ${d}`}
                  value={overrides[d] ?? String(amounts[d] ?? "")}
                  onChange={(e) => onOverridesChange({ ...overrides, [d]: e.target.value })}
                />
                {d in overrides ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = { ...overrides };
                      delete next[d];
                      onOverridesChange(next);
                    }}
                  >
                    Reset
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
