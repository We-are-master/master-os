"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency } from "@/lib/utils";
import { useDashboardDateRangeOptional } from "@/hooks/use-dashboard-date-range";
import type { DashboardDateBounds } from "@/lib/dashboard-date-range";

function inDateRange(iso: string | null | undefined, bounds: DashboardDateBounds): boolean {
  if (!iso) return false;
  return iso >= bounds.fromIso && iso <= bounds.toIso;
}

export function FinancialSnapshot() {
  const dateCtx = useDashboardDateRangeOptional();
  const bounds = dateCtx?.bounds ?? null;
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";

  const [data, setData] = useState({
    receivable: 0, payable: 0, overdue: 0, overdueCount: 0,
    paidTotal: 0, pendingTotal: 0, pendingCount: 0,
    partnerPayouts: 0, partnerPayoutsCount: 0,
  });

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        // 13-month floor when no user range is set — bounds the unbounded
        // full-table scan that previously dominated dashboard load time.
        const defaultFloorIso = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
        const fromIso = bounds?.fromIso ?? defaultFloorIso;
        const toIso   = bounds?.toIso   ?? new Date().toISOString();

        const [invRes, sbRes] = await Promise.all([
          supabase
            .from("invoices")
            .select("amount, status, paid_date, created_at")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .limit(5000),
          supabase
            .from("self_bills")
            .select("net_payout, status, created_at")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .limit(5000),
        ]);
        const invoices = (invRes.data ?? []) as {
          amount: number;
          status: string;
          paid_date?: string | null;
          created_at: string;
        }[];
        const selfBills = (sbRes.data ?? []) as {
          net_payout: number;
          status: string;
          created_at: string;
        }[];

        const pendingRaw = invoices.filter((i) => i.status === "pending");
        const overdueRaw = invoices.filter((i) => i.status === "overdue");
        const paidRaw = invoices.filter((i) => i.status === "paid");

        const pending = bounds
          ? pendingRaw.filter((i) => inDateRange(i.created_at, bounds))
          : pendingRaw;
        const overdue = bounds
          ? overdueRaw.filter((i) => inDateRange(i.created_at, bounds))
          : overdueRaw;
        const paid = bounds
          ? paidRaw.filter((i) => {
              const ref = i.paid_date || i.created_at;
              return inDateRange(ref, bounds);
            })
          : paidRaw;

        const selfBillsScoped = bounds
          ? selfBills.filter((s) => inDateRange(s.created_at, bounds))
          : selfBills;

        const partnerDue = selfBillsScoped.filter((s) => s.status === "awaiting_payment" || s.status === "ready_to_pay");
        setData({
          receivable: [...pending, ...overdue].reduce((s, i) => s + Number(i.amount), 0),
          payable: selfBillsScoped.reduce((s, sb) => s + Number(sb.net_payout), 0),
          overdue: overdue.reduce((s, i) => s + Number(i.amount), 0),
          overdueCount: overdue.length,
          paidTotal: paid.reduce((s, i) => s + Number(i.amount), 0),
          pendingTotal: pending.reduce((s, i) => s + Number(i.amount), 0),
          pendingCount: pending.length,
          partnerPayouts: partnerDue.reduce((s, sb) => s + Number(sb.net_payout), 0),
          partnerPayoutsCount: partnerDue.length,
        });
      } catch { /* non-critical */ }
    }
    void load();
  }, [boundsKey]);

  const items = [
    { label: "Accounts Receivable",  value: data.receivable,    trend: `${data.pendingCount + data.overdueCount} invoices`, positive: true },
    { label: "Partner Payouts",      value: data.payable,       trend: `${data.partnerPayoutsCount} pending`,               positive: true },
    { label: "Paid This Period",     value: data.paidTotal,     trend: "Collected",                                         positive: true },
    { label: "Pending Collection",   value: data.pendingTotal,  trend: `${data.pendingCount} invoices`,                     positive: false },
    { label: "Partner Payouts Due",  value: data.partnerPayouts,trend: `${data.partnerPayoutsCount} partners`,              positive: true },
    { label: "Overdue Invoices",     value: data.overdue,       trend: `${data.overdueCount} invoices`,                     positive: false },
  ];

  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Financial Snapshot</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {bounds ? "Figures for the selected date range" : "Current financial position"}
          </p>
        </div>
        <button className="text-xs font-medium text-primary hover:text-primary-hover transition-colors">
          Full Report
        </button>
      </CardHeader>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <div key={item.label} className="p-3 rounded-xl bg-surface-hover/60 hover:bg-surface-tertiary/60 transition-colors cursor-pointer">
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">{item.label}</p>
              <p className="text-lg font-bold text-text-primary">{formatCurrency(item.value)}</p>
              <p className={`text-[11px] font-medium mt-0.5 ${item.positive ? "text-emerald-600" : "text-red-500"}`}>{item.trend}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
