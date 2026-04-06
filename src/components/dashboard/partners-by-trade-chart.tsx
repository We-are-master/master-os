"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { mergeTypeOfWorkOptions, normalizeTypeOfWork } from "@/lib/type-of-work";
import type { Partner } from "@/types/database";

const BAR_COLORS = [
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f97316",
  "#fb7185",
  "#818cf8",
  "#2dd4bf",
  "#e879f9",
  "#38bdf8",
  "#c084fc",
  "#4ade80",
  "#fcd34d",
];

function tradeLabelsForPartner(p: Pick<Partner, "trade" | "trades">): string[] {
  const raw =
    Array.isArray(p.trades) && p.trades.length > 0
      ? p.trades
      : [p.trade];
  const flat = raw.map((x) => (x != null ? String(x).trim() : "")).filter(Boolean);
  const merged = mergeTypeOfWorkOptions(flat);
  if (merged.length > 0) return merged;
  const single = normalizeTypeOfWork(p.trade);
  return single ? [single] : ["Unspecified"];
}

export function PartnersByTradeChart({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<{ name: string; count: number; fill: string }[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [inactiveTotal, setInactiveTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const [activeCountRes, inactiveCountRes, first] = await Promise.all([
          supabase.from("partners").select("id", { count: "exact", head: true }).eq("status", "active"),
          supabase.from("partners").select("id", { count: "exact", head: true }).neq("status", "active"),
          supabase.from("partners").select("trade, trades, status").eq("status", "active"),
        ]);

        setActiveTotal(activeCountRes.count ?? 0);
        setInactiveTotal(inactiveCountRes.count ?? 0);

        let partnerRows: Pick<Partner, "trade" | "trades" | "status">[];
        if (first.error) {
          const second = await supabase.from("partners").select("trade, status").eq("status", "active");
          if (second.error) throw second.error;
          partnerRows = (second.data ?? []) as Pick<Partner, "trade" | "trades" | "status">[];
        } else {
          partnerRows = (first.data ?? []) as Pick<Partner, "trade" | "trades" | "status">[];
        }

        const counts: Record<string, number> = {};
        for (const p of partnerRows) {
          for (const label of tradeLabelsForPartner(p)) {
            counts[label] = (counts[label] ?? 0) + 1;
          }
        }

        const chartData = Object.entries(counts)
          .map(([name, count], i) => ({
            name,
            count,
            fill: BAR_COLORS[i % BAR_COLORS.length],
          }))
          .sort((a, b) => b.count - a.count);

        setRows(chartData);
      } catch {
        setRows([]);
        setActiveTotal(0);
        setInactiveTotal(0);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const displayRows = compact ? rows.slice(0, 12) : rows;
  const maxCount = useMemo(
    () => (displayRows.length > 0 ? Math.max(...displayRows.map((r) => r.count), 1) : 1),
    [displayRows],
  );

  const totalDir = activeTotal + inactiveTotal;
  const activeShare = totalDir > 0 ? Math.round((activeTotal / totalDir) * 1000) / 10 : 0;

  return (
    <Card padding="none" className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className={cn("flex-1 min-h-0 flex flex-col", compact ? "p-4" : "p-5")}>
        {/* Summary: active vs inactive */}
        <div className="mb-4 shrink-0 space-y-3">
          {loading ? (
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2 sm:gap-3">
              <div className="h-16 rounded-2xl animate-pulse bg-surface-hover" />
              <div className="h-16 rounded-2xl animate-pulse bg-surface-hover" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2 sm:gap-3">
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="rounded-2xl border border-emerald-500/35 bg-emerald-500/[0.08] px-3 py-3 sm:px-4 shadow-sm ring-1 ring-emerald-500/15"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Active</p>
                  <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {activeTotal}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">Eligible · trade breakdown below</p>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="rounded-2xl border border-border-light bg-card px-3 py-3 sm:px-4 hover:bg-surface-hover hover:border-border transition-colors"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Inactive</p>
                  <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
                    {inactiveTotal}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">Onboarding, needs attention, paused…</p>
                </motion.div>
              </div>
              {totalDir > 0 && (
                <div className="rounded-xl bg-surface-hover/80 p-2 sm:p-2.5">
                  <div className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px] text-text-tertiary mb-1.5">
                    <span>Directory mix</span>
                    <span className="font-semibold tabular-nums text-text-secondary">
                      {activeShare}% active
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-tertiary overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${activeShare}%` }}
                      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {loading ? (
          <div className={cn("space-y-3", compact ? "py-1" : "py-2")}>
            {Array.from({ length: compact ? 5 : 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-28 rounded animate-pulse bg-surface-hover" />
                <div className="h-8 w-full rounded-full animate-pulse bg-surface-hover" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className={cn("flex items-center justify-center", compact ? "min-h-[8rem]" : "min-h-[12rem]")}>
            <p className="text-sm text-text-tertiary">No active partners</p>
          </div>
        ) : (
          <div className="space-y-3 min-h-0 flex-1">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wide -mt-1 mb-1">
              By type of work · active partners only
            </p>
            {displayRows.map((row, i) => {
              const barPct = Math.min(100, Math.round((row.count / maxCount) * 100));
              return (
                <div key={row.name} className="space-y-1">
                  <div className="min-w-0">
                    <span
                      className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide truncate block"
                      title={row.name}
                    >
                      {row.name}
                    </span>
                  </div>
                  <div className="h-8 w-full rounded-full bg-surface-hover overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${barPct}%` }}
                      transition={{ duration: 0.55, delay: i * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
                      style={{ backgroundColor: row.fill }}
                      className={cn(
                        "h-full rounded-full flex items-center justify-center px-2 min-w-0 shadow-sm",
                        row.count > 0 && "min-w-[2.5rem]",
                      )}
                    >
                      <span className="text-xs font-bold text-white tabular-nums drop-shadow-sm">{row.count}</span>
                    </motion.div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
