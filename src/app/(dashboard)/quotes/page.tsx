"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, Download, List, LayoutGrid, Calendar, Map,
  FileText, BarChart3, Clock, ArrowRight,
  Send, CheckCircle2, RotateCcw, XCircle,
  Mail, Building2,
  Loader2, Eye, Trash2, Briefcase, Users, SlidersHorizontal, Save,
  ClipboardList, MapPin, Gavel, UserRound, Sparkles, ChevronDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Quote, Partner, Job, CatalogService } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listQuotes, createQuote, updateQuote, getQuote } from "@/services/quotes";
import { createJob, getJobByQuoteId, updateJob } from "@/services/jobs";
import { createInvoice } from "@/services/invoices";
import { listPartners } from "@/services/partners";
import { getBidsByQuoteId, approveBid, type QuoteBid } from "@/services/quote-bids";
import { getRequest } from "@/services/requests";
import { listAssignableUsers, type AssignableUser } from "@/services/profiles";
import { getStatusCounts, getAggregates, getSupabase, type ListParams, type ListResult } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { KanbanBoard } from "@/components/shared/kanban-board";
import { normalizeTotalPhases } from "@/lib/job-phases";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { estimatedValueFromCatalog } from "@/lib/catalog-service-defaults";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { isUuid } from "@/lib/utils";

const QUOTE_STATUSES = ["draft", "in_survey", "bidding", "awaiting_customer", "accepted", "rejected", "converted_to_job"] as const;

const statusLabels: Record<string, string> = {
  draft: "Draft",
  in_survey: "In Survey",
  bidding: "Bidding",
  awaiting_customer: "Awaiting Customer",
  accepted: "Accepted",
  rejected: "Rejected",
  converted_to_job: "Converted to Job",
};

const statusConfig: Record<string, { variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  draft: { variant: "default", dot: true },
  in_survey: { variant: "info", dot: true },
  bidding: { variant: "warning", dot: true },
  awaiting_customer: { variant: "primary", dot: true },
  accepted: { variant: "success", dot: true },
  rejected: { variant: "danger", dot: true },
  converted_to_job: { variant: "success", dot: true },
};

const statusSteps = ["Draft", "In Survey", "Bidding", "Awaiting Customer", "Accepted"];

/** Open pipeline: every status that still needs internal/customer work before job conversion. */
const PIPELINE_STATUS_IN = ["draft", "in_survey", "bidding", "awaiting_customer", "accepted"] as const;

async function listQuotesForPage(params: ListParams): Promise<ListResult<Quote>> {
  const { status, ...rest } = params;
  if (status === "pipeline") {
    return listQuotes({
      ...rest,
      status: undefined,
      statusIn: [...PIPELINE_STATUS_IN],
    });
  }
  return listQuotes({ ...params });
}

const STAGE_META: { id: string; label: string; short: string; icon: typeof ClipboardList }[] = [
  { id: "draft", label: "Draft", short: "Draft", icon: ClipboardList },
  { id: "in_survey", label: "Survey", short: "Survey", icon: MapPin },
  { id: "bidding", label: "Bidding", short: "Bids", icon: Gavel },
  { id: "awaiting_customer", label: "Customer", short: "Customer", icon: UserRound },
  { id: "accepted", label: "Accepted", short: "Won", icon: CheckCircle2 },
];

function QuoteStageColumn({ status }: { status: string }) {
  const stepMap: Record<string, number> = {
    draft: 0, in_survey: 1, bidding: 2, awaiting_customer: 3, accepted: 4, rejected: -1, converted_to_job: 5,
  };
  const current = stepMap[status] ?? 0;
  if (current === -1) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="danger" size="sm" className="w-fit">Rejected</Badge>
        <span className="text-[10px] text-text-tertiary">Closed</span>
      </div>
    );
  }
  if (current === 5) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="success" size="sm" className="w-fit">Job</Badge>
        <span className="text-[10px] text-text-tertiary">Converted</span>
      </div>
    );
  }
  const meta = STAGE_META[current] ?? STAGE_META[0];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        title={statusLabels[status] ?? status}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-text-tertiary leading-none">Stage {current + 1}/5</p>
        <p className="text-xs font-semibold text-text-primary truncate">{meta.label}</p>
      </div>
    </div>
  );
}

function getStageGuidance(status: string): {
  headline: string;
  detail: string;
  goToTab?: "overview" | "bids" | "send" | "history";
  goToLabel?: string;
} {
  switch (status) {
    case "draft":
      return {
        headline: "Fill client, property & price",
        detail: "Use the pipeline actions to move to Awaiting Customer. Bidding is optional if you already have partner cost / sell price.",
      };
    case "in_survey":
      return {
        headline: "Site survey in progress",
        detail: "When ready, use the pipeline actions to move to Awaiting Customer. You can also start Bidding if you want partner figures.",
      };
    case "bidding":
      return {
        headline: "Bids or your own figures",
        detail: "Partner bids are optional. If Overview already has the right partner cost and sell price, move to Awaiting Customer and send the email.",
      };
    case "awaiting_customer":
      return {
        headline: "Waiting on the customer",
        detail: "Use Send to Customer to email the PDF and accept/reject links if you have not yet.",
        goToTab: "send",
        goToLabel: "Open email",
      };
    case "accepted":
      return {
        headline: "Ready to convert",
        detail: "Create a job from this quote when you are ready to schedule work.",
      };
    case "rejected":
      return { headline: "Quote closed", detail: "You can reactivate from Draft or leave as lost." };
    case "converted_to_job":
      return { headline: "Converted to job", detail: "This quote is linked to a job in Jobs." };
    default:
      return { headline: "Quote", detail: "" };
  }
}

