"use client";

import { useMemo } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";
import { Award, Star } from "lucide-react";

export type BestSellerOwnerRow = {
  name: string;
  revenue: number;
  jobCount: number;
};

export function BestSellersByOwner({
  items,
  loading,
  rangeLabel,
}: {
  items: BestSellerOwnerRow[];
  loading: boolean;
  rangeLabel: string;
}) {
  const maxRev = useMemo(() => Math.max(...items.map((d) => d.revenue), 1), [items]);

  return (
    <Card padding="none" className="h-full border-border-light overflow-hidden">
      <CardHeader className="px-5 pt-4 pb-2 flex flex-row items-start justify-between gap-3 mb-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center shrink-0">
            <Award className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Top 3 — job owners</CardTitle>
            <p className="text-xs text-text-tertiary mt-0.5">
              Billable value by owner · jobs in range (excl. cancelled) · {rangeLabel}
            </p>
          </div>
        </div>
      </CardHeader>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-hover" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-tertiary py-8 text-center">No jobs in this period</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {items.slice(0, 3).map((row, i) => (
              <li
                key={row.name}
                className="rounded-xl border border-border-light/80 bg-surface-hover/30 p-3 flex flex-col gap-2 min-h-[5.5rem]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold",
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : i === 1
                          ? "bg-slate-100 text-slate-600"
                          : i === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-surface-hover text-text-tertiary",
                    )}
                  >
                    {i === 0 ? <Star className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <p className="text-sm font-semibold text-text-primary truncate flex-1">{row.name}</p>
                  <p className="text-sm font-bold tabular-nums text-text-primary shrink-0">{formatCurrency(row.revenue)}</p>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden mt-auto">
                  <div
                    className="h-full rounded-full bg-emerald-500/80 transition-all duration-500"
                    style={{ width: `${(row.revenue / maxRev) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-text-tertiary">
                  {row.jobCount} job{row.jobCount === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
