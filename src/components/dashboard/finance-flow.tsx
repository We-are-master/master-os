"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency } from "@/lib/utils";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthFlow {
  label: string;
  collected: number;
  payouts: number;
  net: number;
}

export function FinanceFlow() {
  const [data, setData] = useState<MonthFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ collected: 0, payouts: 0, net: 0 });

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

        const [invRes, sbRes] = await Promise.all([
          supabase.from("invoices").select("amount, paid_date").eq("status", "paid").gte("paid_date", startDate),
          supabase.from("self_bills").select("net_payout, updated_at").eq("status", "paid").gte("updated_at", startDate),
        ]);

        const paidInvoices = (invRes.data ?? []) as { amount: number; paid_date: string }[];
        const paidSelfBills = (sbRes.data ?? []) as { net_payout: number; updated_at: string }[];

        const months: MonthFlow[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = MONTH_LABELS[d.getMonth()];
          const collected = paidInvoices.filter((inv) => inv.paid_date?.startsWith(key)).reduce((s, inv) => s + Number(inv.amount), 0);
          const payouts = paidSelfBills.filter((sb) => sb.updated_at?.startsWith(key)).reduce((s, sb) => s + Number(sb.net_payout), 0);
          months.push({ label, collected, payouts, net: collected - payouts });
        }

        setData(months);
        setTotals({
          collected: months.reduce((s, m) => s + m.collected, 0),
          payouts: months.reduce((s, m) => s + m.payouts, 0),
          net: months.reduce((s, m) => s + m.net, 0),
        });
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
          <CardTitle>Cash Flow</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `Net 6m: ${formatCurrency(totals.net)}`}
          </p>
        </div>
      </CardHeader>

      {/* Summary KPIs */}
      {!loading && (
        <div className="px-5 pb-3 grid grid-cols-3 gap-2">
          {[
            { label: "Collected", value: totals.collected, color: "text-emerald-600" },
            { label: "Partner Payouts", value: totals.payouts, color: "text-red-500" },
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
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v, name) => [formatCurrency(Number(v ?? 0)), name === "collected" ? "Collected" : name === "payouts" ? "Partner Payouts" : "Net"]}
                contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e5e7eb" }}
              />
              <Legend formatter={(v) => v === "collected" ? "Collected" : v === "payouts" ? "Partner Payouts" : "Net"} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="collected" fill="#34d399" radius={[4, 4, 0, 0]} />
              <Bar dataKey="payouts" fill="#f87171" radius={[4, 4, 0, 0]} />
              <Bar dataKey="net" fill="#60a5fa" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
