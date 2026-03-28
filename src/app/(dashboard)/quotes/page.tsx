"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense, useLayoutEffect } from "react";
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
import { useRouter, useSearchParams } from "next/navigation";
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
import { getStatusCounts, getAggregates, getSupabase, softDeleteById, type ListParams, type ListResult } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { KanbanBoard } from "@/components/shared/kanban-board";
import { normalizeTotalPhases } from "@/lib/job-phases";
import { getPartnerAssignmentBlockReason } from "@/lib/job-partner-assign";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { estimatedValueFromCatalog } from "@/lib/catalog-service-defaults";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { isUuid } from "@/lib/utils";
import { TYPE_OF_WORK_OPTIONS, withTypeOfWorkFallback } from "@/lib/type-of-work";
import {
  parseBidProposalFromNotes,
  splitBidPartnerCosts,
  summarizeBidProposalNotes,
  BID_DEFAULT_LABOUR_MARKUP,
  BID_DEFAULT_MATERIALS_MARKUP,
} from "@/lib/quote-bid-payload";

const QUOTE_STATUSES = ["draft", "in_survey", "bidding", "awaiting_customer", "accepted", "rejected", "converted_to_job"] as const;

/** Two starter rows: type of work + materials (partner app aligns with this shape). */
function defaultProposalLineItems(q: Quote): { description: string; quantity: string; unitPrice: string }[] {
  const title = (q.title ?? "").trim() || "Type of work";
  return [
    { description: title, quantity: "1", unitPrice: "0" },
    { description: "Materials", quantity: "1", unitPrice: "0" },
  ];
}

function marginPctOnSell(sell: number, partnerCost: number): number {
  if (!(sell > 0) || !Number.isFinite(sell)) return 0;
  return Math.round(((sell - partnerCost) / sell) * 1000) / 10;
}

type ProposalLineRow = { description: string; quantity: string; unitPrice: string };

function computeCustomerProposalFromBid(bid: QuoteBid, q: Quote): {
  lines: ProposalLineRow[];
  labourP: number;
  materialsP: number;
  scopeText?: string;
  startDate1?: string;
  startDate2?: string;
  depositRequired?: string;
} {
  const payload = parseBidProposalFromNotes(bid.notes);
  const { labour: L, materials: M } = splitBidPartnerCosts(bid.bid_amount, payload);
  const title = (q.title ?? "").trim() || "Type of work";
  const line0Desc = (payload?.labour_description ?? title).trim() || title;
  const line1Desc = (payload?.materials_description ?? "Materials").trim() || "Materials";
  const sell0 = L * (1 + BID_DEFAULT_LABOUR_MARKUP);
  const sell1 = M * (1 + BID_DEFAULT_MATERIALS_MARKUP);
  const u0 = Math.round(sell0 * 100) / 100;
  const u1 = Math.round(sell1 * 100) / 100;
  return {
    lines: [
      { description: line0Desc, quantity: "1", unitPrice: String(u0) },
      { description: line1Desc, quantity: "1", unitPrice: String(u1) },
    ],
    labourP: L,
    materialsP: M,
    scopeText: payload?.scope?.trim() || undefined,
    startDate1: payload?.start_date_option_1?.trim().slice(0, 10),
    startDate2: payload?.start_date_option_2?.trim().slice(0, 10),
    depositRequired:
      payload?.deposit_required != null && Number.isFinite(Number(payload.deposit_required))
        ? String(payload.deposit_required)
        : undefined,
  };
}

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
  goToTab?: "overview" | "bids" | "history";
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
        detail:
          "Approving a bid only locks partner cost — it does not accept with the customer. Set your sell price on Review & Send, complete the proposal, then Send to Customer. After the client accepts, convert to a job.",
        goToTab: "overview",
        goToLabel: "Review & Send",
      };
    case "awaiting_customer":
      return {
        headline: "Waiting on the customer",
        detail: "You can still edit the proposal or pricing, then Save & send PDF (or Resend email) so the client gets an updated attachment — links stay the same.",
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
  return (
    <Suspense
      fallback={
        <PageTransition>
          <div className="p-8 text-sm text-text-tertiary">Loading quotes…</div>
        </PageTransition>
      }
    >
      <QuotesPageContent />
    </Suspense>
  );
}

function QuotesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [drawerPendingTab, setDrawerPendingTab] = useState<"overview" | "bids" | null>(null);
  const consumeDrawerPendingTab = useCallback(() => setDrawerPendingTab(null), []);

  useEffect(() => {
    const qid = searchParams.get("quoteId");
    if (!qid || loading) return;
    let cancelled = false;
    (async () => {
      let found = data.find((q) => q.id === qid) ?? null;
      if (!found) {
        try {
          found = await getQuote(qid);
        } catch {
          found = null;
        }
      }
      if (cancelled || !found) return;
      const tab: "overview" | "bids" = searchParams.get("drawerTab") === "bids" ? "bids" : "overview";
      setSelectedQuote(found);
      setDrawerPendingTab(tab);
      router.replace("/quotes", { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, data, loading, router]);

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

  /** Share of all quotes (non-deleted) that became jobs (`converted_to_job`). */
  const quoteToJobConversion = useMemo(() => {
    const total = statusCounts.all ?? 0;
    const converted = statusCounts.converted_to_job ?? 0;
    if (total <= 0) return { pct: 0, converted, total };
    return {
      pct: Math.round((converted / total) * 1000) / 10,
      converted,
      total,
    };
  }, [statusCounts]);

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
        owner_id: profile?.id,
        owner_name: profile?.full_name,
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

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => softDeleteById("quotes", id, profile?.id)));
      toast.success(`${selectedIds.size} quotes archived`);
      setSelectedIds(new Set());
      refresh();
      loadCounts();
      loadAggregates();
    } catch {
      toast.error("Failed to archive quotes");
    }
  }, [selectedIds, profile?.id, refresh, loadCounts, loadAggregates]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${selectedIds.size} selected quotes permanently?`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("quotes").delete().in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} quotes deleted`);
      setSelectedIds(new Set());
      refresh();
      loadCounts();
      loadAggregates();
    } catch {
      toast.error("Failed to delete quotes");
    }
  }, [selectedIds, refresh, loadCounts, loadAggregates]);

  const handleConfirmCreateJob = useCallback(
    async (formData: { title: string; client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null; createWithoutDeposit?: boolean; job_type?: "fixed" | "hourly"; scope?: string }) => {
      if (!quoteToConvert) return;
      const effectivePartnerId = formData.partner_id ?? quoteToConvert.partner_id;
      const jobScope = (formData.scope ?? "").trim() || (quoteToConvert.scope ?? "").trim();
      if (effectivePartnerId) {
        const block = getPartnerAssignmentBlockReason({
          property_address: formData.property_address,
          scope: jobScope,
          scheduled_date: formData.scheduled_date,
          scheduled_start_at: formData.scheduled_start_at,
          partner_id: effectivePartnerId,
          partner_ids: [],
        });
        if (block) {
          toast.error(block);
          return;
        }
      }
      try {
        const margin = formData.client_price > 0 ? Math.round(((formData.client_price - formData.partner_cost - formData.materials_cost) / formData.client_price) * 1000) / 10 : 0;
        const noDeposit = !!formData.createWithoutDeposit;
        const scheduledDeposit = noDeposit ? 0 : (quoteToConvert.deposit_required ?? 0);
        const scheduledFinal = Math.max(0, formData.client_price - scheduledDeposit);
        const quotePartnerId = formData.partner_id ?? quoteToConvert.partner_id;
        const quotePartnerName = (formData.partner_name ?? quoteToConvert.partner_name)?.trim();
        const hasPartner = !!(quotePartnerId?.trim() || quotePartnerName);
        const job = await createJob({
          title: formData.title,
          client_id: formData.client_id,
          client_address_id: formData.client_address_id,
          client_name: formData.client_name,
          property_address: formData.property_address,
          partner_id: formData.partner_id ?? quoteToConvert.partner_id,
          partner_name: formData.partner_name ?? quoteToConvert.partner_name,
          quote_id: quoteToConvert.id,
          status: hasPartner ? "scheduled" : "unassigned",
          progress: 0, current_phase: 0, total_phases: normalizeTotalPhases(2),
          client_price: formData.client_price,
          extras_amount: 0,
          partner_cost: formData.partner_cost,
          materials_cost: formData.materials_cost,
          margin_percent: margin,
          scheduled_date: formData.scheduled_date,
          scheduled_start_at: formData.scheduled_start_at,
          scheduled_end_at: formData.scheduled_end_at,
          scheduled_finish_date: formData.scheduled_finish_date ?? null,
          owner_id: profile?.id, owner_name: profile?.full_name,
          job_type: formData.job_type ?? "fixed",
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
          scope: jobScope || undefined,
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
        if (newStatus === "bidding" && quote.service_type) {
          fetch("/api/push/notify-partner", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trades: [quote.service_type],
              title: "New Job Invitation",
              body: `${quote.title} — ${quote.property_address ?? quote.client_name}`,
              data: { type: "quote_invite", quoteId: quote.id },
            }),
          }).catch(() => {});
        }
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
          {item.quote_type === "partner" ? "Partner" : "Manual"}
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
          <KpiCard
            title="Quotes → jobs"
            value={quoteToJobConversion.pct}
            format="percent"
            icon={Briefcase}
            accent="emerald"
            description={
              quoteToJobConversion.total === 0
                ? "No quotes yet"
                : `${quoteToJobConversion.converted} job${quoteToJobConversion.converted === 1 ? "" : "s"} from ${quoteToJobConversion.total} quote${quoteToJobConversion.total === 1 ? "" : "s"} · conversion rate`
            }
          />
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
              <button
                type="button"
                onClick={() => setStatus("rejected")}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-2 transition-all min-w-[7rem]",
                  status === "rejected"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border-light bg-card hover:border-primary/30 text-text-secondary"
                )}
              >
                <XCircle className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span className="text-xs font-semibold truncate">Rejected</span>
                <span className={cn("ml-auto text-[11px] font-bold tabular-nums", status === "rejected" ? "text-primary" : "text-text-tertiary")}>
                  {statusCounts.rejected ?? 0}
                </span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-border-light/80">
              <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">More</span>
              {[
                { id: "all", label: "All quotes" },
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
                      <option value="internal">Manual</option>
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
                  <BulkBtn label="Archive" onClick={handleBulkArchive} variant="warning" />
                  <BulkBtn label="Delete" onClick={handleBulkDelete} variant="danger" />
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

      <QuoteDetailDrawer
        quote={selectedQuote}
        pendingInitialTab={drawerPendingTab}
        onConsumePendingInitialTab={consumeDrawerPendingTab}
        onClose={() => setSelectedQuote(null)}
        onStatusChange={handleStatusChange}
        onQuoteUpdate={(q) => {
          setSelectedQuote(q);
          refresh();
        }}
      />
      <CreateJobFromQuoteModal quote={quoteToConvert} onClose={() => setQuoteToConvert(null)} onSubmit={handleConfirmCreateJob} />
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Quote" subtitle="Add line items and optionally request partner bids" size="lg">
        <CreateQuoteForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </PageTransition>
  );
}

