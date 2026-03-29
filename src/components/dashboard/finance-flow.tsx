"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency } from "@/lib/utils";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";

interface Bucket {
  label: string;
  collected: number;
  payouts: number;
  bills: number;
  net: number;
}

export function FinanceFlow() {
  const { bounds } = useDashboardDateRange();
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";
  const [data, setData] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ collected: 0, payouts: 0, bills: 0, net: 0 });

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const clock = new Date();
        const toIso = clock.toISOString();
        const fromIso = bounds?.fromIso ?? new Date(clock.getFullYear(), clock.getMonth() - 5, 1).toISOString();
        const toBound = bounds?.toIso ?? toIso;
        const fromDay = fromIso.slice(0, 10);
        const toDay = toBound.slice(0, 10);
        const spanDays = Math.max(
          1,
          Math.ceil((new Date(toBound).getTime() - new Date(fromIso).getTime()) / 86400000),
        );

        const [{ data: invPaid }, { data: sbPaid }, billRes] = await Promise.all([
          supabase
            .from("invoices")
            .select("amount, paid_date")
            .eq("status", "paid")
            .gte("paid_date", fromDay)
            .lte("paid_date", toDay),
          supabase
            .from("self_bills")
            .select("net_payout, updated_at")
            .eq("status", "paid")
            .gte("updated_at", fromIso)
            .lte("updated_at", toBound),
          supabase
            .from("bills")
            .select("amount, paid_at")
            .eq("status", "paid")
            .gte("paid_at", fromIso)
            .lte("paid_at", toBound),
        ]);
        const billsPaid = billRes.error ? [] : ((billRes.data ?? []) as { amount: number; paid_at?: string }[]);

        const buckets: Bucket[] = [];
        if (spanDays <= 45) {
          const dayKeys: string[] = [];
          const walk = new Date(fromDay + "T12:00:00");
          const endWalk = new Date(toDay + "T12:00:00");
          while (walk <= endWalk) {
            dayKeys.push(walk.toISOString().slice(0, 10));
            walk.setDate(walk.getDate() + 1);
            if (dayKeys.length > 62) break;
          }
          const keyToIdx = new Map(dayKeys.map((k, i) => [k, i]));
          for (const k of dayKeys) {
            buckets.push({
              label: new Date(k + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              collected: 0,
              payouts: 0,
              bills: 0,
              net: 0,
            });
          }
          for (const inv of invPaid ?? []) {
            const d = (inv as { paid_date?: string }).paid_date?.slice(0, 10);
            const i = d ? keyToIdx.get(d) : undefined;
            if (i !== undefined) buckets[i]!.collected += Number((inv as { amount?: number }).amount ?? 0);
          }
          for (const sb of sbPaid ?? []) {
            const d = (sb as { updated_at?: string }).updated_at?.slice(0, 10);
            const i = d ? keyToIdx.get(d) : undefined;
            if (i !== undefined) buckets[i]!.payouts += Number((sb as { net_payout?: number }).net_payout ?? 0);
          }
          for (const b of billsPaid) {
            const d = b.paid_at?.slice(0, 10);
            const i = d ? keyToIdx.get(d) : undefined;
            if (i !== undefined) buckets[i]!.bills += Number(b.amount ?? 0);
          }
        } else {
          const monthKeys: string[] = [];
          let curM = new Date(new Date(fromIso).getFullYear(), new Date(fromIso).getMonth(), 1);
          const endM = new Date(toBound);
          while (curM <= endM) {
            monthKeys.push(`${curM.getFullYear()}-${String(curM.getMonth() + 1).padStart(2, "0")}`);
            buckets.push({
              label: curM.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
              collected: 0,
              payouts: 0,
              bills: 0,
              net: 0,
            });
            curM.setMonth(curM.getMonth() + 1);
            if (monthKeys.length > 24) break;
          }
          const keyToIdxM = new Map(monthKeys.map((k, i) => [k, i]));
          for (const inv of invPaid ?? []) {
            const pd = (inv as { paid_date?: string }).paid_date;
            const mk = pd?.slice(0, 7);
            const i = mk ? keyToIdxM.get(mk) : undefined;
            if (i !== undefined) buckets[i]!.collected += Number((inv as { amount?: number }).amount ?? 0);
          }
          for (const sb of sbPaid ?? []) {
            const u = (sb as { updated_at?: string }).updated_at;
            if (!u) continue;
            const i = keyToIdxM.get(u.slice(0, 7));
            if (i !== undefined) buckets[i]!.payouts += Number((sb as { net_payout?: number }).net_payout ?? 0);
          }
          for (const bill of billsPaid) {
            const u = bill.paid_at;
            if (!u) continue;
            const i = keyToIdxM.get(u.slice(0, 7));
            if (i !== undefined) buckets[i]!.bills += Number(bill.amount ?? 0);
          }
        }

        for (const b of buckets) {
          b.net = b.collected - b.payouts - b.bills;
        }
        setData(buckets);
        setTotals({
          collected: buckets.reduce((s, b) => s + b.collected, 0),
          payouts: buckets.reduce((s, b) => s + b.payouts, 0),
          bills: buckets.reduce((s, b) => s + b.bills, 0),
          net: buckets.reduce((s, b) => s + b.net, 0),
        });
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey, bounds]);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Cash Flow</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `Net: ${formatCurrency(totals.net)}`}
            {bounds && <span className="block mt-0.5">Filtered by dashboard date range</span>}
          </p>
        </div>
      </CardHeader>

      {!loading && (
        <div className="px-5 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Collected", value: totals.collected, color: "text-emerald-600" },
            { label: "Partner payouts", value: totals.payouts, color: "text-red-500" },
            { label: "Bills paid", value: totals.bills, color: "text-purple-600" },
            { label: "Net", value: totals.net, color: totals.net >= 0 ? "text-emerald-600" : "text-red-500" },
          ].map((item) => (
            <div key={item.label} className="p-2.5 rounded-xl bg-surface-hover/60">
              <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">{item.label}</p>
              <p className={`text-sm font-bold mt-0.5 ${item.color}`}>{formatCurrency(item.value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="px-3 pb-5">
        {loading ? (
          <div className="h-40 animate-pulse bg-surface-hover rounded-xl" />
        ) : data.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-text-tertiary">No movements in range</div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v, name) => [formatCurrency(Number(v ?? 0)), String(name)]}
                contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e5e7eb" }}
              />
              <Legend formatter={(v) => v} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="collected" name="Collected" fill="#34d399" radius={[4, 4, 0, 0]} />
              <Bar dataKey="payouts" name="Partner payouts" fill="#f87171" radius={[4, 4, 0, 0]} />
              <Bar dataKey="bills" name="Bills" fill="#a78bfa" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
