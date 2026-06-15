import {
  invoiceDisplayDueYmd,
  invoiceFinanceListTodayYmd,
  invoiceIsDerivedOverdue,
} from "@/lib/invoice-finance-tab";
import {
  resolveSelfBillDueYmd,
  type SelfBillDueResolveContext,
} from "@/lib/partner-payout-schedule";
import {
  computeWorkforcePayDueDate,
  WORKFORCE_MONTHLY_PAY_DAY,
} from "@/lib/workforce-pay-schedule";
import {
  addDaysYmd,
  daysBetweenYmd,
  invoiceDueYmd,
  invoicePaidYmd,
  selfBillPayWorkPeriodInPeriod,
  selfBillWorkWeekInPeriod,
  todayYmdLocal,
  ymdInBounds,
  type YmdBounds,
} from "@/lib/billing-standalone-period";
import {
  effectiveInvoiceSourceAccountId,
  invoiceListBalanceDue,
  isInvoiceCollectible,
  type InvoiceListJobSnapshot,
} from "@/lib/billing-invoice-list-data";
import { computeSelfBillAmountDue, type SelfBillJobLine } from "@/lib/billing-selfbill-actions";
import { startOfWeekMondayFromYmd, weekRangeLabel } from "@/lib/dashboard-cashflow-buckets";
import { isSelfBillPayoutVoided } from "@/services/self-bills";
import {
  cashflowSlicesForInvoice,
  daysLateWithPlan,
  hasActivePaymentPlan,
  paymentPlanProgressLabel,
} from "@/lib/invoice-payment-plan";
import {
  cashflowSlicesForSelfBill,
  hasActiveSelfBillPaymentPlan,
} from "@/lib/self-bill-payment-plan";
import type { Bill, Invoice, InvoicePaymentInstallment, SelfBill, SelfBillPaymentInstallment } from "@/types/database";

const DEFAULT_CASHFLOW_WEEKS = 8;

export type AgingBucket = "current" | "d1_7" | "d8_30" | "d30plus";

const READY_SB = new Set(["ready_to_pay", "pending_review", "awaiting_payment", "audit_required"]);

export function selfBillDueYmd(
  sb: Pick<SelfBill, "week_end" | "due_date" | "partner_id" | "bill_origin">,
  dueCtx: SelfBillDueResolveContext,
): string {
  if (sb.bill_origin === "internal") {
    const stored = sb.due_date?.trim().slice(0, 10) ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    const we = sb.week_end?.trim().slice(0, 10) ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(we)) {
      return computeWorkforcePayDueDate(we, WORKFORCE_MONTHLY_PAY_DAY);
    }
    return "";
  }
  return resolveSelfBillDueYmd(sb, dueCtx);
}

export function selfBillCountsAsReady(sb: Pick<SelfBill, "status">): boolean {
  return READY_SB.has(sb.status);
}

export function selfBillCountsAsApprovedForPayout(
  sb: Pick<SelfBill, "status" | "approved_at" | "wise_paid_at">,
): boolean {
  return selfBillCountsAsReady(sb) && !!sb.approved_at && !sb.wise_paid_at && !isSelfBillPayoutVoided(sb);
}

export type SelfBillCashflowOutTier = "approved" | "ready" | "draft";

/** Cash-Flow Runway forecast: approved + ready (unapproved) + draft/accumulating — not KPI payout queue. */
export function selfBillCountsAsCashflowForecastOut(
  sb: Pick<SelfBill, "status" | "approved_at" | "wise_paid_at">,
): boolean {
  if (isSelfBillPayoutVoided(sb)) return false;
  if (sb.wise_paid_at) return false;
  if (sb.status === "paid") return false;
  if (selfBillCountsAsApprovedForPayout(sb)) return true;
  if (selfBillCountsAsReady(sb) && !sb.approved_at) return true;
  if (sb.status === "draft" || sb.status === "accumulating") return true;
  return false;
}

export function selfBillCashflowOutTier(
  sb: Pick<SelfBill, "status" | "approved_at" | "wise_paid_at">,
): SelfBillCashflowOutTier | null {
  if (!selfBillCountsAsCashflowForecastOut(sb)) return null;
  if (selfBillCountsAsApprovedForPayout(sb)) return "approved";
  if (selfBillCountsAsReady(sb)) return "ready";
  return "draft";
}

