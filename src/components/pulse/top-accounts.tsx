"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";
import { fetchPulseTopAccounts, type PulseTopAccountRow } from "@/lib/pulse-top-accounts";

export function TopAccounts() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [rows, setRows] = useState<PulseTopAccountRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRows(null);
    });
    void (async () => {
      try {
        const supabase = getSupabase();
        const result = await fetchPulseTopAccounts(supabase, bounds);
        if (!cancelled) setRows(result);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const max = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.billed)) : 1;

  return (
    <SectionCard
      title="Top Accounts"
      subtitle={`By billed value · ${bounds ? rangeLabel : "this month"}`}
      bodyClassName="p-0"
    >
      <div className="flex flex-col">
        {!rows ? (
          <div className="px-5 py-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-fx-paper-2/40 rounded animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-fx-mute text-[13px]">
            No revenue in this period.
          </div>
        ) : (
          rows.map((r, i) => {
            const pct = (r.billed / max) * 100;
            return (
              <div
                key={r.rowId}
                className={
                  i < rows.length - 1
                    ? "px-5 py-3 grid grid-cols-[1fr_auto] gap-2 items-center border-b border-fx-line"
                    : "px-5 py-3 grid grid-cols-[1fr_auto] gap-2 items-center"
                }
              >
                <div className="min-w-0">
                  <div className="font-medium text-text-primary truncate">{r.name}</div>
                  <MicroLabel className="block mt-1 truncate">
                    {r.isAccount
                      ? `${r.ownerName ? `${r.ownerName} · ` : ""}${r.jobs} job${r.jobs === 1 ? "" : "s"}`
                      : `Direct client · ${r.jobs} job${r.jobs === 1 ? "" : "s"}`}
                  </MicroLabel>
                  <div className="h-1 bg-fx-paper-2 rounded-full mt-2 overflow-hidden">
                    <div
                      className={r.isAccount ? "h-full bg-fx-coral" : "h-full bg-fx-blue"}
                      style={{ width: `${Math.max(8, pct)}%` }}
                    />
                  </div>
                </div>
                <div className="font-semibold text-text-primary tabular-nums">
                  {formatGbp(r.billed)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
