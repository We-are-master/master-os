"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Drawer } from "@/components/ui/drawer";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Download,
  Wallet,
  DollarSign,
  CheckCircle2,
  CalendarRange,
  RefreshCw,
  FileText,
  ExternalLink,
  LayoutGrid,
  List,
  Layers,
  Rows3,
  Pencil,
  Clock,
  AlertTriangle,
  Check,
  RotateCcw,
  TrendingUp,
  Ban,
  Receipt,
  Plus,
  Mail,
  Loader2,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { getJob } from "@/services/jobs";
import { listJobPayments } from "@/services/job-payments";
import { executeJobMoneyAction } from "@/services/job-money-actions";
import { partnerPayLedgerBypassesPartnerCap, PARTNER_PAY_LEDGER_LABEL_OPTIONS } from "@/lib/partner-pay-record";
import type { Job, JobPaymentMethod, SelfBill, SelfBillPaymentInstallment } from "@/types/database";
import {
  PaymentPlanEditor,
  emptyPaymentPlanRow,
  type PaymentPlanEditorRow,
} from "@/components/finance/payment-plan-editor";
import {
  defaultSelfBillPayoutPlanRows,
  nextOpenSelfBillInstallment,
  selfBillEffectiveDueYmd,
  selfBillPaymentPlanProgressLabel,
} from "@/lib/self-bill-payment-plan";
import {
  cancelSelfBillPaymentPlan,
  createSelfBillPaymentPlan,
  listInstallmentsForSelfBill,
  markAllSelfBillInstallmentsPaid,
  markSelfBillInstallmentPaid,
  syncSelfBillPaymentPlanFromPartnerPaid,
} from "@/services/self-bill-payment-plan";
import { orgCtxFromSetup } from "@/lib/account-payment-due-date";
import { getSupabase } from "@/services/base";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import {
  resolveSelfBillDueYmd,
  workPeriodBoundsForPayoutFriday,
  type SelfBillDueResolveContext,
} from "@/lib/partner-payout-schedule";
import { parseISO } from "date-fns/parseISO";
import {
  dueDateSourceLabel,
  inferPartnerDueDateSource,
  type DueDateSource,
} from "@/lib/partner-payout-schedule";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import {
  BillingPageActions,
  useBillingCreatedAtFilter,
} from "@/components/finance/billing-filter-context";
import {
  billingCreatedAtFilterDescription,
  resolveBillingCreatedAtYmdBounds,
} from "@/lib/billing-created-at-filter";
import {
  billingDueDateFilterDescription,
  DEFAULT_BILLING_DUE_DATE_FILTER,
  dueYmdInBounds,
  resolveBillingDueDateYmdBounds,
  type BillingDueDateFilterValue,
  type OrgPayoutScheduleCtx,
} from "@/lib/billing-due-date-filter";
import { BillingDueDateFilter } from "@/components/finance/billing-due-date-filter";
import { localYmdBoundsToUtcIso } from "@/lib/schedule-calendar";
import { SELF_BILL_FINANCE_VOID_LABEL, selfBillPartnerStatusLine } from "@/lib/self-bill-display";
import {
  cancelSelfBillsByIds,
  isSelfBillClosed,
  isSelfBillPayoutVoided,
  jobContributesToSelfBillPayout,
  listJobsForSelfBill,
  listJobsLinkedToSelfBillIds,
  selfBillJobPayoutStateLabel,
} from "@/services/self-bills";
import { partnerSelfBillGrossAmount } from "@/lib/job-financials";

const JOB_PAYMENTS_IN_CHUNK = 80;

type PayoutListMode = "self_bill" | "by_job";

/** Module context for due-date resolution (Setup standard + partner terms). */
let selfBillDueResolveCtx: {
  partnerTermsById: Record<string, string | null>;
  orgStandardTerms: string;
  orgReferenceYmd: string | null;
} | null = null;

function dueCtxForPartner(partnerId?: string | null): SelfBillDueResolveContext {
  const pid = partnerId?.trim();
  return {
    partnerTerms: pid && selfBillDueResolveCtx ? selfBillDueResolveCtx.partnerTermsById[pid] ?? null : null,
    orgStandardTerms: selfBillDueResolveCtx?.orgStandardTerms,
    orgReferenceYmd: selfBillDueResolveCtx?.orgReferenceYmd,
  };
}

/** DB statuses that map to the "Draft" UI bucket (job still in progress). */
const DRAFT_DB_STATUSES = new Set(["draft", "accumulating", "needs_attention"]);

/** DB statuses that map to the "Ready to Pay" UI bucket (before overdue check). */
const READY_DB_STATUSES = new Set(["ready_to_pay", "pending_review", "awaiting_payment"]);

function selfBillDueYmd(sb: Pick<SelfBill, "week_end" | "due_date" | "partner_id">): string {
  return resolveSelfBillDueYmd(sb, dueCtxForPartner(sb.partner_id));
}

function selfBillCountsAsReady(sb: Pick<SelfBill, "status">): boolean {
  return READY_DB_STATUSES.has(sb.status) || sb.status === "audit_required";
}

/** Group headers in Draft grouped view — calendar week of `created_at`. */
function selfBillCreatedWeekGroup(sb: Pick<SelfBill, "created_at">): {
  key: string;
  title: string;
  subtitle: string | null;
} {
  const ymd = sb.created_at?.trim().slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return { key: "unknown", title: "Created · unknown", subtitle: null };
  }
  const { weekLabel, weekStart, weekEnd } = getWeekBoundsForDate(parseISO(`${ymd}T12:00:00`));
  return {
    key: weekLabel,
    title: `Created · ${weekLabel}`,
    subtitle: `${formatDate(weekStart)} → ${formatDate(weekEnd)}`,
  };
}

/** Group headers in Ready/Overdue grouped view — payment `due_date` (Friday). */
function selfBillDueWeekGroup(sb: Pick<SelfBill, "week_end" | "due_date">): {
  key: string;
  title: string;
  subtitle: string | null;
} {
  const due = selfBillDueYmd(sb);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return { key: "unknown", title: "Pay · unknown due", subtitle: null };
  }
  const period = workPeriodBoundsForPayoutFriday(due);
  return {
    key: due,
    title: `Pay · ${formatDate(due)}`,
    subtitle: `Work · ${formatDate(period.periodStartYmd)} – ${formatDate(period.periodEndYmd)}`,
  };
}

// ── Status model ──────────────────────────────────────────────────────────────

function sbTodayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function isSelfBillOverdue(sb: Pick<SelfBill, "status" | "week_end" | "due_date">, todayYmd: string): boolean {
  if (!selfBillCountsAsReady(sb)) return false;
  const due = selfBillDueYmd(sb);
  if (!due) return false;
  return todayYmd > due;
}

type SelfBillDisplayStatus = {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info";
};

