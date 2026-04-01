"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
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

type CashflowGranularity = "week" | "month";

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Week starts Monday (local). */
function startOfWeekMondayFromYmd(ymd: string): string {
  const d = parseYmd(ymd);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYmd(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

function weekRangeLabel(weekStartYmd: string): string {
  const s = parseYmd(weekStartYmd);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString(undefined, o)}–${e.toLocaleDateString(undefined, o)}`;
}

function buildCashflowBuckets(
  granularity: CashflowGranularity,
  fromIso: string,
  toIso: string,
  invPaid: { paid_date?: string; amount?: number }[] | null,
  sbPaid: { updated_at?: string; net_payout?: number }[] | null,
  billsPaid: { amount: number; paid_at?: string }[],
): Bucket[] {
  const fromDay = fromIso.slice(0, 10);
  const toDay = toIso.slice(0, 10);
  const endD = parseYmd(toDay);

  if (granularity === "month") {
    const monthKeys: string[] = [];
    const buckets: Bucket[] = [];
    const curM = new Date(new Date(fromIso).getFullYear(), new Date(fromIso).getMonth(), 1);
    const endM = new Date(toIso);
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
      if (monthKeys.length > 36) break;
    }
    const keyToIdxM = new Map(monthKeys.map((k, i) => [k, i]));
    for (const inv of invPaid ?? []) {
      const pd = inv.paid_date;
      const mk = pd?.slice(0, 7);
      const i = mk ? keyToIdxM.get(mk) : undefined;
      if (i !== undefined) buckets[i]!.collected += Number(inv.amount ?? 0);
    }
    for (const sb of sbPaid ?? []) {
      const u = sb.updated_at;
      if (!u) continue;
      const i = keyToIdxM.get(u.slice(0, 7));
      if (i !== undefined) buckets[i]!.payouts += Number(sb.net_payout ?? 0);
    }
    for (const bill of billsPaid) {
      const u = bill.paid_at;
      if (!u) continue;
      const i = keyToIdxM.get(u.slice(0, 7));
      if (i !== undefined) buckets[i]!.bills += Number(bill.amount ?? 0);
    }
    for (const b of buckets) {
      b.net = b.collected - b.payouts - b.bills;
    }
    return buckets;
  }

  const weekStarts: string[] = [];
  let w = startOfWeekMondayFromYmd(fromDay);
  while (parseYmd(w) <= endD && weekStarts.length < 120) {
    weekStarts.push(w);
    w = addDaysYmd(w, 7);
  }
  const keyToIdxW = new Map(weekStarts.map((k, i) => [k, i]));
  const buckets: Bucket[] = weekStarts.map((k) => ({
    label: weekRangeLabel(k),
    collected: 0,
    payouts: 0,
    bills: 0,
    net: 0,
  }));

  for (const inv of invPaid ?? []) {
    const d = inv.paid_date?.slice(0, 10);
    if (!d) continue;
    const ws = startOfWeekMondayFromYmd(d);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.collected += Number(inv.amount ?? 0);
  }
  for (const sb of sbPaid ?? []) {
    const u = sb.updated_at;
    if (!u) continue;
    const d = u.slice(0, 10);
    const ws = startOfWeekMondayFromYmd(d);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.payouts += Number(sb.net_payout ?? 0);
  }
  for (const bill of billsPaid) {
    const u = bill.paid_at;
    if (!u) continue;
    const d = u.slice(0, 10);
    const ws = startOfWeekMondayFromYmd(d);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.bills += Number(bill.amount ?? 0);
  }
  for (const b of buckets) {
    b.net = b.collected - b.payouts - b.bills;
  }
  return buckets;
}

export function FinanceFlow() {
  const { bounds } = useDashboardDateRange();
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";
  const [granularity, setGranularity] = useState<CashflowGranularity>("month");
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

        const buckets = buildCashflowBuckets(
          granularity,
          fromIso,
          toBound,
          (invPaid ?? []) as { paid_date?: string; amount?: number }[],
          (sbPaid ?? []) as { updated_at?: string; net_payout?: number }[],
          billsPaid,
        );

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
  }, [boundsKey, bounds, granularity]);

  return (
    <Card padding="none" className="h-full min-h-0 flex flex-col">
      <CardHeader className="px-5 pt-5 shrink-0 mb-0 flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Cash Flow</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `Net: ${formatCurrency(totals.net)}`}
            {bounds && <span className="block mt-0.5">Filtered by dashboard date range</span>}
          </p>
        </div>
        <Tabs
          variant="pills"
          className="shrink-0"
          tabs={[
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
          ]}
          activeTab={granularity}
          onChange={(id) => setGranularity(id as CashflowGranularity)}
        />
      </CardHeader>

      {!loading && (
        <div className="px-5 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
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

      <div className="flex-1 min-h-[200px] min-w-0 px-3 pb-5 flex flex-col">
        {loading ? (
          <div className="flex-1 min-h-[200px] animate-pulse bg-surface-hover rounded-xl" />
        ) : data.length === 0 ? (
          <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-text-tertiary">
            No movements in range
          </div>
        ) : (
          <div className="flex-1 min-h-[200px] w-full relative">
            <div className="absolute inset-0 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    interval={granularity === "week" ? "preserveStartEnd" : 0}
                  />
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
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
