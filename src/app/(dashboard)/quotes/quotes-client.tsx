"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense, useLayoutEffect, Fragment } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column, type ColumnSortOption } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, Download, List, LayoutGrid, Calendar, Map as MapIcon,
  FileText, BarChart3, Clock, ArrowRight, Check,
  Send, CheckCircle2, RotateCcw, RefreshCw, XCircle,
  Mail,
  Loader2, Eye, Trash2, Briefcase, Users, SlidersHorizontal, Save,
  ClipboardList, MapPin, Gavel, UserRound, Building2, Sparkles, ChevronDown, Brain,
  Wallet, Percent, PoundSterling, ImagePlus, X, Pencil, UserPlus,
  MailCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrency, cn, normalizeCalendarDateToYmd, formatYmdUkDisplay } from "@/lib/utils";
import { toast } from "sonner";
import type { Quote, Partner, Job } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listQuotes, createQuote, updateQuote, getQuote } from "@/services/quotes";
import { getClient } from "@/services/clients";
import { getAccount } from "@/services/accounts";
import {
  findDuplicateJobs,
  findDuplicateQuotes,
  formatJobDuplicateLines,
  formatQuoteDuplicateLines,
} from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { createJob, getJobByQuoteId } from "@/services/jobs";
import { listPartners } from "@/services/partners";
import { useBuFilter } from "@/hooks/use-bu-filter";
import { isPartnerEligibleForWork } from "@/lib/partner-status";
import {
  getBidsByQuoteId,
  getSubmittedBidAveragesByQuoteIds,
  approveBid,
  type QuoteBid,
} from "@/services/quote-bids";
import { getRequest } from "@/services/requests";
import { getStatusCounts, getSupabase, softDeleteById, type ListParams, type ListResult } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { KanbanBoard } from "@/components/shared/kanban-board";
import { normalizeTotalPhases } from "@/lib/job-phases";
import { getPartnerAssignmentBlockReason } from "@/lib/job-partner-assign";
import { getErrorMessage, isUuid, isValidIsoDateTime, parseIsoDateOnly } from "@/lib/utils";
import { localYmdEndIso, localYmdStartIso } from "@/lib/date-range";
import { getScheduleRangeYmd, ukTodayYmd, type ScheduleDatePreset } from "@/lib/uk-schedule-range";
import { insertQuoteLineItemsResilient } from "@/lib/quote-line-items-insert";
import { resolveJobModalSchedule } from "@/lib/job-modal-schedule";
import { JobModalScheduleFields } from "@/components/shared/job-modal-schedule-fields";
import { TYPE_OF_WORK_OPTIONS, withTypeOfWorkFallback, mergeTypeOfWorkOptions, normalizeTypeOfWork } from "@/lib/type-of-work";
import { ExportCsvModal } from "@/components/shared/export-csv-modal";
import { buildCsvFromRows, downloadCsvFile } from "@/lib/csv-export";
import {
  parseBidProposalFromNotes,
  splitBidPartnerCosts,
  summarizeBidProposalNotes,
  bidPayloadTrimmedString,
  BID_DEFAULT_MARGIN_ON_SELL,
  customerUnitSellFromPartnerUnit,
} from "@/lib/quote-bid-payload";
import { safePartnerMatchesTypeOfWork, partnerMatchTypeLabel } from "@/lib/partner-type-of-work-match";
import {
  clampDepositPercent,
  depositAmountFromPercent,
  inferDepositPercentFromLegacy,
} from "@/lib/quote-deposit";
import { extractUkPostcode, normalizeUkPostcode } from "@/lib/uk-postcode";
import {
  buildNotesWithPricing,
  defaultPartnerPricingForLineIndex,
  parseProposalLineNotes,
  proposalLineHintDisplay,
  stringifyProposalLineNotes,
  type PartnerLinePricingMode,
} from "@/lib/quote-proposal-line-notes";
import { resolveImagesForJobFromQuote } from "@/lib/job-images";

const UI_PERF_EVENT = "master-ui-perf";

function trackUiPerf(metric: string, ms: number, meta?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const payload = { metric, ms: Math.round(ms), ts: Date.now(), ...(meta ?? {}) };
  window.dispatchEvent(new CustomEvent(UI_PERF_EVENT, { detail: payload }));
  if (process.env.NODE_ENV !== "production") {
    console.info(`[ui-perf] ${metric}: ${payload.ms}ms`, meta ?? {});
  }
}

const QUOTE_STATUSES = ["draft", "in_survey", "bidding", "awaiting_customer", "accepted", "rejected", "converted_to_job"] as const;

/**
 * Label for proposal line 1: type of work only.
 * Quote `title` often includes client (e.g. "Electrical — Jane Doe"); prefer `service_type`, else strip after " — ".
 */
function proposalFirstLineLabel(q: Quote): string {
  const st = bidPayloadTrimmedString(q.service_type as unknown);
  if (st) return st;
  const t = bidPayloadTrimmedString(q.title as unknown);
  if (!t) return "Type of work";
  const sep = " — ";
  const i = t.indexOf(sep);
  if (i > 0) return t.slice(0, i).trim();
  return t;
}

/** Second line under quote reference: postcode only (column + parse from property address). */
function quoteListSubtitlePostcode(q: Quote): string {
  const col = bidPayloadTrimmedString(q.postcode as unknown);
  if (col) {
    const parsed = extractUkPostcode(col);
    return normalizeUkPostcode(parsed ?? col);
  }
  const addr = bidPayloadTrimmedString(q.property_address as unknown);
  if (addr) {
    const fromAddr = extractUkPostcode(addr);
    if (fromAddr) return fromAddr;
  }
  return "—";
}

/** Two starter rows: type of work + materials (partner app aligns with this shape). */
function defaultProposalLineItems(q: Quote): ProposalLineRow[] {
  const first = proposalFirstLineLabel(q);
  return [
    {
      description: first,
      quantity: "1",
      unitPrice: "0",
      partnerUnitCost: "0",
      notes: stringifyProposalLineNotes({ v: 1, partnerPricing: "fixed" }),
    },
    {
      description: "Materials",
      quantity: "1",
      unitPrice: "0",
      partnerUnitCost: "0",
      notes: stringifyProposalLineNotes({ v: 1, partnerPricing: "unit" }),
    },
  ];
}

function marginPctOnSell(sell: number, partnerCost: number): number {
  if (!(sell > 0) || !Number.isFinite(sell)) return 0;
  return Math.round(((sell - partnerCost) / sell) * 1000) / 10;
}

type ProposalLineRow = {
  description: string;
  quantity: string;
  /** Customer unit sell price */
  unitPrice: string;
  /** Partner cost per unit (fixed when from approved bid on the first two lines) */
  partnerUnitCost: string;
  notes?: string;
};

function linePartnerSubtotal(li: ProposalLineRow | undefined): number {
  if (!li) return 0;
  return (Number(li.quantity) || 0) * (Number(li.partnerUnitCost) || 0);
}

/** Partner scope titles sometimes arrive as "Labour (1)" / "Materials (1)" — strip trailing index. */
function stripPartnerLineIndexSuffix(s: string): string {
  return s.replace(/\s*\(\d+\)\s*$/, "").trim();
}

function lineItemDescriptionForCustomer(li: ProposalLineRow, lineIdx?: number): string {
  let d = bidPayloadTrimmedString(li.description as unknown);
  if (lineIdx !== undefined && lineIdx < 2) d = stripPartnerLineIndexSuffix(d);
  const hint = proposalLineHintDisplay(parseProposalLineNotes(li.notes));
  if (!hint) return d;
  return `${d} (Note: ${hint})`;
}

function partnerFieldLabelsForLine(idx: number, pricing: PartnerLinePricingMode): { qty: string; partner: string; sell: string } {
  if (idx === 0) {
    return pricing === "hourly"
      ? { qty: "Hours (qty)", partner: "Partner £/hr", sell: "Sell £/hr" }
      : { qty: "Qty", partner: "Partner / unit", sell: "Sell / unit" };
  }
  return pricing === "bulk"
    ? { qty: "Qty", partner: "Partner total (£)", sell: "Sell total (£)" }
    : { qty: "Qty", partner: "Partner £/unit", sell: "Sell £/unit" };
}

function computeCustomerProposalFromBid(bid: QuoteBid, q: Quote): {
  lines: ProposalLineRow[];
  labourP: number;
  materialsP: number;
  scopeText?: string;
  startDate1?: string;
  startDate2?: string;
  /** % of customer sell; if bid payload had £ deposit, converted using line totals. */
  depositPercent?: string;
} {
  const payload = parseBidProposalFromNotes(bid.notes);
  const { labour: L, materials: M } = splitBidPartnerCosts(bid.bid_amount, payload);
  const line0Desc = stripPartnerLineIndexSuffix(
    bidPayloadTrimmedString(payload?.labour_description) || proposalFirstLineLabel(q),
  );
  const line1Desc = stripPartnerLineIndexSuffix(
    bidPayloadTrimmedString(payload?.materials_description) || "Materials",
  );
  const labourPricing: PartnerLinePricingMode = payload?.labour_pricing === "hourly" ? "hourly" : "fixed";
  const materialsPricing: PartnerLinePricingMode = payload?.materials_pricing === "bulk" ? "bulk" : "unit";

  let q0 = "1";
  let partnerUnit0 = L;
  let marginBasis0 = L;
  if (labourPricing === "hourly") {
    const hrs = Number(payload?.labour_hours);
    const rate = Number(payload?.labour_rate);
    if (hrs > 0 && rate > 0) {
      const check = hrs * rate;
      if (L <= 0.001 || Math.abs(check - L) <= Math.max(1, 0.02 * Math.max(L, check))) {
        q0 = String(hrs);
        partnerUnit0 = rate;
        marginBasis0 = rate;
      }
    }
  }
  const u0 = customerUnitSellFromPartnerUnit(marginBasis0);

  let q1 = "1";
  let partnerUnit1 = M;
  let marginBasis1 = M;
  if (materialsPricing === "unit") {
    const mq = Number(payload?.materials_quantity);
    const mpu = Number(payload?.materials_partner_unit);
    if (mq > 0 && mpu > 0) {
      const check = mq * mpu;
      if (M <= 0.001 || Math.abs(check - M) <= Math.max(0.01, 0.02 * Math.max(M, check))) {
        q1 = String(mq);
        partnerUnit1 = mpu;
        marginBasis1 = mpu;
      }
    }
  }
  const u1 = customerUnitSellFromPartnerUnit(marginBasis1);

  const lineTotSell = Number(q0) * u0 + Number(q1) * u1;
  return {
    lines: [
      {
        description: line0Desc,
        quantity: q0,
        unitPrice: String(u0),
        partnerUnitCost: String(partnerUnit0),
        notes: stringifyProposalLineNotes({ v: 1, partnerPricing: labourPricing }),
      },
      {
        description: line1Desc,
        quantity: q1,
        unitPrice: String(u1),
        partnerUnitCost: String(partnerUnit1),
        notes: stringifyProposalLineNotes({ v: 1, partnerPricing: materialsPricing }),
      },
    ],
    labourP: L,
    materialsP: M,
    scopeText: (() => {
      const s = bidPayloadTrimmedString(payload?.scope);
      return s || undefined;
    })(),
    startDate1:
      normalizeCalendarDateToYmd(bidPayloadTrimmedString(payload?.start_date_option_1 as unknown)) || undefined,
    startDate2:
      normalizeCalendarDateToYmd(bidPayloadTrimmedString(payload?.start_date_option_2 as unknown)) || undefined,
    depositPercent:
      payload?.deposit_required != null &&
      Number.isFinite(Number(payload.deposit_required)) &&
      Number(payload.deposit_required) > 0 &&
      lineTotSell > 0.01
        ? String(
            clampDepositPercent(
              Math.round((Number(payload.deposit_required) / lineTotSell) * 1000) / 10,
            ),
          )
        : undefined,
  };
}

/** Auto-pick: lowest submitted price; tie → most recently updated bid. */
function compareBidsForCheapest(a: QuoteBid, b: QuoteBid): number {
  const pa = Number(a.bid_amount) || 0;
  const pb = Number(b.bid_amount) || 0;
  if (pa !== pb) return pa - pb;
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

type BidPriceRankLabel = "Lowest" | "Mid" | "Highest";

/** Submitted + approved bids only (rejected excluded from price spread). */
function bidsEligibleForPriceSpread(bids: QuoteBid[]): QuoteBid[] {
  return bids.filter((b) => b.status === "submitted" || b.status === "approved");
}

/**
 * Default collapsed view: up to 3 bids — lowest, median, highest by price.
 * If the selected bid would fall outside that triple, the centre slot shows the selection instead.
 */
function computeBidSpotlight(bids: QuoteBid[], selectedId: string | null): { bid: QuoteBid; label: BidPriceRankLabel }[] {
  const pool = [...bidsEligibleForPriceSpread(bids)].sort(compareBidsForCheapest);
  const n = pool.length;
  if (n === 0) return [];
  if (n === 1) return [{ bid: pool[0], label: "Mid" }];
  if (n === 2) {
    return [
      { bid: pool[0], label: "Lowest" },
      { bid: pool[1], label: "Highest" },
    ];
  }
  const L = pool[0];
  const H = pool[n - 1];
  const midIdx = Math.floor((n - 1) / 2);
  let C = pool[midIdx];
  const sel = selectedId ? pool.find((b) => b.id === selectedId) : undefined;
  if (sel && sel.id !== L.id && sel.id !== C.id && sel.id !== H.id) {
    C = sel;
  }
  const seen = new Set<string>();
  const triple: QuoteBid[] = [];
  for (const b of [L, C, H]) {
    if (!seen.has(b.id)) {
      seen.add(b.id);
      triple.push(b);
    }
  }
  if (triple.length < 3 && n > triple.length) {
    for (const b of pool) {
      if (triple.length >= 3) break;
      if (!seen.has(b.id)) {
        seen.add(b.id);
        triple.push(b);
      }
    }
  }
  const sorted = [...triple].sort(compareBidsForCheapest);
  return sorted.map((bid, i) => ({
    bid,
    label:
      sorted.length === 1
        ? "Mid"
        : sorted.length === 2
          ? i === 0
            ? "Lowest"
            : "Highest"
          : i === 0
            ? "Lowest"
            : i === sorted.length - 1
              ? "Highest"
              : "Mid",
  }));
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

/** Same ordering as `QuoteStageColumn` for list sort. */
const QUOTE_STATUS_SORT_ORDER: Record<string, number> = {
  draft: 0,
  in_survey: 1,
  bidding: 2,
  awaiting_customer: 3,
  accepted: 4,
  rejected: -1,
  converted_to_job: 5,
};

const SORT_CLEAR: ColumnSortOption = { label: "Default order", sortKey: null, direction: "asc" };

/** By quote `created_at` — available from any column’s sort menu. */
const QUOTE_SORT_CREATED: ColumnSortOption[] = [
  { label: "Newest first", sortKey: "__created_at", direction: "desc" },
  { label: "Oldest first", sortKey: "__created_at", direction: "asc" },
];

const QUOTE_SORT_REFERENCE: ColumnSortOption[] = [
  { label: "Quote A → Z", sortKey: "reference", direction: "asc" },
  { label: "Quote Z → A", sortKey: "reference", direction: "desc" },
  ...QUOTE_SORT_CREATED,
  SORT_CLEAR,
];

function quoteSortTextCol(columnKey: string, title: string): ColumnSortOption[] {
  return [
    { label: `${title} A → Z`, sortKey: columnKey, direction: "asc" },
    { label: `${title} Z → A`, sortKey: columnKey, direction: "desc" },
    ...QUOTE_SORT_CREATED,
  ];
}

const QUOTE_SORT_STAGE: ColumnSortOption[] = [
  { label: "Early stage first", sortKey: "status", direction: "asc" },
  { label: "Late stage first", sortKey: "status", direction: "desc" },
  ...QUOTE_SORT_CREATED,
];

const QUOTE_SORT_AMOUNT: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "total_value", direction: "asc" },
  { label: "High to low", sortKey: "total_value", direction: "desc" },
  ...QUOTE_SORT_CREATED,
];

const QUOTE_SORT_MARGIN: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "margin_percent", direction: "asc" },
  { label: "High to low", sortKey: "margin_percent", direction: "desc" },
  ...QUOTE_SORT_CREATED,
];

const QUOTE_SORT_AVG_BID: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "avg_bid", direction: "asc" },
  { label: "High to low", sortKey: "avg_bid", direction: "desc" },
  ...QUOTE_SORT_CREATED,
];

