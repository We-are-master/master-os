"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { getSupabase } from "@/services/base";
import { cn, formatCurrency } from "@/lib/utils";
import { localCalendarMonthYmdBounds } from "@/lib/overview-dashboard-kpis";
import { jobBillableRevenue, jobDirectCost } from "@/lib/job-financials";
import type { OverviewPipelineJobRow } from "@/lib/dashboard-overview-jobs";
import { CalendarDays, ArrowUp, ArrowDown } from "lucide-react";

/**
 * Fixfy brand palette — locked to 5 colors. Any new accent must re-use these.
 *   NEUTRAL  #1C1917  — values, neutral text
 *   NAVY     #020040  — labels, primary emphasis
 *   ORANGE   #ED4B00  — below-target warnings, gap to healthy
 *   GREEN    #2B9966  — profit / success / healthy (brand green)
 *   RED      #ED073F  — losses / overdue (brand red)
 *
 * Soft tints (profitBg / lossBg / warnBg / profitBorder / lossBorder) are
 * sampled from the brand green/red at ~95% lightness so row/tile
 * backgrounds read as the same family, not as arbitrary pastel.
 */
const PALETTE = {
  neutral: "#1C1917",
  navy: "#020040",
  orange: "#ED4B00",
  green: "#2B9966",
  red: "#ED073F",
  subtleGray: "#6B6B70",
  profitBg: "#E8F4EE",
  profitBgHover: "#DEEEE4",
  profitBorder: "#A5D8BE",
  lossBg: "#FEEBEF",
  lossBgHover: "#FBD9E0",
  lossBorder: "#F4A8B8",
  warnBg: "#FFF4ED",
  railBg: "#F5F5F7",
} as const;

/** Target net margin used as the "healthy" threshold everywhere in this view. */
const TARGET_MARGIN_PCT = 40;

/**
 * Split a formatted currency string into its main and decimal parts so the
 * decimals can be rendered smaller/dimmer next to the headline figure. Works
 * with the locale-formatted output of `formatCurrency` (e.g. "£14,770.71").
 */
