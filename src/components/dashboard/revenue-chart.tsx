"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";

interface MonthData {
  month: string;
  label: string;
  revenue: number;
  invoiced: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function RevenueChart() {
  const { bounds } = useDashboardDateRange();
  const [period, setPeriod] = useState("12m");
  const [allData, setAllData] = useState<MonthData[]>([]);
  const [loading, setLoading] = useState(true);

  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        let rangeStartIso: string;
        let rangeEndIso: string;
        let monthCursor: Date;
        let endCap: Date;

        if (bounds) {
          rangeStartIso = bounds.fromIso;
          rangeEndIso = bounds.toIso;
          const fromD = new Date(bounds.fromIso);
          const toD = new Date(bounds.toIso);
          monthCursor = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
          endCap = new Date(toD.getFullYear(), toD.getMonth(), 1);
        } else {
          const now = new Date();
          rangeStartIso = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();
          rangeEndIso = now.toISOString();
          monthCursor = new Date(now.getFullYear() - 11, now.getMonth(), 1);
          endCap = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const [paidRes, allInvRes] = await Promise.all([
          supabase
            .from("invoices")
            .select("amount, paid_date")
            .eq("status", "paid")
            .gte("paid_date", rangeStartIso)
            .lte("paid_date", rangeEndIso),
          supabase
            .from("invoices")
            .select("amount, created_at, status")
            .gte("created_at", rangeStartIso)
            .lte("created_at", rangeEndIso),
        ]);

        const paidInvoices = (paidRes.data ?? []) as { amount: number; paid_date: string }[];
        const allInvoices = (allInvRes.data ?? []) as { amount: number; created_at: string; status: string }[];

        const months: MonthData[] = [];
        const cur = new Date(monthCursor);
        while (cur <= endCap) {
          const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
          const label = MONTH_LABELS[cur.getMonth()];
          const revenue = paidInvoices
            .filter((inv) => inv.paid_date && inv.paid_date.startsWith(key))
            .reduce((s, inv) => s + Number(inv.amount), 0);
          const invoiced = allInvoices
            .filter((inv) => inv.created_at.startsWith(key))
            .reduce((s, inv) => s + Number(inv.amount), 0);
          months.push({ month: key, label, revenue, invoiced });
          cur.setMonth(cur.getMonth() + 1);
        }

        setAllData(months);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey]);

  const visibleData = useMemo(() => {
    if (bounds) return allData;
    const count = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    return allData.slice(-count);
  }, [allData, period, bounds]);

  const maxValue = Math.max(...visibleData.map((d) => Math.max(d.revenue, d.invoiced)), 1);
  const totalRevenue = visibleData.reduce((s, d) => s + d.revenue, 0);
  const totalInvoiced = visibleData.reduce((s, d) => s + d.invoiced, 0);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Revenue Overview</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `${formatCurrency(totalRevenue)} collected — ${formatCurrency(totalInvoiced)} invoiced`}
            {bounds && <span className="block mt-0.5">Filtered by dashboard date range</span>}
          </p>
        </div>
        {!bounds && (
          <Tabs
            variant="pills"
            tabs={[
              { id: "3m", label: "3M" },
              { id: "6m", label: "6M" },
              { id: "12m", label: "12M" },
            ]}
            activeTab={period}
            onChange={setPeriod}
          />
        )}
      </CardHeader>

      <div className="px-5 pb-5">
        {loading ? (
          <div className="flex items-end gap-1 h-48">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="relative w-full flex items-end justify-center gap-[2px] h-40">
                  <div className="w-[40%] animate-pulse bg-surface-tertiary rounded-t-sm" style={{ height: `${30 + Math.random() * 50}%` }} />
                  <div className="w-[40%] animate-pulse bg-surface-hover rounded-t-sm" style={{ height: `${20 + Math.random() * 40}%` }} />
                </div>
                <div className="h-3 w-6 animate-pulse bg-surface-tertiary rounded" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {visibleData.every((d) => d.revenue === 0 && d.invoiced === 0) ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-text-tertiary">No revenue data for this period</p>
              </div>
            ) : (
              <div className="flex items-end gap-1 h-48">
                {visibleData.map((item, index) => (
                  <div key={item.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="relative w-full flex items-end justify-center gap-[2px] h-40">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${(item.invoiced / maxValue) * 100}%` }}
                        transition={{
                          duration: 0.6,
                          delay: index * 0.04 + 0.2,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                        className="w-[40%] bg-surface-tertiary rounded-t-sm group relative"
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-stone-700 text-white text-[10px] font-medium px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                          {formatCurrency(item.invoiced)}
                        </div>
                      </motion.div>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${(item.revenue / maxValue) * 100}%` }}
                        transition={{
                          duration: 0.6,
                          delay: index * 0.04 + 0.3,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                        className="w-[40%] bg-primary rounded-t-sm group relative"
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-[10px] font-medium px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                          {formatCurrency(item.revenue)}
                        </div>
                      </motion.div>
                    </div>
                    <span className="text-[10px] text-text-tertiary font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-border-light">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-sm bg-primary" />
            <span className="text-xs text-text-secondary">Collected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-sm bg-border" />
            <span className="text-xs text-text-secondary">Invoiced</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
