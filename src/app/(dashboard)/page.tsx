"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { StatsGrid } from "@/components/dashboard/stats-grid";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PipelineSummary } from "@/components/dashboard/pipeline-summary";
import { PriorityTasks } from "@/components/dashboard/priority-tasks";
import { OperationsStatus } from "@/components/dashboard/operations-status";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { staggerItem } from "@/lib/motion";
import { formatCurrency } from "@/lib/utils";
import { useProfile } from "@/hooks/use-profile";
import { getSupabase } from "@/services/base";
import { useRouter } from "next/navigation";

type DashboardFilter =
  | "commission_pending"
  | "financial_status"
  | "awaiting_payment"
  | "without_invoice"
  | "without_selfbill"
  | "without_report"
  | "without_partner"
  | "without_quote"
  | "low_margin";

const FILTER_CHIPS: { id: DashboardFilter; label: string; color: string }[] = [
  { id: "commission_pending", label: "Commission Pending", color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { id: "awaiting_payment", label: "Awaiting Payment", color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
  { id: "without_invoice", label: "Without Invoice", color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
  { id: "without_selfbill", label: "Without Self Billing", color: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100" },
  { id: "without_report", label: "Without Report", color: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100" },
  { id: "without_partner", label: "Without Partner", color: "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100" },
  { id: "without_quote", label: "Without Quote", color: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100" },
  { id: "low_margin", label: "Low Margin (<20%)", color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
  { id: "financial_status", label: "Finance Unpaid", color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
];

export default function DashboardPage() {
  const greeting = getGreeting();
  const { profile } = useProfile();
  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const router = useRouter();
  const [activeFilters, setActiveFilters] = useState<Set<DashboardFilter>>(new Set());
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});

  const toggleFilter = (id: DashboardFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadFilterCounts = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const [jobsRes, invoicesRes] = await Promise.all([
        supabase.from("jobs").select("id, status, partner_id, partner_name, quote_id, margin_percent, finance_status, report_submitted, commission"),
        supabase.from("invoices").select("id, job_reference"),
      ]);
      const jobs = (jobsRes.data ?? []) as { id: string; status: string; partner_id?: string; partner_name?: string; quote_id?: string; margin_percent: number; finance_status?: string; report_submitted?: boolean; commission?: number }[];
      const invoiceRefs = new Set((invoicesRes.data ?? []).map((i: { job_reference?: string }) => i.job_reference).filter(Boolean));

      setFilterCounts({
        commission_pending: jobs.filter((j) => (j.commission ?? 0) > 0 && j.finance_status !== "paid").length,
        awaiting_payment: jobs.filter((j) => j.status === "awaiting_payment").length,
        without_invoice: jobs.filter((j) => !invoiceRefs.has(j.id) && j.status !== "completed").length,
        without_selfbill: jobs.filter((j) => j.partner_name && j.status === "completed").length,
        without_report: jobs.filter((j) => !j.report_submitted && !["completed", "scheduled"].includes(j.status)).length,
        without_partner: jobs.filter((j) => !j.partner_id && !j.partner_name).length,
        without_quote: jobs.filter((j) => !j.quote_id).length,
        low_margin: jobs.filter((j) => j.margin_percent < 20 && j.margin_percent > 0).length,
        financial_status: jobs.filter((j) => j.finance_status !== "paid" && !["completed", "scheduled"].includes(j.status)).length,
      });
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { loadFilterCounts(); }, [loadFilterCounts]);

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title={`${greeting}, ${firstName}`}
          subtitle="Here's what's happening across your operations today."
        >
          <Badge variant="success" dot pulse size="md">
            Live Updates
          </Badge>
        </PageHeader>

        <StatsGrid />

        {/* Dashboard Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mr-1">Filters:</span>
          {FILTER_CHIPS.map((chip) => {
            const isActive = activeFilters.has(chip.id);
            const count = filterCounts[chip.id] ?? 0;
            return (
              <button
                key={chip.id}
                onClick={() => toggleFilter(chip.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                  isActive
                    ? "bg-primary text-white border-primary shadow-sm"
                    : chip.color
                }`}
              >
                {chip.label}
                {count > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-black/10 text-current"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {activeFilters.size > 0 && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="text-xs font-medium text-text-tertiary hover:text-primary underline underline-offset-2 ml-1"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div variants={staggerItem} className="lg:col-span-2">
            <RevenueChart />
          </motion.div>
          <motion.div variants={staggerItem}>
            <QuickActions />
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div variants={staggerItem}>
            <PriorityTasks />
          </motion.div>
          <motion.div variants={staggerItem}>
            <ActivityFeed />
          </motion.div>
          <motion.div variants={staggerItem}>
            <PipelineSummary />
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div variants={staggerItem}>
            <OperationsStatus />
          </motion.div>
          <motion.div variants={staggerItem}>
            <FinancialSnapshot />
          </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function FinancialSnapshot() {
  const [data, setData] = useState({
    receivable: 0,
    payable: 0,
    overdue: 0,
    overdueCount: 0,
    paidTotal: 0,
    pendingTotal: 0,
    pendingCount: 0,
    partnerPayouts: 0,
    partnerPayoutsCount: 0,
  });

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const [invRes, sbRes] = await Promise.all([
          supabase.from("invoices").select("amount, status"),
          supabase.from("self_bills").select("net_payout, status"),
        ]);

        const invoices = (invRes.data ?? []) as { amount: number; status: string }[];
        const selfBills = (sbRes.data ?? []) as { net_payout: number; status: string }[];

        const pending = invoices.filter((i) => i.status === "pending");
        const overdue = invoices.filter((i) => i.status === "overdue");
        const paid = invoices.filter((i) => i.status === "paid");
        const partnerDue = selfBills.filter((s) => s.status === "awaiting_payment" || s.status === "ready_to_pay");

        setData({
          receivable: [...pending, ...overdue].reduce((s, i) => s + Number(i.amount), 0),
          payable: selfBills.reduce((s, sb) => s + Number(sb.net_payout), 0),
          overdue: overdue.reduce((s, i) => s + Number(i.amount), 0),
          overdueCount: overdue.length,
          paidTotal: paid.reduce((s, i) => s + Number(i.amount), 0),
          pendingTotal: pending.reduce((s, i) => s + Number(i.amount), 0),
          pendingCount: pending.length,
          partnerPayouts: partnerDue.reduce((s, sb) => s + Number(sb.net_payout), 0),
          partnerPayoutsCount: partnerDue.length,
        });
      } catch {
        // non-critical
      }
    }
    load();
  }, []);

  const items = [
    { label: "Accounts Receivable", value: data.receivable, trend: `${data.pendingCount + data.overdueCount} invoices`, positive: true },
    { label: "Partner Payouts", value: data.payable, trend: `${data.partnerPayoutsCount} pending`, positive: true },
    { label: "Paid This Period", value: data.paidTotal, trend: "Collected", positive: true },
    { label: "Pending Collection", value: data.pendingTotal, trend: `${data.pendingCount} invoices`, positive: false },
    { label: "Partner Payouts Due", value: data.partnerPayouts, trend: `${data.partnerPayoutsCount} partners`, positive: true },
    { label: "Overdue Invoices", value: data.overdue, trend: `${data.overdueCount} invoices`, positive: false },
  ];

  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Financial Snapshot</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">Current financial position</p>
        </div>
        <button className="text-xs font-medium text-primary hover:text-primary-hover transition-colors">
          Full Report
        </button>
      </CardHeader>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-xl bg-surface-hover/60 hover:bg-surface-tertiary/60 transition-colors cursor-pointer"
            >
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">
                {item.label}
              </p>
              <p className="text-lg font-bold text-text-primary">
                {formatCurrency(item.value)}
              </p>
              <p className={`text-[11px] font-medium mt-0.5 ${item.positive ? "text-emerald-600" : "text-red-500"}`}>
                {item.trend}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
