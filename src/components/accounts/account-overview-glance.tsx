"use client";

import { useMemo } from "react";
import {
  accountRelationshipRevenueTotal,
  computeAccountRelationshipInsights,
  sumLegacyRevenue,
} from "@/lib/account-insights";
import { formatCurrency } from "@/lib/utils";
import type { Account, AccountLegacyYearlyStat, Job } from "@/types/database";
import { Briefcase, Loader2, TrendingUp } from "lucide-react";

interface AccountOverviewGlanceProps {
  account: Account;
  jobs: Job[];
  legacyRows: AccountLegacyYearlyStat[];
  loading?: boolean;
  invoicedAmt: number;
  awaitingAmt: number;
  overdueAmt: number;
}

export function AccountOverviewGlance({
  account,
  jobs,
  legacyRows,
  loading = false,
  invoicedAmt,
  awaitingAmt,
  overdueAmt,
}: AccountOverviewGlanceProps) {
  const legacyRevenue = sumLegacyRevenue(legacyRows);
  const totalRevenue = accountRelationshipRevenueTotal(account.total_revenue, legacyRevenue);

  const insights = useMemo(
    () =>
      computeAccountRelationshipInsights({
        legacyRows,
        jobs,
        accountCreatedAt: account.created_at,
      }),
    [legacyRows, jobs, account.created_at],
  );

  const customerSince =
    insights.customerSinceYear != null ? String(insights.customerSinceYear) : "—";

  return (
    <div className="rounded-2xl border border-border-light bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">
            At a glance
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold tabular-nums text-text-primary leading-none">
              {formatCurrency(totalRevenue)}
            </p>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" /> : null}
          </div>
          <p className="text-xs text-text-tertiary mt-1.5">
            Total revenue with Fixfy
            {legacyRevenue > 0 ? (
              <span className="text-text-secondary">
                {" "}
                · incl. {formatCurrency(legacyRevenue)} pre–Master OS
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#020040]/5 px-3 py-1 text-xs font-medium text-[#020040]">
          <Briefcase className="h-3.5 w-3.5 shrink-0" />
          <span className="tabular-nums">{insights.totalJobsAllTime}</span> jobs
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary/80 px-3 py-1 text-xs font-medium text-text-secondary">
          Since <span className="tabular-nums font-semibold">{customerSince}</span>
        </span>
        {insights.avgTicket > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ED4B00]/8 px-3 py-1 text-xs font-medium text-[#ED4B00]">
            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
            <span className="tabular-nums">{formatCurrency(insights.avgTicket)}</span> avg
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
          <span className="tabular-nums font-semibold">{account.active_jobs}</span> active
        </span>
      </div>

      <div className="h-[2px] rounded-full bg-[#ED4B00]/70" />

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">
          Master OS · Billable {formatCurrency(account.total_revenue)}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#020040] shrink-0" />
            Invoiced <strong className="tabular-nums text-text-primary">{formatCurrency(invoicedAmt)}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
            Awaiting <strong className="tabular-nums text-text-primary">{formatCurrency(awaitingAmt)}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
            Overdue <strong className="tabular-nums text-text-primary">{formatCurrency(overdueAmt)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
