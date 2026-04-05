"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency, cn } from "@/lib/utils";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { buildWeeklyCashPositionBuckets, type WeeklyCashPositionRow } from "@/lib/dashboard-cashflow-buckets";

export function FinanceFlow() {
  const { bounds } = useDashboardDateRange();
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";
  const [data, setData] = useState<WeeklyCashPositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({
    collected: 0,
    partnerToPay: 0,
    billsToPay: 0,
    workforceToPay: 0,
    net: 0,
  });

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

        const [{ data: customerCashRows }, { data: sbOutstanding }, billRes, payrollRes] = await Promise.all([
          supabase
            .from("job_payments")
            .select("amount, payment_date")
            .in("type", ["customer_deposit", "customer_final"])
            .is("deleted_at", null)
            .gte("payment_date", fromDay)
            .lte("payment_date", toDay),
          supabase
            .from("self_bills")
            .select("net_payout, week_start, created_at")
            .in("status", ["awaiting_payment", "ready_to_pay"]),
          supabase
            .from("bills")
            .select("amount, due_date")
            .in("status", ["submitted", "approved", "needs_attention"])
            .is("archived_at", null)
            .gte("due_date", fromDay)
            .lte("due_date", toDay),
          supabase
            .from("payroll_internal_costs")
            .select("amount, due_date")
            .eq("status", "pending")
            .not("due_date", "is", null)
            .gte("due_date", fromDay)
            .lte("due_date", toDay),
        ]);
        const billsOutstanding = (billRes.error ? [] : billRes.data ?? []) as { amount?: number; due_date?: string }[];
        const payrollOutstanding = (payrollRes.error ? [] : payrollRes.data ?? []) as {
          amount?: number;
          due_date?: string;
        }[];

        const buckets = buildWeeklyCashPositionBuckets(
          fromIso,
          toBound,
          (customerCashRows ?? []) as { payment_date?: string; amount?: number }[],
          (sbOutstanding ?? []) as { net_payout?: number; week_start?: string | null; created_at?: string }[],
          billsOutstanding,
          payrollOutstanding,
        );

        setData(buckets);
        setTotals({
          collected: buckets.reduce((s, b) => s + b.collected, 0),
          partnerToPay: buckets.reduce((s, b) => s + b.partnerToPay, 0),
          billsToPay: buckets.reduce((s, b) => s + b.billsToPay, 0),
          workforceToPay: buckets.reduce((s, b) => s + b.workforceToPay, 0),
          net: buckets.reduce((s, b) => s + b.net, 0),
        });
      } catch {
        setData([]);
        setTotals({ collected: 0, partnerToPay: 0, billsToPay: 0, workforceToPay: 0, net: 0 });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey, bounds]);

  return (
    <Card padding="none" className="h-full min-h-0 flex flex-col border-border-light shadow-sm overflow-hidden ring-1 ring-border-light/20">
      <CardHeader className="px-5 pt-5 shrink-0 mb-0 flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border-light/60 bg-gradient-to-r from-surface-hover/30 to-transparent">
        <div className="min-w-0">
          <CardTitle>Cash flow</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? (
              "Loading…"
            ) : (
              <>
                Weekly · Net:{" "}
                <span className={totals.net >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
                  {formatCurrency(totals.net)}
                </span>
                {totals.net >= 0 ? " · positive" : " · negative"}
              </>
            )}
            {bounds && <span className="block mt-0.5">Dashboard date range</span>}
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary px-2 py-1 rounded-lg bg-surface-hover border border-border-light/50">
          By week
        </span>
      </CardHeader>

      {!loading && (
        <div className="px-5 pb-3 grid grid-cols-2 sm:grid-cols-5 gap-2 shrink-0">
          {[
            { label: "Invoices paid", value: totals.collected, color: "text-emerald-600" },
            { label: "Partner to pay", value: totals.partnerToPay, color: "text-rose-500" },
            { label: "Bills to pay", value: totals.billsToPay, color: "text-violet-500" },
            { label: "Workforce to pay", value: totals.workforceToPay, color: "text-orange-500" },
            {
              label: "Net",
              value: totals.net,
              color: totals.net >= 0 ? "text-emerald-600" : "text-rose-600",
            },
          ].map((item) => (
            <div key={item.label} className="p-2.5 rounded-xl bg-surface-hover/60 border border-border-light/50">
              <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">{item.label}</p>
              <p className={cn("text-sm font-bold mt-0.5 tabular-nums", item.color)}>{formatCurrency(item.value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-[220px] min-w-0 px-3 pb-5 flex flex-col">
        {loading ? (
          <div className="flex-1 min-h-[220px] animate-pulse bg-surface-hover rounded-xl" />
        ) : data.length === 0 ? (
          <div className="flex-1 min-h-[220px] flex items-center justify-center text-sm text-text-tertiary">
            No movements in range
          </div>
        ) : (
          <div className="flex-1 min-h-[220px] w-full relative">
            <div className="absolute inset-0 min-h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border-light/80" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    height={48}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `£${(v / 1000).toFixed(0)}k` : `£${v}`)}
                  />
                  <Tooltip
                    formatter={(v, name) => [formatCurrency(Number(v ?? 0)), String(name)]}
                    labelFormatter={(label, payload) => {
                      const first = payload?.[0]?.payload as WeeklyCashPositionRow | undefined;
                      return first?.weekStart ? `${label} · week start ${first.weekStart}` : String(label);
                    }}
                    contentStyle={{
                      borderRadius: 10,
                      fontSize: 12,
                      border: "1px solid var(--color-border-light)",
                      background: "var(--color-card)",
                    }}
                  />
                  <Legend formatter={(v) => v} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="collected" name="Invoices paid" fill="#34d399" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="partnerToPay" name="Partner to pay" fill="#f87171" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="billsToPay" name="Bills to pay" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="workforceToPay" name="Workforce to pay" fill="#fb923c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