const OPEN_BILL_STATUSES = new Set<Bill["status"]>(["submitted", "approved", "needs_attention"]);

export function billCountsAsOpenForCashflow(
  bill: Pick<Bill, "status" | "archived_at">,
): boolean {
  if (bill.archived_at) return false;
  return OPEN_BILL_STATUSES.has(bill.status);
}

export function isSelfBillOverdue(
  sb: Pick<SelfBill, "status" | "week_end" | "due_date" | "partner_id">,
  todayYmd: string,
  dueCtx: SelfBillDueResolveContext,
): boolean {
  if (!selfBillCountsAsReady(sb)) return false;
  const due = selfBillDueYmd(sb, dueCtx);
  return Boolean(due && todayYmd > due);
}

export function agingBucketForDue(dueYmd: string, todayYmd: string): AgingBucket {
  const daysLate = daysBetweenYmd(dueYmd, todayYmd);
  if (daysLate <= 0) return "current";
  if (daysLate <= 7) return "d1_7";
  if (daysLate <= 30) return "d8_30";
  return "d30plus";
}

export type BillingKpis = {
  toCollect: number;
  toCollectCount: number;
  toCollectAvg: number;
  overdue: number;
  overdueCount: number;
  oldestOverdueDays: number;
  toPaySelfBills: number;
  toPayPartnerCount: number;
  nextRunLabel: string;
  netWeek: number;
  weekIn: number;
  weekOut: number;
  collectedMtd: number;
  collectedMtdCount: number;
  onTimePct: number | null;
};

