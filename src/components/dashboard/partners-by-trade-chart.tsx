"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { mergeTypeOfWorkOptions, normalizeTypeOfWork } from "@/lib/type-of-work";
import type { Partner } from "@/types/database";

const SLICE_COLORS = [
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#60a5fa", // sky
  "#34d399", // emerald
  "#f97316", // orange
  "#fb7185", // rose
  "#818cf8", // indigo
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
  "#38bdf8", // blue-sky
  "#c084fc", // purple
  "#4ade80", // green
  "#fcd34d", // yellow
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

type TradeRow = { name: string; count: number; fill: string };
type PartnerSimpleRow = { name: string; initials: string; postcodeOutward: string; status: "active" | "inactive" };
type AreaRow = { name: string; size: number; fill: string };

function initialsFromName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? "")
    .join("");
}

function extractOutwardPostcode(raw: string): string {
  const text = raw.trim().toUpperCase();
  if (!text) return "N/A";
  const full = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/);
  if (full?.[1]) return full[1];
  const outward = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/);
  return outward?.[1] ?? "N/A";
}

/**
 * Donut chart scales better than horizontal bars on narrow viewports:
 * bars forced a vertical list that ballooned on mobile (the previous design).
 * The donut stays a constant square with a 2-column legend that wraps.
 */
