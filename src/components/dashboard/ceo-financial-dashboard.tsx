"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency, cn } from "@/lib/utils";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { jobBillableRevenue, jobDirectCost } from "@/lib/job-financials";
import {
  formatYmdLocal,
  isJobCeoWorkInProgress,
  splitInvoiceOpenBalanceAwaitingVsOverdue,
} from "@/lib/ceo-financial-metrics";
import { getCompanySettings } from "@/services/company";
import { listCommissionTiers } from "@/services/tiers";
import type { CommissionTier } from "@/types/database";
import {
  fetchPipelineJobsForDashboard,
  defaultMonthlySalesGoalGbp,
  periodSalesGoalGbp,
  resolveMonthlySalesGoalFromCompany,
  type OverviewPipelineJobRow,
} from "@/lib/dashboard-overview-jobs";
import { getDashboardSalesGoalTierNumberPreference } from "@/lib/dashboard-sales-goal-preference";
import { buildWeeklyCashPositionBuckets, type WeeklyCashPositionRow } from "@/lib/dashboard-cashflow-buckets";
import {
  CEO_SERVICE_TIER_ORDER,
  classifyCeoServiceTier,
} from "@/lib/ceo-service-tier";
import {
  previousPeriodBounds,
  periodTrendPercent,
  runRateForecast,
} from "@/lib/ceo-dashboard-period";
import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  PiggyBank,
  Scale,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

type InvoiceRow = {
  amount?: number;
  amount_paid?: number;
  status?: string;
  due_date?: string | null;
  job_reference?: string | null;
};

async function customerCashInRange(
  supabase: ReturnType<typeof getSupabase>,
  fromDay: string,
  toDay: string
): Promise<number> {
  const { data, error } = await supabase
    .from("job_payments")
    .select("amount")
    .in("type", ["customer_deposit", "customer_final"])
    .is("deleted_at", null)
    .gte("payment_date", fromDay)
    .lte("payment_date", toDay);
  if (error) return 0;
  return (data ?? []).reduce((s, r: { amount?: number }) => s + Number(r.amount ?? 0), 0);
}

function grossMarginPct(sales: number, cos: number): number {
  if (sales <= 0) return 0;
  return Math.round(((sales - cos) / sales) * 1000) / 10;
}

function netMarginPct(sales: number, cos: number, bills: number, workforce: number): number {
  if (sales <= 0) return 0;
  return Math.round(((sales - cos - bills - workforce) / sales) * 1000) / 10;
}

