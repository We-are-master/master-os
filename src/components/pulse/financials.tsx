"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, formatISO, format } from "date-fns";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { dashboardBoundsToInclusiveLocalYmd } from "@/lib/dashboard-date-range";
import {
  countWorkingDaysInRange,
  monthlyWorkingDays,
  parseFrontendSetup,
  type FrontendSetup,
} from "@/lib/frontend-setup";
import {
  pulseRevenueGoalStatus,
  resolvePulseMonthlyRevenueGoal,
  resolvePulsePeriodRevenueGoal,
} from "@/lib/pulse-revenue-goal";
import { KpiCard, MicroLabel, Pill } from "@/components/fx/primitives";
import { Modal } from "@/components/ui/modal";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import { BreakdownTable, type BreakdownColumn } from "./financials-detail-modal";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { WORKFORCE_COST_ACTIVE_OR_FILTER } from "@/lib/workforce-lifecycle";
import {
  computeBillsFixedCostForPeriod,
  computeMonthlyBillsBurn,
  computeWorkforceMonthlyBurn,
  type PulseOneOffExpenseLine,
  type PulseRecurringExpenseLine,
} from "@/lib/pulse-fixed-costs";
import { useProfile } from "@/hooks/use-profile";

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

type JobDetail = {
  id: string;
  reference: string | null;
  title: string | null;
  client_id: string | null;
  client_name: string | null;
  property_address: string | null;
  property_postcode: string | null;
  partner_name: string | null;
  status: string | null;
  scheduled_start_at: string | null;
  client_price: number;
  extras_amount: number;
  partner_cost: number;
  materials_cost: number;
  expenses: number;
  accountName: string | null;
};

type BillDetail = PulseOneOffExpenseLine;

type RecurringExpenseDetail = PulseRecurringExpenseLine;

type PayrollDetail = {
  id: string;
  payee_name: string | null;
  description: string | null;
  amount: number; // monthly commitment
  proratedAmount: number; // applied to the window
  lifecycle_stage: string | null;
};

type DetailModal = "revenue" | "operating" | "fixed" | "net" | null;

