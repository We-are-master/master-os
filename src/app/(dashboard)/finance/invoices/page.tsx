"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Drawer } from "@/components/ui/drawer";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp, staggerItem } from "@/lib/motion";
import {
  Plus, Download, Receipt, Clock, AlertTriangle, AlertCircle,
  FileText, Send, Calendar, CalendarRange, MapPin, User, Briefcase, ArrowRight, RefreshCw,
  CheckCircle2, XCircle, CreditCard, Building2, Hash, TrendingUp,
  Banknote, RotateCcw, Loader, Loader2, Lock, ChevronDown, ChevronUp, ChevronRight,
  ShieldAlert, CircleAlert, Check, PenLine, Tag, Mail,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { Invoice, InvoiceStatus, Job, JobStatus } from "@/types/database";
import { createInvoice, updateInvoice, type CreateInvoiceInput } from "@/services/invoices";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { reopenInvoiceToPending } from "@/lib/invoice-reopen";
import {
  invoiceBalanceDue,
  invoiceBalanceDueWithJobCustomerPaid,
  invoiceAmountPaid,
} from "@/lib/invoice-balance";
import { recordInvoicePartialPayment } from "@/services/invoice-partial";
import { isJobForcePaid } from "@/lib/job-force-paid";
import { jobBillableRevenue, partnerSelfBillGrossAmount } from "@/lib/job-financials";
import { isLegacyMisclassifiedCustomerPayment } from "@/lib/job-payment-ledger";
import { applyInvoicePeriodBoundsToQuery, getSupabase } from "@/services/base";
import { fetchJobReferencesOverlappingPeriod } from "@/services/job-period-overlap-queries";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import {
  DEFAULT_FINANCE_PERIOD_MODE,
  getFinancePeriodClosedBounds,
  formatFinancePeriodKpiDescription,
  type FinancePeriodMode,
} from "@/lib/finance-period";
import { localYmdBoundsToUtcIso } from "@/lib/schedule-calendar";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { useProfile } from "@/hooks/use-profile";
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal";
import { Modal } from "@/components/ui/modal";
import {
  INVOICE_FINANCE_TAB_ORDER,
  invoiceExpectedDateYmd,
  invoiceFinanceListTodayYmd,
  invoiceIsDerivedOverdue,
  invoiceMatchesFinanceTab,
  isAwaitingPaymentTabStatus,
  type InvoiceFinanceTab,
} from "@/lib/invoice-finance-tab";
import { weekPeriodHelpText } from "@/lib/self-bill-period";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Draft", variant: "default" },
  paid: { label: "Paid", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  partially_paid: { label: "Partial", variant: "info" },
  overdue: { label: "Overdue", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "default" },
  audit_required: { label: "Audit required", variant: "danger" },
};

const PAGE_SIZE = 10;

const PERIOD_HEADER_LABEL: Record<FinancePeriodMode, string> = {
  all: "All",
  day: "Day",
  month: "Month",
  week: "Week",
  range: "Range",
};

function accountHeaderAvatarBg(accountName: string): string {
  const n = accountName.toLowerCase();
  if (n.includes("checkatrade")) return "#185FA5";
  if (n.includes("housekeep")) return "#7F77DD";
  if (n.includes("express")) return "#1D9E75";
  let h = 0;
  for (let i = 0; i < accountName.length; i++) h = (h * 31 + accountName.charCodeAt(i)) >>> 0;
  const hues = [221, 200, 170, 145, 25, 330];
  const hue = hues[h % hues.length];
  return `hsl(${hue} 45% 46%)`;
}

/** Status column — same `Badge` pattern as Requests / DataTable (`statusConfig` + derived overdue). */
function invoiceRowStatusDisplay(
  inv: Invoice,
  todayYmd: string,
): { variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; label: string } {
  if (invoiceIsDerivedOverdue(inv, todayYmd)) {
    return { variant: "danger", label: "Overdue" };
  }
  const cfg = statusConfig[inv.status];
  if (cfg) return { variant: cfg.variant, label: cfg.label };
  return { variant: "default", label: inv.status };
}

function formatExpectedDayMonth(ymd: string): string {
  const [ys, ms, ds] = ymd.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!y || !m || !d) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

/** Whole calendar days from `fromYmd` to `toYmd` (YYYY-MM-DD). */
function calendarDaysDiff(fromYmd: string, toYmd: string): number {
  const p = (s: string) => {
    const [y, mo, d] = s.split("-").map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  return Math.round((p(toYmd) - p(fromYmd)) / 86400000);
}

/** Linked job fields used on the invoices list (status + schedule for columns). */
type InvoiceListJobSnapshot = {
  id: string;
  status: JobStatus;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  property_address?: string | null;
  title?: string | null;
};

async function fetchJobsByReferences(refs: string[]): Promise<Record<string, InvoiceListJobSnapshot>> {
  const map: Record<string, InvoiceListJobSnapshot> = {};
  if (refs.length === 0) return map;
  const supabase = getSupabase();
  const CHUNK = 100;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("jobs")
      .select("id, reference, status, scheduled_date, scheduled_start_at, property_address, title")
      .in("reference", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as {
        id?: string;
        reference?: string | null;
        status?: JobStatus;
        scheduled_date?: string | null;
        scheduled_start_at?: string | null;
        property_address?: string | null;
        title?: string | null;
      };
      const ref = (r.reference ?? "").trim();
      const jid = r.id?.trim();
      if (ref && r.status && jid) {
        map[ref] = {
          id: jid,
          status: r.status,
          scheduled_date: r.scheduled_date,
          scheduled_start_at: r.scheduled_start_at,
          property_address: r.property_address,
          title: r.title,
        };
      }
    }
  }
  return map;
}

function extractPostcode(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.trim().match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})$/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}

/** Same aggregation as `InvoiceDetailDrawer` (customer_deposit + customer_final, minus legacy rows). */
async function fetchCustomerPaidSumByJobIds(jobIds: string[]): Promise<Record<string, number>> {
  const sums: Record<string, number> = {};
  for (const id of jobIds) sums[id] = 0;
  const unique = [...new Set(jobIds.filter(Boolean))];
  if (unique.length === 0) return sums;
  const supabase = getSupabase();
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("job_payments")
      .select("job_id, amount, type, note")
      .in("job_id", chunk)
      .in("type", ["customer_deposit", "customer_final"])
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const p = row as { job_id?: string; amount?: number; type?: string; note?: string | null };
      const jid = p.job_id?.trim();
      if (!jid) continue;
      if (isLegacyMisclassifiedCustomerPayment(p as { type: string; note?: string | null })) continue;
      sums[jid] = (sums[jid] ?? 0) + Number(p.amount ?? 0);
    }
  }
  for (const id of Object.keys(sums)) {
    sums[id] = Math.round(sums[id] * 100) / 100;
  }
  return sums;
}

function invoiceListBalanceDue(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
): number {
  const ref = inv.job_reference?.trim();
  const jid = ref ? jobsByRef[ref]?.id : undefined;
  const ledgerSum = jid !== undefined ? customerPaidByJobId[jid] : undefined;
  return invoiceBalanceDueWithJobCustomerPaid(inv, ledgerSum);
}

/** Collected = invoice amount − list balance due (same job-ledger bridge); `paid` keeps legacy floor at full amount. */
function invoiceListCollectedAmount(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
): number {
  const invAmt = Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100;
  const due = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
  const collected = Math.max(0, Math.round((invAmt - due) * 100) / 100);
  if (inv.status === "paid") {
    return Math.max(collected, invAmt);
  }
  return collected;
}

function jobDateYmdForInvoiceList(job: InvoiceListJobSnapshot | undefined): string | null {
  if (!job) return null;
  const d = job.scheduled_date?.trim();
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const iso = job.scheduled_start_at?.trim();
  if (iso) {
    const slice = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(slice)) return slice;
  }
  return null;
}

/** Date column: job schedule first, then weekly batch week start, then invoice created (local YYYY-MM-DD). */
function displayDateYmdForInvoiceRow(inv: Invoice, job: InvoiceListJobSnapshot | undefined): string | null {
  const fromJob = jobDateYmdForInvoiceList(job);
  if (fromJob) return fromJob;
  const bw = inv.billing_week_start?.trim();
  if (bw && /^\d{4}-\d{2}-\d{2}$/.test(bw)) return bw;
  const c = inv.created_at?.trim();
  if (c) {
    const slice = c.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(slice)) return slice;
  }
  return null;
}

/** Badge labels aligned with Jobs management (short list view). */
const jobStatusColumnConfig: Record<
  string,
  { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }
> = {
  unassigned: { label: "Unassigned", variant: "warning" },
  auto_assigning: { label: "Assigning", variant: "info" },
  scheduled: { label: "Scheduled", variant: "info" },
  late: { label: "Late", variant: "danger" },
  in_progress_phase1: { label: "In progress", variant: "primary" },
  in_progress_phase2: { label: "In progress", variant: "primary" },
  in_progress_phase3: { label: "In progress", variant: "primary" },
  final_check: { label: "Final check", variant: "warning" },
  awaiting_payment: { label: "Awaiting payment", variant: "danger" },
  need_attention: { label: "Need attention", variant: "warning" },
  completed: { label: "Paid & completed", variant: "success" },
  cancelled: { label: "Lost & cancelled", variant: "danger" },
  deleted: { label: "Deleted", variant: "default" },
};

function computeInvoiceKpis(
  all: Invoice[],
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
  todayYmd: string,
) {
  const nonCancelled = all.filter((r) => r.status !== "cancelled");
  const overdue = all.filter(
    (r) => r.status !== "cancelled" && r.status !== "paid" && invoiceIsDerivedOverdue(r, todayYmd),
  );
  const overdueAmount = overdue.reduce((sum, r) => sum + invoiceListBalanceDue(r, jobsByRef, customerPaidByJobId), 0);
  const openStatuses = new Set<Invoice["status"]>(["pending", "partially_paid", "overdue", "draft", "audit_required"]);
  const openInvoices = all.filter((r) => openStatuses.has(r.status));
  const balanceDueOpen = openInvoices.reduce(
    (sum, r) => sum + invoiceListBalanceDue(r, jobsByRef, customerPaidByJobId),
    0,
  );
  const collectedTotal = nonCancelled.reduce(
    (sum, r) => sum + invoiceListCollectedAmount(r, jobsByRef, customerPaidByJobId),
    0,
  );
  const collectedInvoiceCount = nonCancelled.filter(
    (r) => invoiceListCollectedAmount(r, jobsByRef, customerPaidByJobId) > 0.02,
  ).length;
  return {
    balanceDueOpen,
    openInvoiceCount: openInvoices.length,
    overdueAmount,
    overdueCount: overdue.length,
    collectedTotal,
    collectedInvoiceCount,
  };
}

/** Date used for period KPIs and the Date column (weekly batch → billing week; else created). */
function invoiceEffectiveDateValue(inv: Pick<Invoice, "billing_week_start" | "created_at">): string {
  const b = inv.billing_week_start?.trim();
  if (b && /^\d{4}-\d{2}-\d{2}$/.test(b)) return b;
  return inv.created_at;
}

/** Prefer `invoices.source_account_id`; else job → client account; else exact `client_name` match on `clients`. */
function effectiveInvoiceSourceAccountId(
  inv: Pick<Invoice, "source_account_id" | "job_reference" | "client_name">,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): string | null {
  const direct = inv.source_account_id?.trim();
  if (direct) return direct;
  const ref = inv.job_reference?.trim();
  if (ref) {
    const fromJob = jobRefToAccountId[ref]?.trim();
    if (fromJob) return fromJob;
  }
  const cn = inv.client_name?.trim();
  if (cn) {
    const fromName = clientNameToAccountId[cn]?.trim();
    if (fromName) return fromName;
  }
  return null;
}

interface LinkedJob {
  id: string;
  reference: string;
  title: string;
  client_name: string;
  property_address: string;
  partner_id?: string;
  partner_name?: string;
  owner_name?: string;
  internal_notes?: string | null;
  status: string;
  progress: number;
  current_phase: number;
  total_phases: number;
  client_price: number;
  extras_amount?: number | null;
  partner_cost: number;
  partner_agreed_value?: number | null;
  materials_cost: number;
  margin_percent: number;
  scheduled_date?: string;
  completed_date?: string;
  self_bill_id?: string | null;
}

/** Compare fields job→invoice sync may change — avoids a loop when parent replaces `invoice` after an identical refetch. */
function invoiceDrawerSyncSignature(inv: Invoice): string {
  const ap = Math.round(Number(inv.amount_paid ?? 0) * 100);
  const amt = Math.round(Number(inv.amount ?? 0) * 100);
  return [
    inv.status,
    amt,
    ap,
    inv.paid_date ?? "",
    inv.last_payment_date ?? "",
    inv.collection_stage,
    inv.collection_stage_locked ? "1" : "0",
  ].join("|");
}

