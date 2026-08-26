"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  endOfMonth,
  format,
  formatISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { pulseMoney as formatCurrency } from "@/lib/pulse-money-display";
import { getSupabase } from "@/services/base";
import { SectionCard, Pill } from "@/components/fx/primitives";
import { Modal } from "@/components/ui/modal";
import { PULSE_FORECAST_PAIR_CARD_CLASS } from "@/lib/pulse-layout";
import { localYmd } from "@/lib/date-range-filter";
import {
  countWorkingDaysInRange,
  monthlyWorkingDays,
  parseFrontendSetup,
  type FrontendSetup,
} from "@/lib/frontend-setup";
import {
  computeBillsFixedCostForPeriod,
  computeWorkforceMonthlyBurn,
  type PulseBillRow,
} from "@/lib/pulse-fixed-costs";
import { WORKFORCE_COST_ACTIVE_OR_FILTER } from "@/lib/workforce-lifecycle";

/**
 * Jobs Forecasting — next 10 calendar days, one stacked bar per day.
 * Toggle switches to Monthly Results: last N months with grouped bars for
 * revenue / all costs / net margin. Click a month to open the detail modal.
 */

const FORECAST_DAYS = 10;
const RESULTS_MONTHS = 6;

type ChartMode = "forecast" | "results";

type StatusKey = "unassigned" | "scheduled" | "in_progress" | "final_check";

type DayBucket = {
  ymd: string;
  label: string;
  date: Date;
  unassigned: number;
  scheduled: number;
  in_progress: number;
  final_check: number;
};

type MonthBucket = {
  key: string;
  label: string;
  monthStart: Date;
  revenue: number;
  partnerCost: number;
  workforce: number;
  bills: number;
  allCosts: number;
  gross: number;
  net: number;
  jobs: number;
  /** Non-negative net segment for the stacked bar. */
  netBar: number;
  /** Cost segment so netBar + costStack = revenue. */
  costStack: number;
};

const SELF_BILL_EXCLUDED = ["rejected", "payout_cancelled", "payout_archived", "payout_lost"];

const COLORS: Record<StatusKey, string> = {
  unassigned: "#ED4B00",
  scheduled: "#0E8A5F",
  in_progress: "#0B5FFF",
  final_check: "#7C3AED",
};

const STATUS_LABEL: Record<StatusKey, string> = {
  unassigned: "Unassigned",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  final_check: "Final Checks",
};

const RESULT_COLORS = {
  revenue: "#0B1F3A", // navy — faturamento
  allCosts: "#ED4B00", // coral/orange — all costs
  net: "#0E8A5F", // green — net margin
} as const;

const CHART_MODES: { id: ChartMode; label: string }[] = [
  { id: "forecast", label: "Forecast" },
  { id: "results", label: "Results" },
];

const ACTIVE_OPS_STATUSES = [
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
  "in_progress",
  "final_check",
  "need_attention",
  "awaiting_payment",
  "completed",
];

function buildEmptyBuckets(): DayBucket[] {
  const today = startOfDay(new Date());
  return Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = addDays(today, i);
    return {
      ymd: localYmd(date),
      label: format(date, "EEE d"),
      date,
      unassigned: 0,
      scheduled: 0,
      in_progress: 0,
      final_check: 0,
    };
  });
}

function buildEmptyMonthBuckets(): MonthBucket[] {
  const now = new Date();
  return Array.from({ length: RESULTS_MONTHS }, (_, i) => {
    const monthStart = startOfMonth(subMonths(now, RESULTS_MONTHS - 1 - i));
    return {
      key: format(monthStart, "yyyy-MM"),
      label: format(monthStart, "MMM"),
      monthStart,
      revenue: 0,
      partnerCost: 0,
      workforce: 0,
      bills: 0,
      allCosts: 0,
      gross: 0,
      net: 0,
      jobs: 0,
      netBar: 0,
      costStack: 0,
    };
  });
}

function bucketForStatus(status: string): StatusKey | null {
  switch (status) {
    case "unassigned":
    case "auto_assigning":
      return "unassigned";
    case "scheduled":
    case "late":
    case "on_hold":
      return "scheduled";
    case "in_progress":
      return "in_progress";
    case "final_check":
    case "awaiting_payment":
    case "need_attention":
      return "final_check";
    default:
      return null;
  }
}

function pct(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return (part / whole) * 100;
}

