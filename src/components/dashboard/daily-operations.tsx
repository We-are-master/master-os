"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { getSupabase } from "@/services/base";
import { cn, formatCurrency } from "@/lib/utils";
import { localCalendarMonthYmdBounds } from "@/lib/overview-dashboard-kpis";
import { jobBillableRevenue, jobDirectCost } from "@/lib/job-financials";
import type { OverviewPipelineJobRow } from "@/lib/dashboard-overview-jobs";
import { CalendarDays } from "lucide-react";

/**
 * Row shape that feeds both the full-month table and the "today only" tile row.
 * Overhead is split evenly across Mon–Sat of the current month so every
 * operational day carries a fair share of fixed costs.
 */
export interface DailyOpsRow {
  ymd: string;
  label: string;
  weekdayLabel: string;
  revenue: number;
  cost: number;
  overhead: number;
  margin: number;
  marginPct: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface DailyOpsData {
  loading: boolean;
  rows: DailyOpsRow[];
  workingDays: number;
  dailyOverhead: number;
  monthLabel: string;
  /** Pre-computed monthly aggregates for the summary band. */
  totals: {
    revenue: number;
    cost: number;
    overhead: number;
    margin: number;
    marginPct: number;
  };
}

/**
 * Fetches current-month jobs + bills + payroll, derives the daily operational
 * breakdown and exposes it to any consumer (overview tile, finance dashboard
 * full table, etc.) without duplicating query code.
 */
export function useDailyOperations(): DailyOpsData {
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<Record<string, { revenue: number; cost: number }>>({});
  const [bills, setBills] = useState(0);
  const [payroll, setPayroll] = useState(0);
  const monthLabel = useMemo(() => localCalendarMonthYmdBounds(new Date()).monthLabel, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      try {
        const { fromDay, toDay } = localCalendarMonthYmdBounds(new Date());
        const MONTHLY_STATUSES = [
          "unassigned", "auto_assigning", "scheduled", "late",
          "in_progress_phase1", "in_progress_phase2", "in_progress_phase3",
          "final_check", "awaiting_payment", "need_attention", "completed",
        ];
        const [jobsRes, billsRes, payrollRes, internalSbRes] = await Promise.all([
          supabase
            .from("jobs")
            .select("id, client_price, extras_amount, partner_cost, materials_cost, scheduled_date, scheduled_finish_date")
            .is("deleted_at", null)
            .in("status", MONTHLY_STATUSES)
            .gte("scheduled_date", fromDay)
            .lte("scheduled_date", toDay),
          supabase
            .from("bills")
            .select("amount")
            .is("archived_at", null)
            .neq("status", "rejected")
            .gte("due_date", fromDay)
            .lte("due_date", toDay),
          // Every active / onboarding payroll row at its declared amount
          // (no due_date filter — matches how People → Workforce sums them).
          supabase
            .from("payroll_internal_costs")
            .select("id, amount, lifecycle_stage")
            .neq("lifecycle_stage", "offboard"),
          // Internal self-bills — ad-hoc contractors not backed by a catalog row.
          supabase
            .from("self_bills")
            .select("internal_cost_id, net_payout")
            .eq("bill_origin", "internal")
            .not("status", "in", '("rejected","payout_cancelled","payout_archived","payout_lost")')
            .gte("week_start", fromDay)
            .lte("week_start", toDay),
        ]);
        const rows = (jobsRes.data ?? []) as OverviewPipelineJobRow[];
        const perDay: Record<string, { revenue: number; cost: number }> = {};
        for (const r of rows) {
          const day = (r.scheduled_date ?? "").slice(0, 10);
          if (!day) continue;
          if (!perDay[day]) perDay[day] = { revenue: 0, cost: 0 };
          perDay[day].revenue += jobBillableRevenue(r as Parameters<typeof jobBillableRevenue>[0]);
          perDay[day].cost += jobDirectCost(r);
        }
        const billsTotal = (billsRes.data ?? []).reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0);
        /**
         * Workforce cost = every active / onboarding payroll_internal_costs row at
         * its declared amount + ad-hoc internal self-bills for this month whose
         * internal_cost_id doesn't match a catalog row (dedup to avoid doubles).
         */
        type PayrollRow = { id?: string; amount?: number; lifecycle_stage?: string | null };
        type InternalSbRow = { internal_cost_id?: string | null; net_payout?: number };
        const payrollRows = (payrollRes.data ?? []) as PayrollRow[];
        const internalSbRows = (internalSbRes.data ?? []) as InternalSbRow[];
        const payrollIds = new Set(payrollRows.map((p) => p.id).filter(Boolean) as string[]);
        let payrollTotal = 0;
        for (const p of payrollRows) payrollTotal += Number(p.amount ?? 0);
        for (const sb of internalSbRows) {
          const linkedId = sb.internal_cost_id?.trim();
          if (!linkedId || !payrollIds.has(linkedId)) {
            payrollTotal += Number(sb.net_payout ?? 0);
          }
        }
        if (!cancelled) {
          setDaily(perDay);
          setBills(billsTotal);
          setPayroll(payrollTotal);
        }
      } catch {
        if (!cancelled) {
          setDaily({});
          setBills(0);
          setPayroll(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= lastDay; d++) {
      const wd = new Date(year, month, d).getDay();
      if (wd !== 0) workingDays++;
    }
    const overheadPool = bills + payroll;
    const dailyOverhead = workingDays > 0 ? overheadPool / workingDays : 0;
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const rows: DailyOpsRow[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const dayDate = new Date(year, month, d);
      const wd = dayDate.getDay();
      if (wd === 0) continue;
      const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const agg = daily[ymd] ?? { revenue: 0, cost: 0 };
      const margin = agg.revenue - agg.cost - dailyOverhead;
      const marginPct = agg.revenue > 0 ? Math.round((margin / agg.revenue) * 1000) / 10 : 0;
      const weekdayLabel = dayDate.toLocaleDateString(undefined, { weekday: "short" });
      rows.push({
        ymd,
        label: String(d),
        weekdayLabel,
        revenue: agg.revenue,
        cost: agg.cost,
        overhead: dailyOverhead,
        margin,
        marginPct,
        isToday: ymd === todayYmd,
        isFuture: ymd > todayYmd,
      });
    }
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalOverhead = rows.reduce((s, r) => s + r.overhead, 0);
    const totalMargin = totalRevenue - totalCost - totalOverhead;
    const totalMarginPct = totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 1000) / 10 : 0;
    return {
      loading,
      rows,
      workingDays,
      dailyOverhead,
      monthLabel,
      totals: {
        revenue: totalRevenue,
        cost: totalCost,
        overhead: totalOverhead,
        margin: totalMargin,
        marginPct: totalMarginPct,
      },
    };
  }, [daily, bills, payroll, loading, monthLabel]);
}

