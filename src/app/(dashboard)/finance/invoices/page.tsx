"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp, staggerItem } from "@/lib/motion";
import {
  Plus, Download, Filter, Receipt, DollarSign, Clock, AlertTriangle,
  FileText, Send, Calendar, MapPin, User, Briefcase, ArrowRight,
  CheckCircle2, XCircle, CreditCard, Building2, Hash, TrendingUp,
  Banknote, RotateCcw, Loader, Lock,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { Invoice, InvoiceCollectionStage, InvoiceStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listInvoices, createInvoice, updateInvoice, type CreateInvoiceInput } from "@/services/invoices";
import { syncInvoiceCollectionStagesForJob, COLLECTION_STAGE_LABELS } from "@/lib/invoice-collection";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { reopenInvoiceToPending } from "@/lib/invoice-reopen";
import { invoiceBalanceDue, invoiceAmountPaid } from "@/lib/invoice-balance";
import { recordInvoicePartialPayment } from "@/services/invoice-partial";
import { isJobForcePaid } from "@/lib/job-force-paid";
import { getStatusCounts, getSupabase, type ListParams } from "@/services/base";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { getFinanceListDateFilter, getFinancePeriodClosedBounds, formatFinancePeriodKpiDescription } from "@/lib/finance-period";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { useProfile } from "@/hooks/use-profile";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  paid: { label: "Paid", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  partially_paid: { label: "Partial", variant: "info" },
  overdue: { label: "Overdue", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "default" },
};

const INVOICE_STATUSES: InvoiceStatus[] = ["paid", "pending", "partially_paid", "overdue", "cancelled"];

const COLLECTION_STAGE_OPTIONS: InvoiceCollectionStage[] = [
  "awaiting_deposit",
  "deposit_collected",
  "awaiting_final",
  "completed",
];

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
  partner_cost: number;
  materials_cost: number;
  margin_percent: number;
  scheduled_date?: string;
  completed_date?: string;
}

