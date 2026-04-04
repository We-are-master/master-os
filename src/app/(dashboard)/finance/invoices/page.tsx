"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp, staggerItem } from "@/lib/motion";
import {
  Plus, Download, Filter, Receipt, Clock, AlertTriangle,
  FileText, Send, Calendar, MapPin, User, Briefcase, ArrowRight,
  CheckCircle2, XCircle, CreditCard, Building2, Hash, TrendingUp,
  Banknote, RotateCcw, Loader, Lock, ChevronDown, ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { Invoice, InvoiceCollectionStage, InvoiceStatus, Job, JobStatus } from "@/types/database";
import { createInvoice, updateInvoice, type CreateInvoiceInput } from "@/services/invoices";
import { COLLECTION_STAGE_LABELS } from "@/lib/invoice-collection";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { reopenInvoiceToPending } from "@/lib/invoice-reopen";
import { invoiceBalanceDue, invoiceAmountPaid } from "@/lib/invoice-balance";
import { recordInvoicePartialPayment } from "@/services/invoice-partial";
import { isJobForcePaid } from "@/lib/job-force-paid";
import { jobBillableRevenue } from "@/lib/job-financials";
import { isLegacyMisclassifiedCustomerPayment } from "@/lib/job-payment-ledger";
import { applyInvoicePeriodBoundsToQuery, getSupabase } from "@/services/base";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { getFinancePeriodClosedBounds, formatFinancePeriodKpiDescription } from "@/lib/finance-period";
import { localYmdBoundsToUtcIso } from "@/lib/schedule-calendar";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { useProfile } from "@/hooks/use-profile";
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal";
import {
  INVOICE_PIPELINE_TAB_ORDER,
  invoicePipelineTab,
  type InvoicePipelineTab,
} from "@/lib/invoice-pipeline";
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

/** Linked job fields used on the invoices list (status + schedule for columns). */
type InvoiceListJobSnapshot = {
  status: JobStatus;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
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
      .select("reference, status, scheduled_date, scheduled_start_at")
      .in("reference", chunk)
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as {
        reference?: string | null;
        status?: JobStatus;
        scheduled_date?: string | null;
        scheduled_start_at?: string | null;
      };
      const ref = (r.reference ?? "").trim();
      if (ref && r.status) {
        map[ref] = {
          status: r.status,
          scheduled_date: r.scheduled_date,
          scheduled_start_at: r.scheduled_start_at,
        };
      }
    }
  }
  return map;
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

function computeInvoiceKpis(all: Invoice[]) {
  const nonCancelled = all.filter((r) => r.status !== "cancelled");
  const totalInvoiced = nonCancelled.reduce((sum, r) => sum + Number(r.amount), 0);
  const amountReceived = nonCancelled.reduce((sum, r) => sum + invoiceAmountPaid(r), 0);
  const overdue = all.filter((r) => r.status === "overdue");
  const overdueAmount = overdue.reduce((sum, r) => sum + invoiceBalanceDue(r), 0);
  const openStatuses = new Set<Invoice["status"]>(["pending", "partially_paid", "overdue", "draft", "audit_required"]);
  const openInvoices = all.filter((r) => openStatuses.has(r.status));
  const balanceDueOpen = openInvoices.reduce((sum, r) => sum + invoiceBalanceDue(r), 0);
  const paidWithDates = all.filter((r) => r.status === "paid" && r.paid_date);
  let avgCollectionDays: number | null = null;
  if (paidWithDates.length > 0) {
    let sumDays = 0;
    let n = 0;
    for (const r of paidWithDates) {
      const c = new Date(invoiceEffectiveDateValue(r)).getTime();
      const p = new Date(r.paid_date!).getTime();
      if (!Number.isFinite(c) || !Number.isFinite(p)) continue;
      sumDays += Math.max(0, (p - c) / 864e5);
      n += 1;
    }
    if (n > 0) avgCollectionDays = sumDays / n;
  }
  return {
    totalInvoiced,
    amountReceived,
    balanceDueOpen,
    openInvoiceCount: openInvoices.length,
    overdueAmount,
    overdueCount: overdue.length,
    avgCollectionDays,
  };
}

