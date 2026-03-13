"use client";

import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";

const STATUS_COLORS: Record<string, string> = {
  draft:            "#94a3b8",
  scheduled:        "#60a5fa",
  in_progress:      "#f97316",
  awaiting_payment: "#fbbf24",
  completed:        "#34d399",
  cancelled:        "#f87171",
  on_hold:          "#a78bfa",
};

const STATUS_LABELS: Record<string, string> = {
  draft:            "Draft",
  scheduled:        "Scheduled",
  in_progress:      "In Progress",
  awaiting_payment: "Awaiting Payment",
  completed:        "Completed",
  cancelled:        "Cancelled",
  on_hold:          "On Hold",
};

export function JobsStatusDonut() {
  const [data, setData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const { data: jobs } = await supabase.from("jobs").select("status");
        const counts: Record<string, number> = {};
        for (const j of (jobs ?? [])) {
          counts[j.status] = (counts[j.status] ?? 0) + 1;
        }
        const chartData = Object.entries(counts)
          .map(([status, count]) => ({
            name: STATUS_LABELS[status] ?? status,
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
    load();
  }, []);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Jobs por Status</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `${total} jobs in total`}
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
            {/* centre label */}
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
