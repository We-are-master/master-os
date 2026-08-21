"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Download, RefreshCw, Briefcase, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, ExternalLink } from "lucide-react";
import { PageTransition } from "@/components/layout/page-transition";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { useBillingStandaloneData } from "@/hooks/use-billing-standalone-data";
import {
  billingStandaloneFilterDescription,
  defaultBillingStandaloneFilter,
  resolveBillingStandaloneFilterBounds,
  type BillingStandaloneFilterValue,
} from "@/lib/billing-standalone-filter";
import { addMonths, format as formatDateFns, parseISO, startOfMonth } from "date-fns";
import {
  addDaysYmd,
  formatPeriodBoundsLabel,
  resolveBillingStandaloneBounds,
  todayYmdLocal,
  selfBillPayWorkPeriodInPeriod,
  ymdInBounds,
} from "@/lib/billing-standalone-period";
import {
  cashflowRunwayHintForView,
  cashflowWeekColumnTitle,
  cashflowWeekHasActivity,
  cashflowWeekNet,
  formatCashflowWeekPnl,
  formatCashRunwayClosing,
} from "@/lib/billing-cashflow-runway-copy";
import { startOfWeekMondayFromYmd } from "@/lib/dashboard-cashflow-buckets";
import { BillingStandalonePeriodFilter } from "@/components/finance/billing-standalone-period-filter";
import { CashflowWeekDetailModal } from "@/components/finance/cashflow-week-detail-modal";
import { workPeriodBoundsForPayoutFriday } from "@/lib/partner-payout-schedule";
import {
  buildAttentionAccountGroups,
  buildInvoiceLedgerAccountGroups,
  computeAgingTotals,
  computeBillingKpis,
  selfBillCountsAsReady,
  selfBillDueYmd,
  isSelfBillOverdue,
} from "@/lib/billing-standalone-metrics";
import {
  buildRunwayWeekBreakdown,
  buildRunwayWeekly,
  type RunwayViewMode,
} from "@/lib/billing-runway-views";
import { invoiceDisplayStatus } from "@/lib/billing-invoice-list-data";
import type { InvoiceListJobSnapshot } from "@/lib/billing-invoice-list-data";
import {
  invoiceEffectivePaidWithJobCustomerPaid,
  invoiceBalanceDueWithJobCustomerPaid,
} from "@/lib/invoice-balance";
import { invoiceDisplayDueYmd, invoiceFinanceListTodayYmd } from "@/lib/invoice-finance-tab";
import { bulkMarkInvoicesPaid, syncInvoicesForJobIds, updateInvoiceStatusOne } from "@/lib/billing-invoice-actions";
import { displayBillingReference } from "@/lib/billing-reference";
import {
  bulkApproveSelfBills,
  bulkCancelSelfBills,
  bulkSendSelfBillEmails,
  bulkUnapproveSelfBills,
  computeSelfBillAmountDue,
  getBulkCancellableSelfBillIds,
  getBulkEligibleSelfBillIds,
  markSelfBillsPaid,
  type SelfBillJobLine,
} from "@/lib/billing-selfbill-actions";
import type { SelfBillDueResolveContext } from "@/lib/partner-payout-schedule";
import { syncWorkforceSelfBillsForBilling } from "@/lib/billing-workforce-sync";
import { getCompanySettings, updateCompanySettings } from "@/services/company";
import { mergeFrontendSetup } from "@/lib/frontend-setup";
import { orgCtxFromSetup } from "@/lib/account-payment-due-date";
import {
  isSelfBillClosed,
  isSelfBillPayoutVoided,
  jobContributesToSelfBillPayout,
  listJobsForSelfBill,
} from "@/services/self-bills";
import { getSupabase } from "@/services/base";
import { BillingBulkBar, StatusPill } from "@/components/finance/billing-bulk-bar";
import { MoneyInReadyList } from "@/components/finance/money-in-ready-list";
import { MoneyOutPayActions } from "@/components/finance/money-out-pay-actions";
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal";
import { createInvoice, type CreateInvoiceInput } from "@/services/invoices";
import { logAudit } from "@/services/audit";
import {
  defaultSelfBillPayoutPlanRows,
  hasActiveSelfBillPaymentPlan,
  selfBillEffectiveDueYmd,
  selfBillIsInstallmentDueForWisePay,
} from "@/lib/self-bill-payment-plan";
import { createSelfBillPaymentPlan } from "@/services/self-bill-payment-plan";
import type { Invoice, InvoicePaymentInstallment, SelfBill, SelfBillPaymentInstallment } from "@/types/database";
import "./billing-standalone.css";

const InvoiceDetailDrawer = dynamic(
  () => import("./invoices-finance-client").then((m) => m.InvoiceDetailDrawer),
  { ssr: false },
);
const SelfBillDetailDrawer = dynamic(
  () => import("./selfbill-finance-client").then((m) => m.SelfBillDetailDrawer),
  { ssr: false },
);

type MoneyInTab = "draft" | "ready";
type MoneyOutTab = "draft" | "ready";

const CASHFLOW_WINDOW_WEEKS = 10;

function BillingContentSkeleton() {
  return (
    <div className="flex flex-col gap-5 sm:gap-6 animate-pulse" aria-hidden>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-xl bg-surface-hover" />
        ))}
      </div>
      <div className="h-36 rounded-xl bg-surface-hover" />
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:gap-6">
        <div className="h-52 rounded-xl bg-surface-hover" />
        <div className="h-52 rounded-xl bg-surface-hover" />
      </div>
      <div className="h-80 rounded-xl bg-surface-hover" />
    </div>
  );
}

function selfBillPartnerEmailSendEligible(
  sb: Pick<SelfBill, "bill_origin" | "partner_id" | "status">,
): boolean {
  return !isSelfBillPayoutVoided(sb) && sb.bill_origin !== "internal" && !!sb.partner_id?.trim();
}

function bulkApproveActionLabel(approveIds: string[], selfBills: SelfBill[]): string {
  const count = approveIds.length;
  if (!count) return "Approve";
  const sendable = approveIds.filter((id) => {
    const sb = selfBills.find((s) => s.id === id);
    return sb && selfBillPartnerEmailSendEligible(sb);
  }).length;
  if (sendable === 0) return `Approve (${count})`;
  if (sendable === count) return `Approve & Send (${count})`;
  return `Approve all (${count})`;
}

function formatSelfBillSendToast(sent: number, emailsSent: number): string {
  if (emailsSent <= 0) return "No emails sent";
  if (emailsSent === 1 && sent === 1) return "1 email sent";
  if (emailsSent === sent) {
    return `${emailsSent} email${emailsSent === 1 ? "" : "s"} sent`;
  }
  return `${emailsSent} email${emailsSent === 1 ? "" : "s"} sent (${sent} self-bills)`;
}

function invoiceCanSelectForPayment(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
): boolean {
  if (inv.status === "paid" || inv.status === "cancelled" || inv.status === "on_hold") return false;
  const jobOnHold = inv.job_reference?.trim()
    ? jobsByRef[inv.job_reference.trim()]?.status === "on_hold"
    : false;
  return !jobOnHold;
}

function BillingStandaloneInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useProfile();
  const { setup: frontendSetup, refetch: refetchFrontendSetup } = useFrontendSetup();
  const [periodFilter, setPeriodFilter] = useState<BillingStandaloneFilterValue>(defaultBillingStandaloneFilter);
  const data = useBillingStandaloneData();
  const { loadData, hasLoadedOnce, selfBills: billingSelfBills, patchInvoicesPaid, ensureSelfBillJobsEnriched } = data;

  const handleMarkInvoicesPaid = useCallback(
    async (ids: string[], opts?: { clearSelection?: boolean; received?: boolean }) => {
      if (!ids.length) return;
      patchInvoicesPaid(ids);
      if (opts?.clearSelection) setSelectedInvoiceIds(new Set());
      const label = opts?.received ? "received" : "paid";
      try {
        await bulkMarkInvoicesPaid(ids, profile ?? undefined);
        toast.success(
          ids.length === 1 ? `Invoice marked ${label}` : `${ids.length} invoices marked ${label}`,
        );
        void loadData({ background: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Failed to mark ${label}`);
        void loadData({ background: true });
      }
    },
    [loadData, patchInvoicesPaid, profile],
  );

  const handleMarkInvoicePaid = useCallback(
    (id: string, opts?: { received?: boolean }) => void handleMarkInvoicesPaid([id], opts),
    [handleMarkInvoicesPaid],
  );
  const [moneyInTab, setMoneyInTab] = useState<MoneyInTab>(() => {
    const inTab = searchParams.get("in");
    return inTab === "draft" ? "draft" : "ready";
  });
  const [moneyOutTab, setMoneyOutTab] = useState<MoneyOutTab>(() => {
    const outTab = searchParams.get("out");
    /** "paid" stopped being a tab (bottom fold now) — old links land on Ready. */
    if (outTab === "draft" || outTab === "ready") return outTab;
    return "ready";
  });
  const invoiceIdFromUrl = searchParams.get("invoiceId");
  const selfBillIdFromUrl = searchParams.get("selfBillId");
  const [createOpen, setCreateOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [selectedSbIds, setSelectedSbIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [sendingSelfBillIds, setSendingSelfBillIds] = useState<Set<string>>(new Set());
  const [approvingSelfBillIds, setApprovingSelfBillIds] = useState<Set<string>>(new Set());
  const [readyingSelfBillIds, setReadyingSelfBillIds] = useState<Set<string>>(new Set());
  const [moneyOutSelectedIds, setMoneyOutSelectedIds] = useState<Set<string>>(new Set());
  const [schedulingPaymentIds, setSchedulingPaymentIds] = useState<Set<string>>(new Set());

  // Inline Send / Resend handler used by the Going Out · Money Out widget:
  // `week` → standard cycle (master ticket), single-row sends pass `auto` so the
  // server reuses an existing standard run for the same week if there is one.
  const handleApproveSelfBills = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setApprovingSelfBillIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      try {
        const r = await bulkApproveSelfBills(ids);
        if (r.approved > 0) {
          toast.success(r.approved === 1 ? "Self-bill approved" : `${r.approved} approved`);
        }
        if (r.skipped.length > 0) {
          toast.error(`${r.skipped.length} skipped — ${r.skipped[0]?.reason ?? "see logs"}`);
        }
        setSelectedSbIds(new Set());
        await loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Approve failed");
      } finally {
        setApprovingSelfBillIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [loadData],
  );

  const handleUnapproveSelfBills = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setApprovingSelfBillIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      try {
        const r = await bulkUnapproveSelfBills(ids);
        if (r.unapproved > 0) {
          toast.success(r.unapproved === 1 ? "Approval revoked" : `${r.unapproved} unapproved`);
        }
        if (r.skipped.length > 0) {
          toast.error(`${r.skipped.length} skipped — ${r.skipped[0]?.reason ?? "see logs"}`);
        }
        await loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Unapprove failed");
      } finally {
        setApprovingSelfBillIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [loadData],
  );

  /** Inverse of Mark ready: a self-bill made Ready by mistake goes back to Draft (accumulating). */
  const handleMoveSelfBillsBackToDraft = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const eligible = ids.filter((id) => {
        const sb = billingSelfBills.find((s) => s.id === id);
        return !!sb && sb.status !== "paid" && !sb.wise_paid_at && !isSelfBillPayoutVoided(sb);
      });
      if (!eligible.length) {
        toast.error("Nothing to move back to draft.");
        return;
      }
      setBulkSaving(true);
      try {
        const supabase = getSupabase();
        const { error } = await supabase
          .from("self_bills")
          .update({ status: "accumulating", approved_at: null, approved_by: null })
          .in("id", eligible);
        if (error) throw error;
        toast.success(
          eligible.length === 1 ? "Moved back to Draft" : `${eligible.length} moved back to Draft`,
        );
        setMoneyOutSelectedIds(new Set());
        setSelectedSbIds(new Set());
        await loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to move back to draft");
      } finally {
        setBulkSaving(false);
      }
    },
    [billingSelfBills, loadData],
  );

  const handleMarkSelfBillsReadyToPay = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setReadyingSelfBillIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      try {
        const supabase = getSupabase();
        const { error } = await supabase
          .from("self_bills")
          .update({ status: "ready_to_pay" })
          .in("id", ids);
        if (error) throw error;

        toast.success(ids.length === 1 ? "Marked ready to pay" : `${ids.length} marked ready to pay`);
        setSelectedSbIds(new Set());
        void loadData();

        // Pre-creating next period's workforce draft is a nice-to-have that
        // doesn't affect the "marked ready to pay" outcome — was awaited
        // before the toast could show, blocking on N external round trips.
        const internalMarked = billingSelfBills.filter(
          (sb) =>
            ids.includes(sb.id) &&
            sb.bill_origin === "internal" &&
            sb.internal_cost_id?.trim(),
        );
        if (internalMarked.length > 0) {
          void Promise.all(
            internalMarked.map(async (sb) => {
              const ws = sb.week_start?.trim().slice(0, 10) ?? "";
              const nextAnchor = /^\d{4}-\d{2}-\d{2}$/.test(ws)
                ? formatDateFns(startOfMonth(addMonths(parseISO(`${ws}T12:00:00`), 1)), "yyyy-MM-dd")
                : formatDateFns(startOfMonth(addMonths(new Date(), 1)), "yyyy-MM-dd");
              const res = await fetch("/api/workforce/sync-self-bills", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  personId: sb.internal_cost_id,
                  anchorDate: nextAnchor,
                }),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? "Failed to create next workforce period");
              }
            }),
          )
            .then(() => {
              toast.success(`${internalMarked.length} next-period workforce draft(s) created`);
              void loadData();
            })
            .catch((e) => {
              toast.error(e instanceof Error ? e.message : "Failed to create next workforce period");
            });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to mark ready");
      } finally {
        setReadyingSelfBillIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [billingSelfBills, loadData],
  );

  /**
   * Bulk Wise payout was removed with the header's "Pay with Wise" button
   * (not in use for now) — restore both from git history if Wise returns.
   */
  const handleBulkMarkSelfBillsPaid = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const eligible = ids.filter((id) => {
        const sb = billingSelfBills.find((s) => s.id === id);
        return (
          sb &&
          !isSelfBillPayoutVoided(sb) &&
          sb.status !== "paid" &&
          !sb.wise_paid_at
        );
      });
      if (!eligible.length) {
        toast.error("No payable self-bills selected");
        return;
      }
      setBulkSaving(true);
      try {
        await markSelfBillsPaid(eligible);
        toast.success(
          eligible.length === 1 ? "Marked paid" : `${eligible.length} self-bills marked paid`,
        );
        setMoneyOutSelectedIds(new Set());
        setSelectedSbIds(new Set());
        /** Paid is a bottom fold now — open it so the rows visibly land there. */
        setShowPaidSelfBills(true);
        await loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to mark paid");
      } finally {
        setBulkSaving(false);
      }
    },
    [billingSelfBills, loadData],
  );

  const handleBulkSchedulePayment = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setSchedulingPaymentIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      let created = 0;
      let skipped = 0;
      try {
        for (const id of ids) {
          const sb = billingSelfBills.find((s) => s.id === id);
          if (!sb || sb.bill_origin === "internal" || isSelfBillPayoutVoided(sb)) {
            skipped += 1;
            continue;
          }
          const installments = data.installmentsBySelfBillId[id];
          if (hasActiveSelfBillPaymentPlan(installments)) {
            skipped += 1;
            continue;
          }
          const total = Math.max(0, Number(sb.net_payout ?? 0));
          if (total <= 0.02) {
            skipped += 1;
            continue;
          }
          const drafts = defaultSelfBillPayoutPlanRows(total, 4, data.partnerDueCtx(sb.partner_id));
          await createSelfBillPaymentPlan(sb.id, total, drafts);
          created += 1;
        }
        if (created > 0) {
          toast.success(
            created === 1
              ? "Payout plan scheduled"
              : `${created} payout plans scheduled on upcoming Fridays`,
          );
          await loadData();
        }
        if (skipped > 0 && created === 0) {
          toast.message("All selected self-bills already have a payout plan or cannot be scheduled");
        } else if (skipped > 0) {
          toast.message(`${skipped} skipped — already scheduled or not eligible`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to schedule payment");
      } finally {
        setSchedulingPaymentIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [billingSelfBills, data.installmentsBySelfBillId, data.partnerDueCtx, loadData],
  );

  const handleSendSelfBills = useCallback(
    async (ids: string[], scope: "week" | "partner" | "row") => {
      if (!ids.length) return;
      setSendingSelfBillIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      try {
        const cycleKind = scope === "week" ? "standard" : "auto";
        const result = await bulkSendSelfBillEmails(ids, {
          cycleKind,
          bundleByPartner: scope !== "row",
        });
        if (result.sent > 0) {
          toast.success(formatSelfBillSendToast(result.sent, result.emailsSent));
        }
        if (result.skipped.length > 0) {
          toast.error(
            `${result.skipped.length} skipped — ${result.skipped[0]?.reason ?? "see logs"}`,
          );
        }
        await loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Send failed");
      } finally {
        setSendingSelfBillIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [loadData],
  );

  const handleApproveAndSendSelfBills = useCallback(
    async (approveIds: string[], scope: "week" | "partner" | "row") => {
      if (!approveIds.length) return;
      const sendIds = approveIds.filter((id) => {
        const sb = billingSelfBills.find((s) => s.id === id);
        return (
          sb &&
          !isSelfBillPayoutVoided(sb) &&
          sb.bill_origin !== "internal" &&
          !!sb.partner_id?.trim()
        );
      });
      setApprovingSelfBillIds((prev) => {
        const next = new Set(prev);
        approveIds.forEach((id) => next.add(id));
        return next;
      });
      setSendingSelfBillIds((prev) => {
        const next = new Set(prev);
        sendIds.forEach((id) => next.add(id));
        return next;
      });
      try {
        const approveResult = await bulkApproveSelfBills(approveIds);
        if (approveResult.approved > 0) {
          toast.success(
            approveResult.approved === 1
              ? "Self-bill approved"
              : `${approveResult.approved} approved`,
          );
        }
        if (approveResult.skipped.length > 0) {
          toast.error(
            `${approveResult.skipped.length} skipped — ${approveResult.skipped[0]?.reason ?? "see logs"}`,
          );
        }

        if (sendIds.length > 0) {
          const cycleKind = scope === "week" ? "standard" : "auto";
          const sendResult = await bulkSendSelfBillEmails(sendIds, {
            cycleKind,
            bundleByPartner: scope !== "row",
          });
          if (sendResult.sent > 0) {
            toast.success(formatSelfBillSendToast(sendResult.sent, sendResult.emailsSent));
          }
          if (sendResult.skipped.length > 0) {
            toast.error(
              `${sendResult.skipped.length} skipped — ${sendResult.skipped[0]?.reason ?? "see logs"}`,
            );
          }
        }

        setSelectedSbIds(new Set());
        await loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Approve & send failed");
      } finally {
        setApprovingSelfBillIds((prev) => {
          const next = new Set(prev);
          approveIds.forEach((id) => next.delete(id));
          return next;
        });
        setSendingSelfBillIds((prev) => {
          const next = new Set(prev);
          sendIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [billingSelfBills, loadData],
  );
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerSb, setDrawerSb] = useState<SelfBill | null>(null);
  const [drawerSbJobs, setDrawerSbJobs] = useState<Awaited<ReturnType<typeof listJobsForSelfBill>>>([]);
  const [loadingDrawerJobs, setLoadingDrawerJobs] = useState(false);
  const [showInactiveInvoices, setShowInactiveInvoices] = useState(false);
  const [showInactiveSelfBills, setShowInactiveSelfBills] = useState(false);
  /** Paid self-bills live in a bottom fold (like Closed), not as a top tab. */
  const [showPaidSelfBills, setShowPaidSelfBills] = useState(false);
  const [expandedGoingOutPartners, setExpandedGoingOutPartners] = useState<Set<string>>(new Set());
  const [expandedLedgerSelfBillPartners, setExpandedLedgerSelfBillPartners] = useState<Set<string>>(new Set());
  const [expandedLedgerInvoiceAccounts, setExpandedLedgerInvoiceAccounts] = useState<Set<string>>(new Set());
  const [cashflowWeekOffset, setCashflowWeekOffset] = useState(0);
  const [runwayView, setRunwayView] = useState<RunwayViewMode>("accrual");
  const [cashflowDetailWeekStart, setCashflowDetailWeekStart] = useState<string | null>(null);
  const [savingRunwayOpening, setSavingRunwayOpening] = useState(false);

  const todayYmd = invoiceFinanceListTodayYmd();
  const periodBounds = useMemo(() => resolveBillingStandaloneFilterBounds(periodFilter), [periodFilter]);
  const selfBillPeriodBounds = periodBounds;
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
    [
      data.invoices,
      data.selfBills,
      data.jobsByRef,
      data.customerPaidByJobId,
      data.jobsBySelfBillId,
      data.partnerPaidByJobId,
      data.dueCtx,
      kpiMonthBounds,
    ],
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
    let voided = 0;
    for (const sb of inactivePeriodSelfBills) {
      if (sb.status === "paid" || sb.wise_paid_at) continue;
      if (sb.status === "rejected" || sb.status === "payout_cancelled") cancelled += 1;
      else if (isSelfBillPayoutVoided(sb)) voided += 1;
    }
    return { cancelled, voided };
  }, [inactivePeriodSelfBills]);

  const periodWorkWeekLabel = useMemo(
    () => (selfBillPeriodBounds ? formatPeriodBoundsLabel(selfBillPeriodBounds) : "All periods"),
    [selfBillPeriodBounds],
  );

  const inactivePeriodInvoices = useMemo(
    () => periodInvoices.filter((inv) => inv.status === "cancelled" || inv.status === "paid"),
    [periodInvoices],
  );

  const inactiveInvoiceLedgerGroups = useMemo(
    () =>
      buildInvoiceLedgerAccountGroups(
        inactivePeriodInvoices,
        data.accountNameById,
        data.jobRefToAccountId,
        data.clientNameToAccountId,
      ),
    [inactivePeriodInvoices, data.accountNameById, data.jobRefToAccountId, data.clientNameToAccountId],
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

  const draftPeriodInvoices = useMemo(
    () => periodInvoices.filter((inv) => inv.status === "draft"),
    [periodInvoices],
  );

  const draftInvoiceLedgerGroups = useMemo(
    () =>
      buildInvoiceLedgerAccountGroups(
        draftPeriodInvoices,
        data.accountNameById,
        data.jobRefToAccountId,
        data.clientNameToAccountId,
      ),
    [draftPeriodInvoices, data.accountNameById, data.jobRefToAccountId, data.clientNameToAccountId],
  );

  const draftInvoiceTotal = useMemo(
    () => draftPeriodInvoices.reduce((sum, inv) => sum + Number(inv.amount ?? 0), 0),
    [draftPeriodInvoices],
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
        data.installmentsByInvoiceId,
      ),
    [
      data.invoices,
      data.jobsByRef,
      data.customerPaidByJobId,
      data.accountNameById,
      data.jobRefToAccountId,
      data.clientNameToAccountId,
      data.installmentsByInvoiceId,
      periodBounds,
    ],
  );

  const selectableReadyInvoiceIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of attentionAccountGroups) {
      for (const row of group.rows) {
        if (invoiceCanSelectForPayment(row.invoice, data.jobsByRef)) ids.push(row.invoice.id);
      }
    }
    return ids;
  }, [attentionAccountGroups, data.jobsByRef]);

  const selectableDraftInvoiceIds = useMemo(
    () => draftPeriodInvoices.filter((inv) => invoiceCanSelectForPayment(inv, data.jobsByRef)).map((inv) => inv.id),
    [draftPeriodInvoices, data.jobsByRef],
  );

  const toggleInvoiceSelection = useCallback((ids: string[], selected: boolean) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAllInvoices = useCallback((allIds: string[]) => {
    setSelectedInvoiceIds((prev) => {
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }, []);

  const handleMarkInvoiceReceived = useCallback(
    (id: string) => void handleMarkInvoicePaid(id, { received: true }),
    [handleMarkInvoicePaid],
  );

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

  const toggleLedgerInvoiceAccount = useCallback((accountKey: string) => {
    setExpandedLedgerInvoiceAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountKey)) next.delete(accountKey);
      else next.add(accountKey);
      return next;
    });
  }, []);

  useEffect(() => {
    setCashflowWeekOffset(0);
  }, [periodFilter]);

  useEffect(() => {
    void ensureSelfBillJobsEnriched();
  }, [moneyOutTab, ensureSelfBillJobsEnriched]);

  const cashflowWeekStart = useMemo(() => {
    const monday = startOfWeekMondayFromYmd(todayYmd);
    return addDaysYmd(monday, cashflowWeekOffset * 7);
  }, [todayYmd, cashflowWeekOffset]);

  const paymentOrgCtx = useMemo(() => orgCtxFromSetup(frontendSetup), [frontendSetup]);

  const runwayCashBalanceOptions = useMemo(
    () => ({
      defaultOpening: frontendSetup.finance_opening_cash_gbp ?? 0,
      weekOverrides: frontendSetup.cash_runway_week_balances ?? {},
    }),
    [frontendSetup.finance_opening_cash_gbp, frontendSetup.cash_runway_week_balances],
  );

  const cashflow = useMemo(
    () =>
      buildRunwayWeekly(runwayView, {
        invoices: data.invoices,
        selfBills: data.selfBills,
        bills: data.bills,
        installmentsByInvoiceId: data.installmentsByInvoiceId,
        installmentsBySelfBillId: data.installmentsBySelfBillId,
        jobsByRef: data.jobsByRef,
        customerPaidByJobId: data.customerPaidByJobId,
        jobsBySelfBillId: data.jobsBySelfBillId,
        partnerPaidByJobId: data.partnerPaidByJobId,
        dueCtx: data.dueCtx,
        customerPaymentRows: data.customerPaymentRows,
        payrollRunwayRows: data.payrollRunwayRows,
        pipelineJobs: data.pipelineJobs,
        clientIdToAccountId: data.clientIdToAccountId,
        accountTermsById: data.accountTermsById,
        paymentOrgCtx,
        cashBalanceOptions:
          runwayView === "cash" || runwayView === "accrual" ? runwayCashBalanceOptions : undefined,
        startYmd: periodBounds?.from ?? cashflowWeekStart,
        endYmd: periodBounds?.to,
        weekCount: periodBounds ? undefined : CASHFLOW_WINDOW_WEEKS,
      }),
    [
      runwayView,
      data.invoices,
      data.selfBills,
      data.bills,
      data.installmentsByInvoiceId,
      data.installmentsBySelfBillId,
      data.jobsByRef,
      data.customerPaidByJobId,
      data.customerPaymentRows,
      data.payrollRunwayRows,
      data.pipelineJobs,
      data.clientIdToAccountId,
      data.accountTermsById,
      data.jobsBySelfBillId,
      data.partnerPaidByJobId,
      data.dueCtx,
      paymentOrgCtx,
      runwayCashBalanceOptions,
      periodBounds,
      cashflowWeekStart,
    ],
  );

  const cashflowRangeLabel = useMemo(() => {
    if (!cashflow.length) return "";
    if (cashflow.length === 1) return cashflow[0]!.title;
    return `${cashflow[0]!.dayNum} – ${cashflow[cashflow.length - 1]!.dayNum}`;
  }, [cashflow]);

  const cashflowBuildArgs = useMemo(
    () => ({
      invoices: data.invoices,
      selfBills: data.selfBills,
      bills: data.bills,
      installmentsByInvoiceId: data.installmentsByInvoiceId,
      installmentsBySelfBillId: data.installmentsBySelfBillId,
      jobsByRef: data.jobsByRef,
      customerPaidByJobId: data.customerPaidByJobId,
      customerPaymentRows: data.customerPaymentRows,
      payrollRunwayRows: data.payrollRunwayRows,
      pipelineJobs: data.pipelineJobs,
      clientIdToAccountId: data.clientIdToAccountId,
      accountTermsById: data.accountTermsById,
      paymentOrgCtx,
      jobsBySelfBillId: data.jobsBySelfBillId,
      partnerPaidByJobId: data.partnerPaidByJobId,
      dueCtx: data.dueCtx,
    }),
    [
      data.invoices,
      data.selfBills,
      data.bills,
      data.installmentsByInvoiceId,
      data.installmentsBySelfBillId,
      data.jobsByRef,
      data.customerPaidByJobId,
      data.customerPaymentRows,
      data.payrollRunwayRows,
      data.pipelineJobs,
      data.clientIdToAccountId,
      data.accountTermsById,
      paymentOrgCtx,
      data.jobsBySelfBillId,
      data.partnerPaidByJobId,
      data.dueCtx,
    ],
  );

  const cashflowDetailWeek = useMemo(
    () => (cashflowDetailWeekStart ? cashflow.find((w) => w.weekStart === cashflowDetailWeekStart) : undefined),
    [cashflow, cashflowDetailWeekStart],
  );

  const cashflowDetailBreakdown = useMemo(() => {
    if (!cashflowDetailWeekStart) return null;
    return buildRunwayWeekBreakdown(runwayView, cashflowDetailWeekStart, cashflowBuildArgs);
  }, [cashflowDetailWeekStart, cashflowBuildArgs, runwayView]);

  const handleSaveRunwayOpeningBalance = useCallback(
    async (weekStart: string, amount: number) => {
      setSavingRunwayOpening(true);
      try {
        const row = await getCompanySettings();
        const nextBalances = { ...(frontendSetup.cash_runway_week_balances ?? {}), [weekStart]: amount };
        const nextSetup = mergeFrontendSetup(row?.frontend_setup, {
          cash_runway_week_balances: nextBalances,
        });
        await updateCompanySettings({ frontend_setup: nextSetup });
        void refetchFrontendSetup();
        window.dispatchEvent(new Event("master-os-company-settings"));
        toast.success("Opening cash saved for this week");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save opening cash");
      } finally {
        setSavingRunwayOpening(false);
      }
    },
    [frontendSetup.cash_runway_week_balances, refetchFrontendSetup],
  );

  const payableSelfBills = useMemo(
    () =>
      periodSelfBills.filter(
        (sb) => selfBillCountsAsReady(sb) && !isSelfBillPayoutVoided(sb),
      ),
    [periodSelfBills],
  );

  /** Ready-to-pay only (excludes draft/accumulating/paid) with balance due — matches To pay KPI. */
  const goingOutSelfBills = useMemo(
    () =>
      periodSelfBills.filter((sb) => {
        if (sb.status === "paid" || sb.wise_paid_at) return false;
        if (!selfBillCountsAsReady(sb) || isSelfBillPayoutVoided(sb)) return false;
        const amt = computeSelfBillAmountDue(
          sb,
          data.jobsBySelfBillId[sb.id],
          data.partnerPaidByJobId,
          data.installmentsBySelfBillId[sb.id],
        );
        return amt > 0.02;
      }),
    [periodSelfBills, data.jobsBySelfBillId, data.partnerPaidByJobId, data.installmentsBySelfBillId],
  );

  /** Draft / accumulating — not yet ready for payment. */
  const ledgerSbDraftSelfBills = useMemo(
    () =>
      activePeriodSelfBills.filter(
        (sb) => !selfBillCountsAsReady(sb) && !isSelfBillPayoutVoided(sb),
      ),
    [activePeriodSelfBills],
  );

  /** Paid self-bills for the Paid tab. */
  const paidPeriodSelfBills = useMemo(
    () =>
      periodSelfBills.filter(
        (sb) => !isSelfBillPayoutVoided(sb) && (sb.status === "paid" || !!sb.wise_paid_at),
      ),
    [periodSelfBills],
  );

  const paidPeriodTotal = useMemo(
    () => paidPeriodSelfBills.reduce((sum, sb) => sum + Number(sb.net_payout ?? 0), 0),
    [paidPeriodSelfBills],
  );

  // All Ready items are payable — no approve step.
  const goingOutApprovedSelfBills = goingOutSelfBills;

  const selfBillLedgerSectionMap = useMemo(
    () =>
      buildSelfBillLedgerSectionMap(
        {
          inactive: inactivePeriodSelfBills.filter((sb) => sb.status !== "paid" && !sb.wise_paid_at),
          draft: ledgerSbDraftSelfBills,
          approved: goingOutApprovedSelfBills,
          paid: paidPeriodSelfBills,
        },
        data.dueCtx,
        data.jobsBySelfBillId,
        data.partnerPaidByJobId,
        data.installmentsBySelfBillId,
      ),
    [
      inactivePeriodSelfBills,
      ledgerSbDraftSelfBills,
      goingOutApprovedSelfBills,
      paidPeriodSelfBills,
      data.dueCtx,
      data.jobsBySelfBillId,
      data.partnerPaidByJobId,
      data.installmentsBySelfBillId,
    ],
  );
  const inactiveSelfBillLedgerSections = selfBillLedgerSectionMap.inactive;
  const ledgerSbDraftSections = selfBillLedgerSectionMap.draft;
  const goingOutApprovedSections = selfBillLedgerSectionMap.approved;
  const paidSelfBillLedgerSections = selfBillLedgerSectionMap.paid;

  const sumDue = useCallback(
    (rows: SelfBill[]) =>
      rows.reduce(
        (sum, sb) =>
          sum +
          computeSelfBillAmountDue(
            sb,
            data.jobsBySelfBillId[sb.id],
            data.partnerPaidByJobId,
            data.installmentsBySelfBillId[sb.id],
          ),
        0,
      ),
    [data.jobsBySelfBillId, data.partnerPaidByJobId, data.installmentsBySelfBillId],
  );
  const ledgerSbDraftTotal = useMemo(
    () =>
      ledgerSbDraftSelfBills.reduce((sum, sb) => sum + Number(sb.net_payout ?? 0), 0),
    [ledgerSbDraftSelfBills],
  );
  const goingOutApprovedTotal = useMemo(() => sumDue(goingOutApprovedSelfBills), [sumDue, goingOutApprovedSelfBills]);
  const goingOutReadyTotal = goingOutApprovedTotal;

  const moneyOutBulkMode = useMemo((): "drafts" | "pending" | "approved" => {
    if (moneyOutTab === "draft") return "drafts";
    return "approved";
  }, [moneyOutTab]);

  useEffect(() => {
    setSelectedInvoiceIds(new Set());
    setSelectedSbIds(new Set());
    setMoneyOutSelectedIds(new Set());
    setShowInactiveInvoices(false);
    setShowInactiveSelfBills(false);
    setExpandedGoingOutPartners(new Set());
    setExpandedLedgerSelfBillPartners(new Set());
    setExpandedLedgerInvoiceAccounts(new Set());
  }, [periodFilter]);

  const moneyInReadyResetKey = useMemo(
    () => [periodFilter.mode, periodFilter.customFrom ?? "", periodFilter.customTo ?? ""].join("|"),
    [periodFilter],
  );

  const openInvoice = useCallback(
    (inv: Invoice) => {
      router.replace(`/finance/billing?invoiceId=${encodeURIComponent(inv.id)}`, { scroll: false });
    },
    [router],
  );

  const openSelfBill = useCallback(
    (sb: SelfBill) => {
      setMoneyOutTab("ready");
      router.replace(`/finance/billing?selfBillId=${encodeURIComponent(sb.id)}&out=ready`, { scroll: false });
    },
    [router],
  );

  const closeInvoiceDrawer = useCallback(() => {
    router.replace("/finance/billing", { scroll: false });
  }, [router]);

  const closeSelfBillDrawer = useCallback(() => {
    router.replace("/finance/billing?out=ready", { scroll: false });
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
      const wfBounds = selfBillPeriodBounds ?? periodBounds;
      const wfResult = await syncWorkforceSelfBillsForBilling(wfBounds);

      const repairRes = await fetch("/api/billing/repair-invoice-accounts", { method: "POST" });
      const repairBody = (await repairRes.json()) as {
        ok?: boolean;
        error?: string;
        linked?: number;
        unlinked?: number;
        updated?: number;
        skippedInvalid?: number;
        accounts?: Array<{ id: string; label: string; logoUrl: string | null; count: number }>;
      };
      if (!repairRes.ok) throw new Error(repairBody.error ?? "Account repair failed");

      if (repairBody.accounts?.length) {
        data.applyAccountLabels(repairBody.accounts);
      }

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

      const linked = repairBody.linked ?? 0;
      const unlinked = repairBody.unlinked ?? 0;
      const accountHint =
        repairBody.accounts
          ?.slice(0, 3)
          .map((a) => `${a.label} (${a.count})`)
          .join(", ") ?? "";
      if (linked === 0 && unlinked > 0) {
        toast.warning(
          `No invoices linked to accounts (${unlinked} unlinked). Check Zendesk jobs without quote sibling.`,
        );
      } else {
        const suffix = accountHint ? ` · ${accountHint}` : "";
        toast.success(
          `Workforce ${wfResult.count} self-bill(s) · linked ${linked} invoice(s) · ${unlinked} unlinked · synced ${n} job(s) + partner self-bills${suffix}`,
        );
      }
      await loadData({ bounds: null });
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
      void logAudit({ entityType: "invoice", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name }).catch(() => {});
      setCreateOpen(false);
      toast.success("Invoice created");
      await loadData();
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
      <div className="bl-standalone flex min-h-0 min-w-0 flex-col gap-4 sm:gap-6">
        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="inline-flex items-center gap-2 text-xl font-bold text-[#020040] sm:text-2xl">
              Billing
              <FixfyHintIcon
                text={`Everything you owe and everything you're owed — what's due, what's late, day by day. ${dateLabel}.`}
                placement="bottom-start"
              />
            </h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <BillingStandalonePeriodFilter value={periodFilter} onChange={setPeriodFilter} />
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={syncing}
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
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-5 sm:gap-6",
              data.loading || data.refreshing ? "opacity-70 transition-opacity" : undefined,
            )}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
              <KpiCard label="To collect · receivables" value={formatCurrency(kpiRow.toCollect)} sub={`${kpiRow.toCollectCount} open · ${kpiRow.overdueCount} overdue`} />
              <KpiCard label="Overdue" value={formatCurrency(kpiRow.overdue)} sub={`${kpiRow.overdueCount} invoices · oldest ${kpiRow.oldestOverdueDays}d`} alert />
              <KpiCard label="To pay · self-bills" value={formatCurrency(kpiRow.toPaySelfBills)} sub={`${kpiRow.toPayPartnerCount} partners · run ${kpiRow.nextRunLabel}`} coral />
              <KpiCard label={`Net · ${kpiMonthLabel}`} value={`${kpiRow.netWeek >= 0 ? "+" : ""}${formatCurrency(kpiRow.netWeek)}`} sub={`in ${formatCurrency(kpiRow.weekIn)} · out ${formatCurrency(kpiRow.weekOut)}`} green={kpiRow.netWeek >= 0} />
              <KpiCard label={`Collected · ${kpiMonthLabel}`} value={formatCurrency(kpiRow.collectedMtd)} sub={`${kpiRow.collectedMtdCount} invoices${kpiRow.onTimePct != null ? ` · ${kpiRow.onTimePct}% on time` : ""}`} />
            </div>

            <div className="rounded-xl border border-border-light bg-white p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {!periodBounds ? (
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-light text-text-secondary transition-colors hover:bg-surface-hover hover:text-[#020040]"
                      aria-label="Previous week"
                      onClick={() => setCashflowWeekOffset((o) => o - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  ) : null}
                  <div className="min-w-0">
                    <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#020040]">
                      Cash-Flow Runway
                      <FixfyHintIcon
                        text={cashflowRunwayHintForView(runwayView)}
                        placement="bottom-start"
                      />
                    </h2>
                    {cashflowRangeLabel ? (
                      <p className="mt-0.5 text-xs text-text-tertiary tabular-nums">{cashflowRangeLabel}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-text-tertiary">
                      {runwayView === "cash" || runwayView === "accrual"
                        ? "Click a week to see line items and edit Em caixa (opening balance)"
                        : "Click a week to see what is due in and out"}
                    </p>
                  </div>
                  {!periodBounds ? (
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-light text-text-secondary transition-colors hover:bg-surface-hover hover:text-[#020040]"
                      aria-label="Next week"
                      onClick={() => setCashflowWeekOffset((o) => o + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : null}
                  {!periodBounds && cashflowWeekOffset !== 0 ? (
                    <button
                      type="button"
                      className="shrink-0 text-[11px] font-semibold text-[#ED4B00] hover:underline"
                      onClick={() => setCashflowWeekOffset(0)}
                    >
                      Today
                    </button>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex flex-wrap gap-1 rounded-lg border border-border-light bg-surface-hover/40 p-1">
                    <RunwayTabBtn active={runwayView === "accrual"} onClick={() => setRunwayView("accrual")} label="Accrual" />
                    <RunwayTabBtn active={runwayView === "cash"} onClick={() => setRunwayView("cash")} label="Cash" />
                    <RunwayTabBtn active={runwayView === "pl"} onClick={() => setRunwayView("pl")} label="P&L" />
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-3 text-xs text-text-secondary sm:gap-4">
                    {runwayView === "cash" ? (
                      <>
                        <span className="flex items-center gap-1.5 font-semibold text-[#020040]">
                          <span className="h-2 w-2 rounded-sm bg-[#020040]" /> Em caixa
                        </span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600" /> Payments in</span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#ED4B00]" /> Paid / projected out</span>
                      </>
                    ) : runwayView === "accrual" ? (
                      <>
                        <span className="flex items-center gap-1.5 font-semibold text-[#020040]">
                          <span className="h-2 w-2 rounded-sm bg-[#020040]" /> Em caixa
                        </span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600" /> Pipeline revenue</span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#ED4B00]" /> All costs due</span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5 font-semibold text-[#020040]">
                          <span className="h-2 w-2 rounded-sm bg-[#020040]" /> Weekly P&amp;L
                        </span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600" /> Receivables due</span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#ED4B00]" /> Approved pay + expenses due</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="cf flex gap-0.5 overflow-x-auto pb-2">
                {cashflow.map((w, idx) => {
                  const ih = w.moneyIn ? Math.max(6, Math.round((w.moneyIn / cfMax) * 44)) : 0;
                  const oh = w.moneyOut ? Math.max(6, Math.round((w.moneyOut / cfMax) * 44)) : 0;
                  const isSelected = cashflowDetailWeekStart === w.weekStart;
                  const weekNet = cashflowWeekNet(w.moneyIn, w.moneyOut);
                  const weekHasActivity = cashflowWeekHasActivity(w.moneyIn, w.moneyOut);
                  const showRunwayBalance = runwayView === "cash" || runwayView === "accrual";
                  const prevClosing = idx > 0 ? cashflow[idx - 1]?.closingBalance : undefined;
                  const topLabel =
                    showRunwayBalance && w.closingBalance !== undefined
                      ? formatCashRunwayClosing(w.closingBalance)
                      : formatCashflowWeekPnl(w.moneyIn, w.moneyOut);
                  const topPositive =
                    showRunwayBalance && w.closingBalance !== undefined
                      ? w.closingBalance >= 0
                      : weekNet >= 0;
                  const topHasValue =
                    showRunwayBalance ? w.closingBalance !== undefined : weekHasActivity;
                  const balanceTrend =
                    showRunwayBalance && w.closingBalance !== undefined && prevClosing !== undefined
                      ? w.closingBalance > prevClosing
                        ? "up"
                        : w.closingBalance < prevClosing
                          ? "down"
                          : "flat"
                      : null;
                  const pnlLabel = topLabel;
                  return (
                    <button
                      key={w.weekStart}
                      type="button"
                      title={cashflowWeekColumnTitle(runwayView, w.title, w.moneyIn, w.moneyOut, w.closingBalance)}
                      aria-label={`${w.title}. ${showRunwayBalance ? `Em caixa ${pnlLabel}` : `Weekly P and L ${pnlLabel}`}. In ${formatCurrency(w.moneyIn)}. Out ${formatCurrency(w.moneyOut)}. View breakdown.`}
                      onClick={() => setCashflowDetailWeekStart(w.weekStart)}
                      className={cn(
                        "cf__day cf__week min-w-[52px] flex-1 sm:min-w-[64px] cursor-pointer transition-colors hover:bg-surface-hover/80",
                        w.isCurrentWeek && "is-today",
                        isSelected && "is-selected",
                      )}
                    >
                      <div
                        className={cn(
                          "cf__pnl",
                          !topHasValue && "cf__pnl--zero",
                          topHasValue && topPositive && "cf__pnl--pos",
                          topHasValue && !topPositive && "cf__pnl--neg",
                        )}
                      >
                        {pnlLabel}
                      </div>
                      <div className={cn("cf__amt cf__amt--in", !w.moneyIn && "is-empty")}>{w.moneyIn ? formatCurrency(w.moneyIn) : "·"}</div>
                      <div className="cf__well"><div className="cf__bar cf__bar--in" style={{ height: ih }} /></div>
                      <div className="cf__axis" />
                      <div className="cf__well cf__well--out"><div className="cf__bar cf__bar--out" style={{ height: oh }} /></div>
                      <div className={cn("cf__amt cf__amt--out", !w.moneyOut && "is-empty")}>{w.moneyOut ? formatCurrency(w.moneyOut) : "·"}</div>
                      {showRunwayBalance && balanceTrend ? (
                        <div
                          className={cn(
                            "cf__balance-trend",
                            balanceTrend === "up" && "cf__balance-trend--up",
                            balanceTrend === "down" && "cf__balance-trend--down",
                          )}
                          aria-hidden
                        >
                          {balanceTrend === "up" ? "↑" : balanceTrend === "down" ? "↓" : "→"}
                        </div>
                      ) : null}
                      <div className="cf__lbl">{w.label}<b>{w.dayNum}</b></div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid min-h-[calc(100dvh-22rem)] grid-cols-1 items-stretch gap-4 sm:gap-5 lg:min-h-[calc(100dvh-20rem)] lg:grid-cols-2 lg:gap-6">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-light bg-white shadow-sm">
                <div className="shrink-0 border-b border-border-light px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#020040]">
                      Money In
                      <FixfyHintIcon
                        text={`Draft invoices and collectible receivables · ${periodBounds ? periodLabel : "All periods"}.`}
                        placement="bottom-start"
                      />
                    </h2>
                    <div className="flex gap-1">
                      <TabPill
                        active={moneyInTab === "draft"}
                        onClick={() => {
                          setMoneyInTab("draft");
                          setSelectedInvoiceIds(new Set());
                        }}
                        label="Draft"
                        count={draftPeriodInvoices.length}
                        total={draftInvoiceTotal}
                      />
                      <TabPill
                        active={moneyInTab === "ready"}
                        onClick={() => {
                          setMoneyInTab("ready");
                          setSelectedInvoiceIds(new Set());
                        }}
                        label="Ready to receive"
                        count={kpiRow.toCollectCount}
                        total={kpiRow.toCollect}
                      />
                    </div>
                  </div>
                </div>
                {moneyInTab === "ready" ? (
                  <>
                <div className="shrink-0 border-b border-border-light px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
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
                  {selectableReadyInvoiceIds.length > 0 ? (
                    <div className="mt-3 flex items-center justify-end">
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => toggleSelectAllInvoices(selectableReadyInvoiceIds)}
                      >
                        {selectableReadyInvoiceIds.every((id) => selectedInvoiceIds.has(id))
                          ? "Clear selection"
                          : `Select all (${selectableReadyInvoiceIds.length})`}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 divide-y divide-border-light overflow-y-auto">
                  <MoneyInReadyList
                    groups={attentionAccountGroups}
                    accountLogoById={data.accountLogoById}
                    jobsByRef={data.jobsByRef}
                    selectedInvoiceIds={selectedInvoiceIds}
                    resetKey={moneyInReadyResetKey}
                    onToggleInvoiceSelection={toggleInvoiceSelection}
                    onOpenInvoice={openInvoice}
                    onMarkReceived={handleMarkInvoiceReceived}
                  />
                </div>
                {inactivePeriodInvoices.length > 0 ? (
                  <div className="shrink-0 border-t border-border-light bg-surface-hover/20">
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
                      <InvoiceGroupedLedger
                        groups={inactiveInvoiceLedgerGroups}
                        todayYmd={todayYmd}
                        selectedIds={selectedInvoiceIds}
                        onSelectionChange={setSelectedInvoiceIds}
                        jobsByRef={data.jobsByRef}
                        customerPaidByJobId={data.customerPaidByJobId}
                        installmentsByInvoiceId={data.installmentsByInvoiceId}
                        accountLogoById={data.accountLogoById}
                        onOpen={openInvoice}
                        onMarkPaid={(id) => void handleMarkInvoicePaid(id)}
                        compact
                        collapsibleAccounts={{
                          expandedKeys: expandedLedgerInvoiceAccounts,
                          onToggle: toggleLedgerInvoiceAccount,
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
                  </>
                ) : (
                  <>
                    <div className="shrink-0 border-b border-border-light px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-lg font-bold tabular-nums text-[#020040]">{formatCurrency(draftInvoiceTotal)}</p>
                        {selectableDraftInvoiceIds.length > 0 ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-primary hover:underline"
                            onClick={() => toggleSelectAllInvoices(selectableDraftInvoiceIds)}
                          >
                            {selectableDraftInvoiceIds.every((id) => selectedInvoiceIds.has(id))
                              ? "Clear selection"
                              : `Select all (${selectableDraftInvoiceIds.length})`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <InvoiceGroupedLedger
                        groups={draftInvoiceLedgerGroups}
                        todayYmd={todayYmd}
                        selectedIds={selectedInvoiceIds}
                        onSelectionChange={setSelectedInvoiceIds}
                        jobsByRef={data.jobsByRef}
                        customerPaidByJobId={data.customerPaidByJobId}
                        installmentsByInvoiceId={data.installmentsByInvoiceId}
                        accountLogoById={data.accountLogoById}
                        onOpen={openInvoice}
                        onMarkPaid={(id) => void handleMarkInvoicePaid(id)}
                        emptyLabel="No draft invoices in this period."
                        collapsibleAccounts={{
                          expandedKeys: expandedLedgerInvoiceAccounts,
                          onToggle: toggleLedgerInvoiceAccount,
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-light bg-white shadow-sm">
                <div className="shrink-0 border-b border-border-light px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#020040]">
                      Money Out
                      <FixfyHintIcon
                        text={`Self-bills by pay week · ${periodWorkWeekLabel}. Mark draft → Ready → Mark as paid.`}
                        placement="bottom-start"
                      />
                    </h2>
                    <div className="flex gap-1">
                      <TabPill
                        active={moneyOutTab === "draft"}
                        onClick={() => {
                          setMoneyOutTab("draft");
                          setSelectedSbIds(new Set());
                          setMoneyOutSelectedIds(new Set());
                        }}
                        label="Draft"
                        count={ledgerSbDraftSelfBills.length}
                        total={ledgerSbDraftTotal}
                      />
                      <TabPill
                        active={moneyOutTab === "ready"}
                        onClick={() => {
                          setMoneyOutTab("ready");
                          setSelectedSbIds(new Set());
                          setMoneyOutSelectedIds(new Set());
                        }}
                        label="Ready"
                        count={goingOutApprovedSelfBills.length}
                        total={goingOutReadyTotal}
                      />
                    </div>
                  </div>
                </div>

                {moneyOutTab === "draft" ? (
                  <>
                    <div className="shrink-0 border-b border-border-light px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-lg font-bold tabular-nums text-[#020040]">{formatCurrency(ledgerSbDraftTotal)}</p>
                        {(() => {
                          const allTabIds = ledgerSbDraftSelfBills.map((sb) => sb.id);
                          const selectedInTab = allTabIds.filter((id) => selectedSbIds.has(id));
                          const hasSelection = selectedInTab.length > 0;
                          const readyTargetIds = hasSelection ? selectedInTab : allTabIds;
                          if (readyTargetIds.length === 0) return null;
                          return (
                            <Button
                              size="sm"
                              variant="primary"
                              loading={readyTargetIds.some((id) => readyingSelfBillIds.has(id))}
                              onClick={() => void handleMarkSelfBillsReadyToPay(readyTargetIds)}
                            >
                              {hasSelection
                                ? `Ready to pay (${readyTargetIds.length})`
                                : `Ready to pay all (${readyTargetIds.length})`}
                            </Button>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <SelfBillGroupedLedger
                        mode="draftQueue"
                        workforceGroups={ledgerSbDraftSections.workforce}
                        partnerGroups={ledgerSbDraftSections.partners}
                        todayYmd={todayYmd}
                        selectedIds={selectedSbIds}
                        onSelectionChange={setSelectedSbIds}
                        partnerDueCtx={data.partnerDueCtx}
                        partnerAvatarById={data.partnerAvatarById}
                        jobsBySelfBillId={data.jobsBySelfBillId}
                        partnerPaidByJobId={data.partnerPaidByJobId}
                        installmentsBySelfBillId={data.installmentsBySelfBillId}
                        onOpen={(sb) => void openSelfBill(sb)}
                        onMarkPaid={async () => {}}
                        emptyLabel="No draft self-bills in this period."
                        collapsiblePartners={{
                          expandedKeys: expandedLedgerSelfBillPartners,
                          onToggle: toggleLedgerSelfBillPartner,
                        }}
                        onMarkReadyToPay={handleMarkSelfBillsReadyToPay}
                        readyingIds={readyingSelfBillIds}
                      />
                    </div>
                    {inactiveSelfBillCounts.cancelled + inactiveSelfBillCounts.voided > 0 ? (
                      <div className="shrink-0 border-t border-border-light bg-surface-hover/20">
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
                            workforceGroups={inactiveSelfBillLedgerSections.workforce}
                            partnerGroups={inactiveSelfBillLedgerSections.partners}
                            todayYmd={todayYmd}
                            selectedIds={selectedSbIds}
                            onSelectionChange={setSelectedSbIds}
                            partnerDueCtx={data.partnerDueCtx}
                            partnerAvatarById={data.partnerAvatarById}
                            jobsBySelfBillId={data.jobsBySelfBillId}
                            partnerPaidByJobId={data.partnerPaidByJobId}
                            installmentsBySelfBillId={data.installmentsBySelfBillId}
                            onOpen={(sb) => void openSelfBill(sb)}
                            onMarkPaid={async (id) => {
                              await markSelfBillsPaid([id]);
                              toast.success("Marked paid");
                              await loadData();
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
                ) : (
                  (() => {
                    const eligiblePayIds = goingOutApprovedSelfBills
                      .filter(
                        (sb) =>
                          sb.status !== "paid" &&
                          !sb.wise_paid_at &&
                          !isSelfBillPayoutVoided(sb) &&
                          selfBillIsInstallmentDueForWisePay(
                            sb,
                            data.installmentsBySelfBillId[sb.id],
                            todayYmd,
                          ),
                      )
                      .map((sb) => sb.id);
                    const selectableIds = goingOutApprovedSelfBills
                      .filter((sb) => sb.status !== "paid" && !sb.wise_paid_at && !isSelfBillPayoutVoided(sb))
                      .map((sb) => sb.id);
                    const selectedPayInTab = selectableIds.filter((id) => moneyOutSelectedIds.has(id));
                    const hasPaySelection = selectedPayInTab.length > 0;
                    const payTargetIds = hasPaySelection ? selectedPayInTab : eligiblePayIds;
                    const markTargetIds = hasPaySelection ? selectedPayInTab : selectableIds;
                    const allPaySelected =
                      hasPaySelection &&
                      selectableIds.length > 0 &&
                      selectedPayInTab.length === selectableIds.length;

                    return (
                      <>
                        <div className="shrink-0 border-b border-border-light px-4 py-3 sm:px-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                              {goingOutApprovedSelfBills.length} ready · {kpiRow.nextRunLabel}
                            </p>
                            {selectableIds.length > 0 ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-primary hover:underline"
                                onClick={() => {
                                  setMoneyOutSelectedIds(
                                    allPaySelected ? new Set() : new Set(selectableIds),
                                  );
                                }}
                              >
                                {allPaySelected
                                  ? "Clear selection"
                                  : `Select all (${selectableIds.length})`}
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xl font-bold tabular-nums text-[#020040]">
                              {formatCurrency(goingOutApprovedTotal)}
                            </p>
                            <MoneyOutPayActions
                              loading={
                                bulkSaving ||
                                payTargetIds.some((id) => schedulingPaymentIds.has(id))
                              }
                              disabled={markTargetIds.length === 0 && payTargetIds.length === 0}
                              onSchedulePayment={() => void handleBulkSchedulePayment(payTargetIds)}
                              onMarkAsPaid={() => void handleBulkMarkSelfBillsPaid(markTargetIds)}
                            />
                          </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                          <SelfBillGroupedLedger
                            mode="payQueue"
                            variant="compact"
                            workforceGroups={goingOutApprovedSections.workforce}
                            partnerGroups={goingOutApprovedSections.partners}
                            todayYmd={todayYmd}
                            selectedIds={moneyOutSelectedIds}
                            onSelectionChange={setMoneyOutSelectedIds}
                            partnerDueCtx={data.partnerDueCtx}
                            partnerAvatarById={data.partnerAvatarById}
                            jobsBySelfBillId={data.jobsBySelfBillId}
                            partnerPaidByJobId={data.partnerPaidByJobId}
                            installmentsBySelfBillId={data.installmentsBySelfBillId}
                            onOpen={(sb) => void openSelfBill(sb)}
                            onMarkPaid={async (id) => {
                              await handleBulkMarkSelfBillsPaid([id]);
                            }}
                            collapsiblePartners={{
                              expandedKeys: expandedGoingOutPartners,
                              onToggle: toggleGoingOutPartner,
                            }}
                            emptyLabel="Nothing ready to pay in this period."
                          />
                        </div>
                      </>
                    );
                  })()
                )}
                {paidPeriodSelfBills.length > 0 ? (
                  <div className="shrink-0 border-t border-border-light bg-surface-hover/20">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover/40"
                      onClick={() => setShowPaidSelfBills((v) => !v)}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-text-secondary">Paid</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                          {paidPeriodSelfBills.length} · {formatCurrency(paidPeriodTotal)}
                        </span>
                      </div>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", showPaidSelfBills && "rotate-180")} />
                    </button>
                    {showPaidSelfBills ? (
                      <div className="max-h-[40vh] overflow-y-auto">
                        <SelfBillGroupedLedger
                          mode="payQueue"
                          variant="compact"
                          workforceGroups={paidSelfBillLedgerSections.workforce}
                          partnerGroups={paidSelfBillLedgerSections.partners}
                          todayYmd={todayYmd}
                          selectedIds={new Set()}
                          onSelectionChange={() => {}}
                          partnerDueCtx={data.partnerDueCtx}
                          partnerAvatarById={data.partnerAvatarById}
                          jobsBySelfBillId={data.jobsBySelfBillId}
                          partnerPaidByJobId={data.partnerPaidByJobId}
                          installmentsBySelfBillId={data.installmentsBySelfBillId}
                          onOpen={(sb) => void openSelfBill(sb)}
                          onMarkPaid={async () => {}}
                          collapsiblePartners={{
                            expandedKeys: expandedGoingOutPartners,
                            onToggle: toggleGoingOutPartner,
                          }}
                          emptyLabel="No paid self-bills in this period."
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          onClose={closeInvoiceDrawer}
          onStatusChange={async (inv, status) => {
            const updated = await updateInvoiceStatusOne(inv, status);
            setSelectedInvoice(updated);
            await loadData();
          }}
          onInvoiceUpdated={(inv) => {
            setSelectedInvoice(inv);
            void loadData();
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
            await loadData();
          }}
          onMarkPaid={async () => {
            if (!drawerSb) return;
            await markSelfBillsPaid([drawerSb.id]);
            toast.success("Marked paid");
            await loadData();
          }}
          onReopen={async () => {
            if (!drawerSb) return;
            const supabase = getSupabase();
            await supabase.from("self_bills").update({ status: "ready_to_pay" }).eq("id", drawerSb.id);
            toast.success("Reopened");
            await loadData();
          }}
          onRefresh={async () => {
            closeSelfBillDrawer();
            await loadData();
          }}
          onEditTotals={() => toast.message("Edit totals in self-bill drawer tabs")}
          onPartnerPaymentsRecorded={() => loadData()}
        />

        <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />

        <CashflowWeekDetailModal
          open={cashflowDetailWeekStart !== null}
          onClose={() => setCashflowDetailWeekStart(null)}
          view={runwayView}
          breakdown={cashflowDetailBreakdown}
          openingBalance={cashflowDetailWeek?.openingBalance}
          closingBalance={cashflowDetailWeek?.closingBalance}
          onSaveOpeningBalance={
            runwayView === "cash" || runwayView === "accrual" ? handleSaveRunwayOpeningBalance : undefined
          }
          savingOpeningBalance={savingRunwayOpening}
        />

        {selectedInvoiceIds.size > 0 ? (
          <BillingBulkBar
            count={selectedInvoiceIds.size}
            /* Saldo em aberto, não o valor cheio da fatura: é o que entra se a
               pessoa apertar, e fatura parcialmente paga tem os dois números. */
            totalAmount={[...selectedInvoiceIds].reduce((acc, id) => {
              const inv = data.invoices.find((x: Invoice) => x.id === id);
              if (!inv) return acc;
              const saldo = Number(inv.amount ?? 0) - Number(inv.amount_paid ?? 0);
              return acc + Math.max(0, saldo);
            }, 0)}
            saving={bulkSaving}
            variant="invoice"
            markPaidLabel={moneyInTab === "ready" ? "Mark as received" : "Mark as paid"}
            onClear={() => setSelectedInvoiceIds(new Set())}
            onMarkPaid={async () => {
              setBulkSaving(true);
              try {
                await handleMarkInvoicesPaid([...selectedInvoiceIds], {
                  clearSelection: true,
                  received: moneyInTab === "ready",
                });
              } finally {
                setBulkSaving(false);
              }
            }}
          />
        ) : moneyOutSelectedIds.size > 0 ? (
          <BillingBulkBar
            count={moneyOutSelectedIds.size}
            totalAmount={[...moneyOutSelectedIds].reduce(
              (acc, id) => acc + Number(data.selfBills.find((sb: SelfBill) => sb.id === id)?.net_payout ?? 0),
              0,
            )}
            saving={bulkSaving}
            variant="selfbill"
            selfbillMode="approved"
            markPaidLabel="Mark as paid"
            /* "Resend" em vez de "Send" quando TODOS os selecionados já foram
               ao parceiro. Só quando todos: numa seleção mista, o rótulo tem
               que ser o da ação que ainda falta fazer. */
            emailAlreadySent={
              moneyOutSelectedIds.size > 0 &&
              [...moneyOutSelectedIds].every((id) =>
                Boolean(data.selfBills.find((sb: SelfBill) => sb.id === id)?.email_sent_at),
              )
            }
            onClear={() => setMoneyOutSelectedIds(new Set())}
            onMarkPaid={async () => {
              await handleBulkMarkSelfBillsPaid([...moneyOutSelectedIds]);
            }}
            onEmail={async () => {
              await handleSendSelfBills([...moneyOutSelectedIds], "row");
            }}
            onBackToDraft={async () => {
              await handleMoveSelfBillsBackToDraft([...moneyOutSelectedIds]);
            }}
            onCancel={async () => {
              const eligible = getBulkCancellableSelfBillIds(moneyOutSelectedIds, data.selfBills, sbCancellableIdSet);
              if (!eligible.length) {
                toast.error("No cancellable self-bills selected");
                return;
              }
              if (!window.confirm(`Cancel ${eligible.length} self-bill(s)?`)) return;
              setBulkSaving(true);
              try {
                await bulkCancelSelfBills(eligible);
                toast.success("Cancelled");
                setMoneyOutSelectedIds(new Set());
                await loadData();
              } catch {
                toast.error("Failed");
              } finally {
                setBulkSaving(false);
              }
            }}
          />
        ) : selectedSbIds.size > 0 ? (
          <BillingBulkBar
            count={selectedSbIds.size}
            totalAmount={[...selectedSbIds].reduce(
              (acc, id) => acc + Number(data.selfBills.find((sb: SelfBill) => sb.id === id)?.net_payout ?? 0),
              0,
            )}
            saving={bulkSaving}
            emailSending={emailSending}
            variant="selfbill"
            selfbillMode={moneyOutBulkMode}
            markPaidLabel="Mark as paid"
            emailAlreadySent={
              selectedSbIds.size > 0 &&
              [...selectedSbIds].every((id) =>
                Boolean(data.selfBills.find((sb: SelfBill) => sb.id === id)?.email_sent_at),
              )
            }
            onEmail={
              moneyOutBulkMode === "approved"
                ? async () => {
                    await handleSendSelfBills([...selectedSbIds], "row");
                  }
                : undefined
            }
            onClear={() => setSelectedSbIds(new Set())}
            onMarkPaid={
              moneyOutBulkMode === "approved"
                ? async () => {
                    await handleBulkMarkSelfBillsPaid([...selectedSbIds]);
                    setSelectedSbIds(new Set());
                  }
                : undefined
            }
            onMarkReadyToPay={
              moneyOutBulkMode === "drafts"
                ? async () => {
                    const ids = [...selectedSbIds].filter((id) =>
                      ledgerSbDraftSelfBills.some((sb) => sb.id === id),
                    );
                    if (!ids.length) return;
                    await handleMarkSelfBillsReadyToPay(ids);
                  }
                : undefined
            }
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
                await loadData();
              } catch {
                toast.error("Failed");
              } finally {
                setBulkSaving(false);
              }
            }}
          />
        ) : null}
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
  sb: Pick<SelfBill, "week_label" | "week_start" | "week_end" | "due_date" | "partner_id" | "bill_origin">,
  dueCtx: SelfBillDueResolveContext,
): { key: string; title: string; subtitle: string | null } {
  const due = selfBillDueYmd(sb, dueCtx);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    if (sb.bill_origin === "internal") {
      const periodSubtitle =
        sb.week_start && sb.week_end
          ? `Period · ${formatDate(sb.week_start)} – ${formatDate(sb.week_end)}`
          : null;
      return {
        key: due,
        title: `Pay · ${formatDate(due)}`,
        subtitle: periodSubtitle,
      };
    }
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

type SelfBillLedgerSections = {
  workforce: SelfBillWeekPartnerGroup[];
  partners: SelfBillWeekPartnerGroup[];
};

function buildSelfBillLedgerSectionMap<K extends string>(
  buckets: Record<K, SelfBill[]>,
  dueCtx: SelfBillDueResolveContext,
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>,
  partnerPaidByJobId: Record<string, number>,
  installmentsBySelfBillId: Record<string, SelfBillPaymentInstallment[]>,
): Record<K, SelfBillLedgerSections> {
  const out = {} as Record<K, SelfBillLedgerSections>;
  for (const key of Object.keys(buckets) as K[]) {
    out[key] = buildSelfBillLedgerSections(
      buckets[key]!,
      dueCtx,
      jobsBySelfBillId,
      partnerPaidByJobId,
      installmentsBySelfBillId,
    );
  }
  return out;
}

function buildSelfBillLedgerSections(
  selfBills: SelfBill[],
  dueCtx: SelfBillDueResolveContext,
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>,
  partnerPaidByJobId: Record<string, number>,
  installmentsBySelfBillId: Record<string, SelfBillPaymentInstallment[]>,
): SelfBillLedgerSections {
  const workforceBills = selfBills.filter((sb) => sb.bill_origin === "internal");
  const partnerBills = selfBills.filter((sb) => sb.bill_origin !== "internal");
  return {
    workforce: buildSelfBillWeekPartnerGroups(
      workforceBills,
      dueCtx,
      jobsBySelfBillId,
      partnerPaidByJobId,
      installmentsBySelfBillId,
    ).map((week) => ({
      ...week,
      weekTitle: week.weekTitle.startsWith("Workforce") ? week.weekTitle : `Workforce · ${week.weekTitle}`,
    })),
    partners: buildSelfBillWeekPartnerGroups(
      partnerBills,
      dueCtx,
      jobsBySelfBillId,
      partnerPaidByJobId,
      installmentsBySelfBillId,
    ),
  };
}

function buildSelfBillWeekPartnerGroups(
  selfBills: SelfBill[],
  dueCtx: SelfBillDueResolveContext,
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>,
  partnerPaidByJobId: Record<string, number>,
  installmentsBySelfBillId: Record<string, SelfBillPaymentInstallment[]>,
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
    const amt = computeSelfBillAmountDue(
      sb,
      jobsBySelfBillId[sb.id],
      partnerPaidByJobId,
      installmentsBySelfBillId[sb.id],
    );
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

function jobCustomerPaidForInvoice(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
): number | undefined {
  const ref = inv.job_reference?.trim();
  if (!ref) return undefined;
  const jobId = jobsByRef[ref]?.id;
  if (!jobId) return undefined;
  const paid = customerPaidByJobId[jobId];
  return paid !== undefined && Number.isFinite(paid) ? paid : undefined;
}

function invoiceLedgerAmounts(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
) {
  const total = Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100;
  const ledgerPaid = jobCustomerPaidForInvoice(inv, jobsByRef, customerPaidByJobId);
  const paid = invoiceEffectivePaidWithJobCustomerPaid(inv, ledgerPaid);
  const outstanding = invoiceBalanceDueWithJobCustomerPaid(inv, ledgerPaid);
  return { total, paid, outstanding };
}

function selfBillLedgerAmounts(
  sb: SelfBill,
  jobs: SelfBillJobLine[] | undefined,
  partnerPaidByJobId: Record<string, number>,
  installments?: SelfBillPaymentInstallment[] | null,
) {
  const total = Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
  const outstanding = computeSelfBillAmountDue(sb, jobs, partnerPaidByJobId, installments);
  let paid = 0;
  if (!isSelfBillPayoutVoided(sb)) {
    if (sb.bill_origin === "internal") {
      if (sb.status === "paid" || sb.wise_paid_at) paid = total;
    } else {
      const list = jobs ?? [];
      if (list.length === 0) {
        paid = Math.max(0, Math.round((total - outstanding) * 100) / 100);
      } else {
        for (const j of list) {
          if (!jobContributesToSelfBillPayout(j)) continue;
          paid += Number(partnerPaidByJobId[j.id] ?? 0);
        }
        paid = Math.round(paid * 100) / 100;
      }
    }
  }
  return { total, paid, outstanding };
}

function ledgerNextDueLabel(
  nextDueYmd: string,
  outstanding: number,
  todayYmd: string,
): { text: string; overdue: boolean } {
  const show = outstanding > 0.02 && /^\d{4}-\d{2}-\d{2}$/.test(nextDueYmd);
  if (!show) return { text: "—", overdue: false };
  return { text: formatDate(nextDueYmd), overdue: todayYmd > nextDueYmd };
}

function InvoiceLedgerRow({
  inv,
  todayYmd,
  selectedIds,
  onSelectionChange,
  jobsByRef,
  customerPaidByJobId,
  installments,
  onOpen,
  onMarkPaid,
  compact,
  stripeAlt,
}: {
  inv: Invoice;
  todayYmd: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  jobsByRef: Record<string, InvoiceListJobSnapshot>;
  customerPaidByJobId: Record<string, number>;
  installments?: InvoicePaymentInstallment[];
  onOpen: (inv: Invoice) => void;
  onMarkPaid: (id: string) => void;
  compact?: boolean;
  stripeAlt?: boolean;
}) {
  const canSelect = invoiceCanSelectForPayment(inv, jobsByRef);
  const canMarkPaid = canSelect;
  const st = invoiceDisplayStatus(inv, todayYmd, jobsByRef);
  const { total, paid, outstanding } = invoiceLedgerAmounts(inv, jobsByRef, customerPaidByJobId);
  const nextDue = ledgerNextDueLabel(
    invoiceDisplayDueYmd(inv, installments),
    outstanding,
    todayYmd,
  );
  return (
    <tr
      className={cn("bl-inv-row cursor-pointer", stripeAlt && "bl-inv-row--alt")}
      onClick={() => onOpen(inv)}
    >
      <td className={cn("w-8", compact ? "px-4 py-2" : "px-3 py-2")} onClick={(e) => e.stopPropagation()}>
        {canSelect ? (
          <input
            type="checkbox"
            checked={selectedIds.has(inv.id)}
            onChange={(e) => {
              const next = new Set(selectedIds);
              if (e.target.checked) next.add(inv.id);
              else next.delete(inv.id);
              onSelectionChange(next);
            }}
            className="h-3.5 w-3.5 accent-[#020040]"
          />
        ) : null}
      </td>
      <td className={cn(compact ? "px-4 py-2" : "px-3 py-2")}>
        <p className="font-semibold">{displayBillingReference(inv.reference)}</p>
        <p className="text-xs text-text-tertiary">{inv.job_reference ?? "—"}</p>
      </td>
      <td className={cn(compact ? "px-4 py-2" : "px-3 py-2")}>
        <InvoiceStatusPill status={st} />
      </td>
      <td className={cn("text-right font-medium tabular-nums", compact ? "px-4 py-2" : "px-3 py-2")}>
        {formatCurrency(total)}
      </td>
      <td className={cn("text-right tabular-nums text-emerald-700", compact ? "px-4 py-2" : "px-3 py-2")}>
        {paid > 0 ? formatCurrency(paid) : "—"}
      </td>
      <td
        className={cn(
          "text-right font-medium tabular-nums",
          outstanding > 0 ? "text-amber-800" : "text-text-tertiary",
          compact ? "px-4 py-2" : "px-3 py-2",
        )}
      >
        {outstanding > 0 ? formatCurrency(outstanding) : "—"}
      </td>
      <td
        className={cn(
          "text-right text-sm tabular-nums",
          nextDue.overdue ? "font-medium text-red-700" : nextDue.text === "—" ? "text-text-tertiary" : "text-text-secondary",
          compact ? "px-4 py-2" : "px-3 py-2",
        )}
      >
        {nextDue.text}
      </td>
      <td className={cn(compact ? "px-4 py-2" : "px-3 py-2")} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          {canMarkPaid ? (
            <button
              type="button"
              title="Mark paid"
              className="rounded border border-border-light p-1 hover:bg-emerald-50"
              onClick={(e) => {
                e.stopPropagation();
                onMarkPaid(inv.id);
              }}
            >
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
        </div>
      </td>
      <td className={cn(compact ? "px-4 py-2" : "px-3 py-2")} onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="sm" onClick={() => onOpen(inv)}>
          Open
        </Button>
      </td>
    </tr>
  );
}

function InvoiceGroupedLedger({
  groups,
  todayYmd,
  selectedIds,
  onSelectionChange,
  jobsByRef,
  customerPaidByJobId,
  installmentsByInvoiceId,
  accountLogoById,
  onOpen,
  onMarkPaid,
  emptyLabel,
  compact,
  collapsibleAccounts,
}: {
  groups: ReturnType<typeof buildInvoiceLedgerAccountGroups>;
  todayYmd: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  jobsByRef: Record<string, InvoiceListJobSnapshot>;
  customerPaidByJobId: Record<string, number>;
  installmentsByInvoiceId: Record<string, InvoicePaymentInstallment[]>;
  accountLogoById: Record<string, string | null>;
  onOpen: (inv: Invoice) => void;
  onMarkPaid: (id: string) => void;
  emptyLabel?: string;
  compact?: boolean;
  collapsibleAccounts?: {
    expandedKeys: Set<string>;
    onToggle: (accountKey: string) => void;
  };
}) {
  if (!groups.length) {
    return emptyLabel ? (
      <p className={cn("text-center text-sm text-text-tertiary", compact ? "px-4 py-6" : "px-4 py-12")}>
        {emptyLabel}
      </p>
    ) : null;
  }
  return (
    <div className="divide-y divide-border-light">
      {groups.map((group) => {
        const groupOpen = !collapsibleAccounts || collapsibleAccounts.expandedKeys.has(group.accountKey);
        const logoUrl = group.accountId ? accountLogoById[group.accountId] : null;
        const groupTotal = group.invoices.reduce((sum, inv) => {
          const { total } = invoiceLedgerAmounts(inv, jobsByRef, customerPaidByJobId);
          return Math.round((sum + total) * 100) / 100;
        }, 0);
        const groupOutstanding = group.invoices.reduce((sum, inv) => {
          const { outstanding } = invoiceLedgerAmounts(inv, jobsByRef, customerPaidByJobId);
          return Math.round((sum + outstanding) * 100) / 100;
        }, 0);
        return (
          <div key={group.accountKey}>
            {collapsibleAccounts ? (
              <button
                type="button"
                className="bl-ledger-partner flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#020040]/[0.04]"
                onClick={() => collapsibleAccounts.onToggle(group.accountKey)}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full border border-border-light bg-white object-contain p-0.5"
                    />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">
                      {group.accountName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#020040]">{group.accountName}</p>
                    <p className="text-xs text-text-tertiary">
                      {group.invoiceCount} invoice{group.invoiceCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(groupTotal)}</p>
                    {groupOutstanding > 0 ? (
                      <p className="text-[10px] tabular-nums text-amber-800">{formatCurrency(groupOutstanding)} due</p>
                    ) : null}
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", groupOpen && "rotate-180")} />
                </div>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 bg-surface-hover/30 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full border border-border-light bg-white object-contain p-0.5"
                    />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">
                      {group.accountName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#020040]">{group.accountName}</p>
                    <p className="text-xs text-text-tertiary">
                      {group.invoiceCount} invoice{group.invoiceCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(groupTotal)}</p>
                  {groupOutstanding > 0 ? (
                    <p className="text-[10px] tabular-nums text-amber-800">{formatCurrency(groupOutstanding)} due</p>
                  ) : null}
                </div>
              </div>
            )}
            {groupOpen ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-border-light bg-surface-hover/20 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                    <tr>
                      <th className={cn("w-8", compact ? "px-4 py-2" : "px-3 py-2")} />
                      <th className={cn(compact ? "px-4 py-2" : "px-3 py-2")}>Invoice</th>
                      <th className={cn(compact ? "px-4 py-2" : "px-3 py-2")}>Status</th>
                      <th className={cn("text-right", compact ? "px-4 py-2" : "px-3 py-2")}>Total</th>
                      <th className={cn("text-right", compact ? "px-4 py-2" : "px-3 py-2")}>Paid</th>
                      <th className={cn("text-right", compact ? "px-4 py-2" : "px-3 py-2")}>Outstanding</th>
                      <th className={cn("text-right", compact ? "px-4 py-2" : "px-3 py-2")}>Next due</th>
                      <th className={cn(compact ? "px-4 py-2" : "px-3 py-2")} />
                      <th className={cn(compact ? "px-4 py-2" : "px-3 py-2")}>Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {group.invoices.map((inv, idx) => (
                      <InvoiceLedgerRow
                        key={inv.id}
                        inv={inv}
                        todayYmd={todayYmd}
                        selectedIds={selectedIds}
                        onSelectionChange={onSelectionChange}
                        jobsByRef={jobsByRef}
                        customerPaidByJobId={customerPaidByJobId}
                        installments={installmentsByInvoiceId[inv.id]}
                        onOpen={onOpen}
                        onMarkPaid={onMarkPaid}
                        compact={compact}
                        stripeAlt={idx % 2 === 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PartnerGroupAvatar({
  partnerKey,
  partnerName,
  partnerAvatarById,
}: {
  partnerKey: string;
  partnerName: string;
  partnerAvatarById: Record<string, string | null>;
}) {
  return (
    <Avatar
      name={partnerName}
      size="xs"
      src={partnerAvatarById[partnerKey] ?? undefined}
      className="h-7 w-7 shrink-0 border border-border-light"
    />
  );
}

type SelfBillLedgerMode = "payQueue" | "draftQueue" | "approveQueue" | "manageQueue";

function SelfBillGroupedLedger({
  workforceGroups,
  partnerGroups,
  todayYmd,
  selectedIds,
  onSelectionChange,
  partnerDueCtx,
  partnerAvatarById,
  jobsBySelfBillId,
  partnerPaidByJobId,
  installmentsBySelfBillId,
  onOpen,
  onMarkPaid,
  onSendBills,
  sendingIds,
  onApproveAndSend,
  onPayWithWise,
  payingIds,
  onApprove,
  onUnapprove,
  onMarkReadyToPay,
  approvingIds,
  readyingIds,
  showApproveAction,
  mode,
  variant = "full",
  emptyLabel = "No self-bills in this period.",
  collapsiblePartners,
}: {
  workforceGroups: SelfBillWeekPartnerGroup[];
  partnerGroups: SelfBillWeekPartnerGroup[];
  todayYmd: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  partnerDueCtx: (partnerId: string | null | undefined) => SelfBillDueResolveContext;
  partnerAvatarById: Record<string, string | null>;
  jobsBySelfBillId: Record<string, SelfBillJobLine[]>;
  partnerPaidByJobId: Record<string, number>;
  installmentsBySelfBillId: Record<string, SelfBillPaymentInstallment[]>;
  onOpen: (sb: SelfBill) => void;
  onMarkPaid: (id: string) => Promise<void>;
  /** Send the given self-bill ids — handler decides cycle kind from scope. */
  onSendBills?: (ids: string[], scope: "week" | "partner" | "row") => Promise<void>;
  /** Self-bill ids currently sending — drives the per-row spinner state. */
  sendingIds?: Set<string>;
  /** Approve all ids, then email sendable partners (legacy — hidden when mode is set). */
  onApproveAndSend?: (ids: string[], scope: "week" | "partner" | "row") => Promise<void>;
  /** Trigger a Wise Business payout for one self-bill (legacy — hidden when mode is set). */
  onPayWithWise?: (selfBillId: string) => Promise<void>;
  /** Self-bill ids currently being paid via Wise. */
  payingIds?: Set<string>;
  /** Approve (Pending tab) — marks the self-bill as ready for Wise payout. */
  onApprove?: (ids: string[]) => Promise<void>;
  /** Unapprove (Approved tab) — reverts the signoff. */
  onUnapprove?: (ids: string[]) => Promise<void>;
  /** Mark draft self-bills as ready_to_pay (Drafts tab). */
  onMarkReadyToPay?: (ids: string[]) => Promise<void>;
  /** Self-bill ids currently being approved / unapproved. */
  approvingIds?: Set<string>;
  /** Self-bill ids currently being marked ready to pay. */
  readyingIds?: Set<string>;
  /** "approve" → render Approve; "unapprove" → render Unapprove; undefined → hide. */
  showApproveAction?: "approve" | "unapprove";
  /** Queue mode — suppresses week/partner bulk buttons and scopes row actions. */
  mode?: SelfBillLedgerMode;
  variant?: "full" | "compact";
  emptyLabel?: string;
  collapsiblePartners?: {
    expandedKeys: Set<string>;
    onToggle: (partnerGroupKey: string) => void;
  };
}) {
  const compact = variant === "compact";
  const payQueue = mode === "payQueue";
  const draftQueue = mode === "draftQueue";
  const approveQueue = mode === "approveQueue";
  const manageQueue = mode === "manageQueue";
  const queueMode = payQueue || draftQueue || approveQueue || manageQueue;
  const showWeekApproveAndSend = approveQueue && !!onApproveAndSend;
  const showWeekBulkActions =
    showWeekApproveAndSend || (!queueMode && (onApproveAndSend || onSendBills));
  const showPartnerApprove = !queueMode && showApproveAction === "approve" && onApprove;
  const showRowMarkPaid = payQueue || !queueMode;
  const showRowSend = manageQueue ? !!onSendBills : !queueMode && !!onSendBills;
  const showRowApproveWorkforce =
    approveQueue && showApproveAction === "approve" && !!onApprove;
  const showRowApproveAndSend = approveQueue && !!onApproveAndSend;
  const showRowUnapprove = manageQueue && showApproveAction === "unapprove" && !!onUnapprove;
  const showRowMarkReady = draftQueue && !!onMarkReadyToPay;
  const showRowPay = !queueMode && !!onPayWithWise;
  const ledgerSections: { label: string; groups: SelfBillWeekPartnerGroup[] }[] = [
    ...(workforceGroups.length > 0 ? [{ label: "Workforce", groups: workforceGroups }] : []),
    ...(partnerGroups.length > 0 ? [{ label: "Partners", groups: partnerGroups }] : []),
  ];
  if (!ledgerSections.length) {
    return (
      <p className={cn("text-center text-sm text-text-tertiary", compact ? "px-5 py-8" : "px-4 py-12")}>
        {emptyLabel}
      </p>
    );
  }
  let ledgerRowIndex = 0;
  return (
    <div className="divide-y divide-border-light">
      {ledgerSections.map((section) => (
        <div key={section.label}>
          <div className="border-b border-border-light bg-surface-hover/30 px-4 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{section.label}</p>
          </div>
          {section.groups.map((week) => (
        <div key={week.weekKey}>
          <div className="bl-ledger-week flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#020040]">{week.weekTitle}</p>
              {week.weekSubtitle ? <p className="text-xs text-text-secondary">{week.weekSubtitle}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-bold tabular-nums text-[#020040]">{formatCurrency(week.weekTotal)}</p>
              {showWeekBulkActions && onApproveAndSend ? (() => {
                const weekApproveIds = week.partners.flatMap((p) =>
                  p.rows
                    .filter(
                      (sb) =>
                        !isSelfBillPayoutVoided(sb) &&
                        sb.status !== "paid" &&
                        (!approveQueue || !sb.approved_at),
                    )
                    .map((sb) => sb.id),
                );
                if (!weekApproveIds.length) return null;
                const busyHere = weekApproveIds.some(
                  (id) => approvingIds?.has(id) || sendingIds?.has(id),
                );
                return (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={busyHere}
                    onClick={() => void onApproveAndSend(weekApproveIds, "week")}
                  >
                    {bulkApproveActionLabel(
                      weekApproveIds,
                      week.partners.flatMap((p) => p.rows),
                    )}
                  </Button>
                );
              })() : showWeekBulkActions && onSendBills ? (() => {
                const weekIds = week.partners.flatMap((p) =>
                  p.rows
                    .filter((sb) => !isSelfBillPayoutVoided(sb) && sb.bill_origin !== "internal" && !!sb.partner_id?.trim())
                    .map((sb) => sb.id),
                );
                if (!weekIds.length) return null;
                const sendingHere = weekIds.some((id) => sendingIds?.has(id));
                return (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={sendingHere}
                    onClick={() => void onSendBills(weekIds, "week")}
                  >
                    Send all
                  </Button>
                );
              })() : null}
            </div>
          </div>
          {week.partners.map((partner) => {
            const partnerGroupKey = `${week.weekKey}::${partner.partnerKey}`;
            const partnerOpen = !collapsiblePartners || collapsiblePartners.expandedKeys.has(partnerGroupKey);
            const partnerPendingApproveIds = partner.rows
              .filter(
                (sb) =>
                  !isSelfBillPayoutVoided(sb) &&
                  sb.status !== "paid" &&
                  !sb.approved_at,
              )
              .map((sb) => sb.id);
            const partnerSelectableIds = partner.rows
              .filter((sb) =>
                payQueue
                  ? sb.status !== "paid" && !sb.wise_paid_at && !isSelfBillPayoutVoided(sb)
                  : approveQueue
                    ? !isSelfBillPayoutVoided(sb) && sb.status !== "paid" && !sb.approved_at
                    : draftQueue
                      ? !selfBillCountsAsReady(sb) && !isSelfBillPayoutVoided(sb)
                      : false,
              )
              .map((sb) => sb.id);
            const partnerAllSelected =
              partnerSelectableIds.length > 0 &&
              partnerSelectableIds.every((id) => selectedIds.has(id));
            return (
            <div key={partnerGroupKey}>
              {collapsiblePartners ? (
                <div className="bl-ledger-partner flex items-center gap-2 px-4 py-2.5">
                  {partnerSelectableIds.length > 0 ? (
                    <input
                      type="checkbox"
                      checked={partnerAllSelected}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        for (const id of partnerSelectableIds) {
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                        }
                        onSelectionChange(next);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 shrink-0 accent-[#020040]"
                      aria-label={`Select all ${partner.partnerName} self-bills`}
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:opacity-80"
                    onClick={() => collapsiblePartners.onToggle(partnerGroupKey)}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <PartnerGroupAvatar
                        partnerKey={partner.partnerKey}
                        partnerName={partner.partnerName}
                        partnerAvatarById={partnerAvatarById}
                      />
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
                  {showPartnerApprove && partnerPendingApproveIds.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      loading={partnerPendingApproveIds.some((id) => approvingIds?.has(id))}
                      onClick={() => void onApprove(partnerPendingApproveIds)}
                    >
                      Approve
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="bl-ledger-partner flex items-center gap-2 px-4 py-2.5">
                  {partnerSelectableIds.length > 0 ? (
                    <input
                      type="checkbox"
                      checked={partnerAllSelected}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        for (const id of partnerSelectableIds) {
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                        }
                        onSelectionChange(next);
                      }}
                      className="h-3.5 w-3.5 shrink-0 accent-[#020040]"
                      aria-label={`Select all ${partner.partnerName} self-bills`}
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden />
                  )}
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <PartnerGroupAvatar
                        partnerKey={partner.partnerKey}
                        partnerName={partner.partnerName}
                        partnerAvatarById={partnerAvatarById}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#020040]">{partner.partnerName}</p>
                        <p className="text-xs text-text-tertiary">{partner.rows.length} self-bill{partner.rows.length === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(partner.partnerTotal)}</p>
                  </div>
                </div>
              )}
              {partnerOpen ? (
              <div className="bl-sb-table">
                    <div className="bl-sb-row__colhead hidden px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-tertiary sm:grid">
                      <span className="sm:col-start-2">Status</span>
                      <span className="text-right">Total</span>
                      <span className="text-right">Outstanding</span>
                      <span className="text-right">Next due</span>
                      <span className="text-center">
                        {approveQueue
                          ? "Approve & Send"
                          : draftQueue
                            ? "Ready"
                            : payQueue
                              ? "Pay"
                              : "Action"}
                      </span>
                      <span className="text-right">Open</span>
                    </div>
                    {partner.rows.map((sb) => {
                      const canSelect = payQueue
                        ? sb.status !== "paid" && !sb.wise_paid_at && !isSelfBillPayoutVoided(sb)
                        : draftQueue
                          ? !selfBillCountsAsReady(sb) && !isSelfBillPayoutVoided(sb)
                          : approveQueue
                            ? !isSelfBillPayoutVoided(sb) && sb.status !== "paid" && !sb.approved_at
                            : manageQueue
                              ? !!sb.approved_at && !sb.wise_paid_at && !isSelfBillPayoutVoided(sb)
                              : !isSelfBillPayoutVoided(sb) && sb.status !== "paid";
                      const overdue = isSelfBillOverdue(sb, todayYmd, partnerDueCtx(sb.partner_id));
                      const label = sb.status === "paid" ? "Paid" : overdue ? "Overdue" : selfBillCountsAsReady(sb) ? "Ready" : "Draft";
                      const installments = installmentsBySelfBillId[sb.id];
                      const { total, paid, outstanding } = selfBillLedgerAmounts(
                        sb,
                        jobsBySelfBillId[sb.id],
                        partnerPaidByJobId,
                        installments,
                      );
                      const nextDue = ledgerNextDueLabel(
                        selfBillEffectiveDueYmd(sb, installments, partnerDueCtx(sb.partner_id)),
                        outstanding,
                        todayYmd,
                      );
                      const rowAlt = ledgerRowIndex % 2 === 1;
                      ledgerRowIndex += 1;
                      return (
                        <div
                          key={sb.id}
                          className={cn(
                            "bl-ledger-row bl-sb-row flex w-full min-w-0 flex-col gap-2 px-4 py-2.5 sm:grid sm:items-center sm:gap-x-3",
                            rowAlt && "bl-ledger-row--alt",
                          )}
                        >
                          <div className="bl-sb-row__identity flex min-w-0 items-center gap-3">
                            <div className="flex w-8 shrink-0 justify-center">
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
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-[#020040]">
                                <span className="truncate">{sb.reference}</span>
                                {(() => {
                                  /**
                                   * Single-job self-bill: one hop to the job. The job number is spelled
                                   * out only when the self-bill reference does not already carry it
                                   * (`SB-2026-W32-JOB-9391` says it twice otherwise); the date rides in
                                   * the tooltip so the row stays on one line.
                                   */
                                  const linked = jobsBySelfBillId[sb.id] ?? [];
                                  const only = linked.length === 1 ? linked[0] : null;
                                  if (!only) return null;
                                  const jobYmd =
                                    only.scheduled_date?.trim().slice(0, 10) ||
                                    only.scheduled_start_at?.trim().slice(0, 10) ||
                                    "";
                                  const refShowsJob = sb.reference?.includes(only.reference) ?? false;
                                  return (
                                    <button
                                      type="button"
                                      title={`Open ${only.reference}${jobYmd ? ` · ${formatDate(jobYmd)}` : ""}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(`/jobs/${only.id}`, "_blank", "noopener,noreferrer");
                                      }}
                                      className="inline-flex shrink-0 items-center gap-1 rounded border border-border-light px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
                                    >
                                      <Briefcase className="h-3 w-3" aria-hidden />
                                      {refShowsJob ? null : only.reference}
                                    </button>
                                  );
                                })()}
                                {sb.bill_origin === "internal" ? (
                                  <Badge variant="info" size="sm" className="text-[9px] uppercase tracking-wide">
                                    Workforce
                                  </Badge>
                                ) : null}
                                {sb.bill_origin === "internal" && sb.payout_breakdown?.start_date_missing ? (
                                  <Badge variant="warning" size="sm" className="text-[9px] uppercase tracking-wide">
                                    Start date missing
                                  </Badge>
                                ) : null}
                              </span>
                              {!compact ? (
                                sb.bill_origin === "internal" && sb.payout_breakdown ? (
                                  <p className="mt-0.5 text-xs text-text-secondary">
                                    Fixed {formatCurrency(Number(sb.payout_breakdown.fixed_pay ?? 0))} + Commission{" "}
                                    {formatCurrency(Number(sb.payout_breakdown.commission_amount ?? 0))}
                                    {sb.payout_breakdown.payable_days != null
                                      ? ` · ${sb.payout_breakdown.payable_days} day${sb.payout_breakdown.payable_days === 1 ? "" : "s"}`
                                      : ""}
                                    {" · "}
                                    {sb.payout_breakdown.jobs?.length ?? 0} job
                                    {(sb.payout_breakdown.jobs?.length ?? 0) === 1 ? "" : "s"}
                                  </p>
                                ) : (
                                  <p className="mt-0.5 text-xs text-text-secondary">{sb.week_label ?? sb.period ?? "—"}</p>
                                )
                              ) : null}
                            </div>
                          </div>
                          <div className="bl-sb-row__cols">
                            <span className="bl-sb-row__statuscell">
                              <StatusPill label={label} tone={label === "Paid" ? "ok" : label === "Overdue" ? "bad" : "info"} />
                            </span>
                            <span
                              className="bl-sb-row__amount text-sm tabular-nums"
                              title={paid > 0.02 ? `${formatCurrency(paid)} already paid` : undefined}
                            >
                              {formatCurrency(total)}
                            </span>
                            <span
                              className={cn(
                                "bl-sb-row__outstanding text-sm font-medium tabular-nums",
                                outstanding > 0.02 ? "text-amber-800" : "text-text-tertiary",
                              )}
                            >
                              {outstanding > 0.02 ? formatCurrency(outstanding) : "—"}
                            </span>
                            <span
                              className={cn(
                                "bl-sb-row__next-due text-sm tabular-nums",
                                nextDue.overdue
                                  ? "font-medium text-red-700"
                                  : nextDue.text === "—"
                                    ? "text-text-tertiary"
                                    : "text-text-secondary",
                              )}
                            >
                              {nextDue.text}
                            </span>
                            <div className="bl-sb-row__actions">
                              {showRowMarkPaid && canSelect ? (
                                <button type="button" title="Mark paid" className="rounded border border-border-light p-1 hover:bg-emerald-50" onClick={() => void onMarkPaid(sb.id)}>
                                  <Check className="h-3.5 w-3.5 text-emerald-700" />
                                </button>
                              ) : null}
                              {showRowSend && sb.bill_origin !== "internal" && !!sb.partner_id?.trim() && !isSelfBillPayoutVoided(sb) ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={sendingIds?.has(sb.id) ?? false}
                                  onClick={() => void onSendBills?.([sb.id], "row")}
                                  title={sb.email_sent_at ? `Last sent ${new Date(sb.email_sent_at).toLocaleString("en-GB")}` : "Send self-bill to partner"}
                                >
                                  {sb.email_sent_at ? "Resend" : "Send"}
                                </Button>
                              ) : null}
                              {showRowMarkReady && canSelect ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  loading={readyingIds?.has(sb.id) ?? false}
                                  onClick={() => void onMarkReadyToPay?.([sb.id])}
                                  title="Move to Pending — ready for approval"
                                >
                                  Ready to pay
                                </Button>
                              ) : null}
                              {showRowApproveWorkforce &&
                              canSelect &&
                              !sb.approved_at &&
                              sb.bill_origin === "internal" ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  loading={approvingIds?.has(sb.id) ?? false}
                                  onClick={() => void onApprove?.([sb.id])}
                                  title="Mark approved — unlocks Wise payment"
                                >
                                  Approve
                                </Button>
                              ) : null}
                              {showRowApproveAndSend &&
                              canSelect &&
                              !sb.approved_at &&
                              selfBillPartnerEmailSendEligible(sb) ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  loading={
                                    (approvingIds?.has(sb.id) ?? false) || (sendingIds?.has(sb.id) ?? false)
                                  }
                                  onClick={() => void onApproveAndSend?.([sb.id], "row")}
                                  title="Approve and email this self-bill only"
                                >
                                  Approve &amp; Send
                                </Button>
                              ) : null}
                              {showRowApproveWorkforce &&
                              canSelect &&
                              !sb.approved_at &&
                              sb.bill_origin !== "internal" &&
                              !selfBillPartnerEmailSendEligible(sb) ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  loading={approvingIds?.has(sb.id) ?? false}
                                  onClick={() => void onApprove?.([sb.id])}
                                  title="Mark approved — unlocks Wise payment"
                                >
                                  Approve
                                </Button>
                              ) : null}
                              {showRowUnapprove && canSelect && !!sb.approved_at && !sb.wise_paid_at ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={approvingIds?.has(sb.id) ?? false}
                                  onClick={() => void onUnapprove?.([sb.id])}
                                  title="Revoke approval"
                                >
                                  Unapprove
                                </Button>
                              ) : null}
                              {showRowPay && canSelect && !sb.wise_paid_at && !!sb.approved_at ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  loading={payingIds?.has(sb.id) ?? false}
                                  title="Pay partner via Wise"
                                  onClick={() => void onPayWithWise?.(sb.id)}
                                >
                                  Make payment
                                </Button>
                              ) : null}
                            </div>
                            <div className="bl-sb-row__open">
                              {sb.zendesk_ticket_url ? (
                                <a
                                  href={sb.zendesk_ticket_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open Zendesk payment ticket"
                                  className="rounded border border-border-light p-1 hover:bg-surface-hover/50"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 text-text-secondary" />
                                </a>
                              ) : null}
                              <Button variant="ghost" size="sm" onClick={() => onOpen(sb)}>{compact ? "Review" : "Open"}</Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
              </div>
              ) : null}
            </div>
          );
          })}
        </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, alert, coral, green }: { label: string; value: string; sub: string; alert?: boolean; coral?: boolean; green?: boolean }) {
  return (
    <div className={cn(
      "min-w-0 rounded-xl border bg-white px-3 py-3 shadow-sm sm:px-4",
      alert ? "border-red-200 bg-red-50/30" : coral ? "border-orange-200 bg-orange-50/30" : "border-border-light",
    )}>
      <p className="text-[9px] font-bold uppercase leading-snug tracking-wider text-text-tertiary sm:text-[10px]">{label}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums sm:text-xl", green ? "text-emerald-700" : "text-[#020040]")}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-text-secondary sm:text-xs">{sub}</p>
    </div>
  );
}

/** Clean pill: numbers live in the hover tooltip, not inline — the header stays scannable. */
function TabPill({
  active,
  onClick,
  label,
  count,
  total,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number | null;
  total?: number;
}) {
  const hoverDetail =
    count != null
      ? `${count} item${count === 1 ? "" : "s"}${total != null && count > 0 ? ` · ${formatCurrency(total)}` : ""}`
      : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      title={hoverDetail}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition",
        active
          ? "bg-[#020040] text-white"
          : "bg-surface-hover/40 text-text-secondary hover:bg-surface-hover/80",
      )}
    >
      {label}
    </button>
  );
}

function RunwayTabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors sm:px-3 sm:text-xs",
        active ? "bg-[#ED4B00] text-white" : "text-text-secondary hover:bg-white/80",
      )}
    >
      {label}
    </button>
  );
}

function InvoiceStatusPill({ status }: { status: ReturnType<typeof invoiceDisplayStatus> }) {
  const tone =
    status === "Paid"
      ? "ok"
      : status === "Overdue"
        ? "bad"
        : status === "Draft" || status === "On hold"
          ? "muted"
          : "info";
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
