"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatCurrency } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRangeOptional } from "@/hooks/use-dashboard-date-range";
import { jobBillableRevenue } from "@/lib/job-financials";
import type { Job } from "@/types/database";

interface FunnelPhase {
  id: string;
  label: string;
  value: number;
  count: number;
  color: string;
}

export function PipelineSummary() {
  const [phases, setPhases] = useState<FunnelPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const dateCtx = useDashboardDateRangeOptional();
  const boundsKey = useMemo(() => {
    const b = dateCtx?.bounds ?? null;
    return b ? `${b.fromIso}|${b.toIso}` : "all";
  }, [dateCtx]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      const b = dateCtx?.bounds ?? null;
      const fromIso = b?.fromIso ?? null;
      const toIso = b?.toIso ?? null;
      const fromDay = fromIso?.slice(0, 10) ?? null;
      const toDay = toIso?.slice(0, 10) ?? null;

      try {
        const reqSel = "estimated_value, status, created_at";
        let newRequestsQ = supabase
          .from("service_requests")
          .select(reqSel)
          .in("status", ["new", "approved"])
          .is("deleted_at", null);
        if (fromIso && toIso) {
          newRequestsQ = newRequestsQ.gte("created_at", fromIso).lte("created_at", toIso);
        }

        const quotesSentSel = "total_value, customer_pdf_sent_at, status, created_at";
        let quotesPdfQ = supabase.from("quotes").select(quotesSentSel).not("customer_pdf_sent_at", "is", null);
        if (fromIso && toIso) {
          quotesPdfQ = quotesPdfQ.gte("customer_pdf_sent_at", fromIso).lte("customer_pdf_sent_at", toIso);
        }

        let quotesFallbackQ = supabase
          .from("quotes")
          .select(quotesSentSel)
          .is("customer_pdf_sent_at", null)
          .in("status", ["awaiting_customer", "accepted"]);
        if (fromIso && toIso) {
          quotesFallbackQ = quotesFallbackQ.gte("created_at", fromIso).lte("created_at", toIso);
        }

        const jobSel = "client_price, extras_amount, status, created_at, completed_date";
        // Default 13-month floor to bound the query when no user range is set.
        const defaultFloorIso = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();

        let jobsActiveQ = supabase
          .from("jobs")
          .select(jobSel)
          .is("deleted_at", null)
          .neq("status", "completed")
          .neq("status", "cancelled")
          .limit(2000);
        if (fromIso && toIso) {
          jobsActiveQ = jobsActiveQ.gte("created_at", fromIso).lte("created_at", toIso);
        } else {
          jobsActiveQ = jobsActiveQ.gte("created_at", defaultFloorIso);
        }

        let jobsDoneQ = supabase
          .from("jobs")
          .select(jobSel)
          .is("deleted_at", null)
          .eq("status", "completed")
          .not("completed_date", "is", null)
          .limit(2000);
        if (fromDay && toDay) {
          jobsDoneQ = jobsDoneQ.gte("completed_date", fromDay).lte("completed_date", toDay);
        } else {
          jobsDoneQ = jobsDoneQ.gte("completed_date", defaultFloorIso.slice(0, 10));
        }

        const [reqRes, quotesPdfRes, quotesFbRes, jobsActiveRes, jobsDoneRes] = await Promise.all([
          newRequestsQ,
          quotesPdfQ,
          quotesFallbackQ,
          jobsActiveQ,
          jobsDoneQ,
        ]);

        type QuoteVal = { total_value?: number };
        let quoteRowsPdf: QuoteVal[] = (quotesPdfRes.data ?? []) as QuoteVal[];
        let quoteRowsFb: QuoteVal[] = (quotesFbRes.data ?? []) as QuoteVal[];

        if (quotesPdfRes.error) {
          const legacy = "total_value, status, created_at";
          let q1 = supabase.from("quotes").select(legacy).in("status", ["awaiting_customer", "accepted"]);
          if (fromIso && toIso) q1 = q1.gte("created_at", fromIso).lte("created_at", toIso);
          const leg = await q1;
          quoteRowsPdf = (leg.data ?? []) as QuoteVal[];
          quoteRowsFb = [];
        } else if (quotesFbRes.error) {
          quoteRowsFb = [];
        }

        if (cancelled) return;

        const reqRows = (reqRes.data ?? []) as { estimated_value?: number | null; status: string }[];
        const newRequestsValue = reqRows.reduce((s, r) => s + Number(r.estimated_value ?? 0), 0);
        let quotesSentValue = 0;
        const quotesSentCount = quoteRowsPdf.length + quoteRowsFb.length;
        for (const r of quoteRowsPdf) {
          quotesSentValue += Number(r.total_value ?? 0);
        }
        for (const r of quoteRowsFb) {
          quotesSentValue += Number(r.total_value ?? 0);
        }

        type JobRev = Pick<Job, "client_price" | "extras_amount">;
        const activeJobRows = (jobsActiveRes.data ?? []) as JobRev[];
        const bookedValue = activeJobRows.reduce((s, j) => s + jobBillableRevenue(j), 0);

        const doneJobRows = (jobsDoneRes.data ?? []) as JobRev[];
        const completedValue = doneJobRows.reduce((s, j) => s + jobBillableRevenue(j), 0);

        const out: FunnelPhase[] = [
          {
            id: "requests",
            label: "NEW REQUESTS",
            value: newRequestsValue,
            count: reqRows.length,
            color: "bg-sky-500",
          },
          {
            id: "quotes_sent",
            label: "QUOTES SENT",
            value: quotesSentValue,
            count: quotesSentCount,
            color: "bg-violet-500",
          },
          {
            id: "job_booked",
            label: "JOB BOOKED",
            value: bookedValue,
            count: activeJobRows.length,
            color: "bg-amber-500",
          },
          {
            id: "jobs_completed",
            label: "JOBS COMPLETED",
            value: completedValue,
            count: doneJobRows.length,
            color: "bg-emerald-500",
          },
        ];

        setPhases(out);
      } catch {
        if (!cancelled) setPhases([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [boundsKey, dateCtx]);

  const totalValue = phases.reduce((acc, p) => acc + p.value, 0);

  return (
    <Card padding="none" className="flex flex-col max-h-[360px] overflow-hidden h-full">
      <CardHeader className="px-5 pt-4 pb-3 mb-0 shrink-0 border-b border-border-light">
        <div>
          <CardTitle>Pipeline</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {dateCtx?.bounds ? `${dateCtx.rangeLabel} · ` : "All time · "}
            {loading ? "Loading…" : `${formatCurrency(totalValue)} total`}
          </p>
        </div>
        <Link
          href="/requests"
          className="text-xs font-medium text-primary hover:text-primary-hover hover:underline transition-colors shrink-0"
        >
          Requests
        </Link>
      </CardHeader>

      {!loading && totalValue > 0 && (
        <div className="px-5 pb-2 shrink-0">
          <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
            {phases.map((phase) => (
              <motion.div
                key={phase.id}
                initial={{ width: 0 }}
                animate={{ width: `${(phase.value / totalValue) * 100}%` }}
                transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.15 }}
                className={`${phase.color} rounded-full min-w-[2px]`}
              />
            ))}
          </div>
        </div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="px-2 pb-3 flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        {loading ? (
          <div className="px-3 py-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-hover" />
            ))}
          </div>
        ) : (
          phases.map((phase) => (
            <motion.div
              key={phase.id}
              variants={staggerItem}
              className="flex items-center gap-2.5 sm:gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover/60 transition-colors"
            >
              <p className="text-sm font-bold tabular-nums text-text-primary shrink-0 w-[5.25rem] sm:w-[6.25rem]">
                {formatCurrency(phase.value)}
              </p>
              <div className={`h-2 w-2 rounded-full shrink-0 ${phase.color}`} />
              <span className="text-xs font-semibold text-text-primary tracking-wide flex-1 min-w-0">{phase.label}</span>
              <span className="text-xs font-medium tabular-nums text-text-tertiary shrink-0">{phase.count}</span>
            </motion.div>
          ))
        )}
      </motion.div>
    </Card>
  );
}