export function CeoFinancialDashboard() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const boundsKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";

  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState(0);
  const [costOfSales, setCostOfSales] = useState(0);
  const [billsInPeriod, setBillsInPeriod] = useState(0);
  const [workforceInPeriod, setWorkforceInPeriod] = useState(0);
  const [prevSales, setPrevSales] = useState(0);
  const [prevCos, setPrevCos] = useState(0);
  const [prevBills, setPrevBills] = useState(0);
  const [prevWorkforce, setPrevWorkforce] = useState(0);

  const [workInProgress, setWorkInProgress] = useState(0);
  const [awaitingPayment, setAwaitingPayment] = useState(0);
  const [overduePayment, setOverduePayment] = useState(0);
  const [collected, setCollected] = useState(0);

  const [monthlyGoal, setMonthlyGoal] = useState(defaultMonthlySalesGoalGbp());
  const [forecast, setForecast] = useState(0);

  const [tierRevenue, setTierRevenue] = useState<Record<string, number>>({});
  const [cashflow, setCashflow] = useState<WeeklyCashPositionRow[]>([]);
  const [cashTotals, setCashTotals] = useState({ in: 0, out: 0, net: 0 });

  const [partnerUnpaid, setPartnerUnpaid] = useState(0);
  const [alertsOverdue, setAlertsOverdue] = useState(0);
  const [stuckAwaitingPayment, setStuckAwaitingPayment] = useState(0);

  const periodGoal = useMemo(
    () => periodSalesGoalGbp(bounds, monthlyGoal),
    [bounds, monthlyGoal]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      setLoading(true);
      const clock = new Date();
      const toIso = bounds?.toIso ?? clock.toISOString();
      const fromIso = bounds?.fromIso ?? "2000-01-01T00:00:00.000Z";
      const fromDay = fromIso.slice(0, 10);
      const toDay = toIso.slice(0, 10);
      const prevB = bounds ? previousPeriodBounds(bounds) : null;

      try {
        const [companySettings, pipelineRows, pipelinePrev, jobsForWip, invoicesRes, billsRes, payrollRes, tiersList] =
          await Promise.all([
            getCompanySettings(),
            fetchPipelineJobsForDashboard(supabase, bounds),
            prevB ? fetchPipelineJobsForDashboard(supabase, prevB) : Promise.resolve([] as OverviewPipelineJobRow[]),
            supabase
              .from("jobs")
              .select("reference, status, client_price, extras_amount, title, partner_cancelled_at")
              .is("deleted_at", null)
              .neq("status", "cancelled")
              .neq("status", "deleted"),
            supabase.from("invoices").select("amount, amount_paid, status, due_date, job_reference").is("deleted_at", null),
            (async () => {
              let q = supabase
                .from("bills")
                .select("amount")
                .is("archived_at", null)
                .neq("status", "rejected");
              if (bounds) {
                q = q.gte("due_date", fromDay).lte("due_date", toDay);
              }
              return q;
            })(),
            (async () => {
              let q = supabase.from("payroll_internal_costs").select("amount");
              if (bounds) {
                q = q.not("due_date", "is", null).gte("due_date", fromDay).lte("due_date", toDay);
              }
              return q;
            })(),
            listCommissionTiers().catch(() => [] as CommissionTier[]),
          ]);

        if (cancelled) return;
        setMonthlyGoal(
          resolveMonthlySalesGoalFromCompany(
            companySettings,
            tiersList,
            getDashboardSalesGoalTierNumberPreference(),
          ),
        );

        let s = 0;
        let cos = 0;
        for (const r of pipelineRows) {
          const j = r as Parameters<typeof jobBillableRevenue>[0];
          s += jobBillableRevenue(j);
          cos += jobDirectCost(r as OverviewPipelineJobRow);
        }
        let ps = 0;
        let pcos = 0;
        for (const r of pipelinePrev) {
          const j = r as Parameters<typeof jobBillableRevenue>[0];
          ps += jobBillableRevenue(j);
          pcos += jobDirectCost(r as OverviewPipelineJobRow);
        }

        const billRows = (billsRes.error ? [] : billsRes.data ?? []) as { amount?: number }[];
        const billsSum = billRows.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

        let prevBillsSum = 0;
        let prevPayrollSum = 0;
        if (prevB) {
          const pFrom = prevB.fromIso.slice(0, 10);
          const pTo = prevB.toIso.slice(0, 10);
          const [pbRes, ppRes] = await Promise.all([
            supabase
              .from("bills")
              .select("amount")
              .is("archived_at", null)
              .neq("status", "rejected")
              .gte("due_date", pFrom)
              .lte("due_date", pTo),
            supabase
              .from("payroll_internal_costs")
              .select("amount")
              .not("due_date", "is", null)
              .gte("due_date", pFrom)
              .lte("due_date", pTo),
          ]);
          prevBillsSum = (pbRes.data ?? []).reduce(
            (acc, r) => acc + Number((r as { amount?: number }).amount ?? 0),
            0,
          );
          prevPayrollSum = (ppRes.data ?? []).reduce(
            (acc, r) => acc + Number((r as { amount?: number }).amount ?? 0),
            0,
          );
        }

        const invoices = (invoicesRes.data ?? []) as InvoiceRow[];

        const jobs = (jobsForWip.error ? [] : jobsForWip.data ?? []) as {
          reference: string;
          status: string;
          client_price: number;
          extras_amount?: number | null;
          title?: string;
          partner_cancelled_at?: string | null;
        }[];

        let wip = 0;
        for (const j of jobs) {
          if (!isJobCeoWorkInProgress(j)) continue;
          wip += jobBillableRevenue({
            client_price: Number(j.client_price ?? 0),
            extras_amount: j.extras_amount != null ? Number(j.extras_amount) : undefined,
          });
        }

        const todayLocal = formatYmdLocal(clock);
        const { awaiting: awaitAmt, overdue: overdueAmt } = splitInvoiceOpenBalanceAwaitingVsOverdue(
          invoices,
          todayLocal,
        );

        const payrollRows = (payrollRes.error ? [] : payrollRes.data ?? []) as { amount?: number }[];
        const workforceSum = payrollRows.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

        const collectedAmt = await customerCashInRange(supabase, fromDay, toDay);

        const tiers: Record<string, number> = {};
        for (const t of CEO_SERVICE_TIER_ORDER) tiers[t] = 0;
        for (const r of pipelineRows) {
          const row = r as OverviewPipelineJobRow;
          const tier = classifyCeoServiceTier(null, row.title ?? "");
          const rev = jobBillableRevenue(row as Parameters<typeof jobBillableRevenue>[0]);
          tiers[tier] = (tiers[tier] ?? 0) + rev;
        }

        const [customerCashRes, sbOutstandingRes, billsOutstandingRes, payrollPendingRes] = await Promise.all([
          supabase
            .from("job_payments")
            .select("amount, payment_date")
            .in("type", ["customer_deposit", "customer_final"])
            .is("deleted_at", null)
            .gte("payment_date", fromDay)
            .lte("payment_date", toDay),
          supabase
            .from("self_bills")
            .select("net_payout, week_start, created_at")
            .in("status", ["awaiting_payment", "ready_to_pay"]),
          supabase
            .from("bills")
            .select("amount, due_date")
            .in("status", ["submitted", "approved", "needs_attention"])
            .is("archived_at", null)
            .gte("due_date", fromDay)
            .lte("due_date", toDay),
          supabase
            .from("payroll_internal_costs")
            .select("amount, due_date")
            .eq("status", "pending")
            .not("due_date", "is", null)
            .gte("due_date", fromDay)
            .lte("due_date", toDay),
        ]);

        const buckets = buildWeeklyCashPositionBuckets(
          fromIso,
          toIso,
          (customerCashRes.data ?? []) as { payment_date?: string; amount?: number }[],
          (sbOutstandingRes.data ?? []) as {
            net_payout?: number;
            week_start?: string | null;
            created_at?: string;
          }[],
          (billsOutstandingRes.error ? [] : billsOutstandingRes.data ?? []) as {
            amount?: number;
            due_date?: string;
          }[],
          (payrollPendingRes.error ? [] : payrollPendingRes.data ?? []) as {
            amount?: number;
            due_date?: string;
          }[],
        );
        const cin = buckets.reduce((a, b) => a + b.collected, 0);
        const pout = buckets.reduce((a, b) => a + b.partnerToPay + b.billsToPay + b.workforceToPay, 0);
        const n = buckets.reduce((a, b) => a + b.net, 0);

        const { data: sbAll } = await supabase
          .from("self_bills")
          .select("net_payout")
          .in("status", ["awaiting_payment", "ready_to_pay"]);
        const partnerDue = (sbAll ?? []).reduce(
          (acc, r) => acc + Number((r as { net_payout?: number }).net_payout ?? 0),
          0
        );

        let stuck = 0;
        const awaitingJobs = (jobsForWip.error ? [] : jobsForWip.data ?? []) as {
          status: string;
          client_price: number;
          extras_amount?: number | null;
        }[];
        const awaitingJobsFiltered = awaitingJobs.filter((j) => j.status === "awaiting_payment");
        for (const j of awaitingJobsFiltered) {
          stuck += jobBillableRevenue({
            client_price: Number(j.client_price ?? 0),
            extras_amount: j.extras_amount != null ? Number(j.extras_amount) : undefined,
          });
        }

        if (cancelled) return;
        setSales(s);
        setCostOfSales(cos);
        setBillsInPeriod(billsSum);
        setWorkforceInPeriod(workforceSum);
        setPrevSales(ps);
        setPrevCos(pcos);
        setPrevBills(prevBillsSum);
        setPrevWorkforce(prevPayrollSum);
        setWorkInProgress(wip);
        setAwaitingPayment(awaitAmt);
        setOverduePayment(overdueAmt);
        setCollected(collectedAmt);
        setTierRevenue(tiers);
        setCashflow(buckets);
        setCashTotals({ in: cin, out: pout, net: n });
        setPartnerUnpaid(partnerDue);
        setAlertsOverdue(overdueAmt);
        setStuckAwaitingPayment(stuck);

        if (bounds) {
          setForecast(runRateForecast(s, bounds, clock));
        } else {
          setForecast(s);
        }
      } catch {
        if (!cancelled) {
          setSales(0);
          setCostOfSales(0);
          setBillsInPeriod(0);
          setWorkforceInPeriod(0);
          setPrevSales(0);
          setPrevCos(0);
          setPrevBills(0);
          setPrevWorkforce(0);
          setWorkInProgress(0);
          setAwaitingPayment(0);
          setOverduePayment(0);
          setCollected(0);
          setTierRevenue({});
          setCashflow([]);
          setCashTotals({ in: 0, out: 0, net: 0 });
          setPartnerUnpaid(0);
          setAlertsOverdue(0);
          setStuckAwaitingPayment(0);
          setForecast(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [boundsKey, bounds]);

  useEffect(() => {
    function refreshGoal() {
      void Promise.all([getCompanySettings(), listCommissionTiers().catch(() => [] as CommissionTier[])]).then(
        ([s, t]) => {
          setMonthlyGoal(
            resolveMonthlySalesGoalFromCompany(s, t, getDashboardSalesGoalTierNumberPreference()),
          );
        },
      );
    }
    window.addEventListener("master-os-company-settings", refreshGoal);
    return () => window.removeEventListener("master-os-company-settings", refreshGoal);
  }, []);

  const gross = sales - costOfSales;
  const net = sales - costOfSales - billsInPeriod - workforceInPeriod;
  const grossPct = grossMarginPct(sales, costOfSales);
  const netPct = netMarginPct(sales, costOfSales, billsInPeriod, workforceInPeriod);

  const prevGross = prevSales - prevCos;
  const prevNet = prevSales - prevCos - prevBills - prevWorkforce;

  const tierChartData = useMemo(() => {
    const main = ["Quick Fix", "Multi Task", "Standard", "Project", "Emergency"] as const;
    return main.map((tier) => ({
      tier,
      revenue: tierRevenue[tier] ?? 0,
    }));
  }, [tierRevenue]);

  const goalForBar = periodGoal ?? sales;
  const progressPct = goalForBar > 0 ? Math.min(100, (sales / goalForBar) * 100) : 0;
  const forecastPct = goalForBar > 0 ? Math.min(150, (forecast / goalForBar) * 100) : 0;

  const cashOutflows = useMemo(() => {
    return cashflow.reduce((s, b) => s + b.partnerToPay + b.billsToPay + b.workforceToPay, 0);
  }, [cashflow]);

  const alertItems = useMemo(() => {
    const items: { level: "red" | "amber" | "yellow"; text: string; amount?: number }[] = [];
    if (alertsOverdue > 0) {
      items.push({
        level: "red",
        text: "Overdue invoice balance",
        amount: alertsOverdue,
      });
    }
    if (partnerUnpaid > 0) {
      items.push({
        level: "amber",
        text: "Partner self-bills to pay (outstanding)",
        amount: partnerUnpaid,
      });
    }
    if (cashTotals.net < 0) {
      items.push({
        level: "red",
        text: "Cashflow net negative in range (in − partner − bills)",
        amount: Math.abs(cashTotals.net),
      });
    }
    if (stuckAwaitingPayment > 50_000) {
      items.push({
        level: "amber",
        text: "High billable value on jobs in Awaiting Payment status",
        amount: stuckAwaitingPayment,
      });
    }
    if (workInProgress > 100_000) {
      items.push({
        level: "yellow",
        text: "Large work in progress (operational jobs)",
        amount: workInProgress,
      });
    }
    if (items.length === 0) {
      items.push({ level: "yellow", text: "No critical alerts in this snapshot" });
    }
    return items;
  }, [
    alertsOverdue,
    partnerUnpaid,
    cashTotals.net,
    stuckAwaitingPayment,
    workInProgress,
  ]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border-light bg-gradient-to-br from-card to-surface-hover/40 px-5 py-4 shadow-sm">
        <h2 className="text-lg font-bold text-text-primary tracking-tight">CEO — Financial health</h2>
        <p className="text-xs text-text-tertiary mt-1">
          All figures in £ · Period: <span className="font-semibold text-text-secondary">{rangeLabel}</span>
          {loading && " · Loading…"}
        </p>
      </div>

      {/* Section 1 — Core financial */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">
          Core financial
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Sales"
            value={sales}
            format="currency"
            change={periodTrendPercent(sales, prevSales)}
            changeLabel="vs prior period"
            icon={CircleDollarSign}
            accent="blue"
            description="Pipeline jobs with schedule start in period (billable value; same date rule as Jobs list)"
          />
          <KpiCard
            title="Cost of sales"
            value={costOfSales}
            format="currency"
            change={periodTrendPercent(costOfSales, prevCos)}
            changeLabel="vs prior period"
            icon={Scale}
            accent="amber"
            description="Partner + materials on jobs"
          />
          <KpiCard
            title="Gross margin"
            value={`${formatCurrency(gross)} · ${grossPct}%`}
            format="none"
            change={periodTrendPercent(gross, prevGross)}
            changeLabel="vs prior period"
            icon={TrendingUp}
            accent="emerald"
            description="Sales − cost of sales"
          />
          <KpiCard
            title="Net margin"
            value={`${formatCurrency(net)} · ${netPct}%`}
            format="none"
            change={periodTrendPercent(net, prevNet)}
            changeLabel="vs prior period"
            icon={PiggyBank}
            accent="purple"
            description="Sales − cost of sales − supplier bills − workforce (payroll) due in period"
          />
        </div>
      </section>

      {/* Section 2 — Cash position */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">
          Cash position
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Work in progress"
            value={workInProgress}
            format="currency"
            icon={Wallet}
            accent="amber"
            description="Billable value on operational jobs (excl. completed, cancelled, deleted, partner-lost)"
          />
          <KpiCard
            title="Awaiting payment"
            value={awaitingPayment}
            format="currency"
            icon={Banknote}
            accent="blue"
            description="Open invoice balance_due with due_date on or after today"
          />
          <KpiCard
            title="Overdue"
            value={overduePayment}
            format="currency"
            icon={AlertTriangle}
            accent="primary"
            description="Open invoice balance_due with due_date before today"
          />
          <KpiCard
            title="Collected"
            value={collected}
            format="currency"
            icon={CircleDollarSign}
            accent="emerald"
            description="Client payments from job_payments (deposit + final) in period"
          />
        </div>
      </section>

      {/* Section 3 — Sales performance */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">
          Sales performance
        </h3>
        <Card className="border-border-light shadow-sm overflow-hidden">
          <CardHeader className="border-b border-border-light/60 bg-surface-hover/30 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" />
              Goal vs actual vs forecast
            </CardTitle>
            <p className="text-xs text-text-tertiary mt-1">
              Goal scales to the selected range. Forecast = run-rate to period end.
            </p>
          </CardHeader>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-tertiary">Sales goal</p>
                <p className="text-xl font-bold tabular-nums mt-1">
                  {periodGoal != null ? formatCurrency(periodGoal) : formatCurrency(monthlyGoal)}
                  {periodGoal == null && (
                    <span className="text-xs font-normal text-text-tertiary ml-1">/ mo baseline</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-tertiary">Actual sales</p>
                <p className="text-xl font-bold tabular-nums text-primary mt-1">{formatCurrency(sales)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-tertiary">Forecast</p>
                <p className="text-xl font-bold tabular-nums text-text-secondary mt-1">
                  {formatCurrency(forecast)}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-text-tertiary">
                <span>Progress to goal</span>
                <span className="font-semibold tabular-nums">{progressPct.toFixed(0)}%</span>
              </div>
              <div className="h-3 rounded-full bg-surface-hover overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-text-tertiary">
                <span>Forecast trajectory</span>
                <span className="font-semibold tabular-nums">{forecastPct.toFixed(0)}% of goal</span>
              </div>
              <div className="h-2 rounded-full bg-surface-hover overflow-hidden ring-1 ring-border-light/50">
                <div
                  className="h-full rounded-full bg-emerald-500/80"
                  style={{ width: `${Math.min(100, forecastPct)}%` }}
                />
              </div>
            </div>
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Section 4 — Tier vs revenue */}
        <Card className="border-border-light shadow-sm min-h-[320px] flex flex-col">
          <CardHeader className="border-b border-border-light/60 shrink-0">
            <CardTitle className="text-base">Sales by service tier</CardTitle>
            <p className="text-xs text-text-tertiary mt-0.5">Period sales by job title mapping (Quick Fix → Emergency)</p>
          </CardHeader>
          <div className="flex-1 min-h-[260px] p-3 pb-5">
            {loading ? (
              <div className="h-full min-h-[240px] animate-pulse rounded-xl bg-surface-hover" />
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={tierChartData}
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border-light/80" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
                      tickFormatter={(v) => (v >= 1000 ? `£${(v / 1000).toFixed(0)}k` : `£${v}`)}
                    />
                    <YAxis
                      type="category"
                      dataKey="tier"
                      width={88}
                      tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
                    />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v ?? 0))}
                      contentStyle={{
                        borderRadius: 10,
                        fontSize: 12,
                        border: "1px solid var(--color-border-light)",
                        background: "var(--color-card)",
                      }}
                    />
                    <Bar dataKey="revenue" name="Sales" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Card>

        {/* Section 5 — Cashflow */}
        <Card className="border-border-light shadow-sm min-h-[320px] flex flex-col overflow-hidden">
          <CardHeader className="border-b border-border-light/60 shrink-0">
            <CardTitle className="text-base">Cashflow</CardTitle>
            <p className="text-xs text-text-tertiary mt-0.5">By week in range</p>
          </CardHeader>
          {!loading && (
            <div className="px-4 pt-3 grid grid-cols-3 gap-2 shrink-0">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">Cash in</p>
                <p className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(cashTotals.in)}
                </p>
              </div>
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-400">Cash out</p>
                <p className="text-sm font-bold tabular-nums text-rose-700 dark:text-rose-400">
                  {formatCurrency(cashOutflows)}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-xl border px-3 py-2",
                  cashTotals.net >= 0
                    ? "bg-emerald-500/10 border-emerald-500/20"
                    : "bg-rose-500/10 border-rose-500/20"
                )}
              >
                <p
                  className={cn(
                    "text-[10px] font-semibold uppercase",
                    cashTotals.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                  )}
                >
                  Net
                </p>
                <p
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    cashTotals.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                  )}
                >
                  {formatCurrency(cashTotals.net)}
                </p>
              </div>
            </div>
          )}
          <div className="flex-1 min-h-[220px] p-2 pb-4">
            {loading ? (
              <div className="h-full min-h-[200px] animate-pulse rounded-xl bg-surface-hover" />
            ) : cashflow.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-12">No weekly buckets in range</p>
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashflow} margin={{ top: 8, right: 8, left: 4, bottom: 4 }} barCategoryGap="18%">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border-light/80" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "var(--color-text-tertiary)" }}
                      interval="preserveStartEnd"
                      height={44}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
                      tickFormatter={(v) => (v >= 1000 ? `£${(v / 1000).toFixed(0)}k` : `£${v}`)}
                    />
                    <Tooltip
                      formatter={(v, name) => [formatCurrency(Number(v ?? 0)), String(name)]}
                      contentStyle={{
                        borderRadius: 10,
                        fontSize: 12,
                        border: "1px solid var(--color-border-light)",
                        background: "var(--color-card)",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                    <Bar dataKey="collected" name="Customer cash in" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="partnerToPay" name="Partner to pay" fill="#f87171" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="billsToPay" name="Bills to pay" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="workforceToPay" name="Workforce to pay" fill="#fb923c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Section 6 — Alerts */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">
          Alerts
        </h3>
        <Card className="border-border-light shadow-sm">
          <div className="divide-y divide-border-light/60">
            {alertItems.map((a, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
                  a.level === "red" && "bg-rose-500/5",
                  a.level === "amber" && "bg-amber-500/5",
                  a.level === "yellow" && "bg-amber-500/[0.03]"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      a.level === "red" && "bg-rose-500",
                      a.level === "amber" && "bg-amber-500",
                      a.level === "yellow" && "bg-amber-400"
                    )}
                  />
                  <p className="text-sm font-medium text-text-primary">{a.text}</p>
                </div>
                {a.amount != null && (
                  <p className="text-sm font-bold tabular-nums text-text-primary">{formatCurrency(a.amount)}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
