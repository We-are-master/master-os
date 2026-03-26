"use client";

import { useState, useEffect, useMemo } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { StaggerContainer } from "@/components/layout/page-transition";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import {
  DollarSign,
  Briefcase,
  TrendingUp,
  FileText,
} from "lucide-react";

interface DashboardStats {
  jobsRevenue: number;
  jobsRevenueCompare: number;
  jobsSalesCount: number;
  partnerPayouts: number;
  grossOpProfit: number;
  mtdRevenue: number;
  wtdRevenue: number;
  mtdSales: number;
  wtdSales: number;
  quoteToJobConversionRate: number; // percent
  requestsCount: number;
}

function pctChange(current: number, previous: number): number | undefined {
  if (previous === 0 && current === 0) return undefined;
  if (previous === 0) return 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function previousPeriodBounds(fromIso: string, toIso: string): { prevFrom: string; prevTo: string } {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const duration = Math.max(86400000, toMs - fromMs + 1);
  const prevToMs = fromMs - 1;
  const prevFromMs = prevToMs - duration + 1;
  return { prevFrom: new Date(prevFromMs).toISOString(), prevTo: new Date(prevToMs).toISOString() };
}

export function StatsGrid() {
  const { bounds } = useDashboardDateRange();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const boundsKey = useMemo(
    () => (bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all"),
    [bounds]
  );

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const now = new Date();
        const toIso = now.toISOString();

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
        const startOfWeek = (() => {
          const d = new Date(now);
          const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
          const diffToMonday = (day + 6) % 7; // Mon=0
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() - diffToMonday);
          return d.toISOString();
        })();

        const awaitingPaymentStatuses = ["awaiting_payment"] as const;
        const partnerPayoutStatuses = ["awaiting_payment", "ready_to_pay", "paid"] as const;

        async function jobRevenueAndSales(fromIso: string, toIsoInner: string): Promise<{ revenue: number; salesCount: number }> {
          const [awaitingRes, completedPaidRes] = await Promise.all([
            supabase
              .from("jobs")
              .select("client_price, extras_amount")
              .in("status", awaitingPaymentStatuses)
              .gte("updated_at", fromIso)
              .lte("updated_at", toIsoInner),
            supabase
              .from("jobs")
              .select("client_price, extras_amount")
              .eq("status", "completed")
              .eq("finance_status", "paid")
              .not("completed_date", "is", null)
              .gte("completed_date", fromIso)
              .lte("completed_date", toIsoInner),
          ]);

          const awaitingRows = (awaitingRes.data ?? []) as { client_price: number; extras_amount?: number | null }[];
          const completedRows = (completedPaidRes.data ?? []) as { client_price: number; extras_amount?: number | null }[];

          const sumRevenue = (rows: { client_price: number; extras_amount?: number | null }[]) =>
            rows.reduce((s, r) => s + Number(r.client_price ?? 0) + Number(r.extras_amount ?? 0), 0);

          const revenue = sumRevenue(awaitingRows) + sumRevenue(completedRows);
          const salesCount = awaitingRows.length + completedRows.length;
          return { revenue, salesCount };
        }

        async function partnerPayoutSum(fromIso: string, toIsoInner: string): Promise<number> {
          const res = await supabase
            .from("self_bills")
            .select("net_payout")
            .in("status", partnerPayoutStatuses)
            .gte("created_at", fromIso)
            .lte("created_at", toIsoInner);
          const rows = (res.data ?? []) as { net_payout: number }[];
          return rows.reduce((s, r) => s + Number(r.net_payout ?? 0), 0);
        }

        async function quoteConversion(fromIso: string, toIsoInner: string): Promise<{ requests: number; quotes: number; jobsFromQuotes: number; rate: number }> {
          const [reqRes, quotesRes, jobsFromQuotesRes] = await Promise.all([
            supabase
              .from("service_requests")
              .select("id", { count: "exact" })
              .gte("created_at", fromIso)
              .lte("created_at", toIsoInner),
            supabase
              .from("quotes")
              .select("id", { count: "exact" })
              .gte("created_at", fromIso)
              .lte("created_at", toIsoInner),
            supabase
              .from("jobs")
              .select("id", { count: "exact" })
              .not("quote_id", "is", null)
              .gte("created_at", fromIso)
              .lte("created_at", toIsoInner),
          ]);

          const requests = reqRes.count ?? 0;
          const quotes = quotesRes.count ?? 0;
          const jobsFromQuotes = jobsFromQuotesRes.count ?? 0;
          const rate = quotes > 0 ? Math.round((jobsFromQuotes / quotes) * 1000) / 10 : 0;
          return { requests, quotes, jobsFromQuotes, rate };
        }

        // Always compute calendar MTD/WTD (independent from selected dashboard bounds).
        const [mtd, wtd] = await Promise.all([
          jobRevenueAndSales(startOfMonth, toIso),
          jobRevenueAndSales(startOfWeek, toIso),
        ]);

        if (bounds) {
          const { prevFrom, prevTo } = previousPeriodBounds(bounds.fromIso, bounds.toIso);

          const [main, prevMain, partnerPayoutsMain, conversion] = await Promise.all([
            jobRevenueAndSales(bounds.fromIso, bounds.toIso),
            jobRevenueAndSales(prevFrom, prevTo),
            partnerPayoutSum(bounds.fromIso, bounds.toIso),
            quoteConversion(bounds.fromIso, bounds.toIso),
          ]);

          const grossOpProfit = main.revenue - partnerPayoutsMain;

          setStats({
            jobsRevenue: main.revenue,
            jobsRevenueCompare: prevMain.revenue,
            jobsSalesCount: main.salesCount,
            partnerPayouts: partnerPayoutsMain,
            grossOpProfit,
            mtdRevenue: mtd.revenue,
            wtdRevenue: wtd.revenue,
            mtdSales: mtd.salesCount,
            wtdSales: wtd.salesCount,
            quoteToJobConversionRate: conversion.rate,
            requestsCount: conversion.requests,
          });
        } else {
          // Default “main period” = MTD (so the dashboard shows a meaningful baseline).
          const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0).toISOString();
          const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).toISOString();

          const [main, prevMain, partnerPayoutsMain, conversion] = await Promise.all([
            jobRevenueAndSales(startOfMonth, toIso),
            jobRevenueAndSales(startOfPrevMonth, endOfPrevMonth),
            partnerPayoutSum(startOfMonth, toIso),
            quoteConversion(startOfMonth, toIso),
          ]);

          const grossOpProfit = main.revenue - partnerPayoutsMain;

          setStats({
            jobsRevenue: main.revenue,
            jobsRevenueCompare: prevMain.revenue,
            jobsSalesCount: main.salesCount,
            partnerPayouts: partnerPayoutsMain,
            grossOpProfit,
            mtdRevenue: mtd.revenue,
            wtdRevenue: wtd.revenue,
            mtdSales: mtd.salesCount,
            wtdSales: wtd.salesCount,
            quoteToJobConversionRate: conversion.rate,
            requestsCount: conversion.requests,
          });
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey]);

  const revenueChange = stats ? pctChange(stats.jobsRevenue, stats.jobsRevenueCompare) : undefined;

  return (
    <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <KpiCard
        title={bounds ? "Jobs revenue (selected)" : "Jobs revenue (MTD)"}
        value={loading ? 0 : stats?.jobsRevenue ?? 0}
        format="currency"
        change={revenueChange}
        changeLabel={bounds ? "vs previous period" : "vs last month"}
        icon={DollarSign}
        accent="emerald"
      />
      <KpiCard
        title="Gross Op Profit"
        description="Jobs revenue - partner payouts"
        value={loading ? 0 : stats?.grossOpProfit ?? 0}
        format="currency"
        icon={Briefcase}
        accent="primary"
      />
      <KpiCard
        title={bounds ? "Partner payouts (selected)" : "Partner payouts (MTD)"}
        value={loading ? 0 : stats?.partnerPayouts ?? 0}
        format="currency"
        icon={DollarSign}
        accent="amber"
      />
      <KpiCard
        title={bounds ? "Sales jobs (selected)" : "Sales jobs (MTD)"}
        description="completed paid + awaiting payment"
        value={loading ? 0 : stats?.jobsSalesCount ?? 0}
        format="number"
        icon={Briefcase}
        accent="blue"
      />
      <KpiCard
        title="MTD revenue"
        value={loading ? 0 : stats?.mtdRevenue ?? 0}
        format="currency"
        icon={DollarSign}
        accent="emerald"
      />
      <KpiCard
        title="WTD revenue"
        value={loading ? 0 : stats?.wtdRevenue ?? 0}
        format="currency"
        icon={DollarSign}
        accent="primary"
      />
      <KpiCard
        title="MTD sales jobs"
        value={loading ? 0 : stats?.mtdSales ?? 0}
        format="number"
        icon={Briefcase}
        accent="blue"
      />
      <KpiCard
        title="WTD sales jobs"
        value={loading ? 0 : stats?.wtdSales ?? 0}
        format="number"
        icon={Briefcase}
        accent="blue"
      />
      <KpiCard
        title="Quotes → Jobs conversion"
        description="jobs from quotes / quotes"
        value={loading ? 0 : stats?.quoteToJobConversionRate ?? 0}
        format="percent"
        icon={TrendingUp}
        accent="emerald"
      />
      <KpiCard
        title="Total requests"
        value={loading ? 0 : stats?.requestsCount ?? 0}
        format="number"
        icon={FileText}
        accent="purple"
      />
    </StaggerContainer>
  );
}
