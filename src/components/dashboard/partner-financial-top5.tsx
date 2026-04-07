"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency, cn } from "@/lib/utils";
import { Banknote, PiggyBank, Star } from "lucide-react";
import { useDashboardDateRangeOptional } from "@/hooks/use-dashboard-date-range";
import { jobProfit, partnerPaymentCap } from "@/lib/job-financials";
import { fetchPipelineJobsForDashboard } from "@/lib/dashboard-overview-jobs";
import type { Job } from "@/types/database";

type JobRow = Pick<Job, "partner_name" | "client_price" | "extras_amount" | "partner_cost" | "materials_cost" | "partner_agreed_value">;

interface PartnerAgg {
  name: string;
  payout: number;
  margin: number;
  jobCount: number;
}

function aggregate(rows: JobRow[]): Map<string, PartnerAgg> {
  const map = new Map<string, PartnerAgg>();
  for (const raw of rows) {
    const name = raw.partner_name?.trim();
    if (!name) continue;
    const j = raw as Job;
    const row = map.get(name) ?? { name, payout: 0, margin: 0, jobCount: 0 };
    row.jobCount += 1;
    row.payout += partnerPaymentCap(j);
    row.margin += jobProfit(j);
    map.set(name, row);
  }
  return map;
}

type Variant = "payout" | "margin";

function PartnerFinancialTop5Inner({ variant }: { variant: Variant }) {
  const [rows, setRows] = useState<PartnerAgg[]>([]);
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
        const b = dateCtx?.bounds ?? null;
        const pipeline = await fetchPipelineJobsForDashboard(supabase, b);
        const jobs = pipeline.filter((r) => Boolean(r.partner_name?.trim())) as unknown as JobRow[];
        const map = aggregate(jobs);
        const key: "payout" | "margin" = variant;
        const list = Array.from(map.values())
          .sort((a, b) => b[key] - a[key])
          .slice(0, 5);
        setRows(list);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [boundsKey, dateCtx, variant]);

  const metric = variant === "payout" ? "payout" : "margin";
  const maxVal = Math.max(...rows.map((r) => r[metric]), 1);
  const isPayout = variant === "payout";

  return (
    <Card padding="none" className="h-full min-h-0 flex flex-col">
      <CardHeader className="px-5 pt-4 shrink-0 mb-0 flex flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{isPayout ? "Partner payout · Top 5" : "Company margin · Top 5"}</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {isPayout
              ? "Partner cost / agreed payout per partner"
              : "Revenue after partner payout & materials"}
            {dateCtx?.bounds ? " · schedule start in range" : ""}
          </p>
        </div>
        {isPayout ? (
          <Banknote className="h-4 w-4 text-text-tertiary shrink-0" />
        ) : (
          <PiggyBank className="h-4 w-4 text-text-tertiary shrink-0" />
        )}
      </CardHeader>
      <div className="px-5 pb-5 space-y-2 flex-1 min-h-0 flex flex-col">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="h-7 w-7 rounded-full animate-pulse bg-surface-tertiary flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-28 animate-pulse bg-surface-tertiary rounded" />
                  <div className="h-2 w-full animate-pulse bg-surface-hover rounded-full" />
                </div>
                <div className="h-3 w-16 animate-pulse bg-surface-tertiary rounded" />
              </div>
            ))
          : rows.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-text-tertiary">No partner jobs in this period</p>
              </div>
            )
          : rows.map((partner, i) => {
              const v = partner[metric];
              return (
                <div key={partner.name} className="flex items-center gap-3 py-1.5 group">
                  <div
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold",
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : i === 1
                          ? "bg-slate-100 text-slate-600"
                          : i === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-surface-hover text-text-tertiary",
                    )}
                  >
                    {i === 0 ? <Star className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <p className="text-xs font-semibold text-text-primary truncate">{partner.name}</p>
                      <p
                        className={cn(
                          "text-xs font-bold tabular-nums flex-shrink-0",
                          isPayout ? "text-rose-600" : "text-emerald-600",
                        )}
                      >
                        {formatCurrency(v)}
                      </p>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-700",
                          isPayout ? "bg-rose-500/80" : "bg-emerald-500/80",
                        )}
                        style={{ width: `${(v / maxVal) * 100}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-text-tertiary mt-0.5">{partner.jobCount} jobs</p>
                  </div>
                </div>
              );
            })}
      </div>
    </Card>
  );
}

export function PartnerPayoutTop5() {
  return <PartnerFinancialTop5Inner variant="payout" />;
}

export function PartnerMarginTop5() {
  return <PartnerFinancialTop5Inner variant="margin" />;
}