export default function QuotesPage() {
  const router = useRouter();
  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refresh,
  } = useSupabaseList<Quote>({
    fetcher: listQuotesForPage,
    realtimeTable: "quotes",
    initialStatus: "pipeline",
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [pipelineValue, setPipelineValue] = useState(0);
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterQuoteType, setFilterQuoteType] = useState<"all" | "internal" | "partner">("all");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const filteredQuotes = useMemo(() => {
    if (filterQuoteType === "all") return data;
    return data.filter((q) => (q.quote_type ?? "internal") === filterQuoteType);
  }, [data, filterQuoteType]);

  const quoteKanbanColumns = useMemo(() => {
    const ids = ["draft", "in_survey", "bidding", "awaiting_customer", "accepted"];
    return ids.map((id) => ({
      id,
      title: statusLabels[id] ?? id,
      color: id === "accepted" ? "bg-emerald-500" : id === "awaiting_customer" ? "bg-blue-500" : "bg-primary",
      items: filteredQuotes.filter((q) => q.status === id),
    }));
  }, [filteredQuotes]);

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("quotes", [...QUOTE_STATUSES]);
      setStatusCounts(counts);
    } catch { /* cosmetic */ }
  }, []);

  const loadAggregates = useCallback(async () => {
    try {
      const agg = await getAggregates("quotes", "total_value");
      setPipelineValue(agg.sum);
    } catch { /* cosmetic */ }
  }, []);

  useEffect(() => { loadCounts(); loadAggregates(); }, [loadCounts, loadAggregates]);

  const pipelineCount =
    (statusCounts.draft ?? 0) +
    (statusCounts.in_survey ?? 0) +
    (statusCounts.bidding ?? 0) +
    (statusCounts.awaiting_customer ?? 0) +
    (statusCounts.accepted ?? 0);

  const handleCreate = useCallback(async (formData: Partial<Quote>) => {
    try {
      const result = await createQuote({
        title: formData.title ?? "",
        client_id: formData.client_id,
        client_address_id: formData.client_address_id,
        client_name: formData.client_name ?? "",
        client_email: formData.client_email ?? "",
        catalog_service_id: formData.catalog_service_id && isUuid(String(formData.catalog_service_id).trim())
          ? String(formData.catalog_service_id).trim()
          : null,
        status: formData.status ?? "draft",
        total_value: formData.total_value ?? 0,
        partner_quotes_count: formData.partner_quotes_count ?? 0,
        cost: formData.cost ?? 0,
        sell_price: formData.sell_price ?? formData.total_value ?? 0,
        margin_percent: formData.margin_percent ?? 0,
        quote_type: formData.quote_type ?? "internal",
        deposit_required: 0,
        customer_accepted: false,
        customer_deposit_paid: false,
        partner_id: formData.partner_id,
        partner_name: formData.partner_name,
        property_address: formData.property_address,
        scope: formData.scope,
        partner_cost: formData.partner_cost ?? formData.cost ?? 0,
      });
      await logAudit({ entityType: "quote", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name });
      setCreateOpen(false);
      toast.success("Quote created successfully");
      refresh(); loadCounts(); loadAggregates();
    } catch { toast.error("Failed to create quote"); }
  }, [refresh, loadCounts, loadAggregates, profile?.id, profile?.full_name]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("quotes").update({ status: newStatus, updated_at: new Date().toISOString() }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("quote", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} quotes updated`);
      setSelectedIds(new Set());
      refresh();
    } catch { toast.error("Failed to update quotes"); }
  };

  const handleConfirmCreateJob = useCallback(
    async (formData: { title: string; client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string; createWithoutDeposit?: boolean; total_phases?: number }) => {
      if (!quoteToConvert) return;
      try {
        const margin = formData.client_price > 0 ? Math.round(((formData.client_price - formData.partner_cost - formData.materials_cost) / formData.client_price) * 1000) / 10 : 0;
        const noDeposit = !!formData.createWithoutDeposit;
        const scheduledDeposit = noDeposit ? 0 : (quoteToConvert.deposit_required ?? 0);
        const scheduledFinal = Math.max(0, formData.client_price - scheduledDeposit);
        const job = await createJob({
          title: formData.title,
          client_id: formData.client_id,
          client_address_id: formData.client_address_id,
          client_name: formData.client_name,
          property_address: formData.property_address,
          partner_id: formData.partner_id ?? quoteToConvert.partner_id,
          partner_name: formData.partner_name ?? quoteToConvert.partner_name,
          quote_id: quoteToConvert.id,
          status: "scheduled",
          progress: 0, current_phase: 0, total_phases: normalizeTotalPhases(formData.total_phases),
          client_price: formData.client_price,
          extras_amount: 0,
          partner_cost: formData.partner_cost,
          materials_cost: formData.materials_cost,
          margin_percent: margin,
          scheduled_date: formData.scheduled_date,
          scheduled_start_at: formData.scheduled_start_at,
          owner_id: profile?.id, owner_name: profile?.full_name,
          cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
          partner_agreed_value: quoteToConvert.partner_cost ?? 0,
          finance_status: "unpaid",
          service_value: formData.client_price,
          report_submitted: false,
          report_1_uploaded: false, report_1_approved: false,
          report_2_uploaded: false, report_2_approved: false,
          report_3_uploaded: false, report_3_approved: false,
          partner_payment_1: 0, partner_payment_1_paid: false,
          partner_payment_2: 0, partner_payment_2_paid: false,
          partner_payment_3: 0, partner_payment_3_paid: false,
          customer_deposit: scheduledDeposit,
          customer_deposit_paid: noDeposit,
          customer_final_payment: scheduledFinal,
          customer_final_paid: false,
          scope: quoteToConvert.scope,
        });

        const dueStr = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
        let depositInvId: string | null = null;
        let finalInvId: string | null = null;

        if (scheduledDeposit > 0.01) {
          const dep = await createInvoice({
            client_name: formData.client_name,
            job_reference: job.reference,
            amount: scheduledDeposit,
            status: "pending",
            due_date: dueStr,
            collection_stage: "awaiting_deposit",
            invoice_kind: "deposit",
          });
          depositInvId = dep.id;
        }
        if (scheduledFinal > 0.01) {
          const fin = await createInvoice({
            client_name: formData.client_name,
            job_reference: job.reference,
            amount: scheduledFinal,
            status: "pending",
            due_date: dueStr,
            collection_stage: scheduledDeposit > 0.01 ? "awaiting_deposit" : "awaiting_final",
            invoice_kind: "final",
          });
          finalInvId = fin.id;
        }

        const primaryInvoiceId = depositInvId ?? finalInvId;
        if (primaryInvoiceId) {
          await updateJob(job.id, { invoice_id: primaryInvoiceId });
        }

        await updateQuote(quoteToConvert.id, { status: "converted_to_job" });
        await logAudit({ entityType: "job", entityId: job.id, entityRef: job.reference, action: "created", metadata: { from_quote: quoteToConvert.reference }, userId: profile?.id, userName: profile?.full_name });
        setQuoteToConvert(null); setSelectedQuote(null);
        toast.success(`Job ${job.reference} created`);
        refresh(); loadCounts();
        router.push(`/jobs?jobId=${job.id}`);
      } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create job"); }
    },
    [quoteToConvert, refresh, loadCounts, profile?.id, profile?.full_name, router]
  );

  const handleStatusChange = useCallback(
    async (quote: Quote, newStatus: string): Promise<boolean> => {
      if (newStatus === "create_job") {
        setQuoteToConvert(quote);
        return true;
      }
      const check = canAdvanceQuote(quote, newStatus);
      if (!check.ok) {
        toast.error(check.message ?? "Complete the current step before advancing.");
        return false;
      }
      if (newStatus === "awaiting_customer" && (quote.margin_percent ?? 0) < 25 && (quote.margin_percent ?? 0) > 0) {
        if (typeof window !== "undefined" && !window.confirm("Margin is below 25%. Send quote to customer anyway?")) {
          return false;
        }
      }
      try {
        const updated = await updateQuote(quote.id, { status: newStatus as Quote["status"] });
        await logAudit({ entityType: "quote", entityId: quote.id, entityRef: quote.reference, action: "status_changed", fieldName: "status", oldValue: quote.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
        setSelectedQuote(updated);
        toast.success(`Quote moved to ${statusLabels[newStatus] ?? newStatus}`);
        refresh(); loadCounts();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update quote";
        toast.error(message);
        console.error("Quote status update failed:", err);
        return false;
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const handleExport = useCallback(() => {
    const csv = ["Reference,Title,Client,Status,Value,Owner"]
      .concat(data.map((q) => `${q.reference},"${q.title}","${q.client_name}",${q.status},${q.total_value},${q.owner_name ?? ""}`))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "quotes_export.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Quotes exported to CSV");
  }, [data]);

  const handleNewQuoteClick = () => setCreateOpen(true);

  const columns: Column<Quote>[] = [
    {
      key: "reference", label: "Quote", width: "200px",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
          <p className="text-[11px] text-text-tertiary truncate max-w-[180px]">{item.title}</p>
        </div>
      ),
    },
    {
      key: "client_name", label: "Client",
      render: (item) => (
        <div className="flex items-center gap-2">
          <Avatar name={item.client_name} size="sm" />
          <span className="text-sm text-text-primary font-medium">{item.client_name}</span>
        </div>
      ),
    },
    {
      key: "quote_type", label: "Type",
      render: (item) => (
        <Badge variant={item.quote_type === "partner" ? "warning" : "info"} size="sm">
          {item.quote_type === "partner" ? "Partner" : "Internal"}
        </Badge>
      ),
    },
    {
      key: "status", label: "Stage",
      render: (item) => <QuoteStageColumn status={item.status} />,
    },
    {
      key: "total_value", label: "Value", align: "right" as const,
      render: (item) => <span className="text-sm font-semibold text-text-primary">{formatCurrency(item.total_value)}</span>,
    },
    {
      key: "margin_percent", label: "Margin",
      render: (item) => item.margin_percent ? (
        <span className={`text-xs font-semibold ${item.margin_percent >= 30 ? "text-emerald-600" : item.margin_percent >= 20 ? "text-amber-600" : "text-red-500"}`}>
          {item.margin_percent}%
        </span>
      ) : <span className="text-xs text-text-tertiary">—</span>,
    },
    {
      key: "actions", label: "", width: "40px",
      render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors" />,
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Quotes"
          subtitle="Work one stage at a time: Draft → Survey → Bidding → Customer → Accepted. Use Active pipeline to see open quotes only."
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>Export</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleNewQuoteClick}>New Quote</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Pipeline Value" value={pipelineValue} format="currency" change={12.5} changeLabel="vs last month" icon={BarChart3} accent="primary" />
          <KpiCard title="Total Quotes" value={statusCounts.all ?? 0} format="number" icon={FileText} accent="blue" />
          <KpiCard title="Accepted" value={statusCounts.accepted ?? 0} format="number" icon={CheckCircle2} accent="emerald" />
          <KpiCard title="Awaiting Customer" value={statusCounts.awaiting_customer ?? 0} format="number" icon={Clock} accent="amber" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="rounded-2xl border border-border-light bg-card/70 p-4 mb-4 space-y-3">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-text-primary">Pick a stage to focus the list</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  <strong className="text-text-secondary">Active pipeline</strong> shows quotes still in play (not rejected or converted).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStatus("pipeline")}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all",
                  status === "pipeline"
                    ? "border-primary bg-primary text-white shadow-sm"
                    : "border-border-light bg-surface-hover hover:border-primary/40 text-text-secondary"
                )}
              >
                <span className="text-xs font-bold">Active pipeline</span>
                <span className={cn("text-[11px] font-bold tabular-nums", status === "pipeline" ? "text-white/90" : "text-text-tertiary")}>
                  {pipelineCount}
                </span>
              </button>
              {STAGE_META.map((s) => {
                const c = statusCounts[s.id] ?? 0;
                const active = status === s.id;
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatus(s.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl border px-3 py-2 transition-all min-w-[7rem]",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border-light bg-card hover:border-primary/30 text-text-secondary"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                    <span className="text-xs font-semibold truncate">{s.label}</span>
                    <span className={cn("ml-auto text-[11px] font-bold tabular-nums", active ? "text-primary" : "text-text-tertiary")}>{c}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-border-light/80">
              <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">More</span>
              {[
                { id: "all", label: "All quotes" },
                { id: "rejected", label: "Rejected" },
                { id: "converted_to_job", label: "Converted" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStatus(t.id)}
                  className={cn(
                    "text-xs font-medium rounded-lg px-2 py-1 transition-colors",
                    status === t.id ? "bg-surface-tertiary text-text-primary" : "text-text-tertiary hover:text-primary"
                  )}
                >
                  {t.label}
                  <span className="text-[10px] text-text-tertiary ml-1 tabular-nums">
                    ({t.id === "all" ? statusCounts.all ?? 0 : statusCounts[t.id] ?? 0})
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-text-tertiary hidden sm:block">
              {status === "pipeline" && "Showing: draft through accepted · "}
              {status !== "pipeline" && status !== "all" && `Filtered by: ${statusLabels[status] ?? status} · `}
              {status === "all" && "Showing every quote · "}
              Use the view toggles for list, board, or calendar.
            </p>
            <div className="flex items-center gap-2 sm:ml-auto">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: Map }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <SearchInput placeholder="Search quotes..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="relative" ref={filterRef}>
                <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>Filter</Button>
                {filterQuoteType !== "all" && <span className="ml-1 text-[10px] font-medium text-primary">Active</span>}
                {filterOpen && (
                  <div className="absolute top-full right-0 mt-1 w-48 rounded-xl border border-border bg-card shadow-lg z-50 p-3">
                    <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Quote type</p>
                    <select value={filterQuoteType} onChange={(e) => setFilterQuoteType(e.target.value as "all" | "internal" | "partner")} className="w-full h-8 rounded-lg border border-border bg-card text-sm px-2">
                      <option value="all">All</option>
                      <option value="internal">Internal</option>
                      <option value="partner">Partner</option>
                    </select>
                    <Button variant="ghost" size="sm" className="w-full mt-2" onClick={() => setFilterQuoteType("all")}>Clear</Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {viewMode === "list" && (
            <DataTable columns={columns} data={data} getRowId={(item) => item.id} loading={loading} selectedId={selectedQuote?.id} onRowClick={setSelectedQuote} page={page} totalPages={totalPages} totalItems={totalItems} onPageChange={setPage} selectable selectedIds={selectedIds} onSelectionChange={setSelectedIds}
              bulkActions={
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  <BulkBtn label="Bidding" onClick={() => handleBulkStatusChange("bidding")} variant="default" />
                  <BulkBtn label="Awaiting Customer" onClick={() => handleBulkStatusChange("awaiting_customer")} variant="warning" />
                  <BulkBtn label="Accept" onClick={() => handleBulkStatusChange("accepted")} variant="success" />
                  <BulkBtn label="Reject" onClick={() => handleBulkStatusChange("rejected")} variant="danger" />
                </div>
              }
            />
          )}
          {viewMode === "kanban" && (
            <div className="min-h-[400px]">
              {loading ? <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div> : (
                <KanbanBoard columns={quoteKanbanColumns} getCardId={(q) => q.id} onCardClick={setSelectedQuote}
                  renderCard={(q) => (
                    <div className="p-3 rounded-xl border border-border bg-card shadow-sm hover:border-primary/30 transition-colors">
                      <p className="text-sm font-semibold text-text-primary truncate">{q.reference}</p>
                      <p className="text-xs text-text-tertiary truncate">{q.title}</p>
                      <p className="text-[11px] text-text-secondary mt-1">{q.client_name}</p>
                      <p className="text-xs font-medium text-primary mt-1">{formatCurrency(q.total_value)}</p>
                    </div>
                  )}
                />
              )}
            </div>
          )}
          {viewMode === "calendar" && <QuotesCalendarView quotes={filteredQuotes} loading={loading} onSelectQuote={setSelectedQuote} />}
          {viewMode === "map" && <QuotesCardGridView quotes={filteredQuotes} loading={loading} onSelectQuote={setSelectedQuote} />}
        </motion.div>
      </div>

      <QuoteDetailDrawer quote={selectedQuote} onClose={() => setSelectedQuote(null)} onStatusChange={handleStatusChange} onQuoteUpdate={(q) => { setSelectedQuote(q); refresh(); }} />
      <CreateJobFromQuoteModal quote={quoteToConvert} onClose={() => setQuoteToConvert(null)} onSubmit={handleConfirmCreateJob} />
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Quote" subtitle="Add line items and optionally request partner bids" size="lg">
        <CreateQuoteForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </PageTransition>
  );
}

/* ========== QUOTE DETAIL DRAWER ========== */
function QuoteDetailDrawer({ quote, onClose, onStatusChange, onQuoteUpdate }: {
  quote: Quote | null;
  onClose: () => void;
  onStatusChange: (quote: Quote, status: string) => void | Promise<boolean>;
  onQuoteUpdate?: (updated: Quote) => void;
}) {
  const { profile } = useProfile();
  const [tab, setTab] = useState("overview");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendEmail, setSendEmail] = useState("");
  const [lineItems, setLineItems] = useState<{ description: string; quantity: string; unitPrice: string }[]>([]);
  const [scopeText, setScopeText] = useState("");
  const [convertedJob, setConvertedJob] = useState<Job | null>(null);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [bids, setBids] = useState<QuoteBid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [panelPartnerCost, setPanelPartnerCost] = useState("");
  const [panelSellPrice, setPanelSellPrice] = useState("");
  const [panelSaving, setPanelSaving] = useState(false);
  const [proposalSaving, setProposalSaving] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (!quote) return;
    setTab(quote.quote_type === "partner" ? "bids" : "overview");
  }, [quote?.id, quote?.quote_type]);

  useEffect(() => {
    if (!quote) return;
    setPricingOpen(["draft", "in_survey", "bidding"].includes(quote.status));
  }, [quote?.id, quote?.status]);

  // Send to customer fields
  const [depositRequired, setDepositRequired] = useState("");
  const [startDate1, setStartDate1] = useState("");
  const [startDate2, setStartDate2] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [previewLinks, setPreviewLinks] = useState<{ acceptUrl: string; rejectUrl: string } | null>(null);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (quote) {
      setSendEmail(quote.client_email ?? "");
      setSendState("idle");
      setLineItems([{ description: quote.title ?? "", quantity: "1", unitPrice: String(quote.total_value ?? 0) }]);
      setScopeText(quote.scope ?? "");
      setDepositRequired(String(quote.deposit_required ?? 0));
      setStartDate1(quote.start_date_option_1 ?? "");
      setStartDate2(quote.start_date_option_2 ?? "");
      setCustomMessage(quote.email_custom_message ?? "");
      setPanelPartnerCost(String(quote.partner_cost ?? quote.cost ?? 0));
      setPanelSellPrice(String(quote.sell_price ?? quote.total_value ?? 0));
      loadLineItems(quote.id);
    }
  }, [quote]);

  useEffect(() => {
    if (quote?.id && (quote?.status === "accepted" || quote?.status === "converted_to_job")) {
      getJobByQuoteId(quote.id).then(setConvertedJob);
    } else { setConvertedJob(null); }
  }, [quote?.id, quote?.status]);

  useEffect(() => {
    if (tab !== "send" || !quote?.id) return;
    const timer = setTimeout(() => {
      setPreviewLoading(true);
      const recipientName = quote.client_name ?? "";
      const items = lineItems.map((li) => {
        const qty = Number(li.quantity) || 1;
        const unit = Number(li.unitPrice) || 0;
        return { description: li.description, quantity: qty, unitPrice: unit, total: qty * unit };
      });
      Promise.all([
        fetch(`/api/quotes/preview-links?quoteId=${encodeURIComponent(quote.id)}`).then((r) => r.ok ? r.json() : null),
        fetch("/api/quotes/email-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: quote.id,
            recipientName,
            customMessage: customMessage.trim() || undefined,
            items,
            depositRequired: Number(depositRequired) || 0,
            scope: scopeText.trim() || undefined,
          }),
        }).then((r) => r.ok ? r.text() : null),
      ])
        .then(([links, html]) => {
          setPreviewLinks(links ?? null);
          setEmailPreviewHtml(html ?? null);
        })
        .catch(() => {
          setPreviewLinks(null);
          setEmailPreviewHtml(null);
        })
        .finally(() => setPreviewLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [tab, quote?.id, quote?.client_name, customMessage, lineItems, depositRequired, scopeText]);

  const loadLineItems = async (quoteId: string) => {
    const supabase = getSupabase();
    const { data } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).order("sort_order");
    if (data && data.length > 0) {
      setLineItems(data.map((li: { description: string; quantity: number; unit_price: number }) => ({
        description: li.description, quantity: String(li.quantity), unitPrice: String(li.unit_price),
      })));
    }
  };

  const loadPartners = useCallback(async () => {
    const res = await listPartners({ pageSize: 200, status: "all" });
    setPartners(res.data ?? []);
  }, []);

  useEffect(() => {
    if (invitePartnerOpen) { loadPartners(); setSelectedPartnerIds(new Set()); }
  }, [invitePartnerOpen, loadPartners]);

  const loadBids = useCallback(async (quoteId: string) => {
    setBidsLoading(true);
    try {
      const list = await getBidsByQuoteId(quoteId);
      setBids(list);
    } finally {
      setBidsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (quote?.id && tab === "bids") loadBids(quote.id);
  }, [quote?.id, tab, loadBids]);

  useEffect(() => {
    if (!isAdmin) return;
    listAssignableUsers().then(setAssignableUsers).catch(() => {});
  }, [isAdmin]);

  const handleDrawerSellFromMargin = useCallback((v: number) => {
    setPanelSellPrice(String(v));
  }, []);

  const handleDrawerMarginPct = useCallback(() => {}, []);

  const drawerInitialMarginPct = useMemo(() => {
    if (!quote) return 40;
    const sp = Number(quote.sell_price ?? quote.total_value ?? 0);
    const pc = Number(quote.partner_cost ?? quote.cost ?? 0);
    const raw = sp > 0 ? Math.round(((sp - pc) / sp) * 1000) / 10 : 40;
    return Math.min(60, Math.max(5, raw));
  }, [quote]);

  if (!quote) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[quote.status] ?? { variant: "default" as const };
  const actions = getQuoteActions(quote.status);
  const stepMap: Record<string, number> = { draft: 0, in_survey: 1, bidding: 2, awaiting_customer: 3, accepted: 4, rejected: -1, converted_to_job: 5 };
  const currentStep = stepMap[quote.status] ?? 0;
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);

  // Email flow step-by-step (only relevant when quote.status === "awaiting_customer")
  const sendStep1Ready = scopeText.trim().length > 0 || lineItems.some((li) => li.description.trim().length > 0);
  const sendStep2Ready = !!startDate1 || !!startDate2;
  const sendDepositNumber = Number(depositRequired);
  const sendStep3Ready =
    sendDepositNumber >= 0 &&
    !Number.isNaN(sendDepositNumber) &&
    sendEmail.trim().includes("@");
  const sendCurrentStep = !sendStep1Ready ? 1 : !sendStep2Ready ? 2 : !sendStep3Ready ? 3 : 4;

  const drawerTabs = [
    { id: "overview", label: "Overview" },
    { id: "bids", label: "Bids" },
    ...(quote.status === "awaiting_customer" ? [{ id: "send", label: "Email" }] : []),
    { id: "history", label: "History" },
  ];

  const guidance = getStageGuidance(quote.status);

  const addLineItem = () => setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0" }]);
  const removeLineItem = (idx: number) => setLineItems((prev) => prev.filter((_, i) => i !== idx));
  const updateLineItem = (idx: number, field: string, value: string) => setLineItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const persistProposalToQuote = async (): Promise<Quote> => {
    const supabase = getSupabase();
    await supabase.from("quote_line_items").delete().eq("quote_id", quote.id);
    const rows = lineItems.map((li, i) => ({
      quote_id: quote.id,
      description: li.description,
      quantity: Number(li.quantity) || 1,
      unit_price: Number(li.unitPrice) || 0,
      sort_order: i,
    }));
    if (rows.length > 0) await supabase.from("quote_line_items").insert(rows);
    return updateQuote(quote.id, {
      total_value: lineTotal,
      scope: scopeText.trim() || undefined,
      deposit_required: Number(depositRequired) || 0,
      start_date_option_1: startDate1 || undefined,
      start_date_option_2: startDate2 || undefined,
      client_email: sendEmail.trim(),
      email_custom_message: customMessage.trim() || null,
    });
  };

  const saveProposalDraft = async () => {
    setProposalSaving(true);
    try {
      const updated = await persistProposalToQuote();
      onQuoteUpdate?.(updated);
      toast.success("Proposal saved on this quote");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save proposal");
    } finally {
      setProposalSaving(false);
    }
  };

  const saveLineItems = saveProposalDraft;

  const handleSendToCustomer = async () => {
    if (!sendEmail) { toast.error("Enter a recipient email"); return; }
    setSendState("sending");
    try {
      await persistProposalToQuote();
      const items = lineItems.map((li) => {
        const qty = Number(li.quantity) || 1;
        const unit = Number(li.unitPrice) || 0;
        return { description: li.description, quantity: qty, unitPrice: unit, total: qty * unit };
      });
      const res = await fetch("/api/quotes/send-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.id,
          recipientEmail: sendEmail,
          recipientName: quote.client_name,
          customMessage: customMessage.trim() || undefined,
          items: items.length ? items : undefined,
          scope: scopeText.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send email");
      }
      if (!data.emailSent) {
        toast.warning(data.reason ?? "Quote updated but email was not sent");
      } else {
        toast.success(`Quote with PDF sent to ${sendEmail}. Customer can Accept or Reject via the email link.`);
      }
      setSendState("sent");
      if (data.emailSent && onQuoteUpdate && data.sentTo) {
        const updated = await getQuote(quote.id);
        if (updated) onQuoteUpdate(updated);
      }
    } catch (err) {
      setSendState("idle");
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <Drawer open={!!quote} onClose={onClose} title={quote.reference} subtitle={quote.title} width="w-[540px]">
      <div className="flex flex-col h-full">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} className="px-6 pt-2" />
        {guidance.headline && (
          <div className="mx-6 mt-3 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex gap-3 min-w-0">
              <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{guidance.headline}</p>
                {guidance.detail ? <p className="text-xs text-text-tertiary mt-0.5">{guidance.detail}</p> : null}
              </div>
            </div>
            {guidance.goToTab && guidance.goToLabel && tab !== guidance.goToTab && (
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => setTab(guidance.goToTab!)}>
                {guidance.goToLabel}
              </Button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">

          {/* OVERVIEW TAB: Status + Details together */}
          {tab === "overview" && (
            <div className="p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-light bg-surface-hover/80 px-4 py-3">
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Current stage</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={config.variant} dot={config.dot} size="sm">
                      {statusLabels[quote.status] ?? quote.status}
                    </Badge>
                    {currentStep >= 0 && currentStep < 5 && (
                      <span className="text-[11px] text-text-tertiary">Step {Math.min(currentStep + 1, 5)} of 5</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {statusSteps.map((step, i) => {
                    const isActive = i === currentStep && currentStep >= 0 && currentStep < 5;
                    const isPast = i < currentStep && currentStep >= 0 && currentStep < 5;
                    return (
                      <div
                        key={step}
                        title={step}
                        className={cn(
                          "h-2 w-6 rounded-full transition-colors",
                          isActive ? "bg-primary" : isPast ? "bg-primary/40" : "bg-border"
                        )}
                      />
                    );
                  })}
                </div>
              </div>
              {(quote.status === "rejected" || quote.status === "converted_to_job") && (
                <div className="rounded-xl border border-border-light p-4 space-y-2">
                  {quote.status === "rejected" && (
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                        <XCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-red-600">Rejected</p>
                        {quote.rejection_reason && <p className="text-xs text-text-tertiary mt-1">{quote.rejection_reason}</p>}
                      </div>
                    </div>
                  )}
                  {quote.status === "converted_to_job" && (
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <Briefcase className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-emerald-600">Converted to job</p>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-surface-hover">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total value</p>
                  <p className="text-xl font-bold text-text-primary mt-1">{formatCurrency(quote.total_value)}</p>
                </div>
                <div className="p-4 rounded-xl bg-surface-hover">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Bids received</p>
                  <p className="text-xl font-bold text-text-primary mt-1">{quote.partner_quotes_count}</p>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Owner</p>
                {isAdmin ? (
                  <div className="mt-2">
                    <JobOwnerSelect
                      value={quote.owner_id}
                      fallbackName={quote.owner_name}
                      users={assignableUsers}
                      disabled={savingOwner}
                      onChange={async (ownerId) => {
                        const owner = assignableUsers.find((u) => u.id === ownerId);
                        setSavingOwner(true);
                        try {
                          const updated = await updateQuote(quote.id, {
                            owner_id: ownerId,
                            owner_name: owner?.full_name,
                          });
                          onQuoteUpdate?.(updated);
                          toast.success("Owner updated");
                        } catch {
                          toast.error("Failed to update owner");
                        } finally {
                          setSavingOwner(false);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-text-primary mt-1">{quote.owner_name || "No owner"}</p>
                )}
              </div>

              {/* Pricing & margin — collapsed by default so the drawer feels guided, not overwhelming */}
              <details
                key={`pricing-${quote.id}`}
                className="group rounded-xl border border-border-light bg-gradient-to-br from-stone-50 to-stone-100/50 open:shadow-sm"
                open={pricingOpen}
                onToggle={(e) => setPricingOpen(e.currentTarget.open)}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2 min-w-0">
                    <SlidersHorizontal className="h-4 w-4 shrink-0 text-text-tertiary" />
                    <span className="text-xs font-semibold text-text-secondary">Pricing & margin</span>
                    <span className="text-[10px] text-text-tertiary truncate">Partner cost, margin slider, save</span>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border-light px-4 pb-4 space-y-3">
                <div className="pt-1">
                  <p className="text-[10px] text-text-tertiary uppercase mb-1">Partner cost</p>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={panelPartnerCost}
                    onChange={(e) => setPanelPartnerCost(e.target.value)}
                    className="text-sm font-semibold h-9 max-w-[200px]"
                  />
                </div>
                <MarginCalculator
                  key={`margin-drawer-${quote.id}-${quote.updated_at}`}
                  cost={Number(panelPartnerCost) || 0}
                  initialMarginPct={drawerInitialMarginPct}
                  onSellPriceChange={handleDrawerSellFromMargin}
                  onMarginChange={handleDrawerMarginPct}
                />
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-3 w-full"
                  disabled={panelSaving}
                  icon={panelSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
                  onClick={async () => {
                    const pc = Number(panelPartnerCost) || 0;
                    const sp = Number(panelSellPrice) || 0;
                    const marginPct = sp > 0 ? Math.round(((sp - pc) / sp) * 1000) / 10 : 0;
                    const oldSummary = `Partner £${Number(quote.partner_cost ?? quote.cost ?? 0).toFixed(2)}, Sell £${Number(quote.sell_price ?? quote.total_value ?? 0).toFixed(2)}, Margin ${quote.margin_percent ?? 0}%`;
                    const newSummary = `Partner £${pc.toFixed(2)}, Sell £${sp.toFixed(2)}, Margin ${marginPct}%`;
                    setPanelSaving(true);
                    try {
                      const updated = await updateQuote(quote.id, { partner_cost: pc, sell_price: sp, margin_percent: marginPct, total_value: sp });
                      await logAudit({
                        entityType: "quote",
                        entityId: quote.id,
                        entityRef: quote.reference,
                        action: "updated",
                        fieldName: "quote_figures",
                        oldValue: oldSummary,
                        newValue: newSummary,
                        userId: profile?.id,
                        userName: profile?.full_name,
                        metadata: { partner_cost: pc, sell_price: sp, margin_percent: marginPct },
                      });
                      onQuoteUpdate?.(updated);
                      toast.success("Quote figures updated");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed to update");
                    } finally {
                      setPanelSaving(false);
                    }
                  }}
                >
                  {panelSaving ? "Saving..." : "Save quote figures"}
                </Button>
                </div>
              </details>

              <div>
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
                <div className="flex items-center gap-3 mt-2">
                  <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center"><Building2 className="h-5 w-5 text-blue-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{quote.client_name}</p>
                    {quote.client_email && <div className="flex items-center gap-1 mt-0.5"><Mail className="h-3 w-3 text-text-tertiary" /><p className="text-xs text-text-tertiary">{quote.client_email}</p></div>}
                  </div>
                </div>
              </div>

              <Button variant="outline" size="sm" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setInvitePartnerOpen(true)} className="w-full">
                Invite more partners
              </Button>

              {convertedJob && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-2"><Briefcase className="h-4 w-4 text-emerald-600" /><label className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Converted to Job</label></div>
                  <a href={`/jobs?jobId=${convertedJob.id}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/50 text-sm font-semibold text-primary">
                    <Briefcase className="h-4 w-4" /> {convertedJob.reference}
                  </a>
                </div>
              )}

              {["draft", "in_survey", "bidding"].includes(quote.status) && (
                <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-text-primary">Customer proposal (required before Send to Customer)</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      Fill scope, line items, dates, deposit and email here first. Then use <strong className="text-text-secondary">Send to Customer</strong> below to move to Awaiting Customer and open the Email tab to preview and send.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope / line items</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={addLineItem} className="text-[11px] font-medium text-primary hover:underline">+ Add item</button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {lineItems.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-start p-3 bg-surface-hover rounded-xl">
                          <div className="flex-1">
                            <Input placeholder="Service / description" value={item.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)} className="text-xs mb-1.5" />
                            <div className="flex gap-2">
                              <Input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} className="text-xs w-20" />
                              <Input type="number" placeholder="Unit price" value={item.unitPrice} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)} className="text-xs flex-1" />
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 pt-1">
                            <span className="text-xs font-semibold text-text-primary">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</span>
                            {lineItems.length > 1 && (
                              <button type="button" onClick={() => removeLineItem(idx)} className="text-text-tertiary hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end mt-2 pt-2 border-t border-border-light">
                      <span className="text-sm font-bold text-text-primary">Total: {formatCurrency(lineTotal)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Scope of work (for email / PDF)</label>
                    <textarea
                      value={scopeText}
                      onChange={(e) => setScopeText(e.target.value)}
                      placeholder="Describe scope, inclusions and exclusions..."
                      rows={4}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 1</label>
                      <Input type="date" value={startDate1} onChange={(e) => setStartDate1(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 2</label>
                      <Input type="date" value={startDate2} onChange={(e) => setStartDate2(e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Deposit required</label>
                    <Input type="number" value={depositRequired} onChange={(e) => setDepositRequired(e.target.value)} placeholder="0.00" min={0} step="0.01" />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Customer email</label>
                    <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="client@company.com" />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Personal message (optional)</label>
                    <textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Add a short message that will appear in the email before the Accept/Reject buttons..."
                      rows={3}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={proposalSaving}
                      onClick={() => void saveProposalDraft()}
                      icon={proposalSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    >
                      {proposalSaving ? "Saving…" : "Save proposal"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className={cn("rounded-md px-2 py-0.5", sendStep1Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>1 Scope / items</span>
                    <span className={cn("rounded-md px-2 py-0.5", sendStep2Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>2 Start dates</span>
                    <span className={cn("rounded-md px-2 py-0.5", sendStep3Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>3 Deposit & email</span>
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-4 border-t border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Move this quote</p>
                <p className="text-[11px] text-text-tertiary -mt-1 mb-1">
                  After the proposal above is complete, use <strong className="text-text-secondary">Send to Customer</strong> to move to Awaiting Customer — the Email tab opens to preview and send the PDF.
                </p>
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action.status}
                      variant={action.primary ? "primary" : "outline"}
                      size="sm"
                      disabled={proposalSaving}
                      icon={<action.icon className="h-3.5 w-3.5" />}
                      onClick={async () => {
                        if (action.status !== "awaiting_customer") {
                          const result = await Promise.resolve(onStatusChange(quote, action.status));
                          if (result === false) return;
                          return;
                        }
                        if (!sendStep1Ready || !sendStep2Ready || !sendStep3Ready) {
                          toast.error("Complete the customer proposal above (scope or line items, at least one start date, deposit, and customer email).");
                          return;
                        }
                        setProposalSaving(true);
                        try {
                          const updated = await persistProposalToQuote();
                          onQuoteUpdate?.(updated);
                          const result = await Promise.resolve(onStatusChange(updated, "awaiting_customer"));
                          if (result === false) return;
                          setTab("send");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to save proposal");
                        } finally {
                          setProposalSaving(false);
                        }
                      }}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* BIDS TAB — Partner bids from app; approve to set quote partner */}
          {tab === "bids" && (
            <div className="p-6 space-y-5">
              <div className="p-4 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-sm font-semibold text-text-primary">Partner bids (from app)</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  Optional: when partners bid from the app, approve one to set partner and cost. If you already use your own figures on Overview, you can skip bids and use{" "}
                  <strong className="text-text-secondary">Send to Customer</strong> from the pipeline actions.
                </p>
              </div>
              {bidsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : bids.length === 0 ? (
                <p className="text-sm text-text-tertiary">
                  No partner bids yet — that&apos;s fine. Set partner cost and sell price on Overview, then move to <strong className="text-text-secondary">Awaiting Customer</strong> and send the email.
                </p>
              ) : (
                <div className="space-y-3">
                  {bids.map((bid) => (
                    <div key={bid.id} className="flex items-center justify-between p-4 rounded-xl bg-surface-hover border border-border-light">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{bid.partner_name ?? bid.partner_id}</p>
                        <p className="text-lg font-bold text-primary mt-0.5">{formatCurrency(bid.bid_amount)}</p>
                        {bid.notes && <p className="text-xs text-text-tertiary mt-1">{bid.notes}</p>}
                        <Badge variant={bid.status === "approved" ? "success" : bid.status === "rejected" ? "danger" : "default"} size="sm" className="mt-2">{bid.status}</Badge>
                      </div>
                      {bid.status === "submitted" && (
                        <Button size="sm" variant="primary" onClick={async () => {
                          try {
                            await approveBid(bid.id, quote.id, bid.partner_id, bid.partner_name, bid.bid_amount);
                            await updateQuote(quote.id, { status: "accepted" });
                            await loadBids(quote.id);
                            toast.success("Bid approved. Quote partner set — status set to Accepted.");
                            onStatusChange(quote, "accepted");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to approve bid");
                          }
                        }}>
                          Approve
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SEND TO CUSTOMER TAB */}
          {tab === "send" && quote.status === "awaiting_customer" && (
            <div className="p-6 space-y-5">
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Send to Customer</p>
                    <p className="text-xs text-text-tertiary mt-0.5">Step {sendCurrentStep} of 4</p>
                  </div>
                  <div className="flex gap-1 pt-0.5">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-2 w-8 rounded-full",
                          i < sendCurrentStep ? "bg-primary/50" : i === sendCurrentStep ? "bg-primary" : "bg-border"
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className={cn("font-medium", sendStep1Ready ? "text-primary" : "text-text-tertiary")}>Step 1: Scope / line items</span>
                    <span className="text-text-tertiary">{sendStep1Ready ? "Ready" : "Pending"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cn("font-medium", sendStep2Ready ? "text-primary" : "text-text-tertiary")}>Step 2: Start date options</span>
                    <span className="text-text-tertiary">{sendStep2Ready ? "Ready" : "Pending"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cn("font-medium", sendStep3Ready ? "text-primary" : "text-text-tertiary")}>Step 3: Deposit & customer email</span>
                    <span className="text-text-tertiary">{sendStep3Ready ? "Ready" : "Pending"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cn("font-medium", sendStep3Ready ? "text-primary" : "text-text-tertiary")}>Step 4: Preview & send</span>
                    <span className="text-text-tertiary">{sendStep3Ready ? "Ready when preview loads" : "Complete step 3 first"}</span>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope / Line Items</label>
                  <div className="flex gap-2">
                    <button onClick={addLineItem} className="text-[11px] font-medium text-primary hover:underline">+ Add Item</button>
                    <button onClick={saveLineItems} className="text-[11px] font-medium text-emerald-600 hover:underline">Save</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-start p-3 bg-surface-hover rounded-xl">
                      <div className="flex-1">
                        <Input placeholder="Service / Description" value={item.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)} className="text-xs mb-1.5" />
                        <div className="flex gap-2">
                          <Input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} className="text-xs w-20" />
                          <Input type="number" placeholder="Unit price" value={item.unitPrice} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)} className="text-xs flex-1" />
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 pt-1">
                        <span className="text-xs font-semibold text-text-primary">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</span>
                        {lineItems.length > 1 && <button onClick={() => removeLineItem(idx)} className="text-text-tertiary hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-2 pt-2 border-t border-border-light">
                  <span className="text-sm font-bold text-text-primary">Total: {formatCurrency(lineTotal)}</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Scope of Work (for email/PDF)</label>
                <textarea
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                  placeholder="Describe scope, inclusions and exclusions..."
                  rows={4}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>

              {/* Start Date Options (2 dates) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 1</label>
                  <Input type="date" value={startDate1} onChange={(e) => setStartDate1(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 2</label>
                  <Input type="date" value={startDate2} onChange={(e) => setStartDate2(e.target.value)} />
                </div>
              </div>

              {/* Deposit */}
              <div>
                <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Deposit Required</label>
                <Input type="number" value={depositRequired} onChange={(e) => setDepositRequired(e.target.value)} placeholder="0.00" min={0} step="0.01" />
              </div>

              {/* Recipient Email */}
              <div>
                <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Customer Email</label>
                <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="client@company.com" />
              </div>

              {/* Personal message (customizable) */}
              <div>
                <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Personal message (optional)</label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Add a short message that will appear in the email before the Accept/Reject buttons..."
                  rows={3}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>

              {/* Preview: links and email */}
              <div className="rounded-xl border border-border-light bg-surface-hover p-4 space-y-4">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Preview</p>
                {previewLoading ? (
                  <div className="flex items-center gap-2 text-sm text-text-tertiary py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading preview...
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase mb-1.5">Links the customer will receive</p>
                      {previewLinks ? (
                        <div className="space-y-2 text-xs">
                          <div>
                            <span className="text-text-tertiary">Accept: </span>
                            <a href={previewLinks.acceptUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{previewLinks.acceptUrl}</a>
                          </div>
                          <div>
                            <span className="text-text-tertiary">Reject: </span>
                            <a href={previewLinks.rejectUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{previewLinks.rejectUrl}</a>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-text-tertiary">Could not load links</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase mb-1.5">Email preview</p>
                      <div className="rounded-lg border border-border bg-white overflow-hidden" style={{ minHeight: 320 }}>
                        {emailPreviewHtml ? (
                          <iframe
                            srcDoc={emailPreviewHtml}
                            title="Email preview"
                            className="w-full border-0 bg-white"
                            style={{ height: 420, maxHeight: "70vh" }}
                          />
                        ) : (
                          <div className="flex items-center justify-center text-sm text-text-tertiary" style={{ height: 420 }}>No preview</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {sendState === "sent" && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700">Sent to {sendEmail}. Status: Awaiting Customer.</p>
                </div>
              )}

              <Button
                onClick={handleSendToCustomer}
                disabled={sendState === "sending" || sendState === "sent" || !sendStep3Ready}
                icon={sendState === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                className="w-full"
              >
                {sendState === "sending" ? "Sending..." : sendState === "sent" ? "Sent" : "Send to Customer"}
              </Button>
            </div>
          )}

          {/* HISTORY TAB */}
          {tab === "history" && (
            <div className="p-6"><AuditTimeline entityType="quote" entityId={quote.id} /></div>
          )}
        </div>
      </div>

      {/* Invite Partner Modal */}
      <Modal open={invitePartnerOpen} onClose={() => setInvitePartnerOpen(false)} title="Invite Partners" subtitle="Select partners to send this quote request" size="lg">
        <div className="p-6 flex flex-col max-h-[70vh]">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={() => setSelectedPartnerIds(partners.length ? new Set(partners.map((p) => p.id)) : new Set())} className="text-xs font-medium text-primary hover:underline">Select all</button>
            <button type="button" onClick={() => setSelectedPartnerIds(new Set())} className="text-xs font-medium text-text-tertiary hover:underline">Clear</button>
          </div>
          <div className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1">
            {partners.length === 0 && <p className="text-sm text-text-tertiary text-center py-8">No partners found</p>}
            {partners.map((p) => {
              const isSelected = selectedPartnerIds.has(p.id);
              return (
                <label key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30 hover:bg-surface-hover"}`}>
                  <input type="checkbox" checked={isSelected} onChange={(e) => { setSelectedPartnerIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next; }); }} className="h-4 w-4 rounded border-border text-primary" />
                  <Avatar name={p.company_name} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{p.company_name}</p>
                    <p className="text-xs text-text-tertiary">{p.trade} — {p.location}</p>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-4 pt-4 mt-4 border-t border-border-light">
            <p className="text-sm text-text-tertiary">{selectedPartnerIds.size === 0 ? "Select at least one" : `${selectedPartnerIds.size} selected`}</p>
            <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} disabled={selectedPartnerIds.size === 0} onClick={() => {
              toast.success(`Quote request sent to ${selectedPartnerIds.size} partner(s)`);
              setInvitePartnerOpen(false); setSelectedPartnerIds(new Set());
            }}>
              Send to selected ({selectedPartnerIds.size})
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}

/** Required fields before leaving draft/survey; bidding is optional — you can go straight to awaiting_customer with your own figures. */
function quoteBasicsForPipeline(quote: Quote): { ok: boolean; message?: string } {
  if (!quote.client_name?.trim()) return { ok: false, message: "Fill client name (Step 1: Job details)." };
  if (!quote.client_email?.trim()) return { ok: false, message: "Fill client email (Step 1: Job details)." };
  if (!quote.property_address?.trim()) return { ok: false, message: "Fill property address (Step 1: Job details)." };
  if (!quote.title?.trim()) return { ok: false, message: "Fill job title / service (Step 1: Job details)." };
  if (Number(quote.total_value) <= 0 && Number(quote.cost) <= 0) {
    return { ok: false, message: "Set price or add line items before advancing." };
  }
  return { ok: true };
}

/** Scope/line total, dates, deposit and email must be on the quote before moving to Awaiting Customer. */
function proposalFieldsReadyForQuote(quote: Quote): { ok: boolean; message?: string } {
  const hasScope = !!(quote.scope && quote.scope.trim());
  const hasValue = Number(quote.total_value) > 0;
  if (!hasScope && !hasValue) {
    return { ok: false, message: "Add scope of work or line items with a total before sending to customer." };
  }
  if (!quote.start_date_option_1 && !quote.start_date_option_2) {
    return { ok: false, message: "Set at least one proposed start date before sending to customer." };
  }
  const dep = Number(quote.deposit_required);
  if (Number.isNaN(dep) || dep < 0) {
    return { ok: false, message: "Set the deposit required (use 0 if none)." };
  }
  const email = (quote.client_email ?? "").trim();
  if (!email.includes("@")) {
    return { ok: false, message: "Set a valid customer email before sending to customer." };
  }
  return { ok: true };
}

function canAdvanceQuote(quote: Quote, nextStatus: string): { ok: boolean; message?: string } {
  if (quote.status === "draft" && (nextStatus === "in_survey" || nextStatus === "bidding")) {
    return quoteBasicsForPipeline(quote);
  }
  if ((quote.status === "draft" || quote.status === "in_survey") && nextStatus === "awaiting_customer") {
    const basics = quoteBasicsForPipeline(quote);
    if (!basics.ok) return basics;
    if (Number(quote.total_value) <= 0) {
      return { ok: false, message: "Set total value (sell price) before sending to customer — use Overview pricing or line items." };
    }
    return proposalFieldsReadyForQuote(quote);
  }
  if (quote.status === "bidding" && nextStatus === "awaiting_customer") {
    if (Number(quote.total_value) <= 0) return { ok: false, message: "Set total value before sending to customer (Step 4: Margin & PDF)." };
    return proposalFieldsReadyForQuote(quote);
  }
  return { ok: true };
}

function getQuoteActions(currentStatus: string) {
  switch (currentStatus) {
    case "draft":
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Start Bidding", status: "bidding", icon: Send, primary: false },
        { label: "In Survey", status: "in_survey", icon: Eye, primary: false },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "in_survey":
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Start Bidding", status: "bidding", icon: Send, primary: false },
        { label: "Back to Draft", status: "draft", icon: RotateCcw, primary: false },
      ];
    case "bidding":
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Back to Draft", status: "draft", icon: RotateCcw, primary: false },
      ];
    case "awaiting_customer":
      return [
        { label: "Mark Accepted", status: "accepted", icon: CheckCircle2, primary: true },
        { label: "Rejected", status: "rejected", icon: XCircle, primary: false },
      ];
    case "accepted":
      return [
        { label: "Create Job", status: "create_job", icon: Briefcase, primary: true },
        { label: "Reopen", status: "draft", icon: RotateCcw, primary: false },
      ];
    case "rejected":
      return [
        { label: "Reactivate", status: "draft", icon: RotateCcw, primary: true },
      ];
    case "converted_to_job":
      return [];
    default:
      return [];
  }
}

/* ========== CREATE JOB FROM QUOTE MODAL ========== */
function CreateJobFromQuoteModal({ quote, onClose, onSubmit }: {
  quote: Quote | null; onClose: () => void;
  onSubmit: (data: { title: string; client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string; createWithoutDeposit?: boolean; total_phases?: number }) => void;
}) {
  const [form, setForm] = useState({ title: "", partner_id: "", client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", scheduled_time: "", createWithoutDeposit: false, total_phases: "3" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    if (!quote) return;
    setForm({
      title: quote.title ?? "", partner_id: quote.partner_id ?? "",
      client_price: String(quote.total_value ?? 0), partner_cost: String(quote.partner_cost ?? 0),
      materials_cost: "0", scheduled_date: "", scheduled_time: "", createWithoutDeposit: false, total_phases: "3",
    });
    setClientAddress({
      client_id: quote.client_id,
      client_address_id: quote.client_address_id,
      client_name: quote.client_name ?? "",
      client_email: quote.client_email ?? undefined,
      property_address: quote.property_address ?? "",
    });
    listPartners({ pageSize: 200, status: "all" }).then((r) => setPartners(r.data ?? []));
    if (quote.request_id) {
      getRequest(quote.request_id).then((req) => {
        if (req?.property_address) setClientAddress((p) => ({ ...p, property_address: req.property_address }));
      });
    }
  }, [quote]);

  if (!quote) return null;
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) { toast.error("Job title is required"); return; }
    if (!clientAddress.client_id || !clientAddress.property_address) { toast.error("Please select a client and property address"); return; }
    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    const scheduled_date = form.scheduled_date || undefined;
    const scheduled_start_at = form.scheduled_date && form.scheduled_time ? `${form.scheduled_date}T${form.scheduled_time}:00` : form.scheduled_date ? `${form.scheduled_date}T09:00:00` : undefined;
    onSubmit({
      title: form.title.trim(),
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      property_address: clientAddress.property_address,
      partner_id: form.partner_id || undefined,
      partner_name: selectedPartner ? selectedPartner.company_name : quote.partner_name ?? undefined,
      client_price: Number(form.client_price) || 0,
      partner_cost: Number(form.partner_cost) || 0,
      materials_cost: Number(form.materials_cost) || 0,
      scheduled_date,
      scheduled_start_at,
      createWithoutDeposit: form.createWithoutDeposit,
      total_phases: normalizeTotalPhases(Number(form.total_phases)),
    });
  };

  return (
    <Modal open={!!quote} onClose={onClose} title="Create Job from Quote" subtitle={`${quote.reference} — create job`} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Job title *</label><Input value={form.title} onChange={(e) => update("title", e.target.value)} required /></div>
        <Select
          label="Work phases *"
          value={form.total_phases}
          onChange={(e) => update("total_phases", e.target.value)}
          options={[
            { value: "1", label: "1 phase — straight to final check after Phase 1" },
            { value: "2", label: "2 phases — Phase 1 → Phase 2 → final check" },
            { value: "3", label: "3 phases — full progress (default)" },
          ]}
        />
        <p className="text-[10px] text-text-tertiary -mt-2">Each phase can have one partner report (photos / completion).</p>
        <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Date</label><Input type="date" value={form.scheduled_date} onChange={(e) => update("scheduled_date", e.target.value)} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Time</label><Input type="time" value={form.scheduled_time} onChange={(e) => update("scheduled_time", e.target.value)} /></div>
        </div>
        <Select label="Partner" options={[{ value: "", label: "No partner" }, ...partners.map((p) => ({ value: p.id, label: p.company_name || p.contact_name }))]} value={form.partner_id} onChange={(e) => update("partner_id", e.target.value)} />
        <div className="grid grid-cols-3 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Client Price</label><Input type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} min={0} step="0.01" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Cost</label><Input type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} min={0} step="0.01" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Materials</label><Input type="number" value={form.materials_cost} onChange={(e) => update("materials_cost", e.target.value)} min={0} step="0.01" /></div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.createWithoutDeposit} onChange={(e) => setForm((p) => ({ ...p, createWithoutDeposit: e.target.checked }))} className="rounded border-border text-primary focus:ring-primary" />
          <span className="text-sm text-text-secondary">Create job without deposit (override)</span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Job</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ========== MARGIN CALCULATOR ========== */
function MarginCalculator({ cost, initialMarginPct, onSellPriceChange, onMarginChange }: { cost: number; initialMarginPct?: number; onSellPriceChange: (v: number) => void; onMarginChange: (v: number) => void }) {
  const [marginPct, setMarginPct] = useState(initialMarginPct ?? 40);
  const sellPrice = cost > 0 ? Math.round((cost / (1 - marginPct / 100)) * 100) / 100 : 0;
  const marginValue = sellPrice - cost;

  useEffect(() => { onSellPriceChange(sellPrice); onMarginChange(marginPct); }, [marginPct, sellPrice, onSellPriceChange, onMarginChange]);

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-border-light dark:from-stone-950/40 dark:to-stone-900/20 dark:border-border-light/70">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
        <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Margin Calculator</label>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div><p className="text-[10px] text-text-tertiary uppercase">Partner cost</p><p className="text-sm font-bold text-text-primary">{formatCurrency(cost)}</p></div>
        <div><p className="text-[10px] text-text-tertiary uppercase">Sell Price</p><p className="text-sm font-bold text-primary">{formatCurrency(sellPrice)}</p></div>
        <div><p className="text-[10px] text-text-tertiary uppercase">Margin</p><p className="text-sm font-bold text-emerald-600">{formatCurrency(marginValue)}</p></div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Margin %</span>
          <span className={`text-xs font-bold ${marginPct >= 40 ? "text-primary" : marginPct >= 10 ? "text-amber-600" : "text-red-500"}`}>{marginPct}%</span>
        </div>
        <input
          type="range"
          min={5}
          max={60}
          step={0.5}
          value={marginPct}
          onChange={(e) => setMarginPct(Number(e.target.value))}
          className="w-full h-2 bg-border rounded-full appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[10px] text-text-tertiary">
          <span>5%</span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">10% min</span>
          <span className="text-primary font-medium">40% default</span>
          <span>60%</span>
        </div>
        {marginPct < 40 && <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1">Below standard margin (40%)</p>}
      </div>
    </div>
  );
}

/* ========== CREATE QUOTE FORM ========== */
function CreateQuoteForm({ onSubmit, onCancel }: { onSubmit: (d: Partial<Quote>) => void; onCancel: () => void }) {
  const [quoteType, setQuoteType] = useState<"internal" | "partner">("internal");
  const [form, setForm] = useState({ title: "", total_value: "", catalog_service_id: "" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [lineItems, setLineItems] = useState([{ description: "", quantity: "1", unitPrice: "0" }]);
  const [catalogList, setCatalogList] = useState<CatalogService[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [partnerDescription, setPartnerDescription] = useState("");
  const [templateInitialMarginPct, setTemplateInitialMarginPct] = useState(40);
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const [sellPrice, setSellPrice] = useState(0);
  const [marginPct, setMarginPct] = useState(0);

  useEffect(() => {
    listCatalogServicesForPicker().then(setCatalogList).catch(() => setCatalogList([]));
  }, []);

  useEffect(() => {
    if (quoteType !== "partner") return;
    listPartners({ pageSize: 200, status: "all" })
      .then((r) => setPartners(r.data ?? []))
      .catch(() => setPartners([]));
  }, [quoteType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) { toast.error("Title is required"); return; }
    if (!clientAddress.client_id || !clientAddress.property_address) { toast.error("Please select a client and property address"); return; }
    const cid = form.catalog_service_id.trim();
    const scopeFromLineItems = lineItems
      .map((li) => li.description.trim())
      .filter(Boolean)
      .join("\n");

    if (quoteType === "partner") {
      if (selectedPartnerIds.size === 0) {
        toast.error("Please select at least one partner");
        return;
      }
      if (!partnerDescription.trim()) {
        toast.error("Please enter a service description");
        return;
      }
    }

    onSubmit({
      ...form,
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      client_email: clientAddress.client_email,
      property_address: clientAddress.property_address,
      catalog_service_id: quoteType === "internal" ? (cid && isUuid(cid) ? cid : null) : null,
      total_value: quoteType === "internal" ? (sellPrice > 0 ? sellPrice : lineTotal) : 0,
      cost: quoteType === "internal" ? lineTotal : 0,
      sell_price: quoteType === "internal" ? (sellPrice > 0 ? sellPrice : lineTotal) : 0,
      margin_percent: quoteType === "internal" ? marginPct : 0,
      quote_type: quoteType,
      status: quoteType === "partner" ? "bidding" : "draft",
      partner_id: quoteType === "partner" ? undefined : undefined,
      partner_name: quoteType === "partner" ? undefined : undefined,
      partner_quotes_count: quoteType === "partner" ? selectedPartnerIds.size : undefined,
      scope: quoteType === "partner"
        ? partnerDescription.trim()
        : (scopeFromLineItems.trim() ? scopeFromLineItems.trim() : undefined),
    });
    setForm({ title: "", total_value: "", catalog_service_id: "" });
    setClientAddress({ client_name: "", property_address: "" });
    setLineItems([{ description: "", quantity: "1", unitPrice: "0" }]);
    setQuoteType("internal");
    setPartners([]);
    setSelectedPartnerIds(new Set());
    setPartnerDescription("");
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <Select
        label="Quote type"
        value={quoteType}
        onChange={(e) => setQuoteType(e.target.value as "internal" | "partner")}
        options={[
          { value: "internal", label: "Internal quote" },
          { value: "partner", label: "Bid for partner" },
        ]}
      />
      {quoteType === "partner" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Partners *</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-[11px] font-medium text-primary hover:underline"
                onClick={() => setSelectedPartnerIds(new Set(partners.map((p) => p.id)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[11px] font-medium text-text-tertiary hover:underline"
                onClick={() => setSelectedPartnerIds(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {partners.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-6">Loading partners...</p>
            ) : (
              partners.map((p) => {
                const isSelected = selectedPartnerIds.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30 hover:bg-surface-hover"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        const next = new Set(selectedPartnerIds);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        setSelectedPartnerIds(next);
                      }}
                      className="h-4 w-4 rounded border-border text-primary"
                    />
                    <Avatar name={p.company_name} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{p.company_name || p.contact_name}</p>
                      <p className="text-xs text-text-tertiary">{p.trade} — {p.location}</p>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-[11px] text-text-tertiary mt-2">{selectedPartnerIds.size} selected</p>
        </div>
      )}

      <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Quote title *</label><Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Commercial HVAC Refurbishment" required /></div>
      <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
      {quoteType === "internal" ? (
        <>
          <ServiceCatalogSelect
            catalog={catalogList}
            value={form.catalog_service_id}
            onChange={(id, svc) => {
              setForm((p) => {
                const next = { ...p, catalog_service_id: id };
                if (svc && !p.title.trim()) next.title = `${svc.name} quote`;
                return next;
              });
              if (!svc) return;
              const partnerCostTotalRaw = Number(svc.partner_cost ?? 0);
              const sellTotal = estimatedValueFromCatalog(svc);
              // Backward-compat: if partner_cost wasn't configured yet, fall back to template value.
              const partnerCostTotal = partnerCostTotalRaw > 0 ? partnerCostTotalRaw : sellTotal;
              const computedMarginPct = sellTotal > 0 ? Math.round(((sellTotal - partnerCostTotalRaw) / sellTotal) * 1000) / 10 : 0;

              const isFixed = svc.pricing_mode === "fixed";
              const qty = isFixed ? 1 : Math.max(0.25, Number(svc.default_hours) || 1);
              const unitCost = qty > 0 ? partnerCostTotal / qty : 0;
              const description = svc.default_description?.trim() || (isFixed ? svc.name : `${svc.name} (labour)`);

              // Keep 40% default margin if partner_cost wasn't set (raw == 0).
              setTemplateInitialMarginPct(partnerCostTotalRaw > 0 ? computedMarginPct : 40);
              setLineItems((prev) => {
                const rest = prev.slice(1);
                return [{ description, quantity: String(qty), unitPrice: String(unitCost) }, ...rest];
              });
            }}
          />
          <p className="text-[10px] text-text-tertiary -mt-2">Line items stay fully editable after applying a template.</p>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Line Items</label>
              <button type="button" onClick={() => setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0" }])} className="text-[11px] font-medium text-primary hover:underline">+ Add Item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start p-3 bg-surface-hover rounded-xl">
                  <div className="flex-1">
                    <Input placeholder="Service / Description" value={item.description} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], description: e.target.value }; setLineItems(n); }} className="text-xs mb-1.5" />
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], quantity: e.target.value }; setLineItems(n); }} className="text-xs w-20" />
                    <Input type="number" placeholder="Partner cost" value={item.unitPrice} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], unitPrice: e.target.value }; setLineItems(n); }} className="text-xs flex-1" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 pt-1">
                    {(() => {
                      const partnerLine = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
                      const ratio = lineTotal > 0 ? partnerLine / lineTotal : 0;
                      const sellLine = (Number(sellPrice) || 0) * ratio;
                      return (
                        <>
                          <span className="text-[10px] text-text-tertiary">Partner: <span className="font-semibold text-text-primary">{formatCurrency(partnerLine)}</span></span>
                          <span className="text-[10px] text-text-tertiary">Sell: <span className="font-semibold text-primary">{formatCurrency(sellLine)}</span></span>
                        </>
                      );
                    })()}
                    {lineItems.length > 1 && <button type="button" onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-2 pt-2 border-t border-border-light">
              <div className="text-right space-y-0.5">
                <p className="text-sm font-bold text-text-primary">Partner cost total: {formatCurrency(lineTotal)}</p>
                <p className="text-sm font-bold text-primary">Sell price total: {formatCurrency(sellPrice)}</p>
              </div>
            </div>
          </div>
          {lineTotal >= 0 && (
            <MarginCalculator
              key={`margin-${templateInitialMarginPct}`}
              cost={lineTotal}
              initialMarginPct={templateInitialMarginPct}
              onSellPriceChange={setSellPrice}
              onMarginChange={setMarginPct}
            />
          )}
        </>
      ) : (
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Service description *</label>
          <textarea
            value={partnerDescription}
            onChange={(e) => setPartnerDescription(e.target.value)}
            placeholder="Describe scope, inclusions and exclusions... (used for partner bids)"
            rows={5}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-none"
          />
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
        <Button type="submit">Create Quote</Button>
      </div>
    </form>
  );
}

/* ========== CALENDAR VIEW ========== */
const QUOTE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function QuotesCalendarView({ quotes, loading, onSelectQuote }: { quotes: Quote[]; loading: boolean; onSelectQuote: (q: Quote) => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
  const calendarDays: (number | null)[] = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [firstDayOfWeek, daysInMonth]);

  const quotesByDay = useMemo(() => {
    const map: Record<number, Quote[]> = {};
    for (const q of quotes) {
      const d = q.created_at?.slice(0, 10);
      if (!d) continue;
      const [y, m, day] = d.split("-").map(Number);
      if (y !== year || m !== month + 1) continue;
      if (!map[day]) map[day] = [];
      map[day].push(q);
    }
    return map;
  }, [quotes, year, month]);

  if (loading) return <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div>;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button type="button" onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }} className="p-1 rounded-lg hover:bg-surface-hover"><ArrowRight className="h-4 w-4 rotate-180" /></button>
        <span className="text-sm font-semibold text-text-primary">{QUOTE_MONTHS[month]} {year}</span>
        <button type="button" onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }} className="p-1 rounded-lg hover:bg-surface-hover"><ArrowRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border p-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="text-[10px] font-semibold text-text-tertiary text-center py-1">{d}</div>)}
        {calendarDays.map((day, i) => (
          <div key={i} className="min-h-[80px] bg-card p-1.5">
            {day != null ? (
              <>
                <span className="text-xs font-medium text-text-secondary">{day}</span>
                {(quotesByDay[day] ?? []).slice(0, 2).map((q) => (
                  <button key={q.id} type="button" onClick={() => onSelectQuote(q)} className="block w-full text-left mt-1 px-1.5 py-1 rounded bg-primary/10 text-primary text-[10px] font-medium truncate">{q.reference}</button>
                ))}
                {(quotesByDay[day] ?? []).length > 2 && <span className="text-[10px] text-text-tertiary">+{(quotesByDay[day] ?? []).length - 2}</span>}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuotesCardGridView({ quotes, loading, onSelectQuote }: { quotes: Quote[]; loading: boolean; onSelectQuote: (q: Quote) => void }) {
  if (loading) return <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {quotes.map((q) => (
        <button key={q.id} type="button" onClick={() => onSelectQuote(q)} className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
          <p className="text-sm font-semibold text-text-primary">{q.reference}</p>
          <p className="text-xs text-text-tertiary truncate">{q.title}</p>
          <p className="text-[11px] text-text-secondary mt-1">{q.client_name}</p>
          <p className="text-xs font-medium text-primary mt-1">{formatCurrency(q.total_value)}</p>
          <Badge variant={statusConfig[q.status]?.variant ?? "default"} size="sm" className="mt-2">{statusLabels[q.status]}</Badge>
        </button>
      ))}
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
  return <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>{label}</button>;
}
