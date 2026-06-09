"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Download, RefreshCw, Check, ChevronDown, FileText } from "lucide-react";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { useBillingStandaloneData } from "@/hooks/use-billing-standalone-data";
import {
  DEFAULT_BILLING_STANDALONE_FILTER,
  billingStandaloneFilterDescription,
  type BillingStandaloneFilterValue,
} from "@/lib/billing-standalone-filter";
import {
  formatPeriodBoundsLabel,
  resolveBillingStandaloneBounds,
  todayYmdLocal,
  selfBillPayWorkPeriodInPeriod,
  ymdInBounds,
} from "@/lib/billing-standalone-period";
import { BillingStandalonePeriodFilter } from "@/components/finance/billing-standalone-period-filter";
import { workPeriodBoundsForPayoutFriday } from "@/lib/partner-payout-schedule";
import {
  buildAttentionAccountGroups,
  buildCashflow14Days,
  buildCustomerExposure,
  computeAgingTotals,
  computeBillingKpis,
  selfBillCountsAsReady,
  selfBillDueYmd,
  isSelfBillOverdue,
} from "@/lib/billing-standalone-metrics";
import { invoiceDisplayStatus, vatSplitFromGross } from "@/lib/billing-invoice-list-data";
import { invoiceFinanceListTodayYmd } from "@/lib/invoice-finance-tab";
import { bulkMarkInvoicesPaid, syncInvoicesForJobIds, updateInvoiceStatusOne } from "@/lib/billing-invoice-actions";
import {
  bulkCancelSelfBills,
  bulkSendSelfBillEmails,
  computeSelfBillAmountDue,
  getBulkCancellableSelfBillIds,
  getBulkEligibleSelfBillIds,
  markSelfBillsPaid,
  type SelfBillJobLine,
} from "@/lib/billing-selfbill-actions";
import type { SelfBillDueResolveContext } from "@/lib/partner-payout-schedule";
import { isSelfBillClosed, isSelfBillPayoutVoided, listJobsForSelfBill } from "@/services/self-bills";
import { getSupabase } from "@/services/base";
import { BillingBulkBar, StatusPill } from "@/components/finance/billing-bulk-bar";
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal";
import { createInvoice, type CreateInvoiceInput } from "@/services/invoices";
import { logAudit } from "@/services/audit";
import type { Invoice, SelfBill } from "@/types/database";
import "./billing-standalone.css";

const InvoiceDetailDrawer = dynamic(
  () => import("./invoices-finance-client").then((m) => m.InvoiceDetailDrawer),
  { ssr: false },
);
const SelfBillDetailDrawer = dynamic(
  () => import("./selfbill-finance-client").then((m) => m.SelfBillDetailDrawer),
  { ssr: false },
);

type LedgerTab = "inv" | "sb";

function BillingContentSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-xl bg-surface-hover" />
        ))}
      </div>
      <div className="h-36 rounded-xl bg-surface-hover" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-52 rounded-xl bg-surface-hover" />
        <div className="h-52 rounded-xl bg-surface-hover" />
      </div>
      <div className="h-80 rounded-xl bg-surface-hover" />
    </div>
  );
}

function BillingStandaloneInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useProfile();
  const [periodFilter, setPeriodFilter] = useState<BillingStandaloneFilterValue>(DEFAULT_BILLING_STANDALONE_FILTER);
  const data = useBillingStandaloneData(periodFilter);
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>(
    searchParams.get("tab") === "sb" ? "sb" : "inv",
  );
  const invoiceIdFromUrl = searchParams.get("invoiceId");
  const selfBillIdFromUrl = searchParams.get("selfBillId");
  const [createOpen, setCreateOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [selectedSbIds, setSelectedSbIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerSb, setDrawerSb] = useState<SelfBill | null>(null);
  const [drawerSbJobs, setDrawerSbJobs] = useState<Awaited<ReturnType<typeof listJobsForSelfBill>>>([]);
  const [loadingDrawerJobs, setLoadingDrawerJobs] = useState(false);
  const [showInactiveInvoices, setShowInactiveInvoices] = useState(false);
  const [showInactiveSelfBills, setShowInactiveSelfBills] = useState(false);
  const [expandedAttentionAccounts, setExpandedAttentionAccounts] = useState<Set<string>>(new Set());
  const [expandedGoingOutPartners, setExpandedGoingOutPartners] = useState<Set<string>>(new Set());
  const [expandedLedgerSelfBillPartners, setExpandedLedgerSelfBillPartners] = useState<Set<string>>(new Set());

  const todayYmd = invoiceFinanceListTodayYmd();
  const periodBounds = useMemo(() => data.periodBounds(periodFilter), [data, periodFilter]);
  const selfBillPeriodBounds = useMemo(() => data.selfBillPeriodBounds(periodFilter), [data, periodFilter]);
  const periodLabel = useMemo(
    () => (periodBounds ? formatPeriodBoundsLabel(periodBounds) : billingStandaloneFilterDescription(periodFilter)),
    [periodBounds, periodFilter],
  );

  /** KPI row always reflects the current calendar month — independent of All / Range filter. */
  const kpiMonthBounds = useMemo(() => resolveBillingStandaloneBounds("month"), []);
  const kpiMonthLabel = useMemo(() => formatPeriodBoundsLabel(kpiMonthBounds), [kpiMonthBounds]);

  const kpiRow = useMemo(
    () =>
      computeBillingKpis({
        invoices: data.invoices,
        selfBills: data.selfBills,
        jobsByRef: data.jobsByRef,
        customerPaidByJobId: data.customerPaidByJobId,
        jobsBySelfBillId: data.jobsBySelfBillId,
        partnerPaidByJobId: data.partnerPaidByJobId,
        dueCtx: data.dueCtx,
        periodBounds: kpiMonthBounds,
        selfBillPeriodBounds: kpiMonthBounds,
      }),
    [data, kpiMonthBounds],
  );

  const periodInvoices = useMemo(
    () =>
      data.invoices.filter((inv) => {
        if (!periodBounds) return inv.status !== "cancelled";
        const dueYmd = inv.due_date?.slice(0, 10) ?? "";
        if (ymdInBounds(dueYmd, periodBounds)) return true;
        if (inv.status === "paid") {
          const paidYmd = (inv.paid_date ?? inv.last_payment_date ?? inv.stripe_paid_at ?? "").slice(0, 10);
          return ymdInBounds(paidYmd, periodBounds);
        }
        return false;
      }),
    [data.invoices, periodBounds],
  );

  const periodSelfBills = useMemo(
    () =>
      !selfBillPeriodBounds
        ? data.selfBills
        : data.selfBills.filter((sb) => selfBillPayWorkPeriodInPeriod(sb, selfBillPeriodBounds)),
    [data.selfBills, selfBillPeriodBounds],
  );

  const activePeriodSelfBills = useMemo(
    () => periodSelfBills.filter((sb) => !isSelfBillClosed(sb)),
    [periodSelfBills],
  );

  const inactivePeriodSelfBills = useMemo(
    () => periodSelfBills.filter((sb) => isSelfBillClosed(sb)),
    [periodSelfBills],
  );

  const inactiveSelfBillCounts = useMemo(() => {
    let cancelled = 0;
    let paid = 0;
    let voided = 0;
    for (const sb of inactivePeriodSelfBills) {
      if (sb.status === "paid") paid += 1;
      else if (sb.status === "rejected" || sb.status === "payout_cancelled") cancelled += 1;
      else if (isSelfBillPayoutVoided(sb)) voided += 1;
    }
    return { cancelled, paid, voided };
  }, [inactivePeriodSelfBills]);

  const periodWorkWeekLabel = useMemo(
    () => (selfBillPeriodBounds ? formatPeriodBoundsLabel(selfBillPeriodBounds) : "All periods"),
    [selfBillPeriodBounds],
  );

  const activePeriodInvoices = useMemo(
    () => periodInvoices.filter((inv) => inv.status !== "cancelled" && inv.status !== "paid"),
    [periodInvoices],
  );

  const inactivePeriodInvoices = useMemo(
    () => periodInvoices.filter((inv) => inv.status === "cancelled" || inv.status === "paid"),
    [periodInvoices],
  );

  const inactiveInvoiceCounts = useMemo(() => {
    let cancelled = 0;
    let paid = 0;
    for (const inv of inactivePeriodInvoices) {
      if (inv.status === "cancelled") cancelled += 1;
      else if (inv.status === "paid") paid += 1;
    }
    return { cancelled, paid };
  }, [inactivePeriodInvoices]);

  const selfBillWeekPartnerGroups = useMemo(
    () => buildSelfBillWeekPartnerGroups(activePeriodSelfBills, data.dueCtx, data.jobsBySelfBillId, data.partnerPaidByJobId),
    [activePeriodSelfBills, data.dueCtx, data.jobsBySelfBillId, data.partnerPaidByJobId],
  );

  const inactiveSelfBillWeekPartnerGroups = useMemo(
    () => buildSelfBillWeekPartnerGroups(inactivePeriodSelfBills, data.dueCtx, data.jobsBySelfBillId, data.partnerPaidByJobId),
    [inactivePeriodSelfBills, data.dueCtx, data.jobsBySelfBillId, data.partnerPaidByJobId],
  );

  const aging = useMemo(
    () => computeAgingTotals(data.invoices, data.jobsByRef, data.customerPaidByJobId, todayYmd, periodBounds ?? undefined),
    [data.invoices, data.jobsByRef, data.customerPaidByJobId, todayYmd, periodBounds],
  );

  const attentionAccountGroups = useMemo(
    () =>
      buildAttentionAccountGroups(
        data.invoices,
        data.jobsByRef,
        data.customerPaidByJobId,
        data.accountNameById,
        data.jobRefToAccountId,
        data.clientNameToAccountId,
        periodBounds ?? undefined,
      ),
    [data, periodBounds],
  );

  const toggleAttentionAccount = useCallback((accountKey: string) => {
    setExpandedAttentionAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountKey)) next.delete(accountKey);
      else next.add(accountKey);
      return next;
    });
  }, []);

  const toggleGoingOutPartner = useCallback((partnerGroupKey: string) => {
    setExpandedGoingOutPartners((prev) => {
      const next = new Set(prev);
      if (next.has(partnerGroupKey)) next.delete(partnerGroupKey);
      else next.add(partnerGroupKey);
      return next;
    });
  }, []);

  const toggleLedgerSelfBillPartner = useCallback((partnerGroupKey: string) => {
    setExpandedLedgerSelfBillPartners((prev) => {
      const next = new Set(prev);
      if (next.has(partnerGroupKey)) next.delete(partnerGroupKey);
      else next.add(partnerGroupKey);
      return next;
    });
  }, []);

  const cashflow = useMemo(
    () =>
      buildCashflow14Days({
        invoices: data.invoices,
        selfBills: data.selfBills,
        jobsByRef: data.jobsByRef,
        customerPaidByJobId: data.customerPaidByJobId,
        jobsBySelfBillId: data.jobsBySelfBillId,
        partnerPaidByJobId: data.partnerPaidByJobId,
        dueCtx: data.dueCtx,
        startYmd: periodBounds?.from ?? todayYmd,
        endYmd: periodBounds?.to,
      }),
    [data, periodBounds],
  );

  const customers = useMemo(
    () =>
      buildCustomerExposure(
        data.invoices,
        data.jobsByRef,
        data.customerPaidByJobId,
        Object.fromEntries(
          Object.keys(data.accountNameById).map((id) => [
            id,
            { name: data.accountNameById[id]!, terms: data.accountTermsById[id] ?? "—" },
          ]),
        ),
        data.resolveAccountId,
        periodBounds ?? undefined,
      ),
    [data, periodBounds],
  );

  const payableSelfBills = useMemo(
    () =>
      periodSelfBills.filter(
        (sb) => selfBillCountsAsReady(sb) && !isSelfBillPayoutVoided(sb),
      ),
    [periodSelfBills],
  );

  /** Ready-to-pay only (excludes draft/accumulating) with balance due — matches To pay KPI. */
  const goingOutSelfBills = useMemo(
    () =>
      periodSelfBills.filter((sb) => {
        if (!selfBillCountsAsReady(sb) || isSelfBillPayoutVoided(sb)) return false;
        const amt = computeSelfBillAmountDue(sb, data.jobsBySelfBillId[sb.id], data.partnerPaidByJobId);
        return amt > 0.02;
      }),
    [periodSelfBills, data.jobsBySelfBillId, data.partnerPaidByJobId],
  );

  const goingOutGroups = useMemo(
    () => buildSelfBillWeekPartnerGroups(goingOutSelfBills, data.dueCtx, data.jobsBySelfBillId, data.partnerPaidByJobId),
    [goingOutSelfBills, data.dueCtx, data.jobsBySelfBillId, data.partnerPaidByJobId],
  );

  const goingOutTotal = useMemo(
    () =>
      goingOutSelfBills.reduce(
        (sum, sb) =>
          sum + computeSelfBillAmountDue(sb, data.jobsBySelfBillId[sb.id], data.partnerPaidByJobId),
        0,
      ),
    [goingOutSelfBills, data.jobsBySelfBillId, data.partnerPaidByJobId],
  );

  useEffect(() => {
    setSelectedInvoiceIds(new Set());
    setSelectedSbIds(new Set());
    setShowInactiveInvoices(false);
    setShowInactiveSelfBills(false);
    setExpandedAttentionAccounts(new Set());
    setExpandedGoingOutPartners(new Set());
    setExpandedLedgerSelfBillPartners(new Set());
  }, [periodFilter]);

  const openInvoice = useCallback(
    (inv: Invoice) => {
      router.replace(`/finance/billing?invoiceId=${encodeURIComponent(inv.id)}`, { scroll: false });
    },
    [router],
  );

  const openSelfBill = useCallback(
    (sb: SelfBill) => {
      setLedgerTab("sb");
      router.replace(`/finance/billing?selfBillId=${encodeURIComponent(sb.id)}&tab=sb`, { scroll: false });
    },
    [router],
  );

  const closeInvoiceDrawer = useCallback(() => {
    router.replace("/finance/billing", { scroll: false });
  }, [router]);

  const closeSelfBillDrawer = useCallback(() => {
    router.replace("/finance/billing?tab=sb", { scroll: false });
  }, [router]);

  useEffect(() => {
    if (!invoiceIdFromUrl) {
      setSelectedInvoice(null);
      return;
    }
    const inv = data.invoices.find((i) => i.id === invoiceIdFromUrl);
    if (inv) setSelectedInvoice(inv);
  }, [invoiceIdFromUrl, data.invoices]);

  useEffect(() => {
    if (!selfBillIdFromUrl) {
      setDrawerSb(null);
      setDrawerSbJobs([]);
      return;
    }
    const sb = data.selfBills.find((s) => s.id === selfBillIdFromUrl);
    if (sb) setDrawerSb(sb);
  }, [selfBillIdFromUrl, data.selfBills]);

  useEffect(() => {
    if (!selfBillIdFromUrl) return;
    let cancelled = false;
    setLoadingDrawerJobs(true);
    void listJobsForSelfBill(selfBillIdFromUrl)
      .then((jobs) => {
        if (!cancelled) setDrawerSbJobs(jobs);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load jobs");
      })
      .finally(() => {
        if (!cancelled) setLoadingDrawerJobs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selfBillIdFromUrl]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const jobIds = [
        ...new Set(
          data.invoices
            .map((i) => (i.job_reference ? data.jobsByRef[i.job_reference.trim()]?.id : null))
            .filter((x): x is string => Boolean(x)),
        ),
      ];
      const n = await syncInvoicesForJobIds(jobIds);
      const res = await fetch("/api/admin/selfbills/full-sync", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Self-bill sync failed");
      toast.success(`Synced ${n} job(s) + self-bills`);
      await data.loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = () => {
    const headers = ["Reference", "Account", "Client", "Amount", "Due", "Status"];
    const rows = data.invoices.map((inv) => {
      const accId = data.resolveAccountId(inv);
      return [
        inv.reference,
        accId ? data.accountNameById[accId] ?? "" : "",
        inv.client_name,
        String(inv.amount),
        inv.due_date,
        inv.status,
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing-${todayYmdLocal()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  };

  const handleCreate = async (form: CreateInvoiceInput) => {
    try {
      const result = await createInvoice(form);
      await logAudit({ entityType: "invoice", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name });
      setCreateOpen(false);
      toast.success("Invoice created");
      await data.loadData();
    } catch {
      toast.error("Failed to create invoice");
    }
  };

  const sbPayableIdSet = useMemo(() => new Set(payableSelfBills.map((s) => s.id)), [payableSelfBills]);
  const sbCancellableIdSet = useMemo(
    () =>
      new Set(
        activePeriodSelfBills
          .filter((sb) => !isSelfBillPayoutVoided(sb) && sb.status !== "paid")
          .map((s) => s.id),
      ),
    [activePeriodSelfBills],
  );

  const cfMax = Math.max(1, ...cashflow.flatMap((d) => [d.moneyIn, d.moneyOut]));

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <PageTransition>
      <div className="bl-standalone space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ED4B00]">
              Billing · Money in &amp; out · control tower
            </p>
            <h1 className="inline-flex items-center gap-2 text-2xl font-bold text-[#020040]">
              Billing
              <FixfyHintIcon
                text={`Everything you owe and everything you're owed — what's due, what's late, day by day. ${dateLabel}.`}
                placement="bottom-start"
              />
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BillingStandalonePeriodFilter value={periodFilter} onChange={setPeriodFilter} />
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={syncing || data.refreshing}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void handleSync()}
            >
              Sync
            </Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
              New invoice
            </Button>
          </div>
        </div>

        {data.loading && !data.hasLoadedOnce ? (
          <BillingContentSkeleton />
        ) : (
          <div className={cn(data.loading || data.refreshing ? "opacity-70 transition-opacity" : undefined)}>
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard label="To collect · receivables" value={formatCurrency(kpiRow.toCollect)} sub={`${kpiRow.toCollectCount} open · ${kpiRow.overdueCount} overdue`} />
              <KpiCard label="Overdue" value={formatCurrency(kpiRow.overdue)} sub={`${kpiRow.overdueCount} invoices · oldest ${kpiRow.oldestOverdueDays}d`} alert />
              <KpiCard label="To pay · self-bills" value={formatCurrency(kpiRow.toPaySelfBills)} sub={`${kpiRow.toPayPartnerCount} partners · run ${kpiRow.nextRunLabel}`} coral />
              <KpiCard label={`Net · ${kpiMonthLabel}`} value={`${kpiRow.netWeek >= 0 ? "+" : ""}${formatCurrency(kpiRow.netWeek)}`} sub={`in ${formatCurrency(kpiRow.weekIn)} · out ${formatCurrency(kpiRow.weekOut)}`} green={kpiRow.netWeek >= 0} />
              <KpiCard label={`Collected · ${kpiMonthLabel}`} value={formatCurrency(kpiRow.collectedMtd)} sub={`${kpiRow.collectedMtdCount} invoices${kpiRow.onTimePct != null ? ` · ${kpiRow.onTimePct}% on time` : ""}`} />
            </div>

            <div className="rounded-xl border border-border-light bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#020040]">Cash-flow runway · next 14 days</h2>
                  <p className="text-xs text-text-secondary">Green up = expected in · coral down = scheduled out.</p>
                </div>
                <div className="flex gap-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600" /> Money in</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#ED4B00]" /> Money out</span>
                </div>
              </div>
              <div className="cf flex gap-0.5 overflow-x-auto pb-2">
                {cashflow.map((d) => {
                  const ih = d.moneyIn ? Math.max(8, Math.round((d.moneyIn / cfMax) * 72)) : 0;
                  const oh = d.moneyOut ? Math.max(8, Math.round((d.moneyOut / cfMax) * 72)) : 0;
                  return (
                    <div key={d.ymd} className={cn("cf__day min-w-[36px] flex-1", d.isWeekend && "is-weekend", d.isToday && "is-today")}>
                      <div className={cn("cf__amt cf__amt--in", !d.moneyIn && "is-empty")}>{d.moneyIn ? formatCurrency(d.moneyIn) : "·"}</div>
                      <div className="cf__well"><div className="cf__bar cf__bar--in" style={{ height: ih }} /></div>
                      <div className="cf__axis" />
                      <div className="cf__well cf__well--out"><div className="cf__bar cf__bar--out" style={{ height: oh }} /></div>
                      <div className={cn("cf__amt cf__amt--out", !d.moneyOut && "is-empty")}>{d.moneyOut ? formatCurrency(d.moneyOut) : "·"}</div>
                      <div className="cf__lbl">{d.label}<b>{d.dayNum}</b></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-border-light bg-white shadow-sm">
                <div className="border-b border-border-light px-5 py-4">
                  <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#020040]">
                    Needs attention · money in
                    <FixfyHintIcon
                      text={`Overdue first, then ${periodBounds ? `due in ${periodLabel}` : "all open receivables"}.`}
                      placement="bottom-start"
                    />
                  </h2>
                </div>
                <div className="border-b border-border-light px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">To collect · receivables</p>
                      <p className="text-sm font-semibold text-[#020040]">
                        {kpiRow.toCollectCount} open
                        {kpiRow.overdueCount > 0 ? ` · ${kpiRow.overdueCount} overdue` : ""}
                      </p>
                      {kpiRow.overdue > 0.02 ? (
                        <p className="mt-0.5 text-xs font-medium text-red-600">{formatCurrency(kpiRow.overdue)} overdue</p>
                      ) : null}
                    </div>
                    <p className="text-xl font-bold tabular-nums text-[#020040]">{formatCurrency(kpiRow.toCollect)}</p>
                  </div>
                  <AgingBar aging={aging} compact />
                </div>
                <div className="max-h-[420px] divide-y divide-border-light overflow-y-auto">
                  {attentionAccountGroups.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-text-tertiary">Nothing needs attention right now.</p>
                  ) : (
                    attentionAccountGroups.map((group) => {
                      const open = expandedAttentionAccounts.has(group.accountKey);
                      return (
                        <div key={group.accountKey}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 bg-surface-hover/30 px-5 py-2.5 text-left hover:bg-surface-hover/50"
                            onClick={() => toggleAttentionAccount(group.accountKey)}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">
                                {group.accountName.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[#020040]">{group.accountName}</p>
                                <p className="text-xs text-text-tertiary">
                                  {group.invoiceCount} invoice{group.invoiceCount === 1 ? "" : "s"}
                                  {group.maxDaysLate > 0 ? ` · ${group.maxDaysLate}d late` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(group.totalDue)}</p>
                              <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", open && "rotate-180")} />
                            </div>
                          </button>
                          {open ? (
                            <div className="divide-y divide-border-light border-t border-border-light">
                              {group.rows.map((row) => (
                                <div key={row.invoice.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-hover/50">
                                  <span className={cn("h-8 w-1 rounded-full", row.daysLate > 0 ? "bg-red-500" : "bg-amber-400")} />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-[#020040]">{row.invoice.reference}</p>
                                    <p className="text-xs text-text-secondary">Issued {formatDate(row.invoice.created_at.slice(0, 10))}</p>
                                  </div>
                                  <span className={cn("text-xs font-medium", row.daysLate > 0 ? "text-red-600" : "text-text-secondary")}>
                                    {row.daysLate > 0 ? `${row.daysLate}d late` : "Due soon"}
                                  </span>
                                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(row.balanceDue)}</span>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      title="Mark paid"
                                      className="rounded border border-border-light p-1 hover:bg-emerald-50"
                                      onClick={() =>
                                        void bulkMarkInvoicesPaid([row.invoice.id], profile ?? undefined).then(async () => {
                                          toast.success("Marked paid");
                                          await data.loadData();
                                        })
                                      }
                                    >
                                      <Check className="h-3.5 w-3.5 text-emerald-700" />
                                    </button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      title="View PDF"
                                      icon={<FileText className="h-3.5 w-3.5" />}
                                      onClick={() => openInvoicePdf(row.invoice.id)}
                                    >
                                      PDF
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => openInvoice(row.invoice)}>Open</Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border-light bg-white shadow-sm">
                <div className="border-b border-border-light px-5 py-4">
                  <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#020040]">
                    Going out · money out
                    <FixfyHintIcon
                      text={`Work week · ${periodWorkWeekLabel} · ready to pay only (no drafts).`}
                      placement="bottom-start"
                    />
                  </h2>
                </div>
                <div className="border-b border-border-light px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Next self-bill run</p>
                      <p className="text-sm font-semibold text-[#020040]">{kpiRow.nextRunLabel}</p>
                    </div>
                    <p className="text-xl font-bold tabular-nums text-[#020040]">{formatCurrency(goingOutTotal)}</p>
                  </div>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <SelfBillGroupedLedger
                    variant="compact"
                    groups={goingOutGroups}
                    todayYmd={todayYmd}
                    selectedIds={selectedSbIds}
                    onSelectionChange={setSelectedSbIds}
                    partnerDueCtx={data.partnerDueCtx}
                    onOpen={(sb) => void openSelfBill(sb)}
                    onMarkPaid={async (id) => {
                      await markSelfBillsPaid([id]);
                      toast.success("Marked paid");
                      await data.loadData();
                    }}
                    collapsiblePartners={{
                      expandedKeys: expandedGoingOutPartners,
                      onToggle: toggleGoingOutPartner,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border-light bg-white shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-3">
                <div className="flex gap-1">
                  <LedgerTabBtn active={ledgerTab === "inv"} onClick={() => setLedgerTab("inv")} label="Invoices" count={activePeriodInvoices.length} />
                  <LedgerTabBtn active={ledgerTab === "sb"} onClick={() => setLedgerTab("sb")} label="Self-bills" count={activePeriodSelfBills.length} />
                </div>
                {ledgerTab === "sb" ? (
                  <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setSelectedSbIds(new Set(payableSelfBills.map((s) => s.id)))}>
                    Select all payable
                  </button>
                ) : null}
              </div>

              {ledgerTab === "inv" ? (
                <>
                  <InvoiceLedgerTable
                    invoices={activePeriodInvoices}
                    todayYmd={todayYmd}
                    selectedIds={selectedInvoiceIds}
                    onSelectionChange={setSelectedInvoiceIds}
                    resolveAccountId={data.resolveAccountId}
                    accountNameById={data.accountNameById}
                    onOpen={openInvoice}
                    onMarkPaid={(id) => void bulkMarkInvoicesPaid([id], profile ?? undefined).then(() => data.loadData())}
                    emptyLabel="No active invoices in this period."
                  />
                  {inactivePeriodInvoices.length > 0 ? (
                    <div className="border-t border-border-light bg-surface-hover/20">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover/40"
                        onClick={() => setShowInactiveInvoices((v) => !v)}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-text-secondary">Closed</span>
                          {inactiveInvoiceCounts.cancelled > 0 ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                              {inactiveInvoiceCounts.cancelled} cancelled
                            </span>
                          ) : null}
                          {inactiveInvoiceCounts.paid > 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                              {inactiveInvoiceCounts.paid} paid
                            </span>
                          ) : null}
                        </div>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", showInactiveInvoices && "rotate-180")} />
                      </button>
                      {showInactiveInvoices ? (
                        <InvoiceLedgerTable
                          invoices={inactivePeriodInvoices}
                          todayYmd={todayYmd}
                          selectedIds={selectedInvoiceIds}
                          onSelectionChange={setSelectedInvoiceIds}
                          resolveAccountId={data.resolveAccountId}
                          accountNameById={data.accountNameById}
                          onOpen={openInvoice}
                          onMarkPaid={(id) => void bulkMarkInvoicesPaid([id], profile ?? undefined).then(() => data.loadData())}
                          compact
                        />
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <SelfBillGroupedLedger
                    groups={selfBillWeekPartnerGroups}
                    todayYmd={todayYmd}
                    selectedIds={selectedSbIds}
                    onSelectionChange={setSelectedSbIds}
                    partnerDueCtx={data.partnerDueCtx}
                    onOpen={(sb) => void openSelfBill(sb)}
                    onMarkPaid={async (id) => {
                      await markSelfBillsPaid([id]);
                      toast.success("Marked paid");
                      await data.loadData();
                    }}
                    emptyLabel="No active self-bills in this period."
                    collapsiblePartners={{
                      expandedKeys: expandedLedgerSelfBillPartners,
                      onToggle: toggleLedgerSelfBillPartner,
                    }}
                  />
                  {inactivePeriodSelfBills.length > 0 ? (
                    <div className="border-t border-border-light bg-surface-hover/20">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover/40"
                        onClick={() => setShowInactiveSelfBills((v) => !v)}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-text-secondary">Closed</span>
                          {inactiveSelfBillCounts.cancelled > 0 ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                              {inactiveSelfBillCounts.cancelled} cancelled
                            </span>
                          ) : null}
                          {inactiveSelfBillCounts.paid > 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                              {inactiveSelfBillCounts.paid} paid
                            </span>
                          ) : null}
                          {inactiveSelfBillCounts.voided > 0 ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                              {inactiveSelfBillCounts.voided} void
                            </span>
                          ) : null}
                        </div>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", showInactiveSelfBills && "rotate-180")} />
                      </button>
                      {showInactiveSelfBills ? (
                        <SelfBillGroupedLedger
                          groups={inactiveSelfBillWeekPartnerGroups}
                          todayYmd={todayYmd}
                          selectedIds={selectedSbIds}
                          onSelectionChange={setSelectedSbIds}
                          partnerDueCtx={data.partnerDueCtx}
                          onOpen={(sb) => void openSelfBill(sb)}
                          onMarkPaid={async (id) => {
                            await markSelfBillsPaid([id]);
                            toast.success("Marked paid");
                            await data.loadData();
                          }}
                          variant="compact"
                          collapsiblePartners={{
                            expandedKeys: expandedLedgerSelfBillPartners,
                            onToggle: toggleLedgerSelfBillPartner,
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="rounded-xl border border-border-light bg-white shadow-sm overflow-hidden">
              <div className="border-b border-border-light px-5 py-4">
                <h2 className="text-sm font-semibold text-[#020040]">By customer · exposure</h2>
                <p className="text-xs text-text-secondary">{periodLabel} · due or paid in range.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border-light bg-surface-hover/40 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                    <tr>
                      <th className="px-4 py-2">Account</th>
                      <th className="px-4 py-2">Terms</th>
                      <th className="px-4 py-2 text-right">Outstanding</th>
                      <th className="px-4 py-2 text-right">Overdue</th>
                      <th className="px-4 py-2 text-right">On-time</th>
                      <th className="px-4 py-2">Last paid</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {customers.map((c) => (
                      <tr key={c.accountId} className="hover:bg-surface-hover/30">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{c.accountName}</p>
                          <p className="text-xs text-text-tertiary">{c.openCount} open invoices</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-text-secondary">{c.terms}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatCurrency(c.outstanding)}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-600">{formatCurrency(c.overdue)}</td>
                        <td className="px-4 py-2.5 text-right text-xs">{c.onTimePct != null ? `${c.onTimePct}%` : "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-text-secondary">{c.lastPaidYmd ? formatDate(c.lastPaidYmd) : "—"}</td>
                        <td className="px-4 py-2.5" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
          </div>
        )}

        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          onClose={closeInvoiceDrawer}
          onStatusChange={async (inv, status) => {
            const updated = await updateInvoiceStatusOne(inv, status);
            setSelectedInvoice(updated);
            await data.loadData();
          }}
          onInvoiceUpdated={(inv) => {
            setSelectedInvoice(inv);
            void data.loadData();
          }}
        />

        <SelfBillDetailDrawer
          sb={drawerSb}
          jobs={drawerSbJobs}
          loadingJobs={loadingDrawerJobs}
          partnerPaidByJobId={data.partnerPaidByJobId}
          todayYmd={todayYmd}
          onClose={closeSelfBillDrawer}
          onMarkReadyToPay={async () => {
            if (!drawerSb) return;
            const supabase = getSupabase();
            await supabase.from("self_bills").update({ status: "ready_to_pay" }).eq("id", drawerSb.id);
            toast.success("Ready to pay");
            await data.loadData();
          }}
          onMarkPaid={async () => {
            if (!drawerSb) return;
            await markSelfBillsPaid([drawerSb.id]);
            toast.success("Marked paid");
            await data.loadData();
          }}
          onReopen={async () => {
            if (!drawerSb) return;
            const supabase = getSupabase();
            await supabase.from("self_bills").update({ status: "ready_to_pay" }).eq("id", drawerSb.id);
            toast.success("Reopened");
            await data.loadData();
          }}
          onRefresh={async () => {
            closeSelfBillDrawer();
            await data.loadData();
          }}
          onEditTotals={() => toast.message("Edit totals in self-bill drawer tabs")}
          onPartnerPaymentsRecorded={() => data.loadData()}
        />

        <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />

        {ledgerTab === "inv" ? (
          <BillingBulkBar
            count={selectedInvoiceIds.size}
            saving={bulkSaving}
            variant="invoice"
            onClear={() => setSelectedInvoiceIds(new Set())}
            onMarkPaid={async () => {
              setBulkSaving(true);
              try {
                await bulkMarkInvoicesPaid([...selectedInvoiceIds], profile ?? undefined);
                toast.success("Marked paid");
                setSelectedInvoiceIds(new Set());
                await data.loadData();
              } catch {
                toast.error("Failed");
              } finally {
                setBulkSaving(false);
              }
            }}
          />
        ) : (
          <BillingBulkBar
            count={selectedSbIds.size}
            saving={bulkSaving}
            emailSending={emailSending}
            variant="selfbill"
            onClear={() => setSelectedSbIds(new Set())}
            onMarkPaid={async () => {
              const eligible = getBulkEligibleSelfBillIds(selectedSbIds, data.selfBills, sbPayableIdSet);
              if (!eligible.length) return;
              setBulkSaving(true);
              try {
                const total = eligible.reduce((s, id) => {
                  const sb = data.selfBills.find((x) => x.id === id);
                  return s + (sb ? computeSelfBillAmountDue(sb, data.jobsBySelfBillId[id], data.partnerPaidByJobId) : 0);
                }, 0);
                await markSelfBillsPaid(eligible);
                toast.success(`Marked ${eligible.length} paid · ${formatCurrency(total)}`);
                setSelectedSbIds(new Set());
                await data.loadData();
              } catch {
                toast.error("Failed");
              } finally {
                setBulkSaving(false);
              }
            }}
            onEmail={async () => {
              const eligible = getBulkEligibleSelfBillIds(selectedSbIds, data.selfBills, sbPayableIdSet, { forEmail: true });
              if (!eligible.length) return;
              setEmailSending(true);
              try {
                const { sent } = await bulkSendSelfBillEmails(eligible);
                toast.success(`${sent} email(s) sent`);
                setSelectedSbIds(new Set());
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Email failed");
              } finally {
                setEmailSending(false);
              }
            }}
            onCancel={async () => {
              const eligible = getBulkCancellableSelfBillIds(selectedSbIds, data.selfBills, sbCancellableIdSet);
              if (!eligible.length) {
                toast.error("No cancellable self-bills selected");
                return;
              }
              if (!window.confirm(`Cancel ${eligible.length} self-bill(s)?`)) return;
              setBulkSaving(true);
              try {
                await bulkCancelSelfBills(eligible);
                toast.success("Cancelled");
                setSelectedSbIds(new Set());
                await data.loadData();
              } catch {
                toast.error("Failed");
              } finally {
                setBulkSaving(false);
              }
            }}
          />
        )}
      </div>
    </PageTransition>
  );
}

export function BillingStandaloneClient() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-sm text-text-tertiary">Loading…</p>}>
      <BillingStandaloneInner />
    </Suspense>
  );
}

type SelfBillWeekPartnerGroup = {
  weekKey: string;
  weekTitle: string;
  weekSubtitle: string | null;
  weekTotal: number;
  partners: {
    partnerKey: string;
    partnerName: string;
    partnerTotal: number;
    rows: SelfBill[];
  }[];
};

function selfBillWeekGroupMeta(
  sb: Pick<SelfBill, "week_label" | "week_start" | "week_end" | "due_date" | "partner_id">,
  dueCtx: SelfBillDueResolveContext,
): { key: string; title: string; subtitle: string | null } {
  const due = selfBillDueYmd(sb, dueCtx);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const period = workPeriodBoundsForPayoutFriday(due);
    return {
      key: due,
      title: `Pay · ${formatDate(due)}`,
      subtitle: `Work · ${formatDate(period.periodStartYmd)} – ${formatDate(period.periodEndYmd)}`,
    };
  }
  const label = sb.week_label?.trim();
  if (label) {
    const wk = label.replace(/^\d{4}-W/, "W");
    const subtitle =
      sb.week_start && sb.week_end ? `${formatDate(sb.week_start)} → ${formatDate(sb.week_end)}` : null;
    return { key: label, title: `Week ${wk}`, subtitle };
  }
  if (sb.week_start?.trim()) {
    const key = sb.week_start.trim().slice(0, 10);
    const subtitle = sb.week_end ? `${formatDate(sb.week_start)} → ${formatDate(sb.week_end)}` : null;
    return { key, title: `Week · ${formatDate(sb.week_start)}`, subtitle };
  }
  return { key: "unknown", title: "Week · unknown", subtitle: null };
}

function buildSelfBillWeekPartnerGroups(
  selfBills: SelfBill[],
  dueCtx: SelfBillDueResolveContext,
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>,
  partnerPaidByJobId: Record<string, number>,
): SelfBillWeekPartnerGroup[] {
  const weekMap = new Map<string, SelfBillWeekPartnerGroup>();
  for (const sb of selfBills) {
    const { key: weekKey, title: weekTitle, subtitle: weekSubtitle } = selfBillWeekGroupMeta(sb, dueCtx);
    let week = weekMap.get(weekKey);
    if (!week) {
      week = { weekKey, weekTitle, weekSubtitle, weekTotal: 0, partners: [] };
      weekMap.set(weekKey, week);
    }
    const partnerKey = sb.partner_id?.trim() || sb.partner_name?.trim() || "unknown";
    let partner = week.partners.find((p) => p.partnerKey === partnerKey);
    if (!partner) {
      partner = { partnerKey, partnerName: sb.partner_name ?? "Unknown partner", partnerTotal: 0, rows: [] };
      week.partners.push(partner);
    }
    partner.rows.push(sb);
    const amt = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
    partner.partnerTotal = Math.round((partner.partnerTotal + amt) * 100) / 100;
    week.weekTotal = Math.round((week.weekTotal + amt) * 100) / 100;
  }
  return [...weekMap.values()]
    .map((week) => ({
      ...week,
      partners: week.partners
        .map((p) => ({
          ...p,
          rows: [...p.rows].sort((a, b) => (a.reference ?? "").localeCompare(b.reference ?? "")),
        }))
        .sort((a, b) => a.partnerName.localeCompare(b.partnerName)),
    }))
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
}

function openInvoicePdf(invoiceId: string) {
  window.open(`/api/invoices/${invoiceId}/pdf`, "_blank", "noopener,noreferrer");
}

function InvoiceLedgerTable({
  invoices,
  todayYmd,
  selectedIds,
  onSelectionChange,
  resolveAccountId,
  accountNameById,
  onOpen,
  onMarkPaid,
  emptyLabel,
  compact,
}: {
  invoices: Invoice[];
  todayYmd: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  resolveAccountId: (inv: Invoice) => string | null;
  accountNameById: Record<string, string>;
  onOpen: (inv: Invoice) => void;
  onMarkPaid: (id: string) => void;
  emptyLabel?: string;
  compact?: boolean;
}) {
  if (!invoices.length) {
    return emptyLabel ? (
      <p className={cn("text-center text-sm text-text-tertiary", compact ? "px-4 py-6" : "px-4 py-12")}>{emptyLabel}</p>
    ) : null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        {!compact ? (
          <thead className="border-b border-border-light bg-surface-hover/40 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
        ) : null}
        <tbody className="divide-y divide-border-light">
          {invoices.map((inv) => {
            const canSelect = inv.status !== "paid" && inv.status !== "cancelled";
            const st = invoiceDisplayStatus(inv, todayYmd);
            const accId = resolveAccountId(inv);
            const { total } = vatSplitFromGross(Number(inv.amount ?? 0));
            return (
              <tr key={inv.id} className="hover:bg-surface-hover/30">
                <td className="px-3 py-2">
                  {canSelect ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(inv.id)}
                      onChange={(e) => {
                        onSelectionChange(
                          (() => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(inv.id);
                            else next.delete(inv.id);
                            return next;
                          })(),
                        );
                      }}
                      className="h-3.5 w-3.5 accent-[#020040]"
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <p className="font-semibold">{inv.reference}</p>
                  <p className="text-xs text-text-tertiary">{inv.job_reference ?? "—"}</p>
                </td>
                <td className="px-3 py-2 text-xs">{accId ? accountNameById[accId] ?? inv.client_name : inv.client_name}</td>
                <td className="px-3 py-2 text-xs">{formatDate(inv.due_date)}</td>
                <td className="px-3 py-2"><InvoiceStatusPill status={st} /></td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(total)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {canSelect ? (
                      <button type="button" title="Mark paid" className="rounded border border-border-light p-1 hover:bg-emerald-50" onClick={() => onMarkPaid(inv.id)}>
                        <Check className="h-3.5 w-3.5 text-emerald-700" />
                      </button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      title="View PDF"
                      icon={<FileText className="h-3.5 w-3.5" />}
                      onClick={() => openInvoicePdf(inv.id)}
                    >
                      PDF
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onOpen(inv)}>Open</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SelfBillGroupedLedger({
  groups,
  todayYmd,
  selectedIds,
  onSelectionChange,
  partnerDueCtx,
  onOpen,
  onMarkPaid,
  variant = "full",
  emptyLabel = "No self-bills in this period.",
  collapsiblePartners,
}: {
  groups: SelfBillWeekPartnerGroup[];
  todayYmd: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  partnerDueCtx: (partnerId: string | null | undefined) => SelfBillDueResolveContext;
  onOpen: (sb: SelfBill) => void;
  onMarkPaid: (id: string) => Promise<void>;
  variant?: "full" | "compact";
  emptyLabel?: string;
  collapsiblePartners?: {
    expandedKeys: Set<string>;
    onToggle: (partnerGroupKey: string) => void;
  };
}) {
  const compact = variant === "compact";
  if (!groups.length) {
    return (
      <p className={cn("text-center text-sm text-text-tertiary", compact ? "px-5 py-8" : "px-4 py-12")}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="divide-y divide-border-light">
      {groups.map((week) => (
        <div key={week.weekKey}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light bg-[#020040]/[0.03] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#020040]">{week.weekTitle}</p>
              {week.weekSubtitle ? <p className="text-xs text-text-secondary">{week.weekSubtitle}</p> : null}
            </div>
            <p className="text-sm font-bold tabular-nums text-[#020040]">{formatCurrency(week.weekTotal)}</p>
          </div>
          {week.partners.map((partner) => {
            const partnerGroupKey = `${week.weekKey}::${partner.partnerKey}`;
            const partnerOpen = !collapsiblePartners || collapsiblePartners.expandedKeys.has(partnerGroupKey);
            return (
            <div key={partnerGroupKey}>
              {collapsiblePartners ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 bg-surface-hover/30 px-4 py-2.5 text-left hover:bg-surface-hover/50"
                  onClick={() => collapsiblePartners.onToggle(partnerGroupKey)}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">
                      {partner.partnerName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#020040]">{partner.partnerName}</p>
                      <p className="text-xs text-text-tertiary">{partner.rows.length} self-bill{partner.rows.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(partner.partnerTotal)}</p>
                    <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", partnerOpen && "rotate-180")} />
                  </div>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 bg-surface-hover/30 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">
                      {partner.partnerName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#020040]">{partner.partnerName}</p>
                      <p className="text-xs text-text-tertiary">{partner.rows.length} self-bill{partner.rows.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(partner.partnerTotal)}</p>
                </div>
              )}
              {partnerOpen ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-border-light">
                    {partner.rows.map((sb) => {
                      const canSelect = !isSelfBillPayoutVoided(sb) && sb.status !== "paid";
                      const overdue = isSelfBillOverdue(sb, todayYmd, partnerDueCtx(sb.partner_id));
                      const label = sb.status === "paid" ? "Paid" : overdue ? "Overdue" : selfBillCountsAsReady(sb) ? "Ready" : "Draft";
                      return (
                        <tr key={sb.id} className="hover:bg-surface-hover/30">
                          <td className={cn("w-8", compact ? "px-4 py-2" : "px-3 py-2")}>
                            {canSelect ? (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(sb.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedIds);
                                  if (e.target.checked) next.add(sb.id);
                                  else next.delete(sb.id);
                                  onSelectionChange(next);
                                }}
                                className="h-3.5 w-3.5 accent-[#020040]"
                              />
                            ) : null}
                          </td>
                          <td className={cn("font-semibold", compact ? "px-4 py-2" : "px-3 py-2")}>{sb.reference}</td>
                          {!compact ? (
                            <td className="px-3 py-2 text-xs text-text-secondary">{sb.week_label ?? sb.period ?? "—"}</td>
                          ) : null}
                          <td className={cn(compact ? "px-2 py-2" : "px-3 py-2")}><StatusPill label={label} tone={label === "Paid" ? "ok" : label === "Overdue" ? "bad" : "info"} /></td>
                          <td className={cn("text-right font-medium tabular-nums", compact ? "px-4 py-2" : "px-3 py-2")}>{formatCurrency(Number(sb.net_payout ?? 0))}</td>
                          <td className={cn(compact ? "px-4 py-2" : "px-3 py-2")}>
                            <div className="flex gap-1">
                              {canSelect ? (
                                <button type="button" title="Mark paid" className="rounded border border-border-light p-1 hover:bg-emerald-50" onClick={() => void onMarkPaid(sb.id)}>
                                  <Check className="h-3.5 w-3.5 text-emerald-700" />
                                </button>
                              ) : null}
                              <Button variant="ghost" size="sm" onClick={() => onOpen(sb)}>{compact ? "Review" : "Open"}</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              ) : null}
            </div>
          );
          })}
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, alert, coral, green }: { label: string; value: string; sub: string; alert?: boolean; coral?: boolean; green?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border bg-white px-4 py-3 shadow-sm",
      alert ? "border-red-200 bg-red-50/30" : coral ? "border-orange-200 bg-orange-50/30" : "border-border-light",
    )}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", green ? "text-emerald-700" : "text-[#020040]")}>{value}</p>
      <p className="mt-0.5 text-xs text-text-secondary">{sub}</p>
    </div>
  );
}

function LedgerTabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", active ? "bg-[#020040] text-white" : "text-text-secondary hover:bg-surface-hover")}>
      {label} <span className="ml-1 opacity-70">{count}</span>
    </button>
  );
}

function InvoiceStatusPill({ status }: { status: ReturnType<typeof invoiceDisplayStatus> }) {
  const tone = status === "Paid" ? "ok" : status === "Overdue" ? "bad" : status === "Draft" ? "muted" : "info";
  return <StatusPill label={status} tone={tone} />;
}

function AgingBar({ aging, compact = false }: { aging: ReturnType<typeof computeAgingTotals>; compact?: boolean }) {
  const total = aging.current + aging.d1_7 + aging.d8_30 + aging.d30plus || 1;
  const pct = (n: number) => `${Math.max(0, (n / total) * 100)}%`;
  return (
    <div className={cn(compact ? "mt-3" : "px-5 py-4")}>
      <div className={cn("flex overflow-hidden rounded-full bg-surface-hover", compact ? "h-1.5" : "h-2.5")}>
        <span className="bg-emerald-500" style={{ width: pct(aging.current) }} />
        <span className="bg-amber-400" style={{ width: pct(aging.d1_7) }} />
        <span className="bg-[#ED4B00]" style={{ width: pct(aging.d8_30) }} />
        <span className="bg-red-600" style={{ width: pct(aging.d30plus) }} />
      </div>
      <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary", compact ? "mt-2" : "mt-3")}>
        <span>Current <b className="text-[#020040]">{formatCurrency(aging.current)}</b></span>
        <span>1–7 days <b className="text-[#020040]">{formatCurrency(aging.d1_7)}</b></span>
        <span>8–30 days <b className="text-[#020040]">{formatCurrency(aging.d8_30)}</b></span>
        <span>30+ <b className="text-[#020040]">{formatCurrency(aging.d30plus)}</b></span>
      </div>
    </div>
  );
}
