"use client";

import { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { useDashboardDateRangeOptional } from "@/hooks/use-dashboard-date-range";
import { jobBillableRevenue, jobDirectCost } from "@/lib/job-financials";

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
        const bounds = dateCtx?.bounds ?? null;
        const now = new Date();

        let monthStarts: Date[] = [];
        let queryFrom: string;
        let queryTo: string;

        if (bounds) {
          let cur = new Date(new Date(bounds.fromIso).getFullYear(), new Date(bounds.fromIso).getMonth(), 1);
          const end = new Date(bounds.toIso);
          while (cur <= end) {
            monthStarts.push(new Date(cur));
            cur.setMonth(cur.getMonth() + 1);
            if (monthStarts.length > 24) break;
          }
          queryFrom = bounds.fromIso.slice(0, 10);
          queryTo = bounds.toIso.slice(0, 10);
        } else {
          for (let i = 11; i >= 0; i--) {
            monthStarts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
          }
          queryFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10);
          queryTo = now.toISOString().slice(0, 10);
        }

        const { data: jobs } = await supabase
          .from("jobs")
          .select("client_price, extras_amount, partner_cost, materials_cost, margin_percent, completed_date")
          .eq("status", "completed")
          .not("completed_date", "is", null)
          .gte("completed_date", queryFrom)
          .lte("completed_date", queryTo);

        const rows = (jobs ?? []) as {
          client_price?: number;
          extras_amount?: number | null;
          partner_cost?: number;
          materials_cost?: number;
          completed_date?: string;
        }[];

        const months: MonthMargin[] = monthStarts.map((d) => {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label =
            monthStarts.length > 18
              ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
              : MONTH_LABELS[d.getMonth()];
          const monthJobs = rows.filter((j) => j.completed_date?.startsWith(key));
          const revenue = monthJobs.reduce(
            (s, j) =>
              s +
              jobBillableRevenue({
                client_price: Number(j.client_price ?? 0),
                extras_amount: j.extras_amount === null || j.extras_amount === undefined ? undefined : j.extras_amount,
              }),
            0,
          );
          const cost = monthJobs.reduce(
            (s, j) =>
              s +
              jobDirectCost({
                partner_cost: Number(j.partner_cost ?? 0),
                materials_cost: Number(j.materials_cost ?? 0),
              }),
            0,
          );
          const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0;
          return { label, margin, revenue, cost };
        });

        setData(months);
        const withData = months.filter((m) => m.revenue > 0);
        setAvgMargin(
          withData.length ? Math.round((withData.reduce((s, m) => s + m.margin, 0) / withData.length) * 10) / 10 : 0,
        );
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey, dateCtx]);

  const marginColor = avgMargin >= 30 ? "#34d399" : avgMargin >= 20 ? "#fbbf24" : "#f87171";

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Margin (%)</CardTitle>
          <p className="text-xs mt-0.5" style={{ color: marginColor }}>
            {loading
              ? "Loading..."
              : `${dateCtx?.bounds ? "Range" : "12m"} average: ${avgMargin}% · completed jobs`}
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
        <div className="flex items-center gap-2 mt-2">
          <div className="h-[2px] w-5 bg-amber-400 rounded" />
          <span className="text-[10px] text-text-tertiary">Minimum target: 20%</span>
        </div>
      </div>
    </Card>
  );
}
