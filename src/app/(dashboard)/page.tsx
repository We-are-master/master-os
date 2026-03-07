"use client";

import { useState, useEffect } from "react";
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

export default function DashboardPage() {
  const greeting = getGreeting();
  const { profile } = useProfile();
  const firstName = profile?.full_name?.split(" ")[0] || "there";

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
        const partnerDue = selfBills.filter((s) => s.status === "generated");

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
              className="p-3 rounded-xl bg-stone-50/60 hover:bg-stone-100/60 transition-colors cursor-pointer"
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