const STAGE_META: { id: string; label: string; short: string; icon: typeof ClipboardList }[] = [
  { id: "draft", label: "Draft", short: "Draft", icon: ClipboardList },
  { id: "in_survey", label: "Survey", short: "Survey", icon: MapPin },
  { id: "bidding", label: "Bidding", short: "Bids", icon: Gavel },
  { id: "awaiting_customer", label: "Awaiting customer", short: "Awaiting customer", icon: UserRound },
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
          "Based on market conditions, our AI selects the best quote based on price, availability and region. You can still manually choose any other bid at any time.",
      };
    case "awaiting_customer":
      return {
        headline: "Waiting on the customer",
        detail: "You can still edit the proposal or pricing, then use Resend Quote (under Move this quote) so the client gets an updated attachment — links stay the same.",
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

interface QuotesClientProps {
  initialData?: ListResult<Quote> | null;
}

export function QuotesClient({ initialData }: QuotesClientProps = {}) {
  return (
    <Suspense
      fallback={
        <PageTransition>
          <div className="p-8 text-sm text-text-tertiary">Loading quotes…</div>
        </PageTransition>
      }
    >
      <QuotesPageContent initialData={initialData} />
    </Suspense>
  );
}

function QuotesPageContent({ initialData }: QuotesClientProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refreshSilent,
  } = useSupabaseList<Quote>({
    fetcher: listQuotesForPage,
    /** No realtime auto-refresh — avoids fetch loops; list reloads use `refreshSilent` / `refreshWithKpis` (no `refresh()`). */
    initialStatus: "pipeline",
    initialData,
  });

  /** Latest list rows for deep-link / effects — avoids re-running quoteId logic on every `data` reference change. */
  const quotesListDataRef = useRef(data);
  quotesListDataRef.current = data;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const kpiAnchorDayKey = ukTodayYmd(new Date());
  const [kpiSchedulePreset, setKpiSchedulePreset] = useState<ScheduleDatePreset>("month");
  const [kpiCustomFrom, setKpiCustomFrom] = useState(() => ukTodayYmd(new Date()));
  const [kpiCustomTo, setKpiCustomTo] = useState(() => ukTodayYmd(new Date()));
  const [kpiDateFilterOpen, setKpiDateFilterOpen] = useState(false);
  const kpiDateFilterRef = useRef<HTMLDivElement>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiSummary, setKpiSummary] = useState({
    totalQuotedValue: 0,
    biddingCount: 0,
    rejectedValue: 0,
    conversionPct: 0,
    convertedCount: 0,
    totalCount: 0,
  });
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterQuoteType, setFilterQuoteType] = useState<"all" | "internal" | "partner">("all");
  const buFilter = useBuFilter();
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);
  const [drawerPendingTab, setDrawerPendingTab] = useState<"overview" | "bids" | null>(null);
  const consumeDrawerPendingTab = useCallback(() => setDrawerPendingTab(null), []);
  const kpiRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const qid = searchParams.get("quoteId");
    if (!qid || loading) return;
    let cancelled = false;
    (async () => {
      let found = quotesListDataRef.current.find((q) => q.id === qid) ?? null;
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
  }, [searchParams, loading, router]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (filterRef.current && !filterRef.current.contains(t)) setFilterOpen(false);
      if (kpiDateFilterOpen && kpiDateFilterRef.current && !kpiDateFilterRef.current.contains(t)) setKpiDateFilterOpen(false);
    }
    if (filterOpen || kpiDateFilterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen, kpiDateFilterOpen]);

  const filteredQuotes = useMemo(() => {
    return data.filter((q) => {
      if (filterQuoteType !== "all" && (q.quote_type ?? "internal") !== filterQuoteType) return false;
      if (buFilter.selectedBuId) {
        if (!buFilter.clientIdsInBu) return true;
        if (!q.client_id || !buFilter.clientIdsInBu.has(q.client_id)) return false;
      }
      return true;
    });
  }, [data, filterQuoteType, buFilter.selectedBuId, buFilter.clientIdsInBu]);

  const [avgBidByQuoteId, setAvgBidByQuoteId] = useState<Record<string, number>>({});
  const dataIdsKey = useMemo(() => data.map((q) => q.id).sort().join(","), [data]);

  const refreshListBidAverages = useCallback(async () => {
    const ids = quotesListDataRef.current.map((q) => q.id);
    if (ids.length === 0) {
      setAvgBidByQuoteId({});
      return;
    }
    try {
      setAvgBidByQuoteId(await getSubmittedBidAveragesByQuoteIds(ids));
    } catch {
      /* table still usable */
    }
  }, []);

  useEffect(() => {
    if (status !== "bidding") {
      setAvgBidByQuoteId({});
      return;
    }
    void refreshListBidAverages();
  }, [dataIdsKey, status, refreshListBidAverages]);

  const [listSortKey, setListSortKey] = useState<string | null>(null);
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (listSortKey === "avg_bid" && status !== "bidding") setListSortKey(null);
  }, [status, listSortKey]);

  const quoteListSorted = useMemo(() => {
    const rows = [...filteredQuotes];
    if (!listSortKey) return rows;
    const mul = listSortDir === "asc" ? 1 : -1;
    const typeOfWorkSort = (q: Quote) =>
      normalizeTypeOfWork(q.service_type) || normalizeTypeOfWork(q.title) || q.title || "";
    rows.sort((a, b) => {
      switch (listSortKey) {
        case "reference":
          return mul * (a.reference ?? "").localeCompare(b.reference ?? "", undefined, { sensitivity: "base" });
        case "client_name":
          return mul * (a.client_name ?? "").localeCompare(b.client_name ?? "", undefined, { sensitivity: "base" });
        case "service_type":
          return mul * typeOfWorkSort(a).localeCompare(typeOfWorkSort(b), undefined, { sensitivity: "base" });
        case "quote_type":
          return mul * String(a.quote_type ?? "").localeCompare(String(b.quote_type ?? ""));
        case "status": {
          const ao = QUOTE_STATUS_SORT_ORDER[a.status] ?? 0;
          const bo = QUOTE_STATUS_SORT_ORDER[b.status] ?? 0;
          return mul * (ao - bo);
        }
        case "avg_bid": {
          const av = avgBidByQuoteId[a.id];
          const bv = avgBidByQuoteId[b.id];
          const an = typeof av === "number" && Number.isFinite(av) ? av : Number.NEGATIVE_INFINITY;
          const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : Number.NEGATIVE_INFINITY;
          return mul * (an - bn);
        }
        case "total_value":
          return mul * ((Number(a.total_value) || 0) - (Number(b.total_value) || 0));
        case "margin_percent":
          return mul * ((Number(a.margin_percent) || 0) - (Number(b.margin_percent) || 0));
        case "__created_at":
          return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        default:
          return 0;
      }
    });
    return rows;
  }, [filteredQuotes, listSortKey, listSortDir, avgBidByQuoteId]);

  const handleQuoteListSortChange = useCallback((key: string | null, direction: "asc" | "desc") => {
    setListSortKey(key);
    setListSortDir(direction);
  }, []);

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

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => () => {
    if (kpiRefreshTimerRef.current) clearTimeout(kpiRefreshTimerRef.current);
  }, []);

  /** Background list refresh — avoids full-table loading skeleton on every action (enterprise UX). */
  const refreshWithKpis = useCallback((delayMs = 180) => {
    refreshSilent();
    if (kpiRefreshTimerRef.current) clearTimeout(kpiRefreshTimerRef.current);
    kpiRefreshTimerRef.current = setTimeout(() => {
      void loadCounts();
    }, delayMs);
  }, [refreshSilent, loadCounts]);

  const kpiScheduleRangeYmd = useMemo(
    () => getScheduleRangeYmd(kpiSchedulePreset, kpiCustomFrom, kpiCustomTo),
    [kpiSchedulePreset, kpiCustomFrom, kpiCustomTo, kpiAnchorDayKey],
  );

  const kpiDateBounds = useMemo(() => {
    if (!kpiScheduleRangeYmd) return null;
    return {
      from: localYmdStartIso(kpiScheduleRangeYmd.from),
      to: localYmdEndIso(kpiScheduleRangeYmd.to),
    };
  }, [kpiScheduleRangeYmd]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setKpiLoading(true);
      try {
        const supabase = getSupabase();
        const base = supabase.from("quotes").select("status,total_value,created_at");
        const { data, error } = kpiDateBounds
          ? await base.gte("created_at", kpiDateBounds.from).lte("created_at", kpiDateBounds.to)
          : await base;
        if (error) throw error;
        const rows = (data ?? []) as Array<{ status: string; total_value?: number | null }>;
        const openStatuses = new Set(["draft", "in_survey", "bidding", "awaiting_customer", "accepted", "converted_to_job"]);
        const totalQuotedValue = rows
          .filter((r) => openStatuses.has(r.status))
          .reduce((s, r) => s + (Number(r.total_value) || 0), 0);
        const biddingCount = rows.filter((r) => r.status === "bidding").length;
        const rejectedValue = rows
          .filter((r) => r.status === "rejected")
          .reduce((s, r) => s + (Number(r.total_value) || 0), 0);
        const convertedCount = rows.filter((r) => r.status === "converted_to_job").length;
        const totalCount = rows.length;
        const conversionPct = totalCount > 0 ? Math.round((convertedCount / totalCount) * 1000) / 10 : 0;
        if (!cancelled) {
          setKpiSummary({ totalQuotedValue, biddingCount, rejectedValue, conversionPct, convertedCount, totalCount });
        }
      } catch {
        if (!cancelled) {
          setKpiSummary({ totalQuotedValue: 0, biddingCount: 0, rejectedValue: 0, conversionPct: 0, convertedCount: 0, totalCount: 0 });
        }
      } finally {
        if (!cancelled) setKpiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kpiDateBounds]);

  const pipelineCount =
    (statusCounts.draft ?? 0) +
    (statusCounts.in_survey ?? 0) +
    (statusCounts.bidding ?? 0) +
    (statusCounts.awaiting_customer ?? 0) +
    (statusCounts.accepted ?? 0);

  /** Same tab strip pattern as Requests: underline + count badges. */
  const quoteStageTabs = useMemo(
    () => [
      { id: "pipeline", label: "Active pipeline", count: pipelineCount },
      { id: "draft", label: "Draft", count: statusCounts.draft ?? 0 },
      { id: "bidding", label: "Bidding", count: statusCounts.bidding ?? 0 },
      { id: "awaiting_customer", label: "Awaiting customer", count: statusCounts.awaiting_customer ?? 0 },
      { id: "accepted", label: "Accepted", count: statusCounts.accepted ?? 0 },
      { id: "rejected", label: "Rejected", count: statusCounts.rejected ?? 0 },
      { id: "all", label: "All quotes", count: statusCounts.all ?? 0 },
      { id: "converted_to_job", label: "Converted", count: statusCounts.converted_to_job ?? 0 },
    ],
    [statusCounts, pipelineCount],
  );

  /** Share of quotes in selected KPI date window that became jobs (`converted_to_job`). */
  const quoteToJobConversion = useMemo(
    () => ({ pct: kpiSummary.conversionPct, converted: kpiSummary.convertedCount, total: kpiSummary.totalCount }),
    [kpiSummary],
  );

  const handleCreate = useCallback(
    async (formData: Partial<Quote>, options?: { manualLineItems?: ProposalLineRow[] }) => {
      const perfStart = performance.now();
      try {
        const dupQ = await findDuplicateQuotes({
          clientEmail: formData.client_email ?? "",
          title: formData.title ?? "",
          propertyAddress: formData.property_address,
        });
        if (!(await confirmDespiteDuplicates(formatQuoteDuplicateLines(dupQ)))) return;

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
          deposit_percent: formData.deposit_percent ?? 50,
          deposit_required: formData.deposit_required ?? 0,
          customer_accepted: false,
          customer_deposit_paid: false,
          partner_id: formData.partner_id,
          partner_name: formData.partner_name,
          property_address: formData.property_address,
          scope: formData.scope,
          start_date_option_1: formData.start_date_option_1,
          start_date_option_2: formData.start_date_option_2,
          partner_cost: formData.partner_cost ?? formData.cost ?? 0,
          ...(formData.service_type?.trim() ? { service_type: formData.service_type.trim() } : {}),
          ...(formData.images?.length ? { images: formData.images } : {}),
          email_attach_request_photos: formData.email_attach_request_photos ?? false,
          owner_id: profile?.id,
          owner_name: profile?.full_name,
        });

        const manualLines = options?.manualLineItems;
        if (formData.quote_type === "internal" && manualLines?.length) {
          const supabase = getSupabase();
          const rows = manualLines.map((li, i) => ({
            quote_id: result.id,
            description: i < 2 ? stripPartnerLineIndexSuffix(li.description) : li.description,
            quantity: Number(li.quantity) || 1,
            unit_price: Number(li.unitPrice) || 0,
            partner_unit_cost: Number(li.partnerUnitCost) || 0,
            sort_order: i,
            notes: bidPayloadTrimmedString(li.notes as unknown) || null,
          }));
          await insertQuoteLineItemsResilient(supabase, rows);
        }

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
        refreshWithKpis();
        if ((formData.quote_type ?? "internal") === "internal") {
          setSelectedQuote(result);
        }
        trackUiPerf("quotes.create_quote_ms", performance.now() - perfStart, {
          quoteType: formData.quote_type ?? "internal",
          lineItems: manualLines?.length ?? 0,
        });
      } catch (err) {
        console.error(err);
        toast.error(getErrorMessage(err, "Failed to create quote"));
      }
    },
    [refreshWithKpis, profile?.id, profile?.full_name, confirmDespiteDuplicates],
  );

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("quotes").update({ status: newStatus, updated_at: new Date().toISOString() }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("quote", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} quotes updated`);
      setSelectedIds(new Set());
      refreshWithKpis();
    } catch { toast.error("Failed to update quotes"); }
  };

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => softDeleteById("quotes", id, profile?.id)));
      toast.success(`${selectedIds.size} quotes archived`);
      setSelectedIds(new Set());
      refreshWithKpis();
    } catch {
      toast.error("Failed to archive quotes");
    }
  }, [selectedIds, profile?.id, refreshWithKpis]);

  const handleConfirmCreateJob = useCallback(
    async (formData: { title: string; client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null; createWithoutDeposit?: boolean; job_type?: "fixed" | "hourly"; scope?: string }) => {
      const perfStart = performance.now();
      if (!quoteToConvert) return;
      const effectivePartnerId = formData.partner_id ?? quoteToConvert.partner_id;
      const jobScope = (formData.scope ?? "").trim() || (quoteToConvert.scope ?? "").trim();
      const scheduled_date = parseIsoDateOnly(formData.scheduled_date ?? "") || undefined;
      let scheduled_start_at: string | undefined = formData.scheduled_start_at;
      let scheduled_end_at: string | undefined = formData.scheduled_end_at;
      if (!scheduled_date) {
        scheduled_start_at = undefined;
        scheduled_end_at = undefined;
      } else {
        if (!isValidIsoDateTime(scheduled_start_at)) scheduled_start_at = undefined;
        if (!isValidIsoDateTime(scheduled_end_at)) scheduled_end_at = undefined;
      }
      const finishRaw = formData.scheduled_finish_date;
      const scheduled_finish_date =
        finishRaw == null || finishRaw === "" ? null : parseIsoDateOnly(String(finishRaw)) || null;
      if (effectivePartnerId) {
        const block = getPartnerAssignmentBlockReason({
          property_address: formData.property_address,
          scope: jobScope,
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
      try {
        const margin = formData.client_price > 0 ? Math.round(((formData.client_price - formData.partner_cost - formData.materials_cost) / formData.client_price) * 1000) / 10 : 0;
        const noDeposit = !!formData.createWithoutDeposit;
        const scheduledDeposit = noDeposit ? 0 : (quoteToConvert.deposit_required ?? 0);
        const scheduledFinal = Math.max(0, formData.client_price - scheduledDeposit);
        const quotePartnerId = formData.partner_id ?? quoteToConvert.partner_id;
        const quotePartnerName = (formData.partner_name ?? quoteToConvert.partner_name)?.trim();
        const hasPartner = !!(quotePartnerId?.trim() || quotePartnerName);
        const [dupJobs, siteImages] = await Promise.all([
          findDuplicateJobs({
            clientId: formData.client_id,
            propertyAddress: formData.property_address,
            title: formData.title,
          }),
          resolveImagesForJobFromQuote(quoteToConvert),
        ]);
        if (!(await confirmDespiteDuplicates(formatJobDuplicateLines(dupJobs)))) return;

        const job = await createJob({
          title: formData.title,
          client_id: formData.client_id,
          client_address_id: formData.client_address_id,
          property_id: quoteToConvert.property_id ?? undefined,
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
          scheduled_date,
          scheduled_start_at,
          scheduled_end_at,
          scheduled_finish_date,
          owner_id: profile?.id, owner_name: profile?.full_name,
          job_type: formData.job_type ?? "fixed",
          cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
          partner_agreed_value: (formData.partner_cost ?? 0) + (formData.materials_cost ?? 0),
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
          images: siteImages.length ? siteImages : undefined,
        });

        /** Draft invoice is created inside `createJob` (unified for quote + modal paths). */
        await Promise.all([
          updateQuote(quoteToConvert.id, { status: "converted_to_job" }),
          logAudit({ entityType: "job", entityId: job.id, entityRef: job.reference, action: "created", metadata: { from_quote: quoteToConvert.reference }, userId: profile?.id, userName: profile?.full_name }),
        ]);
        setQuoteToConvert(null); setSelectedQuote(null);
        toast.success(`Job ${job.reference} created`);
        refreshWithKpis();
        router.push(`/jobs?jobId=${job.id}`);
        trackUiPerf("quotes.convert_to_job_ms", performance.now() - perfStart, { hasPartner: hasPartner });
      } catch (err) {
        toast.error(getErrorMessage(err, "Failed to create job"));
      }
    },
    [quoteToConvert, refreshWithKpis, profile?.id, profile?.full_name, router, confirmDespiteDuplicates]
  );

  const handleStatusChange = useCallback(
    async (quote: Quote, newStatus: string, opts?: { successToast?: string }): Promise<boolean> => {
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
        if (typeof window !== "undefined" && !window.confirm("Margin is below 25%. Move to Awaiting Customer anyway?")) {
          return false;
        }
      }
      try {
        const perfStart = performance.now();
        const updated = await updateQuote(quote.id, { status: newStatus as Quote["status"] });
        await logAudit({ entityType: "quote", entityId: quote.id, entityRef: quote.reference, action: "status_changed", fieldName: "status", oldValue: quote.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
        setSelectedQuote(updated);
        if (newStatus === "accepted") {
          setQuoteToConvert(updated);
        }
        toast.success(opts?.successToast ?? `Quote moved to ${statusLabels[newStatus] ?? newStatus}`);
        refreshWithKpis();
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
        trackUiPerf("quotes.status_change_ms", performance.now() - perfStart, { from: quote.status, to: newStatus });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update quote";
        toast.error(message);
        console.error("Quote status update failed:", err);
        return false;
      }
    },
    [refreshWithKpis, profile?.id, profile?.full_name]
  );

  /**
   * Drawer saves: update the open quote only. Do not refetch the quotes list here — that was chaining
   * extra `get_quotes_list_bundle` / enrichment traffic and could interact badly with effects. The table
   * catches up when the user uses **Refresh** (or creates / bulk-actions / status moves that call `refreshWithKpis`).
   */
  const handleQuoteDrawerUpdate = useCallback((updated: Quote) => {
    setSelectedQuote(updated);
  }, []);

  const [exportOpen, setExportOpen] = useState(false);
  const quoteVisibleFields = ["reference", "title", "client_name", "service_type", "quote_type", "status", "total_value", "margin_percent"];
  const quoteAllFields = useMemo(
    () => [...new Set(data.flatMap((row) => Object.keys(row as unknown as Record<string, unknown>)))],
    [data],
  );

  const handleExport = useCallback(async (fields: string[]) => {
    try {
      const allRows: Quote[] = [];
      let p = 1;
      const pageSize = 500;
      while (true) {
        const res = await listQuotes({
          page: p,
          pageSize,
          search: search.trim() ? search : undefined,
          status: status !== "all" ? status : undefined,
        });
        allRows.push(...res.data);
        if (p >= res.totalPages) break;
        p += 1;
      }
      if (allRows.length === 0) {
        toast.info("No quotes to export");
        return;
      }
      const rows = allRows as unknown as Array<Record<string, unknown>>;
      const finalFields = fields.length > 0 ? fields : [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const csv = buildCsvFromRows(rows, finalFields);
      downloadCsvFile(`quotes-${status}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${allRows.length} quotes with full fields`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export quotes");
    }
  }, [search, status]);

  const handleNewQuoteClick = () => setCreateOpen(true);

  const columns: Column<Quote>[] = useMemo(() => {
    const lead: Column<Quote>[] = [
      {
        key: "reference",
        label: "Quote",
        width: "200px",
        sortable: true,
        sortOptions: QUOTE_SORT_REFERENCE,
        render: (item) => (
          <div>
            <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
            <p className="text-[11px] text-text-tertiary truncate max-w-[180px]">{quoteListSubtitlePostcode(item)}</p>
          </div>
        ),
      },
      {
        key: "client_name",
        label: "Client",
        minWidth: "8.5rem",
        sortable: true,
        sortOptions: quoteSortTextCol("client_name", "Client"),
        render: (item) => (
          <div className="flex items-start gap-2 min-w-0">
            <Avatar
              name={item.client_name}
              size="sm"
              className="shrink-0 mt-0.5"
              src={item.source_account_logo_url?.trim() || undefined}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{item.client_name}</p>
              {item.source_account_name?.trim() ? (
                <p className="text-[11px] text-text-tertiary truncate max-w-[200px]">{item.source_account_name}</p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: "service_type",
        label: "Type of work",
        minWidth: "10.5rem",
        sortable: true,
        sortOptions: quoteSortTextCol("service_type", "Type of work"),
        render: (item) => {
          const type = normalizeTypeOfWork(item.service_type) || normalizeTypeOfWork(item.title) || item.title || "—";
          return <span className="text-sm text-text-secondary truncate block max-w-[180px]">{type}</span>;
        },
      },
      {
        key: "quote_type",
        label: "Type",
        minWidth: "5rem",
        sortable: true,
        sortOptions: quoteSortTextCol("quote_type", "Type"),
        render: (item) => (
          <Badge variant={item.quote_type === "partner" ? "warning" : "info"} size="sm">
            {item.quote_type === "partner" ? "Partner" : "Manual"}
          </Badge>
        ),
      },
      {
        key: "status",
        label: "Stage",
        minWidth: "8rem",
        sortable: true,
        sortOptions: QUOTE_SORT_STAGE,
        render: (item) => <QuoteStageColumn status={item.status} />,
      },
    ];
    const avgBidColumn: Column<Quote> = {
      key: "avg_bid",
      label: "AVG Bid",
      minWidth: "5.5rem",
      align: "right" as const,
      sortable: true,
      sortOptions: QUOTE_SORT_AVG_BID,
      render: (item) => {
        const avg = avgBidByQuoteId[item.id];
        return typeof avg === "number" && Number.isFinite(avg) ? (
          <span className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(avg)}</span>
        ) : (
          <span className="text-sm text-text-tertiary">—</span>
        );
      },
    };
    const tail: Column<Quote>[] = [
      {
        key: "total_value",
        label: "Amount",
        minWidth: "5.5rem",
        align: "right" as const,
        sortable: true,
        sortOptions: QUOTE_SORT_AMOUNT,
        render: (item) => <span className="text-sm font-semibold text-text-primary">{formatCurrency(Number(item.total_value) || 0)}</span>,
      },
      {
        key: "margin_percent",
        label: "Margin",
        minWidth: "4.75rem",
        sortable: true,
        sortOptions: QUOTE_SORT_MARGIN,
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
    return status === "bidding" ? [...lead, avgBidColumn, ...tail] : [...lead, ...tail];
  }, [status, avgBidByQuoteId]);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Quotes"
          infoTooltip={
            "Headline KPIs use each quote’s creation date within the Dates window above.\n\n" +
            "Status tabs filter the list below."
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative" ref={kpiDateFilterRef}>
              <Button
                variant="outline"
                size="sm"
                icon={<Calendar className="h-3.5 w-3.5" />}
                onClick={() => setKpiDateFilterOpen((o) => !o)}
                className={cn(kpiScheduleRangeYmd && "border-primary/40 bg-primary/5")}
              >
                {kpiSchedulePreset === "all"
                  ? "Dates"
                  : kpiSchedulePreset === "today"
                    ? "Today"
                    : kpiSchedulePreset === "tomorrow"
                      ? "Tomorrow"
                      : kpiSchedulePreset === "week"
                        ? "This week"
                        : kpiSchedulePreset === "month"
                          ? "This month"
                          : "Custom range"}
              </Button>
              {kpiDateFilterOpen && (
                <div className="absolute top-full right-0 mt-1 w-[min(calc(100vw-2rem),280px)] rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">KPI window (created date)</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ["all", "All dates"],
                        ["today", "Today"],
                        ["tomorrow", "Tomorrow"],
                        ["week", "This week"],
                        ["month", "This month"],
                        ["custom", "Custom"],
                      ] as const
                    ).map(([id, label]) => (
                      <Button
                        key={id}
                        type="button"
                        variant={kpiSchedulePreset === id ? "primary" : "ghost"}
                        size="sm"
                        className={cn(
                          "h-8 justify-center px-3 text-[11px] font-medium rounded-[6px]",
                          kpiSchedulePreset !== id && "text-[#020040]",
                        )}
                        onClick={() => {
                          setKpiSchedulePreset(id);
                          if (id === "custom") setKpiDateFilterOpen(true);
                          else setKpiDateFilterOpen(false);
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  {kpiSchedulePreset === "custom" ? (
                    <div className="space-y-2 pt-1 border-t border-border-light">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">From · to</p>
                      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
                        <Input type="date" value={kpiCustomFrom} onChange={(e) => setKpiCustomFrom(e.target.value)} className="h-9 text-sm" />
                        <Input type="date" value={kpiCustomTo} onChange={(e) => setKpiCustomTo(e.target.value)} className="h-9 text-sm" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => {
                void loadCounts();
                refreshSilent();
              }}
              title="Reload quotes and tab counts from the server (no full-table loading flash)"
            >
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setExportOpen(true)}>
              Export
            </Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleNewQuoteClick}>New Quote</Button>
          </div>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Quoted"
            value={kpiSummary.totalQuotedValue}
            format="currency"
            icon={BarChart3}
            accent="primary"
            description="Includes Awaiting Customer value"
            descriptionAsTooltip
          />
          <KpiCard
            title="Bidding"
            value={kpiSummary.biddingCount}
            format="number"
            icon={FileText}
            accent="blue"
            description="No. of quotes in bidding"
            descriptionAsTooltip
          />
          <KpiCard title="Rejected Value" value={kpiSummary.rejectedValue} format="currency" icon={XCircle} accent="amber" />
          <KpiCard
            title="Conversion Rate"
            value={quoteToJobConversion.pct}
            format="percent"
            icon={Briefcase}
            accent="emerald"
            description={
              quoteToJobConversion.total === 0
                ? "No quotes yet"
                : `${quoteToJobConversion.converted} job${quoteToJobConversion.converted === 1 ? "" : "s"} from ${quoteToJobConversion.total} quote${quoteToJobConversion.total === 1 ? "" : "s"} · conversion rate`
            }
            descriptionAsTooltip
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 -mb-1 [scrollbar-width:thin]">
              <Tabs tabs={quoteStageTabs} activeTab={status} onChange={setStatus} />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: MapIcon }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setExportOpen(true)}>
                Export
              </Button>
              <SearchInput
                placeholder="Search quotes..."
                className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="relative flex items-center gap-1.5" ref={filterRef}>
                <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>
                  Filter
                </Button>
                {(filterQuoteType !== "all" || buFilter.selectedBuId) && (
                  <span className="text-[10px] font-medium text-primary">Active</span>
                )}
                {filterOpen && (
                  <div className="absolute top-full right-0 mt-1 w-[min(100vw-2rem,18rem)] rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Quote type</p>
                      <select value={filterQuoteType} onChange={(e) => setFilterQuoteType(e.target.value as "all" | "internal" | "partner")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                        <option value="all">All</option>
                        <option value="internal">Manual</option>
                        <option value="partner">Partner</option>
                      </select>
                    </div>
                    {buFilter.visible && (
                      <div>
                        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Business Unit</p>
                        <select
                          value={buFilter.selectedBuId ?? ""}
                          onChange={(e) => buFilter.setSelectedBuId(e.target.value || null)}
                          className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2"
                        >
                          <option value="">All BUs</option>
                          {buFilter.bus.map((bu) => (
                            <option key={bu.id} value={bu.id}>{bu.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFilterQuoteType("all"); buFilter.setSelectedBuId(null); }}>Clear filters</Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {viewMode === "list" && (
            <DataTable
              columns={columns}
              data={quoteListSorted}
              columnConfigKey="quotes-columns"
              columnConfigScope={status}
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
              sortColumnKey={listSortKey}
              sortDirection={listSortDir}
              onSortChange={handleQuoteListSortChange}
              bulkActions={
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  <BulkBtn label="Bidding" onClick={() => handleBulkStatusChange("bidding")} variant="default" />
                  <BulkBtn label="Awaiting Customer" onClick={() => handleBulkStatusChange("awaiting_customer")} variant="warning" />
                  <BulkBtn label="Accept" onClick={() => handleBulkStatusChange("accepted")} variant="success" />
                  <BulkBtn label="Reject" onClick={() => handleBulkStatusChange("rejected")} variant="danger" />
                  <BulkBtn label="Archive" onClick={handleBulkArchive} variant="warning" />
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
                      <p className="text-xs text-text-tertiary truncate">{quoteListSubtitlePostcode(q)}</p>
                      {q.source_account_name?.trim() ? (
                        <p className="text-[10px] text-text-tertiary truncate">{q.source_account_name}</p>
                      ) : null}
                      <p className="text-xs font-medium text-primary mt-1">{formatCurrency(Number(q.total_value) || 0)}</p>
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

      {selectedQuote ? (
      <QuoteDetailDrawer
        key={selectedQuote.id}
        quote={selectedQuote}
        pendingInitialTab={drawerPendingTab}
        onConsumePendingInitialTab={consumeDrawerPendingTab}
        onClose={() => setSelectedQuote(null)}
        onStatusChange={handleStatusChange}
        onQuoteUpdate={handleQuoteDrawerUpdate}
      />
      ) : null}
      {quoteToConvert ? (
        <CreateJobFromQuoteModal
          key={quoteToConvert.id}
          quote={quoteToConvert}
          onClose={() => setQuoteToConvert(null)}
          onSubmit={handleConfirmCreateJob}
        />
      ) : null}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Quote"
        subtitle="Manual quote uses the same layout as Review & Send — line items, scope, dates, deposit"
        size="lg"
        scrollBody
      >
        <CreateQuoteForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
      <ExportCsvModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        allFields={quoteAllFields}
        visibleFields={quoteVisibleFields}
        onConfirm={handleExport}
      />
    </PageTransition>
  );
}

/** Single compact strip: selected partner cost or avg bid, submissions count, invited partners, quoted (partner quotes). */
function PartnerBidMiniDash({
  bidsLoading,
  primaryLabel,
  primaryValue,
  bidsReceivedCount,
  invitedPartnersCount,
  quotedPartnersCount,
}: {
  bidsLoading: boolean;
  primaryLabel: string;
  primaryValue: number | null;
  bidsReceivedCount: number;
  invitedPartnersCount: number;
  quotedPartnersCount: number;
}) {
  return (
    <div
      className="rounded-xl border border-border-light/70 bg-border-light/40 dark:bg-border p-px overflow-hidden shadow-sm"
      role="region"
      aria-label="Partner figures: cost or average bid, bids received, invited and quoted partners"
    >
      <div className="grid grid-cols-2 min-[400px]:grid-cols-4 gap-px">
        <div className="bg-card dark:bg-surface-secondary/55 px-2.5 py-2.5 min-w-0">
          <p className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide text-text-tertiary leading-tight">{primaryLabel}</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-text-primary leading-tight truncate">
            {bidsLoading ? "…" : primaryValue != null ? formatCurrency(primaryValue) : "—"}
          </p>
        </div>
        <div className="bg-card dark:bg-surface-secondary/55 px-2.5 py-2.5 min-w-0" title="Partner submissions on this quote">
          <p className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide text-text-tertiary leading-tight">Bids</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-text-primary leading-tight">{bidsReceivedCount}</p>
        </div>
        <div className="bg-card dark:bg-surface-secondary/55 px-2.5 py-2.5 min-w-0">
          <p className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide text-text-tertiary leading-tight">Invited</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-text-primary leading-tight">{invitedPartnersCount}</p>
        </div>
        <div className="bg-card dark:bg-surface-secondary/55 px-2.5 py-2.5 min-w-0">
          <p className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide text-text-tertiary leading-tight">Quoted</p>
          <p
            className={cn(
              "mt-0.5 text-base font-bold tabular-nums leading-tight",
              quotedPartnersCount === 0 ? "text-[#6B6B70]" : "text-primary",
            )}
          >
            {quotedPartnersCount}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Quote pipeline without Survey — Draft → Bids → Awaiting → Won (in_survey maps to Draft). */
const QUOTE_DRAWER_PIPELINE: readonly { id: string; label: string; short: string; icon: typeof ClipboardList }[] = [
  { id: "draft", label: "Draft", short: "Draft", icon: ClipboardList },
  { id: "bidding", label: "Bidding", short: "Bids", icon: Gavel },
  { id: "awaiting_customer", label: "Awaiting customer", short: "Awaiting", icon: UserRound },
  { id: "accepted", label: "Accepted", short: "Won", icon: CheckCircle2 },
];

const QUOTE_NAVY = "#020040";

/** Horizontal pipeline stepper — compact, navy active/completed, grey future (Survey hidden). */
function QuotePipelineStepper({ status }: { status: string }) {
  const legacyMap: Record<string, number> = {
    draft: 0,
    in_survey: 0,
    bidding: 1,
    awaiting_customer: 2,
    accepted: 3,
    rejected: -1,
    converted_to_job: 5,
  };
  const current = legacyMap[status] ?? 0;
  const n = QUOTE_DRAWER_PIPELINE.length;

  if (current === -1) {
    return (
      <section className="overflow-hidden rounded-xl border border-border-light bg-card/30" aria-label="Quote stage">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
            <XCircle className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">Rejected</p>
            <p className="text-[10px] text-text-tertiary">Quote closed</p>
          </div>
        </div>
      </section>
    );
  }

  if (current === 5) {
    return (
      <section className="overflow-hidden rounded-xl border border-border-light bg-card/30" aria-label="Quote stage">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-secondary">
            <Briefcase className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">Converted to job</p>
            <p className="text-[10px] text-text-tertiary">Continue in Jobs</p>
          </div>
        </div>
      </section>
    );
  }

  const flowStep = Math.min(Math.max(current, 0), n - 1);
  const headline = statusLabels[status] ?? QUOTE_DRAWER_PIPELINE[flowStep]?.label ?? "Progress";

  return (
    <section className="overflow-hidden rounded-xl border border-border-light bg-card/30" aria-label="Quote stage">
      <div className="border-b border-border-light px-2.5 py-1.5 sm:px-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <p className="truncate text-sm font-semibold text-text-primary">{headline}</p>
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-text-tertiary">
            Step {flowStep + 1} of {n}
          </span>
        </div>
      </div>
      <div className="px-1 py-1.5 sm:px-1.5">
        <ol
          className="flex w-full items-start gap-0 overflow-x-auto pb-0.5 [scrollbar-width:thin] min-[400px]:grid min-[400px]:grid-cols-4 min-[400px]:overflow-visible"
          role="list"
        >
          {QUOTE_DRAWER_PIPELINE.map((step, idx) => {
            const isPast = idx < flowStep;
            const isCurrent = idx === flowStep;
            const Icon = step.icon;
            return (
              <li
                key={step.id}
                className="relative flex min-w-[3rem] flex-1 flex-col items-center px-0.5 text-center min-[400px]:min-w-0"
                aria-current={isCurrent ? "step" : undefined}
              >
                {idx > 0 ? (
                  <div
                    className="absolute left-0 top-[10px] hidden h-px w-1/2 -translate-x-1/2 bg-border min-[400px]:block"
                    aria-hidden
                  />
                ) : null}
                <div className="relative z-[1] flex flex-col items-center gap-0.5">
                  {isPast ? (
                    <span
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 text-white shadow-sm"
                      style={{ borderColor: QUOTE_NAVY, backgroundColor: QUOTE_NAVY }}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isCurrent ? "text-white shadow-sm" : "border-[#D1D5DB] bg-transparent text-text-tertiary dark:border-neutral-600",
                      )}
                      style={isCurrent ? { borderColor: QUOTE_NAVY, backgroundColor: QUOTE_NAVY } : undefined}
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} aria-hidden />
                    </span>
                  )}
                  <span
                    className={cn(
                      "max-w-[5rem] text-[10px] leading-tight text-balance min-[400px]:max-w-none",
                      isCurrent ? "font-semibold" : isPast ? "font-medium" : "font-medium text-text-tertiary",
                    )}
                    style={
                      isCurrent || isPast
                        ? { color: QUOTE_NAVY }
                        : undefined
                    }
                  >
                    {step.short}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
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
  quote: Quote;
  pendingInitialTab?: "overview" | "bids" | null;
  onConsumePendingInitialTab?: () => void;
  onClose: () => void;
  onStatusChange: (quote: Quote, status: string, opts?: { successToast?: string }) => void | Promise<boolean>;
  onQuoteUpdate?: (updated: Quote) => void;
}) {
  const { profile } = useProfile();
  const [tab, setTab] = useState("overview");
  const lastTabInitQuoteIdRef = useRef<string | null>(null);
  /** After a successful email in this drawer session — drives Resend labels (resets when opening another quote). */
  const [quoteEmailedInSession, setQuoteEmailedInSession] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendEmail, setSendEmail] = useState("");
  const [lineItems, setLineItems] = useState<ProposalLineRow[]>([]);
  const [scopeText, setScopeText] = useState("");
  const [convertedJob, setConvertedJob] = useState<Job | null>(null);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [sendingInvitePush, setSendingInvitePush] = useState(false);
  const [bids, setBids] = useState<QuoteBid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  /** Partner bid cards: collapsed preview shows total only; expand for breakdown, dates, scope, notes. */
  const [expandedBidIds, setExpandedBidIds] = useState<Set<string>>(new Set());
  /** Bid driving Review & Send figures without formal approve (submitted) or the approved bid id. */
  const [selectedReviewBidId, setSelectedReviewBidId] = useState<string | null>(null);
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  const onQuoteUpdateRef = useRef(onQuoteUpdate);
  onQuoteUpdateRef.current = onQuoteUpdate;
  const [proposalSaving, setProposalSaving] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [clientOnQuoteOpen, setClientOnQuoteOpen] = useState(false);
  /** 100 = baseline customer sell (40% margin on lines 1–2); range 0–1000 scales from that baseline. */
  const [proposalScalePercent, setProposalScalePercent] = useState(100);
  const [quoteClientPick, setQuoteClientPick] = useState<ClientAndAddressValue>({
    client_name: "",
    property_address: "",
  });
  const [savingClient, setSavingClient] = useState(false);
  // Send to customer / preview — must stay above useLayoutEffect (Rules of Hooks).
  const [depositPercent, setDepositPercent] = useState("50");
  const [startDate1, setStartDate1] = useState("");
  const [startDate2, setStartDate2] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [emailAttachRequestPhotos, setEmailAttachRequestPhotos] = useState(false);
  /** Linked account (when client has `source_account_id`) — send confirmation only. */
  const [linkedAccountPreview, setLinkedAccountPreview] = useState<{
    companyName: string;
    email: string;
    financeEmail: string | null;
  } | null>(null);
  /** Scope / line items / dates / email — collapsed by default; summary + sell scale stay visible. */
  const [proposalDetailsExpanded, setProposalDetailsExpanded] = useState(false);
  /** Earliest selectable day for proposed start dates (local calendar day). */
  const minProposalStartDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useLayoutEffect(() => {
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
  }, [quote.id, quote.quote_type, pendingInitialTab, onConsumePendingInitialTab]);

  // Only when switching to another quote — not when the same quote is refreshed after send (keeps "Resend email" label).
  useEffect(() => {
      setQuoteEmailedInSession(false);
      setSendState("idle");
      setProposalScalePercent(100);
      setClientOnQuoteOpen(false);
      setPricingOpen(false);
      setExpandedBidIds(new Set());
      setSelectedReviewBidId(null);
      setProposalDetailsExpanded(false);
      setQuoteClientPick({
      client_id: quote.client_id,
      client_address_id: quote.client_address_id,
      client_name: quote.client_name ?? "",
      client_email: quote.client_email ?? "",
      property_address: quote.property_address ?? "",
    });
      void loadLineItems(quote.id, quote);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset drawer shell only when switching quotes (`id`), not on every refreshed row object
  }, [quote.id]);

  useEffect(() => {
    setSendEmail(bidPayloadTrimmedString(quote.client_email as unknown));
    setScopeText(bidPayloadTrimmedString(quote.scope as unknown));
    setDepositPercent(
      quote.deposit_percent != null && Number.isFinite(Number(quote.deposit_percent))
        ? String(Number(quote.deposit_percent))
        : String(inferDepositPercentFromLegacy(Number(quote.deposit_required ?? 0), Number(quote.total_value ?? 0))),
    );
    setStartDate1(normalizeCalendarDateToYmd(bidPayloadTrimmedString(quote.start_date_option_1 as unknown)) || "");
    setStartDate2(normalizeCalendarDateToYmd(bidPayloadTrimmedString(quote.start_date_option_2 as unknown)) || "");
    setCustomMessage(bidPayloadTrimmedString(quote.email_custom_message as unknown));
    setEmailAttachRequestPhotos(Boolean(quote.email_attach_request_photos));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when server row version changes; omitting `quote` avoids wiping the editor on every silent list refresh (new object, same row)
  }, [quote.id, quote.updated_at]);

  useEffect(() => {
    let cancelled = false;
    const clientId = quoteClientPick.client_id ?? quote.client_id;
    if (!clientId) {
      setLinkedAccountPreview(null);
      return;
    }
    void (async () => {
      try {
        const client = await getClient(clientId);
        const sid = client?.source_account_id?.trim();
        if (!sid) {
          if (!cancelled) setLinkedAccountPreview(null);
          return;
        }
        const acc = await getAccount(sid);
        if (cancelled) return;
        if (!acc) {
          setLinkedAccountPreview(null);
          return;
        }
        const mainEmail = bidPayloadTrimmedString(acc.email as unknown);
        const feRaw = bidPayloadTrimmedString(acc.finance_email as unknown);
        const companyName =
          bidPayloadTrimmedString(acc.company_name as unknown) ||
          bidPayloadTrimmedString(acc.contact_name as unknown) ||
          "";
        if (!cancelled) {
          setLinkedAccountPreview({
            companyName: companyName || "—",
            email: mainEmail || "—",
            financeEmail: feRaw.length > 0 ? feRaw : null,
          });
        }
      } catch {
        if (!cancelled) setLinkedAccountPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quote.client_id, quoteClientPick.client_id, quote.updated_at]);

  useEffect(() => {
    if (quote.status === "accepted" || quote.status === "converted_to_job") {
      getJobByQuoteId(quote.id).then(setConvertedJob);
    } else {
      setConvertedJob(null);
    }
  }, [quote.id, quote.status]);

  const loadLineItems = async (quoteId: string, q: Quote) => {
    const supabase = getSupabase();
    const { data } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).order("sort_order");
    if (data && data.length > 0) {
      let rows: ProposalLineRow[] = data.map(
        (li: { description: string; quantity: number; unit_price: number; partner_unit_cost?: number | null; notes?: string | null }, i: number) => ({
          description:
            i < 2
              ? stripPartnerLineIndexSuffix(bidPayloadTrimmedString(li.description as unknown))
              : bidPayloadTrimmedString(li.description as unknown),
          quantity: String(li.quantity ?? 1),
          unitPrice: String(li.unit_price ?? 0),
          partnerUnitCost: String(li.partner_unit_cost ?? 0),
          notes: bidPayloadTrimmedString(li.notes as unknown),
        }),
      );
      const padStatuses = ["draft", "in_survey", "bidding", "awaiting_customer"];
      if (rows.length < 2 && padStatuses.includes(q.status)) {
        const firstLine = proposalFirstLineLabel(q);
        if (rows.length === 0) {
          rows = defaultProposalLineItems(q);
        } else {
          rows = [
            ...rows,
            {
              description: "Materials",
              quantity: "1",
              unitPrice: "0",
              partnerUnitCost: "0",
              notes: stringifyProposalLineNotes({ v: 1, partnerPricing: "unit" }),
            },
          ];
          if (!bidPayloadTrimmedString(rows[0].description as unknown)) rows[0] = { ...rows[0], description: firstLine };
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

  /** Type of work used for “Match” / deselect-matched in Invite Partners modal. */
  const invitePartnerTypeOfWork = useMemo(() => {
    const st = bidPayloadTrimmedString(quote.service_type as unknown);
    if (st) return st;
    return proposalFirstLineLabel(quote);
  }, [quote]);

  const partnersEligibleForInvite = useMemo(
    () => partners.filter((p) => isPartnerEligibleForWork(p)),
    [partners],
  );

  const loadBids = useCallback(
    async (quoteId: string) => {
      setBidsLoading(true);
      let clearedBidsLoadingEarly = false;
      try {
        const list = await getBidsByQuoteId(quoteId);
        if (quoteRef.current.id !== quoteId) return;
        setBids(list);
        setSelectedReviewBidId((prev) => (prev && list.some((b) => b.id === prev) ? prev : null));
      } finally {
        if (quoteRef.current.id === quoteId && !clearedBidsLoadingEarly) setBidsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (quote.quote_type === "partner") void loadBids(quote.id);
  }, [quote.id, quote.quote_type, loadBids]);

  useEffect(() => {
    if (quote.quote_type !== "partner" || tab !== "bids") return;
    const supabase = getSupabase();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`quote-bids:${quote.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quote_bids", filter: `quote_id=eq.${quote.id}` },
        () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            void loadBids(quote.id);
          }, 140);
        },
      )
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void channel.unsubscribe();
    };
  }, [quote.id, quote.quote_type, tab, loadBids]);

  const handleRefreshBids = useCallback(async () => {
    const q = quoteRef.current;
    if (q.quote_type !== "partner") return;
    await loadBids(q.id);
    const fresh = await getQuote(q.id);
    if (fresh) onQuoteUpdateRef.current?.(fresh);
  }, [loadBids]);

  const approvedBid = useMemo(() => bids.find((b) => b.status === "approved") ?? null, [bids]);
  const bidsReceivedCount =
    quote.quote_type !== "partner" ? 0 : bidsLoading ? Number(quote.partner_quotes_count) || 0 : bids.length;
  const invitedPartnersCount = quote.quote_type !== "partner" ? 0 : Math.max(0, Number(quote.partner_quotes_count) || 0);
  const quotedPartnersCount = useMemo(
    () => bids.filter((b) => b.status === "submitted" || b.status === "approved" || b.status === "rejected").length,
    [bids]
  );

  const orderedBidsForTab = useMemo(() => {
    const rest = [...bids];
    rest.sort((a, b) => {
      const pa = Number(a.bid_amount) || 0;
      const pb = Number(b.bid_amount) || 0;
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return rest;
  }, [bids]);

  const bidSpotlightEntries = useMemo(
    () => computeBidSpotlight(bids, selectedReviewBidId),
    [bids, selectedReviewBidId],
  );
  const bidsCollapsedVisible = useMemo(() => orderedBidsForTab.slice(0, 3), [orderedBidsForTab]);
  const bidSpotlightLabelById = useMemo(() => {
    const m = new Map<string, BidPriceRankLabel>();
    for (const e of bidSpotlightEntries) m.set(e.bid.id, e.label);
    return m;
  }, [bidSpotlightEntries]);
  const bidsVisibleInTab = useMemo(() => bidsCollapsedVisible, [bidsCollapsedVisible]);

  /** If selection falls outside the visible top-3 preview, clear it. */
  useEffect(() => {
    if (!selectedReviewBidId) return;
    if (!bidsCollapsedVisible.some((b) => b.id === selectedReviewBidId)) {
      setSelectedReviewBidId(null);
    }
  }, [selectedReviewBidId, bidsCollapsedVisible]);

  const actions = getQuoteActions(quote);
  /** Start Bidding lives on the Bids tab, not under Review & Send. */
  const overviewActions = actions.filter((a) => a.status !== "bidding");
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const proposalLine0Sell = (Number(lineItems[0]?.quantity) || 0) * (Number(lineItems[0]?.unitPrice) || 0);
  const proposalLine1Sell = (Number(lineItems[1]?.quantity) || 0) * (Number(lineItems[1]?.unitPrice) || 0);
  const proposalLine0Partner = linePartnerSubtotal(lineItems[0]);
  const proposalLine1Partner = linePartnerSubtotal(lineItems[1]);
  const proposalMarginLabourPct = marginPctOnSell(proposalLine0Sell, proposalLine0Partner);
  const proposalMarginMaterialsPct = marginPctOnSell(proposalLine1Sell, proposalLine1Partner);
  const proposalPartnerTotal = lineItems.reduce((s, li) => s + linePartnerSubtotal(li), 0);
  /**
   * Partner cost for summaries: line-item total when present; if lines are still £0 (e.g. DB race / stale rows)
   * but a submitted/approved bid is selected, use its bid_amount so the top strip matches the selected bid.
   */
  const effectiveProposalPartnerTotal = useMemo(() => {
    if (proposalPartnerTotal > 0.001) return proposalPartnerTotal;
    if (!selectedReviewBidId) return proposalPartnerTotal;
    const sel = bids.find((b) => b.id === selectedReviewBidId);
    if (sel && (sel.status === "submitted" || sel.status === "approved")) {
      const amt = Number(sel.bid_amount) || 0;
      if (amt > 0) return amt;
    }
    return proposalPartnerTotal;
  }, [proposalPartnerTotal, bids, selectedReviewBidId]);

  /** First tile in PartnerBidMiniDash: same basis as effective partner cost, else average bid amount. */
  const bidDashPrimary = useMemo(() => {
    const selId = selectedReviewBidId;
    if (selId) {
      const sel = bids.find((b) => b.id === selId);
      if (sel && (sel.status === "submitted" || sel.status === "approved")) {
        const v = effectiveProposalPartnerTotal;
        return { label: "Your cost", value: v > 0.001 ? v : null } as const;
      }
    }
    if (!bids.length) return { label: "Avg price", value: null } as const;
    const sum = bids.reduce((s, b) => s + (Number(b.bid_amount) || 0), 0);
    return { label: "Avg price", value: sum / bids.length } as const;
  }, [bids, selectedReviewBidId, effectiveProposalPartnerTotal]);

  const proposalMarginAbs = lineTotal - effectiveProposalPartnerTotal;
  const proposalSummaryMarginPct = marginPctOnSell(lineTotal, effectiveProposalPartnerTotal);
  const proposalDepositAmount = depositAmountFromPercent(lineTotal, Number(depositPercent));
  const partnerBasisLines01 = proposalLine0Partner + proposalLine1Partner;
  const canUseProposalMarginSlider = partnerBasisLines01 > 0;

  // Email flow step-by-step (only relevant when quote.status === "awaiting_customer")
  const sendStep1Ready =
    bidPayloadTrimmedString(scopeText as unknown).length > 0 ||
    lineItems.some((li) => bidPayloadTrimmedString(li.description as unknown).length > 0);
  const sendStep2Ready = !!startDate1 || !!startDate2;
  const sendDepositPercentNum = Number(depositPercent);
  const sendStep3Ready =
    sendDepositPercentNum >= 0 &&
    sendDepositPercentNum <= 100 &&
    !Number.isNaN(sendDepositPercentNum) &&
    bidPayloadTrimmedString(sendEmail as unknown).includes("@");

  /** Recipient preview in “Client on this quote” header (matches send email field). */
  const confirmSendEmail = useMemo(
    () => bidPayloadTrimmedString(sendEmail as unknown) || bidPayloadTrimmedString(quote.client_email as unknown),
    [sendEmail, quote.client_email],
  );
  const confirmClientName = useMemo(
    () =>
      bidPayloadTrimmedString(quoteClientPick.client_name as unknown) ||
      bidPayloadTrimmedString(quote.client_name as unknown) ||
      "",
    [quoteClientPick.client_name, quote.client_name],
  );

  const drawerTabs = [
    { id: "overview", label: "Review & Send" },
    { id: "bids", label: "Bids" },
    { id: "history", label: "History" },
  ];

  const guidance = getStageGuidance(quote.status);

  const addLineItem = () =>
    setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0", partnerUnitCost: "0", notes: "" }]);
  const removeLineItem = (idx: number) => {
    setLineItems((prev) => {
      if (prev.length <= 2 && ["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status)) {
        toast.info("Keep at least two lines (type of work and materials). Remove extra rows only.");
        return prev;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const recalcCustomerLinePricesFromPartnerScale = useCallback((scalePct: number) => {
    const m = scalePct / 100;
    setLineItems((prev) => {
      const labourP = linePartnerSubtotal(prev[0]);
      const materialsP = linePartnerSubtotal(prev[1]);
      const q0 = Number(prev[0]?.quantity) || 1;
      const q1 = Number(prev[1]?.quantity) || 1;
      const baseSell0 = labourP > 0 ? labourP / (1 - BID_DEFAULT_MARGIN_ON_SELL) : 0;
      const baseSell1 = materialsP > 0 ? materialsP / (1 - BID_DEFAULT_MARGIN_ON_SELL) : 0;
      const sell0 = baseSell0 * m;
      const sell1 = baseSell1 * m;
      const u0 = q0 > 0 ? Math.round((sell0 / q0) * 100) / 100 : 0;
      const u1 = q1 > 0 ? Math.round((sell1 / q1) * 100) / 100 : 0;
      const next = [...prev];
      if (next[0]) next[0] = { ...next[0], unitPrice: String(u0), notes: next[0].notes ?? "" };
      if (next[1]) next[1] = { ...next[1], unitPrice: String(u1), notes: next[1].notes ?? "" };
      return next;
    });
  }, []);

  const updateLineItem = (idx: number, field: string, value: string) => setLineItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const persistProposalToQuote = async (opts?: {
    lineItemsOverride?: ProposalLineRow[];
    scopeTextOverride?: string;
    startDate1Override?: string;
    startDate2Override?: string;
    /** Override deposit % (0–100); default is current `depositPercent` state. */
    depositOverride?: string;
    partnerCostOverride?: number;
  }): Promise<Quote> => {
    const lines = opts?.lineItemsOverride ?? lineItems;
    const st = opts?.scopeTextOverride !== undefined ? opts.scopeTextOverride : scopeText;
    const d1Raw = opts?.startDate1Override !== undefined ? opts.startDate1Override : startDate1;
    const d2Raw = opts?.startDate2Override !== undefined ? opts.startDate2Override : startDate2;
    const d1 = normalizeCalendarDateToYmd(d1Raw) || "";
    const d2 = normalizeCalendarDateToYmd(d2Raw) || "";
    const depPctStr = opts?.depositOverride !== undefined ? opts.depositOverride : depositPercent;
    const partnerTotalFromLines = lines.reduce((s, li) => s + linePartnerSubtotal(li), 0);
    const partnerTotal = opts?.partnerCostOverride ?? partnerTotalFromLines;

    const supabase = getSupabase();
    await supabase.from("quote_line_items").delete().eq("quote_id", quote.id);
    const rows = lines.map((li, i) => ({
      quote_id: quote.id,
      description: i < 2 ? stripPartnerLineIndexSuffix(li.description) : li.description,
      quantity: Number(li.quantity) || 1,
      unit_price: Number(li.unitPrice) || 0,
      partner_unit_cost: Number(li.partnerUnitCost) || 0,
      sort_order: i,
      notes: bidPayloadTrimmedString(li.notes as unknown) || null,
    }));
    if (rows.length > 0) {
      await insertQuoteLineItemsResilient(supabase, rows);
    }

    const lineTot = lines.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
    const marginPct =
      lineTot > 0 && partnerTotal >= 0 ? Math.round(((lineTot - partnerTotal) / lineTot) * 1000) / 10 : 0;
    const depositPct = clampDepositPercent(Number(depPctStr) || 0);
    const depositRequiredAmount = depositAmountFromPercent(lineTot, depositPct);

    return updateQuote(quote.id, {
      partner_cost: partnerTotal,
      total_value: lineTot,
      sell_price: lineTot,
      margin_percent: marginPct,
      scope: bidPayloadTrimmedString(st as unknown) || undefined,
      deposit_percent: depositPct,
      deposit_required: depositRequiredAmount,
      start_date_option_1: d1 || undefined,
      start_date_option_2: d2 || undefined,
      client_email: bidPayloadTrimmedString(sendEmail as unknown),
      email_custom_message: bidPayloadTrimmedString(customMessage as unknown) || null,
      email_attach_request_photos: emailAttachRequestPhotos,
    });
  };

  const persistProposalToQuoteRef = useRef(persistProposalToQuote);
  persistProposalToQuoteRef.current = persistProposalToQuote;

  const selectBidForReview = useCallback(
    async (bid: QuoteBid, options?: { silent?: boolean }) => {
      if (bid.status !== "submitted") return;
      const pre = computeCustomerProposalFromBid(bid, quote);
      const scopeMerged = pre.scopeText ?? scopeText;
      const d1 = normalizeCalendarDateToYmd(pre.startDate1 ?? startDate1) || "";
      const d2 = normalizeCalendarDateToYmd(pre.startDate2 ?? startDate2) || "";
      const depPct = pre.depositPercent ?? depositPercent;
      setLineItems(pre.lines);
      setScopeText(bidPayloadTrimmedString(scopeMerged as unknown));
      setStartDate1(d1);
      setStartDate2(d2);
      setDepositPercent(depPct);
      setProposalScalePercent(100);
      setSelectedReviewBidId(bid.id);
      setProposalSaving(true);
      try {
        const updated = await persistProposalToQuoteRef.current({
          lineItemsOverride: pre.lines,
          scopeTextOverride: scopeMerged,
          startDate1Override: d1,
          startDate2Override: d2,
          depositOverride: depPct,
          partnerCostOverride: bid.bid_amount,
        });
        onQuoteUpdate?.(updated);
        if (!options?.silent) {
          toast.success(
            "Review & Send updated from this bid — send to the customer when ready. Use Approve only if you want to lock this partner now.",
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to apply bid");
      } finally {
        setProposalSaving(false);
      }
    },
    [quote, scopeText, startDate1, startDate2, depositPercent, onQuoteUpdate],
  );

  const clearBidSelection = useCallback(async () => {
    setSelectedReviewBidId(null);
    setProposalSaving(true);
    try {
      const q = quote;
      setScopeText(bidPayloadTrimmedString(q.scope as unknown));
      setDepositPercent(
        q.deposit_percent != null && Number.isFinite(Number(q.deposit_percent))
          ? String(Number(q.deposit_percent))
          : String(inferDepositPercentFromLegacy(Number(q.deposit_required ?? 0), Number(q.total_value ?? 0))),
      );
      setStartDate1(normalizeCalendarDateToYmd(bidPayloadTrimmedString(q.start_date_option_1 as unknown)) || "");
      setStartDate2(normalizeCalendarDateToYmd(bidPayloadTrimmedString(q.start_date_option_2 as unknown)) || "");
      setProposalScalePercent(100);
      await loadLineItems(q.id, q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear bid selection");
    } finally {
      setProposalSaving(false);
    }
  }, [quote]);

  useEffect(() => {
    if (!selectedReviewBidId) return;
    if (!bids.some((b) => b.id === selectedReviewBidId)) {
      setSelectedReviewBidId(null);
    }
  }, [bids, selectedReviewBidId]);

  const saveProposalDraft = async () => {
    setProposalSaving(true);
    try {
      const pc = proposalPartnerTotal;
      const sp = lineTotal;
      const marginPct = marginPctOnSell(sp, pc);
      const oldSummary = `Partner £${Number(quote.partner_cost ?? quote.cost ?? 0).toFixed(2)}, Sell £${Number(quote.sell_price ?? quote.total_value ?? 0).toFixed(2)}, Margin ${quote.margin_percent ?? 0}%`;
      const newSummary = `Partner £${pc.toFixed(2)}, Sell £${sp.toFixed(2)}, Margin ${marginPct}%`;
      const updated = await persistProposalToQuote();
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
      toast.success("Quote saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save quote");
    } finally {
      setProposalSaving(false);
    }
  };

  const handleSendToCustomer = async () => {
    if (!sendEmail) { toast.error("Enter a recipient email"); return; }
    const isResend = quoteEmailedInSession || sendState === "sent" || Boolean(quote.customer_pdf_sent_at);
    setSendState("sending");
    try {
      await persistProposalToQuote();
      const items = lineItems.map((li, idx) => {
        const qty = Number(li.quantity) || 1;
        const unit = Number(li.unitPrice) || 0;
        return {
          description: lineItemDescriptionForCustomer(li, idx),
          quantity: qty,
          unitPrice: unit,
          total: qty * unit,
        };
      });
      const res = await fetch("/api/quotes/send-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.id,
          recipientEmail: sendEmail,
          recipientName: quote.client_name,
          customMessage: bidPayloadTrimmedString(customMessage as unknown) || undefined,
          items: items.length ? items : undefined,
          scope: bidPayloadTrimmedString(scopeText as unknown) || undefined,
          attachRequestPhotos: emailAttachRequestPhotos,
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

  const handleMarkAsSentExternally = async () => {
    if (!sendStep1Ready || !sendStep2Ready || !sendStep3Ready) {
      toast.error("Complete the customer proposal above (scope or line items, at least one start date, deposit, and customer email).");
      return;
    }
    setProposalSaving(true);
    let persisted: Quote;
    try {
      persisted = await persistProposalToQuote();
      onQuoteUpdate?.(persisted);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save proposal");
      setProposalSaving(false);
      return;
    }
    try {
      const ok = await Promise.resolve(
        onStatusChange(persisted, "awaiting_customer", {
          successToast: "Awaiting Customer — no email sent from the app (you marked it sent already).",
        }),
      );
      if (ok === false) {
        setProposalSaving(false);
        return;
      }
      const stamped = await updateQuote(persisted.id, { customer_pdf_sent_at: new Date().toISOString() });
      onQuoteUpdate?.(stamped);
      setQuoteEmailedInSession(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record sent time");
    } finally {
      setProposalSaving(false);
    }
  };

  const customerProposalTitleHint =
    quote.status === "awaiting_customer"
      ? "The customer's Accept / Reject links stay the same; they receive the latest PDF each time you send or resend."
      : [guidance.headline, guidance.detail]
          .filter(Boolean)
          .join(" — ")
          .concat(
            ` Lines 1–2: partner unit costs come from the approved bid (locked); customer unit sell defaults to ${Math.round(BID_DEFAULT_MARGIN_ON_SELL * 100)}% margin on sell. Use the scale below to adjust sell; edit rows directly if needed.`,
          );

  return (
    <Drawer
      open={!!quote}
      onClose={onClose}
      title={bidPayloadTrimmedString(quote.reference as unknown) || "Quote"}
      subtitle={bidPayloadTrimmedString(quote.title as unknown) || undefined}
      width="w-full max-w-[440px]"
    >
      <div className="flex flex-col h-full">
        <Tabs
          tabs={drawerTabs}
          activeTab={tab}
          onChange={setTab}
          className="px-4 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-[13px]"
        />
        {tab === "bids" && quote.quote_type === "partner" && quote.status === "bidding" && (
          <div
            className="mx-4 mt-2 rounded-xl border border-border-light bg-card/90 px-2.5 py-2.5 dark:bg-surface-secondary/30"
            role="region"
            aria-label="Proposal summary"
          >
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
              <div className="min-w-0 rounded-md bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Total Price</p>
                <p className="mt-0.5 text-base font-bold tabular-nums leading-none text-text-primary">{formatCurrency(lineTotal)}</p>
              </div>
              <div className="min-w-0 rounded-md bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
                <div className="flex items-center gap-1 text-text-tertiary">
                  <Wallet className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="text-[9px] font-medium uppercase tracking-wide">Your cost</span>
                </div>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-text-primary">
                  {formatCurrency(effectiveProposalPartnerTotal)}
                </p>
              </div>
              <div className="min-w-0 rounded-md bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
                <div className="flex items-center gap-1 text-text-tertiary">
                  <Percent className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="text-[9px] font-medium uppercase tracking-wide">Margin %</span>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-base font-bold tabular-nums",
                    proposalSummaryMarginPct > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : proposalSummaryMarginPct === 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400",
                  )}
                >
                  {proposalSummaryMarginPct}%
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">

          {/* OVERVIEW TAB: Status + Details together */}
          {tab === "overview" && (
            <div className="space-y-3 p-3 sm:p-4">
              <QuotePipelineStepper status={quote.status} />
              {quote.status === "rejected" && quote.rejection_reason?.trim() ? (
                <div className="rounded-lg border border-red-200/80 bg-red-50/70 px-3 py-2 text-xs leading-snug text-text-secondary dark:border-red-900/40 dark:bg-red-950/25">
                  {quote.rejection_reason}
                </div>
              ) : null}

              {quote.quote_type !== "partner" ? (
                <div className="flex items-start gap-2 rounded-lg border border-border-light/70 bg-surface-hover/50 px-2.5 py-1.5">
                  <p className="text-[10px] font-medium text-text-secondary">Manual quote</p>
                  <FixfyHintIcon text="No partner bid stats. Set sell and costs in Customer proposal below." />
                </div>
              ) : null}

              <div
                key={`client-on-quote-${quote.id}`}
                className="rounded-lg border border-border-light bg-card shadow-sm dark:border-border dark:bg-card"
              >
                <div className="flex items-start gap-2 px-2.5 pt-2.5 pb-1 sm:px-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Client on this quote</p>
                      <FixfyHintIcon
                        text={
                          quote.status === "awaiting_customer"
                            ? "The PDF uses the client and property shown here."
                            : "Recipients and property for this proposal — expand below to change."
                        }
                      />
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-text-tertiary">
                      {quote.status === "awaiting_customer"
                        ? "PDF will be sent to the addresses below."
                        : "This quote will be sent to the client email below."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
                    aria-expanded={clientOnQuoteOpen}
                    aria-label={clientOnQuoteOpen ? "Hide change client" : "Change client or property"}
                    onClick={() => setClientOnQuoteOpen((o) => !o)}
                  >
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform duration-200", clientOnQuoteOpen && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 px-2.5 pb-2.5 sm:grid-cols-2 sm:gap-2.5 sm:px-3">
                  <div className="min-w-0 rounded-md border border-border-light/90 bg-surface-hover/35 px-2 py-2 dark:bg-surface-secondary/20">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Contact</p>
                    <div className="mt-1.5 flex items-start gap-2">
                      <Avatar
                        name={confirmClientName || "?"}
                        size="sm"
                        className="shrink-0"
                        src={quote.source_account_logo_url?.trim() || undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-tight text-text-primary">{confirmClientName || "—"}</p>
                        <p className="mt-0.5 break-all text-[11px] leading-snug text-text-secondary">{confirmSendEmail || "—"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 rounded-md border border-border-light/90 bg-surface-hover/35 px-2 py-2 dark:bg-surface-secondary/20">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Account</p>
                    <div className="mt-1.5 flex items-start gap-2">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                        aria-hidden
                      >
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {linkedAccountPreview ? (
                          <>
                            <p className="truncate text-sm font-semibold leading-tight text-text-primary">
                              {linkedAccountPreview.companyName}
                            </p>
                            <p className="mt-0.5 break-all text-[11px] leading-snug text-text-secondary">{linkedAccountPreview.email}</p>
                            {linkedAccountPreview.financeEmail &&
                            linkedAccountPreview.financeEmail.toLowerCase() !== linkedAccountPreview.email.toLowerCase() ? (
                              <p className="mt-1 text-[10px] leading-snug text-text-tertiary">
                                Finance · <span className="text-text-secondary break-all">{linkedAccountPreview.financeEmail}</span>
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-[11px] italic text-text-tertiary">No linked account</p>
                        )}
                        <p className="mt-1.5 break-words border-t border-border-light/70 pt-1.5 text-[11px] leading-snug text-text-secondary">
                          {bidPayloadTrimmedString(quoteClientPick.property_address as unknown) ||
                            bidPayloadTrimmedString(quote.property_address as unknown) ||
                            "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {clientOnQuoteOpen ? (
                  <div className="space-y-3 border-t border-dashed border-border-light px-2.5 pb-3 pt-2.5 sm:px-3 dark:border-border">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] font-medium text-text-secondary">Change client or property</p>
                      <FixfyHintIcon text="Change the client or property if you need to send the proposal to someone else." />
                    </div>
                    <ClientAddressPicker
                      value={quoteClientPick}
                      onChange={setQuoteClientPick}
                      labelClient="Client"
                      labelAddress="Property address"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={savingClient}
                      icon={savingClient ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
                      onClick={async () => {
                        if (!quoteClientPick.client_id || !quoteClientPick.property_address?.trim()) {
                          toast.error("Select a client and property address");
                          return;
                        }
                        setSavingClient(true);
                        try {
                          const updated = await updateQuote(quote.id, {
                            client_id: quoteClientPick.client_id,
                            client_address_id: quoteClientPick.client_address_id,
                            client_name: quoteClientPick.client_name,
                            client_email: quoteClientPick.client_email ?? "",
                            property_address: quoteClientPick.property_address,
                          });
                          onQuoteUpdate?.(updated);
                          setSendEmail(bidPayloadTrimmedString(updated.client_email as unknown));
                          toast.success("Client updated on this quote");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to update client");
                        } finally {
                          setSavingClient(false);
                        }
                      }}
                    >
                      {savingClient ? "Saving…" : "Save client to quote"}
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Bid Summary — partner submission (read-only reference); pricing control is in Customer proposal */}
              <details
                key={`bid-summary-${quote.id}`}
                className="group rounded-xl border border-border-light bg-gradient-to-br from-surface-hover to-surface-tertiary open:shadow-sm dark:from-surface-secondary dark:to-surface-tertiary dark:border-border dark:open:shadow-md dark:open:shadow-black/20"
                open={pricingOpen}
                onToggle={(e) => setPricingOpen(e.currentTarget.open)}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2 min-w-0">
                    <SlidersHorizontal className="h-4 w-4 shrink-0 text-text-tertiary" />
                    <span className="text-xs font-semibold text-text-secondary">Bid Summary</span>
                    <span className="text-[10px] text-text-tertiary truncate">Labour · materials · scope · dates</span>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border-light dark:border-border px-4 pb-4 space-y-3">
                {approvedBid ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 px-3 py-2.5 space-y-1">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner</p>
                      <p className="text-sm font-semibold text-text-primary">{approvedBid.partner_name ?? approvedBid.partner_id}</p>
                      <p className="text-xs text-text-secondary">
                        Bid total{" "}
                        <span className="font-bold text-primary tabular-nums">{formatCurrency(approvedBid.bid_amount)}</span>
                      </p>
                </div>
                    {(() => {
                      const p = parseBidProposalFromNotes(approvedBid.notes);
                      const { labour, materials } = splitBidPartnerCosts(approvedBid.bid_amount, p);
                      const rawD1 = bidPayloadTrimmedString(p?.start_date_option_1 as unknown);
                      const rawD2 = bidPayloadTrimmedString(p?.start_date_option_2 as unknown);
                      const d1 =
                        formatYmdUkDisplay(normalizeCalendarDateToYmd(rawD1)) || (rawD1 ? rawD1.slice(0, 12) : "");
                      const d2 =
                        formatYmdUkDisplay(normalizeCalendarDateToYmd(rawD2)) || (rawD2 ? rawD2.slice(0, 12) : "");
                      const labourDesc = p ? bidPayloadTrimmedString(p.labour_description as unknown) : "";
                      const matDesc = p ? bidPayloadTrimmedString(p.materials_description as unknown) : "";
                      const scopeBid = p ? bidPayloadTrimmedString(p.scope as unknown) : "";
                      return (
                        <div className="rounded-xl border border-border-light bg-card/80 dark:bg-surface-secondary/30 px-3 py-2.5 space-y-3 text-sm">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Labour price</p>
                              <p className="text-base font-bold tabular-nums text-text-primary mt-0.5">{formatCurrency(labour)}</p>
                              {labourDesc ? <p className="text-[11px] text-text-secondary mt-1.5 whitespace-pre-wrap leading-snug">{labourDesc}</p> : null}
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Materials price</p>
                              <p className="text-base font-bold tabular-nums text-text-primary mt-0.5">{formatCurrency(materials)}</p>
                              {matDesc ? <p className="text-[11px] text-text-secondary mt-1.5 whitespace-pre-wrap leading-snug">{matDesc}</p> : null}
                            </div>
                          </div>
                          {scopeBid ? (
                            <div>
                              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope / line items (from bid)</p>
                              <p className="text-[11px] text-text-secondary whitespace-pre-wrap leading-snug mt-1">{scopeBid}</p>
                            </div>
                          ) : null}
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Available start dates</p>
                            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 text-[11px] text-text-secondary">
                              {d1 ? (
                                <span className="rounded-lg border border-border-light bg-surface-hover/80 px-2 py-1">
                                  Option 1: <strong className="text-text-primary">{d1}</strong>
                                </span>
                              ) : (
                                <span className="text-text-tertiary">Option 1 — not set in bid</span>
                              )}
                              {d2 ? (
                                <span className="rounded-lg border border-border-light bg-surface-hover/80 px-2 py-1">
                                  Option 2: <strong className="text-text-primary">{d2}</strong>
                                </span>
                              ) : (
                                <span className="text-text-tertiary">Option 2 — not set in bid</span>
                              )}
                            </div>
                          </div>
                          {p?.deposit_required != null && Number.isFinite(Number(p.deposit_required)) && Number(p.deposit_required) > 0 ? (
                            <p className="text-[11px] text-text-secondary">
                              Deposit in bid:{" "}
                              <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(Number(p.deposit_required))}</span>
                            </p>
                          ) : null}
                        </div>
                      );
                    })()}
                    {!parseBidProposalFromNotes(approvedBid.notes) && bidPayloadTrimmedString(approvedBid.notes as unknown) ? (
                      <p className="text-[11px] text-text-tertiary whitespace-pre-wrap leading-snug">{bidPayloadTrimmedString(approvedBid.notes as unknown)}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-border-light bg-surface-hover/60 px-3 py-2">
                    <p className="text-[11px] font-medium text-text-secondary">
                      {quote.quote_type === "partner" ? "No approved bid yet" : "Manual line pricing"}
                    </p>
                    <FixfyHintIcon
                      text={
                        quote.quote_type === "partner"
                          ? "Open the Bids tab to review and approve one. Partner unit costs on the first two proposal lines will lock from the bid; customer sell and scale are set in Customer proposal below."
                          : "Set partner unit cost and customer sell per line in Customer proposal. The scale uses a 40% margin baseline on lines 1–2."
                      }
                    />
                  </div>
                )}
                </div>
              </details>

              {convertedJob && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-2"><Briefcase className="h-4 w-4 text-emerald-600" /><label className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Converted to Job</label></div>
                  <a href={`/jobs?jobId=${convertedJob.id}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/50 text-sm font-semibold text-primary">
                    <Briefcase className="h-4 w-4" /> {convertedJob.reference}
                  </a>
                </div>
              )}

              {["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status) && (
                <div className="space-y-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-2.5">
                  {quote.status === "awaiting_customer" && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-2.5 py-2 dark:border-amber-800/50 dark:bg-amber-950/25">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Edit after sending</p>
                      <FixfyHintIcon text="You can still change line items, scope, dates, deposit, message, use the customer sell scale below, and review Bid Summary. Use Save Quote to store only, or Resend Quote under Move this quote to email the PDF." />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#020040]" aria-hidden />
                    <span className="text-xs font-semibold text-text-primary">Customer proposal</span>
                    {quote.status !== "awaiting_customer" ? (
                      <span className="rounded-full bg-[#ED4B00]/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#C4461F]">
                        Required before send
                      </span>
                    ) : null}
                    <FixfyHintIcon text={customerProposalTitleHint} />
                    {guidance.goToTab && guidance.goToLabel && tab !== guidance.goToTab ? (
                      <Button size="sm" variant="outline" className="ml-auto h-7 shrink-0 px-2 text-[11px]" onClick={() => setTab(guidance.goToTab!)}>
                        {guidance.goToLabel}
                      </Button>
                    ) : null}
                  </div>

                  <div
                    className="rounded-xl border border-border-light bg-card/90 px-2.5 py-2.5 dark:bg-surface-secondary/30"
                    role="region"
                    aria-label="Quote summary"
                  >
                    <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
                      <div className="min-w-0 rounded-md bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Total Price</p>
                        <p className="mt-0.5 text-base font-bold tabular-nums leading-none text-text-primary">{formatCurrency(lineTotal)}</p>
                      </div>
                      <div className="min-w-0 rounded-md bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
                        <div className="flex items-center gap-1 text-text-tertiary">
                          <Wallet className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                          <span className="text-[9px] font-medium uppercase tracking-wide">Your cost</span>
                        </div>
                        <p className="mt-0.5 text-base font-semibold tabular-nums text-text-primary">
                          {formatCurrency(effectiveProposalPartnerTotal)}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-md bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
                        <div className="flex items-center gap-1 text-text-tertiary">
                          <Percent className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                          <span className="text-[9px] font-medium uppercase tracking-wide">Margin %</span>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 text-base font-bold tabular-nums",
                            proposalSummaryMarginPct > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : proposalSummaryMarginPct === 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-600 dark:text-red-400",
                          )}
                        >
                          {proposalSummaryMarginPct}%
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-border-light bg-card/80 p-2.5 dark:bg-surface-secondary/30">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Customer sell scale</p>
                      <span className="text-xs font-bold tabular-nums text-[#020040]">{proposalScalePercent}%</span>
                    </div>
                    <p className="text-[10px] text-text-tertiary">
                      {Math.round(BID_DEFAULT_MARGIN_ON_SELL * 100)}% margin baseline
                    </p>
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
                        recalcCustomerLinePricesFromPartnerScale(v);
                      }}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-[#020040] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-700"
                    />
                    <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                      <div className="rounded-lg border border-border-light bg-surface-hover/80 px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase text-text-tertiary">Line 1 · Labour</p>
                        <p className="mt-1 text-[11px] text-text-secondary">
                          Partner <span className="font-semibold tabular-nums">{formatCurrency(proposalLine0Partner)}</span>
                          {" · "}
                          Sell <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(proposalLine0Sell)}</span>
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-xs font-bold tabular-nums",
                            proposalMarginLabourPct > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : proposalMarginLabourPct === 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-600 dark:text-red-400",
                          )}
                        >
                          Margin {proposalMarginLabourPct}%
                        </p>
                      </div>
                      <div className="rounded-lg border border-border-light bg-surface-hover/80 px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase text-text-tertiary">Line 2 · Materials</p>
                        <p className="mt-1 text-[11px] text-text-secondary">
                          Partner <span className="font-semibold tabular-nums">{formatCurrency(proposalLine1Partner)}</span>
                          {" · "}
                          Sell <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(proposalLine1Sell)}</span>
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-xs font-bold tabular-nums",
                            proposalMarginMaterialsPct > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : proposalMarginMaterialsPct === 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-600 dark:text-red-400",
                          )}
                        >
                          Margin {proposalMarginMaterialsPct}%
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setProposalDetailsExpanded((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border-light bg-surface-hover/40 px-3 py-2.5 text-left text-xs font-medium text-text-secondary hover:bg-surface-hover/80 transition-colors"
                    aria-expanded={proposalDetailsExpanded}
                  >
                    <span>
                      {proposalDetailsExpanded ? "Hide" : "Show"} scope, line items, dates &amp; email
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-text-tertiary transition-transform",
                        proposalDetailsExpanded && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>

                  {proposalDetailsExpanded ? (
                    <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope / line items</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={addLineItem} className="text-[11px] font-medium text-primary hover:underline">+ Add item</button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {lineItems.map((item, idx) => {
                        const parsedNotes = parseProposalLineNotes(item.notes);
                        const partnerPricing =
                          parsedNotes.meta?.partnerPricing ?? defaultPartnerPricingForLineIndex(idx);
                        const fieldLabels = partnerFieldLabelsForLine(idx, partnerPricing);
                        const hintValue = proposalLineHintDisplay(parsedNotes);
                        const labourModes: PartnerLinePricingMode[] = ["hourly", "fixed"];
                        const materialsModes: PartnerLinePricingMode[] = ["unit", "bulk"];
                        const modeOptions = idx === 0 ? labourModes : idx === 1 ? materialsModes : [];
                        const modeLabels: Record<PartnerLinePricingMode, string> = {
                          hourly: "Hourly",
                          fixed: "Fixed price",
                          unit: "Unit",
                          bulk: "Bulk",
                        };
                        return (
                        <div key={idx} className="flex gap-2 items-start p-3 bg-surface-hover rounded-xl">
                          <div className="flex-1 min-w-0">
                            <Input
                              placeholder={idx === 0 ? "Type of work / labour" : idx === 1 ? "Materials" : "Service / description"}
                              value={idx < 2 ? stripPartnerLineIndexSuffix(item.description) : item.description}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "description",
                                  idx < 2 ? stripPartnerLineIndexSuffix(e.target.value) : e.target.value,
                                )
                              }
                              className="text-xs mb-1.5"
                            />
                            {idx < 2 && modeOptions.length > 0 ? (
                              <div className="mb-2">
                                <span className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">Partner pricing</span>
                                <div className="inline-flex rounded-lg border border-border-light bg-card p-0.5 gap-0.5">
                                  {modeOptions.map((mode) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      className={cn(
                                        "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                                        partnerPricing === mode
                                          ? "bg-primary text-white shadow-sm"
                                          : "text-text-secondary hover:bg-surface-hover",
                                      )}
                                      onClick={() => {
                                        setLineItems((prev) =>
                                          prev.map((row, i) =>
                                            i === idx
                                              ? {
                                                  ...row,
                                                  notes: buildNotesWithPricing(idx, row.notes, { partnerPricing: mode }),
                                                }
                                              : row,
                                          ),
                                        );
                                      }}
                                    >
                                      {modeLabels[mode]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="flex gap-2 flex-wrap items-end">
                              <div className="w-20 shrink-0">
                                <span className="text-[9px] font-semibold text-text-tertiary uppercase block mb-0.5">{fieldLabels.qty}</span>
                                <Input type="number" placeholder="1" value={item.quantity} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} className="text-xs w-full" />
                            </div>
                              <div className="flex-1 min-w-[88px]">
                                <span className="text-[9px] font-semibold text-text-tertiary uppercase block mb-0.5">{fieldLabels.partner}</span>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  value={item.partnerUnitCost}
                                  disabled={!!approvedBid && idx < 2}
                                  onChange={(e) => updateLineItem(idx, "partnerUnitCost", e.target.value)}
                                  className="text-xs w-full disabled:opacity-70"
                                />
                              </div>
                              <div className="flex-1 min-w-[88px]">
                                <span className="text-[9px] font-semibold text-text-tertiary uppercase block mb-0.5">{fieldLabels.sell}</span>
                                <Input type="number" placeholder="0" value={item.unitPrice} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)} className="text-xs w-full" />
                              </div>
                            </div>
                            {idx < 2 ? (
                              <label className="block mt-1.5">
                                <span className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Line notes</span>
                                <textarea
                                  value={hintValue}
                                  onChange={(e) => {
                                    setLineItems((prev) =>
                                      prev.map((row, i) =>
                                        i === idx
                                          ? { ...row, notes: buildNotesWithPricing(idx, row.notes, { hint: e.target.value }) }
                                          : row,
                                      ),
                                    );
                                  }}
                                  placeholder="e.g. materials included, hourly detail, exclusions…"
                                  rows={2}
                                  className="mt-0.5 w-full rounded-lg border border-border-light bg-card px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-none"
                                />
                              </label>
                            ) : (
                              <label className="block mt-1.5">
                                <span className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Line notes</span>
                                <textarea
                                  value={item.notes ?? ""}
                                  onChange={(e) => updateLineItem(idx, "notes", e.target.value)}
                                  placeholder="e.g. materials included, hourly detail, exclusions…"
                                  rows={2}
                                  className="mt-0.5 w-full rounded-lg border border-border-light bg-card px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-none"
                                />
                              </label>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 pt-1 shrink-0">
                            <span className="text-xs font-semibold text-text-primary tabular-nums">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</span>
                            {lineItems.length > 1 && (idx >= 2 || !["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status)) && (
                              <button type="button" onClick={() => removeLineItem(idx)} className="text-text-tertiary hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </div>
                        );
                      })}
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
                    <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Deposit (% of total)</label>
                    <Input
                      type="number"
                      value={depositPercent}
                      onChange={(e) => setDepositPercent(e.target.value)}
                      placeholder="50"
                      min={0}
                      max={100}
                      step={0.5}
                    />
                    <p className="text-[10px] text-text-tertiary mt-1.5">
                      Deposit amount:{" "}
                      <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(proposalDepositAmount)}</span>
                    </p>
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
                      variant="primary"
                      disabled={proposalSaving}
                      loading={proposalSaving}
                      onClick={() => void saveProposalDraft()}
                      className="!bg-[#C4461F] hover:!bg-[#a83a19] !shadow-md !shadow-[#C4461F]/25 focus-visible:!ring-[#C4461F]/40 border-0"
                      icon={proposalSaving ? undefined : <Save className="h-3.5 w-3.5" />}
                    >
                      {proposalSaving ? "Saving…" : "Save Quote"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className={cn("rounded-md px-2 py-0.5", sendStep1Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>1 Scope / items</span>
                    <span className={cn("rounded-md px-2 py-0.5", sendStep2Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>2 Start dates</span>
                    <span className={cn("rounded-md px-2 py-0.5", sendStep3Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>3 Deposit & email</span>
                  </div>
                    </>
                  ) : null}

                  {quote.request_id ? (
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border-light bg-card/60 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={emailAttachRequestPhotos}
                        onChange={(e) => setEmailAttachRequestPhotos(e.target.checked)}
                        className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/20"
                      />
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-text-primary">Attach request site photos to customer email</span>
                      <FixfyHintIcon text="Includes PDF plus images. Off by default — use when the client should see the same photos partners received." />
                    </label>
                  ) : null}
                </div>
              )}

              {quote.request_id && !["draft", "in_survey", "bidding", "awaiting_customer"].includes(quote.status) ? (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border-light bg-card/60 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={emailAttachRequestPhotos}
                    onChange={(e) => setEmailAttachRequestPhotos(e.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <span className="min-w-0 flex-1 text-[13px] font-medium text-text-primary">Attach request site photos to customer email</span>
                  <FixfyHintIcon text="Includes PDF plus images. Off by default — use when the client should see the same photos partners received." />
                </label>
              ) : null}

              <div className="border-t border-border-light pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-card">
                      <FileText className="h-4 w-4 text-text-tertiary" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-semibold text-text-primary">Customer PDF</p>
                        <FixfyHintIcon text="Matches the PDF attached when you email the client. Uses saved scope, line items and figures — use Save Quote to refresh before preview or download." />
                      </div>
                      <p className="text-[11px] text-text-tertiary">Uses saved figures</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-text-primary"
                      onClick={() => {
                        window.open(
                          `/api/quotes/send-pdf?quoteId=${encodeURIComponent(quote.id)}`,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-text-primary"
                      icon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => {
                        const url = `/api/quotes/send-pdf?quoteId=${encodeURIComponent(quote.id)}&download=1`;
                        const a = document.createElement("a");
                        a.href = url;
                        a.rel = "noopener";
                        a.download = `${String(quote.reference ?? "quote").replace(/\//g, "-")}_quote.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Move this quote</p>
                <div
                  className={cn(
                    "-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-visible px-1 py-1 scroll-smooth sm:gap-2",
                    "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
                    "[&_button]:shrink-0",
                  )}
                >
                  {quote.status === "awaiting_customer" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={sendState === "sending" || !sendStep3Ready}
                      icon={sendState === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      onClick={() => void handleSendToCustomer()}
                      title="Saves the latest proposal and emails the PDF (Accept / Reject links stay the same)"
                    >
                      {sendState === "sending" ? "Saving…" : "Resend Quote"}
                    </Button>
                  )}
                  {overviewActions.map((action) => {
                    const sendToCustomerClick = async () => {
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
                    };
                    const showMarkAsSent =
                      action.status === "awaiting_customer" && ["draft", "in_survey", "bidding"].includes(quote.status);
                    return (
                      <Fragment key={action.status}>
                        <Button
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
                            await sendToCustomerClick();
                          }}
                        >
                          {action.label}
                        </Button>
                        {showMarkAsSent ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={proposalSaving}
                            icon={<MailCheck className="h-3.5 w-3.5" />}
                            title="Save proposal, move to Awaiting Customer, and record that the PDF was already delivered (no email from this app)"
                            onClick={() => void handleMarkAsSentExternally()}
                          >
                            Mark as sent
                          </Button>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* BIDS TAB — Partner bids from app; approve to set quote partner */}
          {tab === "bids" && (
            <div className="space-y-3 p-3 sm:p-4">
              {quote.quote_type === "partner" ? (
                <PartnerBidMiniDash
                  bidsLoading={bidsLoading}
                  primaryLabel={bidDashPrimary.label}
                  primaryValue={bidDashPrimary.value}
                  bidsReceivedCount={bidsReceivedCount}
                  invitedPartnersCount={invitedPartnersCount}
                  quotedPartnersCount={quotedPartnersCount}
                />
              ) : null}
              <Button variant="outline" size="sm" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setInvitePartnerOpen(true)} className="w-full">
                Invite more partners
              </Button>
              {quote.quote_type === "partner" && (quote.status === "draft" || quote.status === "in_survey") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={proposalSaving}
                  icon={<Send className="h-3.5 w-3.5" />}
                  onClick={async () => {
                    const result = await Promise.resolve(onStatusChange(quote, "bidding"));
                    if (result === false) return;
                  }}
                >
                  Start Bidding
                </Button>
              )}
              <div className="p-3 rounded-xl bg-surface-hover border border-border-light">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5"
                      title="AI-assisted selection"
                    >
                      <Brain
                        className="h-3.5 w-3.5 text-primary motion-safe:animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"
                        aria-hidden
                      />
                    </span>
                    <p className="text-sm font-semibold text-text-primary leading-tight truncate">All Bids</p>
                  </div>
                  {quote.quote_type === "partner" && (
                    <button
                      type="button"
                      title="Refresh bids"
                      aria-label="Refresh partner bids"
                      disabled={bidsLoading}
                      onClick={() => void handleRefreshBids()}
                      className={cn(
                        "shrink-0 rounded-lg border border-border-light bg-surface-tertiary p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50",
                        bidsLoading && "pointer-events-none",
                      )}
                    >
                      <RefreshCw className={cn("h-4 w-4", bidsLoading && "animate-spin")} />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
                  Our AI automatically selects the best bid for the customer proposal based on price, availability and region. It is pre-selected
                  using the lowest price — feel free to change it manually.
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
              {bids.length === 0 && bidsLoading ? (
                <div className="h-24 animate-pulse rounded-xl bg-surface-hover" aria-hidden />
              ) : bids.length === 0 ? (
                <p className="text-sm text-text-tertiary">
                  No partner bids yet — that&apos;s fine. Set partner cost and sell price on Review & Send, then move to <strong className="text-text-secondary">Awaiting Customer</strong> and send the email.
                </p>
              ) : (
                <div className={cn("space-y-2", bidsLoading && "opacity-90")}>
                  {bidsVisibleInTab.map((bid) => {
                    const bidPayload = parseBidProposalFromNotes(bid.notes);
                    const { labour, materials } = splitBidPartnerCosts(bid.bid_amount, bidPayload);
                    const rawD1 = bidPayload ? bidPayloadTrimmedString(bidPayload.start_date_option_1 as unknown) : "";
                    const rawD2 = bidPayload ? bidPayloadTrimmedString(bidPayload.start_date_option_2 as unknown) : "";
                    const d1 =
                      formatYmdUkDisplay(normalizeCalendarDateToYmd(rawD1)) || (rawD1 ? rawD1.slice(0, 12) : "");
                    const d2 =
                      formatYmdUkDisplay(normalizeCalendarDateToYmd(rawD2)) || (rawD2 ? rawD2.slice(0, 12) : "");
                    const labourDesc = bidPayload ? bidPayloadTrimmedString(bidPayload.labour_description as unknown) : "";
                    const matDesc = bidPayload ? bidPayloadTrimmedString(bidPayload.materials_description as unknown) : "";
                    const scopeFromBid = bidPayload ? bidPayloadTrimmedString(bidPayload.scope as unknown) : "";
                    const bidNoteSummary = summarizeBidProposalNotes(bid.notes);
                    const notesPlain = bidPayloadTrimmedString(bid.notes as unknown);
                    const hasStructuredBreakdown =
                      bidPayload != null &&
                      (bidPayload.labour_cost != null || bidPayload.materials_cost != null);
                    const hasExpandableDetails =
                      hasStructuredBreakdown ||
                      !!(bidNoteSummary || notesPlain) ||
                      !!(d1 || d2) ||
                      !!scopeFromBid;
                    const bidExpanded = expandedBidIds.has(bid.id);
                    const isSelectedForReview = bid.id === selectedReviewBidId;
                    const rowSelectable = bid.status === "submitted";
                    const spotlightLabel = bidSpotlightLabelById.get(bid.id);
                    const handleBidRowActivate = () => {
                      if (!rowSelectable || proposalSaving) return;
                      if (selectedReviewBidId === bid.id) void clearBidSelection();
                      else void selectBidForReview(bid, { silent: true });
                    };
                    return (
                    <div
                      key={bid.id}
                      className={cn(
                        "rounded-lg border bg-surface-hover border-border-light px-1.5 py-1 transition-shadow",
                        isSelectedForReview &&
                          (bid.status === "submitted" || bid.status === "approved") &&
                          "border-emerald-500/45 bg-emerald-500/[0.07] ring-2 ring-emerald-500/35 shadow-sm dark:bg-emerald-950/20 dark:border-emerald-500/30",
                      )}
                    >
                      <div className="flex items-center gap-1 min-[400px]:gap-1.5">
                        {spotlightLabel ? (
                          <span
                            className={cn(
                              "flex w-10 shrink-0 flex-col items-center justify-center rounded border px-0.5 py-0.5 text-center text-[7px] font-bold uppercase leading-tight tracking-wide min-[400px]:w-11 min-[400px]:py-1 min-[400px]:text-[8px]",
                              spotlightLabel === "Lowest" &&
                                "border-emerald-500/30 bg-emerald-500/12 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300",
                              spotlightLabel === "Mid" &&
                                "border-amber-400/50 bg-amber-400/15 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
                              spotlightLabel === "Highest" &&
                                "border-red-400/45 bg-red-500/12 text-red-900 dark:border-red-500/40 dark:bg-red-950/35 dark:text-red-300",
                            )}
                          >
                            {spotlightLabel}
                          </span>
                        ) : null}
                        <div className="flex w-6 shrink-0 justify-center self-center">
                          {hasExpandableDetails ? (
                            <button
                              type="button"
                              aria-expanded={bidExpanded}
                              aria-label={bidExpanded ? "Hide bid details" : "Show bid details"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedBidIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(bid.id)) next.delete(bid.id);
                                  else next.add(bid.id);
                                  return next;
                                });
                              }}
                              className="rounded-md border border-transparent p-0.5 text-text-secondary transition-colors hover:border-border-light hover:bg-surface-tertiary hover:text-text-primary"
                            >
                              <ChevronDown
                                className={cn("h-3.5 w-3.5 transition-transform duration-200", bidExpanded && "rotate-180")}
                              />
                            </button>
                          ) : (
                            <span className="inline-block w-3.5" aria-hidden />
                          )}
                        </div>
                        <div
                          className={cn(
                            "min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md py-0.5 outline-none",
                            rowSelectable && !proposalSaving && "cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.05]",
                          )}
                          role={rowSelectable ? "button" : undefined}
                          tabIndex={rowSelectable ? 0 : undefined}
                          aria-pressed={rowSelectable ? selectedReviewBidId === bid.id : undefined}
                          onKeyDown={
                            rowSelectable
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleBidRowActivate();
                                  }
                                }
                              : undefined
                          }
                          onClick={rowSelectable ? handleBidRowActivate : undefined}
                        >
                          <p className="min-w-0 max-w-[11rem] truncate text-xs font-semibold text-text-primary sm:max-w-[14rem]">
                            {bid.partner_name ?? bid.partner_id}
                          </p>
                          <Badge variant={bid.status === "approved" ? "success" : bid.status === "rejected" ? "danger" : "default"} size="sm" className="shrink-0">
                            {bid.status}
                          </Badge>
                          <span className="text-base font-bold tabular-nums text-primary shrink-0">{formatCurrency(bid.bid_amount)}</span>
                          {(d1 || d2) ? (
                            <span className="text-[9px] text-text-tertiary tabular-nums min-w-0 sm:text-[10px]">
                              {d1 ? `Start ${d1}` : ""}
                              {d1 && d2 ? " · " : ""}
                              {d2 ? d1 ? `End ${d2}` : `Start ${d2}` : ""}
                            </span>
                          ) : null}
                        </div>
                        {bid.status === "submitted" ? (
                          <div className="ml-auto shrink-0 self-center pl-1" data-bid-no-select onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="primary"
                              className="shrink-0"
                              disabled={proposalSaving}
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const pre = computeCustomerProposalFromBid(bid, quote);
                                    const scopeMerged = pre.scopeText ?? scopeText;
                                    const d1b = normalizeCalendarDateToYmd(pre.startDate1 ?? startDate1) || "";
                                    const d2b = normalizeCalendarDateToYmd(pre.startDate2 ?? startDate2) || "";
                                    const depPct = pre.depositPercent ?? depositPercent;

                                    await approveBid(bid.id, quote.id, bid.partner_id, bid.partner_name, bid.bid_amount);

                                    const updated = await persistProposalToQuote({
                                      lineItemsOverride: pre.lines,
                                      scopeTextOverride: scopeMerged,
                                      startDate1Override: d1b,
                                      startDate2Override: d2b,
                                      depositOverride: depPct,
                                      partnerCostOverride: bid.bid_amount,
                                    });

                                    await loadBids(quote.id);

                                    setLineItems(pre.lines);
                                    setScopeText(bidPayloadTrimmedString(scopeMerged as unknown));
                                    setStartDate1(d1b);
                                    setStartDate2(d2b);
                                    setDepositPercent(depPct);
                                    setProposalScalePercent(100);
                                    setSelectedReviewBidId(bid.id);

                                    onQuoteUpdate?.(updated);
                                    setTab("overview");
                                    toast.success(
                                      "Bid approved. Partner unit costs and customer sell (40% margin on sell) are pre-filled. Adjust on Review & Send if needed, then send to the customer.",
                                    );
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : "Failed to approve bid");
                                  }
                                })();
                              }}
                            >
                              Approve
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {bidExpanded && hasExpandableDetails ? (
                        <div className="mt-2 border-t border-border-light pt-2 space-y-2 pl-9">
                          {hasStructuredBreakdown ? (
                            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border-light bg-card/50 px-2.5 py-2 sm:grid-cols-2 dark:bg-surface-secondary/20">
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Labour</p>
                                <p className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(labour)}</p>
                                {labourDesc ? (
                                  <p className="text-[11px] text-text-secondary mt-1 leading-snug line-clamp-3 whitespace-pre-wrap">{labourDesc}</p>
                                ) : null}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Materials</p>
                                <p className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(materials)}</p>
                                {matDesc ? (
                                  <p className="text-[11px] text-text-secondary mt-1 leading-snug line-clamp-3 whitespace-pre-wrap">{matDesc}</p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          {bidNoteSummary ? (
                            <p className="text-[12px] text-text-secondary leading-relaxed break-words">{bidNoteSummary}</p>
                          ) : notesPlain ? (
                            <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap break-words max-h-[8rem] overflow-y-auto">{notesPlain}</p>
                          ) : null}
                          {(d1 || d2) ? (
                            <div className="flex flex-wrap gap-1.5">
                              {d1 ? (
                                <span className="inline-flex items-center rounded-md border border-border-light bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary">
                                  Opt 1: <strong className="ml-1 font-semibold text-text-primary tabular-nums">{d1}</strong>
                                </span>
                              ) : null}
                              {d2 ? (
                                <span className="inline-flex items-center rounded-md border border-border-light bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary">
                                  Opt 2: <strong className="ml-1 font-semibold text-text-primary tabular-nums">{d2}</strong>
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          {scopeFromBid ? (
                            <div className="rounded-md border border-dashed border-border-light bg-surface-hover/80 px-2.5 py-2">
                              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope</p>
                              <p className="text-[11px] text-text-secondary mt-0.5 leading-snug whitespace-pre-wrap break-words max-h-[6rem] overflow-y-auto">{scopeFromBid}</p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() =>
                  setSelectedPartnerIds(partnersEligibleForInvite.length ? new Set(partnersEligibleForInvite.map((p) => p.id)) : new Set())
                }
                className="text-xs font-medium text-primary hover:underline"
              >
                Select all
              </button>
              <button type="button" onClick={() => setSelectedPartnerIds(new Set())} className="text-xs font-medium text-text-tertiary hover:underline">
                Clear selection
              </button>
              <button
                type="button"
                disabled={!invitePartnerTypeOfWork.trim()}
                onClick={() =>
                  setSelectedPartnerIds((prev) => {
                    const next = new Set(prev);
                    for (const p of partnersEligibleForInvite) {
                      if (p.id && safePartnerMatchesTypeOfWork(p, invitePartnerTypeOfWork)) next.delete(p.id);
                    }
                    return next;
                  })
                }
                className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-40 disabled:pointer-events-none"
              >
                Deselect matched
              </button>
            </div>
          </div>
          <div className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1 rounded-xl border border-amber-200/50 dark:border-amber-900/40 bg-card/80 p-2">
            {partnersEligibleForInvite.length === 0 && (
              <p className="text-sm text-text-tertiary text-center py-8">No active partners found</p>
            )}
            {partnersEligibleForInvite.map((p) => {
              const isSelected = selectedPartnerIds.has(p.id);
              const isTradeMatch =
                !!invitePartnerTypeOfWork.trim() && safePartnerMatchesTypeOfWork(p, invitePartnerTypeOfWork);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? "border-amber-500 bg-amber-50/80 dark:bg-amber-950/35 ring-1 ring-amber-500/25"
                      : "border-amber-200/70 dark:border-amber-900/50 bg-card hover:border-amber-400/70 hover:bg-amber-50/50 dark:hover:bg-amber-950/25"
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
                    className="sr-only"
                  />
                  <Avatar name={p.company_name} size="md" src={p.avatar_url ?? undefined} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{p.company_name}</p>
                    <p className="text-xs text-text-tertiary mt-0.5 truncate">
                      {isTradeMatch ? partnerMatchTypeLabel(p, invitePartnerTypeOfWork) : (p.trade || "—")}
                      {p.location?.trim() ? <> · {p.location}</> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isTradeMatch ? (
                      <span className="inline-flex items-center rounded-full border border-amber-500/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Match
                      </span>
                    ) : null}
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        isSelected ? "border-primary bg-primary" : "border-amber-400/80 dark:border-amber-600 bg-white dark:bg-card"
                      }`}
                    >
                      {isSelected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-4 pt-4 mt-4 border-t border-border-light">
            <p className="text-sm text-text-tertiary">{selectedPartnerIds.size === 0 ? "Select at least one" : `${selectedPartnerIds.size} selected`}</p>
            <Button
              size="sm"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={sendingInvitePush}
              disabled={selectedPartnerIds.size === 0 || sendingInvitePush}
              onClick={async () => {
                if (selectedPartnerIds.size === 0) return;
                setSendingInvitePush(true);
                try {
                  const partnerIds = Array.from(selectedPartnerIds);
                  const inviteBody =
                    `${quote.title} — ${quote.property_address ?? quote.client_name ?? ""}`.trim() || quote.reference;
                  const res = await fetch("/api/push/notify-partner", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      partnerIds,
                      title: "New quote invitation",
                      body: inviteBody,
                      data: { type: "quote_invite", quoteId: quote.id, photoUrls: quote.images ?? [] },
                    }),
                  });
                  if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error((body && typeof body.error === "string" && body.error) || "Failed to send push invite");
                  }
                  const body = (await res.json().catch(() => ({}))) as {
                    sent?: number;
                    errors?: number;
                    tokensFound?: number;
                  };
                  const sent = Number(body?.sent ?? 0);
                  const tokensFound = Number(body?.tokensFound ?? 0);
                  if (sent <= 0) {
                    throw new Error(
                      tokensFound <= 0
                        ? "No valid push token found for selected partner(s). Ask them to open the app and allow notifications."
                        : "Push request was accepted but not delivered (0 sent)."
                    );
                  }
                  toast.success(`Quote request sent to ${sent} partner(s)`);
                  setInvitePartnerOpen(false);
                  setSelectedPartnerIds(new Set());
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to send quote invitation");
                } finally {
                  setSendingInvitePush(false);
                }
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

/** Required fields before leaving draft/survey; bidding is optional — you can go straight to awaiting_customer with your own figures. */
function quoteBasicsForPipeline(quote: Quote): { ok: boolean; message?: string } {
  if (!bidPayloadTrimmedString(quote.client_name as unknown)) return { ok: false, message: "Fill client name (Step 1: Job details)." };
  if (!bidPayloadTrimmedString(quote.client_email as unknown)) return { ok: false, message: "Fill client email (Step 1: Job details)." };
  if (!bidPayloadTrimmedString(quote.property_address as unknown)) return { ok: false, message: "Fill property address (Step 1: Job details)." };
  if (!bidPayloadTrimmedString(quote.title as unknown)) return { ok: false, message: "Fill job title / service (Step 1: Job details)." };
  if (Number(quote.total_value) <= 0 && Number(quote.cost) <= 0) {
    return { ok: false, message: "Set price or add line items before advancing." };
  }
  return { ok: true };
}

/** Scope/line total, dates, deposit and email must be on the quote before moving to Awaiting Customer. */
function proposalFieldsReadyForQuote(quote: Quote): { ok: boolean; message?: string } {
  const hasScope = !!bidPayloadTrimmedString(quote.scope as unknown);
  const hasValue = Number(quote.total_value) > 0;
  if (!hasScope && !hasValue) {
    return { ok: false, message: "Add scope of work or line items with a total before sending to customer." };
  }
  if (!quote.start_date_option_1 && !quote.start_date_option_2) {
    return { ok: false, message: "Set at least one proposed start date before sending to customer." };
  }
  const depPct = (() => {
    const raw = quote.deposit_percent;
    if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
    return inferDepositPercentFromLegacy(Number(quote.deposit_required ?? 0), Number(quote.total_value ?? 0));
  })();
  if (Number.isNaN(depPct) || depPct < 0 || depPct > 100) {
    return { ok: false, message: "Set deposit percentage between 0% and 100% (0 if no deposit)." };
  }
  const email = bidPayloadTrimmedString(quote.client_email as unknown);
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
  const raw = bidPayloadTrimmedString(q.start_date_option_1 as unknown) || bidPayloadTrimmedString(q.start_date_option_2 as unknown);
  return parseIsoDateOnly(raw);
}

/** Labour (line 1) vs materials (line 2) partner subtotals from stored proposal rows. */
function splitPartnerCostFromFirstTwoLines(
  rows: Array<{ quantity?: number | null; partner_unit_cost?: number | null }>,
): { labour: number; materials: number; hasSplit: boolean } {
  if (rows.length < 2) return { labour: 0, materials: 0, hasSplit: false };
  const q0 = Number(rows[0]?.quantity) || 1;
  const q1 = Number(rows[1]?.quantity) || 1;
  const p0 = (Number(rows[0]?.partner_unit_cost ?? 0) || 0) * q0;
  const p1 = (Number(rows[1]?.partner_unit_cost ?? 0) || 0) * q1;
  if (p0 <= 0 && p1 <= 0) return { labour: 0, materials: 0, hasSplit: false };
  return { labour: p0, materials: p1, hasSplit: true };
}

/** Narrative scope only for the job (bid `scope`, else saved `quotes.scope`, else plain bid notes) — no line-item £ or labour/materials breakdown. */
function mergeCreateJobScopeFromQuote(q: Quote, approvedBid: QuoteBid | null): string {
  const payload = approvedBid ? parseBidProposalFromNotes(approvedBid.notes) : null;
  const bidScope = payload ? bidPayloadTrimmedString(payload.scope as unknown) : "";
  const quoteScope = bidPayloadTrimmedString(q.scope as unknown);
  const plainBidNotes =
    approvedBid && !payload ? bidPayloadTrimmedString(approvedBid.notes as unknown) : "";
  return (bidScope || quoteScope || plainBidNotes).trim();
}

function CreateJobFromQuoteModal({ quote, onClose, onSubmit }: {
  quote: Quote | null; onClose: () => void;
  onSubmit: (data: { title: string; client_id?: string; client_address_id?: string; client_name: string; property_address: string; partner_id?: string; partner_name?: string; client_price: number; partner_cost: number; materials_cost: number; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null; createWithoutDeposit?: boolean; job_type?: "fixed" | "hourly"; scope?: string }) => void;
}) {
  const [form, setForm] = useState({ title: "", partner_id: "", client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", arrival_from: "09:00", arrival_window_mins: "180", expected_finish_date: "", scope: "", createWithoutDeposit: false, job_type: "fixed" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [partners, setPartners] = useState<Partner[]>([]);
  /** DB / approved-bid partner when not in `partners` list (label for Select + submit). */
  const [partnerFromQuote, setPartnerFromQuote] = useState<{ id: string; name: string } | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot form bootstrap when modal opens (parent uses key=quote.id) */
  useEffect(() => {
    if (!quote) return;
    const typeOfWorkInitial =
      normalizeTypeOfWork(bidPayloadTrimmedString(quote.service_type as unknown)) || proposalFirstLineLabel(quote);
    const qScope = bidPayloadTrimmedString(quote.scope as unknown);
    setForm({
      title: typeOfWorkInitial,
      partner_id: quote.partner_id ?? "",
      client_price: String(quote.total_value ?? 0),
      partner_cost: String(quote.partner_cost ?? 0),
      materials_cost: "0",
      scheduled_date: preferredScheduleDateFromQuote(quote),
      arrival_from: "09:00",
      arrival_window_mins: "180",
      expected_finish_date: "",
      scope: qScope,
      createWithoutDeposit: false,
      job_type: "fixed",
    });
    setClientAddress({
      client_id: quote.client_id,
      client_address_id: quote.client_address_id,
      client_name: quote.client_name ?? "",
      client_email: quote.client_email ?? undefined,
      property_address: quote.property_address ?? "",
    });
    listPartners({ pageSize: 200, status: "all" }).then((r) => setPartners(r.data ?? []));
    let cancelled = false;
    (async () => {
      const [fresh, bids, lineRes] = await Promise.all([
        getQuote(quote.id),
        getBidsByQuoteId(quote.id).catch(() => [] as QuoteBid[]),
        getSupabase().from("quote_line_items").select("*").eq("quote_id", quote.id).order("sort_order"),
      ]);
      if (cancelled) return;
      const q = fresh ?? quote;
      const approvedBid = bids.find((b) => b.status === "approved") ?? null;
      const pid =
        bidPayloadTrimmedString(q.partner_id as unknown) ||
        (approvedBid?.partner_id ? String(approvedBid.partner_id) : "");
      const pname =
        bidPayloadTrimmedString(q.partner_name as unknown) ||
        bidPayloadTrimmedString(approvedBid?.partner_name as unknown) ||
        "";
      if (pid) {
        setPartnerFromQuote({ id: pid, name: pname || pid });
      } else {
        setPartnerFromQuote(null);
      }
      const { data } = lineRes;
      const items = (data ?? []) as Array<{
        description?: string | null;
        quantity?: number | null;
        unit_price?: number | null;
        partner_unit_cost?: number | null;
        notes?: string | null;
      }>;
      const mergedScope = mergeCreateJobScopeFromQuote(q, approvedBid);
      const split = splitPartnerCostFromFirstTwoLines(items);
      const bidJobType = approvedBid?.job_type === "hourly" || approvedBid?.job_type === "fixed" ? approvedBid.job_type : undefined;
      setForm((prev) => ({
        ...prev,
        partner_id: pid || prev.partner_id,
        scope: mergedScope,
        partner_cost: split.hasSplit ? String(split.labour) : String(q.partner_cost ?? prev.partner_cost),
        materials_cost: split.hasSplit ? String(split.materials) : prev.materials_cost,
        job_type: bidJobType ?? prev.job_type,
      }));
      setClientAddress({
        client_id: q.client_id,
        client_address_id: q.client_address_id,
        client_name: q.client_name ?? "",
        client_email: q.client_email ?? undefined,
        property_address: q.property_address ?? "",
      });
    })();
    if (quote.request_id && !quote.client_address_id?.trim()) {
      getRequest(quote.request_id).then((req) => {
        if (cancelled || !req?.property_address) return;
        setClientAddress((p) => {
          if (p.property_address?.trim()) return p;
          return { ...p, property_address: req.property_address };
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [quote]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const partnerSelectOptions = useMemo(() => {
    const base = partners.map((p) => ({ value: p.id, label: p.company_name || p.contact_name || p.id }));
    const pid = form.partner_id?.trim();
    if (pid && !base.some((o) => o.value === pid)) {
      const label = partnerFromQuote?.id === pid ? partnerFromQuote.name : pid;
      return [{ value: "", label: "No partner" }, { value: pid, label }, ...base];
    }
    return [{ value: "", label: "No partner" }, ...base];
  }, [partners, form.partner_id, partnerFromQuote]);

  const typeOfWorkOptions = useMemo(
    () => withTypeOfWorkFallback(form.title).map((name) => ({ value: name, label: name })),
    [form.title]
  );

  if (!quote) return null;
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) { toast.error("Job title is required"); return; }
    if (!clientAddress.client_id) {
      toast.error("Select a client from the list (click the name or press Enter) — typing alone does not link the client.");
      return;
    }
    if (!clientAddress.property_address?.trim()) {
      toast.error("Choose a property address or add a new one under Property address.");
      return;
    }
    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    const partnerNameResolved =
      selectedPartner?.company_name ||
      selectedPartner?.contact_name ||
      (partnerFromQuote?.id === form.partner_id ? partnerFromQuote.name : undefined) ||
      bidPayloadTrimmedString(quote.partner_name as unknown) ||
      undefined;
    const effectivePartnerId = form.partner_id || partnerFromQuote?.id || quote.partner_id;
    const sched = resolveJobModalSchedule({
      scheduled_date: form.scheduled_date,
      arrival_from: form.arrival_from,
      arrival_window_mins: form.arrival_window_mins,
      hasPartner: !!effectivePartnerId,
    });
    if (!sched.ok) {
      toast.error(sched.error);
        return;
      }
    const scheduled_date = parseIsoDateOnly(sched.scheduled_date ?? "") || undefined;
    if (form.scheduled_date?.trim() && !scheduled_date) {
      toast.error("Scheduled date must be a complete day (YYYY-MM-DD). Fix the date or clear the field.");
        return;
      }
    let scheduled_finish_date: string | null = null;
    if (scheduled_date) {
      const ef = parseIsoDateOnly(form.expected_finish_date ?? "");
      if (form.expected_finish_date?.trim() && !ef) {
        toast.error("Expected finish must be a complete date (YYYY-MM-DD).");
        return;
      }
      if (!ef) {
        toast.error("Expected finish date is required when a start date is set.");
        return;
      }
      if (ef < scheduled_date) {
        toast.error("Expected finish date must be on or after the scheduled date.");
        return;
      }
      scheduled_finish_date = ef;
    } else if (form.expected_finish_date?.trim()) {
      toast.error("Clear expected finish or set a scheduled date.");
      return;
    }
    let scheduled_start_at = sched.scheduled_start_at;
    let scheduled_end_at = sched.scheduled_end_at;
    if (!scheduled_date) {
      scheduled_start_at = undefined;
      scheduled_end_at = undefined;
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
      partner_name: partnerNameResolved,
      client_price: Number(form.client_price) || 0,
      partner_cost: Number(form.partner_cost) || 0,
      materials_cost: Number(form.materials_cost) || 0,
      scheduled_date,
      scheduled_start_at,
      scheduled_end_at,
      scheduled_finish_date,
      createWithoutDeposit: form.createWithoutDeposit,
      job_type: form.job_type as "fixed" | "hourly",
      scope: scopeTrimmed || (quote.scope ?? "").trim(),
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
        <JobModalScheduleFields
          scheduledDate={form.scheduled_date}
          arrivalFrom={form.arrival_from}
          arrivalWindowMins={form.arrival_window_mins}
          expectedFinishDate={form.expected_finish_date}
          onChange={(field, v) => update(field, v)}
          expectedFinishRequired={!!form.scheduled_date?.trim()}
          startDateFooter={
            <p className="text-[10px] text-text-tertiary">
              Pre-filled from the client&apos;s preferred start on the quote (option 1, else option 2) when set.
            </p>
          }
        />
        <Select label="Partner" options={partnerSelectOptions} value={form.partner_id} onChange={(e) => update("partner_id", e.target.value)} />
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
          <Button variant="outline" size="sm" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" size="sm">Create Job</Button>
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

/* ========== MARGIN CALCULATOR (controlled: parent owns sell price — avoids feedback loops / flicker) ========== */
function MarginCalculator({
  cost,
  sellPrice,
  onSellPriceChange,
  onMarginChange,
}: {
  cost: number;
  sellPrice: number;
  onSellPriceChange: (v: number) => void;
  onMarginChange: (v: number) => void;
}) {
  const [sellDraft, setSellDraft] = useState<string | null>(null);

  const effectiveSell =
    sellDraft !== null ? (Number(String(sellDraft).replace(",", ".")) || 0) : sellPrice;
  const markupPct =
    cost > 0 && effectiveSell > 0 ? Math.max(5, Math.round(((effectiveSell / cost - 1) * 100) * 10) / 10) : 5;
  const grossMarginPct = markupPctToGrossMarginOnSell(markupPct);
  const marginValue = cost > 0 ? effectiveSell - cost : 0;
  const minSellForSlider = cost > 0 ? Math.round(cost * 1.05 * 100) / 100 : 0;

  const pushMarginLabel = (markup: number) => {
    onMarginChange(Math.round(markupPctToGrossMarginOnSell(markup) * 10) / 10);
  };

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
    onSellPriceChange(clamped);
    const m = (clamped / cost - 1) * 100;
    pushMarginLabel(Math.max(5, m));
  };

  const handleSliderChange = (mk: number) => {
    setSellDraft(null);
    const sp = cost > 0 ? Math.round(cost * (1 + mk / 100) * 100) / 100 : 0;
    onSellPriceChange(sp);
    pushMarginLabel(mk);
  };

  const sliderShown = Math.min(MARGIN_SLIDER_MAX_MARKUP_PCT, Math.max(5, markupPct));

  return (
    <div className="p-4 rounded-xl border border-border-light bg-surface-tertiary/70 dark:bg-surface-secondary dark:border-border">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="h-4 w-4 text-text-secondary" />
        <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Margin calculator</label>
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
          value={sliderShown}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
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
        {grossMarginPct < 40 && cost > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1">Below standard margin on sell (40%)</p>
        )}
      </div>
    </div>
  );
}

/** Partners whose primary trade or trades list matches the selected type of work. */
function partnerMatchesTypeOfWork(partner: Partner, typeOfWork: string): boolean {
  const t = typeOfWork.trim();
  if (!t) return false;
  const trades = partner.trades?.length ? partner.trades : [partner.trade].filter(Boolean);
  const nt = normalizeTypeOfWork(t);
  return trades.some((tr) => {
    const r = String(tr).trim();
    return r === t || normalizeTypeOfWork(r) === nt;
  });
}

function seedManualProposalLines(typeOfWorkTitle: string): ProposalLineRow[] {
  const first = normalizeTypeOfWork(typeOfWorkTitle).trim() || "Type of work";
  return [
    { description: first, quantity: "1", partnerUnitCost: "0", unitPrice: "0", notes: "" },
    { description: "Materials", quantity: "1", partnerUnitCost: "0", unitPrice: "0", notes: "" },
  ];
}

/* ========== CREATE QUOTE FORM ========== */
function CreateQuoteForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (d: Partial<Quote>, options?: { manualLineItems?: ProposalLineRow[] }) => void;
  onCancel: () => void;
}) {
  const [quoteType, setQuoteType] = useState<"internal" | "partner">("internal");
  const [form, setForm] = useState({ title: "", total_value: "" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [lineItems, setLineItems] = useState<ProposalLineRow[]>(() => seedManualProposalLines(""));
  const [scopeText, setScopeText] = useState("");
  const [startDate1, setStartDate1] = useState("");
  const [startDate2, setStartDate2] = useState("");
  const [depositPercent, setDepositPercent] = useState("50");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [partnerDescription, setPartnerDescription] = useState("");
  const [invitePhotos, setInvitePhotos] = useState<File[]>([]);
  const [invitePhotoPreviews, setInvitePhotoPreviews] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const inviteUploadFolderRef = useRef(`create-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`);
  const quoteTypePrevRef = useRef(quoteType);
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const linePartnerTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.partnerUnitCost) || 0), 0);
  const lineSellTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const createProposalMarginAbs = lineSellTotal - linePartnerTotal;
  const createProposalMarginPct = marginPctOnSell(lineSellTotal, linePartnerTotal);
  const createDepositAmount = depositAmountFromPercent(lineSellTotal, Number(depositPercent));
  const minCreateStartDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [marginPct, setMarginPct] = useState(0);

  const updateCreateLineItem = (idx: number, field: keyof ProposalLineRow, value: string) => {
    setLineItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };
  const typeOfWorkOptions = useMemo(
    () =>
      mergeTypeOfWorkOptions([...TYPE_OF_WORK_OPTIONS])
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
    [],
  );

  const partnersForTrade = useMemo(() => {
    const t = form.title.trim();
    if (!t) return [];
    return partners.filter((p) => isPartnerEligibleForWork(p) && partnerMatchesTypeOfWork(p, t));
  }, [partners, form.title]);

  useEffect(() => {
    if (quoteType !== "partner") return;
    setPartnersLoading(true);
    listPartners({ pageSize: 200, status: "all" })
      .then((r) => setPartners(r.data ?? []))
      .catch(() => setPartners([]))
      .finally(() => setPartnersLoading(false));
  }, [quoteType]);

  useEffect(() => {
    if (quoteType !== "partner") return;
    if (!form.title.trim()) {
      setSelectedPartnerIds(new Set());
      return;
    }
    setSelectedPartnerIds((prev) => {
      const allowed = new Set(partnersForTrade.map((p) => p.id));
      return new Set([...prev].filter((id) => allowed.has(id)));
    });
  }, [quoteType, form.title, partnersForTrade]);

  useEffect(() => {
    const prev = quoteTypePrevRef.current;
    quoteTypePrevRef.current = quoteType;
    if (quoteType !== "internal" || prev === "internal") return;
    setLineItems(seedManualProposalLines(form.title));
    setScopeText("");
    setDepositPercent("50");
    setStartDate1("");
    setStartDate2("");
  }, [quoteType, form.title]);

  useEffect(() => {
    if (quoteType !== "internal") return;
    const first = normalizeTypeOfWork(form.title).trim() || "Type of work";
    setLineItems((prev) => {
      if (prev.length === 0) return seedManualProposalLines(form.title);
      const next = [...prev];
      if (next[0]) next[0] = { ...next[0], description: first };
      return next;
    });
  }, [form.title, quoteType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast.error("Type of work is required");
      return;
    }
    if (!clientAddress.client_id) {
      toast.error("Select a client from the list (click the name or press Enter) — typing alone does not link the client.");
      return;
    }
    if (!clientAddress.property_address?.trim()) {
      toast.error("Choose a property address or add a new one under Property address.");
      return;
    }
    const scopeFromLineItems = lineItems
      .map((li) => li.description.trim())
      .filter(Boolean)
      .join("\n");
    const scopeResolved =
      quoteType === "internal"
        ? (bidPayloadTrimmedString(scopeText as unknown).trim() || scopeFromLineItems.trim() || undefined)
        : undefined;

    if (quoteType === "partner") {
      if (partnersForTrade.length === 0) {
        toast.error("No partners match this type of work yet — add partners in Directory or choose another trade.");
        return;
      }
      if (selectedPartnerIds.size === 0) {
        toast.error("Please select at least one partner");
        return;
      }
      if (!partnerDescription.trim()) {
        toast.error("Please enter a service description");
        return;
      }
    }

    let imageUrls: string[] | undefined;
    if (invitePhotos.length > 0) {
      setUploadingPhotos(true);
      try {
        const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
        imageUrls = await uploadQuoteInviteImages(invitePhotos, inviteUploadFolderRef.current);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `${err.message} Continuing without invite photos.`
            : "Failed to upload images. Continuing without photos."
        );
        imageUrls = undefined;
      }
      setUploadingPhotos(false);
    }

    const depPct = clampDepositPercent(Number(depositPercent));
    const depAmt = depositAmountFromPercent(lineSellTotal, depPct);

    const payload: Partial<Quote> = {
      title: normalizeTypeOfWork(form.title),
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      client_email: clientAddress.client_email,
      property_address: clientAddress.property_address,
      catalog_service_id: null,
      total_value: quoteType === "internal" ? (lineSellTotal > 0 ? lineSellTotal : linePartnerTotal) : 0,
      cost: quoteType === "internal" ? linePartnerTotal : 0,
      partner_cost: quoteType === "internal" ? linePartnerTotal : undefined,
      sell_price: quoteType === "internal" ? (lineSellTotal > 0 ? lineSellTotal : linePartnerTotal) : 0,
      margin_percent: quoteType === "internal" ? marginPct : 0,
      quote_type: quoteType,
      status: quoteType === "partner" ? "bidding" : "draft",
      partner_id: quoteType === "partner" ? undefined : undefined,
      partner_name: quoteType === "partner" ? undefined : undefined,
      partner_quotes_count: quoteType === "partner" ? selectedPartnerIds.size : undefined,
      scope: quoteType === "partner" ? partnerDescription.trim() : scopeResolved,
      start_date_option_1: quoteType === "internal" ? (startDate1 || undefined) : undefined,
      start_date_option_2: quoteType === "internal" ? (startDate2 || undefined) : undefined,
      deposit_percent: quoteType === "internal" ? depPct : 50,
      deposit_required: quoteType === "internal" ? depAmt : 0,
      ...(form.title.trim() ? { service_type: form.title.trim() } : {}),
      ...(imageUrls?.length ? { images: imageUrls } : {}),
    };
    onSubmit(payload, quoteType === "internal" ? { manualLineItems: lineItems } : undefined);
    inviteUploadFolderRef.current = `create-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    setForm({ title: "", total_value: "" });
    setClientAddress({ client_name: "", property_address: "" });
    setLineItems(seedManualProposalLines(""));
    setScopeText("");
    setDepositPercent("50");
    setStartDate1("");
    setStartDate2("");
    setQuoteType("internal");
    setPartners([]);
    setSelectedPartnerIds(new Set());
    setPartnerDescription("");
    setInvitePhotos([]);
    setInvitePhotoPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
      <div className="max-h-[min(65dvh,520px)] overflow-y-auto overscroll-contain px-4 py-4 sm:max-h-[min(72dvh,580px)] sm:px-6 sm:py-5">
        <div className="space-y-4">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#020040]">
          Quote type <span className="text-[#ED4B00]">*</span>
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Quote type">
          <button
            type="button"
            role="radio"
            aria-checked={quoteType === "internal"}
            onClick={() => setQuoteType("internal")}
            className={cn(
              "relative flex gap-3 rounded-xl border-2 p-3 text-left transition-colors",
              quoteType === "internal"
                ? "border-[#020040] bg-card shadow-sm"
                : "border-neutral-200/90 bg-card hover:border-neutral-300 dark:border-border dark:hover:border-border",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                quoteType === "internal" ? "bg-[#020040] text-white" : "bg-[#020040]/08 text-[#020040]",
              )}
            >
              <Pencil className="h-4 w-4" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold text-[#020040]">Build manually</p>
              <p className="mt-0.5 text-[11px] text-text-tertiary">Enter lines yourself</p>
            </div>
            {quoteType === "internal" ? (
              <span className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#020040] text-white shadow-sm" aria-hidden>
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={quoteType === "partner"}
            onClick={() => setQuoteType("partner")}
            className={cn(
              "relative flex gap-3 rounded-xl border-2 p-3 text-left transition-colors",
              quoteType === "partner"
                ? "border-[#020040] bg-card shadow-sm"
                : "border-neutral-200/90 bg-card hover:border-neutral-300 dark:border-border dark:hover:border-border",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                quoteType === "partner" ? "bg-[#ED4B00]/15 text-[#ED4B00]" : "bg-[#ED4B00]/10 text-[#ED4B00]",
              )}
            >
              <UserPlus className="h-4 w-4" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold text-[#020040]">Invite partners</p>
              <p className="mt-0.5 text-[11px] text-text-tertiary">Partners submit bids</p>
            </div>
            {quoteType === "partner" ? (
              <span className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#020040] text-white shadow-sm" aria-hidden>
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : null}
          </button>
        </div>
      </div>
      <ClientAddressPicker value={clientAddress} onChange={setClientAddress} loadAllClientsOnOpen />
      <Select
        label="Type of work *"
        value={form.title}
        onChange={(e) => update("title", e.target.value)}
        options={[
          { value: "", label: "Select type of work..." },
          ...typeOfWorkOptions,
        ]}
      />
      <div
        className="rounded-xl border border-border-light bg-card px-2.5 py-2.5 shadow-sm"
        role="region"
        aria-label="Quote financial summary"
      >
        <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-stretch min-[420px]:justify-between min-[420px]:gap-3">
          <div className="min-w-0 shrink-0 min-[420px]:max-w-[38%]">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/90 dark:text-emerald-400/95">Total price</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
              {formatCurrency(lineSellTotal)}
            </p>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 min-[360px]:grid-cols-3">
            <div className="rounded-lg bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
              <div className="flex items-center gap-1 text-text-tertiary">
                <Wallet className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                <span className="text-[9px] font-medium uppercase tracking-wide">Your cost</span>
              </div>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(linePartnerTotal)}</p>
            </div>
            <div className="rounded-lg bg-[#ED4B00]/10 px-2 py-1.5 dark:bg-[#ED4B00]/15">
              <div className="flex items-center gap-1 text-text-tertiary">
                <PoundSterling className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                <span className="text-[9px] font-medium uppercase tracking-wide">Gross margin</span>
              </div>
              <p
                className={cn(
                  "mt-0.5 text-sm font-bold tabular-nums",
                  createProposalMarginAbs < 0 ? "text-red-600" : "text-[#ED4B00]",
                )}
              >
                {formatCurrency(createProposalMarginAbs)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-100/80 px-2 py-1.5 dark:bg-slate-800/40">
              <div className="flex items-center gap-1 text-text-tertiary">
                <Percent className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                <span className="text-[9px] font-medium uppercase tracking-wide">% margin</span>
              </div>
              <p
                className={cn(
                  "mt-0.5 text-sm font-bold tabular-nums",
                  createProposalMarginPct < 0 ? "text-red-600" : "text-[#ED4B00]",
                )}
              >
                {createProposalMarginPct}%
              </p>
            </div>
          </div>
        </div>
      </div>
      {quoteType === "partner" && (
        <div className="space-y-2 rounded-xl border border-border-light bg-surface-hover/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Photos (optional)</p>
          <p className="text-[11px] text-text-tertiary">
            Up to 8 images (5 MB each). Shown in the partner app on the job invitation when this quote is in bidding.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-text-primary cursor-pointer hover:border-primary/30">
              <ImagePlus className="h-3.5 w-3.5" />
              Add photos
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                className="sr-only"
                disabled={invitePhotos.length >= 8 || uploadingPhotos}
                onChange={(e) => {
                  const list = e.target.files;
                  if (!list?.length) return;
                  const next = [...invitePhotos, ...Array.from(list)].slice(0, 8);
                  setInvitePhotos(next);
                  setInvitePhotoPreviews((prev) => {
                    prev.forEach((u) => URL.revokeObjectURL(u));
                    return next.map((f) => URL.createObjectURL(f));
                  });
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {invitePhotoPreviews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {invitePhotoPreviews.map((src, i) => (
                <div key={src} className="relative h-16 w-16 rounded-lg overflow-hidden border border-border-light bg-surface-hover shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    onClick={() => {
                      const idx = i;
                      setInvitePhotoPreviews((prev) => {
                        const u = prev[idx];
                        if (u) URL.revokeObjectURL(u);
                        return prev.filter((_, j) => j !== idx);
                      });
                      setInvitePhotos((prev) => prev.filter((_, j) => j !== idx));
                    }}
                    aria-label="Remove photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {quoteType === "internal" ? (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Scope / line items</label>
              <button
                type="button"
                onClick={() =>
                  setLineItems((prev) => [
                    ...prev,
                    { description: "", quantity: "1", partnerUnitCost: "0", unitPrice: "0", notes: "" },
                  ])
                }
                className="text-[11px] font-medium text-[#ED4B00] hover:underline"
              >
                + Add item
              </button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded-xl border border-border-light bg-surface-hover p-3">
                  <div className="min-w-0 flex-1">
                    <Input
                      placeholder={idx === 0 ? "Type of work / labour" : idx === 1 ? "Materials" : "Service / description"}
                      value={item.description}
                      onChange={(e) => updateCreateLineItem(idx, "description", e.target.value)}
                      className="mb-1.5 text-xs"
                    />
                    <div className="flex gap-2 flex-wrap items-end">
                      <div className="w-20 shrink-0">
                        <span className="text-[9px] font-semibold text-text-tertiary uppercase block mb-0.5">Qty</span>
                        <Input
                          type="number"
                          placeholder="1"
                          value={item.quantity}
                          onChange={(e) => updateCreateLineItem(idx, "quantity", e.target.value)}
                          className="text-xs w-full"
                        />
                      </div>
                      <div className="flex-1 min-w-[88px]">
                        <span className="text-[9px] font-semibold text-text-tertiary uppercase block mb-0.5">Partner / unit</span>
                        <Input
                          type="number"
                          placeholder="0"
                          value={item.partnerUnitCost}
                          onChange={(e) => updateCreateLineItem(idx, "partnerUnitCost", e.target.value)}
                          className="text-xs w-full"
                        />
                      </div>
                      <div className="flex-1 min-w-[88px]">
                        <span className="text-[9px] font-semibold text-text-tertiary uppercase block mb-0.5">Sell / unit</span>
                        <Input
                          type="number"
                          placeholder="0"
                          value={item.unitPrice}
                          onChange={(e) => updateCreateLineItem(idx, "unitPrice", e.target.value)}
                          className="text-xs w-full"
                        />
                      </div>
                    </div>
                    <label className="block mt-1.5">
                      <span className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Line notes</span>
                      <textarea
                        value={item.notes ?? ""}
                        onChange={(e) => updateCreateLineItem(idx, "notes", e.target.value)}
                        placeholder="e.g. materials included, hourly detail, exclusions…"
                        rows={2}
                        className="mt-0.5 w-full rounded-lg border border-border-light bg-card px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-none"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col items-end gap-1 pt-1 shrink-0">
                    <span className="text-xs font-semibold text-text-primary tabular-nums">
                      {formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}
                    </span>
                    {lineItems.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-text-tertiary hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 1</label>
              <Input type="date" min={minCreateStartDate} value={startDate1} onChange={(e) => setStartDate1(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Start date option 2</label>
              <Input type="date" min={minCreateStartDate} value={startDate2} onChange={(e) => setStartDate2(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Deposit (% of total)</label>
            <Input
              type="number"
              value={depositPercent}
              onChange={(e) => setDepositPercent(e.target.value)}
              placeholder="50"
              min={0}
              max={100}
              step={0.5}
            />
            <p className="text-[10px] text-text-tertiary mt-1.5">
              Deposit amount:{" "}
              <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(createDepositAmount)}</span>
            </p>
          </div>

          {linePartnerTotal > 0 && (
            <MarginCalculator
              key={`margin-create-${linePartnerTotal}-${lineSellTotal}`}
              cost={linePartnerTotal}
              sellPrice={lineSellTotal}
              onSellPriceChange={(newSellTotal) => {
                setLineItems((prev) => {
                  const cur = prev.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
                  const ptot = prev.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.partnerUnitCost) || 0), 0);
                  if (ptot > 0 && cur < 1e-9) {
                    return prev.map((li) => {
                      const q = Number(li.quantity) || 0;
                      if (q <= 0) return li;
                      const psub = q * (Number(li.partnerUnitCost) || 0);
                      const su = (psub / ptot) * newSellTotal / q;
                      return { ...li, unitPrice: String(Math.round(su * 100) / 100) };
                    });
                  }
                  if (cur < 1e-9) return prev;
                  const scale = newSellTotal / cur;
                  return prev.map((li) => {
                    const u = Number(li.unitPrice) || 0;
                    return { ...li, unitPrice: String(Math.round(u * scale * 100) / 100) };
                  });
                });
              }}
              onMarginChange={setMarginPct}
            />
          )}
        </>
      ) : (
        <>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              Service description <span className="text-[#ED4B00]">*</span>
            </label>
            <textarea
              value={partnerDescription}
              onChange={(e) => setPartnerDescription(e.target.value)}
              placeholder="Describe scope, inclusions and exclusions... (used for partner bids)"
              rows={5}
              className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div>
            <div className="mb-2 space-y-2 flex flex-col items-center">
              <div className="flex w-full max-w-lg flex-col items-center gap-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide text-center">
                  Partners *
                </p>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    className="text-[11px] font-medium text-primary hover:underline disabled:opacity-40 disabled:pointer-events-none"
                    disabled={partnersForTrade.length === 0}
                    onClick={() => setSelectedPartnerIds(new Set(partnersForTrade.map((p) => p.id)))}
                  >
                    Select matched
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-40 disabled:pointer-events-none"
                    disabled={partnersForTrade.length === 0}
                    onClick={() =>
                      setSelectedPartnerIds((prev) => {
                        const next = new Set(prev);
                        partnersForTrade.forEach((p) => next.delete(p.id));
                        return next;
                      })
                    }
                  >
                    Deselect matched
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-text-tertiary hover:underline"
                    onClick={() => setSelectedPartnerIds(new Set())}
                  >
                    Clear selection
                  </button>
                </div>
              </div>
              <div className="flex w-full max-w-lg flex-col items-center justify-center gap-2 rounded-lg border border-border-light bg-surface-hover/50 px-2.5 py-2 text-center sm:flex-row sm:gap-2 sm:px-3 sm:py-2">
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/15"
                  aria-hidden
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <p className="text-[10px] sm:text-[11px] text-text-tertiary leading-snug min-w-0 [text-wrap:pretty]">
                  {form.title.trim()
                    ? "Partners below are matched to your type of work."
                    : "Add a type of work — we’ll match directory partners for you."}
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-amber-200/50 dark:border-amber-900/40 bg-card/80 p-2">
              {partnersLoading && partners.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">Loading partners...</p>
              ) : !partnersLoading && partners.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">No partners in Directory yet.</p>
              ) : !form.title.trim() ? (
                <p className="text-sm text-text-tertiary text-center py-6">Select a type of work to see matching partners.</p>
              ) : partnersForTrade.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">
                  No partners match this type of work yet — add partners in Directory or choose another trade.
                </p>
              ) : (
                partnersForTrade.map((p) => {
                  const isSelected = selectedPartnerIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? "border-amber-500 bg-amber-50/80 dark:bg-amber-950/35 ring-1 ring-amber-500/25"
                          : "border-amber-200/70 dark:border-amber-900/50 bg-card hover:border-amber-400/70 hover:bg-amber-50/50 dark:hover:bg-amber-950/25"
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
                        className="sr-only"
                      />
                      <Avatar name={p.company_name} size="md" src={p.avatar_url ?? undefined} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">{p.company_name || p.contact_name}</p>
                        <p className="text-xs text-text-tertiary mt-0.5 truncate">
                          {partnerMatchTypeLabel(p, form.title)}
                          {p.location?.trim() ? <> · {p.location}</> : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center rounded-full border border-amber-500/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                          Match
                        </span>
                        <span
                          aria-hidden
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            isSelected ? "border-primary bg-primary" : "border-amber-400/80 dark:border-amber-600 bg-white dark:bg-card"
                          }`}
                        >
                          {isSelected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                        </span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-text-tertiary mt-2">{selectedPartnerIds.size} selected</p>
          </div>
        </>
      )}
        </div>
      </div>
      <div className="shrink-0 border-t border-border-light bg-card px-4 py-3 sm:px-6">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} type="button" disabled={uploadingPhotos} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={uploadingPhotos}
            disabled={uploadingPhotos}
            className="w-full border-0 bg-[#ED4B00] text-white hover:bg-[#d84300] sm:w-auto"
          >
            Create Quote
          </Button>
        </div>
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
          <p className="text-xs text-text-tertiary truncate">{quoteListSubtitlePostcode(q)}</p>
          {q.request_id && (
            <p className="text-[10px] text-text-tertiary mt-1">From request · optional site photos in drawer</p>
          )}
          {q.source_account_name?.trim() ? (
            <p className="text-[10px] text-text-tertiary truncate">{q.source_account_name}</p>
          ) : null}
          <p className="text-xs font-medium text-primary mt-1">{formatCurrency(Number(q.total_value) || 0)}</p>
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
  return <button onClick={onClick} className={`inline-flex h-8 items-center px-2.5 text-xs font-medium rounded-[6px] border transition-colors ${colors[variant]}`}>{label}</button>;
}
