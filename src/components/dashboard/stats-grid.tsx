"use client";

import { useState, useEffect } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { StaggerContainer } from "@/components/layout/page-transition";
import { getSupabase } from "@/services/base";
import {
  DollarSign,
  Briefcase,
  Users,
  TrendingUp,
  Clock,
  FileText,
} from "lucide-react";

interface DashboardStats {
  revenueMtd: number;
  revenuePrevMonth: number;
  activeJobs: number;
  prevActiveJobs: number;
  openQuotes: number;
  prevOpenQuotes: number;
  activePartners: number;
  prevActivePartners: number;
  avgCompletionDays: number;
  prevAvgCompletion: number;
  winRate: number;
  prevWinRate: number;
}

function pctChange(current: number, previous: number): number | undefined {
  if (previous === 0 && current === 0) return undefined;
  if (previous === 0) return 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function StatsGrid() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

        const [
          invMtdRes, invPrevRes,
          jobsActiveRes, jobsCompletedRes,
          quotesOpenRes, quotesAllRes,
          partnersRes,
        ] = await Promise.all([
          supabase.from("invoices").select("amount").eq("status", "paid").gte("paid_date", startOfMonth),
          supabase.from("invoices").select("amount").eq("status", "paid").gte("paid_date", startOfPrevMonth).lte("paid_date", endOfPrevMonth),
          supabase.from("jobs").select("id, status, created_at, completed_date"),
          supabase.from("jobs").select("created_at, completed_date").eq("status", "completed").not("completed_date", "is", null),
          supabase.from("quotes").select("id, status"),
          supabase.from("quotes").select("status"),
          supabase.from("partners").select("id, status"),
        ]);

        const revenueMtd = (invMtdRes.data ?? []).reduce((s, i) => s + Number((i as { amount: number }).amount), 0);
        const revenuePrevMonth = (invPrevRes.data ?? []).reduce((s, i) => s + Number((i as { amount: number }).amount), 0);

        const jobs = (jobsActiveRes.data ?? []) as { id: string; status: string; created_at: string; completed_date?: string }[];
        const activeJobs = jobs.filter((j) => j.status === "in_progress").length;

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
          ["draft", "partner_bidding", "ai_review", "sent"].includes((q as { status: string }).status)
        ).length;
        const approvedQuotes = allQuotes.filter((q) => q.status === "approved").length;
        const decidedQuotes = allQuotes.filter((q) => ["approved", "expired"].includes(q.status)).length;
        const winRate = decidedQuotes > 0 ? Math.round((approvedQuotes / decidedQuotes) * 100) : 0;

        const partners = (partnersRes.data ?? []) as { id: string; status: string }[];
        const activePartners = partners.filter((p) => p.status === "active").length;

        setStats({
          revenueMtd,
          revenuePrevMonth,
          activeJobs,
          prevActiveJobs: 0,
          openQuotes,
          prevOpenQuotes: 0,
          activePartners,
          prevActivePartners: 0,
          avgCompletionDays,
          prevAvgCompletion: 0,
          winRate,
          prevWinRate: 0,
        });
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const revenueChange = stats ? pctChange(stats.revenueMtd, stats.revenuePrevMonth) : undefined;

  return (
    <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <KpiCard
        title="Revenue MTD"
        value={loading ? 0 : stats?.revenueMtd ?? 0}
        format="currency"
        change={revenueChange}
        changeLabel="vs last month"
        icon={DollarSign}
        accent="emerald"
      />
      <KpiCard
        title="Active Jobs"
        value={loading ? 0 : stats?.activeJobs ?? 0}
        format="number"
        icon={Briefcase}
        accent="blue"
      />
      <KpiCard
        title="Open Quotes"
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
        title="Avg Completion"
        value={loading ? "—" : stats?.avgCompletionDays ? `${stats.avgCompletionDays} Days` : "N/A"}
        icon={Clock}
        accent="primary"
      />
      <KpiCard
        title="Win Rate"
        value={loading ? "—" : `${stats?.winRate ?? 0}%`}
        icon={TrendingUp}
        accent="emerald"
      />
    </StaggerContainer>
  );
}
