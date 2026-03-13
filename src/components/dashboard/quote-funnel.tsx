"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { motion } from "framer-motion";

interface FunnelStep {
  label: string;
  count: number;
  color: string;
  pct: number;
}

export function QuoteFunnel() {
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const [reqRes, quoteRes, jobRes] = await Promise.all([
          supabase.from("service_requests").select("id", { count: "exact" }),
          supabase.from("quotes").select("id, status"),
          supabase.from("jobs").select("id", { count: "exact" }),
        ]);

        const requests = reqRes.count ?? 0;
        const quotes = (quoteRes.data ?? []).length;
        const approvedQuotes = (quoteRes.data ?? []).filter((q: { status: string }) => ["approved", "in_progress"].includes(q.status)).length;
        const jobs = jobRes.count ?? 0;

        const top = Math.max(requests, 1);
        setSteps([
          { label: "Requests",        count: requests,       color: "bg-blue-400",    pct: 100 },
          { label: "Quotes",          count: quotes,         color: "bg-violet-400",  pct: Math.round((quotes / top) * 100) },
          { label: "Quotes Approved", count: approvedQuotes, color: "bg-amber-400",   pct: Math.round((approvedQuotes / top) * 100) },
          { label: "Jobs",            count: jobs,           color: "bg-emerald-400", pct: Math.round((jobs / top) * 100) },
        ]);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Request → Job Funnel</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">End-to-end conversion</p>
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
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{step.label}</span>
                  <span className="text-xs font-bold text-text-primary">{step.count}</span>
                </div>
                <div className="h-7 w-full rounded-lg bg-surface-hover overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${step.pct}%` }}
                    transition={{ duration: 0.7, delay: i * 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className={`h-full rounded-lg ${step.color} flex items-center px-2`}
                  >
                    <span className="text-[10px] font-bold text-white">{step.pct}%</span>
                  </motion.div>
                </div>
              </div>
            ))}

        {!loading && steps.length > 0 && (
          <div className="pt-2 border-t border-border-light">
            <p className="text-[10px] text-text-tertiary">
              Overall conversion:{" "}
              <span className="font-bold text-text-primary">
                {steps[0].count > 0 ? Math.round(((steps[3]?.count ?? 0) / steps[0].count) * 100) : 0}%
              </span>
              {" "}of requests become jobs.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