function getSelfBillDisplayStatus(sb: SelfBill, todayYmd: string): SelfBillDisplayStatus {
  if (isSelfBillPayoutVoided(sb)) return { label: "Void", variant: "default" };
  if (sb.status === "paid") return { label: "Paid", variant: "success" };
  if (sb.status === "audit_required") return { label: "Audit required", variant: "danger" };
  if (sb.status === "rejected") return { label: "Cancelled", variant: "default" };
  if (DRAFT_DB_STATUSES.has(sb.status)) return { label: "Draft", variant: "default" };
  if (selfBillCountsAsReady(sb)) {
    if (isSelfBillOverdue(sb, todayYmd)) return { label: "Overdue", variant: "danger" };
    return { label: "Ready to Pay", variant: "info" };
  }
  return { label: sb.status, variant: "default" };
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TAB_ORDER = [
  "all",
  "draft",
  "ready_to_pay",
  "overdue",
  "closed",
] as const;

type SelfBillTab = (typeof TAB_ORDER)[number];

const TAB_LABELS: Record<SelfBillTab, string> = {
  all: "All",
  draft: "Draft",
  ready_to_pay: "Ready to Pay",
  overdue: "Overdue",
  closed: "Closed",
};

function selfBillMatchesTab(sb: SelfBill, tab: SelfBillTab, todayYmd: string): boolean {
  if (tab === "all") return true;
  if (tab === "closed") return isSelfBillClosed(sb);
  if (isSelfBillPayoutVoided(sb)) return false;
  if (tab === "draft") return DRAFT_DB_STATUSES.has(sb.status);
  if (tab === "ready_to_pay") return selfBillCountsAsReady(sb) && !isSelfBillOverdue(sb, todayYmd);
  if (tab === "overdue") return isSelfBillOverdue(sb, todayYmd);
  return false;
}

function selfBillPassesCreatedAtFilter(
  sb: Pick<SelfBill, "created_at">,
  bounds: { from: string; to: string } | null,
): boolean {
  if (!bounds) return true;
  const { startIso, endIso } = localYmdBoundsToUtcIso(bounds.from, bounds.to);
  const t = new Date(sb.created_at ?? 0).getTime();
  return t >= new Date(startIso).getTime() && t <= new Date(endIso).getTime();
}

function selfBillPassesDueDateFilter(
  sb: Pick<SelfBill, "week_end" | "due_date">,
  bounds: { from: string; to: string } | null,
): boolean {
  if (!bounds) return true;
  const due = selfBillDueYmd(sb);
  return dueYmdInBounds(due, bounds);
}

async function markSelfBillsPaid(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const paidDay = new Date().toISOString().slice(0, 10);
  const res = await supabase.from("self_bills").update({ status: "paid", paid_at: paidDay }).in("id", ids);
  if (res.error && /paid_at|column|schema|PGRST204/i.test(String(res.error.message ?? ""))) {
    const { error } = await supabase.from("self_bills").update({ status: "paid" }).in("id", ids);
    if (error) throw error;
  } else if (res.error) {
    throw res.error;
  }
}

// ── Payout helpers ─────────────────────────────────────────────────────────────

async function fetchPartnerPaidTotalsByJobIds(jobIds: string[]): Promise<Record<string, number>> {
  if (jobIds.length === 0) return {};
  const supabase = getSupabase();
  const sums: Record<string, number> = {};
  for (let i = 0; i < jobIds.length; i += JOB_PAYMENTS_IN_CHUNK) {
    const chunk = jobIds.slice(i, i + JOB_PAYMENTS_IN_CHUNK);
    const q = supabase.from("job_payments").select("job_id, amount").eq("type", "partner").in("job_id", chunk).is("deleted_at", null);
    let { data, error } = await q;
    if (error) {
      const retry = await supabase.from("job_payments").select("job_id, amount").eq("type", "partner").in("job_id", chunk);
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    for (const row of data ?? []) {
      const id = String((row as { job_id: string }).job_id);
      sums[id] = (sums[id] ?? 0) + Number((row as { amount: number }).amount);
    }
  }
  return sums;
}

function jobLinePartnerGross(j: Pick<Job, "partner_cost" | "materials_cost" | "partner_agreed_value">): number {
  return Math.round(partnerSelfBillGrossAmount(j as Job) * 100) / 100;
}

function computeSelfBillAmountDue(
  sb: SelfBill,
  jobs: JobLine[] | undefined,
  partnerPaidByJobId: Record<string, number>,
): number {
  if (isSelfBillPayoutVoided(sb)) return 0;
  if (sb.bill_origin === "internal") {
    return Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
  }
  const list = jobs ?? [];
  if (list.length === 0) {
    return Math.max(0, Math.round(Number(sb.net_payout ?? 0) * 100) / 100);
  }
  let due = 0;
  for (const j of list) {
    if (!jobContributesToSelfBillPayout(j)) continue;
    const cap = jobLinePartnerGross(j);
    const paid = partnerPaidByJobId[j.id] ?? 0;
    due += Math.max(0, cap - paid);
  }
  return Math.round(due * 100) / 100;
}

function isPartnerFieldBill(sb: SelfBill): boolean {
  return sb.bill_origin !== "internal";
}

// ── Types ──────────────────────────────────────────────────────────────────────

type JobLine = Pick<
  Job,
  | "id"
  | "reference"
  | "title"
  | "partner_cost"
  | "partner_agreed_value"
  | "materials_cost"
  | "status"
  | "property_address"
  | "self_bill_id"
  | "deleted_at"
  | "partner_cancelled_at"
>;

async function computeLinkedJobsMapsForSelfBillIds(ids: string[]): Promise<{
  map: Record<string, JobLine[]>;
  partnerPaidByJobId: Record<string, number>;
}> {
  if (ids.length === 0) return { map: {}, partnerPaidByJobId: {} };
  const rows = await listJobsLinkedToSelfBillIds(ids);
  const map: Record<string, JobLine[]> = {};
  for (const j of rows) {
    const sid = j.self_bill_id as string;
    if (!map[sid]) map[sid] = [];
    map[sid].push(j);
  }
  const jobIds = [...new Set(rows.map((r) => r.id))];
  const partnerPaidByJobId = await fetchPartnerPaidTotalsByJobIds(jobIds);
  return { map, partnerPaidByJobId };
}

// ── Page component ─────────────────────────────────────────────────────────────

export function SelfBillFinanceClient() {
  // Suspense wrapper required by Next.js for pages that read useSearchParams during prerender.
  return (
    <Suspense fallback={null}>
      <SelfBillPageInner />
    </Suspense>
  );
}

function SelfBillPageInner() {
  const { partnerPayoutStandardTerms, partnerPayoutReferenceYmd } = useFrontendSetup();
  const orgPayoutSchedule = useMemo<OrgPayoutScheduleCtx>(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );
  const [activeTab, setActiveTab] = useState<SelfBillTab>("ready_to_pay");
  const [layoutMode, setLayoutMode] = useState<"cards" | "table">("table");
  /** Table: group Ready/Overdue by payment due date (default) or flat list. */
  const [listGroupMode, setListGroupMode] = useState<"grouped" | "flat">("grouped");
  const [dueDateFilter, setDueDateFilter] = useState<BillingDueDateFilterValue>(DEFAULT_BILLING_DUE_DATE_FILTER);
  const [payoutListMode, setPayoutListMode] = useState<PayoutListMode>("self_bill");
  const [partnerTermsById, setPartnerTermsById] = useState<Record<string, string | null>>({});
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { filter: createdAtFilter } = useBillingCreatedAtFilter();
  const [drawerSelfBill, setDrawerSelfBill] = useState<SelfBill | null>(null);
  const [drawerJobs, setDrawerJobs] = useState<Awaited<ReturnType<typeof listJobsForSelfBill>>>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsBySelfBillId, setJobsBySelfBillId] = useState<Record<string, JobLine[]>>({});
  const [partnerPaidByJobId, setPartnerPaidByJobId] = useState<Record<string, number>>({});
  const [editSelfBill, setEditSelfBill] = useState<SelfBill | null>(null);
  const [editForm, setEditForm] = useState({ job_value: "", materials: "", commission: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [originFilter, setOriginFilter] = useState<"all" | "partner" | "internal">("all");
  const [todayYmd] = useState(() => sbTodayYmd());
  const [recalculating, setRecalculating] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);

  const searchParams = useSearchParams();
  const autoOpenSbId = searchParams.get("open") ?? searchParams.get("focus");
  const autoOpenFiredRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    try {
      const { data, error } = await supabase
        .from("self_bills")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setSelfBills((data ?? []) as SelfBill[]);
    } catch (e) {
      console.error("Self-bills load failed", e);
      toast.error(e instanceof Error ? e.message : "Failed to load self-bills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    selfBillDueResolveCtx = {
      partnerTermsById,
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    };
  }, [partnerTermsById, partnerPayoutStandardTerms, partnerPayoutReferenceYmd]);

  useEffect(() => {
    let cancelled = false;
    const partnerIds = [
      ...new Set(selfBills.map((sb) => sb.partner_id?.trim()).filter((x): x is string => Boolean(x))),
    ];
    if (partnerIds.length === 0) return;
    (async () => {
      const supabase = getSupabase();
      const termsPatch: Record<string, string | null> = {};
      const CHUNK = 80;
      for (let i = 0; i < partnerIds.length; i += CHUNK) {
        const { data } = await supabase
          .from("partners")
          .select("id, payment_terms")
          .in("id", partnerIds.slice(i, i + CHUNK));
        for (const row of data ?? []) {
          const pr = row as { id: string; payment_terms?: string | null };
          termsPatch[pr.id] = pr.payment_terms?.trim() || null;
        }
      }
      if (!cancelled) setPartnerTermsById((prev) => ({ ...prev, ...termsPatch }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selfBills]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel("self_bills_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "self_bills" }, () => { loadData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  const createdAtBounds = useMemo(
    () => resolveBillingCreatedAtYmdBounds(createdAtFilter),
    [createdAtFilter],
  );
  const dueDateBounds = useMemo(
    () => resolveBillingDueDateYmdBounds(dueDateFilter, todayYmd, orgPayoutSchedule),
    [dueDateFilter, todayYmd, orgPayoutSchedule],
  );
  const usesDueDatePeriod = activeTab === "ready_to_pay" || activeTab === "overdue";

  const filtered = useMemo(() => {
    let result = selfBills.filter((sb) => selfBillMatchesTab(sb, activeTab, todayYmd));
    if (originFilter === "partner") result = result.filter((sb) => isPartnerFieldBill(sb));
    else if (originFilter === "internal") result = result.filter((sb) => sb.bill_origin === "internal");
    if (usesDueDatePeriod) {
      result = result.filter((sb) => selfBillPassesDueDateFilter(sb, dueDateBounds));
    } else {
      result = result.filter((sb) => selfBillPassesCreatedAtFilter(sb, createdAtBounds));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (sb) =>
          (sb.partner_name ?? "").toLowerCase().includes(q) ||
          (sb.reference ?? "").toLowerCase().includes(q) ||
          (sb.week_label ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [selfBills, activeTab, search, originFilter, todayYmd, usesDueDatePeriod, dueDateBounds, createdAtBounds]);

  const filteredIdSet = useMemo(() => new Set(filtered.map((sb) => sb.id)), [filtered]);

  const filteredSorted = useMemo(() => {
    const rows = [...filtered];
    if (usesDueDatePeriod) {
      return rows.sort((a, b) => {
        const da = selfBillDueYmd(a);
        const db = selfBillDueYmd(b);
        if (da !== db) return da.localeCompare(db);
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      });
    }
    return rows.sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
    );
  }, [filtered, usesDueDatePeriod]);

  const jobPayoutRows = useMemo(() => {
    const rows: { job: JobLine; sb: SelfBill }[] = [];
    for (const sb of filteredSorted) {
      if (isSelfBillPayoutVoided(sb) || sb.bill_origin === "internal") continue;
      for (const j of jobsBySelfBillId[sb.id] ?? []) {
        if (!jobContributesToSelfBillPayout(j)) continue;
        rows.push({ job: j, sb });
      }
    }
    return rows.sort(
      (a, b) =>
        new Date(b.sb.created_at ?? 0).getTime() - new Date(a.sb.created_at ?? 0).getTime(),
    );
  }, [filteredSorted, jobsBySelfBillId]);

  const showPayoutBulkBar =
    layoutMode === "table" &&
    (activeTab === "ready_to_pay" || activeTab === "overdue") &&
    selectedIds.size > 0;

  const getBulkEligibleIds = useCallback(
    (opts?: { forEmail?: boolean }) => {
      return Array.from(selectedIds).filter((id) => {
        const sb = selfBills.find((s) => s.id === id);
        if (!sb || !filteredIdSet.has(id) || isSelfBillPayoutVoided(sb)) return false;
        if (opts?.forEmail) {
          if (sb.bill_origin === "internal" || !sb.partner_id?.trim()) return false;
        }
        return true;
      });
    },
    [selectedIds, selfBills, filteredIdSet],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<SelfBillTab, number> = {
      all: selfBills.length,
      draft: 0,
      ready_to_pay: 0,
      overdue: 0,
      closed: 0,
    };
    for (const sb of selfBills) {
      for (const tab of TAB_ORDER) {
        if (tab !== "all" && selfBillMatchesTab(sb, tab, todayYmd)) {
          counts[tab]++;
          break;
        }
      }
    }
    return counts;
  }, [selfBills, todayYmd]);

  const kpiPeriodDesc = useMemo(
    () =>
      usesDueDatePeriod
        ? billingDueDateFilterDescription(dueDateFilter, todayYmd, orgPayoutSchedule)
        : billingCreatedAtFilterDescription(createdAtFilter),
    [usesDueDatePeriod, dueDateFilter, todayYmd, orgPayoutSchedule, createdAtFilter],
  );

  const totals = useMemo(() => {
    let readyDueSum = 0;
    let overdueSum = 0;
    let totalPayableSum = 0;
    let totalReadyCount = 0;
    let totalOverdueCount = 0;
    for (const sb of selfBills) {
      if (isSelfBillPayoutVoided(sb)) continue;
      const due = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
      const ready = selfBillCountsAsReady(sb) && !isSelfBillOverdue(sb, todayYmd);
      const overdue = isSelfBillOverdue(sb, todayYmd);
      if (ready) {
        totalPayableSum += due;
        totalReadyCount++;
        if (selfBillPassesDueDateFilter(sb, dueDateBounds)) readyDueSum += due;
      }
      if (overdue) {
        totalPayableSum += due;
        totalOverdueCount++;
        if (selfBillPassesDueDateFilter(sb, dueDateBounds)) overdueSum += due;
      }
    }
    const readyCount = selfBills.filter(
      (sb) =>
        selfBillCountsAsReady(sb) &&
        !isSelfBillOverdue(sb, todayYmd) &&
        selfBillPassesDueDateFilter(sb, dueDateBounds),
    ).length;
    const overdueCount = selfBills.filter(
      (sb) => isSelfBillOverdue(sb, todayYmd) && selfBillPassesDueDateFilter(sb, dueDateBounds),
    ).length;
    // Avg payout per week: group non-voided partner self-bills by week_label, average the net_payout per week
    const weekMap = new Map<string, number>();
    for (const sb of selfBills) {
      if (isSelfBillPayoutVoided(sb) || !isPartnerFieldBill(sb)) continue;
      const wk = sb.week_label ?? sb.period ?? "?";
      weekMap.set(wk, (weekMap.get(wk) ?? 0) + Number(sb.net_payout ?? 0));
    }
    const avgPerWeek = weekMap.size > 0
      ? [...weekMap.values()].reduce((s, v) => s + v, 0) / weekMap.size
      : 0;
    return {
      readyCount,
      readyDueSum,
      overdueCount,
      overdueSum,
      totalPayableSum,
      totalReadyCount,
      totalOverdueCount,
      avgPerWeek,
    };
  }, [selfBills, jobsBySelfBillId, partnerPaidByJobId, todayYmd, dueDateBounds]);

  const updateSbStatus = async (id: string, newStatus: string) => {
    const supabase = getSupabase();
    const { error } = await supabase.from("self_bills").update({ status: newStatus }).eq("id", id);
    if (error) throw error;
  };

  const refreshDrawer = (id: string, newStatus: string) => {
    setDrawerSelfBill((prev) => prev?.id === id ? { ...prev, status: newStatus as SelfBill["status"] } : prev);
  };

  const handleMarkReadyToPay = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "ready_to_pay");
      toast.success("Marked ready to pay");
      refreshDrawer(sb.id, "ready_to_pay");
      loadData();
    } catch { toast.error("Failed to update status"); }
  };

  const handleMarkPaid = async (sb: SelfBill) => {
    try {
      const amount = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
      await markSelfBillsPaid([sb.id]);
      toast.success(`Marked paid · ${formatCurrency(amount)}`);
      refreshDrawer(sb.id, "paid");
      loadData();
    } catch { toast.error("Failed to mark as paid"); }
  };

  const handleReopenSelfBill = async (sb: SelfBill) => {
    try {
      await updateSbStatus(sb.id, "ready_to_pay");
      toast.success("Self-bill reopened");
      refreshDrawer(sb.id, "ready_to_pay");
      loadData();
    } catch { toast.error("Failed to reopen"); }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0 || bulkSaving || emailSending) return;
    const eligible = getBulkEligibleIds();
    if (eligible.length === 0) {
      toast.error("Selected self-bills include void records — remove them from the selection.");
      return;
    }
    if (eligible.length < selectedIds.size) toast.message(`${selectedIds.size - eligible.length} void self-bill(s) skipped`);
    setBulkSaving(true);
    const supabase = getSupabase();
    try {
      if (newStatus === "paid") {
        const totalDue = eligible.reduce((sum, id) => {
          const sb = selfBills.find((s) => s.id === id);
          if (!sb) return sum;
          return sum + computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
        }, 0);
        await markSelfBillsPaid(eligible);
        toast.success(`Marked ${eligible.length} paid · ${formatCurrency(totalDue)}`);
      } else {
        const { error } = await supabase.from("self_bills").update({ status: newStatus }).in("id", eligible);
        if (error) throw error;
        toast.success(`${eligible.length} self-bill(s) updated`);
      }
      setSelectedIds(new Set());
      loadData();
    } catch {
      toast.error("Failed to update self-bills");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleSelectAllInView = useCallback(() => {
    const ids = filteredSorted
      .filter((sb) => !isSelfBillPayoutVoided(sb))
      .map((sb) => sb.id);
    setSelectedIds(new Set(ids));
    if (ids.length === 0) toast.message("Nothing to select in this view");
  }, [filteredSorted]);

  const handleMarkPaidForIds = useCallback(
    async (ids: string[]) => {
      const eligible = ids.filter((id) => {
        const sb = selfBills.find((s) => s.id === id);
        return sb && !isSelfBillPayoutVoided(sb);
      });
      if (eligible.length === 0) {
        toast.error("No payable self-bills in this group");
        return;
      }
      if (bulkSaving) return;
      setBulkSaving(true);
      try {
        const totalDue = eligible.reduce((sum, id) => {
          const sb = selfBills.find((s) => s.id === id);
          if (!sb) return sum;
          return sum + computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
        }, 0);
        await markSelfBillsPaid(eligible);
        toast.success(`Marked ${eligible.length} paid · ${formatCurrency(totalDue)}`);
        setSelectedIds(new Set());
        loadData();
      } catch {
        toast.error("Failed to mark as paid");
      } finally {
        setBulkSaving(false);
      }
    },
    [selfBills, jobsBySelfBillId, partnerPaidByJobId, bulkSaving, loadData],
  );

  const handleBulkSendEmail = async () => {
    if (selectedIds.size === 0 || bulkSaving || emailSending) return;
    const eligible = getBulkEligibleIds({ forEmail: true });
    if (eligible.length === 0) {
      toast.error("No partner field self-bills with a linked partner in this selection.");
      return;
    }
    if (eligible.length < selectedIds.size) {
      toast.message(`${selectedIds.size - eligible.length} skipped (internal, void, or no partner)`);
    }
    if (eligible.length > 5 && !window.confirm(`Send ${eligible.length} self-bill PDFs by email?`)) return;
    setEmailSending(true);
    try {
      const res = await fetch("/api/self-bills/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfBillIds: eligible }),
      });
      const data = (await res.json()) as {
        sent?: number;
        skipped?: { id: string; reference?: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to send emails");
      const sent = data.sent ?? 0;
      const skipped = data.skipped ?? [];
      if (sent > 0) toast.success(`${sent} email${sent === 1 ? "" : "s"} sent`);
      if (skipped.length > 0) {
        toast.message(
          `${skipped.length} skipped: ${skipped.slice(0, 3).map((s) => s.reference ?? s.reason).join(", ")}${skipped.length > 3 ? "…" : ""}`,
        );
      }
      if (sent > 0 && skipped.length === 0) setSelectedIds(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send emails");
    } finally {
      setEmailSending(false);
    }
  };

  const handleBulkCancel = async () => {
    if (selectedIds.size === 0 || bulkSaving || emailSending) return;
    setBulkSaving(true);
    const eligible = getBulkEligibleIds().filter((id) => {
      const sb = selfBills.find((s) => s.id === id);
      return sb && sb.status !== "paid";
    });
    if (eligible.length === 0) {
      toast.error("Selected self-bills are already void or paid.");
      setBulkSaving(false);
      return;
    }
    if (eligible.length < selectedIds.size) toast.message(`${selectedIds.size - eligible.length} self-bill(s) skipped`);
    if (!window.confirm(`Cancel ${eligible.length} self-bill(s)? They can be reopened later.`)) {
      setBulkSaving(false);
      return;
    }
    try {
      await cancelSelfBillsByIds(eligible);
      toast.success(`${eligible.length} self-bill(s) cancelled`);
      setSelectedIds(new Set());
      loadData();
    } catch (e) {
      console.error("Bulk cancel self-bills failed:", e);
      toast.error("Failed to cancel self-bills");
    } finally {
      setBulkSaving(false);
    }
  };

  const openEdit = (sb: SelfBill) => {
    setEditSelfBill(sb);
    setEditForm({ job_value: String(sb.job_value ?? 0), materials: String(sb.materials ?? 0), commission: String(sb.commission ?? 0) });
  };

  const saveEdit = async () => {
    if (!editSelfBill) return;
    const jv = Number(editForm.job_value) || 0;
    const mat = Number(editForm.materials) || 0;
    const comm = Number(editForm.commission) || 0;
    const net = jv + mat - comm;
    setSavingEdit(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("self_bills").update({ job_value: jv, materials: mat, commission: comm, net_payout: net }).eq("id", editSelfBill.id);
      if (error) throw error;
      toast.success("Totals updated");
      setEditSelfBill(null);
      loadData();
    } catch { toast.error("Failed to save"); } finally { setSavingEdit(false); }
  };

  const openDrawer = async (sb: SelfBill) => {
    setLoadingJobs(true);
    setDrawerSelfBill(sb);
    setDrawerJobs([]);
    try {
      const jobs = await listJobsForSelfBill(sb.id);
      setDrawerJobs(jobs);
    } catch { toast.error("Failed to load jobs"); } finally { setLoadingJobs(false); }
  };

  useEffect(() => {
    if (!autoOpenSbId || autoOpenFiredRef.current || selfBills.length === 0) return;
    const match = selfBills.find((sb) => sb.id === autoOpenSbId);
    if (!match) return;
    autoOpenFiredRef.current = true;
    void openDrawer(match);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSbId, selfBills]);

  const reloadLinkedJobsAndPartnerPaid = useCallback(async () => {
    const ids = selfBills.map((sb) => sb.id);
    try {
      const { map, partnerPaidByJobId: paid } = await computeLinkedJobsMapsForSelfBillIds(ids);
      setJobsBySelfBillId(map);
      setPartnerPaidByJobId(paid);
    } catch (e) {
      console.error("Self-bill linked jobs load failed", e);
      setJobsBySelfBillId({});
      setPartnerPaidByJobId({});
      toast.error(e instanceof Error ? e.message : "Failed to load jobs");
    }
  }, [selfBills]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = [
        ...new Set([
          ...filteredSorted.map((sb) => sb.id),
          ...(drawerSelfBill?.id ? [drawerSelfBill.id] : []),
        ]),
      ];
      if (ids.length === 0) return;
      try {
        const { map, partnerPaidByJobId: paid } = await computeLinkedJobsMapsForSelfBillIds(ids);
        if (cancelled) return;
        setJobsBySelfBillId((prev) => ({ ...prev, ...map }));
        setPartnerPaidByJobId((prev) => ({ ...prev, ...paid }));

        const partnerIds = [
          ...new Set(
            filteredSorted.map((sb) => sb.partner_id?.trim()).filter((x): x is string => Boolean(x)),
          ),
        ];
        if (partnerIds.length > 0) {
          const supabase = getSupabase();
          const termsPatch: Record<string, string | null> = {};
          const CHUNK = 80;
          for (let i = 0; i < partnerIds.length; i += CHUNK) {
            const { data } = await supabase
              .from("partners")
              .select("id, payment_terms")
              .in("id", partnerIds.slice(i, i + CHUNK));
            for (const row of data ?? []) {
              const pr = row as { id: string; payment_terms?: string | null };
              termsPatch[pr.id] = pr.payment_terms?.trim() || null;
            }
          }
          if (!cancelled) setPartnerTermsById((prev) => ({ ...prev, ...termsPatch }));
        }
      } catch (e) {
        console.error("Self-bill linked jobs load failed", e);
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load jobs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filteredSorted, drawerSelfBill?.id]);

  const handleExportCsv = useCallback(() => {
    const headers = ["Reference", "Partner", "Origin", "Week label", "Week start", "Status", "Net payout", "Amount due", "Jobs count", "Created at"];
    const rows = filtered.map((sb) => {
      const due = computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId);
      return [sb.reference, sb.partner_name, sb.bill_origin ?? "", sb.week_label ?? "", sb.week_start ?? "", sb.status, String(sb.net_payout ?? ""), String(due), String(sb.jobs_count ?? ""), sb.created_at ?? ""];
    });
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `self-bills-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }, [filtered, jobsBySelfBillId, partnerPaidByJobId]);

  const handleFullSync = useCallback(async () => {
    setRecalculating(true);
    try {
      const res = await fetch("/api/admin/selfbills/full-sync", { method: "POST" });
      const data = await res.json().catch(() => ({})) as {
        orphansFound?: number;
        backfilled?: number;
        promoted?: number;
        totalsUpdated?: number;
        dueDatesUpdated?: number;
        errors?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const parts = [
        data.orphansFound ? `${data.orphansFound} orphan job(s) found` : null,
        data.backfilled ? `${data.backfilled} linked` : null,
        data.promoted ? `${data.promoted} promoted` : null,
        data.dueDatesUpdated ? `${data.dueDatesUpdated} due dates updated` : null,
        data.errors ? `${data.errors} error(s)` : null,
      ].filter(Boolean);
      toast.success(`Sync complete — ${parts.length ? parts.join(", ") : "everything up to date"}`);
      void loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setRecalculating(false);
    }
  }, [loadData]);

  const tabs = useMemo(
    () => TAB_ORDER.map((id) => ({ id, label: TAB_LABELS[id], count: tabCounts[id] })),
    [tabCounts],
  );

  const columns: Column<SelfBill>[] = [
    {
      key: "reference",
      label: "Self bill",
      minWidth: "200px",
      cellClassName: "!whitespace-nowrap max-w-[min(260px,36vw)] overflow-hidden align-top",
      render: (item) => (
        <p className="text-sm font-semibold text-text-primary font-mono truncate min-w-0 max-w-full" title={item.reference}>
          {item.reference}
        </p>
      ),
    },
    {
      key: "partner_name",
      label: "Partner",
      render: (item) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={item.partner_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{item.partner_name}</p>
              {item.bill_origin === "internal" && <Badge variant="info" size="sm" className="shrink-0 text-[10px]">Internal</Badge>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "created_at",
      label: "Created at",
      width: "108px",
      render: (item) => (
        <span className="text-sm text-text-secondary whitespace-nowrap">
          {item.created_at ? formatDate(item.created_at) : "—"}
        </span>
      ),
    },
    {
      key: "week_label",
      label: "Work period",
      width: "160px",
      render: (item) => {
        const wk = item.week_label ? `WK${item.week_label.replace(/^\d{4}-W/, "")}` : null;
        const start = item.week_start ? formatDate(item.week_start) : null;
        const end = item.week_end ? formatDate(item.week_end) : null;
        if (!wk && !start) return <span className="text-sm text-text-tertiary">—</span>;
        return (
          <div>
            {wk ? <p className="text-[11px] font-semibold text-text-primary">{wk}</p> : null}
            {start && end ? <p className="text-[11px] text-text-tertiary whitespace-nowrap">{start} → {end}</p> : null}
          </div>
        );
      },
    },
    {
      key: "payment_due",
      label: "Due date",
      width: "108px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) return <span className="text-sm text-text-tertiary whitespace-nowrap">—</span>;
        const due = selfBillDueYmd(item);
        if (!due) return <span className="text-sm text-text-tertiary whitespace-nowrap">—</span>;
        const isOverdue = isSelfBillOverdue(item, todayYmd);
        const weekEnd = item.week_end?.trim() ?? "";
        const terms = item.partner_id ? partnerTermsById[item.partner_id] ?? null : null;
        const source: DueDateSource = weekEnd
          ? inferPartnerDueDateSource(
              due,
              weekEnd,
              terms,
              partnerPayoutStandardTerms,
              partnerPayoutReferenceYmd,
            )
          : "standard";
        return (
          <div className="space-y-0.5">
            <span className={cn("text-sm whitespace-nowrap block", isOverdue ? "font-semibold text-red-600" : "text-text-secondary")}>
              {formatDate(due)}
            </span>
            <span className="text-[10px] font-medium uppercase text-text-tertiary">{dueDateSourceLabel(source)}</span>
          </div>
        );
      },
    },
    {
      key: "jobs_count",
      label: "Jobs",
      align: "center",
      width: "72px",
      render: (item) => {
        const linked = jobsBySelfBillId[item.id]?.length ?? 0;
        const n = linked > 0 ? linked : item.jobs_count;
        return (
          <button type="button" className="text-sm font-semibold text-primary hover:underline tabular-nums" onClick={(e) => { e.stopPropagation(); void openDrawer(item); }}>
            {n}
          </button>
        );
      },
    },
    {
      key: "net_payout",
      label: "To pay",
      align: "right",
      minWidth: "108px",
      render: (item) => (
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(item.net_payout)}</span>
          {isSelfBillPayoutVoided(item) && item.original_net_payout != null && Number(item.original_net_payout) > 0.02
            ? <span className="block text-[10px] text-text-tertiary tabular-nums">Orig. {formatCurrency(Number(item.original_net_payout))}</span>
            : null}
        </div>
      ),
    },
    {
      key: "amount_due",
      label: "Due",
      align: "right",
      minWidth: "112px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) return <span className="text-sm text-text-tertiary">—</span>;
        const due = computeSelfBillAmountDue(item, jobsBySelfBillId[item.id], partnerPaidByJobId);
        return (
          <span className={`text-sm font-semibold tabular-nums ${due > 0.02 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {formatCurrency(due)}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      minWidth: "140px",
      render: (item) => {
        if (isSelfBillPayoutVoided(item)) {
          return (
            <div className="space-y-1 min-w-0">
              <Badge variant="default" size="sm" className="text-[10px]">{SELF_BILL_FINANCE_VOID_LABEL}</Badge>
              <p className="text-[11px] font-medium text-text-primary truncate">{selfBillPartnerStatusLine(item)}</p>
            </div>
          );
        }
        const disp = getSelfBillDisplayStatus(item, todayYmd);
        return <Badge variant={disp.variant} dot size="sm">{disp.label}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      width: "80px",
      cellClassName: "!align-middle",
      render: (item) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {!isSelfBillPayoutVoided(item) && item.status !== "paid" && item.status !== "rejected" ? (
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(item)} title="Edit totals">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <a
            href={`/api/self-bills/${encodeURIComponent(item.id)}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 text-primary hover:text-primary/70"
            title="Download PDF"
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
        </div>
      ),
    },
  ];

  const jobPayoutColumns: Column<{ job: JobLine; sb: SelfBill }>[] = [
    {
      key: "job_ref",
      label: "Job",
      minWidth: "120px",
      render: (row) => (
        <Link href={`/jobs/${row.job.id}`} className="text-sm font-semibold font-mono text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {row.job.reference}
        </Link>
      ),
    },
    {
      key: "partner",
      label: "Partner",
      render: (row) => <span className="text-sm text-text-primary truncate">{row.sb.partner_name}</span>,
    },
    {
      key: "payable",
      label: "Payable",
      width: "120px",
      render: (row) => {
        const due = selfBillDueYmd(row.sb);
        const weekEnd = row.sb.week_end?.trim() ?? "";
        const terms = row.sb.partner_id ? partnerTermsById[row.sb.partner_id] ?? null : null;
        const source = weekEnd
          ? inferPartnerDueDateSource(
              due,
              weekEnd,
              terms,
              partnerPayoutStandardTerms,
              partnerPayoutReferenceYmd,
            )
          : "standard";
        return (
          <div>
            <span className="text-sm text-text-secondary">{due ? formatDate(due) : "—"}</span>
            <span className="block text-[10px] uppercase text-text-tertiary">{dueDateSourceLabel(source)}</span>
          </div>
        );
      },
    },
    {
      key: "job_due",
      label: "Job due",
      align: "right",
      render: (row) => {
        const cap = jobLinePartnerGross(row.job);
        const paid = partnerPaidByJobId[row.job.id] ?? 0;
        const due = Math.max(0, cap - paid);
        return <span className="text-sm font-semibold tabular-nums text-amber-600">{formatCurrency(due)}</span>;
      },
    },
    {
      key: "self_bill",
      label: "Self bill",
      render: (row) => (
        <button type="button" className="text-xs font-mono text-primary hover:underline" onClick={(e) => { e.stopPropagation(); void openDrawer(row.sb); }}>
          {row.sb.reference}
        </button>
      ),
    },
  ];

  return (
    <PageTransition>
      <BillingPageActions>
        <Button
          variant="outline"
          size="sm"
          icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
          onClick={() => void loadData()}
          title="Reload self-bills from the server"
        >
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={<RefreshCw className={cn("h-3.5 w-3.5", recalculating && "animate-spin")} />}
          loading={recalculating}
          onClick={() => void handleFullSync()}
          title="Sync self-bills: backfill missing jobs, promote statuses, recalc due dates from Setup standard"
        >
          Sync
        </Button>
        <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCsv}>
          Export
        </Button>
      </BillingPageActions>
      <div className="space-y-5">
        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Total to pay</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.totalPayableSum)}</p>
              <p className="text-[11px] text-text-secondary">
                {totals.totalReadyCount} ready + {totals.totalOverdueCount} overdue
              </p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-400">
              <Wallet className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <button type="button" className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5 text-left hover:border-border transition-colors" onClick={() => setActiveTab("ready_to_pay")}>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Ready to Pay</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.readyDueSum)}</p>
              <p className="text-[11px] text-text-secondary">{totals.readyCount} self-bill{totals.readyCount !== 1 ? "s" : ""} · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
              <DollarSign className="h-4 w-4" aria-hidden />
            </div>
          </button>
          <button type="button" className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5 text-left hover:border-border transition-colors" onClick={() => setActiveTab("overdue")}>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Overdue</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-red-600">{formatCurrency(totals.overdueSum)}</p>
              <p className="text-[11px] text-text-secondary">{totals.overdueCount} past due · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-600">
              <AlertTriangle className="h-4 w-4" aria-hidden />
            </div>
          </button>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Weekly run rate</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(totals.avgPerWeek)}</p>
              <p className="text-[11px] text-text-secondary">Avg payout per week · {kpiPeriodDesc}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
              <TrendingUp className="h-4 w-4" aria-hidden />
            </div>
          </div>
        </div>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as SelfBillTab)} />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {usesDueDatePeriod ? (
                <BillingDueDateFilter
                  value={dueDateFilter}
                  onChange={setDueDateFilter}
                  todayYmd={todayYmd}
                  orgSchedule={orgPayoutSchedule}
                />
              ) : null}
              <SearchInput
                placeholder="Search name, ref, week…"
                className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Source">
                {([{ id: "all", label: "All" }, { id: "partner", label: "Partners" }, { id: "internal", label: "Internal" }] as const).map(({ id, label }) => (
                  <button key={id} type="button" className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${originFilter === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`} onClick={() => setOriginFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Layout">
                <button type="button" className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${layoutMode === "cards" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`} onClick={() => setLayoutMode("cards")}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Cards
                </button>
                <button type="button" className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${layoutMode === "table" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary"}`} onClick={() => setLayoutMode("table")}>
                  <List className="h-3.5 w-3.5" />
                  Table
                </button>
              </div>
              {layoutMode === "table" && activeTab === "ready_to_pay" && listGroupMode === "flat" ? (
                <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="Payout rows">
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold",
                      payoutListMode === "self_bill" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary",
                    )}
                    onClick={() => setPayoutListMode("self_bill")}
                  >
                    Self bills
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold",
                      payoutListMode === "by_job" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary",
                    )}
                    onClick={() => setPayoutListMode("by_job")}
                  >
                    By job
                  </button>
                </div>
              ) : null}
              {layoutMode === "table" ? (
                <div className="flex rounded-lg border border-border-light p-0.5 bg-surface-tertiary" title="List layout">
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold",
                      listGroupMode === "grouped" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary",
                    )}
                    onClick={() => setListGroupMode("grouped")}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Grouped
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold",
                      listGroupMode === "flat" ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary",
                    )}
                    onClick={() => setListGroupMode("flat")}
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                    List
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Tab summary bar */}
          {!loading && filtered.length > 0 ? (
            <div className="flex items-center justify-end gap-x-5 rounded-[10px] border border-border-light bg-card px-4 py-2.5">
              <div className="flex flex-1 items-center gap-3 text-[11px] font-medium text-text-tertiary">
                <span>
                  {filtered.length} self-bill{filtered.length !== 1 ? "s" : ""}
                </span>
                {(activeTab === "ready_to_pay" || activeTab === "overdue") && layoutMode === "table" ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-primary hover:underline"
                    onClick={() => handleSelectAllInView()}
                  >
                    Select all in view
                  </button>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Amount Due</p>
                <p className="text-sm font-semibold tabular-nums text-[#ED4B00]">
                  {formatCurrency(filtered.reduce((s, sb) => s + computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId), 0))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Net Payout</p>
                <p className="text-sm font-semibold tabular-nums text-[#020040] dark:text-text-primary">
                  {formatCurrency(filtered.filter((sb) => !isSelfBillPayoutVoided(sb)).reduce((s, sb) => s + Number(sb.net_payout ?? 0), 0))}
                </p>
              </div>
            </div>
          ) : null}

          {showPayoutBulkBar ? (
            <SelfBillPayoutBulkBar
              count={selectedIds.size}
              bulkSaving={bulkSaving}
              emailSending={emailSending}
              onMarkPaid={() => void handleBulkStatusChange("paid")}
              onSendEmail={() => void handleBulkSendEmail()}
              onCancel={() => void handleBulkCancel()}
              onClear={() => setSelectedIds(new Set())}
            />
          ) : null}

          {layoutMode === "cards" ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {loading ? (
                <p className="text-sm text-text-tertiary col-span-full py-10 text-center">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-text-tertiary col-span-full py-10 text-center">No self-bills in this view.</p>
              ) : (
                filteredSorted.map((sb) => (
                  <SelfBillCard
                    key={sb.id}
                    sb={sb}
                    jobs={jobsBySelfBillId[sb.id] ?? []}
                    partnerPaidByJobId={partnerPaidByJobId}
                    todayYmd={todayYmd}
                    onOpenDrawer={() => void openDrawer(sb)}
                    onMarkReadyToPay={() => void handleMarkReadyToPay(sb)}
                    onMarkPaid={() => void handleMarkPaid(sb)}
                    onEdit={() => openEdit(sb)}
                  />
                ))
              )}
            </div>
          ) : layoutMode === "table" && payoutListMode === "by_job" && listGroupMode === "flat" && activeTab === "ready_to_pay" ? (
            <DataTable
              columns={jobPayoutColumns}
              data={jobPayoutRows}
              getRowId={(row) => row.job.id}
              loading={loading}
              page={1}
              totalPages={1}
              totalItems={jobPayoutRows.length}
              emptyMessage="No payable jobs in this period."
              onRowClick={(row) => void openDrawer(row.sb)}
              tableClassName="min-w-[1100px]"
            />
          ) : layoutMode === "table" && listGroupMode === "grouped" ? (
            <SelfBillWeekGroupedTable
              columns={columns}
              filtered={filteredSorted}
              loading={loading}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={(item) => void openDrawer(item)}
              handleBulkStatusChange={handleBulkStatusChange}
              handleBulkCancel={handleBulkCancel}
              handleMarkPaidForIds={handleMarkPaidForIds}
              groupBy={usesDueDatePeriod ? "due_date" : "created_at"}
              jobsBySelfBillId={jobsBySelfBillId}
              partnerPaidByJobId={partnerPaidByJobId}
            />
          ) : (
            <DataTable
              columns={columns}
              data={filteredSorted}
              getRowId={(item) => item.id}
              loading={loading}
              page={1}
              totalPages={1}
              totalItems={filteredSorted.length}
              emptyMessage="No self-bills in this view."
              onRowClick={(item) => void openDrawer(item)}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              tableClassName="min-w-[1220px]"
              bulkActions={
                activeTab !== "overdue" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                    <BulkBtn label="Ready to pay" onClick={() => void handleBulkStatusChange("ready_to_pay")} variant="info" />
                    <BulkBtn label="Mark paid" onClick={() => void handleBulkStatusChange("paid")} variant="success" />
                    <BulkBtn label="Cancel" onClick={() => void handleBulkCancel()} variant="danger" />
                  </div>
                ) : undefined
              }
            />
          )}
        </motion.div>
      </div>

      <SelfBillDetailDrawer
        sb={drawerSelfBill}
        jobs={drawerJobs}
        loadingJobs={loadingJobs}
        partnerPaidByJobId={partnerPaidByJobId}
        todayYmd={todayYmd}
        onClose={() => setDrawerSelfBill(null)}
        onMarkReadyToPay={() => drawerSelfBill && void handleMarkReadyToPay(drawerSelfBill)}
        onMarkPaid={() => drawerSelfBill && void handleMarkPaid(drawerSelfBill)}
        onReopen={() => drawerSelfBill && void handleReopenSelfBill(drawerSelfBill)}
        onRefresh={() => loadData()}
        onEditTotals={() => drawerSelfBill && openEdit(drawerSelfBill)}
        onPartnerPaymentsRecorded={reloadLinkedJobsAndPartnerPaid}
      />

      <Modal open={!!editSelfBill} onClose={() => setEditSelfBill(null)} title="Edit self-bill totals" subtitle="Adjust labour, materials, or commission if figures need correction." size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Labour (job value)</label>
              <Input type="number" step="0.01" value={editForm.job_value} onChange={(e) => setEditForm((f) => ({ ...f, job_value: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Materials</label>
              <Input type="number" step="0.01" value={editForm.materials} onChange={(e) => setEditForm((f) => ({ ...f, materials: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Commission</label>
              <Input type="number" step="0.01" value={editForm.commission} onChange={(e) => setEditForm((f) => ({ ...f, commission: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-text-tertiary">
            Net payout = labour + materials − commission:{" "}
            <strong className="text-text-primary tabular-nums">
              {formatCurrency((Number(editForm.job_value) || 0) + (Number(editForm.materials) || 0) - (Number(editForm.commission) || 0))}
            </strong>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setEditSelfBill(null)}>Cancel</Button>
            <Button type="button" loading={savingEdit} onClick={() => void saveEdit()}>Save</Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}

// ── Self-bill detail drawer ────────────────────────────────────────────────────

export function SelfBillDetailDrawer({
  sb,
  jobs,
  loadingJobs,
  partnerPaidByJobId,
  todayYmd,
  onClose,
  onMarkReadyToPay,
  onMarkPaid,
  onReopen,
  onRefresh,
  onEditTotals,
  onPartnerPaymentsRecorded,
}: {
  sb: SelfBill | null;
  jobs: Awaited<ReturnType<typeof listJobsForSelfBill>>;
  loadingJobs: boolean;
  partnerPaidByJobId: Record<string, number>;
  todayYmd: string;
  onClose: () => void;
  onMarkReadyToPay: () => void;
  onMarkPaid: () => void;
  onReopen: () => void;
  /** Reload parent data after cancel / due-date edit (must not reopen the self-bill). */
  onRefresh?: () => void | Promise<void>;
  onEditTotals: () => void;
  /** Refresh job↔partner paid rollup after inserting `job_payments` (partner). */
  onPartnerPaymentsRecorded?: () => void | Promise<void>;
}) {
  const { profile } = useProfile();
  const [tab, setTab] = useState<"details" | "jobs" | "invoices" | "payment" | "activity">("details");
  const [dueDateModalOpen, setDueDateModalOpen] = useState(false);
  const [dueDateValue, setDueDateValue] = useState("");
  const [dueDateReason, setDueDateReason] = useState("");
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [linkedInvoices, setLinkedInvoices] = useState<Array<{ id: string; reference: string; amount: number; status: string; due_date?: string | null; job_reference?: string | null }>>([]);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const [recordPartnerPayOpen, setRecordPartnerPayOpen] = useState(false);
  const [recordPaySaving, setRecordPaySaving] = useState(false);
  const [recordPayJobId, setRecordPayJobId] = useState("");
  const [recordPayAmount, setRecordPayAmount] = useState("");
  const [recordPayDate, setRecordPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recordPayMethod, setRecordPayMethod] = useState<JobPaymentMethod>("bank_transfer");
  const [recordPayLedger, setRecordPayLedger] = useState("");
  const [recordPayNote, setRecordPayNote] = useState("");
  const [installments, setInstallments] = useState<SelfBillPaymentInstallment[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);
  const [payoutPlanEditorOpen, setPayoutPlanEditorOpen] = useState(false);
  const [payoutPlanRows, setPayoutPlanRows] = useState<PaymentPlanEditorRow[]>([]);
  const [savingPayoutPlan, setSavingPayoutPlan] = useState(false);
  const [markingInstallmentId, setMarkingInstallmentId] = useState<string | null>(null);
  const [payingFullPayout, setPayingFullPayout] = useState(false);
  const [partnerPaymentTerms, setPartnerPaymentTerms] = useState<string | null>(null);
  const { partnerPayoutStandardTerms, partnerPayoutReferenceYmd } = useFrontendSetup();
  const paymentOrgCtx = useMemo(
    () => orgCtxFromSetup({ partnerPayoutStandardTerms, partnerPayoutReferenceYmd }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

  const openRecordPartnerPayModal = () => {
    const first =
      jobs.find((j) => jobContributesToSelfBillPayout(j))?.id ??
      jobs[0]?.id ??
      "";
    setRecordPayJobId(first);
    setRecordPayAmount("");
    setRecordPayDate(new Date().toISOString().slice(0, 10));
    setRecordPayMethod("bank_transfer");
    setRecordPayLedger("");
    setRecordPayNote("");
    setRecordPartnerPayOpen(true);
  };

  const handleSubmitRecordPartnerPayment = async () => {
    if (!sb || sb.bill_origin === "internal") return;
    const jobId = recordPayJobId.trim();
    if (!jobId) {
      toast.error("Select a job.");
      return;
    }
    const amount = Number(recordPayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    setRecordPaySaving(true);
    try {
      const job = await getJob(jobId);
      if (!job) {
        toast.error("Job not found — refresh and try again.");
        return;
      }
      if (!job.partner_id?.trim()) {
        toast.error("Assign a partner on the job before recording a payout.");
        return;
      }
      const payments = await listJobPayments(jobId);
      const customerPayments = payments.filter((p) => p.type === "customer_deposit" || p.type === "customer_final");
      const partnerPayments = payments.filter((p) => p.type === "partner");
      await executeJobMoneyAction({
        job,
        mode: "partner_pay",
        amount: Math.round(amount * 100) / 100,
        paymentDate: recordPayDate.trim() || new Date().toISOString().slice(0, 10),
        method: recordPayMethod,
        note: recordPayNote.trim() || "Recorded from weekly self-bill",
        customerPayments,
        partnerPayments,
        ...(recordPayLedger.trim() ? { paymentLedgerLabel: recordPayLedger.trim() } : {}),
        actorUserId: profile?.id,
        actorUserName: profile?.full_name ?? undefined,
      });
      toast.success("Partner payment recorded — it appears on the job and in Paid to date.");
      setRecordPartnerPayOpen(false);
      await onPartnerPaymentsRecorded?.();
      if (sb.payment_plan_active) {
        const paidTotal =
          jobs.reduce((sum, j) => sum + Number(partnerPaidByJobId[j.id] ?? 0), 0) + Math.round(amount * 100) / 100;
        await syncSelfBillPaymentPlanFromPartnerPaid(sb.id, paidTotal);
        const refreshed = await listInstallmentsForSelfBill(sb.id);
        setInstallments(refreshed);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setRecordPaySaving(false);
    }
  };

  // Reset when a new self-bill is opened
  const prevSbId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sb && sb.id !== prevSbId.current) {
      setTab("details");
      setLinkedInvoices([]);
      setCancelModalOpen(false);
      setDueDateModalOpen(false);
      setJobsExpanded(false);
      setRecordPartnerPayOpen(false);
      setInstallments([]);
      setPayoutPlanEditorOpen(false);
      setPayoutPlanRows([]);
      prevSbId.current = sb.id;
    }
  }, [sb]);

  useEffect(() => {
    if (!sb) return;
    let cancelled = false;
    setLoadingInstallments(true);
    const paidTotal = jobs.reduce((sum, j) => sum + Number(partnerPaidByJobId[j.id] ?? 0), 0);
    void listInstallmentsForSelfBill(sb.id)
      .then(async (rows) => {
        if (cancelled) return;
        setInstallments(rows);
        if (paidTotal > 0.02) {
          await syncSelfBillPaymentPlanFromPartnerPaid(sb.id, paidTotal);
          if (!cancelled) {
            const refreshed = await listInstallmentsForSelfBill(sb.id);
            setInstallments(refreshed);
          }
        }
      })
      .catch(() => { if (!cancelled) setInstallments([]); })
      .finally(() => { if (!cancelled) setLoadingInstallments(false); });

    const pid = sb.partner_id?.trim();
    if (pid) {
      void getSupabase()
        .from("partners")
        .select("payment_terms")
        .eq("id", pid)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) {
            setPartnerPaymentTerms((data as { payment_terms?: string | null } | null)?.payment_terms ?? null);
          }
        });
    } else {
      setPartnerPaymentTerms(null);
    }
  }, [sb?.id, jobs, partnerPaidByJobId]);

  const handleOpenPayoutPlanEditor = () => {
    if (!sb) return;
    const total = Math.max(0, Number(sb.net_payout ?? 0));
    const drafts = defaultSelfBillPayoutPlanRows(total, 4, {
      partnerTerms: partnerPaymentTerms,
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    });
    setPayoutPlanRows(
      drafts.map((d) => ({ ...emptyPaymentPlanRow(d.due_date), amount: d.amount, due_date: d.due_date })),
    );
    setPayoutPlanEditorOpen(true);
  };

  const handleSavePayoutPlan = async () => {
    if (!sb) return;
    setSavingPayoutPlan(true);
    try {
      const rows = await createSelfBillPaymentPlan(
        sb.id,
        Number(sb.net_payout ?? 0),
        payoutPlanRows.map(({ amount, due_date }) => ({ amount, due_date })),
      );
      setInstallments(rows);
      setPayoutPlanEditorOpen(false);
      toast.success("Payout plan saved");
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save payout plan");
    } finally {
      setSavingPayoutPlan(false);
    }
  };

  const handleCancelPayoutPlan = async () => {
    if (!sb) return;
    try {
      await cancelSelfBillPaymentPlan(sb.id);
      setInstallments([]);
      toast.success("Payout plan removed");
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove plan");
    }
  };

  const handleMarkPayoutInstallmentPaid = async (installmentId: string) => {
    if (!sb) return;
    setMarkingInstallmentId(installmentId);
    try {
      const { installments: updated } = await markSelfBillInstallmentPaid(installmentId, sb);
      setInstallments(updated);
      toast.success("Installment marked paid");
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark installment paid");
    } finally {
      setMarkingInstallmentId(null);
    }
  };

  const handlePayFullPayoutPlan = async () => {
    if (!sb) return;
    setPayingFullPayout(true);
    try {
      const { installments: updated } = await markAllSelfBillInstallmentsPaid(sb);
      setInstallments(updated);
      toast.success("All installments marked paid");
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to pay full balance");
    } finally {
      setPayingFullPayout(false);
    }
  };

  // Fetch linked invoices whenever jobs change
  useEffect(() => {
    if (!sb) return;
    const refs = jobs.map((j) => (j as unknown as { reference?: string }).reference).filter(Boolean) as string[];
    if (refs.length === 0) { setLinkedInvoices([]); return; }
    const supabase = getSupabase();
    void supabase
      .from("invoices")
      .select("id, reference, amount, status, due_date, job_reference")
      .in("job_reference", refs)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setLinkedInvoices((data ?? []) as typeof linkedInvoices);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb?.id, jobs.length]);

  const handleSaveDueDate = async () => {
    if (!sb) return;
    const trimmed = dueDateValue.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) { toast.error("Invalid date format."); return; }
    if (dueDateReason.trim().length < 10) { toast.error("Reason must be at least 10 characters."); return; }
    setSavingDueDate(true);
    try {
      const res = await fetch(`/api/self-bills/${sb.id}/due-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: trimmed, reason: dueDateReason.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to update");
      }
      toast.success("Due date updated.");
      setDueDateModalOpen(false);
      if (onRefresh) await onRefresh();
      else onReopen();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update due date");
    } finally {
      setSavingDueDate(false);
    }
  };

  const handleCancelSelfBill = async () => {
    if (!sb) return;
    setCancelSaving(true);
    try {
      await cancelSelfBillsByIds([sb.id]);
      toast.success("Self-bill cancelled.");
      setCancelModalOpen(false);
      if (onRefresh) await onRefresh();
      else onReopen();
    } catch (e) {
      console.error("Cancel self-bill failed:", e);
      toast.error("Failed to cancel self-bill.");
    } finally {
      setCancelSaving(false);
    }
  };

  if (!sb) return <Drawer open={false} onClose={onClose}>{null}</Drawer>;

  const voided = isSelfBillPayoutVoided(sb);
  const origSnap = sb.original_net_payout != null && Number(sb.original_net_payout) > 0.02 ? Number(sb.original_net_payout) : null;
  const dueYmd = !voided
    ? selfBillEffectiveDueYmd(sb, installments, dueCtxForPartner(sb.partner_id))
    : "";
  const overdue = !voided && isSelfBillOverdue(sb, todayYmd);
  const disp = getSelfBillDisplayStatus(sb, todayYmd);
  const totalPaidToDate = jobs.reduce((sum, j) => sum + Number(partnerPaidByJobId[j.id] ?? 0), 0);
  const sheetDue = voided ? 0 : (() => {
    if (sb.bill_origin === "internal") return Math.max(0, Number(sb.net_payout ?? 0));
    let due = 0;
    for (const j of jobs) {
      if (!jobContributesToSelfBillPayout(j)) continue;
      const cap = jobLinePartnerGross(j);
      const paid = partnerPaidByJobId[j.id] ?? 0;
      due += Math.max(0, cap - paid);
    }
    return Math.round(due * 100) / 100;
  })();
  const grossTotal = Math.round((Number(sb.job_value ?? 0) + Number(sb.materials ?? 0)) * 100) / 100;
  const workforceBreakdown = sb.bill_origin === "internal" ? sb.payout_breakdown : null;

  const drawerTabs: Array<{ id: "details" | "jobs" | "invoices" | "payment" | "activity"; label: string; count?: number }> = [
    { id: "details", label: "Details" },
    { id: "jobs", label: "Jobs", count: jobs.length },
    { id: "invoices", label: "Invoices", count: linkedInvoices.length || undefined },
    { id: "payment", label: "Payment" },
    { id: "activity", label: "Activity" },
  ];

  const isDraft = DRAFT_DB_STATUSES.has(sb.status);
  const isReady = selfBillCountsAsReady(sb);
  const isPaid = sb.status === "paid";
  const isRejected = sb.status === "rejected" || voided;
  const canTransition = !isPaid && !isRejected && !voided;

  /** Field partners only — excludes internal payroll rows, void, paid bundle, cancelled. */
  const showRecordPartnerPayment = sb.bill_origin !== "internal" && !voided && !isPaid && sb.status !== "rejected";

  const recordPaySelectedJobLine = jobs.find((j) => j.id === recordPayJobId);
  const recordPayCapRemainder =
    recordPaySelectedJobLine && jobContributesToSelfBillPayout(recordPaySelectedJobLine)
      ? Math.round(
          Math.max(
            0,
            jobLinePartnerGross(recordPaySelectedJobLine) -
              (partnerPaidByJobId[recordPaySelectedJobLine.id] ?? 0),
          ) * 100,
        ) / 100
      : null;

  // Status tone — same pattern as InvoiceDetailDrawer
  const statusTone = isPaid
    ? { bg: "#EFF7F3", border: "#9FE1CB", text: "#0F6E56", dot: "#0F6E56" }
    : overdue
      ? { bg: "#FEF5F3", border: "#F5BFBF", text: "#A32D2D", dot: "#A32D2D" }
      : isRejected
          ? { bg: "#F5F5F7", border: "#D8D8DD", text: "#6B6B70", dot: "#6B6B70" }
          : isDraft
            ? { bg: "#FFF8F3", border: "#F5CFB8", text: "#ED4B00", dot: "#ED4B00" }
            : { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8", dot: "#2563EB" };

  const statusSub = dueYmd
    ? overdue
      ? `Due ${formatDate(dueYmd)} · Payment overdue`
      : isPaid
        ? `Paid`
        : `Due ${formatDate(dueYmd)}`
    : `Created ${formatDate(sb.created_at)}`;

  const footerBtnClass =
    "min-h-9 flex-1 min-w-[7rem] basis-[calc(50%-0.25rem)] sm:basis-auto sm:max-w-[11rem] !flex-nowrap items-center justify-center text-center leading-none";

  const cancelBtnClass =
    "inline-flex min-h-9 flex-1 min-w-[7rem] basis-[calc(50%-0.25rem)] sm:basis-auto sm:max-w-[11rem] items-center justify-center gap-1.5 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium leading-none text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400";

  const cancelButton = canTransition ? (
    <button
      type="button"
      onClick={() => {
        setCancelReason("");
        setCancelModalOpen(true);
      }}
      className={cancelBtnClass}
      title="Cancel self-bill (does not affect job or invoice)"
    >
      <Ban className="h-3.5 w-3.5 shrink-0" /> Cancel
    </button>
  ) : null;

  const footer = tab === "details" ? (
    <div className="px-4 pb-3 pt-2.5 space-y-2">
      <div className="flex w-full flex-wrap items-stretch justify-center gap-2">
        {isPaid ? (
          <Button
            variant="outline"
            size="sm"
            className={footerBtnClass}
            icon={<RotateCcw className="h-3.5 w-3.5 shrink-0" />}
            onClick={onReopen}
          >
            Reopen self-bill
          </Button>
        ) : isRejected ? null : isDraft ? (
          <>
            <Button
              variant="success"
              size="sm"
              className={footerBtnClass}
              icon={<Check className="h-3.5 w-3.5 shrink-0" />}
              onClick={onMarkReadyToPay}
            >
              Mark Ready to Pay
            </Button>
            {cancelButton}
          </>
        ) : isReady ? (
          <>
            {showRecordPartnerPayment && jobs.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className={footerBtnClass}
                icon={<Plus className="h-3.5 w-3.5 shrink-0" />}
                onClick={openRecordPartnerPayModal}
              >
                Partner payment
              </Button>
            ) : null}
            {overdue ? (
              <Button
                variant="danger"
                size="sm"
                className={footerBtnClass}
                icon={<AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                onClick={() => toast.error("Escalate flow — coming soon.")}
              >
                Escalate
              </Button>
            ) : null}
            <Button
              variant="success"
              size="sm"
              className={footerBtnClass}
              icon={<Check className="h-3.5 w-3.5 shrink-0" />}
              onClick={onMarkPaid}
            >
              Mark as paid
            </Button>
            {cancelButton}
          </>
        ) : null}
      </div>
      {isDraft && showRecordPartnerPayment && jobs.length > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full min-h-9 !flex-nowrap items-center justify-center text-center leading-none"
          icon={<Plus className="h-3.5 w-3.5 shrink-0" />}
          onClick={openRecordPartnerPayModal}
        >
          Partner payment — partial / advance
        </Button>
      ) : null}
    </div>
  ) : undefined;

  return (
    <Drawer
      open
      onClose={onClose}
      title={sb.reference ?? sb.partner_name}
      width="w-[540px]"
      headerExtra={(
        <div className="text-[11px] text-text-secondary leading-snug">
          {sb.week_label || sb.week_start ? (
            <span className="font-medium">
              {sb.week_label ? `WK${sb.week_label.replace(/^\d{4}-W/, "")}` : ""}
              {sb.week_start ? ` · ${formatDate(sb.week_start)}` : ""}
              {sb.week_end ? ` → ${formatDate(sb.week_end)}` : ""}
            </span>
          ) : null}
          {dueYmd ? (
            <span className={cn("ml-2", overdue ? "font-semibold text-red-600" : "text-text-tertiary")}>
              · Due {formatDate(dueYmd)}
            </span>
          ) : null}
        </div>
      )}
      footer={footer}
    >
      <div className="min-h-full bg-surface-hover/50">
        {/* Partner card */}
        <div className="px-[22px] pb-4 pt-4">
          <div
            className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface-hover/50 px-4 py-[14px]"
            style={{ boxShadow: "0 1px 3px rgba(10,13,46,0.04)" }}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Avatar name={sb.partner_name} size="md" className="shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-text-primary">{sb.partner_name}</p>
                <p className="text-[11px] text-text-secondary">
                  {sb.bill_origin === "internal" ? "Internal partner" : "Field partner"}
                </p>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  {sb.bill_origin === "internal" ? "Internal · Payroll" : "Partner payout"}{sb.week_label ? ` · ${sb.week_label}` : ""}
                </p>
              </div>
            </div>
            <a href={`/partners?search=${encodeURIComponent(sb.partner_name ?? "")}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] font-semibold text-primary">View ↗</a>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border px-[22px]">
          <div className="w-full min-w-0 overflow-x-auto [scrollbar-width:thin]">
          <div className="inline-flex flex-nowrap items-stretch gap-0">
            {drawerTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "relative shrink-0 whitespace-nowrap px-4 py-2.5 text-left text-sm transition-colors",
                  tab === item.id ? "font-semibold text-[#ED4B00]" : "font-medium text-text-secondary",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {item.label}
                  {item.count !== undefined ? (
                    <span className="rounded-md bg-[#F0F2F7] px-1.5 py-0.5 text-[10px] font-semibold text-text-tertiary">
                      {item.count}
                    </span>
                  ) : null}
                </span>
                {tab === item.id ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ED4B00]" /> : null}
              </button>
            ))}
          </div>
          </div>
        </div>

        {/* ── Details tab ── */}
        {tab === "details" ? (
          <div className="space-y-4 p-[22px]">
            {/* Status row — same pattern as InvoiceDetailDrawer */}
            <div
              className="rounded-[6px]"
              style={{ backgroundColor: statusTone.bg, border: `0.5px solid ${statusTone.border}`, padding: "10px 12px" }}
            >
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: statusTone.dot }} />
                  <span className="shrink-0 text-[12px] font-semibold" style={{ color: statusTone.text }}>{disp.label}</span>
                  <span className="h-[10px] w-px shrink-0" style={{ backgroundColor: statusTone.border }} />
                  <div className="flex min-w-0 items-center gap-1 group/due">
                    <p className="min-w-0 truncate text-[11px] font-medium text-[#1C1917]">{statusSub}</p>
                    <button
                      type="button"
                      onClick={() => { setDueDateValue(dueYmd || new Date().toISOString().slice(0, 10)); setDueDateReason(""); setDueDateModalOpen(true); }}
                      className="shrink-0 rounded border border-border bg-white px-1 py-0.5 text-[9px] font-medium text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
                      title="Edit due date"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular-nums text-[13px] font-semibold text-[#1C1917]">{formatCurrency(sheetDue)}</p>
                  <p className="text-[10px] text-text-tertiary">No VAT · Partner payout</p>
                </div>
              </div>
            </div>

            {/* Labour / Materials / Net Payout breakdown */}
            <div>
              <div className="rounded-t-[10px] border border-border border-b-0 bg-card">
                <div className="grid grid-cols-3 divide-x divide-border">
                  <div className="px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Labour</p>
                    <p className="mt-1 text-[22px] font-semibold text-text-primary">{formatCurrency(sb.job_value)}</p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Materials</p>
                    <p className="mt-1 text-[22px] font-semibold text-text-primary">{formatCurrency(sb.materials)}</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Net Payout</p>
                    <p className="mt-1 text-[22px] font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(sb.net_payout)}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-b-[10px] border border-border bg-surface-hover/50 px-3 py-[7px] text-[11px]">
                <span className="text-text-secondary">
                  {sb.week_label ? `Week ${sb.week_label}` : ""}
                  {dueYmd ? ` · Due ${formatDate(dueYmd)}` : ""}
                </span>
                <button type="button" className="font-semibold text-primary">View Pay Run ↗</button>
              </div>
            </div>

            {/* Jobs preview — accordion, shows 3 then expand */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary">Jobs ({jobs.length})</p>
                <button type="button" className="text-[12px] font-semibold text-primary">+ Link job</button>
              </div>
              <div className="rounded-[10px] border border-border bg-surface-hover/50 overflow-hidden">
                {loadingJobs ? (
                  <div className="space-y-1.5 p-3">
                    <div className="h-10 rounded-lg bg-surface-hover animate-pulse" />
                    <div className="h-10 rounded-lg bg-surface-hover animate-pulse" />
                    <div className="h-10 rounded-lg bg-surface-hover animate-pulse" />
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-[13px] text-text-secondary">No jobs linked yet</p>
                    <p className="mt-1 text-[11px] text-text-tertiary">Jobs completed this week will appear automatically.</p>
                  </div>
                ) : (() => {
                  const invByRef = new Map(linkedInvoices.map((inv) => [inv.job_reference, inv]));
                  const visible = jobsExpanded ? jobs : jobs.slice(0, 3);
                  const hidden = jobs.length - 3;
                  return (
                    <>
                      <div className="divide-y divide-border-light">
                        {visible.map((j) => (
                          <div key={j.id} className="px-3 py-2">
                            <CompactJobCard j={j} partnerPaid={partnerPaidByJobId[j.id] ?? 0} matchedInvoice={invByRef.get(j.reference) ?? null} />
                          </div>
                        ))}
                      </div>
                      {hidden > 0 ? (
                        <button
                          type="button"
                          className="w-full border-t border-border-light py-2 text-center text-[11px] font-semibold text-primary hover:bg-surface-hover/60 transition-colors"
                          onClick={() => jobsExpanded ? setTab("jobs") : setJobsExpanded(true)}
                        >
                          {jobsExpanded ? `See all ${jobs.length} in Jobs tab →` : `+ ${hidden} more job${hidden !== 1 ? "s" : ""}`}
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>


            {/* Self-bill breakdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary">Self-bill Breakdown</p>
                {canTransition ? (
                  <button type="button" className="text-[11px] text-text-tertiary hover:text-primary" onClick={onEditTotals}>
                    <Pencil className="inline h-3 w-3 mr-1" />Edit
                  </button>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-[10px] border border-border bg-surface-hover/50">
                <div className="flex items-center justify-between border-b border-border px-3 py-3">
                  <p className="text-[13px] font-semibold text-text-primary">• {sb.bill_origin === "internal" ? "Fixed pay" : "Labour"}</p>
                  <p className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(sb.job_value)}</p>
                </div>
                {workforceBreakdown && Number(workforceBreakdown.commission_amount) > 0 ? (
                  <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                    <p className="text-[12px] text-text-secondary">
                      • Commission ({workforceBreakdown.commission_rate_percent}% on{" "}
                      {workforceBreakdown.commission_basis === "revenue" ? "revenue" : "gross margin"})
                    </p>
                    <p className="text-[12px] text-emerald-700 tabular-nums">+{formatCurrency(Number(workforceBreakdown.commission_amount))}</p>
                  </div>
                ) : null}
                {workforceBreakdown?.jobs?.length ? (
                  <div className="border-b border-border px-3 py-2 space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-text-tertiary">Owner jobs</p>
                    {workforceBreakdown.jobs.map((j) => (
                      <div key={j.job_id} className="flex justify-between text-[11px] text-text-secondary">
                        <span>{j.reference}</span>
                        <span className="tabular-nums">{formatCurrency(j.commission)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {sb.bill_origin !== "internal" ? (
                <div className="flex items-center justify-between border-b border-border px-3 py-3">
                  <p className="text-[13px] font-semibold text-text-primary">• Materials</p>
                  <p className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(sb.materials)}</p>
                </div>
                ) : null}
                {Number(sb.commission) > 0 && sb.bill_origin !== "internal" ? (
                  <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                    <p className="text-[12px] text-text-secondary">• Commission deduction</p>
                    <p className="text-[12px] text-red-600 tabular-nums">−{formatCurrency(sb.commission)}</p>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2.5">
                  <p className="text-[12px] text-text-secondary">Gross total</p>
                  <p className="text-[12px] text-text-primary tabular-nums">{formatCurrency(grossTotal)}</p>
                </div>
                <div className="flex items-center justify-between bg-[#020040] px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-white">Net payout to partner</p>
                  <p className="text-[15px] font-semibold text-white tabular-nums">{formatCurrency(sb.net_payout)}</p>
                </div>
              </div>
            </div>

            {/* Payment status */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary">Payment Status</p>
              <div className="rounded-[10px] border border-border bg-surface-hover/50 px-3 py-2">
                <div className="space-y-1 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">Net payout</span>
                    <span className="tabular-nums text-text-primary">{formatCurrency(sb.net_payout)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">Paid to date</span>
                    <span className="tabular-nums text-text-primary">{formatCurrency(totalPaidToDate)}</span>
                  </div>
                  {origSnap != null ? (
                    <div className="flex items-center justify-between">
                      <span className="text-text-secondary">Original amount</span>
                      <span className="tabular-nums text-text-secondary">{formatCurrency(origSnap)}</span>
                    </div>
                  ) : null}
                  <div className="my-1 border-t border-border" />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary">Due to partner</span>
                    <span className={cn("font-semibold tabular-nums", sheetDue > 0.02 ? "text-[#ED4B00]" : "text-emerald-700 dark:text-emerald-400")}>
                      {formatCurrency(sheetDue)}
                    </span>
                  </div>
                </div>
              </div>
              {showRecordPartnerPayment && jobs.length > 0 ? (
                <Button variant="outline" size="sm" className="w-full" icon={<Plus className="h-3.5 w-3.5 shrink-0" />} onClick={openRecordPartnerPayModal}>
                  Record partner payment (shows on job)
                </Button>
              ) : null}
            </div>

            {/* Void info */}
            {voided ? (
              <div className="rounded-[10px] border border-amber-200 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-950/20 px-3 py-3 text-[12px] space-y-1">
                <p className="font-semibold text-amber-800 dark:text-amber-300">{SELF_BILL_FINANCE_VOID_LABEL}</p>
                <p className="text-text-secondary">{selfBillPartnerStatusLine(sb)}</p>
                {sb.payout_void_reason ? <p className="text-text-tertiary">{sb.payout_void_reason}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Jobs tab ── */}
        {tab === "jobs" ? (
          <div className="space-y-3 p-[22px]">
            {/* P&L inline in Jobs tab */}
            {(() => {
              const revenue = linkedInvoices.reduce((s, inv) => s + Number(inv.amount ?? 0), 0);
              const cost = Number(sb.net_payout ?? 0);
              const profit = revenue - cost;
              const margin = revenue > 0.01 ? Math.round((profit / revenue) * 100) : null;
              if (revenue < 0.01) return null;
              return (
                <div>
                  <div className="rounded-t-[10px] border border-border border-b-0 bg-card">
                    <div className="grid grid-cols-3 divide-x divide-border">
                      <div className="px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-text-tertiary">Revenue</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-text-primary">{formatCurrency(revenue)}</p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-text-tertiary">Cost</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-text-primary">{formatCurrency(cost)}</p>
                      </div>
                      <div className={cn("px-3 py-2", profit > 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/20")}>
                        <p className="text-[10px] font-semibold uppercase text-text-tertiary">Profit</p>
                        <p className={cn("mt-0.5 text-[13px] font-semibold", profit > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{formatCurrency(profit)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-b-[10px] border border-border bg-surface-hover/50 px-3 py-[6px] text-[11px]">
                    <span className="text-text-tertiary">{linkedInvoices.length} invoice{linkedInvoices.length !== 1 ? "s" : ""} · invoiced revenue</span>
                    {margin !== null ? (
                      <span className={cn("font-semibold tabular-nums", margin >= 20 ? "text-emerald-700" : margin >= 0 ? "text-amber-700" : "text-red-600")}>
                        {margin}% margin
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })()}
            {loadingJobs ? (
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
                <div className="h-16 rounded-xl bg-surface-hover animate-pulse" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="rounded-[10px] border border-border bg-surface-hover/50 px-4 py-6 text-center">
                <p className="text-sm text-text-tertiary">No jobs linked to this self-bill.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((j) => <JobRow key={j.id} j={j} partnerPaid={partnerPaidByJobId[j.id] ?? 0} />)}
              </div>
            )}
          </div>
        ) : null}

        {/* ── Invoices tab ── */}
        {tab === "invoices" ? (
          <div className="space-y-3 p-[22px]">
            {linkedInvoices.length === 0 ? (
              <div className="rounded-[10px] border border-border bg-surface-hover/50 px-4 py-6 text-center">
                <Receipt className="mx-auto h-5 w-5 text-text-tertiary mb-2" />
                <p className="text-sm text-text-tertiary">No invoices linked to this self-bill yet.</p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {linkedInvoices.map((inv) => {
                    const isPaidInv = inv.status === "paid";
                    return (
                      <div key={inv.id} className="flex items-center justify-between rounded-[10px] border border-border bg-card px-3 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", isPaidInv ? "bg-emerald-500" : inv.status === "overdue" ? "bg-red-500" : "bg-amber-400")} />
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-text-primary truncate">{inv.reference}</p>
                            {inv.job_reference ? <p className="text-[11px] text-text-tertiary">{inv.job_reference}</p> : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[13px] font-semibold tabular-nums text-text-primary">{formatCurrency(inv.amount)}</p>
                          <p className="text-[11px] text-text-tertiary capitalize">{isPaidInv ? "Paid" : inv.status.replace("_", " ")}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between rounded-[8px] bg-surface-hover/50 px-3 py-2 text-[11px]">
                  <span className="text-text-secondary">{linkedInvoices.length} invoice{linkedInvoices.length !== 1 ? "s" : ""} total</span>
                  <span className="font-semibold tabular-nums text-text-primary">
                    {formatCurrency(linkedInvoices.reduce((s, inv) => s + Number(inv.amount ?? 0), 0))}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* ── Payment tab ── */}
        {tab === "payment" ? (
          <div className="space-y-4 p-[22px]">
            <div className="rounded-[10px] border border-border bg-surface-hover/50 p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Payment Summary</p>
              <div className="space-y-2 text-[13px]">
                {[
                  { label: "Net payout", value: formatCurrency(sb.net_payout) },
                  { label: "Paid to date", value: formatCurrency(totalPaidToDate) },
                  { label: "Outstanding", value: formatCurrency(sheetDue), highlight: sheetDue > 0.02 },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-text-secondary">{label}</span>
                    <span className={cn("font-semibold tabular-nums", highlight ? "text-[#ED4B00]" : "text-text-primary")}>{value}</span>
                  </div>
                ))}
              </div>
              {dueYmd ? (
                <p className="text-[11px] text-text-secondary">
                  Payment due: <span className={cn("font-semibold", overdue ? "text-red-600" : "text-text-primary")}>{formatDate(dueYmd)}</span>
                  {overdue ? " · Overdue" : ""}
                </p>
              ) : null}
            </div>

            {!voided && sb.bill_origin !== "internal" ? (
              <div className="rounded-[10px] border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                    Payout plan
                  </p>
                  {selfBillPaymentPlanProgressLabel(installments) ? (
                    <span className="text-[11px] font-medium text-text-secondary">
                      {selfBillPaymentPlanProgressLabel(installments)}
                    </span>
                  ) : null}
                </div>
                {loadingInstallments ? (
                  <p className="text-xs text-text-tertiary flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading installments…
                  </p>
                ) : null}
                {payoutPlanEditorOpen ? (
                  <div className="space-y-2">
                    <PaymentPlanEditor
                      enabled
                      onEnabledChange={() => {}}
                      rows={payoutPlanRows}
                      onRowsChange={setPayoutPlanRows}
                      totalAmount={Number(sb.net_payout ?? 0)}
                      accountPaymentTerms={partnerPaymentTerms}
                      orgCtx={paymentOrgCtx}
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void handleSavePayoutPlan()} disabled={savingPayoutPlan}>
                        {savingPayoutPlan ? "Saving…" : "Save plan"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setPayoutPlanEditorOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : installments.length > 0 ? (
                  <>
                    {!isPaid && nextOpenSelfBillInstallment(installments) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={payingFullPayout}
                        onClick={() => void handlePayFullPayoutPlan()}
                      >
                        {payingFullPayout ? "Paying…" : `Pay full balance (${formatCurrency(sheetDue)})`}
                      </Button>
                    ) : null}
                    <div className="divide-y divide-border rounded-lg border border-border-light overflow-hidden">
                      {installments.map((inst) => (
                        <div key={inst.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                          <span className="w-5 tabular-nums text-text-tertiary">{inst.sequence}</span>
                          <span className="font-medium tabular-nums">{formatCurrency(inst.amount)}</span>
                          <span className="text-text-secondary">{formatDate(inst.due_date)}</span>
                          <Badge variant={inst.status === "paid" ? "success" : inst.status === "pending" ? "warning" : "default"}>
                            {inst.status}
                          </Badge>
                          {inst.status === "pending" && !isPaid ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={markingInstallmentId === inst.id}
                              onClick={() => void handleMarkPayoutInstallmentPaid(inst.id)}
                            >
                              {markingInstallmentId === inst.id ? "…" : "This installment"}
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                ) : !isPaid ? (
                  <Button type="button" variant="ghost" size="sm" onClick={handleOpenPayoutPlanEditor}>
                    Create payout plan
                  </Button>
                ) : null}
                {installments.length > 0 && !isPaid && !installments.some((i) => i.status === "paid") ? (
                  <button
                    type="button"
                    className="text-[11px] text-text-tertiary hover:text-red-600"
                    onClick={() => void handleCancelPayoutPlan()}
                  >
                    Remove plan
                  </button>
                ) : null}
              </div>
            ) : null}

            {showRecordPartnerPayment && jobs.length > 0 ? (
              <div className="rounded-[10px] border border-border bg-card p-4 space-y-3">
                <p className="text-[12px] text-text-secondary leading-snug">
                  Log bank transfers against the underlying job — totals flow into <span className="font-medium text-text-primary">Paid to date</span> here and mirror on the job&apos;s Finance summary.
                </p>
                <Button variant="success" size="sm" className="w-full" icon={<Plus className="h-3.5 w-3.5 shrink-0" />} onClick={openRecordPartnerPayModal}>
                  Record partner payment
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Activity tab ── */}
        {tab === "activity" ? (
          <div className="rounded-[10px] border border-border bg-surface-hover/50 m-[22px] p-4 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Activity</p>
            {[
              `Created ${formatDate(sb.created_at)}`,
              dueYmd ? `Due date: ${formatDate(dueYmd)}` : "Due date pending",
              `Current status: ${disp.label}`,
              voided && origSnap != null ? `Original amount: ${formatCurrency(origSnap)}` : null,
              voided ? `Void reason: ${selfBillPartnerStatusLine(sb)}` : null,
              sb.payout_void_reason ? `Note: ${sb.payout_void_reason}` : null,
            ].filter(Boolean).map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" />
                <p className="text-[13px] text-text-primary">{item}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Modal
        open={recordPartnerPayOpen}
        onClose={() => {
          if (!recordPaySaving) setRecordPartnerPayOpen(false);
        }}
        title="Record partner payment"
        subtitle="Logs cash sent to the partner on the chosen job — works in Draft, Ready to Pay, overdue, or audit."
        size="sm"
      >
        <div className="p-5 space-y-4">
          {jobs.length === 0 ? (
            <p className="text-sm text-text-tertiary">Load jobs linked to this self-bill before recording payouts.</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Job</label>
                <select
                  value={recordPayJobId}
                  onChange={(e) => setRecordPayJobId(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-card px-3 text-sm text-text-primary"
                >
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.reference}{j.property_address?.trim() ? ` — ${j.property_address.trim().slice(0, 52)}${j.property_address.trim().length > 52 ? "…" : ""}` : ""}
                    </option>
                  ))}
                </select>
                {recordPayJobId ? (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    <Link href={`/jobs/${recordPayJobId}`} className="font-semibold text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      Open job Finance summary ↗
                    </Link>
                    {recordPayCapRemainder != null ? (
                      <span className="text-text-tertiary">
                        Remaining vs labour cap:{" "}
                        <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(recordPayCapRemainder)}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {recordPayLedger && partnerPayLedgerBypassesPartnerCap(recordPayLedger) ? (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-2 leading-snug">
                    With this classification you can pay above the usual cap remainder (e.g. forwarding a client deposit).
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount (£)</label>
                <Input type="number" min={0} step="0.01" value={recordPayAmount} onChange={(e) => setRecordPayAmount(e.target.value)} className="h-10" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Payment date</label>
                <Input type="date" value={recordPayDate} onChange={(e) => setRecordPayDate(e.target.value)} className="h-10" />
              </div>
              <Select
                label="Method"
                value={recordPayMethod}
                onChange={(e) => setRecordPayMethod(e.target.value as JobPaymentMethod)}
                className="h-10"
                options={[
                  { value: "bank_transfer", label: "Bank transfer" },
                  { value: "cash", label: "Cash" },
                  { value: "other", label: "Other" },
                ]}
              />
              <Select
                label="Classification (optional)"
                value={recordPayLedger}
                onChange={(e) => setRecordPayLedger(e.target.value)}
                className="h-10"
                options={PARTNER_PAY_LEDGER_LABEL_OPTIONS}
              />
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Note</label>
                <Input value={recordPayNote} onChange={(e) => setRecordPayNote(e.target.value)} placeholder="e.g. Client deposit forwarded" className="h-10" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" type="button" disabled={recordPaySaving} onClick={() => setRecordPartnerPayOpen(false)}>
                  Cancel
                </Button>
                <Button variant="success" size="sm" type="button" loading={recordPaySaving} onClick={() => void handleSubmitRecordPartnerPayment()}>
                  Save
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Edit due date modal ── */}
      <Modal
        open={dueDateModalOpen}
        onClose={() => setDueDateModalOpen(false)}
        title="Edit due date"
        subtitle="Any status. Audit trail is recorded."
        size="sm"
      >
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">New due date</label>
            <Input type="date" value={dueDateValue} onChange={(e) => setDueDateValue(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Reason <span className="text-text-tertiary">(min 10 chars)</span></label>
            <Input
              placeholder="e.g. Partner requested extension"
              value={dueDateReason}
              onChange={(e) => setDueDateReason(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setDueDateModalOpen(false)}>Cancel</Button>
            <Button size="sm" loading={savingDueDate} onClick={() => void handleSaveDueDate()}>Save due date</Button>
          </div>
        </div>
      </Modal>

      {/* ── Cancel self-bill modal ── */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancel self-bill"
        subtitle="The linked job and invoice will not be affected."
        size="sm"
      >
        <div className="p-5 space-y-4">
          <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
            This will mark the self-bill as <strong>cancelled</strong>. It can be reopened later.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCancelModalOpen(false)}>Keep it</Button>
            <Button variant="danger" size="sm" loading={cancelSaving} onClick={() => void handleCancelSelfBill()}>
              <span className="inline-flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Cancel self-bill</span>
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}

// ── Card view ──────────────────────────────────────────────────────────────────

function SelfBillCard({
  sb,
  jobs,
  partnerPaidByJobId,
  todayYmd,
  onOpenDrawer,
  onMarkReadyToPay,
  onMarkPaid,
  onEdit,
}: {
  sb: SelfBill;
  jobs: JobLine[];
  partnerPaidByJobId: Record<string, number>;
  todayYmd: string;
  onOpenDrawer: () => void;
  onMarkReadyToPay: () => void;
  onMarkPaid: () => void;
  onEdit: () => void;
}) {
  const voided = isSelfBillPayoutVoided(sb);
  const disp = getSelfBillDisplayStatus(sb, todayYmd);
  const dueYmd = selfBillDueYmd(sb);
  const amountDue = voided ? 0 : computeSelfBillAmountDue(sb, jobs, partnerPaidByJobId);

  return (
    <div
      className="rounded-2xl border border-border-light bg-card shadow-sm overflow-hidden flex flex-col cursor-pointer hover:border-border transition-colors"
      onClick={onOpenDrawer}
    >
      <div className="p-4 border-b border-border-light bg-surface-hover/40 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={sb.partner_name} size="md" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-text-primary truncate">{sb.partner_name}</p>
              {sb.bill_origin === "internal" && <Badge variant="info" size="sm" className="text-[10px]">Internal</Badge>}
            </div>
            <p className="text-[11px] text-text-tertiary font-mono truncate">{sb.reference} · {sb.week_label ?? sb.period}</p>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Created {formatDate(sb.created_at)}{dueYmd ? ` · Due ${formatDate(dueYmd)}` : ""}
            </p>
          </div>
        </div>
        <Badge variant={disp.variant} dot size="sm">{disp.label}</Badge>
      </div>

      <div className="px-4 py-3 grid grid-cols-4 gap-3 text-center border-b border-border-light/80 bg-background/50">
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Labour</p>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(sb.job_value)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Materials</p>
          <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatCurrency(sb.materials)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Net Payout</p>
          <p className="text-sm font-bold tabular-nums text-text-primary">{formatCurrency(sb.net_payout)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-text-tertiary">Amount Due</p>
          <p className={cn("text-sm font-bold tabular-nums", amountDue > 0.02 ? "text-amber-600" : "text-emerald-600")}>
            {formatCurrency(amountDue)}
          </p>
        </div>
      </div>

      <div className="p-3 border-t border-border-light flex flex-wrap items-center gap-2 justify-between bg-surface-hover/30 mt-auto">
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {DRAFT_DB_STATUSES.has(sb.status) ? (
            <Button size="sm" variant="primary" className="h-8 text-xs" onClick={onMarkReadyToPay}>
              Mark Ready to Pay
            </Button>
          ) : READY_DB_STATUSES.has(sb.status) ? (
            <Button size="sm" variant="primary" className="h-8 text-xs" onClick={onMarkPaid}>
              Mark as Paid
            </Button>
          ) : null}
          {!isSelfBillPayoutVoided(sb) && sb.status !== "paid" && sb.status !== "rejected" ? (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onEdit}>
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          ) : null}
        </div>
        <a
          href={`/api/self-bills/${encodeURIComponent(sb.id)}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
        </a>
      </div>
    </div>
  );
}

// ── Compact job card (preview grid) ──────────────────────────────────────────

function CompactJobCard({
  j,
  partnerPaid,
  matchedInvoice,
}: {
  j: Pick<Job, "id" | "reference" | "title" | "partner_cost" | "partner_agreed_value" | "materials_cost" | "status" | "property_address" | "deleted_at" | "partner_cancelled_at">;
  partnerPaid: number;
  matchedInvoice?: { reference: string; status: string; amount: number } | null;
}) {
  const cap = jobContributesToSelfBillPayout(j) ? jobLinePartnerGross(j) : 0;
  const due = jobContributesToSelfBillPayout(j) ? Math.max(0, Math.round((cap - partnerPaid) * 100) / 100) : 0;
  const invPaid = matchedInvoice?.status === "paid";
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-border-light bg-surface-hover/80 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Link href={`/jobs/${j.id}`} className="text-[12px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5">
            {j.reference}
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          </Link>
          {matchedInvoice ? (
            <span className={cn("text-[10px] font-medium truncate", invPaid ? "text-emerald-600" : "text-text-tertiary")}>
              · {matchedInvoice.reference}
            </span>
          ) : null}
        </div>
        <p className="text-[10px] text-text-tertiary truncate">{j.title}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[12px] font-semibold tabular-nums text-text-primary">{formatCurrency(Number(j.partner_cost) || 0)}</p>
        {due > 0.02 ? (
          <span className="text-[10px] font-semibold text-amber-600 tabular-nums">due {formatCurrency(due)}</span>
        ) : (
          <Badge variant="default" size="sm" className="text-[9px] px-1 py-0">{j.status}</Badge>
        )}
      </div>
    </div>
  );
}

// ── Job row ────────────────────────────────────────────────────────────────────

function JobRow({
  j,
  partnerPaid,
}: {
  j: Pick<
    Job,
    | "id"
    | "reference"
    | "title"
    | "partner_cost"
    | "partner_agreed_value"
    | "materials_cost"
    | "status"
    | "property_address"
    | "deleted_at"
    | "partner_cancelled_at"
  >;
  partnerPaid: number;
}) {
  const payoutNote = selfBillJobPayoutStateLabel(j);
  const cap = jobContributesToSelfBillPayout(j) ? jobLinePartnerGross(j) : 0;
  const due = jobContributesToSelfBillPayout(j) ? Math.max(0, Math.round((cap - partnerPaid) * 100) / 100) : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-border-light bg-surface-hover/80">
      <div className="min-w-0">
        <Link href={`/jobs/${j.id}`} className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
          {j.reference}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </Link>
        <p className="text-xs text-text-secondary truncate">{j.title}</p>
        <p className="text-[11px] text-text-tertiary truncate">{j.property_address}</p>
        {payoutNote ? <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{payoutNote}</p> : null}
      </div>
      <div className="text-right text-xs space-y-0.5">
        <p>Labour <span className="font-semibold tabular-nums">{formatCurrency(Number(j.partner_cost) || 0)}</span></p>
        <p>Mat. <span className="font-semibold tabular-nums">{formatCurrency(Number(j.materials_cost) || 0)}</span></p>
        {jobContributesToSelfBillPayout(j) ? (
          <>
            <p className="text-text-tertiary">Paid <span className="font-semibold tabular-nums text-text-secondary">{formatCurrency(partnerPaid)}</span></p>
            <p className={due > 0.02 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
              Due <span className="tabular-nums">{formatCurrency(due)}</span>
            </p>
          </>
        ) : null}
        <Badge variant="default" size="sm">{j.status}</Badge>
      </div>
    </div>
  );
}

// ── Grouped table (created_at for Draft, due_date for Ready/Overdue) ─────────

function SelfBillWeekGroupedTable({
  columns,
  filtered,
  loading,
  selectedIds,
  onSelectionChange,
  onRowClick,
  handleBulkStatusChange,
  handleBulkCancel,
  handleMarkPaidForIds,
  groupBy,
  jobsBySelfBillId,
  partnerPaidByJobId,
}: {
  columns: Column<SelfBill>[];
  filtered: SelfBill[];
  loading: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onRowClick: (item: SelfBill) => void;
  handleBulkStatusChange: (status: string) => Promise<void>;
  handleBulkCancel: () => Promise<void>;
  handleMarkPaidForIds: (ids: string[]) => Promise<void>;
  groupBy: "created_at" | "due_date";
  jobsBySelfBillId: Record<string, JobLine[]>;
  partnerPaidByJobId: Record<string, number>;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { title: string; subtitle: string | null; rows: SelfBill[] }>();
    for (const sb of filtered) {
      const { key, title, subtitle } =
        groupBy === "due_date" ? selfBillDueWeekGroup(sb) : selfBillCreatedWeekGroup(sb);
      const entry = map.get(key) ?? { title, subtitle, rows: [] };
      entry.rows.push(sb);
      map.set(key, entry);
    }
    const sortRows = (rows: SelfBill[]) => {
      if (groupBy === "due_date") {
        return [...rows].sort((a, b) => {
          const da = selfBillDueYmd(a);
          const db = selfBillDueYmd(b);
          if (da !== db) return da.localeCompare(db);
          return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        });
      }
      return [...rows].sort(
        (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
      );
    };
    return [...map.entries()]
      .map(([key, g]) => ({
        key,
        title: g.title,
        subtitle: g.subtitle,
        rows: sortRows(g.rows),
      }))
      .sort((a, b) => (groupBy === "due_date" ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)));
  }, [filtered, groupBy]);

  if (loading) {
    return (
      <DataTable columns={columns} data={[]} getRowId={(i) => i.id} loading page={1} totalPages={1} totalItems={0} tableClassName="min-w-[900px]" />
    );
  }

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-text-tertiary">No self-bills in this view.</div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(({ key: weekKey, title, subtitle, rows }) => {
        const weekTotal = rows.reduce(
          (s, sb) => s + computeSelfBillAmountDue(sb, jobsBySelfBillId[sb.id], partnerPaidByJobId),
          0,
        );
        const groupIds = new Set(rows.map((r) => r.id));
        const groupSelected = new Set([...selectedIds].filter((id) => groupIds.has(id)));
        const allSelected = groupIds.size > 0 && groupSelected.size === groupIds.size;
        const someSelected = groupSelected.size > 0 && !allSelected;

        function toggleWeek() {
          const next = new Set(selectedIds);
          if (allSelected) {
            groupIds.forEach((id) => next.delete(id));
          } else {
            groupIds.forEach((id) => next.add(id));
          }
          onSelectionChange(next);
        }

        function selectGroup() {
          const next = new Set(selectedIds);
          groupIds.forEach((id) => next.add(id));
          onSelectionChange(next);
        }

        return (
          <div key={weekKey}>
            <div className="flex items-center justify-between px-1 pb-2">
              <button
                type="button"
                className="flex items-center gap-2.5 group"
                onClick={toggleWeek}
                title={allSelected ? "Deselect group" : "Select group"}
              >
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  allSelected ? "border-primary bg-primary" : someSelected ? "border-primary bg-primary/20" : "border-border bg-white group-hover:border-primary/60",
                )}>
                  {allSelected ? (
                    <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : someSelected ? (
                    <span className="h-0.5 w-2 rounded bg-primary block" />
                  ) : null}
                </span>
                <span className="text-[12px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                  {title}
                </span>
                {subtitle ? (
                  <span className="text-[10px] text-text-tertiary whitespace-nowrap">{subtitle}</span>
                ) : null}
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-semibold text-text-tertiary">
                  {rows.length} bill{rows.length !== 1 ? "s" : ""}
                </span>
              </button>
              <div className="flex items-center gap-3">
                {groupBy === "due_date" ? (
                  <button
                    type="button"
                    className="rounded-lg border border-border-light px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:bg-surface-hover transition-colors"
                    onClick={selectGroup}
                  >
                    Select all
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  disabled={rows.length === 0}
                  onClick={() => void handleMarkPaidForIds(rows.map((r) => r.id))}
                >
                  Mark paid · {formatCurrency(weekTotal)}
                </button>
                <span className="text-[13px] font-semibold tabular-nums text-text-primary">{formatCurrency(weekTotal)}</span>
              </div>
            </div>
            <DataTable
              columns={columns}
              data={rows}
              getRowId={(item) => item.id}
              loading={false}
              page={1}
              totalPages={1}
              totalItems={rows.length}
              onRowClick={onRowClick}
              selectable
              selectedIds={groupSelected}
              onSelectionChange={(ids) => {
                const next = new Set(selectedIds);
                groupIds.forEach((id) => next.delete(id));
                ids.forEach((id) => next.add(id));
                onSelectionChange(next);
              }}
              tableClassName="min-w-[900px]"
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Global bulk bar (Ready to Pay / Overdue) ───────────────────────────────────

function SelfBillPayoutBulkBar({
  count,
  bulkSaving,
  emailSending,
  onMarkPaid,
  onSendEmail,
  onCancel,
  onClear,
}: {
  count: number;
  bulkSaving: boolean;
  emailSending: boolean;
  onMarkPaid: () => void;
  onSendEmail: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const busy = bulkSaving || emailSending;
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 shadow-sm backdrop-blur-sm">
      <span className="text-xs font-semibold text-text-primary tabular-nums">
        {count} selected
      </span>
      <BulkBtn
        label={bulkSaving ? "Saving…" : "Mark paid"}
        onClick={onMarkPaid}
        variant="success"
        disabled={busy}
        icon={<Check className="h-3.5 w-3.5" />}
      />
      <BulkBtn
        label={emailSending ? "Sending…" : "Send email"}
        onClick={onSendEmail}
        variant="info"
        disabled={busy}
        icon={<Mail className="h-3.5 w-3.5" />}
      />
      <BulkBtn label="Cancel" onClick={onCancel} variant="danger" disabled={busy} />
      <button
        type="button"
        className="ml-auto text-xs font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline disabled:opacity-50"
        onClick={onClear}
        disabled={busy}
      >
        Clear selection
      </button>
    </div>
  );
}

// ── Bulk action button ─────────────────────────────────────────────────────────

function BulkBtn({
  label,
  onClick,
  variant,
  icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  variant: "success" | "danger" | "warning" | "info" | "default";
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border-amber-200",
    info: "text-blue-700 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 border-blue-200",
    default: "text-text-primary bg-surface-hover hover:bg-surface-tertiary border-border",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors",
        colors[variant],
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