export default function InvoicesPage() {
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const periodMenuRef = useRef<HTMLDivElement>(null);

  const [financeTab, setFinanceTab] = useState<InvoiceFinanceTab>("awaiting_payment");
  /** When true, list shows only `audit_required` rows (from banner "Review now"). Cleared when changing tab. */
  const [auditFocus, setAuditFocus] = useState(false);
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  /** Soft-deleted rows (same period filter as active); shown only on Deleted tab. */
  const [deletedInvoices, setDeletedInvoices] = useState<Invoice[]>([]);
  const [jobsByRef, setJobsByRef] = useState<Record<string, InvoiceListJobSnapshot>>({});
  /** `jobs.id` → sum(customer_deposit + customer_final), aligned with invoice drawer ledger bridge. */
  const [customerPaidByJobId, setCustomerPaidByJobId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [savingDueDateId, setSavingDueDateId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [accountNameById, setAccountNameById] = useState<Record<string, string>>({});
  /** `accounts.id` → `logo_url` (HTTPS) for group header */
  const [accountLogoById, setAccountLogoById] = useState<Record<string, string | null>>({});
  /** `job_reference` → `accounts.id` via job.client_id → clients.source_account_id */
  const [jobRefToSourceAccountId, setJobRefToSourceAccountId] = useState<Record<string, string>>({});
  /** `clients.full_name` (exact) → `source_account_id` when invoice has no job ref / no stored account */
  const [clientNameToSourceAccountId, setClientNameToSourceAccountId] = useState<Record<string, string>>({});
  const { profile } = useProfile();
  const listTodayYmd = invoiceFinanceListTodayYmd();

  const loadPageData = useCallback(async () => {
    setLoading(true);
    try {
      const bounds = getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor);
      const supabase = getSupabase();
      const chunkSize = 500;

      async function fetchInvoicePages(onlyDeleted: boolean): Promise<Invoice[]> {
        const acc: Invoice[] = [];
        for (let from = 0; from < 100_000; from += chunkSize) {
          let q = supabase.from("invoices").select("*");
          if (onlyDeleted) q = q.not("deleted_at", "is", null);
          else q = q.is("deleted_at", null);
          if (bounds) {
            const { startIso, endIso } = localYmdBoundsToUtcIso(bounds.from, bounds.to);
            q = applyInvoicePeriodBoundsToQuery(q, {
              from: bounds.from,
              to: bounds.to,
              startIso,
              endIso,
            });
          }
          const { data: chunk, error } = await q.order("created_at", { ascending: false }).range(from, from + chunkSize - 1);
          if (error) throw error;
          const rows = (chunk ?? []) as Invoice[];
          if (rows.length === 0) break;
          acc.push(...rows);
          if (rows.length < chunkSize) break;
        }
        return acc;
      }

      async function mergeInvoicesForLinkedJobsInPeriod(
        initial: Invoice[],
        onlyDeleted: boolean,
      ): Promise<Invoice[]> {
        if (!bounds) return initial;
        const byId = new Map(initial.map((i) => [i.id, i]));
        const loadedRefs = new Set(
          initial.map((i) => i.job_reference?.trim()).filter((x): x is string => Boolean(x)),
        );
        const overlappingRefs = await fetchJobReferencesOverlappingPeriod(bounds);
        const needRefs = overlappingRefs.filter((r) => !loadedRefs.has(r));
        if (needRefs.length === 0) return initial;
        const REF_CHUNK = 90;
        for (let i = 0; i < needRefs.length; i += REF_CHUNK) {
          const slice = needRefs.slice(i, i + REF_CHUNK);
          let q = supabase.from("invoices").select("*").in("job_reference", slice);
          if (onlyDeleted) q = q.not("deleted_at", "is", null);
          else q = q.is("deleted_at", null);
          const { data, error } = await q;
          if (error) continue;
          for (const inv of (data ?? []) as Invoice[]) {
            if (!byId.has(inv.id)) byId.set(inv.id, inv);
          }
        }
        return [...byId.values()].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      }

      const [activeRaw, deletedRaw] = await Promise.all([fetchInvoicePages(false), fetchInvoicePages(true)]);
      const [active, deleted] = await Promise.all([
        mergeInvoicesForLinkedJobsInPeriod(activeRaw, false),
        mergeInvoicesForLinkedJobsInPeriod(deletedRaw, true),
      ]);
      const refs = [
        ...new Set(
          [...active, ...deleted].map((inv) => inv.job_reference?.trim()).filter((x): x is string => Boolean(x)),
        ),
      ];
      const jobMap = await fetchJobsByReferences(refs);
      const jobIds = [...new Set(Object.values(jobMap).map((j) => j.id))];
      const paidMap = await fetchCustomerPaidSumByJobIds(jobIds);
      setAllInvoices(active);
      setDeletedInvoices(deleted);
      setJobsByRef(jobMap);
      setCustomerPaidByJobId(paidMap);
    } catch {
      setAllInvoices([]);
      setDeletedInvoices([]);
      setJobsByRef({});
      setCustomerPaidByJobId({});
    } finally {
      setLoading(false);
    }
  }, [periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  useEffect(() => {
    const supabase = getSupabase();
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => void loadPageData(), 350);
    };
    const ch = supabase
      .channel("invoices_finance_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_payments" }, schedule)
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [loadPageData]);

  const kpis = useMemo(
    () => computeInvoiceKpis(allInvoices, jobsByRef, customerPaidByJobId, listTodayYmd),
    [allInvoices, jobsByRef, customerPaidByJobId, listTodayYmd],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<InvoiceFinanceTab, number> = {
      all: allInvoices.filter((inv) => inv.status !== "cancelled").length,
      draft: 0,
      awaiting_payment: 0,
      overdue: 0,
      paid: 0,
      cancelled: 0,
    };
    for (const inv of allInvoices) {
      if (inv.status === "draft") counts.draft += 1;
      else if (inv.status === "paid") counts.paid += 1;
      else if (inv.status === "cancelled") counts.cancelled += 1;
      else if (invoiceIsDerivedOverdue(inv, listTodayYmd)) counts.overdue += 1;
      else if (isAwaitingPaymentTabStatus(inv.status)) counts.awaiting_payment += 1;
    }
    return counts;
  }, [allInvoices, listTodayYmd]);

  const auditQueueCount = useMemo(
    () => allInvoices.filter((inv) => inv.status === "audit_required").length,
    [allInvoices],
  );

  const allInvoicesForAux = useMemo(
    () => [...allInvoices, ...deletedInvoices],
    [allInvoices, deletedInvoices],
  );

  const awaitingPaymentKpi = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const inv of allInvoices) {
      if (!invoiceMatchesFinanceTab(inv, "awaiting_payment")) continue;
      sum += invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
      n += 1;
    }
    return { sum, count: n };
  }, [allInvoices, jobsByRef, customerPaidByJobId, listTodayYmd]);

  /** Open balance KPI: awaiting (tab) + overdue (balance) − collected — aligned with the four summary cards. */
  const openBalanceKpi = useMemo(() => {
    const raw = awaitingPaymentKpi.sum + kpis.overdueAmount - kpis.collectedTotal;
    const amount = Math.round(raw * 100) / 100;
    const countInvoices = awaitingPaymentKpi.count + kpis.overdueCount;
    return { amount, countInvoices };
  }, [awaitingPaymentKpi.sum, awaitingPaymentKpi.count, kpis.overdueAmount, kpis.overdueCount, kpis.collectedTotal]);

  const filteredInvoices = useMemo(() => {
    let rows = allInvoices.filter((inv) => invoiceMatchesFinanceTab(inv, financeTab));
    if (auditFocus) rows = rows.filter((inv) => inv.status === "audit_required");
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (inv) =>
          inv.reference.toLowerCase().includes(q) ||
          inv.client_name.toLowerCase().includes(q) ||
          (inv.job_reference ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [allInvoices, financeTab, auditFocus, search, listTodayYmd]);

  const totalItems = filteredInvoices.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const pagedData = useMemo(() => {
    const p = Math.min(page, totalPages);
    const start = (p - 1) * PAGE_SIZE;
    return filteredInvoices.slice(start, start + PAGE_SIZE);
  }, [filteredInvoices, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [financeTab, search, periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Single effect: resolves job→client→account and direct account lookups in one async flow,
  // then flushes all four maps in one setState batch — eliminates the intermediate "Loading account..." flicker.
  useEffect(() => {
    let cancelled = false;
    const CHUNK = 100;
    (async () => {
      const refMap: Record<string, string> = {};
      const nameMap: Record<string, string> = {};
      const nameById: Record<string, string> = {};
      const logoById: Record<string, string | null> = {};
      try {
        const supabase = getSupabase();

        const refs = [...new Set(
          allInvoicesForAux.map((inv) => inv.job_reference?.trim()).filter((x): x is string => Boolean(x)),
        )];
        const namesNeeding = [...new Set(
          allInvoicesForAux
            .filter((inv) => !inv.source_account_id?.trim() && !inv.job_reference?.trim())
            .map((inv) => inv.client_name.trim())
            .filter(Boolean),
        )];
        const directAccountIds = [...new Set(
          allInvoicesForAux.map((inv) => inv.source_account_id?.trim()).filter((x): x is string => Boolean(x)),
        )];

        // ── Step 1: jobs + client-name lookup in parallel ─────────────────────
        const [jobRows, clientNameRows] = await Promise.all([
          (async () => {
            const all: Array<{ reference: string; client_id: string | null }> = [];
            for (let i = 0; i < refs.length; i += CHUNK) {
              const { data } = await supabase.from("jobs").select("reference, client_id").in("reference", refs.slice(i, i + CHUNK));
              if (data) all.push(...(data as typeof all));
            }
            return all;
          })(),
          (async () => {
            const all: Array<{ full_name: string; source_account_id: string | null }> = [];
            for (let i = 0; i < namesNeeding.length; i += CHUNK) {
              const { data } = await supabase.from("clients").select("full_name, source_account_id").in("full_name", namesNeeding.slice(i, i + CHUNK)).is("deleted_at", null);
              if (data) all.push(...(data as typeof all));
            }
            return all;
          })(),
        ]);

        for (const r of clientNameRows) {
          const fn = r.full_name?.trim(); const aid = r.source_account_id?.trim();
          if (fn && aid) nameMap[fn] = aid;
        }

        // ── Step 2: clients for job client_ids ────────────────────────────────
        const cids = [...new Set(jobRows.map((j) => j.client_id?.trim()).filter((x): x is string => Boolean(x)))];
        const clientRows: Array<{ id: string; source_account_id: string | null }> = [];
        for (let i = 0; i < cids.length; i += CHUNK) {
          const { data } = await supabase.from("clients").select("id, source_account_id").in("id", cids.slice(i, i + CHUNK));
          if (data) clientRows.push(...(data as typeof clientRows));
        }
        const cidToAcc = new Map<string, string>();
        for (const c of clientRows) { const aid = c.source_account_id?.trim(); if (c.id && aid) cidToAcc.set(c.id, aid); }
        for (const j of jobRows) {
          const ref = j.reference?.trim(); const cid = j.client_id?.trim();
          if (!ref || !cid) continue;
          const acc = cidToAcc.get(cid); if (acc) refMap[ref] = acc;
        }

        // ── Step 3: fetch all accounts in one pass ────────────────────────────
        const allAccountIds = [...new Set([...directAccountIds, ...Object.values(refMap), ...Object.values(nameMap)])];
        for (let i = 0; i < allAccountIds.length; i += CHUNK) {
          const { data } = await supabase.from("accounts").select("id, company_name, logo_url").in("id", allAccountIds.slice(i, i + CHUNK));
          for (const r of data ?? []) {
            const row = r as { id: string; company_name?: string | null; logo_url?: string | null };
            nameById[row.id] = (row.company_name ?? "").trim() || "—";
            logoById[row.id] = (row.logo_url ?? "").trim() || null;
          }
        }

        if (!cancelled) {
          setJobRefToSourceAccountId(refMap);
          setClientNameToSourceAccountId(nameMap);
          setAccountNameById((prev) => ({ ...prev, ...nameById }));
          setAccountLogoById((prev) => ({ ...prev, ...logoById }));
        }
      } catch {
        if (!cancelled) {
          setJobRefToSourceAccountId({});
          setClientNameToSourceAccountId({});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [allInvoicesForAux]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor),
    [periodMode, weekAnchor, rangeFrom, rangeTo, monthAnchor]
  );

  const handleStatusChange = useCallback(async (invoice: Invoice, newStatus: InvoiceStatus) => {
    const supabase = getSupabase();
    try {
      if (
        (newStatus === "pending" || newStatus === "overdue") &&
        (invoice.status === "paid" || invoice.status === "partially_paid")
      ) {
        await reopenInvoiceToPending(supabase, invoice);
        if (newStatus === "overdue") {
          await supabase.from("invoices").update({ status: "overdue" }).eq("id", invoice.id);
        }
        await logAudit({
          entityType: "invoice",
          entityId: invoice.id,
          entityRef: invoice.reference,
          action: "status_changed",
          fieldName: "status",
          oldValue: invoice.status,
          newValue: newStatus === "overdue" ? "overdue" : "pending",
          userId: profile?.id,
          userName: profile?.full_name,
        });
        toast.success(newStatus === "overdue" ? "Invoice reopened as overdue" : "Invoice reopened — linked job may return to Awaiting payment");
        const { data: fresh } = await supabase.from("invoices").select("*").eq("id", invoice.id).maybeSingle();
        setSelectedInvoice((fresh as Invoice) ?? null);
        if (invoice.job_reference?.trim()) {
          const { data: jobRow } = await supabase.from("jobs").select("id").eq("reference", invoice.job_reference.trim()).maybeSingle();
          const jid = (jobRow as { id?: string } | null)?.id;
          if (jid) {
            await syncInvoicesFromJobCustomerPayments(supabase, jid);
            await maybeCompleteAwaitingPaymentJob(supabase, jid);
          }
        }
        void loadPageData();
        return;
      }

      const updates: Record<string, unknown> = { status: newStatus };
      if (invoice.status === "cancelled" && newStatus !== "cancelled") {
        updates.cancellation_reason = null;
      }
      if (newStatus === "paid") {
        updates.paid_date = new Date().toISOString().split("T")[0];
        updates.collection_stage = "completed";
        updates.amount_paid = Number(invoice.amount);
      } else if (invoice.status === "paid") {
        updates.paid_date = null;
      }
      await updateInvoice(invoice.id, updates as Partial<Invoice>);
      await logAudit({
        entityType: "invoice",
        entityId: invoice.id,
        entityRef: invoice.reference,
        action: "status_changed",
        fieldName: "status",
        oldValue: invoice.status,
        newValue: newStatus,
        userId: profile?.id,
        userName: profile?.full_name,
      });
      toast.success(`Invoice marked as ${newStatus}`);
      let paidDate: string | undefined;
      if (newStatus === "paid") {
        paidDate = new Date().toISOString().split("T")[0];
      } else if (invoice.status === "paid") {
        paidDate = undefined;
      } else {
        paidDate = invoice.paid_date;
      }
      const nextInv: Invoice = {
        ...invoice,
        status: newStatus,
        paid_date: paidDate,
        collection_stage: newStatus === "paid" ? "completed" : invoice.collection_stage,
        amount_paid: newStatus === "paid" ? Number(invoice.amount) : invoice.amount_paid,
      };
      setSelectedInvoice(nextInv);
      if (invoice.job_reference?.trim()) {
        const { data: jobRow } = await supabase.from("jobs").select("id").eq("reference", invoice.job_reference.trim()).maybeSingle();
        const jid = (jobRow as { id?: string } | null)?.id;
        if (jid) {
          await syncInvoicesFromJobCustomerPayments(supabase, jid);
          await maybeCompleteAwaitingPaymentJob(supabase, jid);
        }
      }
      if (newStatus === "paid") {
        await syncJobAfterInvoicePaidToLedger(supabase, invoice.id, "Manual");
      }
      void loadPageData();
    } catch {
      toast.error("Failed to update invoice");
    }
  }, [loadPageData, profile?.id, profile?.full_name]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const ids = Array.from(selectedIds);
      if (newStatus === "pending") {
        for (const id of ids) {
          const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
          if (!inv) continue;
          if (inv.status === "paid" || inv.status === "partially_paid") {
            await reopenInvoiceToPending(supabase, inv as Invoice);
          } else {
            await supabase.from("invoices").update({ status: "pending", paid_date: null }).eq("id", id);
          }
        }
        await logBulkAction("invoice", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name);
        toast.success(`${ids.length} invoice(s) set to pending`);
        setSelectedIds(new Set());
        void loadPageData();
        return;
      }
      if (newStatus === "paid") {
        const today = new Date().toISOString().split("T")[0];
        for (const id of ids) {
          const { data: inv } = await supabase.from("invoices").select("amount").eq("id", id).maybeSingle();
          const amt = Number((inv as { amount?: number } | null)?.amount ?? 0);
          await updateInvoice(id, {
            status: "paid",
            paid_date: today,
            collection_stage: "completed",
            amount_paid: amt,
          });
          await syncJobAfterInvoicePaidToLedger(supabase, id, "Manual");
        }
        await logBulkAction("invoice", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name);
        toast.success(`${ids.length} invoices marked paid`);
        setSelectedIds(new Set());
        void loadPageData();
        return;
      }
      const updates: Record<string, unknown> = { status: newStatus };
      const { error } = await supabase.from("invoices").update(updates).in("id", ids);
      if (error) throw error;
      await logBulkAction("invoice", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${ids.length} invoices updated to ${newStatus}`);
      setSelectedIds(new Set());
      void loadPageData();
    } catch {
      toast.error("Failed to update invoices");
    }
  };

  const handleCreate = useCallback(async (formData: CreateInvoiceInput) => {
    try {
      const result = await createInvoice(formData);
      await logAudit({
        entityType: "invoice",
        entityId: result.id,
        entityRef: result.reference,
        action: "created",
        userId: profile?.id,
        userName: profile?.full_name,
      });
      setCreateOpen(false);
      toast.success("Invoice created successfully");
      void loadPageData();
    } catch { toast.error("Failed to create invoice"); }
  }, [loadPageData, profile?.id, profile?.full_name]);

  const handleInvoiceDueDateSave = useCallback(
    async (invoice: Invoice, nextYmd: string) => {
      if (invoice.status === "paid" || invoice.status === "cancelled") return;
      const trimmed = nextYmd.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        toast.error("Enter a valid due date");
        return;
      }
      const prev = invoice.due_date ? String(invoice.due_date).slice(0, 10) : "";
      if (trimmed === prev) return;
      setSavingDueDateId(invoice.id);
      try {
        const updated = await updateInvoice(invoice.id, { due_date: trimmed });
        await logAudit({
          entityType: "invoice",
          entityId: invoice.id,
          entityRef: invoice.reference,
          action: "updated",
          fieldName: "due_date",
          oldValue: prev,
          newValue: trimmed,
          userId: profile?.id,
          userName: profile?.full_name,
        });
        toast.success("Due date updated");
        setSelectedInvoice((cur) => (cur?.id === invoice.id ? updated : cur));
        void loadPageData();
      } catch {
        toast.error("Failed to update due date");
      } finally {
        setSavingDueDateId(null);
      }
    },
    [loadPageData, profile?.id, profile?.full_name],
  );

  const handleExportCSV = useCallback(() => {
    const headers = [
      "Reference",
      "Account",
      "Client",
      "Job Reference",
      "Job date",
      "Amount",
      "Amount Paid",
      "Balance Due",
      "Due Date",
      "Invoice status",
      "Job status",
      "Paid Date",
      "Created At",
    ];
    const rows = filteredInvoices.map((inv) => {
      const accId = effectiveInvoiceSourceAccountId(inv, jobRefToSourceAccountId, clientNameToSourceAccountId);
      const accountLabel = accId ? (accountNameById[accId] ?? "") : "";
      const jref = inv.job_reference?.trim();
      const jobSnap = jref ? jobsByRef[jref] : undefined;
      const jobYmd = displayDateYmdForInvoiceRow(inv, jobSnap);
      const jobStatusLabel = jobSnap?.status
        ? (jobStatusColumnConfig[jobSnap.status]?.label ?? jobSnap.status.replace(/_/g, " "))
        : "";
      return [
        inv.reference,
        accountLabel,
        inv.client_name,
        inv.job_reference ?? "",
        jobYmd ?? "",
        String(inv.amount),
        String(invoiceAmountPaid(inv)),
        String(invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId)),
        inv.due_date,
        inv.status,
        jobStatusLabel,
        inv.paid_date ?? "",
        inv.created_at,
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `invoices-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("CSV exported successfully");
  }, [
    filteredInvoices,
    accountNameById,
    jobRefToSourceAccountId,
    clientNameToSourceAccountId,
    jobsByRef,
    customerPaidByJobId,
  ]);

  const financeTabs = useMemo(
    () =>
      INVOICE_FINANCE_TAB_ORDER.map((id) => ({
        id,
        label:
          id === "all"
            ? "All"
            : id === "draft"
              ? "Draft"
              : id === "awaiting_payment"
                ? "Awaiting payment"
                : id === "overdue"
                  ? "Overdue"
                  : id === "paid"
                    ? "Paid"
                    : "Cancelled",
        count: tabCounts[id] ?? 0,
        accent:
          id === "awaiting_payment" && (tabCounts.awaiting_payment ?? 0) > 0
            ? ("amber" as const)
            : id === "overdue" && (tabCounts.overdue ?? 0) > 0
              ? ("red" as const)
              : undefined,
      })),
    [tabCounts],
  );

  const groupedInvoicesByAccount = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        accountId: string | null;
        accountName: string;
        invoices: Invoice[];
        totalAmount: number;
        totalDue: number;
        totalPaid: number;
        awaitingInvoiceCount: number;
        overdueInvoiceCount: number;
        paidInvoiceCount: number;
      }
    >();
    for (const inv of filteredInvoices) {
      const accId = effectiveInvoiceSourceAccountId(inv, jobRefToSourceAccountId, clientNameToSourceAccountId);
      const key = accId ? `acc:${accId}` : "acc:unlinked";
      const accountName = accId
        ? accountNameById[accId] || "Loading account..."
        : "Unlinked account";
      const due = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
      const paid = invoiceListCollectedAmount(inv, jobsByRef, customerPaidByJobId);
      const row =
        groups.get(key) ??
        {
          key,
          accountId: accId ?? null,
          accountName,
          invoices: [],
          totalAmount: 0,
          totalDue: 0,
          totalPaid: 0,
          awaitingInvoiceCount: 0,
          overdueInvoiceCount: 0,
          paidInvoiceCount: 0,
        };
      row.invoices.push(inv);
      row.totalAmount += Number(inv.amount) || 0;
      row.totalDue += due;
      row.totalPaid += paid;
      if (inv.status === "paid") row.paidInvoiceCount += 1;
      else if (invoiceIsDerivedOverdue(inv, listTodayYmd)) row.overdueInvoiceCount += 1;
      else if (invoiceMatchesFinanceTab(inv, "awaiting_payment")) row.awaitingInvoiceCount += 1;
      groups.set(key, row);
    }
    return [...groups.values()]
      .map((g) => ({
        ...g,
        invoices: [...g.invoices].sort((a, b) => {
          const ad = String(a.due_date ?? a.created_at ?? "");
          const bd = String(b.due_date ?? b.created_at ?? "");
          return ad.localeCompare(bd);
        }),
      }))
      .sort((a, b) => {
        if (a.key === "acc:unlinked") return 1;
        if (b.key === "acc:unlinked") return -1;
        return a.accountName.localeCompare(b.accountName);
      });
  }, [
    filteredInvoices,
    jobRefToSourceAccountId,
    clientNameToSourceAccountId,
    accountNameById,
    jobsByRef,
    customerPaidByJobId,
    listTodayYmd,
  ]);

  const [expandedAccountGroups, setExpandedAccountGroups] = useState<Record<string, boolean>>({});

  /** Stable signature of group keys + order — when it changes, reset accordion: só o 1.º aberto. */
  const accountGroupKeysSig = useMemo(
    () => groupedInvoicesByAccount.map((g) => g.key).join("|"),
    [groupedInvoicesByAccount],
  );
  const prevAccountGroupKeysSig = useRef<string | null>(null);

  useEffect(() => {
    if (prevAccountGroupKeysSig.current === accountGroupKeysSig) return;
    prevAccountGroupKeysSig.current = accountGroupKeysSig;
    setExpandedAccountGroups(() => {
      const next: Record<string, boolean> = {};
      groupedInvoicesByAccount.forEach((g, i) => {
        next[g.key] = i === 0;
      });
      return next;
    });
  }, [accountGroupKeysSig, groupedInvoicesByAccount]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = periodMenuRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setPeriodMenuOpen(false);
    };
    if (periodMenuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [periodMenuOpen]);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Invoices"
          infoTooltip={`Period: All · Month · Week · Date range — default is the current calendar month where applicable. ${weekPeriodHelpText()}`}
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative" ref={periodMenuRef}>
              <Button
                variant="outline"
                size="sm"
                icon={<CalendarRange className="h-3.5 w-3.5" />}
                onClick={() => setPeriodMenuOpen((o) => !o)}
                className={cn(periodMode !== "all" && "border-primary/40 bg-primary/5")}
              >
                {periodMode === "all" ? "Period" : PERIOD_HEADER_LABEL[periodMode]}
              </Button>
              {periodMenuOpen ? (
                <div className="absolute top-full right-0 z-50 mt-1 w-[min(calc(100vw-1.5rem),24rem)] rounded-xl border border-border bg-card p-3 shadow-lg">
                  <FinanceWeekRangeBar
                    mode={periodMode}
                    onModeChange={setPeriodMode}
                    weekAnchor={weekAnchor}
                    onWeekAnchorChange={setWeekAnchor}
                    monthAnchor={monthAnchor}
                    onMonthAnchorChange={setMonthAnchor}
                    rangeFrom={rangeFrom}
                    rangeTo={rangeTo}
                    onRangeFromChange={setRangeFrom}
                    onRangeToChange={setRangeTo}
                    hideAllDescription
                    className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none sm:!p-0 max-h-[min(70vh,520px)] overflow-y-auto overflow-x-hidden"
                  />
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => void loadPageData()}
              title="Reload invoices from the server"
            >
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCSV}>
              Export
            </Button>
            <Button
              size="sm"
              className="bg-[#ED4B00] text-white border-transparent hover:bg-[#ED4B00]/92 shadow-sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setCreateOpen(true)}
            >
              Create Invoice
            </Button>
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Open balance</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">
                {formatCurrency(openBalanceKpi.amount)}
              </p>
              <p className="text-[11px] text-text-secondary" title="Awaiting payment + overdue − collected">
                Awaiting + overdue − collected · {openBalanceKpi.countInvoices} invoice
                {openBalanceKpi.countInvoices === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#020040]/8 text-[#020040]">
              <Receipt className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Awaiting payment</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(awaitingPaymentKpi.sum)}</p>
              <p className="text-[11px] text-text-secondary">{awaitingPaymentKpi.count} invoice{awaitingPaymentKpi.count === 1 ? "" : "s"}</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#020040]/8 text-[#020040]">
              <Clock className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Collected</p>
              <p className="text-[20px] font-bold tabular-nums leading-tight text-[#020040]">{formatCurrency(kpis.collectedTotal)}</p>
              <p className="text-[11px] text-text-secondary">{kpis.collectedInvoiceCount} paid</p>
            </div>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
              <Check className="h-4 w-4" aria-hidden />
            </div>
          </div>
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5",
              kpis.overdueCount > 0 ? "border-red-200/90 dark:border-red-900/50" : "border-border-light",
            )}
          >
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-text-tertiary",
                )}
              >
                Overdue
              </p>
              <p
                className={cn(
                  "text-[20px] font-bold tabular-nums leading-tight",
                  kpis.overdueAmount > 0.02 ? "text-red-600 dark:text-red-400" : "text-[#020040]",
                )}
              >
                {formatCurrency(kpis.overdueAmount)}
              </p>
              <p
                className={cn(
                  "text-[11px] font-medium",
                  kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-text-secondary",
                )}
              >
                {kpis.overdueCount} overdue
              </p>
            </div>
            <div
              className={cn(
                "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg",
                kpis.overdueAmount > 0.02
                  ? "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
                  : "bg-surface-tertiary text-text-tertiary",
              )}
            >
              <CircleAlert className="h-4 w-4" aria-hidden />
            </div>
          </div>
        </div>

        {auditQueueCount > 0 ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg px-4 py-3"
            style={{ backgroundColor: "#FFF8F3", borderWidth: 0.5, borderColor: "#F5CFB8" }}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ED4B00]/12 text-[#ED4B00] text-sm font-bold">
              !
            </div>
            <p className="text-sm text-text-secondary flex-1 min-w-0">
              <span className="font-semibold text-text-primary">{auditQueueCount}</span> invoice{auditQueueCount === 1 ? "" : "s"} need
              audit — clients contested.{" "}
              <button
                type="button"
                className="font-semibold text-primary underline underline-offset-2 hover:opacity-90"
                onClick={() => {
                  setFinanceTab("awaiting_payment");
                  setAuditFocus(true);
                }}
              >
                Review now
              </button>
            </p>
          </div>
        ) : null}

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
              <Tabs
                tabs={financeTabs}
                activeTab={financeTab}
                onChange={(id) => {
                  setAuditFocus(false);
                  setFinanceTab(id as InvoiceFinanceTab);
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCSV}>
                Export
              </Button>
              <SearchInput
                placeholder="Search ref, client, job…"
                className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="rounded-xl border border-border-light bg-card px-4 py-10 text-center text-sm text-text-tertiary">
              Loading invoices...
            </div>
          ) : groupedInvoicesByAccount.length === 0 ? (
            <div className="rounded-xl border border-border-light bg-card px-4 py-10 text-center text-sm text-text-tertiary">
              No invoices found for this tab.
            </div>
          ) : (
            <div className="space-y-3">
              {groupedInvoicesByAccount.map((group, groupIndex) => {
                const open = expandedAccountGroups[group.key] ?? groupIndex === 0;
                const avBg = accountHeaderAvatarBg(group.accountName);
                const accountLogo =
                  group.accountId != null ? (accountLogoById[group.accountId] ?? "").trim() : "";
                return (
                  <div key={group.key} className="rounded-xl border border-border-light bg-card overflow-hidden">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAccountGroups((prev) => {
                          const wasOpen = prev[group.key] ?? groupIndex === 0;
                          return { ...prev, [group.key]: !wasOpen };
                        })
                      }
                      className="w-full px-[14px] py-2.5 text-left bg-[#FAFAFB] border-b border-border-light flex items-center justify-between gap-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {accountLogo ? (
                          <Avatar
                            name={group.accountName}
                            src={accountLogo}
                            size="sm"
                            className="shrink-0 ring-0"
                          />
                        ) : (
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ backgroundColor: avBg }}
                            aria-hidden
                          >
                            {group.accountName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#020040] truncate">{group.accountName}</p>
                          <p className="text-[10px] text-text-tertiary">
                            {group.awaitingInvoiceCount} awaiting · {group.overdueInvoiceCount} overdue
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
                        <div className="text-right">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Pending</p>
                          <p className="text-sm font-semibold tabular-nums text-[#ED4B00]">{formatCurrency(group.totalDue)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Paid</p>
                          <p className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(group.totalPaid)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Total</p>
                          <p className="text-sm font-semibold tabular-nums text-[#020040]">{formatCurrency(group.totalAmount)}</p>
                        </div>
                        {open ? (
                          <ChevronUp className="h-4 w-4 text-text-tertiary shrink-0" aria-hidden />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-text-tertiary shrink-0" aria-hidden />
                        )}
                      </div>
                    </button>
                    {open ? (
                      <div className="divide-y divide-border-light">
                        {/* Column headers — desktop only */}
                        <div className="hidden min-[900px]:grid grid-cols-[16px_2fr_minmax(64px,1fr)_minmax(80px,1fr)_minmax(110px,1.4fr)_minmax(76px,1fr)_minmax(70px,1fr)_40px] gap-3 px-4 py-1 bg-surface-hover/40 items-center">
                          <span />
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Invoice</p>
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Postcode</p>
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Start date</p>
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Pay date</p>
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary text-right">Amount</p>
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary text-center">Status</p>
                          <span />
                        </div>
                        {group.invoices.map((inv) => {
                          const ref = inv.job_reference?.trim();
                          const job = ref ? jobsByRef[ref] : undefined;
                          const ymd = displayDateYmdForInvoiceRow(inv, job);
                          const due = invoiceListBalanceDue(inv, jobsByRef, customerPaidByJobId);
                          const paidRow = invoiceListCollectedAmount(inv, jobsByRef, customerPaidByJobId);
                          const isSimpleStatus = inv.status === "paid" || inv.status === "cancelled";
                          const statusDisp = invoiceRowStatusDisplay(inv, listTodayYmd);
                          const showQuick =
                            inv.status === "draft" ||
                            inv.status === "pending" ||
                            inv.status === "partially_paid" ||
                            inv.status === "overdue" ||
                            inv.status === "audit_required";
                          const expYmd = invoiceExpectedDateYmd(inv);
                          const iconBtnClass =
                            "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-[0.5px] border-[#D8D8DD] bg-white p-0 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
                          const actionIcons =
                            inv.status === "draft" ? (
                              <>
                                <button
                                  type="button"
                                  title="Approve & send"
                                  className={iconBtnClass}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleStatusChange(inv, "pending");
                                  }}
                                >
                                  <Send className="h-3.5 w-3.5 text-[#020040]" strokeWidth={2} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  title="Edit"
                                  className={iconBtnClass}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedInvoice(inv);
                                  }}
                                >
                                  <PenLine className="h-3.5 w-3.5 text-[#020040]" aria-hidden />
                                </button>
                              </>
                            ) : showQuick ? (
                              <>
                                <button
                                  type="button"
                                  title="Mark as paid"
                                  className={iconBtnClass}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleStatusChange(inv, "paid");
                                  }}
                                >
                                  <Check className="h-3.5 w-3.5" style={{ color: "#0F6E56" }} strokeWidth={2.5} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  title="Edit"
                                  className={iconBtnClass}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedInvoice(inv);
                                  }}
                                >
                                  <PenLine className="h-3.5 w-3.5 text-[#020040]" aria-hidden />
                                </button>
                              </>
                            ) : null;
                          return (
                            <div
                              key={inv.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedInvoice(inv)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedInvoice(inv);
                                }
                              }}
                              className="w-full bg-white px-3 py-1.5 text-left transition-colors cursor-pointer hover:bg-surface-hover/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:px-4"
                            >
                              <>
                                {/* Desktop grid — unified layout for all row types */}
                                <div className="hidden min-[900px]:grid grid-cols-[16px_2fr_minmax(64px,1fr)_minmax(80px,1fr)_minmax(110px,1.4fr)_minmax(76px,1fr)_minmax(70px,1fr)_40px] items-center gap-3">
                                  {/* Checkbox — hidden for paid/cancelled */}
                                  <div onClick={(e) => e.stopPropagation()}>
                                    {!isSimpleStatus && (
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(inv.id)}
                                        onChange={(e) => {
                                          setSelectedIds((prev) => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(inv.id);
                                            else next.delete(inv.id);
                                            return next;
                                          });
                                        }}
                                        className="h-3.5 w-3.5 rounded border-border accent-[#020040] cursor-pointer"
                                      />
                                    )}
                                  </div>
                                  {/* Col 1 — invoice ref + client + job */}
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-text-primary truncate">{inv.reference}</p>
                                    <p className="text-xs text-text-secondary truncate">{inv.client_name}</p>
                                    {inv.job_reference && (
                                      <p className="text-[10px] text-text-tertiary truncate">
                                        {inv.job_reference}{job?.title ? ` · ${job.title}` : ""}
                                      </p>
                                    )}
                                  </div>
                                  {/* Col 2 — postcode */}
                                  <div className="min-w-0">
                                    <p className="text-xs text-text-secondary truncate">
                                      {job?.property_address
                                        ? (extractPostcode(job.property_address) ?? job.property_address.split(",").pop()?.trim() ?? "—")
                                        : "—"}
                                    </p>
                                  </div>
                                  {/* Col 3 — start date */}
                                  <div className="min-w-0">
                                    <p className="text-xs text-text-secondary whitespace-nowrap">
                                      {ymd ? formatDate(ymd) : "—"}
                                    </p>
                                  </div>
                                  {/* Col 4 — pay date (no overdue indicator for paid/cancelled) */}
                                  <div className="min-w-0">
                                    {isSimpleStatus ? (
                                      <p className="text-xs text-text-secondary whitespace-nowrap">
                                        {expYmd ? formatExpectedDayMonth(expYmd) : "—"}
                                      </p>
                                    ) : !expYmd ? (
                                      <p className="text-xs text-text-tertiary">—</p>
                                    ) : listTodayYmd > expYmd ? (
                                      <p className="inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap text-xs font-medium text-red-600 dark:text-red-400">
                                        <AlertCircle className="h-3 w-3 shrink-0 text-red-500" strokeWidth={2.5} aria-hidden />
                                        {formatExpectedDayMonth(expYmd)} · {calendarDaysDiff(expYmd, listTodayYmd)}d late
                                      </p>
                                    ) : (
                                      <p className="whitespace-nowrap text-xs text-text-secondary">
                                        {formatExpectedDayMonth(expYmd)} · {calendarDaysDiff(listTodayYmd, expYmd)}d
                                      </p>
                                    )}
                                  </div>
                                  {/* Col 5 — amount */}
                                  <div className="min-w-0 text-right">
                                    {isSimpleStatus && inv.status === "paid" ? (
                                      <p className="text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(paidRow)}</p>
                                    ) : (
                                      <>
                                        <p className="text-xs font-semibold tabular-nums text-text-primary">{formatCurrency(inv.amount)}</p>
                                        {due > 0.02 && (
                                          <p className="text-[10px] tabular-nums font-medium text-amber-700 dark:text-amber-400">Due {formatCurrency(due)}</p>
                                        )}
                                        {paidRow > 0.02 && (
                                          <p className="text-[10px] tabular-nums font-medium text-emerald-700 dark:text-emerald-400">Paid {formatCurrency(paidRow)}</p>
                                        )}
                                      </>
                                    )}
                                  </div>
                                  {/* Col 6 — status badge */}
                                  <div className="flex justify-center">
                                    <Badge variant={statusDisp.variant} dot size="sm">{statusDisp.label}</Badge>
                                  </div>
                                  {/* Col 7 — action buttons (only for active rows) */}
                                  <div className="flex items-center justify-end gap-0.5">
                                    {!isSimpleStatus && (
                                      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                        {actionIcons}
                                      </div>
                                    )}
                                    <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary" aria-hidden />
                                  </div>
                                </div>

                                {/* Mobile */}
                                <div className="min-[900px]:hidden space-y-1.5">
                                  <div className="flex justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-text-primary">{inv.reference}</p>
                                      <p className="text-sm font-medium text-text-primary">{inv.client_name}</p>
                                      <p className="mt-0.5 text-[11px] text-text-tertiary">
                                        {inv.job_reference ? `${inv.job_reference}${job?.title ? ` · ${job.title}` : ""} · ` : ""}
                                        {ymd ? formatDate(ymd) : "—"}
                                        {job?.property_address ? ` · ${extractPostcode(job.property_address) ?? job.property_address.split(",").pop()?.trim() ?? ""}` : ""}
                                      </p>
                                    </div>
                                    <div className="shrink-0 self-start text-right">
                                      {isSimpleStatus && inv.status === "paid" ? (
                                        <div>
                                          <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary leading-tight">Paid</p>
                                          <p className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(paidRow)}</p>
                                        </div>
                                      ) : isSimpleStatus ? (
                                        <Badge variant="default" size="sm">Cancelled</Badge>
                                      ) : (
                                        <div className="inline-flex flex-col items-end gap-0.5">
                                          <span className="text-sm font-semibold tabular-nums text-text-primary">
                                            {formatCurrency(inv.amount)}
                                          </span>
                                          {due > 0.02 ? (
                                            <span className="text-[11px] tabular-nums font-medium text-amber-700 dark:text-amber-400">
                                              Due {formatCurrency(due)}
                                            </span>
                                          ) : null}
                                          {paidRow > 0.02 ? (
                                            <span className="text-[11px] tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                                              Paid {formatCurrency(paidRow)}
                                            </span>
                                          ) : null}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {!isSimpleStatus && (
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-left">
                                      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                                        Pay date
                                      </span>
                                      {!expYmd ? (
                                        <span className="text-sm text-text-tertiary">—</span>
                                      ) : listTodayYmd > expYmd ? (
                                        <span className="inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap text-sm font-medium text-red-700 dark:text-red-400">
                                          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} aria-hidden />
                                          {formatExpectedDayMonth(expYmd)} · {calendarDaysDiff(expYmd, listTodayYmd)}d late
                                        </span>
                                      ) : (
                                        <span className="whitespace-nowrap text-sm text-text-secondary">
                                          {formatExpectedDayMonth(expYmd)} · {calendarDaysDiff(listTodayYmd, expYmd)}d
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between gap-2">
                                    <Badge variant={statusDisp.variant} dot size="sm">
                                      {statusDisp.label}
                                    </Badge>
                                    <div className="flex shrink-0 items-center gap-1">
                                      {!isSimpleStatus && (
                                        <div className="hidden min-[700px]:flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                          {actionIcons}
                                        </div>
                                      )}
                                      <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
                                    </div>
                                  </div>
                                </div>
                              </>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onStatusChange={handleStatusChange}
        onInvoiceUpdated={(inv) => {
          setSelectedInvoice(inv);
          void loadPageData();
        }}
      />

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-border-light bg-[#020040] px-5 py-3 shadow-xl">
          <span className="text-sm font-semibold text-white/80 tabular-nums">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-white/20" />
          <button
            type="button"
            disabled={bulkSaving}
            onClick={async () => {
              setBulkSaving(true);
              await handleBulkStatusChange("paid");
              setBulkSaving(false);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
          >
            {bulkSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
            Mark as paid
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </PageTransition>
  );
}

/* ───────────────────── Invoice Detail Drawer ───────────────────── */

function InvoiceDetailDrawer({
  invoice,
  onClose,
  onStatusChange,
  onInvoiceUpdated,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
  onInvoiceUpdated?: (invoice: Invoice) => void;
}) {
  const { profile } = useProfile();
  const [tab, setTab] = useState("details");
  const [linkedJob, setLinkedJob] = useState<LinkedJob | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [relatedInvoices, setRelatedInvoices] = useState<Invoice[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [stripeState, setStripeState] = useState<{
    linkUrl?: string; linkId?: string; paymentStatus?: string; paidAt?: string; customerEmail?: string;
  }>({});
  const [linkCopied, setLinkCopied] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialPaymentDate, setPartialPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingPartial, setSavingPartial] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"full" | "partial">("full");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "bank_transfer" | "cash" | "other">("stripe");
  const [editingBreakdown, setEditingBreakdown] = useState(false);
  const [breakdownPartnerCost, setBreakdownPartnerCost] = useState("");
  const [partnerVatRegistered, setPartnerVatRegistered] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [dueDateModalOpen, setDueDateModalOpen] = useState(false);
  const [dueDateModalDate, setDueDateModalDate] = useState("");
  const [dueDateModalReason, setDueDateModalReason] = useState("");
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [editingAmount, setEditingAmount] = useState(false);
  const [editAmountValue, setEditAmountValue] = useState("");
  const [savingField, setSavingField] = useState<"due_date" | "amount" | null>(null);
  /** Linked Job tab: sales & costs breakdown (collapsed by default). */
  const [linkedJobSalesCostsOpen, setLinkedJobSalesCostsOpen] = useState(false);
  /** Sum of customer_deposit + customer_final on linked job (aligns invoice paid/due with job card). */
  const [jobCustomerPaidSum, setJobCustomerPaidSum] = useState<number | null>(null);

  const onInvoiceUpdatedRef = useRef(onInvoiceUpdated);
  onInvoiceUpdatedRef.current = onInvoiceUpdated;

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;

    setTab("details");
    setLinkedJob(null);
    setRelatedInvoices([]);
    setStripeState({
      linkUrl: invoice.stripe_payment_link_url ?? undefined,
      linkId: invoice.stripe_payment_link_id ?? undefined,
      paymentStatus: invoice.stripe_payment_status ?? "none",
      paidAt: invoice.stripe_paid_at ?? undefined,
      customerEmail: invoice.stripe_customer_email ?? undefined,
    });
    setLinkCopied(false);
    setPartialAmount("");
    setPartialPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMode("full");
    setPaymentMethod("stripe");
    setPaymentModalOpen(false);
    setEditingBreakdown(false);
    setPartnerVatRegistered(false);
    setAccountName("");
    setDueDateModalOpen(false);
    setDueDateModalDate("");
    setDueDateModalReason("");
    setSavingDueDate(false);
    setEditingAmount(false);
    setEditAmountValue("");
    setSavingField(null);
    setLinkedJobSalesCostsOpen(false);
    setJobCustomerPaidSum(null);

    const supabase = getSupabase();

    if (invoice.job_reference?.trim()) {
      setLoadingJob(true);
      void (async () => {
        try {
          const { data: jobData } = await supabase
            .from("jobs")
            .select("*")
            .eq("reference", invoice.job_reference!.trim())
            .maybeSingle();
          if (cancelled) return;
          setLinkedJob((jobData ?? null) as LinkedJob | null);
          const partnerId = (jobData as { partner_id?: string | null } | null)?.partner_id?.trim();
          if (partnerId) {
            const { data: partnerData } = await supabase
              .from("partners")
              .select("vat_registered")
              .eq("id", partnerId)
              .maybeSingle();
            if (!cancelled) {
              setPartnerVatRegistered(!!(partnerData as { vat_registered?: boolean | null } | null)?.vat_registered);
            }
          }

          const jid = (jobData as { id?: string } | null)?.id;
          if (jid) {
            const { data: payRows } = await supabase
              .from("job_payments")
              .select("amount, type, note")
              .eq("job_id", jid)
              .in("type", ["customer_deposit", "customer_final"])
              .is("deleted_at", null);
            let sum = 0;
            for (const p of payRows ?? []) {
              const row = p as { amount?: number; type?: string; note?: string | null };
              if (isLegacyMisclassifiedCustomerPayment(row as { type: string; note?: string | null })) continue;
              sum += Number(row.amount ?? 0);
            }
            if (!cancelled) setJobCustomerPaidSum(Math.round(sum * 100) / 100);
          }

          if (jid && onInvoiceUpdatedRef.current) {
            try {
              await syncInvoicesFromJobCustomerPayments(supabase, jid);
              const { data: freshInv } = await supabase.from("invoices").select("*").eq("id", invoice.id).maybeSingle();
              const fresh = freshInv as Invoice | null;
              if (
                !cancelled &&
                fresh &&
                invoiceDrawerSyncSignature(fresh) !== invoiceDrawerSyncSignature(invoice)
              ) {
                onInvoiceUpdatedRef.current?.(fresh);
              }
            } catch (e) {
              console.error("Invoice drawer: sync from job payments", e);
            }
          }
        } finally {
          if (!cancelled) setLoadingJob(false);
        }
      })();
    } else {
      setLoadingJob(false);
    }

    if (invoice.source_account_id?.trim()) {
      void supabase
        .from("accounts")
        .select("full_name")
        .eq("id", invoice.source_account_id.trim())
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) {
            setAccountName((data as { full_name?: string | null } | null)?.full_name?.trim() || "");
          }
        });
    }

    setLoadingRelated(true);
    supabase
      .from("invoices")
      .select("*")
      .eq("client_name", invoice.client_name)
      .neq("id", invoice.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(
        ({ data }) => {
          if (!cancelled) {
            setRelatedInvoices((data ?? []) as Invoice[]);
            setLoadingRelated(false);
          }
        },
        () => {
          if (!cancelled) setLoadingRelated(false);
        },
      );

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  useEffect(() => {
    if (!invoice) return;
    const charged = Math.max(0, Math.round(Number(invoice.amount ?? 0) * 100) / 100);
    const partnerCost = linkedJob
      ? Math.max(
        0,
        Math.min(
          charged,
          Math.round(
            partnerSelfBillGrossAmount(
              linkedJob as Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost">,
            ) * 100,
          ) / 100,
        ),
      )
      : charged;
    setBreakdownPartnerCost(String(partnerCost));
  }, [invoice, linkedJob]);

  const handleGenerateLink = async () => {
    if (!invoice) return;
    setGeneratingLink(true);
    try {
      const res = await fetch("/api/stripe/create-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount: invoice.amount,
          clientName: invoice.client_name,
          reference: invoice.reference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payment link");
      setStripeState((prev) => ({ ...prev, linkUrl: data.paymentLinkUrl, linkId: data.paymentLinkId, paymentStatus: "pending" }));
      toast.success("Stripe payment link created!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!invoice || !stripeState.linkId) return;
    setCheckingStatus(true);
    try {
      const res = await fetch("/api/stripe/check-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, paymentLinkId: stripeState.linkId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check status");
      setStripeState((prev) => ({
        ...prev,
        paymentStatus: data.paymentStatus,
        paidAt: data.paidAt ?? prev.paidAt,
        customerEmail: data.customerEmail ?? prev.customerEmail,
      }));
      toast.success(`Payment status: ${data.paymentStatus}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check status");
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleCopyLink = () => {
    if (stripeState.linkUrl) {
      navigator.clipboard.writeText(stripeState.linkUrl);
      setLinkCopied(true);
      toast.success("Payment link copied!");
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const handleRecordPayment = async () => {
    if (!invoice) return;
    const fullRemaining = Math.max(0, Math.round(effectiveBalance * 100) / 100);
    const parsedPartial = Number(partialAmount);
    const amountToRecord = paymentMode === "full" ? fullRemaining : parsedPartial;
    if (!Number.isFinite(amountToRecord) || amountToRecord <= 0) {
      toast.error("Enter a valid payment amount.");
      return;
    }

    if (paymentMode === "partial") {
      if (!invoice.job_reference || !onInvoiceUpdated) {
        toast.error("Partial amount can be recorded only on invoices linked to a job.");
        return;
      }
      setSavingPartial(true);
      try {
        const updated = await recordInvoicePartialPayment(invoice.id, amountToRecord, {
          paymentDate: partialPaymentDate,
          createdBy: profile?.id,
        });
        onInvoiceUpdated(updated);
        setPartialAmount("");
        setPaymentModalOpen(false);
        toast.success(`Recorded ${formatCurrency(amountToRecord)} via ${paymentMethod.replace("_", " ")}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to record payment");
      } finally {
        setSavingPartial(false);
      }
      return;
    }

    onStatusChange(invoice, "paid");
    setPaymentModalOpen(false);
    toast.success(`Recorded ${formatCurrency(amountToRecord)} via ${paymentMethod.replace("_", " ")}.`);
  };

  const canEditFields =
    !!onInvoiceUpdated &&
    invoice?.status !== "paid" &&
    invoice?.status !== "cancelled";

  const handleSaveDueDate = async () => {
    if (!invoice || !onInvoiceUpdated) return;
    const trimmed = dueDateModalDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) { toast.error("Invalid date"); return; }
    const reason = dueDateModalReason.trim();
    if (reason.length < 10) { toast.error("Reason must be at least 10 characters"); return; }
    setSavingDueDate(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/due-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: trimmed, reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to update due date");
      }
      const updated = await res.json() as Invoice;
      onInvoiceUpdated(updated);
      setDueDateModalOpen(false);
      setDueDateModalReason("");
      toast.success("Due date updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update due date");
    } finally {
      setSavingDueDate(false);
    }
  };

  const handleSaveAmount = async () => {
    if (!invoice || !onInvoiceUpdated) return;
    const parsed = parseFloat(editAmountValue);
    if (!Number.isFinite(parsed) || parsed < 0) { toast.error("Invalid amount"); return; }
    const prev = Number(invoice.amount ?? 0);
    if (Math.abs(parsed - prev) < 0.001) { setEditingAmount(false); return; }
    setSavingField("amount");
    try {
      const updated = await updateInvoice(invoice.id, { amount: parsed } as Partial<Invoice>);
      await logAudit({ entityType: "invoice", entityId: invoice.id, entityRef: invoice.reference, action: "updated", fieldName: "amount", oldValue: String(prev), newValue: String(parsed), userId: profile?.id, userName: profile?.full_name });
      toast.success("Amount updated");
      onInvoiceUpdated(updated);
      setEditingAmount(false);
    } catch { toast.error("Failed to update amount"); }
    finally { setSavingField(null); }
  };

  if (!invoice) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const isOverdue =
    invoice.status !== "paid" &&
    invoice.status !== "cancelled" &&
    invoice.status !== "draft" &&
    invoice.status !== "audit_required" &&
    new Date(invoice.due_date) < new Date();
  const daysUntilDue = Math.ceil((new Date(invoice.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const hasStripeLink = !!stripeState.linkUrl;
  const stripePaid = stripeState.paymentStatus === "paid";

  const invAmt = Number(invoice.amount ?? 0);
  const rowPaid = invoiceAmountPaid(invoice);
  const useLedgerBridge =
    Boolean(invoice.job_reference?.trim() && linkedJob && jobCustomerPaidSum !== null);
  const effectivePaid = useLedgerBridge
    ? Math.round(Math.min(invAmt, Math.max(rowPaid, jobCustomerPaidSum!)) * 100) / 100
    : rowPaid;
  const effectiveBalance = Math.max(0, Math.round((invAmt - effectivePaid) * 100) / 100);
  /** Hero matches job customer ledger when linked; DB row may lag until sync completes. */
  const showBalanceHero =
    effectivePaid > 0.02 &&
    effectiveBalance > 0.02 &&
    invoice.status !== "paid" &&
    invoice.status !== "cancelled" &&
    invoice.status !== "draft" &&
    invoice.status !== "audit_required";

  const drawerTabs = [
    { id: "details", label: "Details" },
    { id: "stripe", label: "Stripe" },
    { id: "job", label: "Job" },
    { id: "client-history", label: "Adjust", count: relatedInvoices.length },
    { id: "history", label: "Activity" },
  ];

  const linkedJobTotalCost = linkedJob ? linkedJob.partner_cost + linkedJob.materials_cost : 0;
  const linkedJobCustomerTotal = linkedJob
    ? jobBillableRevenue(linkedJob as Pick<Job, "client_price" | "extras_amount">)
    : 0;
  const linkedJobMarginAmount = linkedJob ? linkedJobCustomerTotal - linkedJobTotalCost : 0;
  const linkedJobMarginPct = linkedJobCustomerTotal > 0.01 ? (linkedJobMarginAmount / linkedJobCustomerTotal) * 100 : 0;
  const linkedJobForcedPaidBySystemOwner = linkedJob ? isJobForcePaid(linkedJob.internal_notes) : false;
  const issuedLabel = formatExpectedDayMonth(invoiceEffectiveDateValue(invoice));
  const clientInitials = invoice.client_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CL";
  const clientAddress = linkedJob?.property_address?.trim() || "Address unavailable";
  const accountPillText = accountName || "Unlinked account";
  const accountLinked = Boolean(accountName.trim());
  const accountIdLabel = invoice.source_account_id?.trim()
    ? `ACC-${invoice.source_account_id.replace(/-/g, "").slice(-4).toUpperCase()}`
    : "ACC-—";
  const chargedAmount = Math.max(0, Math.round(Number(invoice.amount ?? 0) * 100) / 100);
  const linkedJobPartnerGross = linkedJob
    ? Math.round(
      partnerSelfBillGrossAmount(
        linkedJob as Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost">,
      ) * 100,
    ) / 100
    : chargedAmount;
  const defaultPartnerGross = linkedJob
    ? Math.max(0, Math.min(chargedAmount, linkedJobPartnerGross))
    : chargedAmount;
  const baselinePartnerCost = defaultPartnerGross;
  const rawPartner = editingBreakdown ? Math.max(0, Number(breakdownPartnerCost) || 0) : baselinePartnerCost;
  const partnerCostValue = Math.max(0, Math.min(chargedAmount, Math.round(rawPartner * 100) / 100));
  const feeAmountValue = Math.max(0, Math.round((chargedAmount - partnerCostValue) * 100) / 100);
  const vatFromGross = (gross: number) => Math.round((gross / 6) * 100) / 100;
  const feeVatPortion = vatFromGross(feeAmountValue);
  const feeNetPortion = Math.max(0, Math.round((feeAmountValue - feeVatPortion) * 100) / 100);
  const partnerVatPortion = partnerVatRegistered ? vatFromGross(partnerCostValue) : 0;
  const breakdownVat = Math.round((feeVatPortion + partnerVatPortion) * 100) / 100;
  const breakdownSubtotal = Math.max(0, Math.round((chargedAmount - breakdownVat) * 100) / 100);
  const breakdownCharged = chargedAmount;
  const marginPct = chargedAmount > 0.01 ? Math.round((feeAmountValue / chargedAmount) * 100) : 0;
  const paidPct = invAmt > 0.01 ? Math.max(0, Math.min(100, Math.round((effectivePaid / invAmt) * 100))) : 0;
  const hasDueBalance = effectiveBalance > 0.01;
  const statusTone = invoice.status === "paid"
    ? { bg: "#EFF7F3", border: "#9FE1CB", text: "#0F6E56", dot: "#0F6E56" }
    : (invoice.status === "overdue" || isOverdue)
      ? { bg: "#FEF5F3", border: "#F5BFBF", text: "#A32D2D", dot: "#A32D2D" }
      : invoice.status === "cancelled"
        ? { bg: "#F5F5F7", border: "#D8D8DD", text: "#6B6B70", dot: "#6B6B70" }
        : { bg: "#FFF8F3", border: "#F5CFB8", text: "#ED4B00", dot: "#ED4B00" };
  const statusLead = invoice.status === "paid"
    ? "Paid"
    : invoice.status === "partially_paid"
      ? `Partial · ${paidPct}%`
      : (invoice.status === "overdue" || isOverdue)
        ? "Overdue"
        : invoice.status === "cancelled"
          ? "Cancelled"
          : "Pending";
  const statusSub = invoice.status === "paid"
    ? formatDate(invoice.paid_date ?? invoice.last_payment_date ?? invoice.due_date)
    : (invoice.status === "overdue" || isOverdue)
      ? `Due ${formatDate(invoice.due_date)} · ${Math.abs(daysUntilDue)}d ago`
      : daysUntilDue >= 0
        ? `Due ${formatDate(invoice.due_date)} · ${daysUntilDue}d left`
        : `Due ${formatDate(invoice.due_date)}`;
  const primaryActionLabel = invoice.status === "paid"
    ? "Send receipt"
    : invoice.status === "partially_paid"
      ? <span className="inline-flex items-center gap-1.5"><CreditCard className="h-4 w-4 shrink-0" /> Collect {formatCurrency(effectiveBalance)}</span>
      : (invoice.status === "overdue" || isOverdue)
        ? <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" /> Escalate to dispute</span>
        : <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 shrink-0" /> Mark as paid</span>;
  const canEditPartnerCost = onInvoiceUpdated && !!invoice.job_reference;
  const modalRecordAmount = paymentMode === "full" ? effectiveBalance : Number(partialAmount || 0);
  const paymentMethodOptions: Array<{ id: "stripe" | "bank_transfer" | "cash" | "other"; label: string }> = [
    { id: "stripe", label: "Stripe" },
    { id: "bank_transfer", label: "Bank transfer" },
    { id: "cash", label: "Cash" },
    { id: "other", label: "Other" },
  ];
  return (
    <>
      <Drawer
        open={!!invoice}
        onClose={onClose}
        title={invoice.reference}
        subtitle={undefined}
        width="w-[580px]"
        headerExtra={(
          <div className="flex items-center gap-1 text-[11px] text-text-secondary">
            <span>Issued {issuedLabel}</span>
            {invoice.job_reference ? (
              <>
                <span aria-hidden>·</span>
                <a
                  href={`/schedule?job=${encodeURIComponent(invoice.job_reference)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary"
                >
                  {invoice.job_reference} ↗
                </a>
              </>
            ) : null}
          </div>
        )}
        footer={tab === "details" ? (
          <div className="flex gap-2 px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                setPaymentMode("full");
                setPartialAmount(String(Math.round(effectiveBalance * 100) / 100));
                setPaymentModalOpen(true);
              }}
            >
              + Add payment
            </Button>
            {(invoice.status === "overdue" || isOverdue) && (
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                onClick={() => toast.error("Invoice escalated to dispute.")}
              >
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Escalate
                </span>
              </Button>
            )}
            <Button
              variant="success"
              size="sm"
              className="flex-1"
              onClick={() => {
                if (invoice.status === "paid") { toast.success("Receipt sent to client."); return; }
                setPaymentMode("full");
                setPartialAmount(String(Math.round(effectiveBalance * 100) / 100));
                setPaymentModalOpen(true);
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0" /> Mark as paid
              </span>
            </Button>
          </div>
        ) : undefined}
      >
        <div className="min-h-full bg-surface-hover/50">
          <div className="px-[22px] pb-4 pt-4">
            <div
              className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface-hover/50 px-4 py-[14px]"
              style={{ boxShadow: "0 1px 3px rgba(10,13,46,0.04)" }}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E6F1FB] text-[13px] font-semibold text-[#042C53]">
                    {clientInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-text-primary">{invoice.client_name}</p>
                    {!accountLinked ? (
                      <p className="mt-0.5 text-[11px] italic text-text-tertiary">No linked account</p>
                    ) : null}
                    <p className="mt-0.5 truncate text-[11px] text-text-secondary">{clientAddress}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-[52px]">
                  {accountLinked ? (
                    <>
                      <span className="rounded-full bg-[#EEEDFE] px-2 py-0.5 text-[10px] font-semibold text-[#3C3489]">
                        {accountPillText}
                      </span>
                      <span className="text-[10px] text-text-secondary">{accountIdLabel}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <a
                href={`/clients?search=${encodeURIComponent(invoice.client_name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] font-semibold text-primary"
              >
                View ↗
              </a>
            </div>
          </div>

          <div className="border-b border-border px-[22px]">
            <div className="w-full min-w-0 overflow-x-auto [scrollbar-width:thin]">
              <div className="inline-flex flex-nowrap items-stretch gap-0">
                {drawerTabs.map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => setTab(tb.id)}
                    className={cn(
                      "relative shrink-0 whitespace-nowrap px-4 py-2.5 text-left text-sm transition-colors",
                      tab === tb.id ? "font-semibold text-[#ED4B00]" : "font-medium text-text-secondary",
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {tb.label}
                      {tb.count !== undefined ? (
                        <span className="shrink-0 rounded-md bg-[#F0F2F7] px-1.5 py-0.5 text-[10px] font-semibold text-text-tertiary">
                          {tb.count}
                        </span>
                      ) : null}
                    </span>
                    {tab === tb.id ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ED4B00]" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ===== DETAILS TAB ===== */}
            {tab === "details" && (
              <div className="space-y-4 p-[22px]">
                {/* ── Status row ── */}
                <div
                  className="rounded-[6px]"
                  style={{ backgroundColor: statusTone.bg, border: `0.5px solid ${statusTone.border}`, padding: "10px 12px" }}
                >
                  <div className="flex items-center gap-3">
                    {/* LEFT */}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: statusTone.dot }} />
                      <span className="shrink-0 text-[12px] font-semibold" style={{ color: statusTone.text }}>{statusLead}</span>
                      <span className="h-[10px] w-px shrink-0" style={{ backgroundColor: statusTone.border }} />
                      <div className="flex min-w-0 items-center gap-1 group/due">
                        <p className="min-w-0 truncate text-[11px] font-medium text-[#1C1917]">{statusSub}</p>
                        {canEditFields && (
                          <button
                            type="button"
                            onClick={() => { setDueDateModalDate(String(invoice.due_date ?? "").slice(0, 10)); setDueDateModalReason(""); setDueDateModalOpen(true); }}
                            className="shrink-0 rounded border border-border bg-white px-1 py-0.5 text-[9px] font-medium text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
                            title="Change due date"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                    {/* RIGHT */}
                    <div className="shrink-0">
                      {editingAmount ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-text-secondary">£</span>
                          <input
                            type="number"
                            autoFocus
                            min={0}
                            step="0.01"
                            value={editAmountValue}
                            onChange={(e) => setEditAmountValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveAmount(); if (e.key === "Escape") setEditingAmount(false); }}
                            disabled={savingField === "amount"}
                            className="h-7 w-24 rounded-md border border-border bg-card px-2 text-right text-[12px] font-semibold text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 tabular-nums"
                          />
                          <button type="button" onClick={() => void handleSaveAmount()} disabled={savingField === "amount"} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
                            {savingField === "amount" ? "…" : "Save"}
                          </button>
                          <button type="button" onClick={() => setEditingAmount(false)} className="rounded px-1 py-0.5 text-[11px] text-text-tertiary hover:text-text-secondary">✕</button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <span
                              className="tabular-nums text-[13px] font-semibold text-[#1C1917]"
                              style={{ letterSpacing: "-0.2px" }}
                            >
                              {formatCurrency(invoice.amount)}
                            </span>
                            {canEditFields && (
                              <button
                                type="button"
                                onClick={() => { setEditAmountValue(String(Number(invoice.amount ?? 0))); setEditingAmount(true); }}
                                className="rounded border border-border bg-white px-1 py-0.5 text-[9px] font-medium text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
                                title="Edit amount"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          <span className="whitespace-nowrap text-[9px] text-text-tertiary">
                            incl. {formatCurrency(breakdownVat)} VAT
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="rounded-t-[10px] border border-border border-b-0 bg-card">
                    <div className="grid grid-cols-3 divide-x divide-border">
                      <div className="px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">TOTAL PRICE</p>
                        <p className="mt-1 text-[14px] font-semibold text-text-primary tabular-nums leading-tight">
                          {formatCurrency(invoice.amount).replace(/\.\d{2}$/, '')}
                          <span className="text-[10px] font-medium text-[#9CA3AF]">{formatCurrency(invoice.amount).slice(-3)}</span>
                        </p>
                      </div>
                      <div className="px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">YOUR COST</p>
                        <p className="mt-1 text-[14px] font-semibold text-text-primary tabular-nums leading-tight">
                          {formatCurrency(partnerCostValue).replace(/\.\d{2}$/, '')}
                          <span className="text-[10px] font-medium text-[#9CA3AF]">{formatCurrency(partnerCostValue).slice(-3)}</span>
                        </p>
                      </div>
                      <div className="bg-[#EFF7F3] px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0F6E56]">MARGIN %</p>
                        <p className="mt-1 text-[14px] font-semibold text-[#0F6E56] tabular-nums leading-tight">
                          {formatCurrency(feeAmountValue).replace(/\.\d{2}$/, '')}
                          <span className="text-[10px] font-medium text-[#0F6E56]/70">{formatCurrency(feeAmountValue).slice(-3)}</span>
                          {" · "}
                          <span className="text-[12px] font-semibold">{marginPct}%</span>
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-b-[10px] border border-border bg-surface-hover/50 px-4 py-[7px]">
                    <div className="flex min-w-0 items-center gap-2 text-[10px] text-text-secondary">
                      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#EEEDFE] text-[9px] text-[#3C3489]">JS</span>
                      <span className="truncate">
                        Matched SB-{invoice.reference.slice(-4)} · {linkedJob?.partner_name || "Partner"} · <span className="text-emerald-700">✓ Reconciled</span>
                      </span>
                    </div>
                    <a
                      href={linkedJob?.self_bill_id ? `/finance/selfbill?open=${linkedJob.self_bill_id}` : "/finance/selfbill"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[11px] font-semibold text-primary"
                    >Open ↗</a>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.5px] text-text-secondary">Invoice Breakdown</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingBreakdown) {
                          setEditingBreakdown(false);
                          toast.success("Breakdown changes saved.");
                        } else {
                          setEditingBreakdown(true);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                    >
                      <PenLine className="h-[13px] w-[13px] stroke-[2]" />
                      {editingBreakdown ? "Save changes" : "Edit"}
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-[10px] border border-border bg-surface-hover/50">
                    <div className="flex items-start justify-between border-b border-border px-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#3C3489]" />
                          <p className="text-[13px] font-semibold text-text-primary">Partner cost</p>
                          <span className="rounded-[3px] bg-[#F3F4F6] px-[6px] py-[1px] text-[10px] font-semibold text-[#6B7280]">
                            [{partnerVatRegistered ? "inc VAT" : "no VAT"}]
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-text-secondary">
                          Paid to {linkedJob?.partner_name || "partner"} via SB-{invoice.reference.slice(-4)}
                        </p>
                        {editingBreakdown && canEditPartnerCost && Math.abs(partnerCostValue - baselinePartnerCost) > 0.01 ? (
                          <p className="mt-1 text-[11px] text-red-600">This will adjust self-bill SB-{invoice.reference.slice(-4)}</p>
                        ) : null}
                      </div>
                      {editingBreakdown && canEditPartnerCost ? (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={breakdownPartnerCost}
                          onChange={(e) => setBreakdownPartnerCost(e.target.value)}
                          className="h-8 w-28 text-right"
                        />
                      ) : (
                        <p className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(partnerCostValue)}</p>
                      )}
                    </div>
                    <div className="flex items-start justify-between border-b border-border px-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          <p className="text-[13px] font-semibold text-text-primary">Master fee</p>
                          <span className="rounded-[3px] bg-[#FEF3C7] px-[6px] py-[1px] text-[10px] font-semibold text-[#78350F]">
                            [inc VAT]
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-text-secondary">
                          Platform commission ({formatCurrency(feeNetPortion)} net + {formatCurrency(feeVatPortion)} VAT)
                        </p>
                      </div>
                      <p className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(feeAmountValue)}</p>
                    </div>
                    <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2.5">
                      <p className="text-[11px] text-text-secondary">Subtotal</p>
                      <p className="text-[12px] text-text-primary tabular-nums">{formatCurrency(breakdownSubtotal)}</p>
                    </div>
                    <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2.5">
                      <p className="text-[11px] text-text-secondary">
                        VAT 20% <span className="text-[#9CA3AF]">· on Master fee only</span>
                      </p>
                      <p className="text-[12px] text-text-primary tabular-nums">{formatCurrency(breakdownVat)}</p>
                    </div>
                    <div className="flex items-center justify-between bg-[#020040] px-3 py-2.5">
                      <p className="text-[13px] font-semibold text-white">Customer charged</p>
                      <p className="text-[15px] font-semibold text-white tabular-nums">{formatCurrency(breakdownCharged)}</p>
                    </div>
                  </div>
                  {editingBreakdown ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBreakdown(false);
                          setBreakdownPartnerCost(String(baselinePartnerCost));
                        }}
                        className="rounded-md px-2 py-1 text-[12px] text-text-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.5px] text-text-secondary">Balance</p>
                  <div className="rounded-[10px] border border-border bg-surface-hover/50 px-3 py-2">
                    <div className="space-y-1 text-[13px]">
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary">Invoice</span>
                        <span className="tabular-nums text-text-primary">{formatCurrency(invoice.amount)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary">Received</span>
                        <span className="tabular-nums text-text-primary">{formatCurrency(effectivePaid)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary">Adjustments</span>
                        <span className="tabular-nums text-text-secondary">—</span>
                      </div>
                      <div className="my-1 border-t border-border" />
                      <div className={cn(
                        "flex items-center justify-between rounded-md px-2 py-1 -mx-2",
                        hasDueBalance ? "bg-[#FEF5F3]" : ""
                      )}>
                        <span className={cn("font-semibold", hasDueBalance ? "text-[#A32D2D]" : "text-text-primary")}>Due</span>
                        <span className={cn("font-semibold tabular-nums", hasDueBalance ? "text-[#A32D2D]" : "text-emerald-700")}>
                          {formatCurrency(effectiveBalance)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pb-3">
                  <p className="text-[11px] uppercase tracking-[0.5px] text-text-secondary">Quick Actions</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="outline" size="sm" className="w-full justify-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0" /> View PDF
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 shrink-0" /> Discount
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0" /> Remind
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ===== STRIPE TAB ===== */}
        {tab === "stripe" && (
          <div className="p-6 space-y-5">
            {/* Stripe Status Header */}
            <div className={`p-4 rounded-xl border ${
              stripePaid ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200" :
              stripeState.paymentStatus === "failed" ? "bg-red-50 dark:bg-red-950/30 border-red-200" :
              stripeState.paymentStatus === "expired" ? "bg-surface-hover border-border" :
              hasStripeLink ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200" :
              "bg-surface-hover border-border-light"
            }`}>
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                  stripePaid ? "bg-emerald-100" :
                  stripeState.paymentStatus === "failed" ? "bg-red-100" :
                  hasStripeLink ? "bg-blue-100" : "bg-surface-tertiary"
                }`}>
                  <CreditCard className={`h-5 w-5 ${
                    stripePaid ? "text-emerald-600" :
                    stripeState.paymentStatus === "failed" ? "text-red-600" :
                    hasStripeLink ? "text-blue-600" : "text-text-tertiary"
                  }`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {stripePaid ? "Payment Received via Stripe" :
                     stripeState.paymentStatus === "failed" ? "Payment Failed" :
                     stripeState.paymentStatus === "expired" ? "Payment Link Expired" :
                     hasStripeLink ? "Payment Link Active" :
                     "No Payment Link"}
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {stripePaid && stripeState.paidAt ? `Paid on ${formatDate(stripeState.paidAt)}` :
                     hasStripeLink ? "Link has been generated and is ready to share" :
                     "Generate a Stripe payment link to send to the client"}
                  </p>
                </div>
                <Badge
                  variant={stripePaid ? "success" : stripeState.paymentStatus === "failed" ? "danger" : hasStripeLink ? "info" : "default"}
                  dot size="md"
                >
                  {stripePaid ? "Paid" :
                   stripeState.paymentStatus === "failed" ? "Failed" :
                   stripeState.paymentStatus === "expired" ? "Expired" :
                   hasStripeLink ? "Active" : "Not Created"}
                </Badge>
              </div>
            </div>

            {/* Invoice Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Invoice</p>
                <p className="text-sm font-bold text-text-primary mt-0.5">{invoice.reference}</p>
                <p className="text-xs text-text-tertiary">{invoice.client_name}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
                  {invoice.status === "partially_paid" || showBalanceHero ? "Balance due" : "Amount"}
                </p>
                <p className="text-lg font-bold text-text-primary mt-0.5">
                  {invoice.status === "partially_paid" || showBalanceHero
                    ? formatCurrency(useLedgerBridge ? effectiveBalance : invoiceBalanceDue(invoice))
                    : formatCurrency(invoice.amount)}
                </p>
                {invoice.status === "partially_paid" || showBalanceHero ? (
                  <p className="text-[10px] text-text-tertiary mt-0.5">of {formatCurrency(invoice.amount)}</p>
                ) : null}
              </div>
            </div>

            {/* Payment Link Section */}
            {hasStripeLink && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Payment Link</p>
                <div className="p-3 rounded-xl border border-border-light bg-card">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-text-tertiary truncate font-mono">{stripeState.linkUrl}</p>
                    </div>
                    <button
                      onClick={handleCopyLink}
                      className="shrink-0 h-8 px-3 rounded-lg text-xs font-medium border border-border text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-1.5"
                    >
                      {linkCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <CreditCard className="h-3.5 w-3.5" />}
                      {linkCopied ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <a
                    href={stripeState.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 h-9 rounded-lg text-xs font-medium border border-border text-text-secondary hover:bg-surface-hover transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    Open Link
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    icon={checkingStatus ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
                    onClick={handleCheckStatus}
                    disabled={checkingStatus}
                  >
                    {checkingStatus ? "Checking..." : "Refresh Status"}
                  </Button>
                </div>
              </div>
            )}

            {/* Stripe Details */}
            {hasStripeLink && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Stripe Details</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Payment Link ID</span>
                    <span className="text-xs font-mono text-text-tertiary">{stripeState.linkId}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Payment Status</span>
                    <Badge
                      variant={stripePaid ? "success" : stripeState.paymentStatus === "failed" ? "danger" : "warning"}
                      size="sm"
                    >
                      {stripeState.paymentStatus}
                    </Badge>
                  </div>
                  {stripeState.customerEmail && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Customer Email</span>
                      <span className="text-text-primary">{stripeState.customerEmail}</span>
                    </div>
                  )}
                  {stripeState.paidAt && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Paid At</span>
                      <span className="text-text-primary">{formatDate(stripeState.paidAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Generate / Actions */}
            <div className="pt-4 border-t border-border-light space-y-3">
              {!hasStripeLink &&
                invoice.status !== "paid" &&
                invoice.status !== "cancelled" &&
                invoice.status !== "audit_required" && (
                <Button
                  className="w-full"
                  icon={generatingLink ? <Loader className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  onClick={handleGenerateLink}
                  disabled={generatingLink}
                >
                  {generatingLink ? "Generating Payment Link..." : "Generate Stripe Payment Link"}
                </Button>
              )}
              {hasStripeLink && !stripePaid && stripeState.paymentStatus !== "expired" && (
                <Button
                  variant="outline"
                  className="w-full"
                  icon={generatingLink ? <Loader className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  onClick={handleGenerateLink}
                  disabled={generatingLink}
                >
                  {generatingLink ? "Generating..." : "Generate New Link"}
                </Button>
              )}
              {invoice.status === "paid" && !stripePaid && (
                <p className="text-xs text-center text-text-tertiary">This invoice was marked as paid manually.</p>
              )}
              {invoice.status === "cancelled" && (
                <p className="text-xs text-center text-text-tertiary">
                  {invoice.cancellation_reason?.trim()
                    ? `Cancelled: ${invoice.cancellation_reason.trim()}`
                    : "This invoice has been cancelled."}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ===== LINKED JOB TAB ===== */}
        {tab === "job" && (
          <div className="p-6 space-y-5">
            {loadingJob && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-surface-hover rounded-xl" />)}
              </div>
            )}

            {!loadingJob && !linkedJob && !invoice.job_reference && (
              <div className="py-16 text-center">
                <Briefcase className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
                <p className="text-sm font-medium text-text-secondary">No linked job</p>
                <p className="text-xs text-text-tertiary mt-1">This invoice doesn&apos;t have a job reference attached</p>
              </div>
            )}

            {!loadingJob && !linkedJob && invoice.job_reference && (
              <div className="py-16 text-center">
                <Briefcase className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
                <p className="text-sm font-medium text-text-secondary">Job not found</p>
                <p className="text-xs text-text-tertiary mt-1">Reference &quot;{invoice.job_reference}&quot; could not be matched to a job</p>
              </div>
            )}

            {!loadingJob && linkedJob && (
              <>
                {/* Job Header */}
                <div className="p-4 rounded-xl border border-border-light bg-card shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-text-primary">{linkedJob.reference}</p>
                        <Badge variant={
                          linkedJob.status === "completed" ? "success" :
                          linkedJob.status === "in_progress" ? "primary" :
                          linkedJob.status === "on_hold" ? "warning" : "default"
                        } dot size="sm">
                          {linkedJob.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">{linkedJob.title}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-3">
                    <Progress value={linkedJob.progress} size="sm" color={linkedJob.progress === 100 ? "emerald" : "primary"} className="flex-1" />
                    <span className="text-xs font-medium text-text-tertiary">{linkedJob.progress}%</span>
                    <span className="text-[10px] text-text-tertiary">Phase {Math.min(linkedJob.current_phase, 2)}/{Math.min(linkedJob.total_phases, 2)}</span>
                  </div>
                </div>

                {/* Financial snapshot — directly under job card */}
                <div className="p-4 rounded-xl border border-border-light bg-surface-hover/60 dark:bg-surface-hover space-y-3">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Job financial snapshot</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-card border border-border-light shadow-sm">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Job Amount</p>
                      <p className="text-lg font-bold text-text-primary mt-0.5">{formatCurrency(linkedJob.client_price)}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border-light shadow-sm">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Total Cost</p>
                      <p className="text-lg font-bold text-text-primary mt-0.5">{formatCurrency(linkedJobTotalCost)}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border-light shadow-sm">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Margin</p>
                      <p
                        className={`text-lg font-bold mt-0.5 ${
                          linkedJobMarginAmount >= 0 ? "text-emerald-600" : "text-red-500"
                        }`}
                      >
                        {formatCurrency(linkedJobMarginAmount)}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border-light shadow-sm">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Margin %</p>
                      <p
                        className={`text-lg font-bold mt-0.5 ${
                          linkedJob.margin_percent >= 0 ? "text-emerald-600" : "text-red-500"
                        }`}
                      >
                        {linkedJob.margin_percent.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sales & costs — collapsed by default */}
                <div className="rounded-xl border border-border-light bg-card overflow-hidden shadow-sm">
                  <button
                    type="button"
                    aria-expanded={linkedJobSalesCostsOpen}
                    onClick={() => setLinkedJobSalesCostsOpen((o) => !o)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/80"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-text-primary">Linked job · sales &amp; costs</p>
                      <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                        Ticket + extras, partner &amp; materials — {linkedJobSalesCostsOpen ? "hide" : "show"} line-by-line breakdown
                      </p>
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-5 w-5 shrink-0 text-text-tertiary transition-transform duration-200",
                        linkedJobSalesCostsOpen && "rotate-90",
                      )}
                      aria-hidden
                    />
                  </button>
                  {linkedJobSalesCostsOpen && (
                    <div className="border-t border-border-light px-4 pb-4 pt-1 space-y-3">
                      <p className="text-[11px] text-text-secondary leading-relaxed">
                        Customer billable (ticket + extras) and what you pay the partner — same basis as the job finance card.
                      </p>
                      <div className="rounded-lg border border-border-light divide-y divide-border-light overflow-hidden bg-surface-hover/30">
                        <div className="flex justify-between items-center px-3 py-2.5 text-sm">
                          <span className="text-text-secondary">Customer total (ticket + extras)</span>
                          <span className="font-semibold text-text-primary tabular-nums">{formatCurrency(linkedJobCustomerTotal)}</span>
                        </div>
                        <div className="flex justify-between items-center px-3 py-2.5 text-sm">
                          <span className="text-text-secondary">Partner cost</span>
                          <span className="font-medium text-red-500 tabular-nums">−{formatCurrency(linkedJob.partner_cost)}</span>
                        </div>
                        <div className="flex justify-between items-center px-3 py-2.5 text-sm">
                          <span className="text-text-secondary">Materials</span>
                          <span className="font-medium text-red-500 tabular-nums">−{formatCurrency(linkedJob.materials_cost)}</span>
                        </div>
                        <div className="flex justify-between items-center px-3 py-2.5 text-sm bg-card">
                          <span className="font-semibold text-text-primary">Gross margin</span>
                          <span className={`font-bold tabular-nums ${linkedJobMarginPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {formatCurrency(linkedJobMarginAmount)}{" "}
                            <span className="text-xs font-semibold">({linkedJobMarginPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Job Details */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Job Information</p>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow icon={Building2} label="Client" value={linkedJob.client_name} />
                    <InfoRow icon={MapPin} label="Property" value={linkedJob.property_address} />
                    {linkedJob.partner_name && <InfoRow icon={User} label="Partner" value={linkedJob.partner_name} />}
                    {linkedJob.owner_name && <InfoRow icon={User} label="Owner" value={linkedJob.owner_name} />}
                    {linkedJob.scheduled_date && <InfoRow icon={Calendar} label="Scheduled" value={formatDate(linkedJob.scheduled_date)} />}
                    {linkedJob.completed_date && <InfoRow icon={CheckCircle2} label="Completed" value={formatDate(linkedJob.completed_date)} />}
                  </div>
                  {linkedJobForcedPaidBySystemOwner ? (
                    <p className="mt-2 text-xs font-semibold text-red-600">
                      Forced and guaranteed by system owner.
                    </p>
                  ) : null}
                  <LocationMiniMap address={linkedJob.property_address} className="mt-3" />
                </div>

                {/* Invoiced vs Job Value comparison */}
                <div className="p-4 rounded-xl border border-border-light">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-3">Invoice vs Job Value</p>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <p className="text-xs text-text-tertiary">Invoiced</p>
                      <p className="text-lg font-bold text-text-primary">{formatCurrency(invoice.amount)}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-text-tertiary" />
                    <div className="flex-1">
                      <p className="text-xs text-text-tertiary">Client Price</p>
                      <p className="text-lg font-bold text-text-primary">{formatCurrency(linkedJob.client_price)}</p>
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-xs text-text-tertiary">Difference</p>
                      <p className={`text-lg font-bold ${invoice.amount >= linkedJob.client_price ? "text-emerald-600" : "text-amber-600"}`}>
                        {formatCurrency(invoice.amount - linkedJob.client_price)}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ===== CLIENT HISTORY TAB ===== */}
        {tab === "client-history" && (
          <div className="p-6 space-y-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">Invoice History — {invoice.client_name}</p>
              <p className="text-xs text-text-tertiary">{relatedInvoices.length} other invoices for this client</p>
            </div>

            {loadingRelated && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-14 bg-surface-hover rounded-xl" />)}
              </div>
            )}

            {!loadingRelated && relatedInvoices.length === 0 && (
              <div className="py-12 text-center">
                <FileText className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">No other invoices for this client</p>
              </div>
            )}

            {!loadingRelated && relatedInvoices.length > 0 && (
              <div className="space-y-2">
                {relatedInvoices.map((inv) => {
                  const invConfig = statusConfig[inv.status] || statusConfig.pending;
                  return (
                    <motion.div
                      key={inv.id}
                      variants={staggerItem}
                      className="p-3 rounded-xl border border-border-light hover:border-border transition-colors cursor-pointer"
                      onClick={() => setTab("details")}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-surface-hover flex items-center justify-center">
                            <Receipt className="h-4 w-4 text-text-tertiary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-text-primary">{inv.reference}</p>
                              <Badge variant={invConfig.variant} size="sm" dot>{invConfig.label}</Badge>
                            </div>
                            <p className="text-[10px] text-text-tertiary">{inv.job_reference ?? "No job ref"} — Due {formatDate(inv.due_date)}</p>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-text-primary">{formatCurrency(inv.amount)}</p>
                      </div>
                    </motion.div>
                  );
                })}

                {/* Client Summary */}
                <div className="mt-4 p-4 rounded-xl bg-surface-hover">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Client Summary</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Total Invoiced</p>
                      <p className="text-sm font-bold text-text-primary">
                        {formatCurrency([invoice, ...relatedInvoices].reduce((s, i) => s + Number(i.amount), 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Paid</p>
                      <p className="text-sm font-bold text-emerald-600">
                        {formatCurrency([invoice, ...relatedInvoices].filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase">Outstanding</p>
                      <p className="text-sm font-bold text-amber-600">
                        {formatCurrency([invoice, ...relatedInvoices].filter((i) => i.status === "pending" || i.status === "overdue").reduce((s, i) => s + Number(i.amount), 0))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== HISTORY TAB (payment timeline + audit) ===== */}
        {tab === "history" && (
          <div className="p-6 space-y-8">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Timeline</p>
              <div className="space-y-0">
                <TimelineStep done label="Invoice Created" date={formatDate(invoice.created_at)} />
                <TimelineStep done={invoice.status !== "cancelled"} label="Sent to Client" date={formatDate(invoice.created_at)} />
                <TimelineStep
                  done={invoice.status === "paid"}
                  active={
                    invoice.status === "pending" ||
                    invoice.status === "overdue" ||
                    invoice.status === "partially_paid" ||
                    invoice.status === "draft"
                  }
                  label={
                    invoice.status === "paid"
                      ? "Payment Received"
                      : invoice.status === "partially_paid"
                        ? "Partially paid"
                        : invoice.status === "draft"
                          ? "Draft — not issued"
                          : isOverdue
                            ? "Payment Overdue"
                            : "Awaiting Payment"
                  }
                  date={invoice.paid_date ? formatDate(invoice.paid_date) : `Due ${formatDate(invoice.due_date)}`}
                  danger={isOverdue}
                />
              </div>
            </div>
            <div className="space-y-3 pt-2 border-t border-border-light">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Activity</p>
              <AuditTimeline entityType="invoice" entityId={invoice.id} />
            </div>
          </div>
        )}
      </div>
    </div>
      </Drawer>

      <Modal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title="Record payment"
        size="sm"
      >
        <div className="space-y-5 p-4">
          {/* Amount */}
          <div className="space-y-2">
            {[
              { value: "full" as const, label: `Full remaining (${formatCurrency(effectiveBalance)})` },
              { value: "partial" as const, label: "Partial amount" },
            ].map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors",
                  paymentMode === opt.value
                    ? "border-primary/40 bg-primary/5 text-text-primary"
                    : "border-border bg-card text-text-secondary hover:bg-surface-hover",
                )}
              >
                <input
                  type="radio"
                  name="paymentMode"
                  checked={paymentMode === opt.value}
                  onChange={() => {
                    setPaymentMode(opt.value);
                    if (opt.value === "full") setPartialAmount(String(Math.round(effectiveBalance * 100) / 100));
                  }}
                  className="accent-primary h-4 w-4 shrink-0"
                />
                <span className="font-medium">{opt.label}</span>
              </label>
            ))}
            {paymentMode === "partial" && (
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Enter amount"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
              />
            )}
          </div>

          {/* Method */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Method</p>
            <div className="grid grid-cols-3 gap-2">
              {paymentMethodOptions.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => setPaymentMethod(method.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                    paymentMethod === method.id
                      ? "border-primary bg-primary text-white shadow-sm"
                      : "border-border bg-card text-text-secondary hover:bg-surface-hover hover:text-text-primary",
                  )}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Date</p>
            <Input type="date" value={partialPaymentDate} onChange={(e) => setPartialPaymentDate(e.target.value)} />
          </div>

          {/* Actions */}
          <div className="flex gap-2 border-t border-border-light pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={savingPartial || !Number.isFinite(modalRecordAmount) || modalRecordAmount <= 0}
              loading={savingPartial}
              onClick={() => void handleRecordPayment()}
            >
              {savingPartial ? "Recording…" : `Record ${formatCurrency(modalRecordAmount)}`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dueDateModalOpen}
        onClose={() => { setDueDateModalOpen(false); setDueDateModalReason(""); }}
        title="Change due date"
        size="sm"
      >
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">New due date</label>
            <Input
              type="date"
              value={dueDateModalDate}
              onChange={(e) => setDueDateModalDate(e.target.value)}
              disabled={savingDueDate}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              Reason <span className="font-normal normal-case text-text-tertiary">(min 10 characters)</span>
            </label>
            <textarea
              rows={3}
              value={dueDateModalReason}
              onChange={(e) => setDueDateModalReason(e.target.value)}
              disabled={savingDueDate}
              placeholder="Why is the due date changing?"
              className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
            />
            {dueDateModalReason.length > 0 && dueDateModalReason.length < 10 && (
              <p className="text-[11px] text-red-500">{10 - dueDateModalReason.length} more characters needed</p>
            )}
          </div>
          <div className="flex gap-2 border-t border-border-light pt-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setDueDateModalOpen(false); setDueDateModalReason(""); }}
              disabled={savingDueDate}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={savingDueDate || dueDateModalReason.trim().length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDateModalDate)}
              loading={savingDueDate}
              onClick={() => void handleSaveDueDate()}
            >
              {savingDueDate ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ───────────────────── Helper Components ───────────────────── */

function InfoRow({ icon: Icon, label, value, highlight }: { icon: React.ElementType; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${highlight ? "text-red-500" : "text-text-tertiary"}`} />
      <div>
        <p className="text-[10px] text-text-tertiary uppercase">{label}</p>
        <p className={`text-sm font-medium ${highlight ? "text-red-600" : "text-text-primary"}`}>{value}</p>
      </div>
    </div>
  );
}

function TimelineStep({ done, active, label, date, danger }: { done: boolean; active?: boolean; label: string; date: string; danger?: boolean }) {
  return (
    <div className="flex items-start gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center">
        <div className={`h-3 w-3 rounded-full border-2 ${
          done ? "bg-emerald-50 dark:bg-emerald-950/300 border-emerald-500" :
          danger ? "bg-red-50 dark:bg-red-950/300 border-red-500" :
          active ? "bg-amber-400 border-amber-400" :
          "bg-card border-border"
        }`} />
        <div className="w-0.5 h-6 bg-border last:hidden" />
      </div>
      <div className="-mt-0.5">
        <p className={`text-sm font-medium ${danger ? "text-red-600" : done ? "text-text-primary" : "text-text-tertiary"}`}>{label}</p>
        <p className="text-[10px] text-text-tertiary">{date}</p>
      </div>
    </div>
  );
}

function BulkBtn({ label, onClick, variant }: { label: string; onClick: () => void; variant: "success" | "danger" | "warning" | "default" }) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border-amber-200",
    default: "text-text-primary bg-surface-hover hover:bg-surface-tertiary border-border",
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