/**
 * Compact "today only" KPI strip for the overview page.
 * Shows Revenue / Service cost / Overhead / Margin / % just for today.
 */
export function DailyOperationsTodayTile({ data }: { data: DailyOpsData }) {
  const todayRow = data.rows.find((r) => r.isToday) ?? null;
  const revenue = todayRow?.revenue ?? 0;
  const cost = todayRow?.cost ?? 0;
  const overhead = todayRow?.overhead ?? data.dailyOverhead;
  const margin = todayRow?.margin ?? -overhead;
  const marginPct = todayRow?.marginPct ?? 0;
  const hasRevenue = revenue > 0;
  const todayLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  }, []);

  return (
    <Card padding="none" className="overflow-hidden border-border-light">
      <CardHeader className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2.5 flex-wrap">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-sky-500/10 flex items-center justify-center shrink-0">
              <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Today — {todayLabel}</CardTitle>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Quick snapshot of today&apos;s operations · full breakdown in Finance → Dashboard
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 divide-border-light sm:divide-x border-t border-border-light">
        <TodayCell
          label="Revenue"
          hint="Billable revenue on jobs scheduled for today"
          value={formatCurrency(revenue)}
          accent={hasRevenue ? "text-emerald-600" : "text-text-tertiary"}
          loading={data.loading}
        />
        <TodayCell
          label="Service cost"
          hint="Partner + materials cost on today's jobs"
          value={formatCurrency(cost)}
          accent="text-amber-600"
          loading={data.loading}
        />
        <TodayCell
          label="Overhead"
          hint={`Workforce + bills split across ${data.workingDays} working days`}
          value={formatCurrency(overhead)}
          accent="text-purple-600"
          loading={data.loading}
        />
        <TodayCell
          label="Margin"
          hint="Revenue − service cost − overhead"
          value={formatCurrency(margin)}
          accent={margin >= 0 ? "text-emerald-600" : "text-rose-600"}
          loading={data.loading}
        />
        <TodayCell
          label="Margin %"
          hint="Margin as a share of today's revenue"
          value={hasRevenue ? `${marginPct}%` : "—"}
          accent={margin >= 0 ? "text-emerald-600" : "text-rose-600"}
          loading={data.loading}
        />
      </div>
    </Card>
  );
}