export function computeBillingKpis(args: {
  invoices: Invoice[];
  selfBills: SelfBill[];
  jobsByRef: Record<string, InvoiceListJobSnapshot>;
  customerPaidByJobId: Record<string, number>;
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>;
  partnerPaidByJobId: Record<string, number>;
  dueCtx: SelfBillDueResolveContext;
  periodBounds: YmdBounds | null;
  selfBillPeriodBounds?: YmdBounds | null;
}): BillingKpis {
  const todayYmd = invoiceFinanceListTodayYmd();
  const periodFrom = args.periodBounds?.from ?? "";
  const periodTo = args.periodBounds?.to ?? "";
  const sbBounds = args.selfBillPeriodBounds ?? args.periodBounds;
  const sbInPeriod = (sb: Parameters<typeof selfBillPayWorkPeriodInPeriod>[0]) =>
    !sbBounds || selfBillPayWorkPeriodInPeriod(sb, sbBounds);

  let toCollect = 0;
  let toCollectCount = 0;
  let overdue = 0;
  let overdueCount = 0;
  let oldestOverdueDays = 0;

  for (const inv of args.invoices) {
    if (!isInvoiceCollectible(inv, args.jobsByRef, todayYmd)) continue;
    const due = invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId);
    if (due <= 0.02) continue;
    toCollect += due;
    toCollectCount += 1;
    if (invoiceIsDerivedOverdue(inv, todayYmd)) {
      overdue += due;
      overdueCount += 1;
      const dueYmd = invoiceDueYmd(inv);
      if (dueYmd) {
        const late = daysBetweenYmd(dueYmd, todayYmd);
        if (late > oldestOverdueDays) oldestOverdueDays = late;
      }
    }
  }

  let toPaySelfBills = 0;
  const partnerIds = new Set<string>();
  let nextDue = "";
  for (const sb of args.selfBills) {
    if (!selfBillCountsAsApprovedForPayout(sb)) continue;
    if (!sbInPeriod(sb)) continue;
    const amt = computeSelfBillAmountDue(sb, args.jobsBySelfBillId[sb.id], args.partnerPaidByJobId);
    if (amt <= 0.02) continue;
    toPaySelfBills += amt;
    if (sb.partner_id?.trim()) partnerIds.add(sb.partner_id.trim());
    const dueYmd = selfBillDueYmd(sb, args.dueCtx);
    if (dueYmd && (!nextDue || dueYmd < nextDue)) nextDue = dueYmd;
  }

  let weekIn = 0;
  let weekOut = 0;
  for (const inv of args.invoices) {
    if (!isInvoiceCollectible(inv, args.jobsByRef, todayYmd)) continue;
    const dueYmd = invoiceDueYmd(inv);
    if (args.periodBounds) {
      if (!dueYmd || dueYmd < periodFrom || dueYmd > periodTo) continue;
    }
    weekIn += invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId);
  }
  for (const sb of args.selfBills) {
    if (!selfBillCountsAsApprovedForPayout(sb)) continue;
    if (!sbInPeriod(sb)) continue;
    weekOut += computeSelfBillAmountDue(sb, args.jobsBySelfBillId[sb.id], args.partnerPaidByJobId);
  }

  let collectedMtd = 0;
  let collectedMtdCount = 0;
  let onTime = 0;
  let onTimeTotal = 0;
  for (const inv of args.invoices) {
    if (inv.status !== "paid") continue;
    const paidYmd = invoicePaidYmd(inv);
    if (args.periodBounds) {
      if (!paidYmd || paidYmd < periodFrom || paidYmd > periodTo) continue;
    } else if (!paidYmd) {
      continue;
    }
    collectedMtd += Number(inv.amount ?? 0);
    collectedMtdCount += 1;
    const dueYmd = invoiceDueYmd(inv);
    if (dueYmd) {
      onTimeTotal += 1;
      if (paidYmd <= dueYmd) onTime += 1;
    }
  }

  const nextRunLabel = nextDue
    ? new Date(`${nextDue}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : "—";

  return {
    toCollect: Math.round(toCollect * 100) / 100,
    toCollectCount,
    toCollectAvg: toCollectCount > 0 ? Math.round((toCollect / toCollectCount) * 100) / 100 : 0,
    overdue: Math.round(overdue * 100) / 100,
    overdueCount,
    oldestOverdueDays,
    toPaySelfBills: Math.round(toPaySelfBills * 100) / 100,
    toPayPartnerCount: partnerIds.size,
    nextRunLabel,
    netWeek: Math.round((weekIn - weekOut) * 100) / 100,
    weekIn: Math.round(weekIn * 100) / 100,
    weekOut: Math.round(weekOut * 100) / 100,
    collectedMtd: Math.round(collectedMtd * 100) / 100,
    collectedMtdCount,
    onTimePct: onTimeTotal > 0 ? Math.round((onTime / onTimeTotal) * 100) : null,
  };
}

export type AgingTotals = Record<AgingBucket, number>;

export function computeAgingTotals(
  invoices: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  todayYmd = invoiceFinanceListTodayYmd(),
  periodBounds?: YmdBounds,
): AgingTotals {
  const totals: AgingTotals = { current: 0, d1_7: 0, d8_30: 0, d30plus: 0 };
  for (const inv of invoices) {
    if (!isInvoiceCollectible(inv, jobsByRef, todayYmd)) continue;
    const dueYmd = invoiceDueYmd(inv) || todayYmd;
    if (periodBounds && !ymdInBounds(dueYmd, periodBounds)) continue;
    const due = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
    if (due <= 0.02) continue;
    const bucket = agingBucketForDue(dueYmd, todayYmd);
    totals[bucket] += due;
  }
  for (const k of Object.keys(totals) as AgingBucket[]) {
    totals[k] = Math.round(totals[k] * 100) / 100;
  }
  return totals;
}

export const UNLINKED_ATTENTION_ACCOUNT_KEY = "acc:unlinked";

export type WorklistRow = {
  invoice: Invoice;
  balanceDue: number;
  daysLate: number;
  accountKey: string;
  accountName: string;
  clientName: string;
  jobCount: number;
  paymentPlanLabel?: string | null;
};

export type AttentionAccountGroup = {
  accountKey: string;
  accountId: string | null;
  accountName: string;
  invoiceCount: number;
  totalDue: number;
  maxDaysLate: number;
  rows: WorklistRow[];
};

export type InvoiceLedgerAccountGroup = {
  accountKey: string;
  accountId: string | null;
  accountName: string;
  invoiceCount: number;
  totalAmount: number;
  invoices: Invoice[];
};

function invoiceLedgerAccountMeta(
  inv: Invoice,
  accountNameById: Record<string, string>,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): { accountKey: string; accountId: string | null; accountName: string } {
  const accId = effectiveInvoiceSourceAccountId(inv, jobRefToAccountId, clientNameToAccountId);
  const accountKey = accId ? `acc:${accId}` : UNLINKED_ATTENTION_ACCOUNT_KEY;
  const accountName = accId ? accountNameById[accId] ?? "Unknown account" : "Direct · Unlinked";
  return { accountKey, accountId: accId, accountName };
}

export function buildInvoiceLedgerAccountGroups(
  invoices: Invoice[],
  accountNameById: Record<string, string>,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): InvoiceLedgerAccountGroup[] {
  const byAccount = new Map<string, InvoiceLedgerAccountGroup>();
  for (const inv of invoices) {
    const { accountKey, accountId, accountName } = invoiceLedgerAccountMeta(
      inv,
      accountNameById,
      jobRefToAccountId,
      clientNameToAccountId,
    );
    let group = byAccount.get(accountKey);
    if (!group) {
      group = {
        accountKey,
        accountId,
        accountName,
        invoiceCount: 0,
        totalAmount: 0,
        invoices: [],
      };
      byAccount.set(accountKey, group);
    }
    group.invoices.push(inv);
    group.invoiceCount += 1;
    group.totalAmount = Math.round((group.totalAmount + Number(inv.amount ?? 0)) * 100) / 100;
  }
  return [...byAccount.values()]
    .map((group) => ({
      ...group,
      invoices: [...group.invoices].sort(
        (a, b) =>
          (a.due_date ?? "").localeCompare(b.due_date ?? "") ||
          (a.reference ?? "").localeCompare(b.reference ?? ""),
      ),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount || a.accountName.localeCompare(b.accountName));
}

function collectAttentionWorklistRows(
  invoices: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  accountNameById: Record<string, string>,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
  periodBounds?: YmdBounds,
  installmentsByInvoiceId?: Record<string, InvoicePaymentInstallment[]>,
): WorklistRow[] {
  const todayYmd = invoiceFinanceListTodayYmd();
  const rows: WorklistRow[] = [];
  for (const inv of invoices) {
    if (!isInvoiceCollectible(inv, jobsByRef, todayYmd)) continue;
    const balanceDue = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
    if (balanceDue <= 0.02) continue;
    const installments = installmentsByInvoiceId?.[inv.id];
    const dueYmd =
      (installments?.length ? invoiceDisplayDueYmd(inv, installments) : invoiceDueYmd(inv)) || todayYmd;
    const isOverdue = invoiceIsDerivedOverdue(inv, todayYmd, installments);
    if (periodBounds && !isOverdue && !ymdInBounds(dueYmd, periodBounds)) continue;
    const daysLate = installments?.length
      ? daysLateWithPlan(inv, installments, todayYmd)
      : Math.max(0, daysBetweenYmd(dueYmd, todayYmd));
    const accId = effectiveInvoiceSourceAccountId(inv, jobRefToAccountId, clientNameToAccountId);
    const accountKey = accId ? `acc:${accId}` : UNLINKED_ATTENTION_ACCOUNT_KEY;
    rows.push({
      invoice: inv,
      balanceDue,
      daysLate,
      accountKey,
      accountName: accId ? accountNameById[accId] ?? "Unknown account" : "Direct · Unlinked",
      clientName: inv.client_name?.trim() || "—",
      jobCount: inv.job_reference ? 1 : 0,
      paymentPlanLabel: paymentPlanProgressLabel(installments),
    });
  }
  rows.sort((a, b) => b.daysLate - a.daysLate || b.balanceDue - a.balanceDue);
  return rows;
}

export function buildAttentionWorklist(
  invoices: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  accountNameById: Record<string, string>,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
  limit = 8,
  periodBounds?: YmdBounds,
  installmentsByInvoiceId?: Record<string, InvoicePaymentInstallment[]>,
): WorklistRow[] {
  const rows = collectAttentionWorklistRows(
    invoices,
    jobsByRef,
    customerPaidByJobId,
    accountNameById,
    jobRefToAccountId,
    clientNameToAccountId,
    periodBounds,
    installmentsByInvoiceId,
  );
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export function buildAttentionAccountGroups(
  invoices: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  accountNameById: Record<string, string>,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
  periodBounds?: YmdBounds,
  installmentsByInvoiceId?: Record<string, InvoicePaymentInstallment[]>,
): AttentionAccountGroup[] {
  const byAccount = new Map<string, AttentionAccountGroup>();
  for (const row of collectAttentionWorklistRows(
    invoices,
    jobsByRef,
    customerPaidByJobId,
    accountNameById,
    jobRefToAccountId,
    clientNameToAccountId,
    periodBounds,
    installmentsByInvoiceId,
  )) {
    let group = byAccount.get(row.accountKey);
    if (!group) {
      const accountId =
        row.accountKey === UNLINKED_ATTENTION_ACCOUNT_KEY ? null : row.accountKey.replace(/^acc:/, "");
      group = {
        accountKey: row.accountKey,
        accountId,
        accountName: row.accountName,
        invoiceCount: 0,
        totalDue: 0,
        maxDaysLate: 0,
        rows: [],
      };
      byAccount.set(row.accountKey, group);
    }
    group.rows.push(row);
    group.invoiceCount += 1;
    group.totalDue = Math.round((group.totalDue + row.balanceDue) * 100) / 100;
    group.maxDaysLate = Math.max(group.maxDaysLate, row.daysLate);
  }
  return [...byAccount.values()].sort(
    (a, b) => b.maxDaysLate - a.maxDaysLate || b.totalDue - a.totalDue || a.accountName.localeCompare(b.accountName),
  );
}

export type CashflowWeek = {
  weekStart: string;
  label: string;
  dayNum: string;
  title: string;
  moneyIn: number;
  moneyOut: number;
  isCurrentWeek: boolean;
  /** Cash runway: balance at week open (manual override or carry-forward). */
  openingBalance?: number;
  /** Cash runway: opening + moneyIn − moneyOut. */
  closingBalance?: number;
};

export type CashflowBreakdownLine = {
  id: string;
  kind: "invoice" | "self_bill" | "expense" | "payroll";
  label: string;
  detail?: string;
  dueYmd: string;
  amount: number;
};

export type CashflowWeekBreakdown = {
  weekStart: string;
  title: string;
  moneyIn: number;
  moneyOut: number;
  inLines: CashflowBreakdownLine[];
  outLines: CashflowBreakdownLine[];
};

export type BuildCashflowWeeklyArgs = {
  invoices: Invoice[];
  selfBills: SelfBill[];
  jobsByRef: Record<string, InvoiceListJobSnapshot>;
  customerPaidByJobId: Record<string, number>;
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>;
  partnerPaidByJobId: Record<string, number>;
  dueCtx: SelfBillDueResolveContext;
  bills?: Pick<Bill, "id" | "description" | "amount" | "due_date" | "status" | "archived_at" | "paid_at">[];
  installmentsByInvoiceId?: Record<string, InvoicePaymentInstallment[]>;
  installmentsBySelfBillId?: Record<string, SelfBillPaymentInstallment[]>;
  startYmd?: string;
  endYmd?: string;
  weekCount?: number;
};

function moneyOutForSelfBillInWeek(
  sb: SelfBill,
  weekStart: string,
  args: Omit<BuildCashflowWeeklyArgs, "startYmd" | "endYmd" | "weekCount">,
): number {
  const installments = args.installmentsBySelfBillId?.[sb.id];
  if (hasActiveSelfBillPaymentPlan(installments)) {
    return cashflowSlicesForSelfBill(sb, installments)
      .filter((s) => ymdInWeekBounds(s.dueYmd, weekStart))
      .reduce((s, slice) => s + slice.amount, 0);
  }
  // Plan flagged on self_bill but installment rows missing (e.g. mig 235 not applied, stale billing fetch).
  if (sb.payment_plan_active) return 0;
  const dueYmd = selfBillDueYmd(sb, args.dueCtx);
  if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) return 0;
  return computeSelfBillAmountDue(sb, args.jobsBySelfBillId[sb.id], args.partnerPaidByJobId);
}

function moneyInForInvoiceInWeek(
  inv: Invoice,
  weekStart: string,
  args: Omit<BuildCashflowWeeklyArgs, "startYmd" | "endYmd" | "weekCount">,
  todayYmd: string,
): number {
  const installments = args.installmentsByInvoiceId?.[inv.id];
  if (hasActivePaymentPlan(installments)) {
    return cashflowSlicesForInvoice(inv, installments)
      .filter((s) => ymdInWeekBounds(s.dueYmd, weekStart))
      .reduce((s, slice) => s + slice.amount, 0);
  }
  const dueYmd = (inv.due_date ?? "").slice(0, 10);
  if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) return 0;
  return invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Line items for one Cash-Flow Runway week (same filters as `buildCashflowWeekly`). */
export function buildCashflowWeekBreakdown(
  weekStart: string,
  args: Omit<BuildCashflowWeeklyArgs, "startYmd" | "endYmd" | "weekCount">,
): CashflowWeekBreakdown {
  const todayYmd = todayYmdLocal();
  const inLines: CashflowBreakdownLine[] = [];
  const outLines: CashflowBreakdownLine[] = [];

  for (const inv of args.invoices) {
    if (!isInvoiceCollectible(inv, args.jobsByRef, todayYmd)) continue;
    const installments = args.installmentsByInvoiceId?.[inv.id];
    if (hasActivePaymentPlan(installments)) {
      for (const slice of cashflowSlicesForInvoice(inv, installments)) {
        if (!ymdInWeekBounds(slice.dueYmd, weekStart) || slice.amount <= 0.02) continue;
        inLines.push({
          id: slice.installmentId,
          kind: "invoice",
          label: slice.label,
          detail: slice.detail ? `${slice.detail} · installment` : "Installment",
          dueYmd: slice.dueYmd,
          amount: roundMoney(slice.amount),
        });
      }
      continue;
    }
    const dueYmd = (inv.due_date ?? "").slice(0, 10);
    if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) continue;
    const amount = invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId);
    if (amount <= 0.02) continue;
    const ref = inv.job_reference?.trim() || inv.reference?.trim();
    inLines.push({
      id: inv.id,
      kind: "invoice",
      label: inv.client_name?.trim() || "Invoice",
      detail: ref || undefined,
      dueYmd,
      amount: roundMoney(amount),
    });
  }

  for (const sb of args.selfBills) {
    if (!selfBillCountsAsCashflowForecastOut(sb)) continue;
    const installments = args.installmentsBySelfBillId?.[sb.id];
    const tier = selfBillCashflowOutTier(sb);
    const tierLabel = tier === "approved" ? "Approved" : tier === "ready" ? "Ready" : "Draft";
    if (hasActiveSelfBillPaymentPlan(installments)) {
      for (const slice of cashflowSlicesForSelfBill(sb, installments)) {
        if (!ymdInWeekBounds(slice.dueYmd, weekStart) || slice.amount <= 0.02) continue;
        const ref = slice.detail;
        outLines.push({
          id: slice.installmentId,
          kind: "self_bill",
          label: slice.label,
          detail: ref ? `${tierLabel} · ${ref} · installment` : `${tierLabel} · installment`,
          dueYmd: slice.dueYmd,
          amount: roundMoney(slice.amount),
        });
      }
      continue;
    }
    if (sb.payment_plan_active) continue;
    const dueYmd = selfBillDueYmd(sb, args.dueCtx);
    if (!ymdInWeekBounds(dueYmd, weekStart)) continue;
    const amount = computeSelfBillAmountDue(sb, args.jobsBySelfBillId[sb.id], args.partnerPaidByJobId);
    if (amount <= 0.02) continue;
    const label =
      sb.bill_origin === "internal"
        ? sb.partner_name?.trim() || "Workforce"
        : sb.partner_name?.trim() || "Partner";
    const ref = sb.reference?.trim() || sb.week_label?.trim();
    outLines.push({
      id: sb.id,
      kind: "self_bill",
      label,
      detail: ref ? `${tierLabel} · ${ref}` : tierLabel,
      dueYmd,
      amount: roundMoney(amount),
    });
  }

  for (const bill of args.bills ?? []) {
    if (!billCountsAsOpenForCashflow(bill)) continue;
    const dueYmd = bill.due_date?.slice(0, 10);
    if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) continue;
    const amount = Number(bill.amount ?? 0);
    if (amount <= 0.02) continue;
    outLines.push({
      id: bill.id,
      kind: "expense",
      label: bill.description?.trim() || "Expense",
      detail: bill.status,
      dueYmd,
      amount: roundMoney(amount),
    });
  }

  inLines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  outLines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  const moneyIn = roundMoney(inLines.reduce((s, l) => s + l.amount, 0));
  const moneyOut = roundMoney(outLines.reduce((s, l) => s + l.amount, 0));
  const { title } = compactWeekColumnLabels(weekStart);

  return { weekStart, title, moneyIn, moneyOut, inLines, outLines };
}

function isoWeekNumberFromYmd(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00`);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function compactWeekColumnLabels(weekStartYmd: string): { label: string; dayNum: string; title: string } {
  const title = weekRangeLabel(weekStartYmd, true);
  const s = new Date(`${weekStartYmd}T12:00:00`);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  const label = `Wk ${isoWeekNumberFromYmd(weekStartYmd)}`;
  const fmtShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const dayNum =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
      ? `${s.getDate()}–${e.getDate()} ${s.toLocaleDateString("en-GB", { month: "short" })}`
      : `${fmtShort(s)} – ${fmtShort(e)}`;
  return { label, dayNum, title };
}