function ChartModeToggle({
  mode,
  onChange,
}: {
  mode: ChartMode;
  onChange: (m: ChartMode) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-fx-line bg-fx-paper p-0.5"
      role="tablist"
      aria-label="Forecast chart mode"
    >
      {CHART_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          onClick={() => onChange(m.id)}
          className={cn(
            "px-2.5 py-1 rounded text-[12px] font-medium transition-colors",
            mode === m.id
              ? "bg-card text-text-primary shadow-sm"
              : "text-fx-mute hover:text-text-primary",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function TodaysFlow() {
  const [mode, setMode] = useState<ChartMode>("forecast");
  const [forecastData, setForecastData] = useState<DayBucket[]>(() => buildEmptyBuckets());
  const [resultsData, setResultsData] = useState<MonthBucket[] | null>(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<MonthBucket | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const today = startOfDay(new Date());
      const horizon = addDays(today, FORECAST_DAYS);
      const { data: rows } = await supabase
        .from("jobs")
        .select("scheduled_start_at, status")
        .gte("scheduled_start_at", today.toISOString())
        .lt("scheduled_start_at", horizon.toISOString())
        .neq("status", "deleted")
        .neq("status", "cancelled")
        .neq("status", "completed")
        .is("deleted_at", null)
        .limit(2000);
      if (cancelled) return;
      const buckets = buildEmptyBuckets();
      const byYmd = new Map(buckets.map((b) => [b.ymd, b]));
      type Row = { scheduled_start_at: string | null; status: string };
      for (const r of (rows ?? []) as Row[]) {
        if (!r.scheduled_start_at) continue;
        const ymd = localYmd(new Date(r.scheduled_start_at));
        const bucket = byYmd.get(ymd);
        if (!bucket) continue;
        const key = bucketForStatus(r.status);
        if (!key) continue;
        bucket[key] += 1;
      }
      setForecastData(buckets);
      setForecastLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== "results") return;
    let cancelled = false;
    setResultsLoading(true);
    void (async () => {
      const supabase = getSupabase();
      const buckets = buildEmptyMonthBuckets();
      const earliest = buckets[0].monthStart;
      const latest = endOfMonth(buckets[buckets.length - 1].monthStart);
      const fromDay = localYmd(earliest);
      const toDay = localYmd(latest);

      const [jobsRes, billsRes, payrollRes, internalSbRes, settingsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("scheduled_start_at, client_price, extras_amount, partner_cost")
          .gte("scheduled_start_at", formatISO(earliest))
          .lte("scheduled_start_at", formatISO(latest))
          .in("status", ACTIVE_OPS_STATUSES)
          .is("deleted_at", null),
        supabase
          .from("bills")
          .select(
            "id, description, amount, is_recurring, recurrence_interval, recurring_series_id, status, due_date, category",
          )
          .is("archived_at", null)
          .neq("status", "rejected"),
        supabase
          .from("payroll_internal_costs")
          .select("id, amount, lifecycle_stage")
          .or(WORKFORCE_COST_ACTIVE_OR_FILTER),
        supabase
          .from("self_bills")
          .select("internal_cost_id, net_payout, status, week_start")
          .eq("bill_origin", "internal")
          .not("status", "in", `(${SELF_BILL_EXCLUDED.map((s) => `"${s}"`).join(",")})`)
          .gte("week_start", fromDay)
          .lte("week_start", toDay),
        supabase.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
      ]);
      if (cancelled) return;

      type Row = {
        scheduled_start_at: string | null;
        client_price: number | null;
        extras_amount: number | null;
        partner_cost: number | null;
      };
      const byKey = new Map(buckets.map((b) => [b.key, b]));
      for (const r of (jobsRes.data ?? []) as Row[]) {
        if (!r.scheduled_start_at) continue;
        const d = new Date(r.scheduled_start_at);
        const key = format(startOfMonth(d), "yyyy-MM");
        const slot = byKey.get(key);
        if (!slot) continue;
        const revenue = (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0);
        const partnerCost = Number(r.partner_cost) || 0;
        slot.revenue += revenue;
        slot.partnerCost += partnerCost;
        slot.jobs += 1;
      }

      const setup: FrontendSetup = parseFrontendSetup(
        (settingsRes.data as { frontend_setup?: unknown } | null)?.frontend_setup,
      );
      const monthlyDivisor = monthlyWorkingDays(setup);
      const billRows = (billsRes.data ?? []) as PulseBillRow[];
      type PayrollRow = { id: string | null; amount: number | null; lifecycle_stage: string | null };
      const payrollRows = (payrollRes.data ?? []) as PayrollRow[];
      const monthlyBurnPayroll = computeWorkforceMonthlyBurn(payrollRows);
      const payrollIds = new Set(
        payrollRows.map((p) => p.id?.trim()).filter((id): id is string => !!id),
      );
      type SelfBillRow = {
        internal_cost_id: string | null;
        net_payout: number | null;
        week_start: string | null;
      };
      const selfBills = (internalSbRes.data ?? []) as SelfBillRow[];

      for (const slot of buckets) {
        const monthEnd = endOfMonth(slot.monthStart);
        const monthFrom = localYmd(slot.monthStart);
        const monthTo = localYmd(monthEnd);
        const workingDays = countWorkingDaysInRange(slot.monthStart, monthEnd, setup);
        const allocationFactor = monthlyDivisor > 0 ? workingDays / monthlyDivisor : 0;

        const { total: bills } = computeBillsFixedCostForPeriod(
          billRows,
          monthFrom,
          monthTo,
          allocationFactor,
        );
        const adhocPayroll = selfBills.reduce((acc, sb) => {
          const ws = sb.week_start?.trim();
          if (!ws || ws < monthFrom || ws > monthTo) return acc;
          const linkedId = sb.internal_cost_id?.trim();
          if (linkedId && payrollIds.has(linkedId)) return acc;
          return acc + (Number(sb.net_payout) || 0);
        }, 0);
        const workforce = monthlyBurnPayroll * allocationFactor + adhocPayroll;

        slot.bills = bills;
        slot.workforce = workforce;
        slot.gross = slot.revenue - slot.partnerCost;
        slot.net = slot.gross - workforce - bills;
        slot.allCosts = slot.partnerCost + workforce + bills;
        slot.netBar = Math.max(0, Math.min(slot.net, slot.revenue));
        slot.costStack = Math.max(0, slot.revenue - slot.netBar);
      }

      setResultsData(buckets);
      setResultsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const forecastTotal = useMemo(
    () =>
      forecastData.reduce(
        (sum, b) => sum + b.unassigned + b.scheduled + b.in_progress + b.final_check,
        0,
      ),
    [forecastData],
  );

  const firstDay = forecastData[0];
  const lastDay = forecastData[forecastData.length - 1];
  const forecastRangeLabel =
    firstDay && lastDay
      ? `${format(firstDay.date, "d MMM")} → ${format(lastDay.date, "d MMM")}`
      : "";

  const resultsTotals = useMemo(() => {
    if (!resultsData) {
      return { revenue: 0, allCosts: 0, net: 0, costPct: 0, netPct: 0 };
    }
    const revenue = resultsData.reduce((a, m) => a + m.revenue, 0);
    const allCosts = resultsData.reduce((a, m) => a + m.allCosts, 0);
    const net = resultsData.reduce((a, m) => a + m.net, 0);
    return {
      revenue,
      allCosts,
      net,
      costPct: pct(allCosts, revenue),
      netPct: pct(net, revenue),
    };
  }, [resultsData]);

  const resultsRangeLabel =
    resultsData && resultsData.length > 0
      ? `${format(resultsData[0].monthStart, "MMM yyyy")} → ${format(
          resultsData[resultsData.length - 1].monthStart,
          "MMM yyyy",
        )}`
      : "";

  const isForecast = mode === "forecast";

  const openMonthFromClick = (data: unknown) => {
    const raw = data as (MonthBucket & { payload?: MonthBucket }) | undefined;
    const entry = raw?.payload ?? raw;
    if (!entry?.key) return;
    setSelectedMonth(entry);
  };

  return (
    <>
      <SectionCard
        className={PULSE_FORECAST_PAIR_CARD_CLASS}
        bodyClassName="flex-1 min-h-0 px-5 py-4"
        title={isForecast ? "Jobs Forecasting" : "Monthly Results"}
        subtitle={
          isForecast
            ? `Next ${FORECAST_DAYS} days · ${forecastRangeLabel}`
            : `Last ${RESULTS_MONTHS} months · ${resultsRangeLabel}`
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isForecast ? (
              <>
                <Pill tone="bad">{STATUS_LABEL.unassigned}</Pill>
                <Pill tone="ok">{STATUS_LABEL.scheduled}</Pill>
                <Pill tone="info">{STATUS_LABEL.in_progress}</Pill>
                <Pill tone="violet">{STATUS_LABEL.final_check}</Pill>
              </>
            ) : (
              <>
                <Pill
                  className="bg-[#0B1F3A]/10 text-[#0B1F3A] dark:bg-white/10 dark:text-white"
                >
                  Faturamento · {formatCurrency(resultsTotals.revenue)}
                </Pill>
                <Pill tone="coral">
                  All costs · {formatCurrency(resultsTotals.allCosts)} · {resultsTotals.costPct.toFixed(0)}%
                </Pill>
                <Pill tone="ok">
                  Net · {formatCurrency(resultsTotals.net)} · {resultsTotals.netPct.toFixed(0)}%
                </Pill>
              </>
            )}
            <ChartModeToggle mode={mode} onChange={setMode} />
          </div>
        }
      >
        <div className="h-48">
          {isForecast ? (
            forecastLoading ? (
              <div className="h-full bg-fx-paper-2/40 rounded animate-pulse" />
            ) : forecastTotal === 0 ? (
              <div className="h-full flex items-center justify-center text-[12px] text-fx-mute">
                No jobs scheduled in the next {FORECAST_DAYS} days.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={forecastData}
                  barCategoryGap={6}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey="label"
                    interval={0}
                    tick={{
                      fontSize: 9.5,
                      fill: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)",
                    }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--chart-cursor-overlay)" }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid var(--color-fx-line)",
                      boxShadow: "var(--shadow-fx-2)",
                      backgroundColor: "var(--card-bg)",
                      color: "var(--text-primary)",
                    }}
                    labelFormatter={(_v, payload) => {
                      const entry = payload?.[0]?.payload as DayBucket | undefined;
                      return entry ? format(entry.date, "EEE d MMM") : "";
                    }}
                    formatter={(value, name) => {
                      const key = String(name) as StatusKey;
                      return [value, STATUS_LABEL[key] ?? String(name)];
                    }}
                  />
                  <Legend wrapperStyle={{ display: "none" }} />
                  {firstDay ? (
                    <ReferenceLine
                      x={firstDay.label}
                      stroke="var(--chart-reference-dash)"
                      strokeDasharray="2 3"
                    />
                  ) : null}
                  <Bar dataKey="unassigned" stackId="a" fill={COLORS.unassigned} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="scheduled" stackId="a" fill={COLORS.scheduled} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="in_progress" stackId="a" fill={COLORS.in_progress} radius={[0, 0, 0, 0]} />
                  <Bar
                    dataKey="final_check"
                    stackId="a"
                    fill={COLORS.final_check}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )
          ) : resultsLoading || !resultsData ? (
            <div className="h-full bg-fx-paper-2/40 rounded animate-pulse" />
          ) : resultsTotals.revenue === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-fx-mute">
              No billed jobs in the last {RESULTS_MONTHS} months.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={resultsData}
                barCategoryGap={6}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                style={{ cursor: "pointer" }}
              >
                <XAxis
                  dataKey="label"
                  interval={0}
                  tick={{
                    fontSize: 9.5,
                    fill: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--chart-cursor-overlay)" }}
                  content={<ResultsHoverHint />}
                />
                <Legend wrapperStyle={{ display: "none" }} />
                {/* Bottom → top: faturamento (navy), all costs (orange), net/lucro (green) */}
                <Bar
                  dataKey="revenue"
                  name="revenue"
                  stackId="rev"
                  fill={RESULT_COLORS.revenue}
                  radius={[0, 0, 0, 0]}
                  onClick={(data) => openMonthFromClick(data)}
                  cursor="pointer"
                />
                <Bar
                  dataKey="allCosts"
                  name="allCosts"
                  stackId="rev"
                  fill={RESULT_COLORS.allCosts}
                  radius={[0, 0, 0, 0]}
                  onClick={(data) => openMonthFromClick(data)}
                  cursor="pointer"
                />
                <Bar
                  dataKey="netBar"
                  name="net"
                  stackId="rev"
                  fill={RESULT_COLORS.net}
                  radius={[2, 2, 0, 0]}
                  onClick={(data) => openMonthFromClick(data)}
                  cursor="pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </SectionCard>

      <Modal
        open={!!selectedMonth}
        onClose={() => setSelectedMonth(null)}
        title={selectedMonth ? format(selectedMonth.monthStart, "MMMM yyyy") : "Month"}
        subtitle={
          selectedMonth
            ? `${selectedMonth.jobs} job${selectedMonth.jobs === 1 ? "" : "s"} · full month P&L`
            : undefined
        }
        size="md"
      >
        {selectedMonth ? <MonthResultsDetail month={selectedMonth} /> : null}
      </Modal>
    </>
  );
}

function ResultsHoverHint({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MonthBucket }>;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0]?.payload;
  if (!entry) return null;
  const costPct = pct(entry.allCosts, entry.revenue);
  const netPct = pct(entry.net, entry.revenue);
  return (
    <div className="rounded-lg border border-fx-line bg-card px-3 py-2.5 shadow-fx-2 min-w-[190px] text-[11.5px]">
      <div className="font-semibold text-text-primary mb-1.5">
        {format(entry.monthStart, "MMMM yyyy")}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-fx-mute">Faturamento</span>
          <span className="tabular-nums font-medium text-text-primary">
            {formatCurrency(entry.revenue)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-fx-mute">All costs</span>
          <span className="tabular-nums font-medium text-text-secondary">
            {formatCurrency(entry.allCosts)} · {costPct.toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-fx-mute">Net</span>
          <span className="tabular-nums font-medium text-fx-green">
            {formatCurrency(entry.net)} · {netPct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="text-fx-mute mt-2 pt-1.5 border-t border-fx-line">Click for full breakdown</div>
    </div>
  );
}

function MonthResultsDetail({ month }: { month: MonthBucket }) {
  const grossPct = pct(month.gross, month.revenue);
  const netPct = pct(month.net, month.revenue);

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MetricTile
          label="Faturamento"
          value={formatCurrency(month.revenue)}
          swatch={RESULT_COLORS.revenue}
        />
        <MetricTile
          label="All costs"
          value={formatCurrency(month.allCosts)}
          swatch={RESULT_COLORS.allCosts}
        />
        <MetricTile
          label="Gross margin"
          value={`${formatCurrency(month.gross)} · ${grossPct.toFixed(0)}%`}
          tone={month.gross >= 0 ? "green" : "red"}
        />
        <MetricTile
          label="Net margin"
          value={`${formatCurrency(month.net)} · ${netPct.toFixed(0)}%`}
          swatch={month.net >= 0 ? RESULT_COLORS.net : "#DC2626"}
          tone={month.net >= 0 ? "green" : "red"}
        />
      </div>

      <div className="rounded-xl border border-fx-line overflow-hidden">
        <div className="px-3 py-2 bg-fx-paper border-b border-fx-line">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fx-mute">
            Cost breakdown
          </span>
        </div>
        <div className="divide-y divide-fx-line">
          <CostRow label="Partner cost" value={month.partnerCost} />
          <CostRow label="Workforce" value={month.workforce} />
          <CostRow label="Bills & fixed" value={month.bills} />
          <CostRow label="All costs" value={month.allCosts} strong />
        </div>
      </div>

      <div className="rounded-xl border border-fx-line overflow-hidden">
        <div className="px-3 py-2 bg-fx-paper border-b border-fx-line">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fx-mute">
            Margin bridge
          </span>
        </div>
        <div className="divide-y divide-fx-line">
          <CostRow label="Faturamento" value={month.revenue} />
          <CostRow label="− Partner cost" value={-month.partnerCost} />
          <CostRow label="= Gross margin" value={month.gross} strong />
          <CostRow label="− Workforce" value={-month.workforce} />
          <CostRow label="− Bills & fixed" value={-month.bills} />
          <CostRow label="= Net margin" value={month.net} strong />
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  swatch,
  tone,
}: {
  label: string;
  value: string;
  swatch?: string;
  tone?: "green" | "red";
}) {
  return (
    <div className="rounded-xl border border-fx-line px-3.5 py-3 bg-card">
      <div className="flex items-center gap-1.5 mb-1">
        {swatch ? (
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: swatch }} />
        ) : null}
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-fx-mute">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "text-[16px] font-semibold tabular-nums",
          tone === "green" && "text-fx-green",
          tone === "red" && "text-fx-red",
          !tone && "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CostRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-[13px]">
      <span className={cn(strong ? "font-medium text-text-primary" : "text-fx-mute")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "font-semibold text-text-primary" : "text-text-secondary",
          value < 0 && !strong && "text-fx-mute",
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}
