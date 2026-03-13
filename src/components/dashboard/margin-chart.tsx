"use client";

import { useState, useEffect } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthMargin {
  label: string;
  margin: number;
  revenue: number;
  cost: number;
}

export function MarginChart() {
  const [data, setData] = useState<MonthMargin[]>([]);
  const [loading, setLoading] = useState(true);
  const [avgMargin, setAvgMargin] = useState(0);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
        const { data: jobs } = await supabase
          .from("jobs")
          .select("revenue, cost, margin_percent, completed_date")
          .eq("status", "completed")
          .not("completed_date", "is", null)
          .gte("completed_date", startDate);

        const months: MonthMargin[] = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = MONTH_LABELS[d.getMonth()];
          const monthJobs = (jobs ?? []).filter((j: { completed_date?: string }) => j.completed_date?.startsWith(key));
          const revenue = monthJobs.reduce((s: number, j: { revenue?: number }) => s + Number(j.revenue ?? 0), 0);
          const cost = monthJobs.reduce((s: number, j: { cost?: number }) => s + Number(j.cost ?? 0), 0);
          const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0;
          months.push({ label, margin, revenue, cost });
        }

        setData(months);
        const withData = months.filter((m) => m.revenue > 0);
        setAvgMargin(withData.length ? Math.round(withData.reduce((s, m) => s + m.margin, 0) / withData.length * 10) / 10 : 0);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const marginColor = avgMargin >= 30 ? "#34d399" : avgMargin >= 20 ? "#fbbf24" : "#f87171";

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Margin (%)</CardTitle>
          <p className="text-xs mt-0.5" style={{ color: marginColor }}>
            {loading ? "Loading..." : `12m average: ${avgMargin}%`}
          </p>
        </div>
      </CardHeader>
      <div className="px-3 pb-5">
        {loading ? (
          <div className="h-44 animate-pulse bg-surface-hover rounded-xl" />
        ) : (
          <ResponsiveContainer width="100%" height={176}>
            <AreaChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="marginGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={marginColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={marginColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip
                formatter={(v) => [`${Number(v ?? 0)}%`, "Margin"]}
                contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e5e7eb" }}
              />
              <Area
                type="monotone"
                dataKey="margin"
                stroke={marginColor}
                strokeWidth={2}
                fill="url(#marginGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {/* Target line note */}
        <div className="flex items-center gap-2 mt-2">
          <div className="h-[2px] w-5 bg-amber-400 rounded" />
          <span className="text-[10px] text-text-tertiary">Minimum target: 20%</span>
        </div>
      </div>
    </Card>
  );
}
