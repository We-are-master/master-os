"use client";

import { useState, useEffect, useMemo } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { StaggerContainer } from "@/components/layout/page-transition";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import {
  DollarSign,
  Briefcase,
  Users,
  TrendingUp,
  Clock,
  FileText,
} from "lucide-react";

interface DashboardStats {
  revenue: number;
  revenueCompare: number;
  jobsMetric: number;
  openQuotes: number;
  activePartners: number;
  avgCompletionDays: number;
  winRate: number;
}

const OPEN_QUOTE_STATUSES = ["draft", "partner_bidding", "ai_review", "sent", "awaiting_customer", "bidding"];

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
        if (bounds) {
          const { prevFrom, prevTo } = previousPeriodBounds(bounds.fromIso, bounds.toIso);

          const [
            invPaidRes,
            invPaidPrevRes,
            jobsPeriodRes,
            jobsCompletedRes,
            quotesOpenRes,
            quotesDecidedRes,
            partnersRes,
          ] = await Promise.all([
            supabase
              .from("invoices")
              .select("amount")
              .eq("status", "paid")
              .gte("paid_date", bounds.fromIso)
              .lte("paid_date", bounds.toIso),
            supabase
              .from("invoices")
              .select("amount")
              .eq("status", "paid")
              .gte("paid_date", prevFrom)
              .lte("paid_date", prevTo),
            supabase
              .from("jobs")
              .select("id, status, created_at")
              .gte("created_at", bounds.fromIso)
              .lte("created_at", bounds.toIso),
            supabase
              .from("jobs")
              .select("created_at, completed_date")
              .eq("status", "completed")
              .not("completed_date", "is", null)
              .gte("completed_date", bounds.fromIso)
              .lte("completed_date", bounds.toIso),
            supabase
              .from("quotes")
              .select("id, status, created_at")
              .gte("created_at", bounds.fromIso)
              .lte("created_at", bounds.toIso),
            supabase
              .from("quotes")
              .select("status, created_at")
              .gte("created_at", bounds.fromIso)
              .lte("created_at", bounds.toIso),
            supabase.from("partners").select("id, status"),
          ]);

          const revenue = (invPaidRes.data ?? []).reduce((s, i) => s + Number((i as { amount: number }).amount), 0);
          const revenueCompare = (invPaidPrevRes.data ?? []).reduce((s, i) => s + Number((i as { amount: number }).amount), 0);

          const jobsInPeriod = (jobsPeriodRes.data ?? []) as { status: string }[];
          const jobsMetric = jobsInPeriod.filter((j) => !["completed", "cancelled"].includes(j.status)).length;

          const completedJobs = (jobsCompletedRes.data ?? []) as { created_at: string; completed_date: string }[];
          let avgCompletionDays = 0;
          if (completedJobs.length > 0) {
            const totalDays = completedJobs.reduce((s, j) => {
              const created = new Date(j.created_at).getTime();
              const completed = new Date(j.completed_date).getTime();
              return s + (completed - created) / 86400000;
            }, 0);
            avgCompletionDays = Math.round((totalDays / completedJobs.length) * 10) / 10;
          }

          const quotesRows = (quotesOpenRes.data ?? []) as { status: string }[];
          const openQuotes = quotesRows.filter((q) => OPEN_QUOTE_STATUSES.includes(q.status)).length;

          const decided = (quotesDecidedRes.data ?? []) as { status: string }[];
          const approvedQuotes = decided.filter((q) => q.status === "approved").length;
          const decidedQuotes = decided.filter((q) => ["approved", "expired", "rejected"].includes(q.status)).length;
          const winRate = decidedQuotes > 0 ? Math.round((approvedQuotes / decidedQuotes) * 100) : 0;

          const partners = (partnersRes.data ?? []) as { status: string }[];
          const activePartners = partners.filter((p) => p.status === "active").length;

          setStats({
            revenue,
            revenueCompare,
            jobsMetric,
            openQuotes,
            activePartners,
            avgCompletionDays,
            winRate,
          });
        } else {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
          const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

          const [
            invMtdRes,
            invPrevRes,
            jobsActiveRes,
            jobsCompletedRes,
            quotesOpenRes,
            quotesAllRes,
            partnersRes,
          ] = await Promise.all([
            supabase.from("invoices").select("amount").eq("status", "paid").gte("paid_date", startOfMonth),
            supabase
              .from("invoices")
              .select("amount")
              .eq("status", "paid")
              .gte("paid_date", startOfPrevMonth)
              .lte("paid_date", endOfPrevMonth),
            supabase.from("jobs").select("id, status, created_at, completed_date"),
            supabase.from("jobs").select("created_at, completed_date").eq("status", "completed").not("completed_date", "is", null),
            supabase.from("quotes").select("id, status"),
            supabase.from("quotes").select("status"),
            supabase.from("partners").select("id, status"),
          ]);

          const revenue = (invMtdRes.data ?? []).reduce((s, i) => s + Number((i as { amount: number }).amount), 0);
          const revenueCompare = (invPrevRes.data ?? []).reduce((s, i) => s + Number((i as { amount: number }).amount), 0);

          const jobs = (jobsActiveRes.data ?? []) as { status: string }[];
          const jobsMetric = jobs.filter((j) => j.status === "in_progress").length;

          const completedJobs = (jobsCompletedRes.data ?? []) as { created_at: string; completed_date: string }[];
          let avgCompletionDays = 0;
          if (completedJobs.length > 0) {
            const totalDays = completedJobs.reduce((s, j) => {
              const created = new Date(j.created_at).getTime();
              const completed = new Date(j.completed_date).getTime();
              return s + (completed - created) / 86400000;
            }, 0);
            avgCompletionDays = Math.round((totalDays / completedJobs.length) * 10) / 10;
          }

          const allQuotes = (quotesAllRes.data ?? []) as { status: string }[];
          const openQuotes = (quotesOpenRes.data ?? []).filter((q) =>
            OPEN_QUOTE_STATUSES.includes((q as { status: string }).status)
          ).length;
          const approvedQuotes = allQuotes.filter((q) => q.status === "approved").length;
          const decidedQuotes = allQuotes.filter((q) => ["approved", "expired", "rejected"].includes(q.status)).length;
          const winRate = decidedQuotes > 0 ? Math.round((approvedQuotes / decidedQuotes) * 100) : 0;

          const partners = (partnersRes.data ?? []) as { id: string; status: string }[];
          const activePartners = partners.filter((p) => p.status === "active").length;

          setStats({
            revenue,
            revenueCompare,
            jobsMetric,
            openQuotes,
            activePartners,
            avgCompletionDays,
            winRate,
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

  const revenueChange = stats ? pctChange(stats.revenue, stats.revenueCompare) : undefined;

  return (
    <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <KpiCard
        title={bounds ? "Revenue (paid)" : "Revenue MTD"}
        value={loading ? 0 : stats?.revenue ?? 0}
        format="currency"
        change={revenueChange}
        changeLabel={bounds ? "vs previous period" : "vs last month"}
        icon={DollarSign}
        accent="emerald"
      />
      <KpiCard
        title={bounds ? "Open pipeline jobs" : "Active Jobs"}
        description={bounds ? "Created in range, not completed" : undefined}
        value={loading ? 0 : stats?.jobsMetric ?? 0}
        format="number"
        icon={Briefcase}
        accent="blue"
      />
      <KpiCard
        title={bounds ? "Open quotes (new)" : "Open Quotes"}
        description={bounds ? "Created in range" : undefined}
        value={loading ? 0 : stats?.openQuotes ?? 0}
        format="number"
        icon={FileText}
        accent="purple"
      />
      <KpiCard
        title="Active Partners"
        value={loading ? 0 : stats?.activePartners ?? 0}
        format="number"
        icon={Users}
        accent="amber"
      />
      <KpiCard
        title={bounds ? "Avg completion" : "Avg Completion"}
        description={bounds ? "Completed in range" : undefined}
        value={loading ? "—" : stats?.avgCompletionDays ? `${stats.avgCompletionDays} Days` : "N/A"}
        icon={Clock}
        accent="primary"
      />
      <KpiCard
        title={bounds ? "Win rate" : "Win Rate"}
        description={bounds ? "Quotes decided in range" : undefined}
        value={loading ? "—" : `${stats?.winRate ?? 0}%`}
        icon={TrendingUp}
        accent="emerald"
      />
    </StaggerContainer>
  );
}