/* ========== QUOTE DETAIL DRAWER ========== */
function QuoteDetailDrawer({
  quote,
  pendingInitialTab,
  onConsumePendingInitialTab,
  onClose,
  onStatusChange,
  onQuoteUpdate,
}: {
  quote: Quote | null;
  pendingInitialTab?: "overview" | "bids" | null;
  onConsumePendingInitialTab?: () => void;
  onClose: () => void;
  onStatusChange: (quote: Quote, status: string) => void | Promise<boolean>;
  onQuoteUpdate?: (updated: Quote) => void;
}) {
  const { profile } = useProfile();
  const [tab, setTab] = useState("overview");
  const lastTabInitQuoteIdRef = useRef<string | null>(null);
  /** After a successful email in this drawer session — drives Resend labels (resets when opening another quote). */
  const [quoteEmailedInSession, setQuoteEmailedInSession] = useState(false);
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
  /** 100 = 100% of (labour ×1.4 + materials ×1.25) customer prices; range 0–1000. */
  const [proposalScalePercent, setProposalScalePercent] = useState(100);
  const [partnerLabourCost, setPartnerLabourCost] = useState(0);
  const [partnerMaterialsCost, setPartnerMaterialsCost] = useState(0);
  const isAdmin = profile?.role === "admin";
  /** Earliest selectable day for proposed start dates (local calendar day). */
  const minProposalStartDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useLayoutEffect(() => {
    if (!quote) {
      lastTabInitQuoteIdRef.current = null;
      return;
    }
    if (pendingInitialTab === "bids" || pendingInitialTab === "overview") {
      setTab(pendingInitialTab);
      lastTabInitQuoteIdRef.current = quote.id;
      onConsumePendingInitialTab?.();
      return;
    }
    if (lastTabInitQuoteIdRef.current !== quote.id) {
      lastTabInitQuoteIdRef.current = quote.id;
      setTab(quote.quote_type === "partner" ? "bids" : "overview");
    }
  }, [quote, pendingInitialTab, onConsumePendingInitialTab]);

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
      setQuoteEmailedInSession(false);
      setSendEmail(quote.client_email ?? "");
      setSendState("idle");
      setScopeText(quote.scope ?? "");
      setDepositRequired(String(quote.deposit_required ?? 0));
      setStartDate1(quote.start_date_option_1 ?? "");
      setStartDate2(quote.start_date_option_2 ?? "");
      setCustomMessage(quote.email_custom_message ?? "");
      setPanelPartnerCost(String(quote.partner_cost ?? quote.cost ?? 0));
      setPanelSellPrice(String(quote.sell_price ?? quote.total_value ?? 0));
      setProposalScalePercent(100);
      setPartnerLabourCost(Number(quote.partner_cost ?? quote.cost ?? 0));
      setPartnerMaterialsCost(0);
      void loadLineItems(quote.id, quote);
      if (quote.quote_type === "partner") {
        void getBidsByQuoteId(quote.id)
          .then((bids) => {
            const approved = bids.find((b) => b.status === "approved");
            if (!approved) return;
            const { labour, materials } = splitBidPartnerCosts(approved.bid_amount, parseBidProposalFromNotes(approved.notes));
            setPartnerLabourCost(labour);
            setPartnerMaterialsCost(materials);
          })
          .catch(() => {});
      }
    }
  }, [quote]);

  useEffect(() => {
    if (quote?.id && (quote?.status === "accepted" || quote?.status === "converted_to_job")) {
      getJobByQuoteId(quote.id).then(setConvertedJob);
    } else { setConvertedJob(null); }
  }, [quote?.id, quote?.status]);

  useEffect(() => {
    if (!quote?.id || quote.status !== "awaiting_customer" || tab !== "overview") return;
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
  }, [tab, quote?.id, quote?.status, quote?.client_name, customMessage, lineItems, depositRequired, scopeText]);

  const loadLineItems = async (quoteId: string, q: Quote) => {
    const supabase = getSupabase();
    const { data } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).order("sort_order");
    if (data && data.length > 0) {
      let rows = data.map((li: { description: string; quantity: number; unit_price: number }) => ({
        description: li.description,
        quantity: String(li.quantity),
        unitPrice: String(li.unit_price),
      }));
      const padStatuses = ["draft", "in_survey", "bidding", "awaiting_customer"];
      if (rows.length < 2 && padStatuses.includes(q.status)) {
        const title = (q.title ?? "").trim() || "Type of work";
        if (rows.length === 0) {
          rows = defaultProposalLineItems(q);
        } else {
          rows = [...rows, { description: "Materials", quantity: "1", unitPrice: "0" }];
          if (!rows[0].description.trim()) rows[0] = { ...rows[0], description: title };
        }
      }
      setLineItems(rows);
    } else {
      setLineItems(defaultProposalLineItems(q));
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
    if (sp <= 0) return 40;
    const raw = Math.round(((sp - pc) / sp) * 1000) / 10;
    return Math.min(99.9, Math.max(0, raw));
  }, [quote]);

  if (!quote) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[quote.status] ?? { variant: "default" as const };
  const actions = getQuoteActions(quote);
  const stepMap: Record<string, number> = { draft: 0, in_survey: 1, bidding: 2, awaiting_customer: 3, accepted: 4, rejected: -1, converted_to_job: 5 };
  const currentStep = stepMap[quote.status] ?? 0;
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const proposalLine0Sell = (Number(lineItems[0]?.quantity) || 0) * (Number(lineItems[0]?.unitPrice) || 0);
  const proposalLine1Sell = (Number(lineItems[1]?.quantity) || 0) * (Number(lineItems[1]?.unitPrice) || 0);
  const proposalMarginLabourPct = marginPctOnSell(proposalLine0Sell, partnerLabourCost);
  const proposalMarginMaterialsPct = marginPctOnSell(proposalLine1Sell, partnerMaterialsCost);
  const proposalPartnerTotal = partnerLabourCost + partnerMaterialsCost;
  const canUseProposalMarginSlider = proposalPartnerTotal > 0;

  // Email flow step-by-step (only relevant when quote.status === "awaiting_customer")
  const sendStep1Ready = scopeText.trim().length > 0 || lineItems.some((li) => li.description.trim().length > 0);
  const sendStep2Ready = !!startDate1 || !!startDate2;
  const sendDepositNumber = Number(depositRequired);
  const sendStep3Ready =
    sendDepositNumber >= 0 &&
    !Number.isNaN(sendDepositNumber) &&
    sendEmail.trim().includes("@");

  const drawerTabs = [
    { id: "overview", label: "Review & Send" },
    { id: "bids", label: "Bids" },
    { id: "history", label: "History" },
  ];

  const guidance = getStageGuidance(quote.status);

  const addLineItem = () => setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0" }]);
  const removeLineItem = (idx: number) => {
    setLineItems((prev) => {
      if (prev.length <= 2 && ["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status)) {
        toast.info("Keep at least two lines (type of work and materials). Remove extra rows only.");
        return prev;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const recalcCustomerLinePricesFromPartnerScale = useCallback((scalePct: number, labourP: number, materialsP: number) => {
    const m = scalePct / 100;
    setLineItems((prev) => {
      const q0 = Number(prev[0]?.quantity) || 1;
      const q1 = Number(prev[1]?.quantity) || 1;
      const sell0 = labourP * (1 + BID_DEFAULT_LABOUR_MARKUP) * m;
      const sell1 = materialsP * (1 + BID_DEFAULT_MATERIALS_MARKUP) * m;
      const u0 = q0 > 0 ? Math.round((sell0 / q0) * 100) / 100 : 0;
      const u1 = q1 > 0 ? Math.round((sell1 / q1) * 100) / 100 : 0;
      const next = [...prev];
      if (next[0]) next[0] = { ...next[0], unitPrice: String(u0) };
      if (next[1]) next[1] = { ...next[1], unitPrice: String(u1) };
      return next;
    });
  }, []);

  const updateLineItem = (idx: number, field: string, value: string) => setLineItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const persistProposalToQuote = async (opts?: {
    lineItemsOverride?: ProposalLineRow[];
    scopeTextOverride?: string;
    startDate1Override?: string;
    startDate2Override?: string;
    depositOverride?: string;
    partnerCostOverride?: number;
  }): Promise<Quote> => {
    const lines = opts?.lineItemsOverride ?? lineItems;
    const st = opts?.scopeTextOverride !== undefined ? opts.scopeTextOverride : scopeText;
    const d1 = opts?.startDate1Override !== undefined ? opts.startDate1Override : startDate1;
    const d2 = opts?.startDate2Override !== undefined ? opts.startDate2Override : startDate2;
    const dep = opts?.depositOverride !== undefined ? opts.depositOverride : depositRequired;
    const partnerTotal = opts?.partnerCostOverride ?? Number(quote.partner_cost ?? quote.cost ?? 0);

    const supabase = getSupabase();
    await supabase.from("quote_line_items").delete().eq("quote_id", quote.id);
    const rows = lines.map((li, i) => ({
      quote_id: quote.id,
      description: li.description,
      quantity: Number(li.quantity) || 1,
      unit_price: Number(li.unitPrice) || 0,
      sort_order: i,
    }));
    if (rows.length > 0) await supabase.from("quote_line_items").insert(rows);

    const lineTot = lines.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
    const marginPct =
      lineTot > 0 && partnerTotal >= 0 ? Math.round(((lineTot - partnerTotal) / lineTot) * 1000) / 10 : 0;

    return updateQuote(quote.id, {
      total_value: lineTot,
      sell_price: lineTot,
      margin_percent: marginPct,
      scope: st.trim() || undefined,
      deposit_required: Number(dep) || 0,
      start_date_option_1: d1 || undefined,
      start_date_option_2: d2 || undefined,
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

  const handleSendToCustomer = async () => {
    if (!sendEmail) { toast.error("Enter a recipient email"); return; }
    const isResend = quoteEmailedInSession || sendState === "sent";
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
        toast.success(
          isResend
            ? `Proposal saved and updated PDF resent to ${sendEmail}. Accept / Reject links are unchanged.`
            : `Proposal saved — PDF sent to ${sendEmail}. Customer can Accept or Reject via the email link.`,
        );
        setQuoteEmailedInSession(true);
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
                className="group rounded-xl border border-border-light bg-gradient-to-br from-surface-hover to-surface-tertiary open:shadow-sm dark:from-surface-secondary dark:to-surface-tertiary dark:border-border dark:open:shadow-md dark:open:shadow-black/20"
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
                <div className="border-t border-border-light dark:border-border px-4 pb-4 space-y-3">
                <div className="pt-1">
                  <p className="text-[10px] text-text-secondary uppercase mb-1">Partner cost</p>
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
                  anchorSellPrice={Number(panelSellPrice) || 0}
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

              {convertedJob && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-2"><Briefcase className="h-4 w-4 text-emerald-600" /><label className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Converted to Job</label></div>
                  <a href={`/jobs?jobId=${convertedJob.id}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/50 text-sm font-semibold text-primary">
                    <Briefcase className="h-4 w-4" /> {convertedJob.reference}
                  </a>
                </div>
              )}

              {["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status) && (
                <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-4">
                  {quote.status === "awaiting_customer" && (
                    <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 dark:bg-amber-950/25 dark:border-amber-800/50 px-3 py-2.5 space-y-1">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Edit after sending</p>
                      <p className="text-[11px] text-amber-900/85 dark:text-amber-100/85 leading-snug">
                        You can still change <strong className="font-semibold text-amber-950 dark:text-amber-50">line items, scope, dates, deposit, message</strong> and open{" "}
                        <strong className="font-semibold text-amber-950 dark:text-amber-50">Pricing & margin</strong> for partner/sell figures. Use{" "}
                        <strong className="font-semibold text-amber-950 dark:text-amber-50">Save proposal</strong> to store only, or{" "}
                        <strong className="font-semibold text-amber-950 dark:text-amber-50">Save & send PDF</strong> below to save and email an updated PDF in one step.
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-text-primary">
                      {quote.status === "awaiting_customer" ? "Customer proposal" : "Customer proposal (required before Send to Customer)"}
                    </p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {quote.status === "awaiting_customer" ? (
                        <>The customer&apos;s Accept / Reject links stay the same; they receive the latest PDF each time you send or resend.</>
                      ) : (
                        <>Two default lines match the partner app: <strong className="text-text-secondary">type of work</strong> and <strong className="text-text-secondary">Materials</strong>. Approving a bid pre-fills from the bid (+40% labour / +25% materials on partner costs). Use the slider to scale customer prices; edit lines manually anytime.</>
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border-light bg-card/80 dark:bg-surface-secondary/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Customer price scale</p>
                      <span className="text-xs font-bold tabular-nums text-primary">{proposalScalePercent}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      step={1}
                      value={proposalScalePercent}
                      disabled={!canUseProposalMarginSlider}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setProposalScalePercent(v);
                        recalcCustomerLinePricesFromPartnerScale(v, partnerLabourCost, partnerMaterialsCost);
                      }}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer accent-primary disabled:opacity-40 disabled:cursor-not-allowed bg-border dark:bg-zinc-700"
                    />
                    <p className="text-[10px] text-text-tertiary leading-snug">
                      100% = +40% on partner labour and +25% on partner materials. Below 100% reduces; above increases (up to 1000%).
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div className="rounded-lg bg-surface-hover/80 border border-border-light px-3 py-2">
                        <p className="text-[9px] font-semibold text-text-tertiary uppercase">Line 1 · Labour</p>
                        <p className="text-[11px] text-text-secondary mt-1">
                          Partner <span className="font-semibold tabular-nums">{formatCurrency(partnerLabourCost)}</span>
                          {" · "}
                          Sell <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(proposalLine0Sell)}</span>
                        </p>
                        <p className={cn("text-xs font-bold mt-0.5 tabular-nums", proposalMarginLabourPct >= 20 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                          Margin {proposalMarginLabourPct}%
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface-hover/80 border border-border-light px-3 py-2">
                        <p className="text-[9px] font-semibold text-text-tertiary uppercase">Line 2 · Materials</p>
                        <p className="text-[11px] text-text-secondary mt-1">
                          Partner <span className="font-semibold tabular-nums">{formatCurrency(partnerMaterialsCost)}</span>
                          {" · "}
                          Sell <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(proposalLine1Sell)}</span>
                        </p>
                        <p className={cn("text-xs font-bold mt-0.5 tabular-nums", proposalMarginMaterialsPct >= 20 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                          Margin {proposalMarginMaterialsPct}%
                        </p>
                      </div>
                    </div>
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
                          <div className="flex-1 min-w-0">
                            <Input placeholder={idx === 0 ? "Type of work / labour" : idx === 1 ? "Materials" : "Service / description"} value={item.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)} className="text-xs mb-1.5" />
                            <div className="flex gap-2 flex-wrap">
                              <Input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} className="text-xs w-20" />
                              <Input type="number" placeholder="Unit price (customer)" value={item.unitPrice} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)} className="text-xs flex-1 min-w-[100px]" />
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 pt-1 shrink-0">
                            <span className="text-xs font-semibold text-text-primary tabular-nums">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</span>
                            {lineItems.length > 1 && (idx >= 2 || !["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status)) && (
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
                      <Input type="date" min={minProposalStartDate} value={startDate1} onChange={(e) => setStartDate1(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 2</label>
                      <Input type="date" min={minProposalStartDate} value={startDate2} onChange={(e) => setStartDate2(e.target.value)} />
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

              <div className="rounded-xl border border-border-light bg-surface-hover/80 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-text-tertiary" />
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Customer PDF preview</p>
                </div>
                <p className="text-[11px] text-text-tertiary">
                  Matches the PDF attached when you email the client. Uses <strong className="text-text-secondary">saved</strong> scope, line items and figures — save the proposal or quote figures to refresh.
                </p>
                <div className="rounded-lg border border-border bg-white dark:bg-zinc-900 overflow-hidden">
                  <iframe
                    title="Quote PDF preview"
                    src={`/api/quotes/send-pdf?quoteId=${encodeURIComponent(quote.id)}`}
                    className="w-full border-0 bg-white dark:bg-zinc-950"
                    style={{ height: 480, maxHeight: "65vh" }}
                    key={`pdf-${quote.id}-${quote.updated_at}`}
                  />
                </div>
              </div>

              {quote.status === "awaiting_customer" && (
                <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-4">
                  <div className="flex items-start gap-2">
                    <Mail className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Save & email customer</p>
                      <p className="text-[11px] text-text-tertiary mt-0.5">
                        The button below <strong className="text-text-secondary">saves the proposal to the quote</strong>, then emails the PDF with the same secure{" "}
                        <strong className="text-text-secondary">Accept</strong> / <strong className="text-text-secondary">Reject</strong> links. Use it after any edit, or{" "}
                        <strong className="text-text-secondary">Save proposal</strong> above if you only want to store changes without emailing yet.
                      </p>
                    </div>
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
                      placeholder="Short note shown above the buttons in the email…"
                      rows={2}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                    />
                  </div>
                  <details className="group rounded-lg border border-border-light bg-surface-hover/60 px-3 py-2">
                    <summary className="text-[11px] font-medium text-text-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
                      <span>Preview links & email</span>
                      <ChevronDown className="h-3.5 w-3.5 text-text-tertiary shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 space-y-3 pt-1 border-t border-border-light">
                      {previewLoading ? (
                        <div className="flex items-center gap-2 text-xs text-text-tertiary py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                        </div>
                      ) : (
                        <>
                          {previewLinks ? (
                            <div className="space-y-1.5 text-[11px]">
                              <p className="text-[10px] font-semibold text-text-tertiary uppercase">Customer links</p>
                              <div>
                                <span className="text-text-tertiary">Accept · </span>
                                <a href={previewLinks.acceptUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{previewLinks.acceptUrl}</a>
                              </div>
                              <div>
                                <span className="text-text-tertiary">Reject · </span>
                                <a href={previewLinks.rejectUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{previewLinks.rejectUrl}</a>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-text-tertiary">Links unavailable</p>
                          )}
                          <div>
                            <p className="text-[10px] font-semibold text-text-tertiary uppercase mb-1.5">Email body</p>
                            <div className="rounded-lg border border-border bg-white overflow-hidden" style={{ minHeight: 200 }}>
                              {emailPreviewHtml ? (
                                <iframe
                                  srcDoc={emailPreviewHtml}
                                  title="Email preview"
                                  className="w-full border-0 bg-white"
                                  style={{ height: 280, maxHeight: "50vh" }}
                                />
                              ) : (
                                <div className="flex items-center justify-center text-xs text-text-tertiary p-4">No preview</div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                  <Button
                    type="button"
                    onClick={() => void handleSendToCustomer()}
                    disabled={sendState === "sending" || !sendStep3Ready}
                    icon={sendState === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    className="w-full"
                  >
                    {sendState === "sending"
                      ? "Saving & sending…"
                      : quoteEmailedInSession || sendState === "sent"
                        ? "Save & resend PDF to customer"
                        : "Save & send PDF to customer"}
                  </Button>
                  {(sendState === "sent" || quoteEmailedInSession) && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Last PDF emailed to {sendEmail}. Edit anything above, then use this button again or <strong className="font-semibold">Resend email</strong> next to Mark Accepted.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2 pt-4 border-t border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Move this quote</p>
                <p className="text-[11px] text-text-tertiary -mt-1 mb-1">
                  {quote.status === "awaiting_customer" ? (
                    <>The customer uses <strong className="text-text-secondary">Accept</strong> or <strong className="text-text-secondary">Reject</strong> in the email. You can edit the quote anytime, then <strong className="text-text-secondary">Save & send PDF</strong> or <strong className="text-text-secondary">Resend email</strong> here.</>
                  ) : (
                    <>After the proposal above is complete, use <strong className="text-text-secondary">Send to Customer</strong> to move to Awaiting Customer, then email the PDF from the section below.</>
                  )}
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  {quote.status === "awaiting_customer" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={sendState === "sending" || !sendStep3Ready}
                      icon={sendState === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      onClick={() => void handleSendToCustomer()}
                      title="Saves the latest proposal and emails the PDF again"
                    >
                      {sendState === "sending"
                        ? "Saving…"
                        : quoteEmailedInSession || sendState === "sent"
                          ? "Resend email"
                          : "Send email"}
                    </Button>
                  )}
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
              <Button variant="outline" size="sm" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setInvitePartnerOpen(true)} className="w-full">
                Invite more partners
              </Button>
              <div className="p-4 rounded-xl bg-surface-hover border border-border-light">
                <p className="text-sm font-semibold text-text-primary">Partner bids (from app)</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  Optional: approve one bid to lock <strong className="text-text-secondary">partner cost</strong> on the quote. The quote stays in bidding until you send it to the customer — it is{" "}
                  <strong className="text-text-secondary">not</strong> customer-accepted yet. Then set <strong className="text-text-secondary">your price</strong> on Review & Send, complete the proposal, and use{" "}
                  <strong className="text-text-secondary">Send to Customer</strong>. After the client accepts, convert to a job.
                </p>
              </div>
              {quote.status === "bidding" && bids.some((b) => b.status === "approved") && (
                <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-3">
                  <p className="text-sm font-semibold text-text-primary">Ready to price for the customer</p>
                  <p className="text-xs text-text-tertiary">
                    Partner cost comes from the approved bid. Adjust <strong className="text-text-secondary">your sell price</strong> and margin on Review & Send, then complete the proposal and send.
                  </p>
                  <div className="flex flex-wrap gap-6 text-sm">
                    <div>
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner cost</p>
                      <p className="font-bold text-text-primary mt-0.5">{formatCurrency(Number(quote.partner_cost ?? quote.cost ?? 0))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Your price (customer)</p>
                      <p className="font-bold text-primary mt-0.5">{formatCurrency(Number(quote.sell_price ?? quote.total_value ?? 0))}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setTab("overview");
                    }}
                  >
                    Open Review & Send — pricing & proposal
                  </Button>
                </div>
              )}
              {bidsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : bids.length === 0 ? (
                <p className="text-sm text-text-tertiary">
                  No partner bids yet — that&apos;s fine. Set partner cost and sell price on Review & Send, then move to <strong className="text-text-secondary">Awaiting Customer</strong> and send the email.
                </p>
              ) : (
                <div className="space-y-3">
                  {bids.map((bid) => (
                    <div key={bid.id} className="flex items-center justify-between p-4 rounded-xl bg-surface-hover border border-border-light">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{bid.partner_name ?? bid.partner_id}</p>
                        <p className="text-lg font-bold text-primary mt-0.5">{formatCurrency(bid.bid_amount)}</p>
                        {(() => {
                          const bidNoteSummary = summarizeBidProposalNotes(bid.notes);
                          if (bidNoteSummary) {
                            return <p className="text-xs text-text-tertiary mt-1">{bidNoteSummary}</p>;
                          }
                          if (bid.notes?.trim()) {
                            return <p className="text-xs text-text-tertiary mt-1 whitespace-pre-wrap">{bid.notes}</p>;
                          }
                          return null;
                        })()}
                        <Badge variant={bid.status === "approved" ? "success" : bid.status === "rejected" ? "danger" : "default"} size="sm" className="mt-2">{bid.status}</Badge>
                      </div>
                      {bid.status === "submitted" && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            try {
                              const pre = computeCustomerProposalFromBid(bid, quote);
                              const scopeMerged = pre.scopeText ?? scopeText;
                              const d1 = pre.startDate1 ?? startDate1;
                              const d2 = pre.startDate2 ?? startDate2;
                              const dep = pre.depositRequired ?? depositRequired;

                              await approveBid(bid.id, quote.id, bid.partner_id, bid.partner_name, bid.bid_amount);

                              const updated = await persistProposalToQuote({
                                lineItemsOverride: pre.lines,
                                scopeTextOverride: scopeMerged,
                                startDate1Override: d1,
                                startDate2Override: d2,
                                depositOverride: dep,
                                partnerCostOverride: bid.bid_amount,
                              });

                              await loadBids(quote.id);

                              const lineTot = pre.lines.reduce(
                                (s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0),
                                0,
                              );
                              setLineItems(pre.lines);
                              setScopeText(scopeMerged.trim());
                              setStartDate1(d1);
                              setStartDate2(d2);
                              setDepositRequired(dep);
                              setPartnerLabourCost(pre.labourP);
                              setPartnerMaterialsCost(pre.materialsP);
                              setProposalScalePercent(100);
                              setPanelPartnerCost(String(bid.bid_amount));
                              setPanelSellPrice(String(lineTot));

                              onQuoteUpdate?.(updated);
                              setTab("overview");
                              toast.success(
                                "Bid approved. Customer proposal pre-filled (40% labour / 25% materials markup). Adjust on Review & Send if needed, then send to the customer.",
                              );
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed to approve bid");
                            }
                          }}
                        >
                          Approve
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
      return { ok: false, message: "Set total value (sell price) before sending to customer — use Review & Send pricing or line items." };
    }
    return proposalFieldsReadyForQuote(quote);
  }
  if (quote.status === "bidding" && nextStatus === "awaiting_customer") {
    if (Number(quote.total_value) <= 0) return { ok: false, message: "Set total value before sending to customer (Step 4: Margin & PDF)." };
    return proposalFieldsReadyForQuote(quote);
  }
  return { ok: true };
}

function getQuoteActions(quote: Quote) {
  const isManual = (quote.quote_type ?? "internal") === "internal";
  switch (quote.status) {
    case "draft":
      if (isManual) {
        return [
          { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
          { label: "Reject", status: "rejected", icon: XCircle, primary: false },
        ];
      }
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Start Bidding", status: "bidding", icon: Send, primary: false },
        { label: "In Survey", status: "in_survey", icon: Eye, primary: false },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "in_survey":
      if (isManual) {
        return [
          { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
          { label: "Back to Draft", status: "draft", icon: RotateCcw, primary: false },
          { label: "Reject", status: "rejected", icon: XCircle, primary: false },
        ];
      }
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Start Bidding", status: "bidding", icon: Send, primary: false },
        { label: "Back to Draft", status: "draft", icon: RotateCcw, primary: false },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "bidding":
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Back to Draft", status: "draft", icon: RotateCcw, primary: false },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "awaiting_customer":
      return [
        { label: "Mark Accepted", status: "accepted", icon: CheckCircle2, primary: true },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
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
/** Client preferred start date from quote (YYYY-MM-DD for date inputs). */
function preferredScheduleDateFromQuote(q: Quote): string {
  const raw = (q.start_date_option_1?.trim() || q.start_date_option_2?.trim()) ?? "";
  if (!raw) return "";
  return raw.slice(0, 10);
}

function CreateJobFromQuoteModal({ quote, onClose, onSubmit }: {
  quote: Quote | null; onClose: () => void;
  onSubmit: (data: { title: string; client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null; createWithoutDeposit?: boolean; job_type?: "fixed" | "hourly"; scope?: string }) => void;
}) {
  const [form, setForm] = useState({ title: "", partner_id: "", client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", arrival_from: "", arrival_to: "", expected_finish_date: "", scope: "", createWithoutDeposit: false, job_type: "fixed" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    if (!quote) return;
    setForm({
      title: quote.title ?? "", partner_id: quote.partner_id ?? "",
      client_price: String(quote.total_value ?? 0), partner_cost: String(quote.partner_cost ?? 0),
      materials_cost: "0", scheduled_date: preferredScheduleDateFromQuote(quote), arrival_from: "", arrival_to: "", expected_finish_date: "",
      scope: quote.scope ?? "",
      createWithoutDeposit: false, job_type: "fixed",
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

  const typeOfWorkOptions = useMemo(
    () => withTypeOfWorkFallback(form.title).map((name) => ({ value: name, label: name })),
    [form.title]
  );

  if (!quote) return null;
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) { toast.error("Job title is required"); return; }
    if (!clientAddress.client_id || !clientAddress.property_address) { toast.error("Please select a client and property address"); return; }
    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    const scheduled_date = form.scheduled_date || undefined;
    const hasFrom = !!form.arrival_from?.trim();
    const hasTo = !!form.arrival_to?.trim();
    if ((hasFrom && !hasTo) || (!hasFrom && hasTo)) {
      toast.error("Set both arrival window start and end, or leave both empty.");
      return;
    }
    const effectivePartnerId = form.partner_id || quote.partner_id;
    if (effectivePartnerId) {
      if (!scheduled_date?.trim()) {
        toast.error("Set a scheduled date before assigning a partner.");
        return;
      }
      if (!hasFrom || !hasTo) {
        toast.error("Set the arrival window (from and to) when assigning a partner.");
        return;
      }
      const startMs = new Date(`${scheduled_date}T${form.arrival_from}:00`).getTime();
      const endMs = new Date(`${scheduled_date}T${form.arrival_to}:00`).getTime();
      if (!(endMs > startMs)) {
        toast.error("Arrival window end must be after start.");
        return;
      }
    }
    const expected_finish = form.expected_finish_date?.trim() || undefined;
    if (expected_finish && scheduled_date && expected_finish < scheduled_date) {
      toast.error("Expected finish date must be on or after the scheduled date.");
      return;
    }
    let scheduled_start_at: string | undefined;
    let scheduled_end_at: string | undefined;
    if (scheduled_date && hasFrom && hasTo) {
      scheduled_start_at = `${scheduled_date}T${form.arrival_from}:00`;
      scheduled_end_at = `${scheduled_date}T${form.arrival_to}:00`;
    } else if (scheduled_date && hasFrom) {
      scheduled_start_at = `${scheduled_date}T${form.arrival_from}:00`;
    }
    const scopeTrimmed = (form.scope ?? "").trim();
    if (effectivePartnerId) {
      const block = getPartnerAssignmentBlockReason({
        property_address: clientAddress.property_address,
        scope: scopeTrimmed || (quote.scope ?? "").trim(),
        scheduled_date,
        scheduled_start_at,
        partner_id: effectivePartnerId,
        partner_ids: [],
      });
      if (block) {
        toast.error(block);
        return;
      }
    }
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
      scheduled_end_at,
      scheduled_finish_date: expected_finish ?? null,
      createWithoutDeposit: form.createWithoutDeposit,
      job_type: form.job_type as "fixed" | "hourly",
    });
  };

  return (
    <Modal open={!!quote} onClose={onClose} title="Create Job from Quote" subtitle={`${quote.reference} — create job`} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <Select
          label="Type of work *"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          options={[
            { value: "", label: "Select type of work..." },
            ...typeOfWorkOptions,
          ]}
        />
        <Select
          label="Job type"
          value={form.job_type}
          onChange={(e) => update("job_type", e.target.value)}
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "hourly", label: "Hourly" },
          ]}
        />
        <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Scope of work *</label>
          <textarea
            value={form.scope}
            onChange={(e) => update("scope", e.target.value)}
            placeholder="Describe scope, inclusions and exclusions for the job (required when assigning a partner)."
            rows={4}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
          />
          <p className="text-[10px] text-text-tertiary mt-1">
            Pre-filled from the quote when available. Required if you assign a partner.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled date</label>
          <Input type="date" value={form.scheduled_date} onChange={(e) => update("scheduled_date", e.target.value)} className="h-10 max-w-[200px]" />
          <p className="text-[10px] text-text-tertiary mt-1">
            Pre-filled from the client&apos;s preferred start date on the quote (option 1, else option 2) when set.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Arrival window from</label><Input type="time" value={form.arrival_from} onChange={(e) => update("arrival_from", e.target.value)} className="h-10" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Arrival window to</label><Input type="time" value={form.arrival_to} onChange={(e) => update("arrival_to", e.target.value)} className="h-10" /></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Expected finish date</label>
          <Input type="date" value={form.expected_finish_date} onChange={(e) => update("expected_finish_date", e.target.value)} className="h-10 max-w-[200px]" />
        </div>
        <p className="text-[10px] text-text-tertiary -mt-2">With a partner, date and both window times are required. Late applies after the window ends. Expected finish is date-only for the calendar span.</p>
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

/** Max markup % on partner cost (slider only; typed sell price can go higher). */
const MARGIN_SLIDER_MAX_MARKUP_PCT = 200;

/** Gross margin % on sell → markup % on partner cost (unbounded for display/slider state). */
function grossMarginOnSellToMarkupPct(g: number): number {
  if (g <= 0 || Number.isNaN(g)) return 5;
  const gSafe = Math.min(g, 99.89);
  return Math.max(5, (gSafe / (100 - gSafe)) * 100);
}

/** Markup % on cost → gross margin % on sell (stored as margin_percent). */
function markupPctToGrossMarginOnSell(markupPct: number): number {
  return (markupPct / (100 + markupPct)) * 100;
}

/* ========== MARGIN CALCULATOR ========== */
function MarginCalculator({
  cost,
  initialMarginPct,
  anchorSellPrice = 0,
  onSellPriceChange,
  onMarginChange,
}: {
  cost: number;
  initialMarginPct?: number;
  /** When set (> 0), keeps markup slider aligned with partner cost and sell price typed outside the slider. */
  anchorSellPrice?: number;
  onSellPriceChange: (v: number) => void;
  onMarginChange: (v: number) => void;
}) {
  const [markupPct, setMarkupPct] = useState(() => grossMarginOnSellToMarkupPct(initialMarginPct ?? 40));
  /** While editing sell manually, raw string; cleared on blur so slider stays in sync. */
  const [sellDraft, setSellDraft] = useState<string | null>(null);

  const sellFromMarkup = cost > 0 ? Math.round(cost * (1 + markupPct / 100) * 100) / 100 : 0;
  const sellPrice = sellFromMarkup;
  const marginValue = sellPrice - cost;
  const grossMarginPct = markupPctToGrossMarginOnSell(markupPct);

  const minSellForSlider = cost > 0 ? Math.round(cost * 1.05 * 100) / 100 : 0;

  useEffect(() => {
    if (sellDraft !== null) return;
    if (cost <= 0 || anchorSellPrice <= 0) return;
    const m = (anchorSellPrice / cost - 1) * 100;
    if (!Number.isFinite(m)) return;
    const next = Math.round(Math.max(5, m) * 10) / 10;
    setMarkupPct(next);
  }, [cost, anchorSellPrice, sellDraft]);

  useEffect(() => {
    onSellPriceChange(sellPrice);
    onMarginChange(Math.round(grossMarginPct * 10) / 10);
  }, [markupPct, sellPrice, grossMarginPct, onSellPriceChange, onMarginChange]);

  const applySellFromInput = () => {
    if (cost <= 0) {
      setSellDraft(null);
      return;
    }
    const rawStr = (sellDraft ?? "").trim();
    setSellDraft(null);
    if (rawStr === "") return;
    const raw = Number(rawStr.replace(",", "."));
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(minSellForSlider, raw);
    const m = (clamped / cost - 1) * 100;
    setMarkupPct(Math.round(Math.max(5, m) * 10) / 10);
  };

  return (
    <div className="p-4 rounded-xl border border-border-light bg-surface-tertiary/70 dark:bg-surface-secondary dark:border-border">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="h-4 w-4 text-text-secondary" />
        <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Margin Calculator</label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div><p className="text-[10px] text-text-secondary uppercase">Partner cost</p><p className="text-sm font-bold text-text-primary">{formatCurrency(cost)}</p></div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase mb-1">Sell price</p>
          {cost <= 0 ? (
            <p className="text-sm font-bold text-primary">—</p>
          ) : (
            <Input
              type="text"
              inputMode="decimal"
              className="text-sm font-bold h-9"
              disabled={cost <= 0}
              value={sellDraft !== null ? sellDraft : sellPrice === 0 ? "" : String(sellPrice)}
              placeholder="0.00"
              onFocus={() => setSellDraft(sellPrice === 0 ? "" : String(sellPrice))}
              onChange={(e) => setSellDraft(e.target.value)}
              onBlur={() => applySellFromInput()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          )}
          <p className="text-[10px] text-text-secondary dark:text-text-tertiary mt-1 leading-snug">
            Slider up to +{MARGIN_SLIDER_MAX_MARKUP_PCT}% markup; you can type a higher sell price — margin % updates below (min +5% on cost).
          </p>
        </div>
        <div><p className="text-[10px] text-text-secondary uppercase">Margin</p><p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(marginValue)}</p></div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-text-secondary">Markup on partner cost</span>
          <span className="text-[10px] text-text-secondary">
            Margin on sell:{" "}
            <span className={`font-bold ${grossMarginPct >= 40 ? "text-primary" : grossMarginPct >= 10 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400"}`}>
              {Math.round(grossMarginPct * 10) / 10}%
            </span>
            <span className="text-text-secondary font-semibold"> · {Math.round(markupPct * 10) / 10}% markup</span>
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={MARGIN_SLIDER_MAX_MARKUP_PCT}
          step={0.5}
          value={Math.min(MARGIN_SLIDER_MAX_MARKUP_PCT, Math.max(5, markupPct))}
          onChange={(e) => {
            setSellDraft(null);
            setMarkupPct(Number(e.target.value));
          }}
          disabled={cost <= 0}
          className="w-full h-2 rounded-full appearance-none cursor-pointer accent-primary disabled:opacity-50 disabled:cursor-not-allowed bg-border dark:bg-zinc-700"
        />
        <div className="flex justify-between text-[10px] text-text-secondary gap-1 flex-wrap">
          <span className="tabular-nums">5%</span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">10% min margin</span>
          <span className="text-primary font-medium">40% target margin</span>
          <span className="tabular-nums">{MARGIN_SLIDER_MAX_MARKUP_PCT}%</span>
        </div>
        {markupPct > MARGIN_SLIDER_MAX_MARKUP_PCT && (
          <p className="text-[10px] text-text-secondary">
            Markup is above the slider range ({Math.round(markupPct * 10) / 10}%); drag the slider to bring it back to {MARGIN_SLIDER_MAX_MARKUP_PCT}% or less.
          </p>
        )}
        {grossMarginPct < 40 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1">Below standard margin on sell (40%)</p>
        )}
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
  const typeOfWorkOptions = useMemo(
    () => [...new Set([...TYPE_OF_WORK_OPTIONS, ...catalogList.map((c) => c.name)])]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name })),
    [catalogList]
  );

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
          { value: "internal", label: "Manual quote" },
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

      <Select
        label="Type of work *"
        value={form.title}
        onChange={(e) => update("title", e.target.value)}
        options={[
          { value: "", label: "Select type of work..." },
          ...typeOfWorkOptions,
        ]}
      />
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
              anchorSellPrice={sellPrice}
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
