import {
  invoiceFinanceListTodayYmd,
  invoiceIsDerivedOverdue,
} from "@/lib/invoice-finance-tab";
import {
  resolveSelfBillDueYmd,
  type SelfBillDueResolveContext,
} from "@/lib/partner-payout-schedule";
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
  invoiceListBalanceDue,
  isInvoiceOpen,
  type InvoiceListJobSnapshot,
} from "@/lib/billing-invoice-list-data";
import { computeSelfBillAmountDue, type SelfBillJobLine } from "@/lib/billing-selfbill-actions";
import { isSelfBillPayoutVoided } from "@/services/self-bills";
import type { Invoice, SelfBill } from "@/types/database";

export type AgingBucket = "current" | "d1_7" | "d8_30" | "d30plus";

const READY_SB = new Set(["ready_to_pay", "pending_review", "awaiting_payment", "audit_required"]);

export function selfBillDueYmd(
  sb: Pick<SelfBill, "week_end" | "due_date" | "partner_id">,
  dueCtx: SelfBillDueResolveContext,
): string {
  return resolveSelfBillDueYmd(sb, dueCtx);
}

export function selfBillCountsAsReady(sb: Pick<SelfBill, "status">): boolean {
  return READY_SB.has(sb.status);
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
    if (!isInvoiceOpen(inv, todayYmd)) continue;
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
    if (isSelfBillPayoutVoided(sb) || !selfBillCountsAsReady(sb)) continue;
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
    if (!isInvoiceOpen(inv, todayYmd)) continue;
    const dueYmd = invoiceDueYmd(inv);
    if (args.periodBounds) {
      if (!dueYmd || dueYmd < periodFrom || dueYmd > periodTo) continue;
    }
    weekIn += invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId);
  }
  for (const sb of args.selfBills) {
    if (isSelfBillPayoutVoided(sb) || !selfBillCountsAsReady(sb)) continue;
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
    if (!isInvoiceOpen(inv, todayYmd)) continue;
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

export type WorklistRow = {
  invoice: Invoice;
  balanceDue: number;
  daysLate: number;
  accountKey: string;
  accountName: string;
  jobCount: number;
};

export type AttentionAccountGroup = {
  accountKey: string;
  accountName: string;
  invoiceCount: number;
  totalDue: number;
  maxDaysLate: number;
  rows: WorklistRow[];
};

function collectAttentionWorklistRows(
  invoices: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  accountNameById: Record<string, string>,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
  periodBounds?: YmdBounds,
): WorklistRow[] {
  const todayYmd = invoiceFinanceListTodayYmd();
  const rows: WorklistRow[] = [];
  for (const inv of invoices) {
    if (!isInvoiceOpen(inv, todayYmd)) continue;
    const balanceDue = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
    if (balanceDue <= 0.02) continue;
    const dueYmd = invoiceDueYmd(inv) || todayYmd;
    const isOverdue = invoiceIsDerivedOverdue(inv, todayYmd);
    if (periodBounds && !isOverdue && !ymdInBounds(dueYmd, periodBounds)) continue;
    const daysLate = Math.max(0, daysBetweenYmd(dueYmd, todayYmd));
    const accId =
      inv.source_account_id?.trim() ||
      (inv.job_reference ? jobRefToAccountId[inv.job_reference.trim()] : null) ||
      clientNameToAccountId[inv.client_name?.trim() ?? ""] ||
      null;
    const accountKey = accId ?? inv.client_name?.trim() ?? "unknown";
    rows.push({
      invoice: inv,
      balanceDue,
      daysLate,
      accountKey,
      accountName: accId ? accountNameById[accId] ?? inv.client_name : inv.client_name,
      jobCount: inv.job_reference ? 1 : 0,
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
): WorklistRow[] {
  const rows = collectAttentionWorklistRows(
    invoices,
    jobsByRef,
    customerPaidByJobId,
    accountNameById,
    jobRefToAccountId,
    clientNameToAccountId,
    periodBounds,
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
  )) {
    let group = byAccount.get(row.accountKey);
    if (!group) {
      group = {
        accountKey: row.accountKey,
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

export type CashflowDay = {
  ymd: string;
  label: string;
  dayNum: string;
  moneyIn: number;
  moneyOut: number;
  isWeekend: boolean;
  isToday: boolean;
};

export function buildCashflow14Days(args: {
  invoices: Invoice[];
  selfBills: SelfBill[];
  jobsByRef: Record<string, InvoiceListJobSnapshot>;
  customerPaidByJobId: Record<string, number>;
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>;
  partnerPaidByJobId: Record<string, number>;
  dueCtx: SelfBillDueResolveContext;
  startYmd?: string;
  endYmd?: string;
}): CashflowDay[] {
  const todayYmd = todayYmdLocal();
  const start = args.startYmd ?? todayYmd;
  const endCap = args.endYmd;
  const days: CashflowDay[] = [];
  for (let i = 0; days.length < 14; i++) {
    const ymd = addDaysYmd(start, i);
    if (endCap && ymd > endCap) break;
    const d = new Date(`${ymd}T12:00:00`);
    const dow = d.getDay();
    let moneyIn = 0;
    let moneyOut = 0;
    for (const inv of args.invoices) {
      if (!isInvoiceOpen(inv, todayYmd)) continue;
      if ((inv.due_date ?? "").slice(0, 10) !== ymd) continue;
      moneyIn += invoiceListBalanceDue(inv, args.jobsByRef, args.customerPaidByJobId);
    }
    for (const sb of args.selfBills) {
      if (isSelfBillPayoutVoided(sb) || !selfBillCountsAsReady(sb)) continue;
      if (selfBillDueYmd(sb, args.dueCtx) !== ymd) continue;
      moneyOut += computeSelfBillAmountDue(sb, args.jobsBySelfBillId[sb.id], args.partnerPaidByJobId);
    }
    days.push({
      ymd,
      label: d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase().slice(0, 3),
      dayNum: String(d.getDate()).padStart(2, "0"),
      moneyIn: Math.round(moneyIn * 100) / 100,
      moneyOut: Math.round(moneyOut * 100) / 100,
      isWeekend: dow === 0 || dow === 6,
      isToday: ymd === todayYmd,
    });
  }
  return days;
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
    if (isInvoiceOpen(inv, todayYmd)) {
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
