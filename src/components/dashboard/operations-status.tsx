"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { getSupabase } from "@/services/base";

interface Metric {
  label: string;
  value: number;
  target: number;
  detail: string;
}

export function OperationsStatus() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const [jobsRes, partnersRes, quotesRes, invoicesRes] = await Promise.all([
          supabase.from("jobs").select("status"),
          supabase.from("partners").select("status, compliance_score"),
          supabase.from("quotes").select("status"),
          supabase.from("invoices").select("status"),
        ]);

        const jobs = (jobsRes.data ?? []) as { status: string }[];
        const partners = (partnersRes.data ?? []) as { status: string; compliance_score: number }[];
        const quotes = (quotesRes.data ?? []) as { status: string }[];
        const invoices = (invoicesRes.data ?? []) as { status: string }[];

        const activeJobs = jobs.filter((j) => j.status === "in_progress").length;
        const totalJobs = jobs.length;
        const scheduleCoverage = totalJobs > 0 ? Math.round((activeJobs / Math.max(totalJobs, 1)) * 100) : 0;

        const activePartners = partners.filter((p) => p.status === "active").length;
        const totalPartners = partners.length;
        const partnerUtil = totalPartners > 0 ? Math.round((activePartners / totalPartners) * 100) : 0;

        const approvedQuotes = quotes.filter((q) => q.status === "approved").length;
        const relevantQuotes = quotes.filter((q) => ["approved", "sent", "expired"].includes(q.status)).length;
        const quoteConversion = relevantQuotes > 0 ? Math.round((approvedQuotes / relevantQuotes) * 100) : 0;

        const paidInvoices = invoices.filter((i) => i.status === "paid").length;
        const collectionRelevant = invoices.filter((i) => ["paid", "pending", "overdue"].includes(i.status)).length;
        const invoiceCollection = collectionRelevant > 0 ? Math.round((paidInvoices / collectionRelevant) * 100) : 0;

        const avgCompliance = partners.length > 0
          ? Math.round(partners.reduce((s, p) => s + p.compliance_score, 0) / partners.length)
          : 0;

        const overdueCount = invoices.filter((i) => i.status === "overdue").length;

        setMetrics([
          { label: "Job Execution", value: scheduleCoverage, target: 80, detail: `${activeJobs} of ${totalJobs} jobs active` },
          { label: "Partner Utilization", value: partnerUtil, target: 85, detail: `${activePartners} of ${totalPartners} partners active` },
          { label: "Quote Conversion", value: quoteConversion, target: 65, detail: `${approvedQuotes} of ${relevantQuotes} converted` },
          { label: "Invoice Collection", value: invoiceCollection, target: 90, detail: `${overdueCount} overdue invoices` },
          { label: "Compliance Score", value: avgCompliance, target: 95, detail: "Average partner compliance" },
        ]);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const allOnTrack = metrics.length > 0 && metrics.every((m) => m.value >= m.target);

  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Operations Health</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">Real-time performance metrics</p>
        </div>
        {!loading && (
          <Badge variant={allOnTrack ? "success" : "warning"} dot>
            {allOnTrack ? "All On Track" : "Needs Attention"}
          </Badge>
        )}
      </CardHeader>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="px-5 pb-5 space-y-4"
      >
        {loading && (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-4 bg-surface-tertiary rounded w-48" />
                <div className="h-2 bg-surface-tertiary rounded w-full" />
              </div>
            ))}
          </div>
        )}
        {!loading && metrics.map((metric) => (
          <motion.div key={metric.label} variants={staggerItem}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{metric.label}</span>
                {metric.value >= metric.target ? (
                  <Badge variant="success" size="sm">On Track</Badge>
                ) : (
                  <Badge variant="warning" size="sm">Below Target</Badge>
                )}
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-text-primary">{metric.value}%</span>
                <span className="text-xs text-text-tertiary ml-1">/ {metric.target}%</span>
              </div>
            </div>
            <Progress
              value={metric.value}
              size="md"
              color={metric.value >= metric.target ? "emerald" : "amber"}
            />
            <p className="text-[11px] text-text-tertiary mt-1">{metric.detail}</p>
          </motion.div>
        ))}
      </motion.div>
    </Card>
  );
}
