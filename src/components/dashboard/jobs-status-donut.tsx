"use client";

import { useState, useEffect, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { useDashboardDateRangeOptional } from "@/hooks/use-dashboard-date-range";

/** Donut shows in-flight work only (excludes completed, cancelled, deleted, draft). */
const JOBS_DONUT_ACTIVE_STATUSES = new Set([
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
  "in_progress_phase1",
  "in_progress_phase2",
  "in_progress_phase3",
  "final_check",
  "awaiting_payment",
  "need_attention",
  "on_hold",
  "in_progress",
]);

const STATUS_COLORS: Record<string, string> = {
  unassigned: "#fbbf24",
  auto_assigning: "#fcd34d",
  scheduled: "#60a5fa",
  late: "#fb923c",
  in_progress_phase1: "#f97316",
  in_progress_phase2: "#ea580c",
  in_progress_phase3: "#c2410c",
  final_check: "#a78bfa",
  awaiting_payment: "#fbbf24",
  need_attention: "#f87171",
  completed: "#34d399",
  cancelled: "#94a3b8",
  draft: "#94a3b8",
  in_progress: "#f97316",
  on_hold: "#a78bfa",
};

const STATUS_LABELS: Record<string, string> = {
  unassigned: "Unassigned",
  auto_assigning: "Assigning",
  scheduled: "Scheduled",
  late: "Late",
  in_progress_phase1: "In progress (P1)",
  in_progress_phase2: "In progress (P2)",
  in_progress_phase3: "In progress (P3)",
  final_check: "Final check",
  awaiting_payment: "Awaiting payment",
  need_attention: "Need attention",
  completed: "Completed",
  cancelled: "Cancelled",
  draft: "Draft",
  in_progress: "In progress",
  on_hold: "On hold",
};

export function JobsStatusDonut() {
  const [data, setData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const dateCtx = useDashboardDateRangeOptional();
  const boundsKey = useMemo(() => {
    const b = dateCtx?.bounds ?? null;
    return b ? `${b.fromIso}|${b.toIso}` : "all";
  }, [dateCtx]);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const b = dateCtx?.bounds ?? null;
        let q = supabase.from("jobs").select("status");
        if (b) q = q.gte("created_at", b.fromIso).lte("created_at", b.toIso);
        const { data: jobs } = await q;
        const counts: Record<string, number> = {};
        for (const j of jobs ?? []) {
          const s = (j as { status: string }).status;
          if (!JOBS_DONUT_ACTIVE_STATUSES.has(s)) continue;
          counts[s] = (counts[s] ?? 0) + 1;
        }
        const chartData = Object.entries(counts)
          .map(([status, count]) => ({
            name: STATUS_LABELS[status] ?? status.replace(/_/g, " "),
            value: count,
            color: STATUS_COLORS[status] ?? "#94a3b8",
          }))
          .sort((a, b) => b.value - a.value);
        setData(chartData);
        setTotal(chartData.reduce((s, d) => s + d.value, 0));
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey, dateCtx]);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Jobs by status</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `${total} jobs${dateCtx?.bounds ? " created in range" : ""}`}
          </p>
        </div>
      </CardHeader>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="h-52 flex items-center justify-center">
            <div className="h-32 w-32 rounded-full border-4 border-border animate-pulse" />
          </div>
        ) : data.length === 0 ? (
          <div className="h-52 flex items-center justify-center">
            <p className="text-sm text-text-tertiary">No data</p>
          </div>
        ) : (
          <div className="relative h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [`${Number(v ?? 0)} jobs`, name]}
                  contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e5e7eb" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-text-primary">{total}</span>
              <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wide">Jobs</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-[11px] text-text-secondary truncate">{d.name}</span>
              <span className="text-[11px] font-semibold text-text-primary ml-auto">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