export default function InvoicesPage() {
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("all");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const invoiceListParams = useMemo(
    (): Partial<ListParams> => getFinanceListDateFilter(periodMode, weekAnchor, rangeFrom, rangeTo, "created_at"),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );

  const {
    data, loading, page, totalPages, totalItems, setPage, search, setSearch, status, setStatus, refresh,
  } = useSupabaseList<Invoice>({
    fetcher: listInvoices,
    realtimeTable: "invoices",
    listParams: invoiceListParams,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({
    all: 0, paid: 0, pending: 0, partially_paid: 0, overdue: 0, cancelled: 0,
  });
  const [kpis, setKpis] = useState({
    totalInvoiced: 0,
    pendingAmount: 0,
    pendingCount: 0,
    overdueAmount: 0,
    overdueCount: 0,
    avgCollectionDays: null as number | null,
  });
  const { profile } = useProfile();

  const loadCounts = useCallback(async () => {
    try {
      const bounds = getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo);
      const counts = await getStatusCounts(
        "invoices",
        INVOICE_STATUSES,
        "status",
        bounds ? { dateColumn: "created_at", dateFrom: bounds.from, dateTo: bounds.to } : undefined
      );
      setTabCounts(counts);
    } catch { /* cosmetic */ }
  }, [periodMode, weekAnchor, rangeFrom, rangeTo]);

  const loadKpis = useCallback(async () => {
    try {
      const bounds = getFinancePeriodClosedBounds(periodMode, weekAnchor, rangeFrom, rangeTo);
      let q = getSupabase().from("invoices").select("amount, status, amount_paid, paid_date, created_at");
      if (bounds) {
        q = q.gte("created_at", bounds.from).lte("created_at", bounds.to);
      }
      const { data: rows, error } = await q;
      if (error) throw error;
      const all = (rows ?? []) as {
        amount: number;
        status: string;
        amount_paid?: number;
        paid_date?: string | null;
        created_at: string;
      }[];
      const totalInvoiced = all.reduce((sum, r) => sum + Number(r.amount), 0);
      const pending = all.filter((r) => r.status === "pending" || r.status === "partially_paid");
      const overdue = all.filter((r) => r.status === "overdue");
      const paidWithDates = all.filter((r) => r.status === "paid" && r.paid_date);
      let avgCollectionDays: number | null = null;
      if (paidWithDates.length > 0) {
        let sumDays = 0;
        let n = 0;
        for (const r of paidWithDates) {
          const c = new Date(r.created_at).getTime();
          const p = new Date(r.paid_date!).getTime();
          if (!Number.isFinite(c) || !Number.isFinite(p)) continue;
          sumDays += Math.max(0, (p - c) / 864e5);
          n += 1;
        }
        if (n > 0) avgCollectionDays = sumDays / n;
      }
      setKpis({
        totalInvoiced,
        pendingAmount: pending.reduce((sum, r) => sum + invoiceBalanceDue(r as Invoice), 0),
        pendingCount: pending.length,
        overdueAmount: overdue.reduce((sum, r) => sum + Number(r.amount), 0),
        overdueCount: overdue.length,
        avgCollectionDays,
      });
    } catch { /* cosmetic */ }
  }, [periodMode, weekAnchor, rangeFrom, rangeTo]);

  useEffect(() => {
    loadCounts();
    loadKpis();
  }, [loadCounts, loadKpis]);

  const kpiPeriodDesc = useMemo(
    () => formatFinancePeriodKpiDescription(periodMode, weekAnchor, rangeFrom, rangeTo),
    [periodMode, weekAnchor, rangeFrom, rangeTo]
  );
  const kpiScoped = periodMode !== "all";

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
          if (jid) await syncInvoiceCollectionStagesForJob(supabase, jid);
        }
        refresh();
        loadCounts();
        loadKpis();
        return;
      }

      const updates: Record<string, unknown> = { status: newStatus };
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
        if (jid) await syncInvoiceCollectionStagesForJob(supabase, jid);
      }
      if (newStatus === "paid") {
        await syncJobAfterInvoicePaidToLedger(supabase, invoice.id, "Manual");
      }
      refresh();
      loadCounts();
      loadKpis();
    } catch {
      toast.error("Failed to update invoice");
    }
  }, [refresh, loadCounts, loadKpis, profile?.id, profile?.full_name]);

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
        refresh();
        loadCounts();
        loadKpis();
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
        refresh();
        loadCounts();
        loadKpis();
        return;
      }
      const updates: Record<string, unknown> = { status: newStatus };
      const { error } = await supabase.from("invoices").update(updates).in("id", ids);
      if (error) throw error;
      await logBulkAction("invoice", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${ids.length} invoices updated to ${newStatus}`);
      setSelectedIds(new Set());
      refresh();
      loadCounts();
      loadKpis();
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
      refresh();
      loadCounts();
      loadKpis();
    } catch { toast.error("Failed to create invoice"); }
  }, [refresh, loadCounts, loadKpis, profile?.id, profile?.full_name]);

  const handleExportCSV = useCallback(() => {
    const headers = ["Reference", "Client", "Job Reference", "Amount", "Amount Paid", "Balance Due", "Status", "Due Date", "Paid Date", "Created At"];
    const rows = data.map((inv) => [
      inv.reference,
      inv.client_name,
      inv.job_reference ?? "",
      String(inv.amount),
      String(invoiceAmountPaid(inv)),
      String(invoiceBalanceDue(inv)),
      inv.status,
      inv.due_date,
      inv.paid_date ?? "",
      inv.created_at,
    ]);
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
  }, [data]);

  const tabs = [
    { id: "all", label: "All", count: tabCounts.all },
    { id: "paid", label: "Paid", count: tabCounts.paid },
    {
      id: "pending",
      label: "Pending",
      count: (tabCounts.pending ?? 0) + (tabCounts.partially_paid ?? 0),
    },
    { id: "overdue", label: "Overdue", count: tabCounts.overdue },
    { id: "cancelled", label: "Cancelled", count: tabCounts.cancelled },
  ];

  const columns: Column<Invoice>[] = [
    {
      key: "reference", label: "Invoice", width: "140px",
      render: (item) => <p className="text-sm font-semibold text-text-primary">{item.reference}</p>,
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
      key: "created_at", label: "Date",
      render: (item) => <span className="text-sm text-text-secondary">{formatDate(item.created_at)}</span>,
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
      key: "amount", label: "Amount", align: "right",
      render: (item) => {
        const bal = invoiceBalanceDue(item);
        const paid = invoiceAmountPaid(item);
        return (
          <div className="text-right">
            <span className="text-sm font-semibold text-text-primary">{formatCurrency(item.amount)}</span>
            {(item.status === "partially_paid" || paid > 0.02) && item.status !== "paid" ? (
              <p className="text-[11px] text-text-tertiary">Due {formatCurrency(bal)}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "collection_stage", label: "Collection", width: "150px",
      render: (item) =>
        item.job_reference && item.collection_stage ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-text-secondary leading-tight">{COLLECTION_STAGE_LABELS[item.collection_stage]}</span>
            {item.collection_stage_locked ? (
              <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                <Lock className="h-2.5 w-2.5" /> Manual
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-text-tertiary">—</span>
        ),
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const sConf = statusConfig[item.status] ?? statusConfig.pending;
        const hasLink = !!item.stripe_payment_link_url;
        const stripePd = item.stripe_payment_status === "paid";
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={sConf.variant} dot>{sConf.label}</Badge>
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
        <PageHeader title="Invoices" subtitle="Track and manage client invoices and collections.">
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportCSV}>Export CSV</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>Create Invoice</Button>
        </PageHeader>

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

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Invoiced"
            value={kpis.totalInvoiced}
            format="currency"
            change={kpiScoped ? undefined : 18.2}
            changeLabel={kpiScoped ? undefined : "this quarter"}
            description={kpiScoped ? kpiPeriodDesc : undefined}
            icon={Receipt}
            accent="primary"
          />
          <KpiCard
            title="Pending Collection"
            value={kpis.pendingAmount}
            format="currency"
            description={`${kpis.pendingCount} invoice${kpis.pendingCount === 1 ? "" : "s"} · ${kpiPeriodDesc}`}
            icon={DollarSign}
            accent="amber"
          />
          <KpiCard
            title="Avg Collection Time"
            value={kpis.avgCollectionDays != null ? `${Math.round(kpis.avgCollectionDays)} Days` : "—"}
            format="none"
            change={kpiScoped ? undefined : -8.5}
            changeLabel={kpiScoped ? undefined : "faster"}
            description={
              kpiScoped
                ? kpis.avgCollectionDays != null
                  ? `Paid in period · ${kpiPeriodDesc}`
                  : `No paid invoices · ${kpiPeriodDesc}`
                : undefined
            }
            icon={Clock}
            accent="blue"
          />
          <KpiCard
            title="Overdue Amount"
            value={kpis.overdueAmount}
            format="currency"
            description={`${kpis.overdueCount} overdue · ${kpiPeriodDesc}`}
            icon={AlertTriangle}
            accent="primary"
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
              <SearchInput placeholder="Search invoices..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={data}
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
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
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
          refresh();
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

  useEffect(() => {
    if (!invoice) return;
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

    const supabase = getSupabase();

    if (invoice.job_reference) {
      setLoadingJob(true);
      supabase.from("jobs").select("*").eq("reference", invoice.job_reference).maybeSingle()
        .then(({ data }) => { setLinkedJob(data as LinkedJob | null); setLoadingJob(false); }, () => setLoadingJob(false));
    }

    setLoadingRelated(true);
    supabase.from("invoices").select("*").eq("client_name", invoice.client_name).neq("id", invoice.id).order("created_at", { ascending: false }).limit(5)
      .then(({ data }) => { setRelatedInvoices((data ?? []) as Invoice[]); setLoadingRelated(false); }, () => setLoadingRelated(false));
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
  const isOverdue = invoice.status !== "paid" && invoice.status !== "cancelled" && new Date(invoice.due_date) < new Date();
  const daysUntilDue = Math.ceil((new Date(invoice.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const hasStripeLink = !!stripeState.linkUrl;
  const stripePaid = stripeState.paymentStatus === "paid";

  const drawerTabs = [
    { id: "details", label: "Details" },
    { id: "stripe", label: "Stripe" },
    { id: "job", label: "Linked Job" },
    { id: "client-history", label: "Client History", count: relatedInvoices.length },
    { id: "history", label: "History" },
  ];

  const linkedJobTotalCost = linkedJob ? linkedJob.partner_cost + linkedJob.materials_cost : 0;
  const linkedJobMarginAmount = linkedJob ? linkedJob.client_price - linkedJobTotalCost : 0;
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
              invoice.status === "overdue" || isOverdue ? "bg-red-50 dark:bg-red-950/30 border-red-200" :
              invoice.status === "cancelled" ? "bg-surface-hover border-border" :
              "bg-amber-50 dark:bg-amber-950/30 border-amber-200"
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${
                    invoice.status === "paid" ? "bg-emerald-100" :
                    invoice.status === "partially_paid" ? "bg-sky-100 dark:bg-sky-900/40" :
                    invoice.status === "overdue" || isOverdue ? "bg-red-100" :
                    invoice.status === "cancelled" ? "bg-surface-tertiary" :
                    "bg-amber-100"
                  }`}>
                    {invoice.status === "paid" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> :
                     invoice.status === "partially_paid" ? <Banknote className="h-5 w-5 text-sky-600" /> :
                     invoice.status === "overdue" || isOverdue ? <AlertTriangle className="h-5 w-5 text-red-600" /> :
                     invoice.status === "cancelled" ? <XCircle className="h-5 w-5 text-text-secondary" /> :
                     <Clock className="h-5 w-5 text-amber-600" />}
                  </div>
                  <div className="min-w-0">
                    <Badge variant={config.variant} dot size="md">{config.label}</Badge>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {invoice.status === "paid" && invoice.paid_date ? `Paid on ${formatDate(invoice.paid_date)}` :
                       invoice.status === "partially_paid" ? `${formatCurrency(invoiceAmountPaid(invoice))} received · ${formatCurrency(invoiceBalanceDue(invoice))} left` :
                       isOverdue ? `Overdue by ${Math.abs(daysUntilDue)} days` :
                       invoice.status === "cancelled" ? "This invoice was cancelled" :
                       `Due in ${daysUntilDue} days`}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {invoice.status === "partially_paid" ? (
                    <>
                      <p className="text-2xl font-bold text-text-primary tabular-nums">{formatCurrency(invoiceBalanceDue(invoice))}</p>
                      <p className="text-[11px] text-text-tertiary">due · total {formatCurrency(invoice.amount)}</p>
                    </>
                  ) : (
                    <p className="text-2xl font-bold text-text-primary tabular-nums">{formatCurrency(invoice.amount)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Invoice Info */}
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Hash} label="Reference" value={invoice.reference} />
              <InfoRow icon={Building2} label="Client" value={invoice.client_name} />
              <InfoRow icon={Calendar} label="Issue Date" value={formatDate(invoice.created_at)} />
              <InfoRow icon={Calendar} label="Due Date" value={formatDate(invoice.due_date)} highlight={isOverdue} />
              {invoice.paid_date && <InfoRow icon={CheckCircle2} label="Paid Date" value={formatDate(invoice.paid_date)} />}
              {invoice.job_reference && <InfoRow icon={Briefcase} label="Job Reference" value={invoice.job_reference} />}
            </div>

            {invoice.job_reference && onInvoiceUpdated && (
              <div className="p-4 rounded-xl border border-border-light space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-text-tertiary" />
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Customer collection (job)</p>
                </div>
                <p className="text-[11px] text-text-tertiary">
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
            )}

            {/* Financial Breakdown */}
            <div className="p-4 rounded-xl bg-surface-hover space-y-3">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Financial Summary</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Invoice Amount</span>
                  <span className="font-semibold text-text-primary">{formatCurrency(invoice.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Amount paid</span>
                  <span className="font-semibold text-text-primary">{formatCurrency(invoiceAmountPaid(invoice))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Balance due</span>
                  <span className="font-semibold text-primary">{formatCurrency(invoiceBalanceDue(invoice))}</span>
                </div>
                {invoice.job_reference &&
                  onInvoiceUpdated &&
                  (invoice.status === "pending" || invoice.status === "partially_paid" || invoice.status === "overdue") && (
                  <div className="pt-3 mt-1 border-t border-border space-y-2">
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partial payment</p>
                    <p className="text-[11px] text-text-tertiary">Posts to the linked job (deposit/final split) and updates amount due on the job.</p>
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
                {linkedJob && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Client Price (Job)</span>
                      <span className="font-medium text-text-primary">{formatCurrency(linkedJob.client_price)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Partner Cost</span>
                      <span className="font-medium text-red-500">-{formatCurrency(linkedJob.partner_cost)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Materials</span>
                      <span className="font-medium text-red-500">-{formatCurrency(linkedJob.materials_cost)}</span>
                    </div>
                    <div className="h-px bg-border" />
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-text-primary">Gross Margin</span>
                      <span className={`font-bold ${linkedJob.margin_percent >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {formatCurrency(linkedJob.client_price - linkedJob.partner_cost - linkedJob.materials_cost)} ({linkedJob.margin_percent.toFixed(1)}%)
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Payment Timeline */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Timeline</p>
              <div className="space-y-0">
                <TimelineStep done label="Invoice Created" date={formatDate(invoice.created_at)} />
                <TimelineStep done={invoice.status !== "cancelled"} label="Sent to Client" date={formatDate(invoice.created_at)} />
                <TimelineStep
                  done={invoice.status === "paid"}
                  active={invoice.status === "pending" || invoice.status === "overdue" || invoice.status === "partially_paid"}
                  label={
                    invoice.status === "paid"
                      ? "Payment Received"
                      : invoice.status === "partially_paid"
                        ? "Partially paid"
                        : isOverdue
                          ? "Payment Overdue"
                          : "Awaiting Payment"
                  }
                  date={invoice.paid_date ? formatDate(invoice.paid_date) : `Due ${formatDate(invoice.due_date)}`}
                  danger={isOverdue}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-border-light">
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
                  {invoice.status === "partially_paid" ? "Balance due" : "Amount"}
                </p>
                <p className="text-lg font-bold text-text-primary mt-0.5">
                  {invoice.status === "partially_paid" ? formatCurrency(invoiceBalanceDue(invoice)) : formatCurrency(invoice.amount)}
                </p>
                {invoice.status === "partially_paid" ? (
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
              {!hasStripeLink && invoice.status !== "paid" && invoice.status !== "cancelled" && (
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
                <p className="text-xs text-center text-text-tertiary">This invoice has been cancelled.</p>
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
                <div className="p-4 rounded-xl border border-border-light">
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

                {/* Mini Dashboard (Job Amount / Total Cost / Margin) */}
                <div className="p-4 rounded-xl bg-surface-hover space-y-3">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Job Financial Snapshot</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-card border border-border-light">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Job Amount</p>
                      <p className="text-lg font-bold text-text-primary mt-0.5">{formatCurrency(linkedJob.client_price)}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border-light">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Total Cost</p>
                      <p className="text-lg font-bold text-text-primary mt-0.5">{formatCurrency(linkedJobTotalCost)}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border-light">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase">Margin</p>
                      <p
                        className={`text-lg font-bold mt-0.5 ${
                          linkedJobMarginAmount >= 0 ? "text-emerald-600" : "text-red-500"
                        }`}
                      >
                        {formatCurrency(linkedJobMarginAmount)}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border-light">
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

        {/* ===== HISTORY TAB (Audit) ===== */}
        {tab === "history" && (
          <div className="p-6">
            <AuditTimeline entityType="invoice" entityId={invoice.id} />
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

/* ───────────────────── Create Invoice Modal ───────────────────── */

function CreateInvoiceModal({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateInvoiceInput) => void;
}) {
  const [form, setForm] = useState({ client_name: "", job_reference: "", amount: "", due_date: "", status: "pending" as InvoiceStatus });
  const [submitting, setSubmitting] = useState(false);

  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.client_name || !form.amount || !form.due_date) { toast.error("Please fill in all required fields"); return; }
    setSubmitting(true);
    try {
      await onCreate({
        client_name: form.client_name,
        job_reference: form.job_reference || undefined,
        amount: Number(form.amount),
        due_date: form.due_date,
        status: form.status,
      });
      setForm({ client_name: "", job_reference: "", amount: "", due_date: "", status: "pending" });
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Invoice" subtitle="Add a new client invoice" size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Name *</label>
          <Input value={form.client_name} onChange={(e) => update("client_name", e.target.value)} placeholder="Company name" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Job Reference</label>
          <Input value={form.job_reference} onChange={(e) => update("job_reference", e.target.value)} placeholder="e.g. JOB-2024-0001" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount *</label>
            <Input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} placeholder="0.00" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Due Date *</label>
            <Input type="date" value={form.due_date} onChange={(e) => update("due_date", e.target.value)} required />
          </div>
        </div>
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => update("status", e.target.value)}
          options={[
            { value: "pending", label: "Pending" },
            { value: "paid", label: "Paid" },
            { value: "overdue", label: "Overdue" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create Invoice"}</Button>
        </div>
      </form>
    </Modal>
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
