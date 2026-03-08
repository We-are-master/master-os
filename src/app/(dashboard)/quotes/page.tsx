"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, Download, List, LayoutGrid, Calendar, Map,
  Sparkles, FileText, BarChart3, Clock, ArrowRight,
  Send, CheckCircle2, RotateCcw, XCircle,
  User, Mail, DollarSign, Bot, Building2,
  FileDown, Loader2, Eye, Trash2, Briefcase, Users, SlidersHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Quote, Partner, Job } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listQuotes, createQuote, updateQuote } from "@/services/quotes";
import { createJob, getJobByQuoteId } from "@/services/jobs";
import { listPartners } from "@/services/partners";
import { getRequest } from "@/services/requests";
import { getStatusCounts, getAggregates, getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { KanbanBoard } from "@/components/shared/kanban-board";

const QUOTE_STATUSES = ["draft", "partner_bidding", "ai_review", "sent", "approved", "expired"] as const;

const statusSteps = ["Draft", "Partner Bidding", "AI Review", "Sent to Client", "Approved"];

function QuoteStatusProgress({ status }: { status: string }) {
  const stepMap: Record<string, number> = { draft: 0, partner_bidding: 1, ai_review: 2, sent: 3, approved: 4, expired: -1 };
  const currentStep = stepMap[status] ?? 0;
  if (currentStep === -1) return <Badge variant="danger" size="sm">Expired</Badge>;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 w-32">
        {statusSteps.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= currentStep ? "bg-primary" : "bg-border"}`} />
        ))}
      </div>
      <p className="text-[11px] text-text-tertiary">{statusLabels[status] ?? status}</p>
    </div>
  );
}

const statusLabels: Record<string, string> = {
  draft: "Draft",
  partner_bidding: "Partner Bidding",
  ai_review: "AI Review",
  sent: "Sent to Client",
  approved: "Approved",
  expired: "Expired",
};

const statusConfig: Record<string, { variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  draft: { variant: "default", dot: true },
  partner_bidding: { variant: "warning", dot: true },
  ai_review: { variant: "primary", dot: true },
  sent: { variant: "info", dot: true },
  approved: { variant: "success", dot: true },
  expired: { variant: "danger", dot: true },
};

export default function QuotesPage() {
  const router = useRouter();
  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refresh,
  } = useSupabaseList<Quote>({ fetcher: listQuotes });

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
  const [quoteTypePopup, setQuoteTypePopup] = useState<{ open: boolean; onChoose?: (type: "internal" | "partner") => void }>({ open: false });

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
    const ids = ["draft", "partner_bidding", "ai_review", "sent", "approved"];
    return ids.map((id) => ({
      id,
      title: statusLabels[id] ?? id,
      color: id === "approved" ? "bg-emerald-500" : id === "sent" ? "bg-blue-500" : "bg-primary",
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

  useEffect(() => {
    loadCounts();
    loadAggregates();
  }, [loadCounts, loadAggregates]);

  const tabs = [
    { id: "all", label: "All", count: statusCounts.all ?? 0 },
    { id: "draft", label: "Draft", count: statusCounts.draft ?? 0 },
    { id: "partner_bidding", label: "Partners Bidding", count: statusCounts.partner_bidding ?? 0 },
    { id: "ai_review", label: "AI Review", count: statusCounts.ai_review ?? 0 },
    { id: "sent", label: "Sent", count: statusCounts.sent ?? 0 },
    { id: "expired", label: "Expired", count: statusCounts.expired ?? 0 },
  ];

  const handleCreate = useCallback(async (formData: Partial<Quote>) => {
    try {
      const result = await createQuote({
        title: formData.title ?? "",
        client_name: formData.client_name ?? "",
        client_email: formData.client_email ?? "",
        status: "draft",
        total_value: formData.total_value ?? 0,
        partner_quotes_count: 0,
        cost: formData.cost ?? 0,
        sell_price: formData.sell_price ?? formData.total_value ?? 0,
        margin_percent: formData.margin_percent ?? 0,
        quote_type: formData.quote_type ?? "internal",
      });
      await logAudit({
        entityType: "quote", entityId: result.id, entityRef: result.reference,
        action: "created", userId: profile?.id, userName: profile?.full_name,
      });
      setCreateOpen(false);
      toast.success("Quote created successfully");
      refresh();
      loadCounts();
      loadAggregates();
    } catch {
      toast.error("Failed to create quote");
    }
  }, [refresh, loadCounts, loadAggregates, profile?.id, profile?.full_name]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("quotes").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("quote", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} quotes updated to ${newStatus}`);
      setSelectedIds(new Set());
      refresh();
    } catch {
      toast.error("Failed to update quotes");
    }
  };

  const handleConfirmCreateJob = useCallback(
    async (formData: { title: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string }) => {
      if (!quoteToConvert) return;
      try {
        const margin =
          formData.client_price > 0
            ? Math.round(((formData.client_price - formData.partner_cost - formData.materials_cost) / formData.client_price) * 1000) / 10
            : 0;
        const job = await createJob({
          title: formData.title,
          client_name: formData.client_name,
          property_address: formData.property_address,
          partner_id: formData.partner_id,
          partner_name: formData.partner_name,
          quote_id: quoteToConvert.id,
          status: "ready_to_start",
          progress: 0,
          current_phase: 0,
          total_phases: 1,
          client_price: formData.client_price,
          partner_cost: formData.partner_cost,
          materials_cost: formData.materials_cost,
          margin_percent: margin,
          scheduled_date: formData.scheduled_date,
          scheduled_start_at: formData.scheduled_start_at,
          owner_id: profile?.id,
          owner_name: profile?.full_name,
          cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
          partner_agreed_value: 0, finance_status: "unpaid", report_submitted: false,
        });
        await logAudit({
          entityType: "job", entityId: job.id, entityRef: job.reference,
          action: "created", metadata: { from_quote: quoteToConvert.reference },
          userId: profile?.id, userName: profile?.full_name,
        });
        setQuoteToConvert(null);
        setSelectedQuote(null);
        toast.success(`Job ${job.reference} created. You can now schedule it.`);
        refresh();
        loadCounts();
        router.push(`/jobs?jobId=${job.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create job");
      }
    },
    [quoteToConvert, refresh, loadCounts, profile?.id, profile?.full_name, router]
  );

  const handleStatusChange = useCallback(
    async (quote: Quote, newStatus: Quote["status"] | "create_job") => {
      if (newStatus === "create_job") {
        setQuoteToConvert(quote);
        return;
      }
      try {
        const updated = await updateQuote(quote.id, { status: newStatus });
        await logAudit({
          entityType: "quote", entityId: quote.id, entityRef: quote.reference,
          action: "status_changed", fieldName: "status",
          oldValue: quote.status, newValue: newStatus,
          userId: profile?.id, userName: profile?.full_name,
        });
        setSelectedQuote(updated);
        toast.success(`Quote moved to ${statusLabels[newStatus]}`);
        refresh();
        loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update quote");
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
    const a = document.createElement("a");
    a.href = url; a.download = "quotes_export.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Quotes exported to CSV");
  }, [data]);

  const handleNewQuoteClick = () => {
    setQuoteTypePopup({
      open: true,
      onChoose: (type) => {
        setQuoteTypePopup({ open: false });
        if (type === "partner") {
          handleCreate({
            title: "",
            client_name: "",
            client_email: "",
            total_value: 0,
            quote_type: "partner",
          });
          toast.info("Partner quote created. Invite partners from the quote card.");
        } else {
          setCreateOpen(true);
        }
      },
    });
  };

  const columns: Column<Quote>[] = [
    {
      key: "reference", label: "Quote", width: "200px",
      render: (item) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
            {item.status === "ai_review" && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
              </span>
            )}
          </div>
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
      key: "owner_name", label: "Owner",
      render: (item) => item.owner_name ? (
        <div className="flex items-center gap-1.5">
          <Avatar name={item.owner_name} size="xs" />
          <span className="text-xs font-medium text-text-primary">{item.owner_name}</span>
        </div>
      ) : <span className="text-xs text-text-tertiary italic">No owner</span>,
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
      key: "status", label: "Status",
      render: (item) => <QuoteStatusProgress status={item.status} />,
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
        <PageHeader title="Quotes" subtitle="Quote lifecycle management with AI-powered optimization.">
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>Export</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleNewQuoteClick}>New Quote</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Pipeline Value" value={pipelineValue} format="currency" change={12.5} changeLabel="vs last month" icon={BarChart3} accent="primary" />
          <KpiCard title="Total Quotes" value={statusCounts.all ?? 0} format="number" icon={FileText} accent="blue" />
          <KpiCard title="Approved" value={statusCounts.approved ?? 0} format="number" icon={CheckCircle2} accent="emerald" />
          <KpiCard title="Pending AI Review" value={statusCounts.ai_review ?? 0} format="number" icon={Clock} accent="amber" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
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
            <DataTable
              columns={columns}
              data={data}
              getRowId={(item) => item.id}
              loading={loading}
              selectedId={selectedQuote?.id}
              onRowClick={setSelectedQuote}
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              onPageChange={setPage}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  <BulkBtn label="Send to Partners" onClick={() => handleBulkStatusChange("partner_bidding")} variant="default" />
                  <BulkBtn label="AI Review" onClick={() => handleBulkStatusChange("ai_review")} variant="warning" />
                  <BulkBtn label="Mark Sent" onClick={() => handleBulkStatusChange("sent")} variant="success" />
                  <BulkBtn label="Approve" onClick={() => handleBulkStatusChange("approved")} variant="success" />
                  <BulkBtn label="Expire" onClick={() => handleBulkStatusChange("expired")} variant="danger" />
                </div>
              }
            />
          )}
          {viewMode === "kanban" && (
            <div className="min-h-[400px]">
              {loading ? <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div> : (
                <KanbanBoard
                  columns={quoteKanbanColumns}
                  getCardId={(q) => q.id}
                  onCardClick={setSelectedQuote}
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
          {viewMode === "calendar" && (
            <QuotesCalendarView quotes={filteredQuotes} loading={loading} onSelectQuote={setSelectedQuote} />
          )}
          {viewMode === "map" && (
            <QuotesCardGridView quotes={filteredQuotes} loading={loading} onSelectQuote={setSelectedQuote} />
          )}
        </motion.div>
      </div>

      {/* Quote Type Popup: Invite Partner or Quote Internally */}
      <Modal open={quoteTypePopup.open} onClose={() => setQuoteTypePopup({ open: false })} title="Create Quote" subtitle="How would you like to quote this?">
        <div className="p-6 space-y-4">
          <button
            onClick={() => quoteTypePopup.onChoose?.("internal")}
            className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary group-hover:text-primary">Quote Internally</p>
                <p className="text-xs text-text-tertiary mt-0.5">Add line items (service, qty, price), auto-calculate total, generate PDF</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => quoteTypePopup.onChoose?.("partner")}
            className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
                <Users className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary group-hover:text-primary">Invite Partner</p>
                <p className="text-xs text-text-tertiary mt-0.5">Send quote request to partner via app or email link. Quote appears in real time.</p>
              </div>
            </div>
          </button>
        </div>
      </Modal>

      <QuoteDetailDrawer
        quote={selectedQuote}
        onClose={() => setSelectedQuote(null)}
        onStatusChange={handleStatusChange}
      />

      <CreateJobFromQuoteModal
        quote={quoteToConvert}
        onClose={() => setQuoteToConvert(null)}
        onSubmit={handleConfirmCreateJob}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Quote Internally" subtitle="Add line items and calculate total" size="lg">
        <CreateQuoteForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </PageTransition>
  );
}

function MarginCalculator({ cost, onSellPriceChange, onMarginChange }: { cost: number; onSellPriceChange: (v: number) => void; onMarginChange: (v: number) => void }) {
  const [marginPct, setMarginPct] = useState(35);
  const sellPrice = cost > 0 ? Math.round((cost / (1 - marginPct / 100)) * 100) / 100 : 0;
  const marginValue = sellPrice - cost;

  useEffect(() => {
    onSellPriceChange(sellPrice);
    onMarginChange(marginPct);
  }, [marginPct, sellPrice, onSellPriceChange, onMarginChange]);

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-border-light">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
        <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Margin Calculator</label>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <p className="text-[10px] text-text-tertiary uppercase">Cost</p>
          <p className="text-sm font-bold text-text-primary">{formatCurrency(cost)}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase">Sell Price</p>
          <p className="text-sm font-bold text-primary">{formatCurrency(sellPrice)}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase">Margin</p>
          <p className="text-sm font-bold text-emerald-600">{formatCurrency(marginValue)}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Margin %</span>
          <span className="text-xs font-bold text-primary">{marginPct}%</span>
        </div>
        <input
          type="range"
          min={30}
          max={40}
          step={0.5}
          value={marginPct}
          onChange={(e) => setMarginPct(Number(e.target.value))}
          className="w-full h-2 bg-border rounded-full appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[10px] text-text-tertiary">
          <span>30%</span>
          <span>40%</span>
        </div>
      </div>
    </div>
  );
}

function QuoteDetailDrawer({
  quote, onClose, onStatusChange,
}: {
  quote: Quote | null;
  onClose: () => void;
  onStatusChange: (quote: Quote, status: Quote["status"] | "create_job") => void;
}) {
  const [tab, setTab] = useState("status");
  const [sendState, setSendState] = useState<"idle" | "generating" | "sending" | "sent" | "error">("idle");
  const [sendEmail, setSendEmail] = useState("");
  const [sendNotes, setSendNotes] = useState("");
  const [lineItems, setLineItems] = useState<{ description: string; quantity: string; unitPrice: string }[]>([]);
  const [convertedJob, setConvertedJob] = useState<Job | null>(null);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (quote) {
      setSendEmail(quote.client_email ?? "");
      setSendNotes("");
      setSendState("idle");
      setLineItems([{ description: quote.title ?? "", quantity: "1", unitPrice: String(quote.total_value ?? 0) }]);
      loadLineItems(quote.id);
    }
  }, [quote]);

  useEffect(() => {
    if (quote?.id && quote?.status === "approved") {
      getJobByQuoteId(quote.id).then(setConvertedJob);
    } else {
      setConvertedJob(null);
    }
  }, [quote?.id, quote?.status]);

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
    if (invitePartnerOpen) {
      loadPartners();
      setSelectedPartnerIds(new Set());
    }
  }, [invitePartnerOpen, loadPartners]);

  if (!quote) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[quote.status];
  const actions = getQuoteActions(quote.status);
  const stepMap: Record<string, number> = { draft: 0, partner_bidding: 1, ai_review: 2, sent: 3, approved: 4, expired: -1 };
  const currentStep = stepMap[quote.status] ?? 0;
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);

  const drawerTabs = [
    { id: "status", label: "Status" },
    { id: "details", label: "Details" },
    { id: "send", label: "Send PDF" },
    { id: "history", label: "History" },
  ];

  const handlePreviewPDF = () => {
    window.open(`/api/quotes/send-pdf?quoteId=${quote.id}`, "_blank");
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0" }]);
  };

  const removeLineItem = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLineItem = (idx: number, field: string, value: string) => {
    setLineItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const saveLineItems = async () => {
    const supabase = getSupabase();
    await supabase.from("quote_line_items").delete().eq("quote_id", quote.id);
    const items = lineItems.map((li, i) => ({
      quote_id: quote.id,
      description: li.description,
      quantity: Number(li.quantity) || 1,
      unit_price: Number(li.unitPrice) || 0,
      sort_order: i,
    }));
    if (items.length > 0) {
      await supabase.from("quote_line_items").insert(items);
    }
    await updateQuote(quote.id, { total_value: lineTotal });
    toast.success("Line items saved");
  };

  const handleSendPDF = async () => {
    if (!sendEmail) { toast.error("Enter a recipient email"); return; }
    setSendState("sending");
    try {
      const items = lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.unitPrice) || 0,
        total: (Number(li.quantity) || 1) * (Number(li.unitPrice) || 0),
      }));
      const res = await fetch("/api/quotes/send-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.id, recipientEmail: sendEmail, recipientName: quote.client_name,
          notes: sendNotes || undefined, items: items.length > 0 ? items : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.emailSent) {
        setSendState("sent");
        toast.success(`Quote PDF sent to ${sendEmail}`);
      } else {
        setSendState("error");
        toast.error(data.reason ?? "Email not sent");
      }
    } catch (err) {
      setSendState("error");
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <Drawer open={!!quote} onClose={onClose} title={quote.reference} subtitle={quote.title} width="w-[520px]">
      <div className="flex flex-col h-full">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} className="px-6 pt-2" />

        <div className="flex-1 overflow-y-auto">
        {tab === "status" && (
          <div className="p-6 space-y-6">
            <div className="text-center">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Current status</p>
              <Badge variant={config.variant} dot={config.dot} size="md" className="text-base px-4 py-2">
                {statusLabels[quote.status]}
              </Badge>
            </div>
            <div className="p-5 rounded-2xl bg-surface-hover border border-border-light">
              <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-4 block">Quote pipeline</label>
              <div className="space-y-4">
                {statusSteps.map((step, i) => {
                  const isActive = i === currentStep && currentStep !== -1;
                  const isPast = i < currentStep && currentStep !== -1;
                  return (
                    <div key={step} className="flex items-center gap-4">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isActive ? "bg-primary text-white" : isPast ? "bg-primary/20 text-primary" : "bg-border text-text-tertiary"
                      }`}>
                        {isPast ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${isActive ? "text-primary" : isPast ? "text-text-primary" : "text-text-tertiary"}`}>{step}</p>
                        {isActive && (
                          <p className="text-xs text-text-tertiary mt-0.5">Current stage</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {quote.status === "expired" && (
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-red-100 text-red-600">
                      <XCircle className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-red-600">Expired</p>
                  </div>
                )}
              </div>
            </div>
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
            <div className="text-[11px] text-text-tertiary space-y-1">
              <p>Created {new Date(quote.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
              {quote.expires_at && (
                <p className={new Date(quote.expires_at) < new Date() ? "text-red-500 font-medium" : ""}>
                  Expires {new Date(quote.expires_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                </p>
              )}
            </div>
          </div>
        )}

        {tab === "details" && (
          <div className="p-6 space-y-6">
            {/* Status Pipeline (compact in Details) */}
            <div className="p-4 rounded-xl bg-surface-hover">
              <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-3 block">Quote Pipeline</label>
              <div className="flex items-center gap-1">
                {statusSteps.map((step, i) => (
                  <div key={step} className="flex-1">
                    <div className={`h-2 rounded-full ${i <= currentStep && currentStep !== -1 ? "bg-primary" : "bg-border"}`} />
                    <p className={`text-[10px] mt-1 text-center ${i === currentStep ? "font-bold text-primary" : "text-text-tertiary"}`}>{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Status & Value */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
                <div className="mt-1.5">
                  <Badge variant={config.variant} dot={config.dot} size="md">{statusLabels[quote.status]}</Badge>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Value</label>
                <p className="text-xl font-bold text-text-primary mt-1">{formatCurrency(quote.total_value)}</p>
              </div>
            </div>

            {/* Margin Info */}
            {(quote.cost > 0 || quote.margin_percent > 0) && (
              <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-border-light">
                <div className="flex items-center gap-2 mb-2">
                  <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
                  <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Margin</label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Cost</p>
                    <p className="text-sm font-bold text-text-primary">{formatCurrency(quote.cost)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Sell Price</p>
                    <p className="text-sm font-bold text-primary">{formatCurrency(quote.sell_price)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary uppercase">Margin %</p>
                    <p className={`text-sm font-bold ${quote.margin_percent >= 30 ? "text-emerald-600" : "text-amber-600"}`}>{quote.margin_percent}%</p>
                  </div>
                </div>
              </div>
            )}

            {/* Client */}
            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
              <div className="flex items-center gap-3 mt-2">
                <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{quote.client_name}</p>
                  {quote.client_email && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Mail className="h-3 w-3 text-text-tertiary" />
                      <p className="text-xs text-text-tertiary">{quote.client_email}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Invite Partner Button */}
            <Button
              variant="outline"
              size="sm"
              icon={<Users className="h-3.5 w-3.5" />}
              onClick={() => setInvitePartnerOpen(true)}
              className="w-full"
            >
              Invite Registered Partner to Quote
            </Button>

            {/* Owner & Partner Quotes */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Quote Owner</label>
                {quote.owner_name ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar name={quote.owner_name} size="sm" />
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{quote.owner_name}</p>
                      <p className="text-[11px] text-text-tertiary">Commission</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary italic mt-2">No owner</p>
                )}
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner Quotes</label>
                <p className="text-xl font-bold text-text-primary mt-1">{quote.partner_quotes_count}</p>
                <p className="text-[11px] text-text-tertiary">bids received</p>
              </div>
            </div>

            {/* Converted to Job */}
            {convertedJob && (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2 mb-2">
                  <Briefcase className="h-4 w-4 text-emerald-600" />
                  <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Converted to Job</label>
                </div>
                <Link
                  href={`/jobs?jobId=${convertedJob.id}`}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm font-semibold text-primary"
                >
                  <Briefcase className="h-4 w-4" />
                  {convertedJob.reference} — {convertedJob.title}
                </Link>
              </div>
            )}

            {/* AI Confidence */}
            {quote.ai_confidence != null && (
              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  <label className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide">AI Analysis</label>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text-primary">Confidence Score</span>
                      <span className="text-lg font-bold text-indigo-600">{quote.ai_confidence}%</span>
                    </div>
                    <Progress value={quote.ai_confidence} size="md" color={quote.ai_confidence >= 90 ? "emerald" : quote.ai_confidence >= 70 ? "primary" : "amber"} />
                  </div>
                </div>
              </div>
            )}

            {/* Dates */}
            <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
              <span>Created {new Date(quote.created_at).toLocaleDateString()}</span>
              {quote.expires_at && (
                <span className={new Date(quote.expires_at) < new Date() ? "text-red-500 font-medium" : ""}>
                  Expires {new Date(quote.expires_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t border-border-light">
              {actions.map((action) => (
                <Button
                  key={action.status}
                  variant={action.primary ? "primary" : "outline"}
                  className="flex-1"
                  size="sm"
                  icon={<action.icon className="h-3.5 w-3.5" />}
                  onClick={() => onStatusChange(quote, action.status)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {tab === "send" && (
          <div className="p-6 space-y-5">
            {/* Preview + Download */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Quote PDF</p>
                  <p className="text-[11px] text-text-tertiary">{quote.reference} — {formatCurrency(quote.total_value)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={handlePreviewPDF} className="flex-1">Preview PDF</Button>
                <Button variant="outline" size="sm" icon={<FileDown className="h-3.5 w-3.5" />} onClick={handlePreviewPDF} className="flex-1">Download</Button>
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Line Items</label>
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
                      {lineItems.length > 1 && (
                        <button onClick={() => removeLineItem(idx)} className="text-text-tertiary hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-2 pt-2 border-t border-border-light">
                <span className="text-sm font-bold text-text-primary">Total: {formatCurrency(lineTotal)}</span>
              </div>
            </div>

            {/* Margin Calculator */}
            <MarginCalculator cost={lineTotal * 0.65} onSellPriceChange={() => {}} onMarginChange={() => {}} />

            {/* Recipient */}
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Recipient Email</label>
              <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="client@company.com" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Notes (optional)</label>
              <textarea value={sendNotes} onChange={(e) => setSendNotes(e.target.value)} placeholder="Additional notes to include in the PDF..."
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none h-20" />
            </div>
            {sendState === "sent" && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-medium text-emerald-700">Quote sent successfully to {sendEmail}</p>
              </div>
            )}
            {sendState === "error" && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-100 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <p className="text-sm font-medium text-red-700">Failed to send. Check your Resend configuration.</p>
              </div>
            )}
            <Button
              onClick={handleSendPDF}
              disabled={sendState === "sending" || sendState === "sent"}
              icon={sendState === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              className="w-full"
            >
              {sendState === "sending" ? "Generating & Sending..." : sendState === "sent" ? "Sent Successfully" : "Generate PDF & Send Email"}
            </Button>
          </div>
        )}

        {tab === "history" && (
          <div className="p-6">
            <AuditTimeline entityType="quote" entityId={quote.id} />
          </div>
        )}
        </div>
      </div>

      {/* Invite Partner Modal - multi-select */}
      <Modal open={invitePartnerOpen} onClose={() => setInvitePartnerOpen(false)} title="Invite Partners" subtitle="Select one or more partners to send this quote request" size="lg">
        <div className="p-6 flex flex-col max-h-[70vh]">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setSelectedPartnerIds(partners.length ? new Set(partners.map((p) => p.id)) : new Set())}
              className="text-xs font-medium text-primary hover:underline"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedPartnerIds(new Set())}
              className="text-xs font-medium text-text-tertiary hover:underline"
            >
              Clear selection
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1">
            {partners.length === 0 && <p className="text-sm text-text-tertiary text-center py-8">No partners found</p>}
            {partners.map((p) => {
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
                      setSelectedPartnerIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      });
                    }}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                  />
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
            <p className="text-sm text-text-tertiary">
              {selectedPartnerIds.size === 0 ? "Select at least one partner" : `${selectedPartnerIds.size} partner${selectedPartnerIds.size !== 1 ? "s" : ""} selected`}
            </p>
            <Button
              size="sm"
              icon={<Send className="h-3.5 w-3.5" />}
              disabled={selectedPartnerIds.size === 0}
              onClick={() => {
                const count = selectedPartnerIds.size;
                const names = partners.filter((p) => selectedPartnerIds.has(p.id)).map((p) => p.company_name).join(", ");
                toast.success(`Quote request sent to ${count} partner${count !== 1 ? "s" : ""}${names ? `: ${names}` : ""}`);
                setInvitePartnerOpen(false);
                setSelectedPartnerIds(new Set());
              }}
            >
              Send to selected ({selectedPartnerIds.size})
            </Button>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}

function getQuoteActions(currentStatus: string) {
  switch (currentStatus) {
    case "draft":
      return [
        { label: "Send to Partners", status: "partner_bidding" as Quote["status"], icon: Send, primary: true },
        { label: "Expire", status: "expired" as Quote["status"], icon: XCircle, primary: false },
      ];
    case "partner_bidding":
      return [
        { label: "Send to AI Review", status: "ai_review" as Quote["status"], icon: Sparkles, primary: true },
        { label: "Back to Draft", status: "draft" as Quote["status"], icon: RotateCcw, primary: false },
      ];
    case "ai_review":
      return [
        { label: "Send to Client", status: "sent" as Quote["status"], icon: Send, primary: true },
        { label: "Back to Bidding", status: "partner_bidding" as Quote["status"], icon: RotateCcw, primary: false },
      ];
    case "sent":
      return [
        { label: "Mark Approved", status: "approved" as Quote["status"], icon: CheckCircle2, primary: true },
        { label: "Expired", status: "expired" as Quote["status"], icon: XCircle, primary: false },
      ];
    case "approved":
      return [
        { label: "Create Job", status: "create_job" as Quote["status"], icon: Briefcase, primary: true },
        { label: "Reopen", status: "draft" as Quote["status"], icon: RotateCcw, primary: false },
      ];
    case "expired":
      return [
        { label: "Reactivate", status: "draft" as Quote["status"], icon: RotateCcw, primary: true },
      ];
    default:
      return [];
  }
}

function CreateJobFromQuoteModal({
  quote, onClose, onSubmit,
}: {
  quote: Quote | null;
  onClose: () => void;
  onSubmit: (data: { title: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string }) => void;
}) {
  const [form, setForm] = useState({ title: "", client_name: "", property_address: "", partner_id: "", client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", scheduled_time: "" });
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    if (!quote) return;
    setForm({ title: quote.title ?? "", client_name: quote.client_name ?? "", property_address: "", partner_id: "", client_price: String(quote.total_value ?? 0), partner_cost: "0", materials_cost: "0", scheduled_date: "", scheduled_time: "" });
    listPartners({ pageSize: 200, status: "all" }).then((r) => setPartners(r.data ?? []));
    if (quote.request_id) {
      getRequest(quote.request_id).then((req) => {
        if (req?.property_address) setForm((p) => ({ ...p, property_address: req.property_address }));
      });
    }
  }, [quote]);

  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim() || !form.client_name?.trim()) { toast.error("Title and client name are required"); return; }
    if (!form.property_address?.trim()) { toast.error("Property address is required"); return; }
    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    const scheduled_date = form.scheduled_date || undefined;
    const scheduled_start_at = form.scheduled_date && form.scheduled_time ? `${form.scheduled_date}T${form.scheduled_time}:00` : form.scheduled_date ? `${form.scheduled_date}T09:00:00` : undefined;
    onSubmit({
      title: form.title.trim(), client_name: form.client_name.trim(), property_address: form.property_address.trim(),
      partner_id: form.partner_id || undefined,
      partner_name: selectedPartner ? selectedPartner.company_name || selectedPartner.contact_name : undefined,
      client_price: Number(form.client_price) || 0, partner_cost: Number(form.partner_cost) || 0, materials_cost: Number(form.materials_cost) || 0,
      scheduled_date, scheduled_start_at,
    });
  };

  if (!quote) return null;
  const partnerOptions = [{ value: "", label: "No partner" }, ...partners.map((p) => ({ value: p.id, label: p.company_name || p.contact_name || p.email }))];

  return (
    <Modal open={!!quote} onClose={onClose} title="Create Job from Quote" subtitle={`${quote.reference} — fill address and assign partner`} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Job Title *</label>
            <Input value={form.title} onChange={(e) => update("title", e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Name *</label>
            <Input value={form.client_name} onChange={(e) => update("client_name", e.target.value)} required />
          </div>
        </div>
        <AddressAutocomplete label="Property Address *" value={form.property_address} onSelect={(parts) => update("property_address", parts.full_address)} placeholder="Start typing address..." />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Date</label>
            <Input type="date" value={form.scheduled_date} onChange={(e) => update("scheduled_date", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Time</label>
            <Input type="time" value={form.scheduled_time} onChange={(e) => update("scheduled_time", e.target.value)} />
          </div>
        </div>
        <Select label="Partner" options={partnerOptions} value={form.partner_id} onChange={(e) => update("partner_id", e.target.value)} />
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Price</label>
            <Input type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} min={0} step="0.01" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Cost</label>
            <Input type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} min={0} step="0.01" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Materials Cost</label>
            <Input type="number" value={form.materials_cost} onChange={(e) => update("materials_cost", e.target.value)} min={0} step="0.01" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Job</Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateQuoteForm({ onSubmit, onCancel }: { onSubmit: (d: Partial<Quote>) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ title: "", client_name: "", client_email: "", total_value: "" });
  const [lineItems, setLineItems] = useState([{ description: "", quantity: "1", unitPrice: "0" }]);
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const [sellPrice, setSellPrice] = useState(0);
  const [marginPct, setMarginPct] = useState(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.client_name) { toast.error("Fill required fields"); return; }
    onSubmit({
      ...form,
      total_value: sellPrice > 0 ? sellPrice : lineTotal,
      cost: lineTotal,
      sell_price: sellPrice > 0 ? sellPrice : lineTotal,
      margin_percent: marginPct,
      quote_type: "internal",
    });
    setForm({ title: "", client_name: "", client_email: "", total_value: "" });
  };
  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Quote Title *</label>
        <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Commercial HVAC Overhaul" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Name *</label>
          <Input value={form.client_name} onChange={(e) => update("client_name", e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Email</label>
          <Input type="email" value={form.client_email} onChange={(e) => update("client_email", e.target.value)} />
        </div>
      </div>
      {/* Line Items */}
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
                  <Input type="number" placeholder="Price" value={item.unitPrice} onChange={(e) => { const n = [...lineItems]; n[idx] = { ...n[idx], unitPrice: e.target.value }; setLineItems(n); }} className="text-xs flex-1" />
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 pt-1">
                <span className="text-xs font-semibold text-text-primary">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</span>
                {lineItems.length > 1 && (
                  <button type="button" onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-2 pt-2 border-t border-border-light">
          <span className="text-sm font-bold text-text-primary">Total: {formatCurrency(lineTotal)}</span>
        </div>
      </div>
      {/* Margin Calculator */}
      {lineTotal > 0 && (
        <MarginCalculator cost={lineTotal} onSellPriceChange={setSellPrice} onMarginChange={setMarginPct} />
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
        <Button type="submit">Create Quote</Button>
      </div>
    </form>
  );
}

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
        <button type="button" onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }} className="p-1 rounded-lg hover:bg-surface-hover">
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>
        <span className="text-sm font-semibold text-text-primary">{QUOTE_MONTHS[month]} {year}</span>
        <button type="button" onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }} className="p-1 rounded-lg hover:bg-surface-hover">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border p-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[10px] font-semibold text-text-tertiary text-center py-1">{d}</div>
        ))}
        {calendarDays.map((day, i) => (
          <div key={i} className="min-h-[80px] bg-card p-1.5">
            {day != null ? (
              <>
                <span className="text-xs font-medium text-text-secondary">{day}</span>
                {(quotesByDay[day] ?? []).slice(0, 2).map((q) => (
                  <button key={q.id} type="button" onClick={() => onSelectQuote(q)} className="block w-full text-left mt-1 px-1.5 py-1 rounded bg-primary/10 text-primary text-[10px] font-medium truncate">
                    {q.reference}
                  </button>
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
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
