import { addDaysYmd } from "@/lib/billing-standalone-period";
import type { CustomerPaymentRow } from "@/lib/billing-invoice-list-data";
import { invoiceListBalanceDue } from "@/lib/billing-invoice-list-data";
import {
  buildCashflowWeekBreakdown,
  buildCashflowWeekly,
  compactWeekColumnLabels,
  type BuildCashflowWeeklyArgs,
  type CashflowBreakdownLine,
  type CashflowWeek,
  type CashflowWeekBreakdown,
} from "@/lib/billing-standalone-metrics";
import {
  dueDateIsoFromAccountPaymentTerms,
  type AccountPaymentOrgContext,
} from "@/lib/account-payment-due-date";
import type { PayrollRunwayRow, PipelineJobRunwayRow } from "@/lib/billing-standalone-fetch";
import { jobBillableRevenue } from "@/lib/job-financials";
import { cashflowSlicesForInvoice, hasActivePaymentPlan } from "@/lib/invoice-payment-plan";
import { startOfWeekMondayFromYmd } from "@/lib/dashboard-cashflow-buckets";
import type { Invoice } from "@/types/database";

export type RunwayViewMode = "accrual" | "cash" | "pl";

export type { CustomerPaymentRow } from "@/lib/billing-invoice-list-data";
export type { PayrollRunwayRow, PipelineJobRunwayRow } from "@/lib/billing-standalone-fetch";

export type CashRunwayBalanceOptions = {
  defaultOpening: number;
  weekOverrides: Record<string, number>;
};

export type BuildRunwayWeeklyArgs = BuildCashflowWeeklyArgs & {
  customerPaymentRows?: CustomerPaymentRow[];
  cashBalanceOptions?: CashRunwayBalanceOptions;
  payrollRunwayRows?: PayrollRunwayRow[];
  pipelineJobs?: PipelineJobRunwayRow[];
  clientIdToAccountId?: Record<string, string>;
  accountTermsById?: Record<string, string>;
  paymentOrgCtx?: AccountPaymentOrgContext;
};

const DEFAULT_CASHFLOW_WEEKS = 10;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdInWeekBounds(ymd: string, weekStart: string): boolean {
  const weekEnd = addDaysYmd(weekStart, 6);
  return ymd >= weekStart && ymd <= weekEnd;
}

function weekRange(
  anchor: string,
  endYmd: string | undefined,
  weekCount: number | undefined,
  todayYmd: string,
): string[] {
  let weekStart = startOfWeekMondayFromYmd(anchor);
  const lastWeekMonday = endYmd
    ? startOfWeekMondayFromYmd(endYmd)
    : addDaysYmd(startOfWeekMondayFromYmd(todayYmd), 7 * ((weekCount ?? DEFAULT_CASHFLOW_WEEKS) - 1));
  const starts: string[] = [];
  while (weekStart <= lastWeekMonday) {
    starts.push(weekStart);
    weekStart = addDaysYmd(weekStart, 7);
    if (!endYmd && starts.length >= (weekCount ?? DEFAULT_CASHFLOW_WEEKS)) break;
  }
  return starts;
}

function isProjectionPipelineInvoice(inv: Invoice): boolean {
  return inv.status !== "paid" && inv.status !== "cancelled";
}

function projectionInvoiceAmount(
  inv: Invoice,
  args: Omit<BuildCashflowWeeklyArgs, "startYmd" | "endYmd" | "weekCount">,
): number {
  if (inv.status === "draft") {
    return Math.max(0, roundMoney(Number(inv.amount ?? 0)));
  }
  return Math.max(0, invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId));
}

function projectionMoneyInForInvoiceInWeek(
  inv: Invoice,
  weekStart: string,
  args: Omit<BuildCashflowWeeklyArgs, "startYmd" | "endYmd" | "weekCount">,
): number {
  if (!isProjectionPipelineInvoice(inv)) return 0;
  const installments = args.installmentsByInvoiceId?.[inv.id];
  if (hasActivePaymentPlan(installments)) {
    return cashflowSlicesForInvoice(inv, installments)
      .filter((s) => ymdInWeekBounds(s.dueYmd, weekStart))
      .reduce((sum, s) => sum + s.amount, 0);
  }
  const dueYmd = (inv.due_date ?? inv.created_at ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueYmd) || !ymdInWeekBounds(dueYmd, weekStart)) return 0;
  return projectionInvoiceAmount(inv, args);
}

function pipelineJobScheduleYmd(job: PipelineJobRunwayRow): string | null {
  const sched = job.scheduled_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(sched)) return sched;
  const startAt = job.scheduled_start_at?.trim().slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(startAt) ? startAt : null;
}

