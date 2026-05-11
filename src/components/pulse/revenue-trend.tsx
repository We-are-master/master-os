"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, ResponsiveContainer, Tooltip, XAxis, Line, ComposedChart } from "recharts";
import { startOfWeek, endOfWeek, subWeeks, format, formatISO } from "date-fns";
import { getSupabase } from "@/services/base";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";

type WeekPoint = {
  weekStart: Date;
  label: string;
  billed: number;
  cost: number;
};

const WEEKS = 8;

export function RevenueTrend() {
  const [points, setPoints] = useState<WeekPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const buckets: WeekPoint[] = [];
      for (let i = WEEKS - 1; i >= 0; i--) {
        const ws = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
        buckets.push({ weekStart: ws, label: `W${format(ws, "II")}`, billed: 0, cost: 0 });
      }
      const earliest = buckets[0].weekStart;
      const latest = endOfWeek(buckets[buckets.length - 1].weekStart, { weekStartsOn: 1 });
      // Active operational pipeline only — excludes On Hold, Cancelled, Lost (=cancelled), Deleted.
      const ACTIVE_OPS_STATUSES = [
        "unassigned",
        "auto_assigning",
        "scheduled",
        "late",
        "in_progress",
        "final_check",
        "need_attention",
        "awaiting_payment",
        "completed",
      ];
      const { data } = await supabase
        .from("jobs")
        .select("scheduled_start_at, client_price, extras_amount, partner_cost")
        .gte("scheduled_start_at", formatISO(earliest))
        .lte("scheduled_start_at", formatISO(latest))
        .in("status", ACTIVE_OPS_STATUSES)
        .is("deleted_at", null);
      if (cancelled) return;
      type Row = {
        scheduled_start_at: string | null;
        client_price: number | null;
        extras_amount: number | null;
        partner_cost: number | null;
      };
      for (const r of (data ?? []) as Row[]) {
        if (!r.scheduled_start_at) continue;
        const d = new Date(r.scheduled_start_at);
        const ws = startOfWeek(d, { weekStartsOn: 1 });
        const slot = buckets.find((b) => b.weekStart.getTime() === ws.getTime());
        if (!slot) continue;
        slot.billed += (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0);
        slot.cost += Number(r.partner_cost) || 0;
      }
      setPoints(buckets);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    if (!points) return { billed: 0, cost: 0, marginPct: 0 };
    const billed = points.reduce((a, p) => a + p.billed, 0);
    const cost = points.reduce((a, p) => a + p.cost, 0);
    const marginPct = billed > 0 ? ((billed - cost) / billed) * 100 : 0;
    return { billed, cost, marginPct };
  }, [points]);

  return (
    <SectionCard
      title="Revenue · 8 Weeks"
      subtitle="Billed vs partner cost"
      actions={
        <div className="flex items-center gap-5">
          <Stat label="Billed" value={formatGbp(totals.billed)} />
          <Stat label="Cost" value={formatGbp(totals.cost)} />
          <Stat label="Margin" value={`${totals.marginPct.toFixed(1)}%`} accent />
        </div>
      }
    >
      <div className="h-56">
        {!points ? (
          <div className="h-full bg-fx-paper-2/40 rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pulse-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ED4B00" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#ED4B00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "#6B6B85", fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid var(--color-fx-line)",
                  boxShadow: "var(--shadow-fx-2)",
                }}
                formatter={(v) => formatGbp(Number(v) || 0)}
              />
              <Area type="monotone" dataKey="billed" stroke="#ED4B00" strokeWidth={2} fill="url(#pulse-revenue-fill)" />
              <Line
                type="monotone"
                dataKey="cost"
                stroke="#020040"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.55}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </SectionCard>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className={accent ? "text-fx-coral-p font-semibold text-[16px] tabular-nums" : "text-text-primary font-semibold text-[16px] tabular-nums"}>
        {value}
      </div>
    </div>
  );
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
