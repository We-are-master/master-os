"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, Download, List, LayoutGrid, Calendar, Map,
  Sparkles, FileText, BarChart3, Clock, ArrowRight,
  Send, CheckCircle2, RotateCcw, XCircle,
  User, Mail, DollarSign, Bot, Building2,
  FileDown, Loader2, Eye, Trash2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { Quote } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listQuotes, createQuote, updateQuote } from "@/services/quotes";
import { getStatusCounts, getAggregates, getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";

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
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= currentStep ? "bg-primary" : "bg-stone-200"}`} />
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
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

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
      });
      await logAudit({
        entityType: "quote",
        entityId: result.id,
        entityRef: result.reference,
        action: "created",
        userId: profile?.id,
        userName: profile?.full_name,
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

  const handleStatusChange = useCallback(async (quote: Quote, newStatus: Quote["status"]) => {
    try {
      const updated = await updateQuote(quote.id, { status: newStatus });
      await logAudit({
        entityType: "quote",
        entityId: quote.id,
        entityRef: quote.reference,
        action: "status_changed",
        fieldName: "status",
        oldValue: quote.status,
        newValue: newStatus,
        userId: profile?.id,
        userName: profile?.full_name,
      });
      setSelectedQuote(updated);
      toast.success(`Quote moved to ${statusLabels[newStatus]}`);
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update quote");
    }
  }, [refresh, loadCounts, profile?.id, profile?.full_name]);

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
      key: "status", label: "Status",
      render: (item) => <QuoteStatusProgress status={item.status} />,
    },
    {
      key: "automation_status", label: "Automation",
      render: (item) => item.automation_status ? (
        <Badge
          variant={
            item.automation_status.includes("Signed") ? "success" :
            item.automation_status.includes("Client") ? "info" :
            item.automation_status.includes("AI") ? "primary" :
            item.automation_status.includes("Chasing") ? "warning" :
            "default"
          }
          size="sm"
        >
          {item.automation_status}
        </Badge>
      ) : <span className="text-xs text-text-tertiary">—</span>,
    },
    {
      key: "total_value", label: "Value", align: "right" as const,
      render: (item) => <span className="text-sm font-semibold text-text-primary">{formatCurrency(item.total_value)}</span>,
    },
    {
      key: "ai_confidence", label: "AI Confidence", align: "center" as const,
      render: (item) => item.ai_confidence ? (
        <div className="flex items-center gap-1.5 justify-center">
          <Sparkles className="h-3 w-3 text-indigo-500" />
          <span className="text-sm font-semibold text-text-primary">{item.ai_confidence}%</span>
        </div>
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
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Quote</Button>
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
              <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: Map }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-white shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <SearchInput placeholder="Search quotes..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
            </div>
          </div>
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
        </motion.div>
      </div>

      <QuoteDetailDrawer
        quote={selectedQuote}
        onClose={() => setSelectedQuote(null)}
        onStatusChange={handleStatusChange}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Quote" subtitle="Create a new quote for a client" size="lg">
        <CreateQuoteForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </PageTransition>
  );
}

function QuoteDetailDrawer({
  quote,
  onClose,
  onStatusChange,
}: {
  quote: Quote | null;
  onClose: () => void;
  onStatusChange: (quote: Quote, status: Quote["status"]) => void;
}) {
  const [tab, setTab] = useState("details");
  const [sendState, setSendState] = useState<"idle" | "generating" | "sending" | "sent" | "error">("idle");
  const [sendEmail, setSendEmail] = useState("");
  const [sendNotes, setSendNotes] = useState("");
  const [lineItems, setLineItems] = useState<{ description: string; quantity: string; unitPrice: string }[]>([]);

  useEffect(() => {
    if (quote) {
      setSendEmail(quote.client_email ?? "");
      setSendNotes("");
      setSendState("idle");
      setLineItems([{ description: quote.title ?? "", quantity: "1", unitPrice: String(quote.total_value ?? 0) }]);
    }
  }, [quote]);

  if (!quote) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[quote.status];
  const actions = getQuoteActions(quote.status);
  const stepMap: Record<string, number> = { draft: 0, partner_bidding: 1, ai_review: 2, sent: 3, approved: 4, expired: -1 };
  const currentStep = stepMap[quote.status] ?? 0;
  const drawerTabs = [
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
          quoteId: quote.id,
          recipientEmail: sendEmail,
          recipientName: quote.client_name,
          notes: sendNotes || undefined,
          items: items.length > 0 ? items : undefined,
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
    <Drawer
      open={!!quote}
      onClose={onClose}
      title={quote.reference}
      subtitle={quote.title}
      width="w-[520px]"
    >
      <div className="flex flex-col h-full">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} className="px-6 pt-2" />

        <div className="flex-1 overflow-y-auto">
        {tab === "details" && (
      <div className="p-6 space-y-6">
        {/* Status Pipeline */}
        <div className="p-4 rounded-xl bg-stone-50">
          <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-3 block">Quote Pipeline</label>
          <div className="flex items-center gap-1">
            {statusSteps.map((step, i) => (
              <div key={step} className="flex-1">
                <div className={`h-2 rounded-full ${i <= currentStep && currentStep !== -1 ? "bg-primary" : "bg-stone-200"}`} />
                <p className={`text-[10px] mt-1 text-center ${i === currentStep ? "font-bold text-primary" : "text-text-tertiary"}`}>
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Status & Value */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-stone-50">
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
            <div className="mt-1.5">
              <Badge variant={config.variant} dot={config.dot} size="md">
                {statusLabels[quote.status]}
              </Badge>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-stone-50">
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Total Value</label>
            <p className="text-xl font-bold text-text-primary mt-1">{formatCurrency(quote.total_value)}</p>
          </div>
        </div>

        {/* Client */}
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
          <div className="flex items-center gap-3 mt-2">
            <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
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

        {/* Owner */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-stone-50">
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
          <div className="p-3 rounded-xl bg-stone-50">
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner Quotes</label>
            <p className="text-xl font-bold text-text-primary mt-1">{quote.partner_quotes_count}</p>
            <p className="text-[11px] text-text-tertiary">bids received</p>
          </div>
        </div>

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
            {quote.automation_status && (
              <div className="mt-3 pt-3 border-t border-indigo-100">
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-indigo-500" />
                  <span className="text-xs font-medium text-indigo-700">{quote.automation_status}</span>
                </div>
              </div>
            )}
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
        <div className="flex gap-2 pt-4 border-t border-stone-100">
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
                <Button variant="outline" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={handlePreviewPDF} className="flex-1">
                  Preview PDF
                </Button>
                <Button variant="outline" size="sm" icon={<FileDown className="h-3.5 w-3.5" />} onClick={handlePreviewPDF} className="flex-1">
                  Download
                </Button>
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Line Items</label>
                <button onClick={addLineItem} className="text-[11px] font-medium text-primary hover:underline">+ Add Item</button>
              </div>
              <div className="space-y-2">
                {lineItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-start p-3 bg-stone-50 rounded-xl">
                    <div className="flex-1">
                      <Input
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                        className="text-xs mb-1.5"
                      />
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                          className="text-xs w-20"
                        />
                        <Input
                          type="number"
                          placeholder="Unit price"
                          value={item.unitPrice}
                          onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                          className="text-xs flex-1"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 pt-1">
                      <span className="text-xs font-semibold text-text-primary">
                        {formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}
                      </span>
                      {lineItems.length > 1 && (
                        <button onClick={() => removeLineItem(idx)} className="text-stone-400 hover:text-red-500 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-2 pt-2 border-t border-stone-100">
                <span className="text-sm font-bold text-text-primary">
                  Total: {formatCurrency(lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0))}
                </span>
              </div>
            </div>

            {/* Recipient */}
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Recipient Email</label>
              <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="client@company.com" />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Notes (optional)</label>
              <textarea
                value={sendNotes}
                onChange={(e) => setSendNotes(e.target.value)}
                placeholder="Additional notes to include in the PDF..."
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none h-20"
              />
            </div>

            {/* Send Status */}
            {sendState === "sent" && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-medium text-emerald-700">Quote sent successfully to {sendEmail}</p>
              </div>
            )}
            {sendState === "error" && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-100 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <p className="text-sm font-medium text-red-700">Failed to send. Check your Resend configuration.</p>
              </div>
            )}

            {/* Send Button */}
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

function CreateQuoteForm({ onSubmit, onCancel }: { onSubmit: (d: Partial<Quote>) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ title: "", client_name: "", client_email: "", total_value: "" });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.client_name) { toast.error("Fill required fields"); return; }
    onSubmit({ ...form, total_value: Number(form.total_value) || 0 });
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
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Total Value</label>
        <Input type="number" value={form.total_value} onChange={(e) => update("total_value", e.target.value)} placeholder="0.00" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
        <Button type="submit">Create Quote</Button>
      </div>
    </form>
  );
}

function BulkBtn({ label, onClick, variant }: { label: string; onClick: () => void; variant: "success" | "danger" | "warning" | "default" }) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200",
    default: "text-stone-700 bg-stone-50 hover:bg-stone-100 border-stone-200",
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
