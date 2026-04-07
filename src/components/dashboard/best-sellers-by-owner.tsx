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
  limit = 3,
  compact = false,
  title,
}: {
  items: BestSellerOwnerRow[];
  loading: boolean;
  rangeLabel: string;
  limit?: number;
  compact?: boolean;
  title?: string;
}) {
  const shown = useMemo(() => items.slice(0, limit), [items, limit]);
  const maxRev = useMemo(() => Math.max(...shown.map((d) => d.revenue), 1), [shown]);

  const rankClass = (i: number) =>
    cn(
      "flex items-center justify-center shrink-0 text-[11px] font-bold",
      compact ? "h-6 w-6 rounded-md" : "h-7 w-7 rounded-full",
      i === 0
        ? "bg-amber-100 text-amber-700"
        : i === 1
          ? "bg-slate-100 text-slate-600"
          : i === 2
            ? "bg-orange-100 text-orange-700"
            : i === 3
              ? "bg-violet-100 text-violet-700"
              : "bg-surface-hover text-text-tertiary",
    );

  const cardTitle = title ?? `Top ${limit} — job owners`;

  if (compact) {
    return (
      <Card padding="none" className="h-full border-border-light flex flex-col min-h-0 overflow-hidden">
        <CardHeader className="px-3 pt-3 pb-1.5 flex flex-row items-start justify-between gap-2 mb-0 shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center shrink-0">
              <Award className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">{cardTitle}</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Booked revenue by owner · schedule start in period · {rangeLabel}
              </p>
            </div>
          </div>
        </CardHeader>
        <div className="px-3 pb-3 space-y-1 flex-1 min-h-0">
          {loading ? (
            Array.from({ length: limit }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-md bg-surface-hover" />)
          ) : shown.length === 0 ? (
            <p className="text-xs text-text-tertiary py-3 text-center">No jobs in this period</p>
          ) : (
            shown.map((row, i) => (
              <div key={row.name} className="flex items-center gap-2 py-1.5 border-b border-border-light/50 last:border-0">
                <span className={rankClass(i)}>{i === 0 ? <Star className="h-3 w-3" /> : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary truncate">{row.name}</p>
                  <div className="h-1 mt-0.5 rounded-full bg-surface-hover overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500/70 transition-all duration-500"
                      style={{ width: `${(row.revenue / maxRev) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs font-bold tabular-nums text-text-primary shrink-0">{formatCurrency(row.revenue)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card padding="none" className="h-full border-border-light overflow-hidden">
      <CardHeader className="px-5 pt-4 pb-2 flex flex-row items-start justify-between gap-3 mb-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center shrink-0">
            <Award className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{cardTitle}</CardTitle>
            <p className="text-xs text-text-tertiary mt-0.5">
              Billable value by owner · jobs in range (excl. cancelled) · {rangeLabel}
            </p>
          </div>
        </div>
      </CardHeader>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-hover" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-text-tertiary py-8 text-center">No jobs in this period</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {shown.map((row, i) => (
              <li
                key={row.name}
                className="rounded-xl border border-border-light/80 bg-surface-hover/30 p-3 flex flex-col gap-2 min-h-[5.5rem]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={rankClass(i)}>{i === 0 ? <Star className="h-3.5 w-3.5" /> : i + 1}</div>
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