const COLLECTION_STAGE_OPTIONS: InvoiceCollectionStage[] = [
  "awaiting_deposit",
  "deposit_collected",
  "awaiting_final",
  "completed",
];

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
  materials_cost: number;
  margin_percent: number;
  scheduled_date?: string;
  completed_date?: string;
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
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("all");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const [pipelineTab, setPipelineTab] = useState<InvoicePipelineTab>("all");
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [jobsByRef, setJobsByRef] = useState<Record<string, InvoiceListJobSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accountNameById, setAccountNameById] = useState<Record<string, string>>({});
  /** `job_reference` → `accounts.id` via job.client_id → clients.source_account_id */
  const [jobRefToSourceAccountId, setJobRefToSourceAccountId] = useState<Record<string, string>>({});
  /** `clients.full_name` (exact) → `source_account_id` when invoice has no job ref / no stored account */
  const [clientNameToSourceAccountId, setClientNameToSourceAccountId] = useState<Record<string, string>>({});
  const { profile } = useProfile();

  const loadPageData = useCallback(async () => {
    setLoading(true);
    try {
      const bounds = getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo);
      const supabase = getSupabase();
      const chunkSize = 500;
      const all: Invoice[] = [];
      for (let from = 0; from < 100_000; from += chunkSize) {
        let q = supabase.from("invoices").select("*").is("deleted_at", null);
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
        all.push(...rows);
        if (rows.length < chunkSize) break;
      }
      const refs = [...new Set(all.map((inv) => inv.job_reference?.trim()).filter((x): x is string => Boolean(x)))];
      const jobMap = await fetchJobsByReferences(refs);
      setAllInvoices(all);
      setJobsByRef(jobMap);
    } catch {
      setAllInvoices([]);
      setJobsByRef({});
    } finally {
      setLoading(false);
    }
  }, [periodMode, weekAnchor, rangeFrom, rangeTo]);

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
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [loadPageData]);

  const kpis = useMemo(() => computeInvoiceKpis(allInvoices), [allInvoices]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allInvoices.length };
    for (const inv of allInvoices) {
      const ref = inv.job_reference?.trim();
      const job = ref ? jobsByRef[ref] : undefined;
      const tab = invoicePipelineTab(inv, job);
      counts[tab] = (counts[tab] ?? 0) + 1;
    }
    return counts;
  }, [allInvoices, jobsByRef]);

  const auditQueueCount = tabCounts.audit_required ?? 0;
  const ongoingCount = tabCounts.ongoing ?? 0;

  const filteredInvoices = useMemo(() => {
    let rows = allInvoices;
    if (pipelineTab !== "all") {
      rows = rows.filter((inv) => {
        const ref = inv.job_reference?.trim();
        const job = ref ? jobsByRef[ref] : undefined;
        return invoicePipelineTab(inv, job) === pipelineTab;
      });
    }
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
  }, [allInvoices, jobsByRef, pipelineTab, search]);

  const totalItems = filteredInvoices.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const pagedData = useMemo(() => {
    const p = Math.min(page, totalPages);
    const start = (p - 1) * PAGE_SIZE;
    return filteredInvoices.slice(start, start + PAGE_SIZE);
  }, [filteredInvoices, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [pipelineTab, search, periodMode, weekAnchor, rangeFrom, rangeTo]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    let cancelled = false;
    const REF_CHUNK = 80;
    const NAME_CHUNK = 80;
    (async () => {
      const refMap: Record<string, string> = {};
      const nameMap: Record<string, string> = {};
      try {
        const supabase = getSupabase();
        const refs = [...new Set(allInvoices.map((inv) => inv.job_reference?.trim()).filter((x): x is string => Boolean(x)))];
        for (let i = 0; i < refs.length; i += REF_CHUNK) {
          const chunk = refs.slice(i, i + REF_CHUNK);
          const { data: jobs, error } = await supabase
            .from("jobs")
            .select("reference, client_id")
            .in("reference", chunk)
            .is("deleted_at", null);
          if (error) throw error;
          const cids = [
            ...new Set(
              (jobs ?? [])
                .map((j) => (j as { client_id?: string | null }).client_id)
                .filter((x): x is string => Boolean(x && String(x).trim())),
            ),
          ];
          if (cids.length === 0) continue;
          const { data: clients, error: cErr } = await supabase.from("clients").select("id, source_account_id").in("id", cids);
          if (cErr) throw cErr;
          const cmap = new Map<string, string>();
          for (const c of clients ?? []) {
            const row = c as { id: string; source_account_id?: string | null };
            const aid = (row.source_account_id ?? "").trim();
            if (aid) cmap.set(row.id, aid);
          }
          for (const j of jobs ?? []) {
            const row = j as { reference?: string | null; client_id?: string | null };
            const ref = row.reference?.trim();
            const cid = row.client_id?.trim();
            if (!ref || !cid) continue;
            const acc = cmap.get(cid);
            if (acc) refMap[ref] = acc;
          }
        }

        const namesNeeding = [
          ...new Set(
            allInvoices
              .filter((inv) => !inv.source_account_id?.trim() && !inv.job_reference?.trim())
              .map((inv) => inv.client_name.trim())
              .filter(Boolean),
          ),
        ];
        for (let i = 0; i < namesNeeding.length; i += NAME_CHUNK) {
          const nc = namesNeeding.slice(i, i + NAME_CHUNK);
          const { data: clin, error: nErr } = await supabase
            .from("clients")
            .select("full_name, source_account_id")
            .in("full_name", nc)
            .is("deleted_at", null);
          if (nErr) throw nErr;
          for (const row of clin ?? []) {
            const r = row as { full_name?: string | null; source_account_id?: string | null };
            const fn = (r.full_name ?? "").trim();
            const aid = (r.source_account_id ?? "").trim();
            if (fn && aid) nameMap[fn] = aid;
          }
        }

        if (!cancelled) {
          setJobRefToSourceAccountId(refMap);
          setClientNameToSourceAccountId(nameMap);
        }
      } catch {
        if (!cancelled) {
          setJobRefToSourceAccountId({});
          setClientNameToSourceAccountId({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allInvoices]);

  useEffect(() => {
    const idSet = new Set<string>();
    for (const inv of allInvoices) {
      const eid = effectiveInvoiceSourceAccountId(inv, jobRefToSourceAccountId, clientNameToSourceAccountId);
      if (eid) idSet.add(eid);
    }
    const ids = [...idSet];
    if (ids.length === 0) return;
    let cancelled = false;
    const CHUNK = 50;
    (async () => {
      const map: Record<string, string> = {};
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { data: rows, error } = await getSupabase().from("accounts").select("id, company_name").in("id", chunk);
          if (error) throw error;
          for (const row of rows ?? []) {
            const r = row as { id: string; company_name?: string | null };
            const nm = (r.company_name ?? "").trim();
            map[r.id] = nm || "—";
          }
        }
        if (!cancelled) setAccountNameById((prev) => ({ ...prev, ...map }));
      } catch {
        /* keep previous cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allInvoices, jobRefToSourceAccountId, clientNameToSourceAccountId]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
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
      const jobYmd = jobDateYmdForInvoiceList(jobSnap);
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
        String(invoiceBalanceDue(inv)),
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
  }, [filteredInvoices, accountNameById, jobRefToSourceAccountId, clientNameToSourceAccountId, jobsByRef]);

  const pipelineTabs = useMemo(
    () =>
      INVOICE_PIPELINE_TAB_ORDER.map((id) => ({
        id,
        label:
          id === "audit_required"
            ? "Audit required"
            : id === "ongoing"
              ? "Ongoing"
              : id === "review_approve"
                ? "Review & approve"
                : id === "awaiting_payment"
                  ? "Awaiting payment"
                  : id === "overdue"
                    ? "Overdue"
                    : id === "paid"
                      ? "Paid"
                      : id === "all"
                        ? "All"
                        : "Cancelled",
        count: tabCounts[id] ?? 0,
      })),
    [tabCounts],
  );

  const columns: Column<Invoice>[] = [
    {
      key: "reference", label: "Invoice", width: "140px",
      render: (item) => <p className="text-sm font-semibold text-text-primary">{item.reference}</p>,
    },
    {
      key: "source_account",
      label: "Account",
      minWidth: "168px",
      cellClassName: "align-top",
      render: (item) => {
        const id = effectiveInvoiceSourceAccountId(item, jobRefToSourceAccountId, clientNameToSourceAccountId);
        const name = id ? accountNameById[id] : null;
        return (
          <div className="flex items-start gap-2 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-text-tertiary shrink-0 mt-0.5" />
            <div className="min-w-0">
              {!id ? (
                <p className="text-sm text-text-tertiary">—</p>
              ) : name ? (
                <p className="text-sm font-medium text-text-primary truncate" title={name}>
                  {name}
                </p>
              ) : (
                <p className="text-xs text-text-tertiary">Loading…</p>
              )}
              <p className="text-[11px] text-text-tertiary truncate mt-0.5" title={item.client_name}>
                Client · {item.client_name}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "client_name", label: "Client",
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={item.client_name} size="sm" />
          <div>
            <p className="text-sm font-medium text-text-primary">{item.client_name}</p>
            {item.job_reference && <p className="text-[11px] text-text-tertiary">{item.job_reference}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "job_scheduled_date",
      label: "Date (job date)",
      render: (item) => {
        const ref = item.job_reference?.trim();
        const job = ref ? jobsByRef[ref] : undefined;
        const ymd = jobDateYmdForInvoiceList(job);
        return (
          <span className="text-sm text-text-secondary">{ymd ? formatDate(ymd) : "—"}</span>
        );
      },
    },
    {
      key: "amount", label: "Amount", align: "right",
      render: (item) => (
        <span className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(item.amount)}</span>
      ),
    },
    {
      key: "due_date", label: "Due Date",
      render: (item) => (
        <span className={`text-sm ${item.status === "overdue" ? "text-red-600 font-medium" : "text-text-secondary"}`}>
          {formatDate(item.due_date)}
        </span>
      ),
    },
    {
      key: "job_status", label: "Status",
      render: (item) => {
        const ref = item.job_reference?.trim();
        const job = ref ? jobsByRef[ref] : undefined;
        const js = job?.status;
        const jConf = js ? (jobStatusColumnConfig[js] ?? { label: js.replace(/_/g, " "), variant: "default" as const }) : null;
        const hasLink = !!item.stripe_payment_link_url;
        const stripePd = item.stripe_payment_status === "paid";
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {jConf ? (
              <Badge variant={jConf.variant} dot>
                {jConf.label}
              </Badge>
            ) : (
              <span className="text-sm text-text-tertiary">—</span>
            )}
            {hasLink && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                stripePd ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700" : "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
              }`}>
                <CreditCard className="h-2.5 w-2.5" />
                {stripePd ? "Stripe Paid" : "Stripe"}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Invoices"
          subtitle={`Period defaults to All time. Tabs: Ongoing = job still open (not completed, awaiting payment, or cancelled); Review & approve = job completed; Awaiting payment = job awaiting payment after approve. ${weekPeriodHelpText()}`}
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCSV}>Export CSV</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>Create Invoice</Button>
        </PageHeader>

        <div className="rounded-xl border border-border-light bg-surface-hover/60 p-4 space-y-3">
          <FinanceWeekRangeBar
            mode={periodMode}
            onModeChange={setPeriodMode}
            weekAnchor={weekAnchor}
            onWeekAnchorChange={setWeekAnchor}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            onRangeFromChange={setRangeFrom}
            onRangeToChange={setRangeTo}
          />
        </div>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total invoiced"
            value={kpis.totalInvoiced}
            format="currency"
            description={`Invoice date (billing week or created) · ${kpiPeriodDesc}`}
            icon={Receipt}
            accent="primary"
          />
          <KpiCard
            title="Ongoing"
            value={ongoingCount}
            format="number"
            description={`Jobs still in pipeline (tab) · ${kpiPeriodDesc}`}
            icon={Clock}
            accent="amber"
          />
          <KpiCard
            title="Balance due (open)"
            value={kpis.balanceDueOpen}
            format="currency"
            description={`${kpis.openInvoiceCount} open · ${kpis.overdueCount} overdue (${formatCurrency(kpis.overdueAmount)}) · ${kpiPeriodDesc}`}
            icon={AlertTriangle}
            accent="purple"
          />
          <KpiCard
            title="Paid / avg days"
            value={tabCounts.paid ?? 0}
            format="number"
            description={
              kpis.avgCollectionDays != null
                ? `Paid count in period · ~${Math.round(kpis.avgCollectionDays)}d invoice → paid · ${kpiPeriodDesc}`
                : `Paid in period · ${kpiPeriodDesc}`
            }
            icon={CheckCircle2}
            accent="emerald"
          />
        </StaggerContainer>

        <div className="rounded-xl border border-border-light bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong className="text-text-primary">Audit required</strong> when a client contests an invoice (mark via bulk or set status).{" "}
              <span className="text-text-tertiary">({auditQueueCount} in period)</span>
            </span>
          </div>
        </div>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <Tabs
              tabs={pipelineTabs}
              activeTab={pipelineTab}
              onChange={(id) => setPipelineTab(id as InvoicePipelineTab)}
            />
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <SearchInput placeholder="Search ref, client, job…" className="w-52 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={pagedData}
            getRowId={(item) => item.id}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={setPage}
            loading={loading}
            onRowClick={(item) => setSelectedInvoice(item)}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            bulkActions={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                <BulkBtn label="Audit required" onClick={() => handleBulkStatusChange("audit_required")} variant="warning" />
                <BulkBtn label="Mark Paid" onClick={() => handleBulkStatusChange("paid")} variant="success" />
                <BulkBtn label="Mark Pending" onClick={() => handleBulkStatusChange("pending")} variant="warning" />
                <BulkBtn label="Mark Overdue" onClick={() => handleBulkStatusChange("overdue")} variant="danger" />
                <BulkBtn label="Cancel" onClick={() => handleBulkStatusChange("cancelled")} variant="danger" />
              </div>
            }
          />
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
  const [collStage, setCollStage] = useState<InvoiceCollectionStage>("awaiting_final");
  const [collLocked, setCollLocked] = useState(false);
  const [savingColl, setSavingColl] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialPaymentDate, setPartialPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingPartial, setSavingPartial] = useState(false);
  const [collectionSectionOpen, setCollectionSectionOpen] = useState(false);
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
    setCollStage(invoice.collection_stage ?? "awaiting_final");
    setCollLocked(!!invoice.collection_stage_locked);
    setPartialAmount("");
    setPartialPaymentDate(new Date().toISOString().slice(0, 10));
    setCollectionSectionOpen(false);
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

  const saveCollectionStage = async () => {
    if (!invoice || !onInvoiceUpdated) return;
    setSavingColl(true);
    try {
      const updated = await updateInvoice(invoice.id, {
        collection_stage: collStage,
        collection_stage_locked: collLocked,
      });
      onInvoiceUpdated(updated);
      toast.success("Collection settings saved");
    } catch {
      toast.error("Failed to save collection settings");
    } finally {
      setSavingColl(false);
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

  if (!invoice) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[invoice.status] ?? statusConfig.pending;
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
    { id: "job", label: "Linked Job" },
    { id: "client-history", label: "Client History", count: relatedInvoices.length },
    { id: "history", label: "History" },
  ];

  const linkedJobTotalCost = linkedJob ? linkedJob.partner_cost + linkedJob.materials_cost : 0;
  const linkedJobCustomerTotal = linkedJob
    ? jobBillableRevenue(linkedJob as Pick<Job, "client_price" | "extras_amount">)
    : 0;
  const linkedJobMarginAmount = linkedJob ? linkedJobCustomerTotal - linkedJobTotalCost : 0;
  const linkedJobMarginPct = linkedJobCustomerTotal > 0.01 ? (linkedJobMarginAmount / linkedJobCustomerTotal) * 100 : 0;
  const linkedJobForcedPaidBySystemOwner = linkedJob ? isJobForcePaid(linkedJob.internal_notes) : false;

  return (
    <Drawer open={!!invoice} onClose={onClose} title={invoice.reference} subtitle={invoice.client_name} width="w-[580px]">
      <div className="px-6 pt-3 pb-0 border-b border-border-light">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ===== DETAILS TAB ===== */}
        {tab === "details" && (
          <div className="p-6 space-y-5">
            {/* Status Banner */}
            <div className={`p-4 rounded-xl border ${
              invoice.status === "paid" ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200" :
              invoice.status === "partially_paid" ? "bg-sky-50 dark:bg-sky-950/25 border-sky-200" :
              invoice.status === "audit_required" ? "bg-red-50 dark:bg-red-950/30 border-red-200" :
              invoice.status === "overdue" || isOverdue ? "bg-red-50 dark:bg-red-950/30 border-red-200" :
              invoice.status === "cancelled" ? "bg-surface-hover border-border" :
              invoice.status === "draft" ? "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800" :
              "bg-amber-50 dark:bg-amber-950/30 border-amber-200"
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${
                    invoice.status === "paid" ? "bg-emerald-100" :
                    invoice.status === "partially_paid" ? "bg-sky-100 dark:bg-sky-900/40" :
                    invoice.status === "audit_required" ? "bg-red-100" :
                    invoice.status === "overdue" || isOverdue ? "bg-red-100" :
                    invoice.status === "cancelled" ? "bg-surface-tertiary" :
                    invoice.status === "draft" ? "bg-slate-100 dark:bg-slate-900/50" :
                    "bg-amber-100"
                  }`}>
                    {invoice.status === "paid" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> :
                     invoice.status === "partially_paid" ? <Banknote className="h-5 w-5 text-sky-600" /> :
                     invoice.status === "audit_required" ? <ShieldAlert className="h-5 w-5 text-red-600" /> :
                     invoice.status === "overdue" || isOverdue ? <AlertTriangle className="h-5 w-5 text-red-600" /> :
                     invoice.status === "cancelled" ? <XCircle className="h-5 w-5 text-text-secondary" /> :
                     invoice.status === "draft" ? <FileText className="h-5 w-5 text-slate-600" /> :
                     <Clock className="h-5 w-5 text-amber-600" />}
                  </div>
                  <div className="min-w-0">
                    <Badge variant={config.variant} dot size="md">{config.label}</Badge>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {invoice.status === "paid" && invoice.paid_date ? `Paid on ${formatDate(invoice.paid_date)}` :
                       invoice.status === "audit_required" ? "Client dispute — review notes and correspondence, then clear audit when ready." :
                       invoice.status === "partially_paid" || showBalanceHero ? `${formatCurrency(effectivePaid)} received · ${formatCurrency(effectiveBalance)} due` :
                       isOverdue ? `Overdue by ${Math.abs(daysUntilDue)} days` :
                       invoice.status === "cancelled"
                         ? invoice.cancellation_reason?.trim()
                           ? `Cancelled: ${invoice.cancellation_reason.trim()}`
                           : "This invoice was cancelled"
                       : `Due in ${daysUntilDue} days`}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {invoice.status === "partially_paid" || showBalanceHero ? (
                    <>
                      <p className="text-2xl font-bold text-text-primary tabular-nums">{formatCurrency(effectiveBalance)}</p>
                      <p className="text-[11px] text-text-tertiary">due · invoice total {formatCurrency(invoice.amount)}</p>
                    </>
                  ) : (
                    <p className="text-2xl font-bold text-text-primary tabular-nums">{formatCurrency(invoice.amount)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Metadata directly under amount / status banner */}
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Hash} label="Reference" value={invoice.reference} />
              <InfoRow icon={Building2} label="Client" value={invoice.client_name} />
              <InfoRow icon={Calendar} label="Issue Date" value={formatDate(invoiceEffectiveDateValue(invoice))} />
              <InfoRow icon={Calendar} label="Due Date" value={formatDate(invoice.due_date)} highlight={isOverdue} />
              {invoice.paid_date && <InfoRow icon={CheckCircle2} label="Paid Date" value={formatDate(invoice.paid_date)} />}
              {invoice.job_reference && <InfoRow icon={Briefcase} label="Job Reference" value={invoice.job_reference} />}
            </div>

            {invoice.job_reference && onInvoiceUpdated && (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover/60 transition-colors"
                  onClick={() => setCollectionSectionOpen((o) => !o)}
                  aria-expanded={collectionSectionOpen}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Lock className="h-4 w-4 text-text-tertiary shrink-0" />
                    <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide truncate">Customer collection (job)</span>
                  </div>
                  {collectionSectionOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                  )}
                </button>
                {collectionSectionOpen ? (
                  <div className="px-4 pb-4 pt-0 space-y-3 border-t border-border-light">
                    <p className="text-[11px] text-text-tertiary pt-3">
                      Stages follow deposit/final on the job when unlocked. Turn on <strong>Lock</strong> to keep this stage fixed (e.g. paid by bank transfer outside Stripe).
                    </p>
                    <Select
                      label="Collection stage"
                      value={collStage}
                      onChange={(e) => setCollStage(e.target.value as InvoiceCollectionStage)}
                      options={COLLECTION_STAGE_OPTIONS.map((v) => ({ value: v, label: COLLECTION_STAGE_LABELS[v] }))}
                    />
                    <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-border"
                        checked={collLocked}
                        onChange={(e) => setCollLocked(e.target.checked)}
                      />
                      Lock stage (manual only)
                    </label>
                    <Button type="button" size="sm" onClick={saveCollectionStage} disabled={savingColl}>
                      {savingColl ? "Saving…" : "Save collection"}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            {/* Invoice collections — aligned with job customer ledger when linked */}
            <div className="rounded-xl border border-border-light bg-surface-hover/60 p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Invoice · customer collections</p>
                <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                  {linkedJob
                    ? "Totals follow payments recorded on the job (deposit / final). They stay in sync with the job finance card."
                    : "Amounts on this invoice row only (no job link)."}
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-border-light bg-card/50 px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Invoice amount</span>
                  <span className="font-semibold text-text-primary tabular-nums">{formatCurrency(invoice.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Amount received</span>
                  <span className="font-semibold text-text-primary tabular-nums">
                    {useLedgerBridge ? formatCurrency(effectivePaid) : formatCurrency(rowPaid)}
                  </span>
                </div>
                {useLedgerBridge && Math.abs(rowPaid - effectivePaid) > 0.02 ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400/90">
                    Invoice row shows {formatCurrency(rowPaid)}; job ledger has {formatCurrency(jobCustomerPaidSum!)} — showing the higher so due matches the job.
                  </p>
                ) : null}
                <div className="flex justify-between text-sm pt-1 border-t border-border-light">
                  <span className="font-medium text-text-primary">Balance due</span>
                  <span className="font-bold text-primary tabular-nums">
                    {useLedgerBridge ? formatCurrency(effectiveBalance) : formatCurrency(invoiceBalanceDue(invoice))}
                  </span>
                </div>
              </div>
            </div>

            {invoice.job_reference &&
              onInvoiceUpdated &&
              (invoice.status === "pending" || invoice.status === "partially_paid" || invoice.status === "overdue") && (
              <div className="rounded-xl border border-border bg-surface-hover/80 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Record partial payment</p>
                  <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                    Posts to the linked job (deposit / final split) and updates this invoice and amount due on the job.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Amount"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                  />
                  <Input type="date" value={partialPaymentDate} onChange={(e) => setPartialPaymentDate(e.target.value)} />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  loading={savingPartial}
                  disabled={!partialAmount || Number(partialAmount) <= 0}
                  onClick={async () => {
                    if (!invoice || !onInvoiceUpdated) return;
                    setSavingPartial(true);
                    try {
                      const updated = await recordInvoicePartialPayment(invoice.id, Number(partialAmount), {
                        paymentDate: partialPaymentDate,
                        createdBy: profile?.id,
                      });
                      onInvoiceUpdated(updated);
                      setPartialAmount("");
                      toast.success("Partial payment recorded");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed to record payment");
                    } finally {
                      setSavingPartial(false);
                    }
                  }}
                >
                  Record partial payment
                </Button>
              </div>
            )}

            {/* Status actions — Mark as Paid, reminders, cancel, etc. */}
            <div className="flex flex-wrap gap-2 pt-1">
              {invoice.status === "audit_required" && (
                <>
                  <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "pending")}>
                    Clear audit (pending)
                  </Button>
                  <Button variant="outline" size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "cancelled")}>
                    Cancel invoice
                  </Button>
                </>
              )}
              {invoice.status === "draft" && (
                <>
                  <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "pending")}>
                    Issue (mark pending)
                  </Button>
                  <Button variant="outline" size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "cancelled")}>
                    Cancel
                  </Button>
                </>
              )}
              {invoice.status === "pending" && (
                <>
                  <Button size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "paid")}>Mark as Paid</Button>
                  <Button variant="outline" size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => toast.success("Reminder sent")}>Send Reminder</Button>
                  <Button variant="outline" size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "cancelled")}>Cancel</Button>
                </>
              )}
              {invoice.status === "partially_paid" && (
                <>
                  <Button size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "paid")}>Mark fully paid</Button>
                  <Button variant="outline" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "pending")}>Reopen (reset)</Button>
                  <Button variant="outline" size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "cancelled")}>Cancel</Button>
                </>
              )}
              {invoice.status === "overdue" && (
                <>
                  <Button size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "paid")}>Mark as Paid</Button>
                  <Button variant="outline" size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => toast.success("Urgent reminder sent")}>Send Urgent Reminder</Button>
                  <Button variant="outline" size="sm" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "cancelled")}>Write Off</Button>
                </>
              )}
              {invoice.status === "paid" && (
                <Button variant="outline" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "pending")}>Reopen</Button>
              )}
              {invoice.status === "cancelled" && (
                <Button variant="outline" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onStatusChange(invoice, "pending")}>Reactivate</Button>
              )}
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
    </Drawer>
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
