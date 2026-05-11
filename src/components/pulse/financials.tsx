"use client";

import { useEffect, useState } from "react";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, formatISO } from "date-fns";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { dashboardBoundsToInclusiveLocalYmd } from "@/lib/dashboard-date-range";
import {
  countWorkingDaysInRange,
  monthlyWorkingDays,
  parseFrontendSetup,
  type FrontendSetup,
} from "@/lib/frontend-setup";
import { KpiCard } from "@/components/fx/primitives";

type Financials = {
  revenue: number;
  partnerCost: number;
  materialsCost: number;
  expenses: number;
  workforce: number;
  bills: number;
  jobs: number;
};

const initial: Financials = {
  revenue: 0,
  partnerCost: 0,
  materialsCost: 0,
  expenses: 0,
  workforce: 0,
  bills: 0,
  jobs: 0,
};

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

export function Financials() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [data, setData] = useState<Financials>(initial);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const fromIso = bounds?.fromIso ?? formatISO(startOfMonth(now));
      const toIso = bounds?.toIso ?? formatISO(endOfMonth(now));
      const { fromDay, toDay } = bounds
        ? dashboardBoundsToInclusiveLocalYmd(bounds)
        : { fromDay: ymd(startOfMonth(now)), toDay: ymd(endOfMonth(now)) };

      const [jobsRes, billsRes, payrollRes, settingsRes] = await Promise.all([
        // Revenue + Operating Cost — active operational pipeline only
        supabase
          .from("jobs")
          .select("client_price, extras_amount, partner_cost, materials_cost, expenses")
          .gte("scheduled_start_at", fromIso)
          .lte("scheduled_start_at", toIso)
          .in("status", ACTIVE_OPS_STATUSES)
          .is("deleted_at", null),
        // Bills — only what's actually due in the period (no approval gate, no run-rate).
        // The bill enters the cost flow when its due_date hits the window.
        supabase
          .from("bills")
          .select("id, amount, status, due_date")
          .is("archived_at", null)
          .neq("status", "rejected")
          .gte("due_date", fromDay)
          .lte("due_date", toDay),
        // Workforce — every active/onboarding payroll row counted at face value (monthly commitment).
        // Pro-rated below by working days in the selected window.
        supabase
          .from("payroll_internal_costs")
          .select("id, amount, lifecycle_stage")
          .neq("lifecycle_stage", "offboard"),
        supabase.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      type JobRow = {
        client_price: number | null;
        extras_amount: number | null;
        partner_cost: number | null;
        materials_cost: number | null;
        expenses: number | null;
      };
      const jobsData = (jobsRes.data ?? []) as JobRow[];
      let revenue = 0;
      let partnerCost = 0;
      let materialsCost = 0;
      let expenses = 0;
      for (const r of jobsData) {
        revenue += (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0);
        partnerCost += Number(r.partner_cost) || 0;
        materialsCost += Number(r.materials_cost) || 0;
        expenses += Number(r.expenses) || 0;
      }

      // Bills: simple sum of amounts due in period
      type BillRow = { id: string; amount: number | null; status: string | null; due_date: string | null };
      const billRows = (billsRes.data ?? []) as BillRow[];
      const bills = billRows.reduce((a, b) => a + (Number(b.amount) || 0), 0);

      // Workforce: each `payroll_internal_costs.amount` is a monthly commitment.
      // Pro-rate by the share of working days in the window so "Today" doesn't
      // show the whole monthly salary, "Week" shows ~6/26, etc. Falls back to
      // the full monthly burn when no period is selected ("All Time").
      type PayrollRow = { id: string | null; amount: number | null; lifecycle_stage: string | null };
      const payrollRows = (payrollRes.data ?? []) as PayrollRow[];
      const monthlyBurnPayroll = payrollRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const setup: FrontendSetup = parseFrontendSetup(
        (settingsRes.data as { frontend_setup?: unknown } | null)?.frontend_setup,
      );
      const fromDate = bounds ? new Date(bounds.fromIso) : startOfDay(now);
      const toDate = bounds ? new Date(bounds.toIso) : endOfDay(now);
      const workingDaysInWindow = countWorkingDaysInRange(fromDate, toDate, setup);
      const monthlyDivisor = monthlyWorkingDays(setup);
      const workforceFactor = bounds && monthlyDivisor > 0
        ? workingDaysInWindow / monthlyDivisor
        : 1; // "All Time" → full monthly commitment
      const workforce = monthlyBurnPayroll * workforceFactor;

      setData({
        revenue,
        partnerCost,
        materialsCost,
        expenses,
        workforce,
        bills,
        jobs: jobsData.length,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const operatingCost = data.partnerCost + data.materialsCost + data.expenses;
  const fixedCost = data.workforce + data.bills;
  const netMargin = data.revenue - operatingCost - fixedCost;
  const opsPct = data.revenue > 0 ? (operatingCost / data.revenue) * 100 : 0;
  const fixedPct = data.revenue > 0 ? (fixedCost / data.revenue) * 100 : 0;
  const netPct = data.revenue > 0 ? (netMargin / data.revenue) * 100 : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Revenue"
        hint="Total client price + extras for jobs in the active pipeline (excludes On Hold, Cancelled, Deleted)."
        value={loading ? "—" : formatGbp(data.revenue)}
        sub={
          loading
            ? "Loading…"
            : `${data.jobs} job${data.jobs === 1 ? "" : "s"} · Active Pipeline${
                bounds ? ` · ${rangeLabel}` : ""
              }`
        }
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label="Operating Cost"
        hint="Partner cost + materials + per-job expenses for the same pipeline."
        value={loading ? "—" : formatGbp(operatingCost)}
        sub={loading ? "Loading…" : `${opsPct.toFixed(1)}% · Partners · Materials · Expenses`}
        topRight={<StatusDot color="bg-fx-amber" />}
      />
      <KpiCard
        label="Fixed Costs"
        hint="Workforce + bills allocated to this period. Workforce is each active person's monthly commitment pro-rated by working days in the window. Bills only count when their due_date falls inside the window."
        value={loading ? "—" : formatGbp(fixedCost)}
        sub={
          loading
            ? "Loading…"
            : `${fixedPct.toFixed(1)}% · Workforce £${formatNum(data.workforce)} + Bills £${formatNum(data.bills)}`
        }
        topRight={<StatusDot color="bg-fx-blue" />}
      />
      <KpiCard
        label="Net Margin"
        hint="Revenue minus Operating Cost and Fixed Costs. Negative means the period didn't cover overhead."
        variant={!loading && netMargin < 0 ? "alert" : netMargin > 0 && data.revenue > 0 ? "coral" : "default"}
        value={loading ? "—" : formatGbp(netMargin)}
        sub={loading ? "Loading…" : `${netPct.toFixed(1)}% of revenue`}
        topRight={<StatusDot color={netMargin >= 0 ? "bg-fx-green" : "bg-fx-red"} />}
      />
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full inline-block", color)} aria-hidden />;
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNum(n: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(n);
}