export function PartnersByTradeChart({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [partnerRows, setPartnerRows] = useState<PartnerSimpleRow[]>([]);
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [inactiveTotal, setInactiveTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("partners")
          .select("contact_name, company_name, trade, trades, status, partner_address, location");
        if (error) throw error;
        const allPartners = (data ?? []) as Array<
          Pick<Partner, "trade" | "trades" | "status" | "partner_address" | "location" | "contact_name" | "company_name">
        >;
        const activePartners = allPartners.filter((p) => p.status === "active");
        const inactivePartners = allPartners.filter((p) => p.status !== "active");
        setActiveTotal(activePartners.length);
        setInactiveTotal(inactivePartners.length);

        const counts: Record<string, number> = {};
        for (const p of activePartners) {
          for (const label of tradeLabelsForPartner(p)) {
            counts[label] = (counts[label] ?? 0) + 1;
          }
        }

        const chartData: TradeRow[] = Object.entries(counts)
          .map(([name, count]) => ({ name, count, fill: "" }))
          .sort((a, b) => b.count - a.count)
          .map((r, i) => ({ ...r, fill: SLICE_COLORS[i % SLICE_COLORS.length] }));

        setRows(chartData);

        const simpleRows = allPartners
          .map((p) => {
            const rawName = (p.contact_name || p.company_name || "Partner").trim();
            const postcodeOutward = extractOutwardPostcode(`${p.partner_address ?? ""} ${p.location ?? ""}`);
            return {
              name: rawName,
              initials: initialsFromName(rawName) || "P",
              postcodeOutward,
              status: p.status === "active" ? "active" : "inactive",
            } as PartnerSimpleRow;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setPartnerRows(simpleRows);

        const areaMap: Record<string, number> = {};
        for (const p of simpleRows) {
          const key = p.postcodeOutward || "N/A";
          areaMap[key] = (areaMap[key] ?? 0) + 1;
        }
        const areas = Object.entries(areaMap)
          .map(([name, size], i) => ({ name, size, fill: SLICE_COLORS[i % SLICE_COLORS.length] }))
          .sort((a, b) => b.size - a.size);
        setAreaRows(compact ? areas.slice(0, 8) : areas);
      } catch {
        setRows([]);
        setPartnerRows([]);
        setAreaRows([]);
        setActiveTotal(0);
        setInactiveTotal(0);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const displayRows = compact ? rows.slice(0, 12) : rows;
  const totalCount = useMemo(() => displayRows.reduce((s, r) => s + r.count, 0), [displayRows]);
  const topTradeRows = useMemo(() => rows.slice(0, compact ? 6 : 8), [rows, compact]);
  const visiblePartners = compact ? partnerRows.slice(0, 8) : partnerRows;
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
                  <p className="text-[10px] text-text-tertiary mt-0.5">In system today · trade breakdown below</p>
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
                  <p className="text-[10px] text-text-tertiary mt-0.5">In system today · onboarding, paused, needs attention…</p>
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
              {topTradeRows.length > 0 && (
                <div className="rounded-xl border border-border-light/70 bg-card p-2.5">
                  <div className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px] text-text-tertiary mb-2">
                    <span>Today in system</span>
                    <span className="font-semibold tabular-nums text-text-secondary">{totalDir} partners</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {topTradeRows.map((row) => (
                      <div
                        key={row.name}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border-light bg-surface-hover/60 px-2 py-1"
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: row.fill }} />
                        <span className="text-[10px] text-text-secondary">{row.name}</span>
                        <span className="text-[10px] font-semibold tabular-nums text-text-primary">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[240px]">
            <div className="h-40 w-40 rounded-full animate-pulse bg-surface-hover" />
          </div>
        ) : rows.length === 0 ? (
          <div className={cn("flex items-center justify-center", compact ? "min-h-[8rem]" : "min-h-[12rem]")}>
            <p className="text-sm text-text-tertiary">No active partners</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 flex flex-col gap-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wide">
              By type of work · active partners only
            </p>
            {/* Responsive split: donut on top (mobile) / left (md+); legend right/below */}
            <div
              className={cn(
                "min-h-0 flex-1 gap-4",
                compact ? "flex flex-col md:flex-row items-center md:items-stretch" : "flex flex-col xl:flex-row items-stretch",
              )}
            >
              <div
                className={cn(
                  "relative aspect-square shrink-0",
                  compact
                    ? "w-full max-w-[220px] md:w-[220px] md:max-w-none mx-auto md:mx-0"
                    : "w-full max-w-[260px] sm:max-w-[300px] xl:w-[300px] xl:max-w-none mx-auto xl:mx-0",
                )}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0].payload as TradeRow;
                        const pct = totalCount > 0 ? Math.round((row.count / totalCount) * 1000) / 10 : 0;
                        return (
                          <div className="rounded-md border border-border bg-card px-2 py-1.5 shadow-lg">
                            <p className="text-[11px] font-semibold text-text-primary">{row.name}</p>
                            <p className="text-[10px] text-text-tertiary">
                              <span className="font-semibold text-text-secondary tabular-nums">{row.count}</span>
                              {" · "}
                              <span className="tabular-nums">{pct}%</span>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Pie
                      data={displayRows}
                      dataKey="count"
                      nameKey="name"
                      innerRadius="60%"
                      outerRadius="95%"
                      paddingAngle={1.5}
                      stroke="var(--card)"
                      strokeWidth={2}
                      isAnimationActive
                    >
                      {displayRows.map((row) => (
                        <Cell key={row.name} fill={row.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                {/* Centered total */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-xl font-bold tabular-nums text-text-primary">{totalCount}</p>
                  <p className="text-[9px] text-text-tertiary uppercase tracking-wide">active · {displayRows.length} trades</p>
                </div>
              </div>
              {/* Legend — scrollable column on md+, wrapped 2-col chips on mobile */}
              <div className={cn("flex-1 min-w-0", compact && "md:min-h-0 md:overflow-y-auto")}>
                <div
                  className={cn(
                    "gap-1.5",
                    compact ? "grid grid-cols-2 md:grid-cols-1" : "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-2",
                  )}
                >
                  {displayRows.map((row) => {
                    const pct = totalCount > 0 ? Math.round((row.count / totalCount) * 1000) / 10 : 0;
                    return (
                      <div
                        key={row.name}
                        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-hover transition-colors"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: row.fill }}
                          aria-hidden
                        />
                        <p className="text-[11px] font-medium text-text-secondary truncate flex-1" title={row.name}>
                          {row.name}
                        </p>
                        <p className="text-[11px] font-bold tabular-nums text-text-primary shrink-0">{row.count}</p>
                        <p className="text-[10px] text-text-tertiary tabular-nums shrink-0 w-10 text-right">{pct}%</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
              <div className="rounded-xl border border-border-light/70 bg-card p-2.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-tertiary">Partners now</p>
                  <p className="text-[10px] font-semibold text-text-secondary tabular-nums">{totalDir} total</p>
                </div>
                <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
                  {visiblePartners.map((p) => (
                    <div key={`${p.name}-${p.postcodeOutward}`} className="flex items-center gap-2 rounded-md bg-surface-hover/50 px-2 py-1.5">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#020040] text-[10px] font-semibold text-white">
                        {p.initials}
                      </span>
                      <span className="text-[11px] text-text-secondary truncate flex-1">{p.name}</span>
                      <span className="text-[10px] font-semibold text-text-primary tabular-nums">{p.postcodeOutward}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border-light/70 bg-card p-2.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-tertiary">Partners by area</p>
                  <p className="text-[10px] text-text-tertiary">Based on home postcode</p>
                </div>
                {areaRows.length === 0 ? (
                  <div className="h-[190px] flex items-center justify-center text-[11px] text-text-tertiary">No postcode data</div>
                ) : (
                  <div className="h-[190px] space-y-2">
                    <ResponsiveContainer width="100%" height="78%">
                      <Treemap data={areaRows} dataKey="size" stroke="rgba(255,255,255,0.8)" fill="#60a5fa">
                        <Tooltip formatter={(v, _n, p) => [`${Number(v ?? 0)} partners`, String((p?.payload as AreaRow)?.name ?? "")]} />
                      </Treemap>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-1.5">
                      {areaRows.slice(0, compact ? 5 : 8).map((a) => (
                        <span key={a.name} className="inline-flex items-center gap-1 rounded-md border border-border-light px-2 py-0.5 text-[10px]">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.fill }} />
                          <span className="text-text-secondary">{a.name}</span>
                          <span className="font-semibold text-text-primary tabular-nums">{a.size}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