function pipelineJobExpectedDueYmd(
  job: PipelineJobRunwayRow,
  clientIdToAccountId: Record<string, string>,
  accountTermsById: Record<string, string>,
  orgCtx?: AccountPaymentOrgContext,
): string | null {
  const sched = pipelineJobScheduleYmd(job);
  if (!sched) return null;
  const accountId = job.client_id ? clientIdToAccountId[job.client_id] : undefined;
  const terms = accountId ? accountTermsById[accountId] : undefined;
  return dueDateIsoFromAccountPaymentTerms(new Date(`${sched}T12:00:00`), terms ?? null, orgCtx);
}

function pipelineJobBillableRevenue(job: PipelineJobRunwayRow): number {
  return jobBillableRevenue({
    client_price: job.client_price,
    extras_amount: job.extras_amount ?? undefined,
  });
}

function projectionMoneyInForPipelineJobInWeek(
  job: PipelineJobRunwayRow,
  weekStart: string,
  args: BuildRunwayWeeklyArgs,
): number {
  const dueYmd = pipelineJobExpectedDueYmd(
    job,
    args.clientIdToAccountId ?? {},
    args.accountTermsById ?? {},
    args.paymentOrgCtx,
  );
  if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) return 0;
  const amount = roundMoney(pipelineJobBillableRevenue(job));
  return amount > 0.02 ? amount : 0;
}

function payrollMoneyOutForWeek(weekStart: string, rows: PayrollRunwayRow[]): number {
  let sum = 0;
  for (const row of rows) {
    if (!ymdInWeekBounds(row.dueYmd, weekStart)) continue;
    sum += row.amount;
  }
  return roundMoney(sum);
}

function cashPaidInForWeek(weekStart: string, rows: CustomerPaymentRow[]): number {
  let sum = 0;
  for (const row of rows) {
    if (!ymdInWeekBounds(row.paymentDate, weekStart)) continue;
    sum += row.amount;
  }
  return roundMoney(sum);
}

function cashPaidOutForWeek(
  weekStart: string,
  args: Omit<BuildCashflowWeeklyArgs, "startYmd" | "endYmd" | "weekCount">,
): number {
  let sum = 0;
  for (const sb of args.selfBills) {
    const pd = sb.wise_paid_at?.trim().slice(0, 10) ?? "";
    if (!pd || !ymdInWeekBounds(pd, weekStart)) continue;
    sum += Number(sb.net_payout ?? 0);
  }
  for (const bill of args.bills ?? []) {
    if (bill.status !== "paid") continue;
    const pd = bill.paid_at?.trim().slice(0, 10) ?? "";
    if (!pd || !ymdInWeekBounds(pd, weekStart)) continue;
    sum += Number(bill.amount ?? 0);
  }
  return roundMoney(sum);
}

function projectedMoneyOutForWeek(
  weekStart: string,
  args: BuildRunwayWeeklyArgs,
): number {
  const plWeeks = buildCashflowWeekly({
    ...args,
    startYmd: weekStart,
    endYmd: addDaysYmd(weekStart, 6),
    weekCount: 1,
  });
  const payroll = payrollMoneyOutForWeek(weekStart, args.payrollRunwayRows ?? []);
  return roundMoney((plWeeks[0]?.moneyOut ?? 0) + payroll);
}

function shouldUseProjectedCashOut(weekStart: string, todayYmd: string): boolean {
  const weekEnd = addDaysYmd(weekStart, 6);
  return weekEnd >= todayYmd;
}

export function applyCashRunwayBalances(
  weeks: CashflowWeek[],
  options: CashRunwayBalanceOptions,
): CashflowWeek[] {
  let running = roundMoney(options.defaultOpening);
  return weeks.map((w) => {
    const override = options.weekOverrides[w.weekStart];
    const opening = override !== undefined ? roundMoney(override) : running;
    const closing = roundMoney(opening + w.moneyIn - w.moneyOut);
    running = closing;
    return { ...w, openingBalance: opening, closingBalance: closing };
  });
}