function ymdInWeekBounds(ymd: string, weekStart: string): boolean {
  const weekEnd = addDaysYmd(weekStart, 6);
  return ymd >= weekStart && ymd <= weekEnd;
}

/** Cash-Flow Runway: Mon–Sun projection buckets (not realized cash).
 *
 * **moneyIn** — sum of `invoiceListBalanceDue` for collectible open invoices whose `due_date`
 * falls in the week (excludes draft, on_hold, paid, cancelled; respects job on_hold).
 *
 * **moneyOut** — self-bills due in the week (approved, ready/unapproved, draft/accumulating;
 * not Wise-paid or voided), plus open bills (`submitted`/`approved`/`needs_attention`, not archived).
 * KPI Money Out elsewhere still uses approved self-bills only.
 */
export function buildCashflowWeekly(args: BuildCashflowWeeklyArgs): CashflowWeek[] {
  const todayYmd = todayYmdLocal();
  const anchor = args.startYmd ?? todayYmd;
  let weekStart = startOfWeekMondayFromYmd(anchor);
  const lastWeekMonday = args.endYmd
    ? startOfWeekMondayFromYmd(args.endYmd)
    : addDaysYmd(
        startOfWeekMondayFromYmd(todayYmd),
        7 * ((args.weekCount ?? DEFAULT_CASHFLOW_WEEKS) - 1),
      );

  const weeks: CashflowWeek[] = [];
  while (weekStart <= lastWeekMonday) {
    let moneyIn = 0;
    let moneyOut = 0;
    for (const inv of args.invoices) {
      if (!isInvoiceCollectible(inv, args.jobsByRef, todayYmd)) continue;
      moneyIn += moneyInForInvoiceInWeek(inv, weekStart, args, todayYmd);
    }
    for (const sb of args.selfBills) {
      if (!selfBillCountsAsCashflowForecastOut(sb)) continue;
      moneyOut += moneyOutForSelfBillInWeek(sb, weekStart, args);
    }
    for (const bill of args.bills ?? []) {
      if (!billCountsAsOpenForCashflow(bill)) continue;
      const dueYmd = bill.due_date?.slice(0, 10);
      if (!dueYmd || !ymdInWeekBounds(dueYmd, weekStart)) continue;
      moneyOut += Number(bill.amount ?? 0);
    }
    const { label, dayNum, title } = compactWeekColumnLabels(weekStart);
    weeks.push({
      weekStart,
      label,
      dayNum,
      title,
      moneyIn: Math.round(moneyIn * 100) / 100,
      moneyOut: Math.round(moneyOut * 100) / 100,
      isCurrentWeek: ymdInWeekBounds(todayYmd, weekStart),
    });
    weekStart = addDaysYmd(weekStart, 7);
    if (!args.endYmd && weeks.length >= (args.weekCount ?? DEFAULT_CASHFLOW_WEEKS)) break;
  }
  return weeks;
}