function TodayCell({
  label,
  hint,
  value,
  accent,
  loading,
}: {
  label: string;
  hint: string;
  value: string;
  accent: string;
  loading: boolean;
}) {
  return (
    <div className="p-3 sm:p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide leading-tight">{label}</p>
        <FixfyHintIcon text={hint} />
      </div>
      <p className={cn("text-lg sm:text-xl font-bold tabular-nums mt-0.5", accent)}>
        {loading ? "—" : value}
      </p>
    </div>
  );
}

/**
 * Row background by performance. Hex values picked for visible-but-soft tint
 * (Tailwind's rose-50 / amber-50 / emerald-50 with opacity modifiers were too
 * faint to read on zebra-free tables — see issue from 2026-04-21 review).
 * Rows with zero revenue still carry the day's overhead, so they land in red.
 */
function rowToneClass(margin: number, marginPct: number, hasRevenue: boolean): string {
  if (!hasRevenue) return "bg-[#FDECEC]"; // soft red ~ rose-100
  if (margin < 0) return "bg-[#FDECEC]";
  if (marginPct < 20) return "bg-[#FEF5DB]"; // soft amber ~ amber-100
  return "bg-[#DFF5E8]"; // soft green ~ emerald-100
}

/**
 * Full-month Daily Operations table.
 * When `summaryPlacement="top"` a mini-dashboard of the month's totals is
 * rendered above the table — five tiles with Revenue / Cost / Overhead /
 * Margin / Margin %. When `"bottom"` the totals stay in the table's <tfoot>.
 */