/** Full forward projection: pipeline revenue + all costs due + optional running balance. */
export function buildProjectionRunwayWeekly(args: BuildRunwayWeeklyArgs): CashflowWeek[] {
  const todayYmd = todayYmdLocal();
  const anchor = args.startYmd ?? todayYmd;
  const starts = weekRange(anchor, args.endYmd, args.weekCount, todayYmd);

  const weeks = starts.map((weekStart) => {
    let moneyIn = 0;
    for (const inv of args.invoices) {
      moneyIn += projectionMoneyInForInvoiceInWeek(inv, weekStart, args);
    }
    for (const job of args.pipelineJobs ?? []) {
      moneyIn += projectionMoneyInForPipelineJobInWeek(job, weekStart, args);
    }
    const plOut =
      buildCashflowWeekly({
        ...args,
        startYmd: weekStart,
        endYmd: addDaysYmd(weekStart, 6),
        weekCount: 1,
      })[0]?.moneyOut ?? 0;
    const moneyOut = roundMoney(plOut + payrollMoneyOutForWeek(weekStart, args.payrollRunwayRows ?? []));
    const labels = compactWeekColumnLabels(weekStart);
    return {
      weekStart,
      ...labels,
      moneyIn: roundMoney(moneyIn),
      moneyOut,
      isCurrentWeek: ymdInWeekBounds(todayYmd, weekStart),
    };
  });

  if (args.cashBalanceOptions) {
    return applyCashRunwayBalances(weeks, args.cashBalanceOptions);
  }
  return weeks;
}

export function buildAccrualRunwayWeekly(args: BuildRunwayWeeklyArgs): CashflowWeek[] {
  return buildProjectionRunwayWeekly(args);
}

export function buildCashRunwayWeekly(args: BuildRunwayWeeklyArgs): CashflowWeek[] {
  const todayYmd = todayYmdLocal();
  const anchor = args.startYmd ?? todayYmd;
  const starts = weekRange(anchor, args.endYmd, args.weekCount, todayYmd);
  const paymentRows = args.customerPaymentRows ?? [];

  const weeks = starts.map((weekStart) => {
    const moneyIn = cashPaidInForWeek(weekStart, paymentRows);
    const moneyOut = shouldUseProjectedCashOut(weekStart, todayYmd)
      ? projectedMoneyOutForWeek(weekStart, args)
      : cashPaidOutForWeek(weekStart, args);
    const labels = compactWeekColumnLabels(weekStart);
    return {
      weekStart,
      ...labels,
      moneyIn,
      moneyOut,
      isCurrentWeek: ymdInWeekBounds(todayYmd, weekStart),
    };
  });

  if (args.cashBalanceOptions) {
    return applyCashRunwayBalances(weeks, args.cashBalanceOptions);
  }
  return weeks;
}

export function buildRunwayWeekly(view: RunwayViewMode, args: BuildRunwayWeeklyArgs): CashflowWeek[] {
  if (view === "pl") return buildCashflowWeekly(args);
  if (view === "accrual") return buildAccrualRunwayWeekly(args);
  return buildCashRunwayWeekly(args);
}

function invoiceStatusLabel(inv: Invoice): string {
  if (inv.status === "draft") return "Draft";
  if (inv.status === "partially_paid") return "Partial";
  if (inv.status === "on_hold") return "On hold";
  return "Awaiting payment";
}

export function buildProjectionRunwayWeekBreakdown(
  weekStart: string,
  args: BuildRunwayWeeklyArgs,
): CashflowWeekBreakdown {
  const inLines: CashflowBreakdownLine[] = [];
  const outLines: CashflowBreakdownLine[] = [];

  for (const inv of args.invoices) {
    if (!isProjectionPipelineInvoice(inv)) continue;
    const installments = args.installmentsByInvoiceId?.[inv.id];
    if (hasActivePaymentPlan(installments)) {
      for (const slice of cashflowSlicesForInvoice(inv, installments)) {
        if (!ymdInWeekBounds(slice.dueYmd, weekStart) || slice.amount <= 0.02) continue;
        inLines.push({
          id: slice.installmentId,
          kind: "invoice",
          label: inv.client_name?.trim() || "Invoice",
          detail: `${slice.detail ?? inv.job_reference?.trim() ?? "—"} · ${invoiceStatusLabel(inv)} · installment`,
          dueYmd: slice.dueYmd,
          amount: roundMoney(slice.amount),
        });
      }
      continue;
    }
    const dueYmd = (inv.due_date ?? inv.created_at ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueYmd) || !ymdInWeekBounds(dueYmd, weekStart)) continue;
    const amount = projectionInvoiceAmount(inv, args);
    if (amount <= 0.02) continue;
    inLines.push({
      id: inv.id,
      kind: "invoice",
      label: inv.client_name?.trim() || "Invoice",
      detail: `${inv.job_reference?.trim() || inv.reference?.trim() || "—"} · ${invoiceStatusLabel(inv)}`,
      dueYmd,
      amount,
    });
  }

  for (const job of args.pipelineJobs ?? []) {
    const dueYmd = pipelineJobExpectedDueYmd(
      job,
      args.clientIdToAccountId ?? {},
      args.accountTermsById ?? {},
      args.paymentOrgCtx,
    );
    if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) continue;
    const amount = roundMoney(pipelineJobBillableRevenue(job));
    if (amount <= 0.02) continue;
    inLines.push({
      id: job.id,
      kind: "invoice",
      label: job.client_name?.trim() || "Scheduled job",
      detail: `${job.reference?.trim() || "—"} · Scheduled · no invoice yet`,
      dueYmd,
      amount,
    });
  }

  const plBreakdown = buildCashflowWeekBreakdown(weekStart, args);
  for (const line of plBreakdown.outLines) {
    if (line.kind === "self_bill") {
      outLines.push(line);
    } else {
      outLines.push({ ...line, detail: line.detail ? `${line.detail} · Admin` : "Admin" });
    }
  }

  for (const row of args.payrollRunwayRows ?? []) {
    if (!ymdInWeekBounds(row.dueYmd, weekStart) || row.amount <= 0.02) continue;
    outLines.push({
      id: row.id,
      kind: "payroll",
      label: row.label,
      detail: "Payroll · pending",
      dueYmd: row.dueYmd,
      amount: row.amount,
    });
  }

  inLines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  outLines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const { title } = compactWeekColumnLabels(weekStart);
  return {
    weekStart,
    title,
    moneyIn: roundMoney(inLines.reduce((s, l) => s + l.amount, 0)),
    moneyOut: roundMoney(outLines.reduce((s, l) => s + l.amount, 0)),
    inLines,
    outLines,
  };
}