export function Financials() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const [jobs, setJobs] = useState<JobDetail[]>([]);
  const [bills, setBills] = useState<BillDetail[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpenseDetail[]>([]);
  const [payroll, setPayroll] = useState<PayrollDetail[]>([]);
  const [setup, setSetup] = useState<FrontendSetup>(() => parseFrontendSetup(null));
  const [monthlyFixedCosts, setMonthlyFixedCosts] = useState(0);
  const [billsPeriodTotal, setBillsPeriodTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState<DetailModal>(null);

  useEffect(() => {
    if (!isAdmin && openModal === "fixed") setOpenModal(null);
  }, [isAdmin, openModal]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const fromIso = bounds?.fromIso ?? formatISO(startOfMonth(now));
      const toIso = bounds?.toIso ?? formatISO(endOfMonth(now));
      const { fromDay, toDay } = bounds
        ? dashboardBoundsToInclusiveLocalYmd(bounds)
        : { fromDay: ymd(startOfMonth(now)), toDay: ymd(endOfMonth(now)) };

      const [jobsRes, billsRes, payrollRes, settingsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select(
            "id, reference, title, client_id, client_name, property_address, partner_name, status, scheduled_start_at, client_price, extras_amount, partner_cost, materials_cost, expenses",
          )
          .gte("scheduled_start_at", fromIso)
          .lte("scheduled_start_at", toIso)
          .in("status", ACTIVE_OPS_STATUSES)
          .is("deleted_at", null)
          .order("scheduled_start_at", { ascending: true, nullsFirst: false })
          .limit(5000),
        supabase
          .from("bills")
          .select(
            "id, description, amount, status, due_date, category, is_recurring, recurrence_interval, recurring_series_id",
          )
          .is("archived_at", null)
          .neq("status", "rejected")
          .order("due_date", { ascending: true }),
        supabase
          .from("payroll_internal_costs")
          .select("id, amount, lifecycle_stage, payee_name, description")
          .or(WORKFORCE_COST_ACTIVE_OR_FILTER)
          .order("payee_name", { ascending: true, nullsFirst: false }),
        supabase.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      type JobRow = {
        id: string;
        reference: string | null;
        title: string | null;
        client_id: string | null;
        client_name: string | null;
        property_address: string | null;
        partner_name: string | null;
        status: string | null;
        scheduled_start_at: string | null;
        client_price: number | null;
        extras_amount: number | null;
        partner_cost: number | null;
        materials_cost: number | null;
        expenses: number | null;
      };
      const jobsRaw = (jobsRes.data ?? []) as JobRow[];
      const clientIds = [
        ...new Set(jobsRaw.map((j) => j.client_id?.trim()).filter(Boolean)),
      ] as string[];

      let accountByClient = new Map<string, string>();
      if (clientIds.length > 0) {
        try {
          accountByClient = await batchResolveLinkedAccountLabels(supabase, clientIds);
        } catch {
          accountByClient = new Map();
        }
      }
      if (cancelled) return;

      const jobsDetail: JobDetail[] = jobsRaw.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.title,
        client_id: r.client_id ?? null,
        client_name: r.client_name,
        property_address: r.property_address,
        property_postcode: r.property_address ? extractUkPostcode(r.property_address) : null,
        partner_name: r.partner_name,
        status: r.status,
        scheduled_start_at: r.scheduled_start_at,
        client_price: Number(r.client_price) || 0,
        extras_amount: Number(r.extras_amount) || 0,
        partner_cost: Number(r.partner_cost) || 0,
        materials_cost: Number(r.materials_cost) || 0,
        expenses: Number(r.expenses) || 0,
        accountName: r.client_id ? accountByClient.get(r.client_id) ?? null : null,
      }));

      const billRows = (billsRes.data ?? []) as Array<{
        id: string;
        description: string | null;
        amount: number | null;
        status: string | null;
        due_date: string | null;
        category: string | null;
        is_recurring: boolean | null;
        recurrence_interval: string | null;
        recurring_series_id: string | null;
      }>;

      const parsedSetup: FrontendSetup = parseFrontendSetup(
        (settingsRes.data as { frontend_setup?: unknown } | null)?.frontend_setup,
      );
      const fromDate = bounds ? new Date(bounds.fromIso) : startOfDay(now);
      const toDate = bounds ? new Date(bounds.toIso) : endOfDay(now);
      const workingDaysInWindow = countWorkingDaysInRange(fromDate, toDate, parsedSetup);
      const monthlyDivisor = monthlyWorkingDays(parsedSetup);
      const workforceFactor =
        monthlyDivisor > 0 ? (bounds ? workingDaysInWindow / monthlyDivisor : 1) : 0;

      const { total: billsTotal, recurringLines, oneOffLines } = computeBillsFixedCostForPeriod(
        billRows,
        fromDay,
        toDay,
        workforceFactor,
      );
      const billsDetail: BillDetail[] = oneOffLines;

      const payrollRows = (payrollRes.data ?? []) as Array<{
        id: string | null;
        amount: number | null;
        lifecycle_stage: string | null;
        payee_name: string | null;
        description: string | null;
      }>;
      const payrollDetail: PayrollDetail[] = payrollRows.map((r, i) => ({
        id: r.id ?? `payroll-${i}`,
        payee_name: r.payee_name,
        description: r.description,
        amount: Number(r.amount) || 0,
        proratedAmount: (Number(r.amount) || 0) * workforceFactor,
        lifecycle_stage: r.lifecycle_stage,
      }));

      const workforceMonthly = computeWorkforceMonthlyBurn(payrollRows);
      const monthlyBillsBurn = computeMonthlyBillsBurn(billRows);

      setJobs(jobsDetail);
      setBills(billsDetail);
      setRecurringExpenses(recurringLines);
      setPayroll(payrollDetail);
      setSetup(parsedSetup);
      setMonthlyFixedCosts(workforceMonthly + monthlyBillsBurn);
      setBillsPeriodTotal(billsTotal);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const totals = useMemo(() => {
    let revenue = 0;
    let partnerCost = 0;
    let materialsCost = 0;
    let expenses = 0;
    for (const j of jobs) {
      revenue += j.client_price + j.extras_amount;
      partnerCost += j.partner_cost;
      materialsCost += j.materials_cost;
      expenses += j.expenses;
    }
    const billsTotal = billsPeriodTotal;
    const workforce = payroll.reduce((a, p) => a + p.proratedAmount, 0);
    const operatingCost = partnerCost + materialsCost + expenses;
    const fixedCost = workforce + billsTotal;
    const netMargin = revenue - operatingCost - fixedCost;
    const recurringBills = recurringExpenses.reduce((a, line) => a + line.periodAmount, 0);
    return {
      revenue,
      partnerCost,
      materialsCost,
      expenses,
      operatingCost,
      workforce,
      bills: billsTotal,
      recurringBills,
      oneOffBills: billsTotal - recurringBills,
      fixedCost,
      netMargin,
      opsPct: revenue > 0 ? (operatingCost / revenue) * 100 : 0,
      fixedPct: revenue > 0 ? (fixedCost / revenue) * 100 : 0,
      netPct: revenue > 0 ? (netMargin / revenue) * 100 : 0,
      jobsCount: jobs.length,
    };
  }, [jobs, billsPeriodTotal, payroll, recurringExpenses]);

  const revenueGoal = useMemo(() => {
    const now = new Date();
    const fromDate = bounds ? new Date(bounds.fromIso) : startOfDay(startOfMonth(now));
    const toDate = bounds ? new Date(bounds.toIso) : endOfDay(endOfMonth(now));
    const { monthlyGoal, error } = resolvePulseMonthlyRevenueGoal(setup, monthlyFixedCosts);
    const { periodGoal, workingDaysInPeriod, dailyGoal } = resolvePulsePeriodRevenueGoal(
      { from: fromDate, to: toDate },
      setup,
      monthlyGoal,
    );
    const { status, pctOfGoal, delta } = pulseRevenueGoalStatus(totals.revenue, periodGoal);
    const gapToGoal = Math.max(0, periodGoal - totals.revenue);
    const aheadOfGoal = Math.max(0, totals.revenue - periodGoal);
    return {
      monthlyGoal,
      periodGoal,
      workingDaysInPeriod,
      dailyGoal,
      status,
      pctOfGoal,
      delta,
      gapToGoal,
      aheadOfGoal,
      error,
    };
  }, [setup, monthlyFixedCosts, bounds, totals.revenue]);

  const periodLabel = bounds ? rangeLabel : "this month";

  const revenueGoalUi = useMemo(() => {
    if (loading) {
      return { sub: "Loading…" as ReactNode, variant: "default" as const, topRight: <StatusDot color="bg-fx-green" /> };
    }
    if (revenueGoal.periodGoal <= 0 || revenueGoal.status === "unset") {
      return {
        sub: "Set revenue goal in Setup",
        variant: "default" as const,
        topRight: <StatusDot color="bg-fx-green" />,
      };
    }

    const pct = Math.round(revenueGoal.pctOfGoal ?? 0);
    const barPct = Math.min(100, revenueGoal.pctOfGoal ?? 0);
    const goalLabel = formatGbpCompact(revenueGoal.periodGoal);

    let pillLabel: string;
    let gapLabel: string;
    let gapClass: string;
    let barClass: string;
    let variant: "default" | "coral" | "alert";

    if (revenueGoal.status === "above") {
      pillLabel = `+${formatGbp(revenueGoal.aheadOfGoal)} ahead`;
      gapLabel = `${pct}% of ${goalLabel} goal`;
      gapClass = "text-fx-coral-p font-semibold";
      barClass = "bg-fx-coral";
      variant = "coral";
    } else if (revenueGoal.status === "on_track") {
      pillLabel = `${formatGbp(revenueGoal.gapToGoal)} to go`;
      gapLabel = `${pct}% · almost there`;
      gapClass = "text-fx-amber font-semibold";
      barClass = "bg-fx-amber";
      variant = "default";
    } else {
      pillLabel = `${formatGbp(revenueGoal.gapToGoal)} to go`;
      gapLabel = `${pct}% of ${goalLabel} goal`;
      gapClass = "text-fx-red font-semibold";
      barClass = "bg-fx-red";
      variant = "alert";
    }

    const wdPart =
      revenueGoal.workingDaysInPeriod > 0
        ? ` · ${revenueGoal.workingDaysInPeriod} working day${revenueGoal.workingDaysInPeriod === 1 ? "" : "s"}`
        : "";

    return {
      variant,
      topRight: (
        <Pill tone={revenueGoal.status === "above" ? "ok" : revenueGoal.status === "on_track" ? "warn" : "bad"}>
          {pillLabel}
        </Pill>
      ),
      sub: (
        <div className="flex flex-col gap-1.5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-fx-line/80"
            role="progressbar"
            aria-valuenow={barPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Revenue ${pct}% of period goal`}
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barClass)}
              style={{ width: `${barPct}%` }}
            />
          </div>
          <span className="font-mono text-[11.5px] leading-snug">
            <span className={gapClass}>{gapLabel}</span>
            <span className="text-fx-mute">{wdPart}</span>
          </span>
        </div>
      ),
    };
  }, [loading, revenueGoal]);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue"
          hint="Total client price + extras for jobs in the active pipeline. Goal comes from Setup (breakeven = cover fixed costs at target gross margin; healthy = target net margin after fixed costs). Period goal prorates by working days."
          value={loading ? "—" : formatGbp(totals.revenue)}
          sub={revenueGoalUi.sub}
          variant={revenueGoalUi.variant}
          topRight={revenueGoalUi.topRight}
          onShowDetails={() => setOpenModal("revenue")}
          detailsLabel="View revenue breakdown"
        />
        <KpiCard
          label="Operating Cost"
          hint="Partner cost + materials + per-job expenses for the same pipeline."
          value={loading ? "—" : formatGbp(totals.operatingCost)}
          topRight={<StatusDot color="bg-fx-amber" />}
          onShowDetails={() => setOpenModal("operating")}
          detailsLabel="View operating cost breakdown"
        />
        <KpiCard
          label="Fixed Costs"
          hint="Active workforce monthly payroll (pro-rated to working days in the window) plus all recurring expenses from Bills & expenses (monthly burn, pro-rated) and one-off bills due in the period."
          value={loading ? "—" : formatGbp(totals.fixedCost)}
          topRight={<StatusDot color="bg-fx-blue" />}
          onShowDetails={isAdmin ? () => setOpenModal("fixed") : undefined}
          detailsLabel="View fixed cost breakdown (admin)"
        />
        <KpiCard
          label="Net Margin"
          hint="Revenue minus Operating Cost and Fixed Costs. Negative means the period didn't cover overhead."
          variant={
            !loading && totals.netMargin < 0
              ? "alert"
              : totals.netMargin > 0 && totals.revenue > 0
                ? "coral"
                : "default"
          }
          value={loading ? "—" : formatGbp(totals.netMargin)}
          topRight={<StatusDot color={totals.netMargin >= 0 ? "bg-fx-green" : "bg-fx-red"} />}
          onShowDetails={() => setOpenModal("net")}
          detailsLabel="View net margin breakdown"
        />
      </div>

      <Modal
        open={openModal === "revenue"}
        onClose={() => setOpenModal(null)}
        title="Revenue breakdown"
        subtitle={`${totals.jobsCount} job${totals.jobsCount === 1 ? "" : "s"} · ${periodLabel} · ${formatGbp(totals.revenue)}`}
        size="lg"
      >
        <BreakdownTable
          rows={jobs}
          rowHref={(j) => `/jobs/${j.id}`}
          onRowNavigate={() => setOpenModal(null)}
          emptyLabel="No jobs in this period."
          columns={revenueColumns}
          totals={
            <div className="flex justify-between gap-4">
              <span>{totals.jobsCount} job{totals.jobsCount === 1 ? "" : "s"}</span>
              <span>{formatGbp(totals.revenue)}</span>
            </div>
          }
        />
      </Modal>

      <Modal
        open={openModal === "operating"}
        onClose={() => setOpenModal(null)}
        title="Operating cost breakdown"
        subtitle={`Partners + materials + expenses · ${periodLabel} · ${formatGbp(totals.operatingCost)}`}
        size="lg"
      >
        <BreakdownTable
          rows={jobs}
          rowHref={(j) => `/jobs/${j.id}`}
          onRowNavigate={() => setOpenModal(null)}
          emptyLabel="No jobs in this period."
          columns={operatingColumns}
          totals={
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <span>{totals.jobsCount} job{totals.jobsCount === 1 ? "" : "s"}</span>
              <span className="font-mono text-[11px] text-fx-mute">
                Partners {formatGbp(totals.partnerCost)} · Materials {formatGbp(totals.materialsCost)} · Expenses{" "}
                {formatGbp(totals.expenses)}
              </span>
              <span>{formatGbp(totals.operatingCost)}</span>
            </div>
          }
        />
      </Modal>

      <Modal
        open={isAdmin && openModal === "fixed"}
        onClose={() => setOpenModal(null)}
        title="Fixed costs breakdown"
        subtitle={`Workforce ${formatGbp(totals.workforce)} + Expenses ${formatGbp(totals.bills)} · ${periodLabel}`}
        size="lg"
      >
        <div className="space-y-5 py-4">
          <section>
            <div className="px-5 pb-2 flex items-center justify-between">
              <MicroLabel>Workforce</MicroLabel>
              <span className="text-[12px] font-medium text-text-primary tabular-nums">
                {formatGbp(totals.workforce)}
              </span>
            </div>
            <BreakdownTable
              rows={payroll}
              emptyLabel="No active payroll commitments."
              columns={workforceColumns}
            />
          </section>
          <section>
            <div className="px-5 pb-2 flex items-center justify-between">
              <MicroLabel>Recurring expenses</MicroLabel>
              <span className="text-[12px] font-medium text-text-primary tabular-nums">
                {formatGbp(totals.recurringBills)}
              </span>
            </div>
            <BreakdownTable
              rows={recurringExpenses}
              rowHref={() => "/finance/bills"}
              onRowNavigate={() => setOpenModal(null)}
              emptyLabel="No recurring expenses."
              columns={recurringExpenseColumns}
            />
          </section>
          <section>
            <div className="px-5 pb-2 flex items-center justify-between">
              <MicroLabel>One-off bills due in period</MicroLabel>
              <span className="text-[12px] font-medium text-text-primary tabular-nums">
                {formatGbp(totals.oneOffBills)}
              </span>
            </div>
            <BreakdownTable
              rows={bills}
              rowHref={() => "/finance/bills"}
              onRowNavigate={() => setOpenModal(null)}
              emptyLabel="No one-off bills due in this period."
              columns={billsColumns}
            />
          </section>
        </div>
      </Modal>

      <Modal
        open={openModal === "net"}
        onClose={() => setOpenModal(null)}
        title="Net margin breakdown"
        subtitle={`Revenue − Operating Cost − Fixed Costs · ${periodLabel}`}
        size="lg"
      >
        <div className="px-5 py-5">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SummaryRow label="Revenue" value={totals.revenue} tone="green" />
            <SummaryRow label="Operating Cost" value={-totals.operatingCost} tone="amber" />
            <SummaryRow label="Fixed Costs" value={-totals.fixedCost} tone="blue" />
            <SummaryRow
              label="Net Margin"
              value={totals.netMargin}
              tone={totals.netMargin >= 0 ? "green" : "red"}
              emphasis
            />
          </dl>
          <div className="mt-5 grid grid-cols-1 gap-2 text-[12px] text-fx-mute">
            <p>
              Partners <strong className="text-text-primary tabular-nums">{formatGbp(totals.partnerCost)}</strong>
              {" · "}Materials <strong className="text-text-primary tabular-nums">{formatGbp(totals.materialsCost)}</strong>
              {" · "}Expenses <strong className="text-text-primary tabular-nums">{formatGbp(totals.expenses)}</strong>
            </p>
            <p>
              Workforce <strong className="text-text-primary tabular-nums">{formatGbp(totals.workforce)}</strong>
              {" · "}Recurring <strong className="text-text-primary tabular-nums">{formatGbp(totals.recurringBills)}</strong>
              {" · "}One-off <strong className="text-text-primary tabular-nums">{formatGbp(totals.oneOffBills)}</strong>
            </p>
            <p>
              Margin {totals.netPct.toFixed(1)}% of revenue · {totals.jobsCount} job
              {totals.jobsCount === 1 ? "" : "s"} in pipeline.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

const revenueColumns: BreakdownColumn<JobDetail>[] = [
  {
    key: "job",
    label: "Job",
    render: (j) => (
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">{j.title?.trim() || "—"}</div>
        <div className="font-mono text-[10.5px] text-fx-mute mt-0.5">{j.reference ?? ""}</div>
      </div>
    ),
  },
  {
    key: "client",
    label: "Client",
    className: "min-w-[10rem]",
    render: (j) => (
      <div className="min-w-0">
        <div className="text-text-primary truncate">{j.client_name?.trim() || "—"}</div>
        {j.property_address?.trim() ? (
          <div className="text-[11px] text-fx-mute truncate" title={j.property_address}>
            {shortAddress(j.property_address)}
            {j.property_postcode ? (
              <span className="font-mono uppercase tracking-[0.05em] text-text-secondary ml-1">
                · {j.property_postcode}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: "account",
    label: "Account",
    className: "hidden md:table-cell min-w-[7rem]",
    render: (j) =>
      j.accountName?.trim() ? (
        <span className="text-text-primary truncate block">{j.accountName}</span>
      ) : (
        <span className="text-fx-mute italic">Direct</span>
      ),
  },
  {
    key: "partner",
    label: "Partner",
    className: "hidden md:table-cell min-w-[7rem]",
    render: (j) =>
      j.partner_name?.trim() ? (
        <span className="text-text-primary truncate block">{j.partner_name}</span>
      ) : (
        <span className="text-fx-mute italic">Unassigned</span>
      ),
  },
  {
    key: "status",
    label: "Status",
    className: "hidden lg:table-cell whitespace-nowrap",
    render: (j) => (j.status ? <RevenueStatusPill status={j.status} /> : <span className="text-fx-mute">—</span>),
  },
  {
    key: "date",
    label: "Start",
    className: "hidden sm:table-cell whitespace-nowrap",
    render: (j) => (
      <span className="font-mono text-[11.5px] text-fx-mute">{formatWhen(j.scheduled_start_at)}</span>
    ),
  },
  {
    key: "value",
    label: "Value",
    align: "right",
    render: (j) => (
      <span className="font-medium text-text-primary">
        {formatGbp(j.client_price + j.extras_amount)}
      </span>
    ),
  },
];

function RevenueStatusPill({ status }: { status: string }) {
  const label = jobStatusLabel(status);
  switch (status) {
    case "in_progress":
      return <Pill tone="info">{label}</Pill>;
    case "final_check":
      return <Pill tone="violet">{label}</Pill>;
    case "late":
    case "need_attention":
    case "unassigned":
    case "auto_assigning":
      return <Pill tone="bad">{label}</Pill>;
    case "scheduled":
    case "completed":
      return <Pill tone="ok">{label}</Pill>;
    case "awaiting_payment":
    case "on_hold":
      return <Pill tone="warn">{label}</Pill>;
    default:
      return <Pill tone="ghost">{label}</Pill>;
  }
}

const operatingColumns: BreakdownColumn<JobDetail>[] = [
  {
    key: "job",
    label: "Job",
    render: (j) => (
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">{j.title?.trim() || "—"}</div>
        <div className="font-mono text-[10.5px] text-fx-mute mt-0.5">
          {j.reference ?? ""} · {j.client_name?.trim() || "—"}
        </div>
      </div>
    ),
  },
  {
    key: "partner",
    label: "Partner",
    align: "right",
    className: "hidden sm:table-cell",
    render: (j) => <span className="text-text-primary">{formatGbp(j.partner_cost)}</span>,
  },
  {
    key: "materials",
    label: "Materials",
    align: "right",
    className: "hidden md:table-cell",
    render: (j) => <span className="text-text-primary">{formatGbp(j.materials_cost)}</span>,
  },
  {
    key: "expenses",
    label: "Expenses",
    align: "right",
    className: "hidden lg:table-cell",
    render: (j) => <span className="text-text-primary">{formatGbp(j.expenses)}</span>,
  },
  {
    key: "total",
    label: "Total",
    align: "right",
    render: (j) => (
      <span className="font-medium text-text-primary">
        {formatGbp(j.partner_cost + j.materials_cost + j.expenses)}
      </span>
    ),
  },
];

const workforceColumns: BreakdownColumn<PayrollDetail>[] = [
  {
    key: "person",
    label: "Person",
    render: (p) => (
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">
          {p.payee_name?.trim() || p.description?.trim() || "Team member"}
        </div>
        {p.lifecycle_stage && p.lifecycle_stage !== "active" ? (
          <div className="font-mono text-[10.5px] text-fx-mute mt-0.5 uppercase tracking-[0.1em]">
            {p.lifecycle_stage}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: "monthly",
    label: "Monthly",
    align: "right",
    className: "hidden sm:table-cell",
    render: (p) => <span className="text-text-primary">{formatGbp(p.amount)}</span>,
  },
  {
    key: "applied",
    label: "Period share",
    align: "right",
    render: (p) => <span className="font-medium text-text-primary">{formatGbp(p.proratedAmount)}</span>,
  },
];

const recurringExpenseColumns: BreakdownColumn<RecurringExpenseDetail>[] = [
  {
    key: "description",
    label: "Expense",
    render: (line) => (
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">{line.description}</div>
        {line.category ? (
          <div className="font-mono text-[10.5px] text-fx-mute mt-0.5 uppercase tracking-[0.08em]">
            {line.category}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: "monthly",
    label: "Monthly",
    align: "right",
    className: "hidden sm:table-cell",
    render: (line) => <span className="text-text-primary">{formatGbp(line.monthlyAmount)}</span>,
  },
  {
    key: "period",
    label: "Period share",
    align: "right",
    render: (line) => <span className="font-medium text-text-primary">{formatGbp(line.periodAmount)}</span>,
  },
];

const billsColumns: BreakdownColumn<BillDetail>[] = [
  {
    key: "description",
    label: "Bill",
    render: (b) => (
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">{b.description}</div>
        {b.category ? (
          <div className="font-mono text-[10.5px] text-fx-mute mt-0.5 uppercase tracking-[0.08em]">
            {b.category}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: "due",
    label: "Due",
    className: "hidden sm:table-cell whitespace-nowrap",
    render: (b) => (
      <span className="font-mono text-[11.5px] text-fx-mute">{formatDay(b.due_date)}</span>
    ),
  },
  {
    key: "status",
    label: "Status",
    className: "hidden md:table-cell uppercase tracking-[0.08em] text-[10.5px] font-mono text-fx-mute",
    render: (b) => <span>{b.status ?? "—"}</span>,
  },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (b) => <span className="font-medium text-text-primary">{formatGbp(b.amount)}</span>,
  },
];

function SummaryRow({
  label,
  value,
  tone,
  emphasis = false,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "blue" | "red";
  emphasis?: boolean;
}) {
  const toneClass =
    tone === "green"
      ? "text-fx-green"
      : tone === "amber"
        ? "text-fx-amber"
        : tone === "blue"
          ? "text-fx-blue"
          : "text-fx-red";
  return (
    <div
      className={cn(
        "rounded-lg border border-fx-line bg-card px-4 py-3",
        emphasis && "border-fx-line-2 bg-fx-paper-2/30",
      )}
    >
      <MicroLabel>{label}</MicroLabel>
      <div className={cn("mt-1 text-[20px] font-semibold tabular-nums", toneClass)}>
        {formatGbpSigned(value)}
      </div>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full inline-block", color)} aria-hidden />;
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatGbpCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = n / 1000;
    const rounded = Math.abs(k) >= 10 ? k.toFixed(0) : k.toFixed(1);
    return `£${rounded}k`;
  }
  return formatGbp(n);
}

function formatGbpSigned(n: number): string {
  const sign = n < 0 ? "−" : "";
  return sign + formatGbp(Math.abs(n));
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "d MMM · HH:mm");
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return format(d, "d MMM yyyy");
}

function shortAddress(addr: string): string {
  return addr.split(",").slice(0, 2).join(",").trim();
}