export type CustomerExposureRow = {
  accountId: string;
  accountName: string;
  terms: string;
  outstanding: number;
  overdue: number;
  openCount: number;
  onTimePct: number | null;
  lastPaidYmd: string | null;
  aging: AgingTotals;
};

export function buildCustomerExposure(
  invoices: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  accountMeta: Record<string, { name: string; terms: string }>,
  resolveAccountId: (inv: Invoice) => string | null,
  periodBounds?: YmdBounds,
): CustomerExposureRow[] {
  const todayYmd = invoiceFinanceListTodayYmd();
  const map = new Map<string, CustomerExposureRow>();

  for (const inv of invoices) {
    const dueYmd = invoiceDueYmd(inv);
    const paidYmd = invoicePaidYmd(inv);
    const inPeriod =
      !periodBounds ||
      ymdInBounds(dueYmd, periodBounds) ||
      (paidYmd && ymdInBounds(paidYmd, periodBounds));
    if (!inPeriod) continue;
    const accId = resolveAccountId(inv);
    if (!accId) continue;
    const meta = accountMeta[accId] ?? { name: inv.client_name, terms: "—" };
    let row = map.get(accId);
    if (!row) {
      row = {
        accountId: accId,
        accountName: meta.name,
        terms: meta.terms,
        outstanding: 0,
        overdue: 0,
        openCount: 0,
        onTimePct: null,
        lastPaidYmd: null,
        aging: { current: 0, d1_7: 0, d8_30: 0, d30plus: 0 },
      };
      map.set(accId, row);
    }
    if (isInvoiceCollectible(inv, jobsByRef, todayYmd)) {
      const due = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
      if (due > 0.02) {
        row.outstanding += due;
        row.openCount += 1;
        const dueYmd = inv.due_date?.slice(0, 10) ?? todayYmd;
        const bucket = agingBucketForDue(dueYmd, todayYmd);
        row.aging[bucket] += due;
        if (invoiceIsDerivedOverdue(inv, todayYmd)) row.overdue += due;
      }
    }
    if (inv.status === "paid") {
      const paidYmd = (inv.paid_date ?? inv.last_payment_date ?? "").slice(0, 10);
      if (paidYmd && (!row.lastPaidYmd || paidYmd > row.lastPaidYmd)) row.lastPaidYmd = paidYmd;
    }
  }

  const allPaidByAccount = new Map<string, { on: number; total: number }>();
  for (const inv of invoices) {
    if (inv.status !== "paid") continue;
    const accId = resolveAccountId(inv);
    if (!accId) continue;
    const paidYmd = invoicePaidYmd(inv);
    const dueYmd = invoiceDueYmd(inv);
    if (!paidYmd || !dueYmd) continue;
    if (periodBounds && !ymdInBounds(paidYmd, periodBounds)) continue;
    const cur = allPaidByAccount.get(accId) ?? { on: 0, total: 0 };
    cur.total += 1;
    if (paidYmd <= dueYmd) cur.on += 1;
    allPaidByAccount.set(accId, cur);
  }

  const rows = [...map.values()];
  for (const r of rows) {
    r.outstanding = Math.round(r.outstanding * 100) / 100;
    r.overdue = Math.round(r.overdue * 100) / 100;
    for (const k of Object.keys(r.aging) as AgingBucket[]) {
      r.aging[k] = Math.round(r.aging[k] * 100) / 100;
    }
    const ot = allPaidByAccount.get(r.accountId);
    r.onTimePct = ot && ot.total > 0 ? Math.round((ot.on / ot.total) * 100) : null;
  }
  rows.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  return rows;
}