function splitCurrency(n: number): { main: string; decimal: string } {
  const formatted = formatCurrency(n);
  const m = formatted.match(/^(.+?)(\.\d+)$/);
  if (!m) return { main: formatted, decimal: "" };
  return { main: m[1] ?? formatted, decimal: m[2] ?? "" };
}

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
  /** Short label for the previous month (e.g. "Mar") used in MoM trend text. */
  prevMonthLabel: string;
  /** Billable revenue for the previous calendar month — powers the MoM trend. */
  prevMonthRevenue: number;
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
  const [prevMonthRevenue, setPrevMonthRevenue] = useState(0);
  const monthLabel = useMemo(() => localCalendarMonthYmdBounds(new Date()).monthLabel, []);
  const prevMonthLabel = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString(undefined, { month: "short" });
  }, []);
  const prevBounds = useMemo(() => {
    const d = new Date();
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return localCalendarMonthYmdBounds(prev);
  }, []);

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
        const [jobsRes, billsRes, payrollRes, internalSbRes, prevJobsRes] = await Promise.all([
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
          // Previous calendar month revenue — purely for the MoM trend arrow
          // on the Month revenue KPI. No new formula, same jobBillableRevenue
          // logic applied to a different date window.
          supabase
            .from("jobs")
            .select("client_price, extras_amount, partner_cost, materials_cost, scheduled_date")
            .is("deleted_at", null)
            .in("status", MONTHLY_STATUSES)
            .gte("scheduled_date", prevBounds.fromDay)
            .lte("scheduled_date", prevBounds.toDay),
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
        let prevRev = 0;
        for (const r of (prevJobsRes.data ?? []) as OverviewPipelineJobRow[]) {
          prevRev += jobBillableRevenue(r as Parameters<typeof jobBillableRevenue>[0]);
        }
        if (!cancelled) {
          setDaily(perDay);
          setBills(billsTotal);
          setPayroll(payrollTotal);
          setPrevMonthRevenue(prevRev);
        }
      } catch {
        if (!cancelled) {
          setDaily({});
          setBills(0);
          setPayroll(0);
          setPrevMonthRevenue(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // prevBounds is derived from `new Date()` at mount and is stable by design —
    // the hook deliberately captures "the calendar month at component mount"
    // so rerunning as the clock ticks past midnight isn't desired here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      prevMonthLabel,
      prevMonthRevenue,
      totals: {
        revenue: totalRevenue,
        cost: totalCost,
        overhead: totalOverhead,
        margin: totalMargin,
        marginPct: totalMarginPct,
      },
    };
  }, [daily, bills, payroll, loading, monthLabel, prevMonthLabel, prevMonthRevenue]);
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

/** State bucket for the Margin / Margin % KPI tiles and table row tinting. */
type MarginState = "loss" | "belowTarget" | "healthy";

function classifyMargin(margin: number, marginPct: number): MarginState {
  if (margin < 0) return "loss";
  if (marginPct < TARGET_MARGIN_PCT) return "belowTarget";
  return "healthy";
}

/**
 * Row background for the daily breakdown table. Kept simple — profit vs loss
 * vs break-even (rare). "Below target but positive" days still read as profit
 * rows; the KPI tile on top handles the "below 40%" warning state.
 */
function rowBgColor(margin: number, hasRevenue: boolean): string {
  if (!hasRevenue || margin < 0) return PALETTE.lossBg;
  if (margin === 0) return "transparent";
  return PALETTE.profitBg;
}

function rowHoverBgColor(margin: number, hasRevenue: boolean): string {
  if (!hasRevenue || margin < 0) return PALETTE.lossBgHover;
  if (margin === 0) return "#FAFAFB";
  return PALETTE.profitBgHover;
}

/**
 * Full-month Daily Operations table.
 * When `summaryPlacement="top"` a mini-dashboard of the month's totals is
 * rendered above the table — five tiles with Revenue / Cost / Overhead /
 * Margin / Margin %. When `"bottom"` the totals stay in the table's <tfoot>.
 */
export function DailyOperationsTable({
  data,
  summaryPlacement = "top",
}: {
  data: DailyOpsData;
  summaryPlacement?: "top" | "bottom";
}) {
  const { loading, rows, workingDays, dailyOverhead, monthLabel, totals, prevMonthLabel, prevMonthRevenue } = data;

  /** Day-level stats (only past days count — future slots shouldn't skew the scoreboard). */
  const pastRows = rows.filter((r) => !r.isFuture);
  const profitDays = pastRows.filter((r) => r.margin > 0).length;
  // Zero-revenue days still carry overhead, so their margin is already negative.
  const lossDays = pastRows.filter((r) => r.margin < 0).length;
  const bestDay = pastRows.reduce<DailyOpsRow | null>(
    (best, r) => (r.margin > (best?.margin ?? -Infinity) ? r : best),
    null,
  );

  /** Month-over-month trend on revenue — undefined while prev fetch is loading. */
  const trendPct = prevMonthRevenue > 0
    ? Math.round(((totals.revenue - prevMonthRevenue) / prevMonthRevenue) * 1000) / 10
    : null;

  const marginState = classifyMargin(totals.margin, totals.marginPct);
  const gapPp = Math.round((totals.marginPct - TARGET_MARGIN_PCT) * 10) / 10;

  return (
    <Card padding="none" className="overflow-hidden border-border-light">
      {/* Header — mirrors DailyOperationsTodayTile structure for visual consistency */}
      <CardHeader className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2.5 flex-wrap">
          <div className="flex items-start gap-2.5 min-w-0">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: PALETTE.profitBg }}
            >
              <CalendarDays className="h-3.5 w-3.5" style={{ color: PALETTE.green }} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-semibold">
                  Daily Operations <span className="text-text-tertiary font-normal">· {monthLabel}</span>
                </CardTitle>
                <FixfyHintIcon
                  text={`Revenue, service cost and daily overhead · Mon–Sat · overhead split evenly across ${workingDays} working days`}
                />
              </div>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Overhead <span className="tabular-nums font-semibold text-text-primary">{formatCurrency(dailyOverhead)}/day</span> · based on fixed monthly costs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: PALETTE.profitBg, border: `1px solid ${PALETTE.profitBorder}` }}
                aria-hidden
              />
              Profit day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: PALETTE.lossBg, border: `1px solid ${PALETTE.lossBorder}` }}
                aria-hidden
              />
              Loss day
            </span>
          </div>
        </div>
      </CardHeader>

      {/* 5-KPI grid (top placement only). Desktop: 5 cols; tablet: 3+2; mobile: 2-col stack. */}
      {summaryPlacement === "top" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 divide-border-light lg:divide-x border-t border-border-light">
          {/* Month revenue */}
          <KpiTile
            label="Month revenue"
            hint="Billable revenue summed across jobs scheduled in the current calendar month"
            loading={loading}
            value={totals.revenue}
            subtitle={
              trendPct != null ? (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium"
                  style={{ color: trendPct >= 0 ? PALETTE.green : PALETTE.red }}
                >
                  {trendPct >= 0 ? (
                    <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
                  ) : (
                    <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
                  )}
                  <span className="tabular-nums">
                    {trendPct >= 0 ? "+" : ""}
                    {trendPct}%
                  </span>
                  <span style={{ color: PALETTE.subtleGray }}>vs {prevMonthLabel}</span>
                </span>
              ) : (
                <span style={{ color: PALETTE.subtleGray }}>Jobs scheduled in {monthLabel}</span>
              )
            }
          />
          {/* Service cost */}
          <KpiTile
            label="Service cost"
            hint="Partner + materials cost on jobs scheduled this month"
            loading={loading}
            value={totals.cost}
            subtitle={
              <span style={{ color: PALETTE.subtleGray }}>
                {totals.revenue > 0 ? `${Math.round((totals.cost / totals.revenue) * 1000) / 10}%` : "—"} of revenue
              </span>
            }
          />
          {/* Overhead */}
          <KpiTile
            label="Overhead"
            hint="Workforce + bills allocated across working days"
            loading={loading}
            value={totals.overhead}
            subtitle={
              <span style={{ color: PALETTE.subtleGray }}>
                {workingDays} days × {formatCurrency(dailyOverhead)}
              </span>
            }
          />
          {/* Margin — state-tinted */}
          <KpiTile
            label="Margin"
            hint="Revenue − service cost − overhead"
            loading={loading}
            value={totals.margin}
            signed
            state={marginState}
            subtitle={
              <span style={{ color: marginStateColor(marginState) }} className="font-medium">
                {marginState === "loss"
                  ? "Operating at a loss"
                  : marginState === "belowTarget"
                    ? "Below target"
                    : "Healthy"}
              </span>
            }
          />
          {/* Margin % — same state as Margin */}
          <KpiTile
            label="Margin %"
            hint={`Margin as a share of month revenue · target ${TARGET_MARGIN_PCT}%`}
            loading={loading}
            value={totals.marginPct}
            valueFormatter={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`}
            state={marginState}
            subtitle={
              <span style={{ color: marginStateColor(marginState) }}>
                Target {TARGET_MARGIN_PCT}% · gap {gapPp >= 0 ? "+" : ""}
                {gapPp}pp
              </span>
            }
          />
        </div>
      ) : null}

      {/* Health insights — grouped in the same card as the KPIs + table. */}
      {!loading && rows.length > 0 ? (
        <HealthInsightsPanel
          totals={totals}
          profitDays={profitDays}
          lossDays={lossDays}
          bestDay={bestDay}
        />
      ) : null}

      {/* Daily breakdown table */}
      <div className="overflow-x-auto border-t border-border-light">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="bg-surface-secondary border-b border-border-light">
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[9px]" style={{ color: PALETTE.subtleGray }}>Day</th>
              <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[9px]" style={{ color: PALETTE.subtleGray }}>Revenue</th>
              <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[9px]" style={{ color: PALETTE.subtleGray }}>Service cost</th>
              <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[9px]" style={{ color: PALETTE.subtleGray }}>Overhead</th>
              <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[9px]" style={{ color: PALETTE.subtleGray }}>Margin</th>
              <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[9px]" style={{ color: PALETTE.subtleGray }}>%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-3 py-2">
                    <div className="h-5 animate-pulse rounded bg-surface-hover" />
                  </td>
                </tr>
              ))
            ) : (
              rows.map((r) => <DayRow key={r.ymd} row={r} />)
            )}
          </tbody>
          {summaryPlacement === "bottom" && !loading && rows.length > 0 ? (
            <tfoot>
              <tr className="bg-surface-secondary border-t border-border-light">
                <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: PALETTE.subtleGray }}>Month total</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: PALETTE.neutral }}>
                  {formatCurrency(totals.revenue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: PALETTE.neutral }}>
                  {formatCurrency(totals.cost)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: PALETTE.neutral }}>
                  {formatCurrency(totals.overhead)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums font-semibold"
                  style={{ color: totals.margin >= 0 ? PALETTE.green : PALETTE.red }}
                >
                  {formatCurrency(totals.margin)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums font-semibold"
                  style={{ color: totals.margin >= 0 ? PALETTE.green : PALETTE.red }}
                >
                  {totals.revenue > 0 ? `${totals.marginPct}%` : "—"}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </Card>
  );
}

/** Map margin state to the right accent color from the locked palette. */
function marginStateColor(state: MarginState): string {
  if (state === "loss") return PALETTE.red;
  if (state === "belowTarget") return PALETTE.orange;
  return PALETTE.green;
}

/** Background tint applied to Margin / Margin % tiles to reinforce state. */
function marginStateBg(state: MarginState): string {
  if (state === "loss") return PALETTE.lossBg;
  if (state === "belowTarget") return PALETTE.warnBg;
  return PALETTE.profitBg;
}

/**
 * KPI tile used in the 5-cell grid. Value is rendered with a small bump in
 * font size for the main integer part and a dimmer ".XX" decimal to match the
 * Fixfy number hierarchy (figure first, decimal second).
 */
function KpiTile({
  label,
  hint,
  value,
  subtitle,
  loading,
  signed,
  state,
  valueFormatter,
}: {
  label: string;
  hint: string;
  value: number;
  subtitle: React.ReactNode;
  loading: boolean;
  /** Render negatives as "−£X"; default false. */
  signed?: boolean;
  /** Apply margin-state tinting (bg + color). */
  state?: MarginState;
  /** For non-currency KPIs (e.g. Margin %). Receives raw numeric value. */
  valueFormatter?: (v: number) => string;
}) {
  const color = state ? marginStateColor(state) : PALETTE.neutral;
  const bg = state ? marginStateBg(state) : "transparent";

  let mainText: string;
  let decimalText = "";
  if (valueFormatter) {
    mainText = valueFormatter(value);
  } else if (signed && value < 0) {
    const parts = splitCurrency(Math.abs(value));
    mainText = "−" + parts.main;
    decimalText = parts.decimal;
  } else {
    const parts = splitCurrency(value);
    mainText = parts.main;
    decimalText = parts.decimal;
  }

  return (
    <div className="px-3.5 py-3" style={{ background: bg }}>
      <div className="flex items-center gap-1">
        <p
          className="text-[9px] font-medium uppercase tracking-wide"
          style={{ color: PALETTE.subtleGray }}
        >
          {label}
        </p>
        <FixfyHintIcon text={hint} />
      </div>
      <p
        className="mt-1 tabular-nums font-semibold leading-none"
        style={{ color, fontSize: 18, letterSpacing: "-0.3px" }}
      >
        {loading ? (
          <span style={{ color: PALETTE.subtleGray }}>—</span>
        ) : (
          <>
            {mainText}
            {decimalText && (
              <span
                className="font-medium"
                style={{ fontSize: 12, color: state ? color : PALETTE.subtleGray }}
              >
                {decimalText}
              </span>
            )}
          </>
        )}
      </p>
      <p className="mt-1 text-[10px] leading-tight">{loading ? "" : subtitle}</p>
    </div>
  );
}

/**
 * Single daily row. Row background + margin color keyed off the Fixfy palette.
 * Uses inline styles (rather than Tailwind arbitrary hex) so the palette can
 * be swapped from one constant.
 */
function DayRow({ row }: { row: DailyOpsRow }) {
  const [hover, setHover] = useState(false);
  const hasRevenue = row.revenue > 0;
  const marginPositive = row.margin > 0;
  const marginNeutral = row.margin === 0;
  const bg = hover ? rowHoverBgColor(row.margin, hasRevenue) : rowBgColor(row.margin, hasRevenue);
  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: bg,
        opacity: row.isFuture ? 0.55 : 1,
      }}
    >
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span
            className="tabular-nums text-[11px]"
            style={{ color: PALETTE.subtleGray, minWidth: 16, textAlign: "right" }}
          >
            {row.label}
          </span>
          <span className="text-[12px] font-semibold" style={{ color: PALETTE.neutral }}>
            {row.weekdayLabel}
          </span>
          {row.isToday ? (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded"
              style={{ color: PALETTE.orange, background: PALETTE.warnBg }}
            >
              Today
            </span>
          ) : null}
        </div>
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums"
        style={{ color: hasRevenue ? PALETTE.neutral : PALETTE.subtleGray, fontWeight: 500 }}
      >
        {formatCurrency(row.revenue)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: PALETTE.neutral }}>
        {formatCurrency(row.cost)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: PALETTE.neutral }}>
        {formatCurrency(row.overhead)}
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums"
        style={{
          color: marginNeutral ? PALETTE.neutral : marginPositive ? PALETTE.green : PALETTE.red,
          fontWeight: marginNeutral ? 500 : 600,
        }}
      >
        {marginPositive
          ? formatCurrency(row.margin)
          : row.margin < 0
            ? "−" + formatCurrency(Math.abs(row.margin))
            : formatCurrency(row.margin)}
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums text-[11px]"
        style={{
          color: marginNeutral ? PALETTE.neutral : marginPositive ? PALETTE.green : PALETTE.red,
          fontWeight: 600,
        }}
      >
        {hasRevenue ? `${row.marginPct > 0 ? "+" : row.marginPct < 0 ? "−" : ""}${Math.abs(row.marginPct)}%` : "—"}
      </td>
    </tr>
  );
}

/**
 * Health Insights panel — rendered inside the Daily Operations card, between
 * the KPI grid and the daily table.
 *
 * Shape:
 *   [HEALTH INSIGHTS]           Profit days X · Loss days Y · Best day Z
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ CURRENT £X   BREAKEVEN £X   HEALTHY (40%) £X   ±£Y to breakeven   │
 *   │ ▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                     │
 *   │          │ breakeven marker                                        │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Formulas are unchanged (same as before): breakeven = overhead / (1 − scr),
 * healthy = overhead / (1 − scr − 0.40).
 */
function HealthInsightsPanel({
  totals,
  profitDays,
  lossDays,
  bestDay,
}: {
  totals: DailyOpsData["totals"];
  profitDays: number;
  lossDays: number;
  bestDay: DailyOpsRow | null;
}) {
  const serviceCostRatio = totals.revenue > 0 ? totals.cost / totals.revenue : 0;
  const scrCapped = Math.min(0.95, Math.max(0, serviceCostRatio));
  const breakevenRevenue = 1 - scrCapped > 0.01 ? totals.overhead / (1 - scrCapped) : 0;
  const healthyDenom = 1 - scrCapped - TARGET_MARGIN_PCT / 100;
  const healthyRevenue = healthyDenom > 0.01 ? totals.overhead / healthyDenom : 0;
  const gapToBreakeven = breakevenRevenue - totals.revenue;
  const gapToHealthy = healthyRevenue - totals.revenue;

  // Progress bar: revenue as a share of the healthy target (clamped to 100).
  // Breakeven marker sits at its own share of the same scale.
  const fillPct = healthyRevenue > 0 ? Math.max(0, Math.min(100, (totals.revenue / healthyRevenue) * 100)) : 0;
  const breakevenMarkerPct = healthyRevenue > 0
    ? Math.max(0, Math.min(100, (breakevenRevenue / healthyRevenue) * 100))
    : 0;
  const pastHealthy = totals.revenue >= healthyRevenue && healthyRevenue > 0;
  const fillColor = pastHealthy ? PALETTE.green : PALETTE.orange;

  return (
    <div className="px-4 py-3 bg-surface-secondary/40 border-t border-border-light">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <p
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: PALETTE.navy }}
          >
            Health insights
          </p>
          <FixfyHintIcon text="Derived from the month totals above. Breakeven = overhead / (1 − service-cost ratio). Healthy = overhead / (1 − service-cost ratio − 40%)." />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: PALETTE.subtleGray }}>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: PALETTE.green }}
              aria-hidden
            />
            Profit days <span className="font-semibold tabular-nums" style={{ color: PALETTE.green }}>{profitDays}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: PALETTE.red }}
              aria-hidden
            />
            Loss days <span className="font-semibold tabular-nums" style={{ color: PALETTE.red }}>{lossDays}</span>
          </span>
          {bestDay ? (
            <span>
              Best day{" "}
              <span className="font-semibold" style={{ color: PALETTE.neutral }}>
                {bestDay.weekdayLabel} {formatCurrency(bestDay.margin)}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg px-3 py-2.5 bg-surface border border-border-light">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 mb-2">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <InlineMetric
              label="Current"
              value={formatCurrency(totals.revenue)}
              valueColor={PALETTE.neutral}
              valueWeight={500}
            />
            <InlineMetric
              label="Breakeven"
              value={breakevenRevenue > 0 ? formatCurrency(breakevenRevenue) : "—"}
              valueColor={PALETTE.neutral}
              valueWeight={600}
            />
            <InlineMetric
              label={`Healthy (${TARGET_MARGIN_PCT}%)`}
              value={healthyRevenue > 0 ? formatCurrency(healthyRevenue) : "—"}
              valueColor={PALETTE.green}
              valueWeight={600}
            />
          </div>
          <div className="text-[11px] flex items-center gap-2" style={{ color: PALETTE.subtleGray }}>
            <span style={{ color: gapToBreakeven > 0 ? PALETTE.red : PALETTE.green, fontWeight: 600 }}>
              {gapToBreakeven > 0
                ? `−${formatCurrency(gapToBreakeven)} to breakeven`
                : `+${formatCurrency(Math.abs(gapToBreakeven))} past breakeven`}
            </span>
            <span aria-hidden>·</span>
            <span style={{ color: gapToHealthy > 0 ? PALETTE.orange : PALETTE.green, fontWeight: 600 }}>
              {gapToHealthy > 0
                ? `${formatCurrency(gapToHealthy)} to healthy`
                : `+${formatCurrency(Math.abs(gapToHealthy))} past healthy`}
            </span>
          </div>
        </div>
        <div
          className="relative w-full overflow-hidden"
          style={{ height: 7, borderRadius: 4, background: PALETTE.railBg }}
        >
          <div
            className="h-full"
            style={{
              width: `${fillPct}%`,
              background: fillColor,
              borderRadius: 4,
              transition: "width 400ms ease",
            }}
          />
          {/* Breakeven marker */}
          {healthyRevenue > 0 ? (
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: `${breakevenMarkerPct}%`,
                width: 1.5,
                background: PALETTE.neutral,
                transform: "translateX(-0.75px)",
              }}
              aria-hidden
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Inline metric used in the Health Insights single-card row. */
function InlineMetric({
  label,
  value,
  valueColor,
  valueWeight,
}: {
  label: string;
  value: string;
  valueColor: string;
  valueWeight: number;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="text-[9px] uppercase tracking-wider"
        style={{ color: PALETTE.subtleGray, fontWeight: 500 }}
      >
        {label}
      </span>
      <span className="tabular-nums" style={{ color: valueColor, fontWeight: valueWeight, fontSize: 12 }}>
        {value}
      </span>
    </span>
  );
}

/**
 * Thin wrapper kept for backwards compatibility — external consumers could
 * still import `HealthInsightsStrip`. Internally everything flows through
 * HealthInsightsPanel; the "compact" flag is ignored (was for the removed
 * floating strip layout).
 */
export function HealthInsightsStrip({
  totals,
}: {
  totals: DailyOpsData["totals"];
  /** Retained for backwards compatibility with older callers; ignored. */
  compact?: boolean;
}) {
  return (
    <HealthInsightsPanel totals={totals} profitDays={0} lossDays={0} bestDay={null} />
  );
}