export function buildAccrualRunwayWeekBreakdown(
  weekStart: string,
  args: BuildRunwayWeeklyArgs,
): CashflowWeekBreakdown {
  return buildProjectionRunwayWeekBreakdown(weekStart, args);
}

export function buildCashRunwayWeekBreakdown(
  weekStart: string,
  args: BuildRunwayWeeklyArgs,
): CashflowWeekBreakdown {
  const todayYmd = todayYmdLocal();
  const inLines: CashflowBreakdownLine[] = [];
  const outLines: CashflowBreakdownLine[] = [];
  const jobsByRef = args.jobsByRef;

  for (const row of args.customerPaymentRows ?? []) {
    if (!ymdInWeekBounds(row.paymentDate, weekStart)) continue;
    if (row.amount <= 0.02) continue;
    const job = Object.values(jobsByRef).find((j) => j.id === row.jobId);
    inLines.push({
      id: row.id,
      kind: "invoice",
      label: job?.title?.trim() || "Customer payment",
      detail: `Paid ${row.paymentDate} · ${row.type.replace(/_/g, " ")}`,
      dueYmd: row.paymentDate,
      amount: roundMoney(row.amount),
    });
  }

  if (shouldUseProjectedCashOut(weekStart, todayYmd)) {
    const projected = buildProjectionRunwayWeekBreakdown(weekStart, args);
    for (const line of projected.outLines) {
      outLines.push({
        ...line,
        detail: line.detail ? `${line.detail} · Projected` : "Projected due",
      });
    }
  } else {
    for (const sb of args.selfBills) {
      const pd = sb.wise_paid_at?.trim().slice(0, 10) ?? "";
      if (!pd || !ymdInWeekBounds(pd, weekStart)) continue;
      const amount = roundMoney(Number(sb.net_payout ?? 0));
      if (amount <= 0.02) continue;
      outLines.push({
        id: sb.id,
        kind: "self_bill",
        label: sb.partner_name?.trim() || "Partner",
        detail: `Paid ${pd}`,
        dueYmd: pd,
        amount,
      });
    }
    for (const bill of args.bills ?? []) {
      if (bill.status !== "paid") continue;
      const pd = bill.paid_at?.trim().slice(0, 10) ?? "";
      if (!pd || !ymdInWeekBounds(pd, weekStart)) continue;
      const amount = roundMoney(Number(bill.amount ?? 0));
      if (amount <= 0.02) continue;
      outLines.push({
        id: bill.id,
        kind: "expense",
        label: bill.description?.trim() || "Expense",
        detail: `Paid ${pd}`,
        dueYmd: pd,
        amount,
      });
    }
  }

  inLines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  outLines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const { title } = compactWeekColumnLabels(weekStart);
  return {
    weekStart,
    title,
    moneyIn: roundMoney(inLines.reduce((s, l) => s + l.amount, 0)),
    moneyOut: roundMoney(outLines.reduce((s, l) => s + l.amount, 0)),
    inLines,
    outLines,
  };
}

export function buildRunwayWeekBreakdown(
  view: RunwayViewMode,
  weekStart: string,
  args: BuildRunwayWeeklyArgs,
): CashflowWeekBreakdown {
  if (view === "pl") return buildCashflowWeekBreakdown(weekStart, args);
  if (view === "accrual") return buildAccrualRunwayWeekBreakdown(weekStart, args);
  return buildCashRunwayWeekBreakdown(weekStart, args);
}
