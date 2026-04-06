"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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

export function PartnersByTradeChart() {
  const [rows, setRows] = useState<{ name: string; count: number; fill: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const first = await supabase.from("partners").select("trade, trades, status").eq("status", "active");
        let partnerRows: Pick<Partner, "trade" | "trades" | "status">[];
        if (first.error) {
          const second = await supabase.from("partners").select("trade, status").eq("status", "active");
          if (second.error) throw second.error;
          partnerRows = (second.data ?? []) as Pick<Partner, "trade" | "trades" | "status">[];
        } else {
          partnerRows = (first.data ?? []) as Pick<Partner, "trade" | "trades" | "status">[];
        }

        const counts: Record<string, number> = {};
        let active = 0;
        for (const p of partnerRows) {
          active += 1;
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
        setTotal(active);
      } catch {
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const chartHeight = Math.min(420, Math.max(200, rows.length * 36));

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Partners by type of work</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading…" : `${total} active partner${total === 1 ? "" : "s"} in directory`}
          </p>
        </div>
      </CardHeader>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="h-52 flex items-center justify-center">
            <div className="h-40 w-full rounded-xl animate-pulse bg-surface-hover" />
          </div>
        ) : rows.length === 0 ? (
          <div className="h-52 flex items-center justify-center">
            <p className="text-sm text-text-tertiary">No active partners</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div style={{ height: chartHeight }} className="min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  layout="vertical"
                  margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                  barCategoryGap={10}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={118}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => (String(v).length > 22 ? `${String(v).slice(0, 20)}…` : String(v))}
                  />
                  <Tooltip
                    formatter={(v) => {
                      const n = Number(v ?? 0);
                      return [`${n} partner${n === 1 ? "" : "s"}`, "Count"];
                    }}
                    labelFormatter={(l) => String(l)}
                    contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid var(--border)" }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {rows.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 border-t border-border-light">
              {rows.slice(0, 8).map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 min-w-0">
                  <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-[11px] text-text-secondary truncate">{d.name}</span>
                  <span className="text-[11px] font-semibold text-text-primary ml-auto tabular-nums">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
