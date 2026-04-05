"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { motion } from "framer-motion";
import { useDashboardDateRangeOptional } from "@/hooks/use-dashboard-date-range";
import { isLegacyJobSchema } from "@/lib/job-schema-compat";

interface FunnelStep {
  label: string;
  count: number;
  color: string;
  pct: number;
}

const JOB_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  late: "Late",
  in_progress_phase1: "In progress (P1)",
  in_progress_phase2: "In progress (P2)",
  in_progress_phase3: "In progress (P3)",
  final_check: "Final check",
  awaiting_payment: "Awaiting payment",
  need_attention: "Need attention",
  completed: "Completed",
};

export function QuoteFunnel() {
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [meta, setMeta] = useState({
    requests: 0,
    quotes: 0,
    quotesConverted: 0,
    jobs: 0,
    jobsFromQuotes: 0,
    quoteToJobRate: 0,
    requestsToJobsRate: 0,
  });
  const [jobStatusBreakdown, setJobStatusBreakdown] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const dateCtx = useDashboardDateRangeOptional();
  const boundsKey = useMemo(() => {
    const b = dateCtx?.bounds ?? null;
    return b ? `${b.fromIso}|${b.toIso}` : "all";
  }, [dateCtx]);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const bounds = dateCtx?.bounds ?? null;
        const fromIso = bounds?.fromIso;
        const toIso = bounds?.toIso;

        let reqQ = supabase.from("service_requests").select("id", { count: "exact" });
        let quotesQ = supabase.from("quotes").select("id", { count: "exact" });
        let jobsQ = supabase.from("jobs").select("id", { count: "exact" });

        const legacy = isLegacyJobSchema();

        let quotesConvertedQ = supabase
          .from("quotes")
          .select("id", { count: "exact" })
          .eq("status", "converted_to_job");

        let jobsFromQuotesQ = legacy
          ? supabase.from("quotes").select("id", { count: "exact" }).eq("status", "converted_to_job")
          : supabase.from("jobs").select("id", { count: "exact" }).not("quote_id", "is", null);

        let jobsFromQuotesStatusesQ = legacy
          ? supabase.from("jobs").select("status").eq("id", "00000000-0000-0000-0000-000000000001")
          : supabase.from("jobs").select("status").not("quote_id", "is", null);

        if (fromIso && toIso) {
          reqQ = reqQ.gte("created_at", fromIso).lte("created_at", toIso);
          quotesQ = quotesQ.gte("created_at", fromIso).lte("created_at", toIso);
          jobsQ = jobsQ.gte("created_at", fromIso).lte("created_at", toIso);
          quotesConvertedQ = quotesConvertedQ.gte("updated_at", fromIso).lte("updated_at", toIso);
          if (legacy) {
            jobsFromQuotesQ = jobsFromQuotesQ.gte("updated_at", fromIso).lte("updated_at", toIso);
          } else {
            jobsFromQuotesQ = jobsFromQuotesQ.gte("created_at", fromIso).lte("created_at", toIso);
            jobsFromQuotesStatusesQ = jobsFromQuotesStatusesQ.gte("created_at", fromIso).lte("created_at", toIso);
          }
        }

        const [
          reqRes,
          quotesRes,
          quotesConvertedRes,
          jobsRes,
          jobsFromQuotesRes,
          jobsFromQuotesStatusesRes,
        ] = await Promise.all([reqQ, quotesQ, quotesConvertedQ, jobsQ, jobsFromQuotesQ, jobsFromQuotesStatusesQ]);

        const requests = reqRes.count ?? 0;
        const quotes = quotesRes.count ?? 0;
        const quotesConverted = quotesConvertedRes.count ?? 0;
        const jobs = jobsRes.count ?? 0;
        const jobsFromQuotes = jobsFromQuotesRes.count ?? 0;

        const top = Math.max(requests, 1);
        setSteps([
          { label: "Requests", count: requests, color: "bg-blue-400", pct: 100 },
          {
            label: "Quotes",
            count: quotes,
            color: "bg-violet-400",
            pct: Math.min(100, Math.round((quotes / top) * 100)),
          },
          {
            label: "Quotes → Jobs",
            count: jobsFromQuotes,
            color: "bg-amber-400",
            pct: quotes > 0 ? Math.min(100, Math.round((jobsFromQuotes / quotes) * 100)) : 0,
          },
          {
            label: "Jobs",
            count: jobs,
            color: "bg-emerald-400",
            pct: Math.min(100, Math.round((jobs / top) * 100)),
          },
        ]);

        const quoteToJobRate = quotes > 0 ? Math.round((jobsFromQuotes / quotes) * 1000) / 10 : 0;
        const requestsToJobsRate = requests > 0 ? Math.round((jobs / requests) * 1000) / 10 : 0;

        const statusRows = (jobsFromQuotesStatusesRes.data ?? []) as { status: string }[];
        const breakdown: Record<string, number> = {};
        for (const r of statusRows) breakdown[r.status] = (breakdown[r.status] ?? 0) + 1;
        setJobStatusBreakdown(breakdown);

        setMeta({
          requests,
          quotes,
          quotesConverted,
          jobs,
          jobsFromQuotes,
          quoteToJobRate,
          requestsToJobsRate,
        });
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [boundsKey]);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CardTitle>Request → Job Funnel</CardTitle>
            {!loading && (
              <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-800 dark:text-violet-200">
                Quotes→Jobs {meta.quoteToJobRate}% · Req→Jobs {meta.requestsToJobsRate}%
              </span>
            )}
          </div>
          <p className="text-xs text-text-tertiary">End-to-end conversion · bar width vs requests in period</p>
        </div>
      </CardHeader>
      <div className="px-5 pb-5 space-y-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-24 rounded animate-pulse bg-surface-tertiary" />
                <div className="h-7 rounded-lg animate-pulse bg-surface-hover" style={{ width: `${90 - i * 15}%` }} />
              </div>
            ))
          : steps.map((step, i) => (
              <div key={step.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{step.label}</span>
                  <span className="text-xs font-bold tabular-nums text-text-primary shrink-0">{step.pct}%</span>
                </div>
                <div className="h-7 w-full rounded-lg bg-surface-hover overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${step.pct}%` }}
                    transition={{ duration: 0.7, delay: i * 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className={`h-full rounded-lg ${step.color} flex items-center justify-center px-2 min-w-0`}
                  >
                    <span className="text-xs font-bold text-white tabular-nums drop-shadow-sm">{step.count}</span>
                  </motion.div>
                </div>
              </div>
            ))}

        {!loading && steps.length > 0 && (
          <div className="pt-2 border-t border-border-light">
            <p className="text-[10px] text-text-tertiary">
              Requests → Jobs:{" "}
              <span className="font-bold text-text-primary">{meta.requestsToJobsRate}%</span> of requests become jobs.
            </p>
            <p className="text-[10px] text-text-tertiary mt-1">
              Quotes → Jobs:{" "}
              <span className="font-bold text-text-primary">{meta.quoteToJobRate}%</span> ({meta.jobsFromQuotes}/{meta.quotes}).
            </p>

            {meta.jobsFromQuotes > 0 && Object.keys(jobStatusBreakdown).length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">Jobs from quotes by status</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(jobStatusBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([status, count]) => {
                      const pct = Math.round((count / meta.jobsFromQuotes) * 100);
                      return (
                        <div key={status} className="p-2 rounded-xl bg-surface-hover">
                          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide truncate">
                            {JOB_STATUS_LABELS[status] ?? status}
                          </p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-sm font-bold text-text-primary">{count}</p>
                            <p className="text-[10px] text-text-tertiary">{pct}%</p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
