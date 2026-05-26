"use client";

import { useEffect, useMemo, useState } from "react";
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
import { KpiCard, MicroLabel, Pill } from "@/components/fx/primitives";
import { Modal } from "@/components/ui/modal";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import { BreakdownTable, type BreakdownColumn } from "./financials-detail-modal";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { extractUkPostcode } from "@/lib/uk-postcode";

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

type BillDetail = {
  id: string;
  description: string;
  amount: number;
  due_date: string | null;
  status: string | null;
  category: string | null;
};

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
  const [jobs, setJobs] = useState<JobDetail[]>([]);
  const [bills, setBills] = useState<BillDetail[]>([]);
  const [payroll, setPayroll] = useState<PayrollDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState<DetailModal>(null);

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
          .select("id, description, amount, status, due_date, category")
          .is("archived_at", null)
          .neq("status", "rejected")
          .gte("due_date", fromDay)
          .lte("due_date", toDay)
          .order("due_date", { ascending: true }),
        supabase
          .from("payroll_internal_costs")
          .select("id, amount, lifecycle_stage, payee_name, description")
          .neq("lifecycle_stage", "offboard")
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
      }>;
      const billsDetail: BillDetail[] = billRows.map((b) => ({
        id: b.id,
        description: (b.description ?? "").trim() || "Bill",
        amount: Number(b.amount) || 0,
        due_date: b.due_date,
        status: b.status,
        category: b.category,
      }));

      const setup: FrontendSetup = parseFrontendSetup(
        (settingsRes.data as { frontend_setup?: unknown } | null)?.frontend_setup,
      );
      const fromDate = bounds ? new Date(bounds.fromIso) : startOfDay(now);
      const toDate = bounds ? new Date(bounds.toIso) : endOfDay(now);
      const workingDaysInWindow = countWorkingDaysInRange(fromDate, toDate, setup);
      const monthlyDivisor = monthlyWorkingDays(setup);
      const workforceFactor =
        bounds && monthlyDivisor > 0 ? workingDaysInWindow / monthlyDivisor : 1;

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

      setJobs(jobsDetail);
      setBills(billsDetail);
      setPayroll(payrollDetail);
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
    const billsTotal = bills.reduce((a, b) => a + b.amount, 0);
    const workforce = payroll.reduce((a, p) => a + p.proratedAmount, 0);
    const operatingCost = partnerCost + materialsCost + expenses;
    const fixedCost = workforce + billsTotal;
    const netMargin = revenue - operatingCost - fixedCost;
    return {
      revenue,
      partnerCost,
      materialsCost,
      expenses,
      operatingCost,
      workforce,
      bills: billsTotal,
      fixedCost,
      netMargin,
      opsPct: revenue > 0 ? (operatingCost / revenue) * 100 : 0,
      fixedPct: revenue > 0 ? (fixedCost / revenue) * 100 : 0,
      netPct: revenue > 0 ? (netMargin / revenue) * 100 : 0,
      jobsCount: jobs.length,
    };
  }, [jobs, bills, payroll]);

  const periodLabel = bounds ? rangeLabel : "this month";

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue"
          hint="Total client price + extras for jobs in the active pipeline (excludes On Hold, Cancelled, Deleted)."
          value={loading ? "—" : formatGbp(totals.revenue)}
          sub={
            loading
              ? "Loading…"
              : `${totals.jobsCount} job${totals.jobsCount === 1 ? "" : "s"} · Active Pipeline${
                  bounds ? ` · ${rangeLabel}` : ""
                }`
          }
          topRight={<StatusDot color="bg-fx-green" />}
          onShowDetails={() => setOpenModal("revenue")}
          detailsLabel="View revenue breakdown"
        />
        <KpiCard
          label="Operating Cost"
          hint="Partner cost + materials + per-job expenses for the same pipeline."
          value={loading ? "—" : formatGbp(totals.operatingCost)}
          sub={
            loading
              ? "Loading…"
              : `${totals.opsPct.toFixed(1)}% · Partners · Materials · Expenses`
          }
          topRight={<StatusDot color="bg-fx-amber" />}
          onShowDetails={() => setOpenModal("operating")}
          detailsLabel="View operating cost breakdown"
        />
        <KpiCard
          label="Fixed Costs"
          hint="Workforce + bills allocated to this period. Workforce is each active person's monthly commitment pro-rated by working days in the window. Bills only count when their due_date falls inside the window."
          value={loading ? "—" : formatGbp(totals.fixedCost)}
          sub={
            loading
              ? "Loading…"
              : `${totals.fixedPct.toFixed(1)}% · Workforce £${formatNum(totals.workforce)} + Bills £${formatNum(totals.bills)}`
          }
          topRight={<StatusDot color="bg-fx-blue" />}
          onShowDetails={() => setOpenModal("fixed")}
          detailsLabel="View fixed cost breakdown"
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
          sub={loading ? "Loading…" : `${totals.netPct.toFixed(1)}% of revenue`}
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
        open={openModal === "fixed"}
        onClose={() => setOpenModal(null)}
        title="Fixed costs breakdown"
        subtitle={`Workforce ${formatGbp(totals.workforce)} + Bills ${formatGbp(totals.bills)} · ${periodLabel}`}
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
              <MicroLabel>Bills due in period</MicroLabel>
              <span className="text-[12px] font-medium text-text-primary tabular-nums">
                {formatGbp(totals.bills)}
              </span>
            </div>
            <BreakdownTable
              rows={bills}
              rowHref={() => "/finance/bills"}
              onRowNavigate={() => setOpenModal(null)}
              emptyLabel="No bills due in this period."
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
              {" · "}Bills <strong className="text-text-primary tabular-nums">{formatGbp(totals.bills)}</strong>
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

function formatGbpSigned(n: number): string {
  const sign = n < 0 ? "−" : "";
  return sign + formatGbp(Math.abs(n));
}

function formatNum(n: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(n);
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