export function DailyOperationsTable({
  data,
  summaryPlacement = "bottom",
}: {
  data: DailyOpsData;
  summaryPlacement?: "top" | "bottom";
}) {
  const { loading, rows, workingDays, dailyOverhead, monthLabel, totals } = data;

  const footerSummaryRow = rows.length > 0 ? (
    <tr className="bg-[#FAFAFB] border-y border-border-light">
      <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Month total</td>
      <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">
        {formatCurrency(totals.revenue)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-bold text-amber-700">
        {formatCurrency(totals.cost)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-bold text-purple-600">
        {formatCurrency(totals.overhead)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums font-bold",
          totals.margin >= 0 ? "text-emerald-700" : "text-rose-600",
        )}
      >
        {formatCurrency(totals.margin)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums font-bold",
          totals.margin >= 0 ? "text-emerald-700" : "text-rose-600",
        )}
      >
        {totals.revenue > 0 ? `${totals.marginPct}%` : "—"}
      </td>
    </tr>
  ) : null;

  return (
    <Card padding="none" className="overflow-hidden border-border-light">
      <CardHeader className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2.5 flex-wrap">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-sky-500/10 flex items-center justify-center shrink-0">
              <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-sm font-semibold">Daily Operations — {monthLabel}</CardTitle>
              <FixfyHintIcon
                text={`Revenue, service cost and daily overhead · Mon–Sat · overhead split evenly across ${workingDays} working days`}
              />
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary whitespace-nowrap">
            Overhead · <span className="tabular-nums font-semibold text-text-secondary">{formatCurrency(dailyOverhead)}</span>/day
          </p>
        </div>
      </CardHeader>

      {/* Mini-dash: month-level KPIs above the table (top placement only). */}
      {summaryPlacement === "top" ? (
        <MonthTotalsDash totals={totals} loading={loading} />
      ) : null}

      {/* Health insights live as part of the header region (grouped with the
          month title + month totals) so breakeven / healthy-target context sits
          right next to the numbers it's derived from. */}
      {!loading && rows.length > 0 ? <InsightsStrip totals={totals} /> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="bg-[#FAFAFB] border-y border-border-light">
              <th className="text-left px-3 py-2 font-semibold text-text-tertiary uppercase tracking-wide text-[10px]">Day</th>
              <th className="text-right px-3 py-2 font-semibold text-text-tertiary uppercase tracking-wide text-[10px]">Revenue</th>
              <th className="text-right px-3 py-2 font-semibold text-text-tertiary uppercase tracking-wide text-[10px]">Service cost</th>
              <th className="text-right px-3 py-2 font-semibold text-text-tertiary uppercase tracking-wide text-[10px]">Overhead</th>
              <th className="text-right px-3 py-2 font-semibold text-text-tertiary uppercase tracking-wide text-[10px]">Margin</th>
              <th className="text-right px-3 py-2 font-semibold text-text-tertiary uppercase tracking-wide text-[10px]">%</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border-light/60 last:border-0">
                  <td colSpan={6} className="px-3 py-2">
                    <div className="h-5 animate-pulse rounded bg-surface-hover" />
                  </td>
                </tr>
              ))
            ) : (
              rows.map((r) => {
                const marginPositive = r.margin >= 0;
                const hasRevenue = r.revenue > 0;
                const tone = rowToneClass(r.margin, r.marginPct, hasRevenue);
                return (
                  <tr
                    key={r.ymd}
                    className={cn(
                      "border-b border-border-light/60 last:border-0",
                      tone,
                      r.isFuture && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-surface-hover text-[10px] font-semibold text-text-secondary tabular-nums">
                          {r.label}
                        </span>
                        <span className="text-[11px] text-text-tertiary">{r.weekdayLabel}</span>
                        {r.isToday ? (
                          <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wide">Today</span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums font-semibold",
                        hasRevenue ? "text-emerald-700" : "text-text-tertiary",
                      )}
                    >
                      {formatCurrency(r.revenue)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{formatCurrency(r.cost)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-purple-600">{formatCurrency(r.overhead)}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums font-semibold",
                        marginPositive ? "text-emerald-700" : "text-rose-600",
                      )}
                    >
                      {formatCurrency(r.margin)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums text-[11px] font-semibold",
                        marginPositive ? "text-emerald-700" : "text-rose-600",
                      )}
                    >
                      {hasRevenue ? `${r.marginPct}%` : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {summaryPlacement === "bottom" && !loading && footerSummaryRow ? (
            <tfoot>{footerSummaryRow}</tfoot>
          ) : null}
        </table>
      </div>
    </Card>
  );
}

/**
 * Compact row of health metrics below the table:
 *  - Breakeven revenue      = overhead / (1 − service-cost ratio)
 *  - Gap to breakeven       = breakeven − current revenue (positive = still short)
 *  - Healthy target (40%)   = overhead / (1 − service-cost ratio − 0.40)
 *  - Daily to healthy       = healthy target / working days remaining context
 *
 * All ratios are derived from the same month totals the table shows so the
 * strip moves with the view — no extra fetches.
 */
export function HealthInsightsStrip({
  totals,
  compact = false,
}: {
  totals: DailyOpsData["totals"];
  /** Compact mode strips the card chrome so callers can embed in their own section. */
  compact?: boolean;
}) {
  return <InsightsStripInner totals={totals} compact={compact} />;
}

function InsightsStrip({ totals }: { totals: DailyOpsData["totals"] }) {
  return <InsightsStripInner totals={totals} compact={false} />;
}

function InsightsStripInner({
  totals,
  compact,
}: {
  totals: DailyOpsData["totals"];
  compact: boolean;
}) {
  const serviceCostRatio = totals.revenue > 0 ? totals.cost / totals.revenue : 0;
  const scrCapped = Math.min(0.95, Math.max(0, serviceCostRatio));
  const breakevenDenom = 1 - scrCapped;
  const breakevenRevenue = breakevenDenom > 0.01 ? totals.overhead / breakevenDenom : 0;
  const healthyDenom = 1 - scrCapped - 0.40;
  const healthyRevenue = healthyDenom > 0.01 ? totals.overhead / healthyDenom : 0;
  const gapToBreakeven = breakevenRevenue - totals.revenue;
  const gapToHealthy = healthyRevenue - totals.revenue;
  const past = gapToBreakeven <= 0;

  return (
    <div
      className={cn(
        compact
          ? "rounded-2xl border border-border-light bg-gradient-to-r from-emerald-500/[0.04] via-card to-rose-500/[0.04] px-3 py-2 sm:px-4"
          : "border-t border-border-light bg-gradient-to-r from-[#FAFAFB] via-card to-[#FAFAFB] px-3 py-2.5 sm:px-4",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5 flex items-center gap-1.5">
        Health insights
        <FixfyHintIcon text="Derived from the month totals above. Service-cost ratio is kept as-is, overhead is treated as fixed; healthy target assumes a 40% net margin after service cost and overhead." />
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InsightCell
          label="Breakeven revenue"
          value={breakevenRevenue > 0 ? formatCurrency(breakevenRevenue) : "—"}
          hint={`Revenue required so net margin hits zero given current service-cost ratio (${Math.round(scrCapped * 1000) / 10}%)`}
          accent="text-[#020040]"
        />
        <InsightCell
          label={past ? "Past breakeven by" : "Gap to breakeven"}
          value={
            breakevenRevenue <= 0
              ? "—"
              : past
                ? `+${formatCurrency(Math.abs(gapToBreakeven))}`
                : formatCurrency(gapToBreakeven)
          }
          hint={
            past
              ? "You've already covered costs this month. Everything above is real margin."
              : "Revenue still needed this month to cover service cost + overhead."
          }
          accent={past ? "text-emerald-700" : "text-rose-600"}
        />
        <InsightCell
          label="Healthy target · 40% margin"
          value={healthyRevenue > 0 ? formatCurrency(healthyRevenue) : "—"}
          hint="Revenue required to hit a 40% net margin after service cost and overhead — use as a stretch goal for monthly faturamento."
          accent="text-emerald-700"
        />
        <InsightCell
          label="Gap to healthy"
          value={
            healthyRevenue <= 0
              ? "—"
              : gapToHealthy > 0
                ? formatCurrency(gapToHealthy)
                : `+${formatCurrency(Math.abs(gapToHealthy))}`
          }
          hint={
            gapToHealthy > 0
              ? "Additional revenue needed this month to reach the 40% margin target."
              : "You're already past the healthy target — the company is running above the 40% margin mark."
          }
          accent={gapToHealthy > 0 ? "text-amber-700" : "text-emerald-700"}
        />
      </div>
    </div>
  );
}

function InsightCell({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary truncate">
          {label}
        </p>
        <FixfyHintIcon text={hint} />
      </div>
      <p className={cn("text-sm font-bold tabular-nums leading-tight mt-0.5", accent)}>{value}</p>
    </div>
  );
}

/**
 * 5-tile strip showing month aggregates, rendered above the full daily table
 * when `summaryPlacement="top"`. Mirrors the Today tile visual language so the
 * overview reads as one coherent block.
 */
function MonthTotalsDash({
  totals,
  loading,
}: {
  totals: DailyOpsData["totals"];
  loading: boolean;
}) {
  const marginPositive = totals.margin >= 0;
  const hasRevenue = totals.revenue > 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 divide-border-light sm:divide-x border-y border-border-light bg-[#FAFAFB]">
      <TotalCell
        label="Month revenue"
        hint="Billable revenue summed across the current calendar month"
        value={formatCurrency(totals.revenue)}
        accent="text-emerald-700"
        loading={loading}
      />
      <TotalCell
        label="Service cost"
        hint="Partner + materials cost on jobs scheduled this month"
        value={formatCurrency(totals.cost)}
        accent="text-amber-700"
        loading={loading}
      />
      <TotalCell
        label="Overhead"
        hint="Workforce + bills allocated across working days"
        value={formatCurrency(totals.overhead)}
        accent="text-purple-600"
        loading={loading}
      />
      <TotalCell
        label="Margin"
        hint="Revenue − service cost − overhead"
        value={formatCurrency(totals.margin)}
        accent={marginPositive ? "text-emerald-700" : "text-rose-600"}
        loading={loading}
      />
      <TotalCell
        label="Margin %"
        hint="Margin as a share of month revenue"
        value={hasRevenue ? `${totals.marginPct}%` : "—"}
        accent={marginPositive ? "text-emerald-700" : "text-rose-600"}
        loading={loading}
      />
    </div>
  );
}

function TotalCell({
  label,
  hint,
  value,
  accent,
  loading,
}: {
  label: string;
  hint: string;
  value: string;
  accent: string;
  loading: boolean;
}) {
  return (
    <div className="p-3 sm:p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide leading-tight">{label}</p>
        <FixfyHintIcon text={hint} />
      </div>
      <p className={cn("text-base sm:text-lg font-bold tabular-nums mt-0.5", accent)}>
        {loading ? "—" : value}
      </p>
    </div>
  );
}
