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
  ClipboardList, MapPin, Gavel, UserRound, Building2, Sparkles, ChevronDown, ChevronUp, Brain,
  Wallet, Percent, PoundSterling, ImagePlus, X, Pencil, UserPlus,
  MailCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrency, cn, normalizeCalendarDateToYmd, formatYmdUkDisplay } from "@/lib/utils";
import { pricingModeLabel } from "@/lib/pricing-mode-labels";
import { toast } from "sonner";
import type { Quote, Partner, Job, JobKind, Account, QuoteDurationUnit, QuoteEngagementKind, CatalogService } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listQuotes, createQuote, updateQuote, getQuote } from "@/services/quotes";
import { notifyAssignedPartnerAboutJob } from "@/lib/notify-partner-job-push";
import { notifyPartnerJobChange } from "@/lib/notify-partner-job-zendesk";
import { resolveCorporateAccountIdForClient } from "@/services/clients";
import { getAccount, listAccounts } from "@/services/accounts";
import { createAccountProperty, getAccountProperty, listAccountProperties } from "@/services/account-properties";
import { getAccountIdsForBu } from "@/services/business-units";
import {
  findDuplicateJobs,
  findDuplicateQuotes,
  formatJobDuplicateLines,
  formatQuoteDuplicateLines,
} from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { createJob, getJobByQuoteId } from "@/services/jobs";
import { createJobOrSeries } from "@/services/job-recurrence-series";
import { createJobPayment } from "@/services/job-payments";
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
import {
  quoteBiddingSlaDeadlineMsFromQuote,
  formatSlaRemainCountdownMinutes,
  formatSlaOverdueMinutes,
  computeBiddingSlaRollup,
  formatMinutesAsAge,
  biddingQuoteSlaUsesStoredAnchor,
  type BiddingSlaRollup,
  type BiddingSlaAnchorQuote,
} from "@/lib/quote-bidding-sla";
import { formatBiddingSlaHoursLabel } from "@/lib/frontend-setup";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { getPartnerAssignmentBlockReason } from "@/lib/job-partner-assign";
import { getErrorMessage, isUuid, isValidIsoDateTime, parseIsoDateOnly } from "@/lib/utils";
import { insertQuoteLineItemsResilient } from "@/lib/quote-line-items-insert";
import { resolveNominalBillingParty, getQuoteProposalRecipientEmail } from "@/lib/account-billing-addressee";
import {
  resolveJobModalScheduleV2,
  DEFAULT_RECURRENCE_FORM,
  type RecurrenceFormState,
  type JobScheduleV2SeriesPayload,
} from "@/lib/job-modal-schedule";
import { JobModalScheduleFields } from "@/components/shared/job-modal-schedule-fields";
import { typeOfWorkLabelsFromCatalog, normalizeTypeOfWork } from "@/lib/type-of-work";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
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
import { LocationPicker } from "@/components/ui/location-picker";
import { MAPBOX_GB_FORWARD_TYPES, MAPBOX_UK_CENTER_LON_LAT, mapboxGbForwardBiasAppend } from "@/lib/mapbox-uk-geography";
import {
  buildNotesWithPricing,
  defaultPartnerPricingForLineIndex,
  parseProposalLineNotes,
  proposalLineHintDisplay,
  stringifyProposalLineNotes,
  type PartnerLinePricingMode,
} from "@/lib/quote-proposal-line-notes";
import { resolveImagesForJobFromQuote } from "@/lib/job-images";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";

const UI_PERF_EVENT = "master-ui-perf";

function trackUiPerf(metric: string, ms: number, meta?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const payload = { metric, ms: Math.round(ms), ts: Date.now(), ...(meta ?? {}) };
  window.dispatchEvent(new CustomEvent(UI_PERF_EVENT, { detail: payload }));
  if (process.env.NODE_ENV !== "production") {
    console.info(`[ui-perf] ${metric}: ${payload.ms}ms`, meta ?? {});
  }
}

const QUOTE_STATUSES = ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment", "rejected", "converted_to_job"] as const;

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

function formatQuoteDurationDisplay(q: Pick<Quote, "duration_value" | "duration_unit">): string | null {
  const u = q.duration_unit;
  const v = q.duration_value;
  if (u == null || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const w =
    u === "day" ? (n === 1 ? "day" : "days") : u === "week" ? (n === 1 ? "week" : "weeks") : n === 1 ? "month" : "months";
  return `${n} ${w}`;
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
  draft: "New",
  in_survey: "In Survey",
  bidding: "Bidding",
  awaiting_customer: "Approval",
  awaiting_payment: "Payment",
  rejected: "Rejected",
  converted_to_job: "Converted to Job",
};

const statusConfig: Record<string, { variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  draft: { variant: "default", dot: true },
  in_survey: { variant: "info", dot: true },
  bidding: { variant: "warning", dot: true },
  awaiting_customer: { variant: "primary", dot: true },
  awaiting_payment: { variant: "warning", dot: true },
  rejected: { variant: "danger", dot: true },
  converted_to_job: { variant: "success", dot: true },
};

/** Active pipeline: quotes actively moving through the sales funnel (bids out / with customer / awaiting deposit). */
const PIPELINE_STATUS_IN = ["bidding", "awaiting_customer", "awaiting_payment"] as const;

async function listQuotesForPage(params: ListParams): Promise<ListResult<Quote>> {
  const { status, ...rest } = params;
  if (status === "pipeline") {
    return listQuotes({
      ...rest,
      status: undefined,
      statusIn: [...PIPELINE_STATUS_IN],
    });
  }
  if (status === "closed") {
    return listQuotes({
      ...rest,
      status: undefined,
      statusIn: ["converted_to_job", "rejected"],
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
  awaiting_payment: 4,
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

const QUOTE_SORT_DEPOSIT: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "deposit_required", direction: "asc" },
  { label: "High to low", sortKey: "deposit_required", direction: "desc" },
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

const QUOTE_SORT_BIDDING_SLA: ColumnSortOption[] = [
  { label: "Soonest SLA due first", sortKey: "bidding_sla", direction: "asc" },
  { label: "Most time left first", sortKey: "bidding_sla", direction: "desc" },
  ...QUOTE_SORT_CREATED,
];

const STAGE_META: { id: string; label: string; short: string; icon: typeof ClipboardList }[] = [
  { id: "draft", label: "New", short: "New", icon: ClipboardList },
  { id: "in_survey", label: "Survey", short: "Survey", icon: MapPin },
  { id: "bidding", label: "Bidding", short: "Bids", icon: Gavel },
  { id: "awaiting_customer", label: "Approval", short: "Approval", icon: UserRound },
  { id: "awaiting_payment", label: "Payment", short: "Payment", icon: CheckCircle2 },
];

function QuoteStageColumn({ status }: { status: string }) {
  const stepMap: Record<string, number> = {
    draft: 0, in_survey: 1, bidding: 2, awaiting_customer: 3, awaiting_payment: 4, rejected: -1, converted_to_job: 5,
  };
  const current = stepMap[status] ?? 0;
  if (current === -1) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="danger" size="sm" className="w-fit">Lost</Badge>
        <span className="text-[10px] text-text-tertiary">Rejected</span>
      </div>
    );
  }
  if (current === 5) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="success" size="sm" className="w-fit">Win</Badge>
        <span className="text-[10px] text-text-tertiary">Converted to job</span>
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

function QuoteBiddingSlaCell({
  quote,
  slaMs,
  slaHoursLabel,
}: {
  quote: BiddingSlaAnchorQuote;
  slaMs: number;
  slaHoursLabel: string;
}) {
  const usesStoredAnchor = biddingQuoteSlaUsesStoredAnchor(quote);
  const deadline = useMemo(
    () => quoteBiddingSlaDeadlineMsFromQuote(quote, slaMs),
    [quote.status, quote.bidding_started_at, quote.updated_at, quote.created_at, slaMs],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline == null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (deadline == null) {
    return (
      <span
        className="text-[11px] text-text-tertiary"
        title="No date fields available to anchor this SLA — re-save the quote or run DB backfill for bidding_started_at."
      >
        —
      </span>
    );
  }

  const approxHint = usesStoredAnchor
    ? ""
    : " Approximate: using last saved activity because bidding_started_at was not recorded for this row.";
  const remaining = deadline - now;
  if (remaining > 0) {
    const amberUnder = 0.25 * slaMs;
    const redUnder = 0.1 * slaMs;
    let mainClass = "text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400";
    if (remaining < redUnder) mainClass = "text-xs font-bold tabular-nums text-red-600 dark:text-red-400";
    else if (remaining < amberUnder) mainClass = "text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400";
    return (
      <div
        className="flex flex-col gap-0.5 tabular-nums leading-tight"
        title={`${slaHoursLabel} target · due ${new Date(deadline).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })} local · updates every minute.${approxHint}`}
      >
        <span className={mainClass}>{formatSlaRemainCountdownMinutes(remaining)}</span>
        <span className="text-[10px] text-text-tertiary">remaining{usesStoredAnchor ? "" : " · est."}</span>
      </div>
    );
  }
  const overdue = now - deadline;
  return (
    <div
      className="flex flex-col gap-0.5 tabular-nums leading-tight"
      title={`Past the ${slaHoursLabel} Bidding SLA — send to customer as soon as possible.${approxHint}`}
    >
      <Badge variant="danger" size="sm" className="w-fit px-1.5 py-0 text-[10px]">
        Overdue
      </Badge>
      <span className="text-[10px] text-text-tertiary">{formatSlaOverdueMinutes(overdue)} late{usesStoredAnchor ? "" : " · est."}</span>
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
    case "awaiting_payment":
      return {
        headline: "Awaiting customer payment",
        detail: "Customer accepted the quote. Job will be created once the deposit is paid via Stripe, or convert manually if paid elsewhere.",
      };
    case "rejected":
      return { headline: "Quote closed", detail: "You can reactivate from New or leave as lost." };
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
    initialStatus: "draft",
    initialData,
  });

  /** Latest list rows for deep-link / effects — avoids re-running quoteId logic on every `data` reference change. */
  const quotesListDataRef = useRef(data);
  quotesListDataRef.current = data;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [kpiSummary, setKpiSummary] = useState({
    /** Approval + Payment: soma `total_value` de todos quotes nesses statuses (ativo — alinha com badges das abas). */
    totalSentToCustomerValue: 0,
    awaitingCustomerValue: 0,
    conversionPct: 0,
    convertedCount: 0,
    totalCount: 0,
  });
  const [viewMode, setViewMode] = useState("list");
  const [biddingSlaRollup, setBiddingSlaRollup] = useState<BiddingSlaRollup | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterQuoteType, setFilterQuoteType] = useState<"all" | "internal" | "partner">("all");
  const buFilter = useBuFilter();
  const { biddingSlaMs, biddingSlaHours } = useFrontendSetup();
  const biddingSlaHoursLabelPretty = formatBiddingSlaHoursLabel(biddingSlaHours);
  /** Accounts in the selected BU — used with `property_id` when a quote has no `client_id`. */
  const [buAccountIds, setBuAccountIds] = useState<Set<string>>(new Set());
  /** `account_properties.id` → `account_id` for quotes without a client (BU filter). */
  const [propertyIdToAccountId, setPropertyIdToAccountId] = useState<Record<string, string>>({});
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);
  /** When true, the Create Job flow will record the deposit as a received client payment right after job creation. */
  const [convertMarkDepositPaid, setConvertMarkDepositPaid] = useState(false);
  /** Deposit £ to record when creating the job — set after "Mark as paid" confirmation (overrides quote.deposit_required if set). */
  const [convertRecordedDepositAmount, setConvertRecordedDepositAmount] = useState<number | null>(null);
  /** Awaiting-payment: intermediary step — confirm/adjust deposit before opening Create Job modal. */
  const [depositConfirmQuote, setDepositConfirmQuote] = useState<Quote | null>(null);
  const [depositConfirmAmountStr, setDepositConfirmAmountStr] = useState("");
  /** Approval → Approved: unpaid deposit intermediary choice before job or Payment. */
  const [approveDepositGateQuote, setApproveDepositGateQuote] = useState<Quote | null>(null);
  /** Opens Create Job with deposit waiver section pre-expanded (from approve gate). */
  const [createJobInitialWithoutDeposit, setCreateJobInitialWithoutDeposit] = useState(false);
  const [drawerPendingTab, setDrawerPendingTab] = useState<"overview" | "bids" | null>(null);
  const consumeDrawerPendingTab = useCallback(() => setDrawerPendingTab(null), []);
  const consumeDrawerPendingOpenInvite = useCallback(() => setDrawerPendingOpenInviteQuoteId(null), []);
  const createQuoteIntentRef = useRef<"full" | "routing" | "routing_invite">("full");
  const [createFormVariant, setCreateFormVariant] = useState<"full" | "routing_minimal">("full");
  /** Routing modal: quote = essentials in modal, trade in drawer; bidding = trade in modal then auto-open Invite Partners. */
  const [routingCreateEntry, setRoutingCreateEntry] = useState<"quote" | "bidding">("quote");
  const [drawerPendingOpenInviteQuoteId, setDrawerPendingOpenInviteQuoteId] = useState<string | null>(null);
  const [newQuoteMenuOpen, setNewQuoteMenuOpen] = useState(false);
  const newQuoteMenuRef = useRef<HTMLDivElement>(null);
  const kpiRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!buFilter.selectedBuId) {
      setBuAccountIds(new Set());
      return;
    }
    let cancelled = false;
    getAccountIdsForBu(buFilter.selectedBuId).then((ids) => {
      if (!cancelled) setBuAccountIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [buFilter.selectedBuId]);

  useEffect(() => {
    const ids = [...new Set(data.map((q) => q.property_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setPropertyIdToAccountId({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: rows, error } = await supabase
          .from("account_properties")
          .select("id, account_id")
          .in("id", ids)
          .is("deleted_at", null);
        if (error || cancelled) return;
        const next: Record<string, string> = {};
        for (const row of rows ?? []) {
          const r = row as { id: string; account_id: string };
          if (r.id && r.account_id) next[r.id] = r.account_id;
        }
        if (!cancelled) setPropertyIdToAccountId(next);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

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
      if (newQuoteMenuRef.current && !newQuoteMenuRef.current.contains(t)) setNewQuoteMenuOpen(false);
    }
    if (filterOpen || newQuoteMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen, newQuoteMenuOpen]);

  const filteredQuotes = useMemo(() => {
    return data.filter((q) => {
      if (status === "pipeline") {
        if (!PIPELINE_STATUS_IN.includes(q.status as (typeof PIPELINE_STATUS_IN)[number])) return false;
      } else if (status === "closed") {
        if (q.status !== "converted_to_job" && q.status !== "rejected") return false;
      } else if (q.status !== status) {
        return false;
      }
      if (filterQuoteType !== "all" && (q.quote_type ?? "internal") !== filterQuoteType) return false;
      if (buFilter.selectedBuId) {
        if (!buFilter.clientIdsInBu) return true;
        const clientInBu = Boolean(q.client_id && buFilter.clientIdsInBu.has(q.client_id));
        const pid = q.property_id?.trim();
        const accFromProperty = pid ? propertyIdToAccountId[pid] : undefined;
        const propertyInBu = Boolean(accFromProperty && buAccountIds.has(accFromProperty));
        if (!clientInBu && !propertyInBu) return false;
      }
      return true;
    });
  }, [
    data,
    status,
    filterQuoteType,
    buFilter.selectedBuId,
    buFilter.clientIdsInBu,
    propertyIdToAccountId,
    buAccountIds,
  ]);

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
    if (!listSortKey) return;
    const allowedSets: Partial<Record<string, Set<string>>> = {
      draft: new Set(["reference", "client_name", "service_type", "__created_at"]),
      bidding: new Set(["reference", "client_name", "service_type", "avg_bid", "bidding_sla", "__created_at"]),
      awaiting_customer: new Set([
        "reference",
        "client_name",
        "service_type",
        "quote_type",
        "status",
        "total_value",
        "deposit_required",
        "margin_percent",
        "__created_at",
      ]),
      awaiting_payment: new Set([
        "reference",
        "client_name",
        "service_type",
        "quote_type",
        "status",
        "total_value",
        "deposit_required",
        "margin_percent",
        "__created_at",
      ]),
      closed: new Set(["total_value", "__created_at"]),
    };
    const allowed = allowedSets[status];
    if (allowed && !allowed.has(listSortKey)) setListSortKey(null);
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
        case "bidding_sla": {
          const da = quoteBiddingSlaDeadlineMsFromQuote(a, biddingSlaMs) ?? Number.POSITIVE_INFINITY;
          const db = quoteBiddingSlaDeadlineMsFromQuote(b, biddingSlaMs) ?? Number.POSITIVE_INFINITY;
          return mul * (da - db);
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
  }, [filteredQuotes, listSortKey, listSortDir, avgBidByQuoteId, biddingSlaMs]);

  const handleQuoteListSortChange = useCallback((key: string | null, direction: "asc" | "desc") => {
    setListSortKey(key);
    setListSortDir(direction);
  }, []);

  const quoteKanbanColumns = useMemo(() => {
    if (status === "closed") {
      return [
        {
          id: "converted_to_job",
          title: "Win",
          color: "bg-emerald-500",
          items: filteredQuotes.filter((q) => q.status === "converted_to_job"),
        },
        {
          id: "rejected",
          title: "Lost",
          color: "bg-slate-500",
          items: filteredQuotes.filter((q) => q.status === "rejected"),
        },
      ];
    }
    const ids = ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"];
    return ids.map((id) => ({
      id,
      title: statusLabels[id] ?? id,
      color: id === "awaiting_payment" ? "bg-amber-500" : id === "awaiting_customer" ? "bg-blue-500" : "bg-primary",
      items: filteredQuotes.filter((q) => q.status === id),
    }));
  }, [filteredQuotes, status]);

  const KPI_QUOTE_PAGE = 1000;

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("quotes", [...QUOTE_STATUSES]);
      setStatusCounts(counts);
    } catch { /* cosmetic */ }
  }, []);

  /** Headline currency/conversion KPIs — same universe as tab badges (`getStatusCounts`): all non-deleted quotes, chunked to beat the default row cap. */
  const reloadQuoteKpis = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const rows: Array<{ status: string; total_value?: number | null }> = [];
      for (let offset = 0; ; offset += KPI_QUOTE_PAGE) {
        const { data, error } = await supabase
          .from("quotes")
          .select("status,total_value")
          .is("deleted_at", null)
          .range(offset, offset + KPI_QUOTE_PAGE - 1);
        if (error) throw error;
        const chunk = (data ?? []) as typeof rows;
        rows.push(...chunk);
        if (chunk.length < KPI_QUOTE_PAGE) break;
      }
      const sumBy = (status: string) => rows
        .filter((r) => r.status === status)
        .reduce((s, r) => s + (Number(r.total_value) || 0), 0);
      const totalSentToCustomerValue = rows
        .filter((r) => r.status === "awaiting_customer" || r.status === "awaiting_payment")
        .reduce((s, r) => s + (Number(r.total_value) || 0), 0);
      const awaitingCustomerValue = sumBy("awaiting_customer");
      const convertedCount = rows.filter((r) => r.status === "converted_to_job").length;
      const totalCount = rows.length;
      const conversionPct = totalCount > 0 ? Math.round((convertedCount / totalCount) * 1000) / 10 : 0;
      setKpiSummary({
        totalSentToCustomerValue,
        awaitingCustomerValue,
        conversionPct,
        convertedCount,
        totalCount,
      });
    } catch {
      setKpiSummary({
        totalSentToCustomerValue: 0,
        awaitingCustomerValue: 0,
        conversionPct: 0,
        convertedCount: 0,
        totalCount: 0,
      });
    }
  }, []);

  /** Company-wide Bidding SLA rollup for the SLA overdue KPI (same logic as the Bidding tab snapshot). */
  const loadBiddingSlaRollup = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data: biddingRows, error } = await supabase
        .from("quotes")
        .select("bidding_started_at, updated_at, created_at, status")
        .eq("status", "bidding")
        .is("deleted_at", null);
      if (error) {
        setBiddingSlaRollup(null);
        return;
      }
      setBiddingSlaRollup(computeBiddingSlaRollup(biddingRows ?? [], Date.now(), biddingSlaMs));
    } catch {
      setBiddingSlaRollup(null);
    }
  }, [biddingSlaMs]);

  useEffect(() => {
    void loadBiddingSlaRollup();
    const id = window.setInterval(() => {
      void loadBiddingSlaRollup();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [loadBiddingSlaRollup, statusCounts.bidding]);

  useEffect(() => {
    void loadCounts();
    void reloadQuoteKpis();
  }, [loadCounts, reloadQuoteKpis]);

  useEffect(() => () => {
    if (kpiRefreshTimerRef.current) clearTimeout(kpiRefreshTimerRef.current);
  }, []);

  /** Background list refresh — avoids full-table loading skeleton on every action (enterprise UX). */
  const refreshWithKpis = useCallback((delayMs = 180) => {
    refreshSilent();
    if (kpiRefreshTimerRef.current) clearTimeout(kpiRefreshTimerRef.current);
    kpiRefreshTimerRef.current = setTimeout(() => {
      void loadCounts();
      void reloadQuoteKpis();
      void loadBiddingSlaRollup();
    }, delayMs);
  }, [refreshSilent, loadCounts, reloadQuoteKpis, loadBiddingSlaRollup]);

  /** Underline + count badges — funnel: New → Bidding → Approval → Payment → Closed (Win + Lost). */
  const quoteStageTabs = useMemo(() => {
    const closed =
      (statusCounts.converted_to_job ?? 0) + (statusCounts.rejected ?? 0);
    return [
      { id: "draft", label: "New", count: statusCounts.draft ?? 0 },
      { id: "bidding", label: "Bidding", count: statusCounts.bidding ?? 0 },
      { id: "awaiting_customer", label: "Approval", count: statusCounts.awaiting_customer ?? 0 },
      { id: "awaiting_payment", label: "Payment", count: statusCounts.awaiting_payment ?? 0 },
      { id: "closed", label: "Closed", count: closed },
    ];
  }, [statusCounts]);

  /** Share of all non-deleted quotes that became jobs (`converted_to_job`). */
  const quoteToJobConversion = useMemo(
    () => ({ pct: kpiSummary.conversionPct, converted: kpiSummary.convertedCount, total: kpiSummary.totalCount }),
    [kpiSummary],
  );

  const handleCreate = useCallback(
    async (
      formData: Partial<Quote>,
      options?: { manualLineItems?: ProposalLineRow[]; oneShotBiddingPartnerIds?: string[]; sendToCustomer?: boolean },
    ): Promise<boolean> => {
      const perfStart = performance.now();
      try {
        const dupQ = await findDuplicateQuotes({
          clientEmail: formData.client_email ?? "",
          title: formData.title ?? "",
          propertyAddress: formData.property_address,
        });
        if (!(await confirmDespiteDuplicates(formatQuoteDuplicateLines(dupQ)))) return false;

        const pid =
          formData.property_id && isUuid(String(formData.property_id).trim())
            ? String(formData.property_id).trim()
            : undefined;
        let resolvedName = formData.client_name ?? "";
        let resolvedEmail = formData.client_email ?? "";
        if (formData.client_id?.trim()) {
          const b = await resolveNominalBillingParty(getSupabase(), {
            clientId: formData.client_id.trim(),
            fallbackName: resolvedName,
            fallbackEmail: resolvedEmail,
          });
          resolvedName = b.displayName;
          resolvedEmail = b.documentEmail ?? resolvedEmail;
        }
        const intent = createQuoteIntentRef.current;
        const oneShotPartnerIds = options?.oneShotBiddingPartnerIds?.filter(Boolean) ?? [];
        const isOneShotBidding = oneShotPartnerIds.length > 0 && intent === "routing_invite";
        const routingPhaseDraft = (intent === "routing" || intent === "routing_invite") && !isOneShotBidding;
        const wantsSendCustomer =
          Boolean(options?.sendToCustomer) &&
          (formData.quote_type ?? "internal") === "internal" &&
          !isOneShotBidding;

        if (wantsSendCustomer && !(options?.manualLineItems?.length)) {
          toast.error("Add at least one line item before sending.");
          return false;
        }

        if (wantsSendCustomer) {
          let emailCandidate = resolvedEmail.trim();
          if (!emailCandidate) {
            emailCandidate =
              (
                await getQuoteProposalRecipientEmail(getSupabase(), {
                  clientId: formData.client_id?.trim() || null,
                  propertyId: pid ?? null,
                  accountId: formData.source_account_id?.trim() || null,
                  fallbackName: resolvedName,
                  fallbackEmail: resolvedEmail || formData.client_email,
                })
              ).trim();
          }
          if (!emailCandidate) {
            toast.error(
              'No customer inbox found — pick a contact with email, add a Billing email on the account, or set Billing on Accounts to route quotes to “This account” with a Finance email.',
            );
            return false;
          }
          resolvedEmail = emailCandidate;
        }

        const result = await createQuote({
          title: formData.title ?? "",
          client_id: formData.client_id,
          client_address_id: formData.client_address_id,
          client_name: resolvedName,
          client_email: resolvedEmail,
          ...(formData.source_account_id?.trim() ? { source_account_id: formData.source_account_id.trim() } : {}),
          ...(pid ? { property_id: pid } : {}),
          catalog_service_id: formData.catalog_service_id && isUuid(String(formData.catalog_service_id).trim())
            ? String(formData.catalog_service_id).trim()
            : null,
          status: isOneShotBidding ? "bidding" : (formData.status ?? "draft"),
          total_value: isOneShotBidding ? 0 : (formData.total_value ?? 0),
          partner_quotes_count: isOneShotBidding ? oneShotPartnerIds.length : (formData.partner_quotes_count ?? 0),
          cost: isOneShotBidding ? 0 : (formData.cost ?? 0),
          sell_price: isOneShotBidding ? 0 : (formData.sell_price ?? formData.total_value ?? 0),
          margin_percent: isOneShotBidding ? 0 : (formData.margin_percent ?? 0),
          quote_type: isOneShotBidding ? "partner" : (formData.quote_type ?? "internal"),
          deposit_percent: formData.deposit_percent ?? 50,
          deposit_required: formData.deposit_required ?? 0,
          customer_accepted: false,
          customer_deposit_paid: false,
          draft_route_completed: routingPhaseDraft ? false : true,
          partner_id: formData.partner_id,
          partner_name: formData.partner_name,
          property_address: formData.property_address,
          scope: formData.scope,
          start_date_option_1: formData.start_date_option_1,
          start_date_option_2: formData.start_date_option_2,
          partner_cost: isOneShotBidding ? 0 : (formData.partner_cost ?? formData.cost ?? 0),
          ...(formData.service_type?.trim() ? { service_type: formData.service_type.trim() } : {}),
          ...(formData.images?.length ? { images: formData.images } : {}),
          email_attach_request_photos: formData.email_attach_request_photos ?? false,
          owner_id: profile?.id,
          owner_name: profile?.full_name,
          duration_value: formData.duration_value ?? null,
          duration_unit: (formData.duration_unit as QuoteDurationUnit | null | undefined) ?? null,
          engagement_kind: (formData.engagement_kind as QuoteEngagementKind | undefined) ?? "one_off",
        });

        const manualLines = options?.manualLineItems;
        if (!isOneShotBidding && formData.quote_type === "internal" && manualLines?.length) {
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

        // Close create modal immediately so it never stacks over the drawer; drawer stays hidden while createOpen.
        setCreateOpen(false);
        createQuoteIntentRef.current = "full";
        setCreateFormVariant("full");
        setRoutingCreateEntry("quote");

        if (isOneShotBidding) {
          const patched = result;
          const inviteBody =
            `${patched.title} — ${patched.property_address ?? patched.client_name ?? ""}`.trim() || patched.reference;
          try {
            const res = await fetch("/api/push/notify-partner", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                partnerIds: oneShotPartnerIds,
                title: "New quote invitation",
                body: inviteBody,
                data: {
                  type: "quote_invite",
                  quoteId: patched.id,
                  photoUrls: patched.images ?? [],
                },
              }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error((body && typeof body.error === "string" && body.error) || "Failed to send push invite");
            }
            const pushBody = (await res.json().catch(() => ({}))) as {
              sent?: number;
              errors?: number;
              tokensFound?: number;
            };
            const sent = Number(pushBody?.sent ?? 0);
            const tokensFound = Number(pushBody?.tokensFound ?? 0);
            if (sent <= 0) {
              throw new Error(
                tokensFound <= 0
                  ? "No valid push token found for selected partner(s). Ask them to open the app and allow notifications."
                  : "Push request was accepted but not delivered (0 sent).",
              );
            }
            const trade = bidPayloadTrimmedString(patched.service_type as unknown);
            if (trade) {
              void fetch("/api/push/notify-partner", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  trades: [trade],
                  title: "New Job Invitation",
                  body: `${patched.title} — ${patched.property_address ?? patched.client_name ?? ""}`,
                  data: { type: "quote_invite", quoteId: patched.id },
                }),
              }).catch(() => {});
            }
            toast.success(`${patched.reference} — bid request sent to ${sent} partner(s)`);
            setSelectedQuote(patched);
            setDrawerPendingTab("bids");
            setStatus("bidding");
          } catch (inviteErr) {
            console.error(inviteErr);
            toast.error(
              getErrorMessage(
                inviteErr,
                "Quote was created in bidding but notifications failed — open the quote and use Invite partners.",
              ),
            );
            setSelectedQuote(patched);
            setDrawerPendingTab("bids");
            setStatus("bidding");
          }
        } else if (wantsSendCustomer && manualLines?.length) {
          const items = manualLines.map((li, idx) => {
            const qty = Number(li.quantity) || 1;
            const unit = Number(li.unitPrice) || 0;
            return {
              description: lineItemDescriptionForCustomer(li, idx),
              quantity: qty,
              unitPrice: unit,
              total: qty * unit,
            };
          });
          try {
            const resp = await fetch("/api/quotes/send-pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                quoteId: result.id,
                recipientEmail: resolvedEmail.trim(),
                recipientName: resolvedName,
                items,
                scope: bidPayloadTrimmedString(formData.scope as unknown) || undefined,
                attachRequestPhotos: formData.email_attach_request_photos ?? false,
              }),
            });
            const data = (await resp.json()) as { emailSent?: boolean; reason?: string; error?: string };
            if (!resp.ok) {
              throw new Error(typeof data.error === "string" ? data.error : "Failed to send quote email");
            }
            if (!data.emailSent) {
              toast.warning(data.reason ?? "Quote saved — email was not sent. Open the quote to resend.");
            } else {
              toast.success(
                `Quote ${result.reference} — PDF sent to ${resolvedEmail.trim()} (routing follows the account Billing setting).`,
              );
            }
          } catch (sendErr) {
            toast.error(getErrorMessage(sendErr, "Quote created but sending to the customer failed — open it to retry."));
          }
          const updated = await getQuote(result.id);
          setDrawerPendingTab(null);
          setDrawerPendingOpenInviteQuoteId(null);
          setSelectedQuote(updated ?? result);
          if ((updated ?? result).status === "awaiting_customer") {
            setStatus("awaiting_customer");
          }
        } else {
          toast.success("Quote created successfully");
          if ((formData.quote_type ?? "internal") === "internal") {
            setDrawerPendingTab(null);
            setDrawerPendingOpenInviteQuoteId(null);
            void getQuote(result.id).then((fresh) => setSelectedQuote(fresh ?? result));
            if (intent === "routing_invite") {
              setDrawerPendingOpenInviteQuoteId(result.id);
            }
          }
        }

        refreshWithKpis();
        trackUiPerf("quotes.create_quote_ms", performance.now() - perfStart, {
          quoteType: isOneShotBidding ? "partner" : (formData.quote_type ?? "internal"),
          lineItems: manualLines?.length ?? 0,
          sendToCustomer: wantsSendCustomer,
        });
        return true;
      } catch (err) {
        console.error(err);
        toast.error(getErrorMessage(err, "Failed to create quote"));
        return false;
      }
    },
    [refreshWithKpis, profile?.id, profile?.full_name, confirmDespiteDuplicates, setStatus],
  );

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase
        .from("quotes")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("quote", Array.from(selectedIds), "status_changed", "status", "rejected", profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} quotes updated`);
      setSelectedIds(new Set());
      refreshWithKpis();
    } catch {
      toast.error("Failed to update quotes");
    }
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
    async (formData: {
      title: string;
      client_id?: string;
      client_address_id?: string;
      client_name: string;
      property_address: string;
      partner_id?: string;
      partner_name?: string;
      client_price: number;
      partner_cost: number;
      materials_cost: number;
      scheduled_date?: string;
      scheduled_start_at?: string;
      scheduled_end_at?: string;
      scheduled_finish_date?: string | null;
      expected_finish_at?: string | null;
      job_kind?: JobKind;
      series?: JobScheduleV2SeriesPayload;
      createWithoutDeposit?: boolean;
      depositOverrideReason?: string;
      job_type?: "fixed" | "hourly";
      scope?: string;
    }) => {
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
      const expected_finish_at =
        formData.expected_finish_at == null || formData.expected_finish_at === ""
          ? null
          : isValidIsoDateTime(formData.expected_finish_at)
            ? formData.expected_finish_at
            : null;
      const job_kind: JobKind = formData.job_kind ?? "one_off";
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
        const baseQuoteDeposit = quoteToConvert.deposit_required ?? 0;
        const scheduledDeposit = noDeposit
          ? 0
          : (convertRecordedDepositAmount != null ? convertRecordedDepositAmount : baseQuoteDeposit);
        const scheduledFinal = Math.max(0, formData.client_price - scheduledDeposit);
        const shouldRecordDepositPaid = convertMarkDepositPaid && !noDeposit && scheduledDeposit > 0.02;
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

        const baseJobRow = {
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
          expected_finish_at,
          job_kind,
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
          external_source: quoteToConvert.external_source ?? undefined,
          external_ref: quoteToConvert.external_ref ?? undefined,
          ...(quoteToConvert.zendesk_side_conversation_id
            ? { zendesk_side_conversation_id: quoteToConvert.zendesk_side_conversation_id }
            : {}),
        } as Parameters<typeof createJob>[0];

        const job = formData.series
          ? (await createJobOrSeries({
              anchorJobRow: baseJobRow,
              series: {
                rule: formData.series.rule,
                start_time: formData.series.start_time,
                end_time: formData.series.end_time,
                start_date: formData.series.start_date,
                end_date: formData.series.end_date ?? null,
                max_occurrences: formData.series.max_occurrences ?? null,
              },
            })).jobs[0]!
          : await createJob(baseJobRow);

        /** Draft invoice is created inside `createJob` (unified for quote + modal paths). */
        const auditMetadata: Record<string, unknown> = { from_quote: quoteToConvert.reference };
        if (noDeposit && (quoteToConvert.deposit_required ?? 0) > 0.02) {
          auditMetadata.deposit_override = true;
          auditMetadata.deposit_override_reason = formData.depositOverrideReason ?? "";
          auditMetadata.deposit_waived_amount = quoteToConvert.deposit_required ?? 0;
        }

        // Fire-and-forget: quote status flip + audit log + deposit payment record.
        // Each is independent of the redirect — cuts ~300-500ms off perceived latency.
        // Errors are surfaced in console but don't block the user navigating to the job.
        void updateQuote(quoteToConvert.id, { status: "converted_to_job" })
          .catch((e) => console.error("[convert-to-job] updateQuote failed:", e));
        void logAudit({
          entityType: "job", entityId: job.id, entityRef: job.reference, action: "created",
          metadata: auditMetadata, userId: profile?.id, userName: profile?.full_name,
        }).catch((e) => console.error("[convert-to-job] logAudit failed:", e));

        if (shouldRecordDepositPaid) {
          void createJobPayment({
            job_id: job.id,
            type: "customer_deposit",
            amount: scheduledDeposit,
            payment_date: new Date().toISOString().slice(0, 10),
            payment_method: "bank_transfer",
            note: `Deposit marked as paid from quote ${quoteToConvert.reference}`,
            created_by: profile?.id,
          }).catch((err) => {
            console.error("Failed to record deposit payment on new job:", err);
            toast.error("Job created, but failed to record the deposit as paid. You can add it manually from the job.");
          });
        }

        // Partner is assigned at creation (not via UPDATE), so the
        // standard "assignedFresh" path in job-detail-client never fires.
        // Trigger push + Zendesk side conversation manually here.
        if (hasPartner && job.partner_id) {
          notifyAssignedPartnerAboutJob({
            partnerId: job.partner_id,
            job,
            kind: "job_assigned",
          });
          void notifyPartnerJobChange({
            jobId: job.id,
            jobReference: job.reference,
            kind: "assigned",
            skipPush: true, // notifyAssignedPartnerAboutJob already pushed
          });
        }

        setQuoteToConvert(null);
        setConvertMarkDepositPaid(false);
        setConvertRecordedDepositAmount(null);
        setSelectedQuote(null);
        toast.success(shouldRecordDepositPaid ? `Job ${job.reference} created & deposit recorded as paid` : `Job ${job.reference} created`);
        // Defer KPI refresh so the navigation isn't queued behind the SWR refetch.
        setTimeout(() => refreshWithKpis(), 100);
        router.push(`/jobs?jobId=${job.id}`);
        trackUiPerf("quotes.convert_to_job_ms", performance.now() - perfStart, { hasPartner: hasPartner });
      } catch (err) {
        toast.error(getErrorMessage(err, "Failed to create job"));
      }
    },
    [quoteToConvert, refreshWithKpis, profile?.id, profile?.full_name, router, confirmDespiteDuplicates, convertMarkDepositPaid, convertRecordedDepositAmount]
  );

  const handleStatusChange = useCallback(
    async (quote: Quote, newStatus: string, opts?: { successToast?: string }): Promise<boolean> => {
      if (newStatus === "create_job") {
        setConvertRecordedDepositAmount(null);
        setConvertMarkDepositPaid(false);
        setCreateJobInitialWithoutDeposit(false);
        setQuoteToConvert(quote);
        return true;
      }
      if (newStatus === "mark_as_paid") {
        setDepositConfirmQuote(quote);
        const d = Math.max(0, Number(quote.deposit_required ?? 0));
        setDepositConfirmAmountStr((Math.round(d * 100) / 100).toFixed(2));
        return true;
      }
      if (newStatus === "approve_quote") {
        if (quote.status !== "awaiting_customer") return false;
        if (!quoteRequiresCustomerDeposit(quote)) {
          setConvertRecordedDepositAmount(null);
          setConvertMarkDepositPaid(false);
          setCreateJobInitialWithoutDeposit(false);
          setQuoteToConvert(quote);
          return true;
        }
        if (quote.customer_deposit_paid) {
          setConvertRecordedDepositAmount(null);
          setConvertMarkDepositPaid(true);
          setCreateJobInitialWithoutDeposit(false);
          setQuoteToConvert(quote);
          return true;
        }
        return false;
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

  /** Approval tab — **Approved**: job modal, deposit gate, or awaiting payment (from gate). */
  const approveGateMoveToAwaitingPayment = useCallback(
    async (q: Quote) => {
      const check = canAdvanceQuote(q, "awaiting_payment");
      if (!check.ok) {
        toast.error(check.message ?? "Complete the current step before advancing.");
        return;
      }
      try {
        const perfStart = performance.now();
        const updated = await updateQuote(q.id, { status: "awaiting_payment" });
        await logAudit({
          entityType: "quote",
          entityId: q.id,
          entityRef: q.reference,
          action: "status_changed",
          fieldName: "status",
          oldValue: q.status,
          newValue: "awaiting_payment",
          metadata: { operator_approved: true, awaiting_deposit: true },
          userId: profile?.id,
          userName: profile?.full_name,
        });
        setSelectedQuote(updated);
        toast.success("Approved — quote is Awaiting payment until the deposit is received.");
        refreshWithKpis();
        trackUiPerf("quotes.status_change_ms", performance.now() - perfStart, {
          from: q.status,
          to: "awaiting_payment",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update quote";
        toast.error(message);
        console.error("Quote status update failed:", err);
      }
    },
    [refreshWithKpis, profile?.id, profile?.full_name],
  );

  const handleApproveQuoteRequest = useCallback(
    (quoteRow: Quote) => {
      if (quoteRow.status !== "awaiting_customer") return;
      if (!quoteRequiresCustomerDeposit(quoteRow) || quoteRow.customer_deposit_paid) {
        void handleStatusChange(quoteRow, "approve_quote");
        return;
      }
      setApproveDepositGateQuote(quoteRow);
    },
    [handleStatusChange],
  );

  const proceedDepositConfirmToJob = useCallback(() => {
    const q = depositConfirmQuote;
    if (!q) return;
    const totalVal = Number(q.total_value ?? 0);
    let amt = Number(depositConfirmAmountStr);
    if (!Number.isFinite(amt)) {
      toast.error("Enter a valid deposit amount.");
      return;
    }
    amt = Math.round(Math.max(0, amt) * 100) / 100;
    if (totalVal > 0 && amt > totalVal) {
      amt = Math.round(totalVal * 100) / 100;
    }
    setConvertRecordedDepositAmount(amt);
    setConvertMarkDepositPaid(true);
    setQuoteToConvert(q);
    setDepositConfirmQuote(null);
  }, [depositConfirmQuote, depositConfirmAmountStr]);

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
        const res =
          status === "closed"
            ? await listQuotes({
                page: p,
                pageSize,
                search: search.trim() ? search : undefined,
                status: undefined,
                statusIn: ["converted_to_job", "rejected"],
              })
            : await listQuotes({
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

  const columns: Column<Quote>[] = useMemo(() => {
    /** Quote · Accounts · Type of work — sem Type (Manual/Partner) nem Stage dinâmico. */
    const leadCore: Column<Quote>[] = [
      {
        key: "reference",
        label: "Quote",
        width: "200px",
        sortable: true,
        sortOptions: QUOTE_SORT_REFERENCE,
        render: (item) => (
          <div>
            <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
          </div>
        ),
      },
      {
        key: "client_name",
        label: "Accounts",
        minWidth: "8.5rem",
        sortable: true,
        sortOptions: quoteSortTextCol("client_name", "Accounts"),
        render: (item) => {
          const accountLabel = item.source_account_name?.trim() || item.client_name?.trim() || "—";
          const postcode = quoteListSubtitlePostcode(item);
          return (
            <div className="flex items-start gap-2 min-w-0">
              <Avatar
                name={accountLabel}
                size="sm"
                className="shrink-0 mt-0.5"
                src={item.source_account_logo_url?.trim() || undefined}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{accountLabel}</p>
                <p className="text-[11px] text-text-tertiary truncate max-w-[200px]">{postcode}</p>
              </div>
            </div>
          );
        },
      },
      {
        key: "service_type",
        label: "Type of work",
        minWidth: "10.5rem",
        sortable: true,
        sortOptions: quoteSortTextCol("service_type", "Type of work"),
        render: (item) => {
          if (isDraftRoutingPhase(item)) {
            return (
              <span className="text-sm text-text-tertiary italic truncate block max-w-[180px]" title="Choose type of work in the quote drawer">
                Add in drawer
              </span>
            );
          }
          const type = normalizeTypeOfWork(item.service_type) || normalizeTypeOfWork(item.title) || item.title || "—";
          return <span className="text-sm text-text-secondary truncate block max-w-[180px]">{type}</span>;
        },
      },
    ];

    const quoteTypeColumn: Column<Quote> = {
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
    };

    const stageColumn: Column<Quote> = {
      key: "status",
      label: "Stage",
      minWidth: "8rem",
      sortable: true,
      sortOptions: QUOTE_SORT_STAGE,
      render: (item) => <QuoteStageColumn status={item.status} />,
    };

    const leadApprovalPayment: Column<Quote>[] = [...leadCore, quoteTypeColumn, stageColumn];

    /** Aba New: estado fixo com badge destacado — coluna só no tab draft. */
    const newTabStageColumn: Column<Quote> = {
      key: "new_stage_label",
      label: "Status",
      minWidth: "5rem",
      headerClassName: "normal-case",
      sortable: false,
      render: () => (
        <Badge variant="success" size="sm" dot className="rounded-full font-semibold shadow-none">
          New
        </Badge>
      ),
    };
    const biddingSlaColumn: Column<Quote> = {
      key: "bidding_sla",
      label: "SLA",
      minWidth: "6.75rem",
      headerClassName: "normal-case",
      sortable: true,
      sortOptions: QUOTE_SORT_BIDDING_SLA,
      render: (item) =>
        item.status === "bidding" ? (
          <QuoteBiddingSlaCell quote={item} slaMs={biddingSlaMs} slaHoursLabel={biddingSlaHoursLabelPretty} />
        ) : (
          <span className="text-[11px] text-text-tertiary">—</span>
        ),
    };
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
    const depositColumn: Column<Quote> = {
      key: "deposit_required",
      label: "Deposit",
      minWidth: "5.5rem",
      align: "right" as const,
      sortable: true,
      sortOptions: QUOTE_SORT_DEPOSIT,
      render: (item) => {
        const total = Number(item.total_value) || 0;
        const dep = Math.min(Number(item.deposit_required) || 0, total);
        const pct = Number(item.deposit_percent) || (total > 0 ? Math.round((dep / total) * 100) : 0);
        if (!(dep > 0)) return <span className="text-sm text-text-tertiary">—</span>;
        return (
          <div className="flex flex-col items-end">
            <span className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(dep)}</span>
            {pct > 0 ? (
              <span className="text-[10px] text-text-tertiary tabular-nums">{pct}%</span>
            ) : null}
          </div>
        );
      },
    };
    const finalBalanceColumn: Column<Quote> = {
      key: "final_balance",
      label: "Final balance",
      minWidth: "6rem",
      align: "right" as const,
      /** Column is non-sortable (derived). Override the default `th uppercase` so it matches the mixed case of sortable headers. */
      headerClassName: "normal-case",
      render: (item) => {
        const total = Number(item.total_value) || 0;
        const dep = Math.min(Number(item.deposit_required) || 0, total);
        const remainder = Math.max(0, total - dep);
        const pct = total > 0 ? Math.round((remainder / total) * 100) : 0;
        if (total <= 0) return <span className="text-sm text-text-tertiary">—</span>;
        return (
          <div className="flex flex-col items-end">
            <span className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(remainder)}</span>
            {pct > 0 && pct < 100 ? (
              <span className="text-[10px] text-text-tertiary tabular-nums">{pct}%</span>
            ) : null}
          </div>
        );
      },
    };
    const amountColumn: Column<Quote> = {
      key: "total_value",
      label: "Amount",
      minWidth: "5.5rem",
      align: "right" as const,
      sortable: true,
      sortOptions: QUOTE_SORT_AMOUNT,
      render: (item) => <span className="text-sm font-semibold text-text-primary">{formatCurrency(Number(item.total_value) || 0)}</span>,
    };
    const marginColumn: Column<Quote> = {
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
    };
    const actionsColumnTail: Column<Quote> = {
      key: "actions", label: "", width: "40px",
      render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors" />,
    };
    if (status === "closed") {
      const amountCol: Column<Quote> = {
        key: "total_value",
        label: "Amount",
        minWidth: "6rem",
        align: "right" as const,
        sortable: true,
        sortOptions: QUOTE_SORT_AMOUNT,
        render: (item) => (
          <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(Number(item.total_value) || 0)}</span>
        ),
      };
      const summaryCol: Column<Quote> = {
        key: "closed_summary",
        label: "Quote",
        minWidth: "14rem",
        sortable: false,
        render: (item) => {
          const won = item.status === "converted_to_job";
          const accountLabel = item.source_account_name?.trim() || item.client_name?.trim() || "—";
          return (
            <div className="flex items-start justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{item.reference}</p>
                <p className="text-[11px] text-text-tertiary truncate">{accountLabel}</p>
              </div>
              <Badge variant={won ? "success" : "danger"} size="sm" className="shrink-0">
                {won ? "Win" : "Lost"}
              </Badge>
            </div>
          );
        },
      };
      return [summaryCol, amountCol, actionsColumnTail];
    }
    if (status === "bidding") return [...leadCore, biddingSlaColumn, avgBidColumn, actionsColumnTail];
    if (status === "awaiting_customer" || status === "awaiting_payment") {
      return [...leadApprovalPayment, amountColumn, depositColumn, finalBalanceColumn, marginColumn, actionsColumnTail];
    }
    if (status === "draft") {
      return [...leadCore, newTabStageColumn, actionsColumnTail];
    }
    return [...leadApprovalPayment, amountColumn, marginColumn, actionsColumnTail];
  }, [status, avgBidByQuoteId, biddingSlaMs, biddingSlaHoursLabelPretty]);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Quotes"
          infoTooltip={
            "Headline KPIs reflect all active (non-deleted) quotes — the same pool as the stage tab counts.\n\n" +
            "Total Quoted sums quote value for Approval + Payment (with the customer). Bidding shows the same count as the Bidding tab.\n\n" +
            "SLA overdue counts open Bidding quotes past the configured SLA window (Settings → Setup).\n\n" +
            "Tabs: New → Bidding → Approval → Payment → Closed (Win vs Lost labelled per row)."
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => {
                void loadCounts();
                void reloadQuoteKpis();
                void loadBiddingSlaRollup();
                refreshSilent();
              }}
              title="Reload quotes, KPI aggregates, Bidding SLA snapshot, and tab counts (no full-table loading flash)"
            >
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setExportOpen(true)}>
              Export
            </Button>
            <div className="relative shrink-0" ref={newQuoteMenuRef}>
              <Button
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setNewQuoteMenuOpen((o) => !o)}
                title="Create a new quote"
              >
                <span className="inline-flex items-center gap-1">
                  New quote
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-75" aria-hidden />
                </span>
              </Button>
              {newQuoteMenuOpen ? (
                <div
                  className="absolute top-full right-0 z-50 mt-1 w-[min(calc(100vw-2rem),15.5rem)] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-xs hover:bg-surface-hover"
                    onClick={() => {
                      createQuoteIntentRef.current = "routing";
                      setRoutingCreateEntry("quote");
                      setCreateFormVariant("routing_minimal");
                      setCreateOpen(true);
                      setNewQuoteMenuOpen(false);
                    }}
                  >
                    <span className="font-semibold text-text-primary">New quote</span>
                    <span className="text-[11px] text-text-tertiary">
                      Account, site and scope only — type of work in the drawer before bid or manual.
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-xs hover:bg-surface-hover border-t border-border-light"
                    onClick={() => {
                      createQuoteIntentRef.current = "routing_invite";
                      setRoutingCreateEntry("bidding");
                      setCreateFormVariant("routing_minimal");
                      setCreateOpen(true);
                      setNewQuoteMenuOpen(false);
                    }}
                  >
                    <span className="font-semibold text-text-primary">New bidding</span>
                    <span className="text-[11px] text-text-tertiary">
                      Choose type of work, account, site and scope — then opens partner selection to send bids.
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-xs hover:bg-surface-hover border-t border-border-light"
                    onClick={() => {
                      createQuoteIntentRef.current = "full";
                      setRoutingCreateEntry("quote");
                      setCreateFormVariant("full");
                      setCreateOpen(true);
                      setNewQuoteMenuOpen(false);
                    }}
                  >
                    <span className="font-semibold text-text-primary">Quote manually</span>
                    <span className="text-[11px] text-text-tertiary">Full line items, dates and deposit in one form.</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <KpiCard
            title="Total Quoted"
            value={kpiSummary.totalSentToCustomerValue}
            format="currency"
            icon={BarChart3}
            accent="primary"
            description="Total value of quotes currently with the customer in Approval or Payment (sent for decision or deposit)."
            descriptionAsTooltip
          />
          <KpiCard
            title="Bidding"
            value={statusCounts.bidding ?? 0}
            format="number"
            icon={Gavel}
            accent="amber"
            description="Number of quotes in the Bidding stage (matches the Bidding tab badge)."
            descriptionAsTooltip
          />
          <KpiCard
            title="Approval"
            value={kpiSummary.awaitingCustomerValue}
            format="currency"
            icon={Mail}
            accent="amber"
            description="Quotes sent, waiting for customer response"
            descriptionAsTooltip
          />
          <KpiCard
            title="SLA overdue"
            value={biddingSlaRollup?.breached ?? 0}
            format="number"
            icon={Clock}
            accent="amber"
            description={`Open quotes in Bidding past the ${biddingSlaHoursLabelPretty} SLA window (company-wide). Matches “Past SLA” in the Bidding tab snapshot.`}
            descriptionAsTooltip
          />
          <KpiCard
            title="Conversion Rate"
            value={quoteToJobConversion.pct}
            format="percent"
            icon={BarChart3}
            accent="amber"
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

          {status === "bidding" && biddingSlaRollup != null ? (
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border-light bg-gradient-to-br from-card to-surface-hover/60 px-3 py-3 dark:from-card dark:to-surface-secondary/25">
              <div className="flex flex-wrap items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <p className="text-xs font-semibold text-text-primary">Bidding SLA snapshot · {biddingSlaHoursLabelPretty} target</p>
                <FixfyHintIcon text="Uses the SLA hours from Settings → Setup. Counts every open Bidding quote in the company (not limited by BU filter). Start time prefers the audit trail when available." />
                {buFilter.selectedBuId ? (
                  <span className="text-[10px] text-text-tertiary">BU filter applies to the table only.</span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Open in bidding</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">{biddingSlaRollup.total}</p>
                </div>
                <div title={`Longer than the ${biddingSlaHoursLabelPretty} Bidding SLA window (still in Bidding)`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Past SLA</p>
                  <p
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      biddingSlaRollup.breached > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {biddingSlaRollup.breached}
                  </p>
                </div>
                <div title="Mean wall time since bidding_started_at">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Avg time in bid</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">
                    {formatMinutesAsAge(biddingSlaRollup.avgMinutesInBidding)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Longest idle</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">
                    {formatMinutesAsAge(biddingSlaRollup.maxMinutesInBidding)}
                  </p>
                </div>
              </div>
              {biddingSlaRollup.missingAnchor > 0 ? (
                <p className="text-[11px] text-text-tertiary">
                  {biddingSlaRollup.missingAnchor} quote{biddingSlaRollup.missingAnchor === 1 ? "" : "s"} with no SLA start in DB (column shows — in the list).
                </p>
              ) : null}
            </div>
          ) : null}

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
                  <BulkBtn label="Reject" onClick={handleBulkReject} variant="danger" />
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

      {selectedQuote && !createOpen ? (
      <QuoteDetailDrawer
        key={selectedQuote.id}
        quote={selectedQuote}
        pendingInitialTab={drawerPendingTab}
        onConsumePendingInitialTab={consumeDrawerPendingTab}
        pendingOpenInviteForQuoteId={drawerPendingOpenInviteQuoteId}
        onConsumePendingOpenInvitePartners={consumeDrawerPendingOpenInvite}
        onClose={() => setSelectedQuote(null)}
        onStatusChange={handleStatusChange}
        onQuoteUpdate={handleQuoteDrawerUpdate}
        onApproveQuote={handleApproveQuoteRequest}
      />
      ) : null}
      <Modal
        open={!!depositConfirmQuote}
        onClose={() => setDepositConfirmQuote(null)}
        title="Confirm deposit"
        subtitle={
          depositConfirmQuote
            ? `${depositConfirmQuote.reference} — adjust if the amount received differs from the quoted deposit`
            : ""
        }
        size="md"
      >
        {depositConfirmQuote ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-text-secondary">
              Confirm the deposit received below, then continue to <strong className="text-text-primary">Create job</strong>. The amount will be recorded
              on the new job when you submit that form (£0 skips a payment entry).
            </p>
            <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 text-xs text-text-secondary">
              Quoted deposit {formatCurrency(Number(depositConfirmQuote.deposit_required) || 0)} · Quote total{" "}
              {formatCurrency(Number(depositConfirmQuote.total_value) || 0)}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-text-primary">Deposit received (£)</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={depositConfirmAmountStr}
                onChange={(e) => setDepositConfirmAmountStr(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDepositConfirmQuote(null)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={() => proceedDepositConfirmToJob()}>
                Continue to create job
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={!!approveDepositGateQuote}
        onClose={() => setApproveDepositGateQuote(null)}
        title="Customer deposit"
        subtitle={
          approveDepositGateQuote
            ? `${approveDepositGateQuote.reference} — quoted deposit ${formatCurrency(Number(approveDepositGateQuote.deposit_required) || 0)}`
            : ""
        }
        size="md"
      >
        {approveDepositGateQuote ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-text-secondary">
              Has the customer paid the deposit? Choose whether to wait for payment or create the job and waive the deposit requirement (you will confirm a reason in the next step).
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setApproveDepositGateQuote(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const q = approveDepositGateQuote;
                  setApproveDepositGateQuote(null);
                  void approveGateMoveToAwaitingPayment(q);
                }}
              >
                Keep waiting for payment
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const q = approveDepositGateQuote;
                  setApproveDepositGateQuote(null);
                  setConvertRecordedDepositAmount(null);
                  setConvertMarkDepositPaid(false);
                  setCreateJobInitialWithoutDeposit(true);
                  setQuoteToConvert(q);
                }}
              >
                Create job without deposit
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      {quoteToConvert ? (
        <CreateJobFromQuoteModal
          key={quoteToConvert.id}
          quote={quoteToConvert}
          markDepositAsPaid={convertMarkDepositPaid}
          recordedDepositAmount={convertRecordedDepositAmount ?? undefined}
          initialCreateWithoutDeposit={createJobInitialWithoutDeposit}
          onClose={() => {
            setQuoteToConvert(null);
            setConvertMarkDepositPaid(false);
            setConvertRecordedDepositAmount(null);
            setCreateJobInitialWithoutDeposit(false);
          }}
          onSubmit={handleConfirmCreateJob}
        />
      ) : null}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          createQuoteIntentRef.current = "full";
          setCreateFormVariant("full");
          setRoutingCreateEntry("quote");
          setDrawerPendingOpenInviteQuoteId(null);
        }}
        title={
          createFormVariant === "routing_minimal"
            ? routingCreateEntry === "bidding"
              ? "New bidding"
              : "New quote"
            : "Create quote"
        }
        subtitle={
          createFormVariant === "routing_minimal"
            ? routingCreateEntry === "bidding"
              ? "Account, site, scope, type of work and partners — one step: we create the bid request and notify them."
              : "Account, site, type of work and scope — partners match on type of work when you send to bidding."
            : "Manual quote — we create the proposal and send the PDF to the inbox from Accounts (End client vs This account billing)."
        }
        size="lg"
        scrollBody
      >
        <CreateQuoteForm
          key={`${createFormVariant}-${routingCreateEntry}`}
          variant={createFormVariant}
          routingCollectTrade={routingCreateEntry === "bidding"}
          onSubmit={handleCreate}
          onCancel={() => {
            setCreateOpen(false);
            createQuoteIntentRef.current = "full";
            setCreateFormVariant("full");
            setRoutingCreateEntry("quote");
            setDrawerPendingOpenInviteQuoteId(null);
          }}
        />
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

/** Quote pipeline without Survey — New → Bids → Approval → Payment (in_survey maps here). */
const QUOTE_DRAWER_PIPELINE: readonly { id: string; label: string; short: string; icon: typeof ClipboardList }[] = [
  { id: "draft", label: "New", short: "New", icon: ClipboardList },
  { id: "bidding", label: "Bidding", short: "Bids", icon: Gavel },
  { id: "awaiting_customer", label: "Approval", short: "Approval", icon: UserRound },
  { id: "awaiting_payment", label: "Payment", short: "Payment", icon: CheckCircle2 },
];

const QUOTE_NAVY = "#020040";

/** Horizontal pipeline stepper — compact, navy active/completed, grey future (Survey hidden). */
function QuotePipelineStepper({ status }: { status: string }) {
  const legacyMap: Record<string, number> = {
    draft: 0,
    in_survey: 0,
    bidding: 1,
    awaiting_customer: 2,
    awaiting_payment: 3,
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
            <p className="text-sm font-semibold text-text-primary">Lost</p>
            <p className="text-[10px] text-text-tertiary">Marked as rejected</p>
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
            <p className="text-sm font-semibold text-text-primary">Win</p>
            <p className="text-[10px] text-text-tertiary">Converted to job · continue in Jobs</p>
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

/** Draft drawer: routing intake until user opens Partner bids or Manual build modal. */
function isDraftRoutingPhase(q: Quote): boolean {
  return q.status === "draft" && q.draft_route_completed !== true;
}

/* ========== QUOTE DETAIL DRAWER ========== */
function QuoteDetailDrawer({
  quote,
  pendingInitialTab,
  onConsumePendingInitialTab,
  pendingOpenInviteForQuoteId,
  onConsumePendingOpenInvitePartners,
  onClose,
  onStatusChange,
  onQuoteUpdate,
  onApproveQuote,
}: {
  quote: Quote;
  pendingInitialTab?: "overview" | "bids" | null;
  onConsumePendingInitialTab?: () => void;
  /** After “New bidding”, open Invite Partners once this drawer shows the newly created routing draft (`quote.id` matches). */
  pendingOpenInviteForQuoteId?: string | null;
  onConsumePendingOpenInvitePartners?: () => void;
  onClose: () => void;
  onStatusChange: (quote: Quote, status: string, opts?: { successToast?: string }) => void | Promise<boolean>;
  onQuoteUpdate?: (updated: Quote) => void;
  /** Approval (`awaiting_customer`) — **Approved** button: deposit gate or create job (parent). */
  onApproveQuote: (quoteRow: Quote) => void;
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
  const [manualContinueOpen, setManualContinueOpen] = useState(false);
  const [manualContinueSending, setManualContinueSending] = useState(false);
  /** Editable scope in Invite Partners modal — persisted when invites send. */
  const [invitePartnerScopeDraft, setInvitePartnerScopeDraft] = useState("");
  const [invitePartnerScopeEditing, setInvitePartnerScopeEditing] = useState(false);
  const invitePartnerScopeTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** Local type-of-work / title edits before route is chosen (persisted with Save details or on Send to bid). */
  const [routingTitleDraft, setRoutingTitleDraft] = useState("");
  /** Work site address for routing draft (Mapbox); persisted with job details / Send to bid. */
  const [routingPropertyAddress, setRoutingPropertyAddress] = useState("");
  const [routingMapCenter, setRoutingMapCenter] = useState<[number, number] | undefined>(undefined);
  const [routingMapGeocoding, setRoutingMapGeocoding] = useState(false);
  const [routingPhotoFiles, setRoutingPhotoFiles] = useState<File[]>([]);
  const [routingPhotoPreviews, setRoutingPhotoPreviews] = useState<string[]>([]);
  const [routingDetailsSaving, setRoutingDetailsSaving] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [routingTypeOfWorkCatalog, setRoutingTypeOfWorkCatalog] = useState<CatalogService[]>([]);
  useEffect(() => {
    void listCatalogServicesForPicker().then(setRoutingTypeOfWorkCatalog).catch(() => setRoutingTypeOfWorkCatalog([]));
  }, []);
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
  /** Account picker in the "Account on this quote" panel: full list for the dropdown. */
  const [drawerAccountRows, setDrawerAccountRows] = useState<Account[]>([]);
  /** Draft selection in the account picker (persisted on Save). Empty string = no account. */
  const [drawerAccountDraftId, setDrawerAccountDraftId] = useState("");
  const lastQuoteIdForAccountInferRef = useRef<string>("");
  const prevSyncedSourceAccountIdRef = useRef<string | null | undefined>(undefined);
  /** Yes = ClientAddressPicker (client becomes the primary contact). No = free-text site address, no contact client. */
  const [drawerAddClient, setDrawerAddClient] = useState(true);
  /** Free-text address used when "Add contact client" is off. */
  const [drawerManualAddress, setDrawerManualAddress] = useState("");
  // Send to customer / preview — must stay above useLayoutEffect (Rules of Hooks).
  const [depositPercent, setDepositPercent] = useState("50");
  /** "percent" = deposit % of sell total; "amount" = fixed £ (stored on quote as `deposit_required` + inferred %). */
  const [depositInputMode, setDepositInputMode] = useState<"percent" | "amount">("percent");
  const [depositAmountInput, setDepositAmountInput] = useState("");
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
    const lateStage =
      quote.status === "awaiting_customer" ||
      quote.status === "awaiting_payment" ||
      quote.status === "converted_to_job" ||
      quote.status === "rejected";
    const routingDraft = isDraftRoutingPhase(quote);
    if (pendingInitialTab === "bids" || pendingInitialTab === "overview") {
      const init =
        pendingInitialTab === "bids" && (lateStage || routingDraft)
          ? "overview"
          : pendingInitialTab;
      setTab(init);
      lastTabInitQuoteIdRef.current = quote.id;
      onConsumePendingInitialTab?.();
      return;
    }
    if (lastTabInitQuoteIdRef.current !== quote.id) {
      lastTabInitQuoteIdRef.current = quote.id;
      setTab("overview");
    }
  }, [
    quote.id,
    quote.quote_type,
    quote.status,
    quote.draft_route_completed,
    pendingInitialTab,
    onConsumePendingInitialTab,
  ]);

  useEffect(() => {
    if (!pendingOpenInviteForQuoteId) return;
    if (quote.id !== pendingOpenInviteForQuoteId) return;
    if (!isDraftRoutingPhase(quote)) {
      onConsumePendingOpenInvitePartners?.();
      return;
    }
    const id = window.requestAnimationFrame(() => {
      setInvitePartnerOpen(true);
      onConsumePendingOpenInvitePartners?.();
    });
    return () => window.cancelAnimationFrame(id);
  }, [
    pendingOpenInviteForQuoteId,
    quote.id,
    quote.status,
    quote.draft_route_completed,
    onConsumePendingOpenInvitePartners,
  ]);

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
    setScopeText(bidPayloadTrimmedString(quote.scope as unknown));
    setDepositPercent(
      quote.deposit_percent != null && Number.isFinite(Number(quote.deposit_percent))
        ? String(Number(quote.deposit_percent))
        : String(inferDepositPercentFromLegacy(Number(quote.deposit_required ?? 0), Number(quote.total_value ?? 0))),
    );
    setDepositInputMode("percent");
    setDepositAmountInput(
      (Math.round((Number(quote.deposit_required ?? 0) || 0) * 100) / 100).toFixed(2),
    );
    setStartDate1(normalizeCalendarDateToYmd(bidPayloadTrimmedString(quote.start_date_option_1 as unknown)) || "");
    setStartDate2(normalizeCalendarDateToYmd(bidPayloadTrimmedString(quote.start_date_option_2 as unknown)) || "");
    setCustomMessage(bidPayloadTrimmedString(quote.email_custom_message as unknown));
    setEmailAttachRequestPhotos(Boolean(quote.email_attach_request_photos));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when server row version changes; omitting `quote` avoids wiping the editor on every silent list refresh (new object, same row)
  }, [quote.id, quote.updated_at]);

  /** Customer email — follows account `billing_type` + client vs account-only property (not raw `quote.client_email` alone). */
  useEffect(() => {
    let cancelled = false;
    const effectiveClientId = (quoteClientPick.client_id ?? quote.client_id)?.trim() || null;
    const propertyIdOnly = effectiveClientId ? null : quote.property_id?.trim() || null;
    void (async () => {
      try {
        const computed = await getQuoteProposalRecipientEmail(getSupabase(), {
          clientId: effectiveClientId,
          propertyId: propertyIdOnly,
          accountId:
            effectiveClientId || propertyIdOnly
              ? null
              : drawerAccountDraftId.trim() || quote.source_account_id?.trim() || null,
          fallbackName: quoteClientPick.client_name ?? quote.client_name ?? null,
          fallbackEmail: quoteClientPick.client_email ?? quote.client_email ?? null,
        });
        if (cancelled) return;
        const trimmed = bidPayloadTrimmedString(computed as unknown);
        setSendEmail(trimmed || bidPayloadTrimmedString(quote.client_email as unknown));
      } catch {
        if (!cancelled) setSendEmail(bidPayloadTrimmedString(quote.client_email as unknown));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    quote.id,
    quote.updated_at,
    quote.client_id,
    quote.property_id,
    quote.client_email,
    quote.client_name,
    quoteClientPick.client_id,
    quoteClientPick.client_email,
    quoteClientPick.client_name,
    drawerAccountDraftId,
    quote.source_account_id,
  ]);

  useEffect(() => {
    let cancelled = false;
    const clientId = quoteClientPick.client_id ?? quote.client_id;
    if (clientId) {
      void (async () => {
        try {
          const sid = await resolveCorporateAccountIdForClient(clientId);
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
    }
    const propId = quote.property_id?.trim();
    if (!clientId && propId) {
      void (async () => {
        try {
          const prop = await getAccountProperty(propId);
          const aid = prop?.account_id?.trim();
          if (!aid) {
            if (!cancelled) setLinkedAccountPreview(null);
            return;
          }
          const acc = await getAccount(aid);
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
    }
    const draftPickId = drawerAccountDraftId.trim() || quote.source_account_id?.trim() || "";
    if (!clientId && !propId && draftPickId) {
      void (async () => {
        try {
          const acc = await getAccount(draftPickId);
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
    }
    setLinkedAccountPreview(null);
    return () => {
      cancelled = true;
    };
  }, [
    quote.client_id,
    quote.property_id,
    quote.source_account_id,
    quoteClientPick.client_id,
    quote.updated_at,
    drawerAccountDraftId,
  ]);

  /** Lazily load the accounts list the first time the Account panel is opened. */
  useEffect(() => {
    if (!clientOnQuoteOpen || drawerAccountRows.length > 0) return;
    let cancelled = false;
    void listAccounts({ page: 1, pageSize: 500, status: "all" })
      .then((r) => { if (!cancelled) setDrawerAccountRows(r.data ?? []); })
      .catch(() => { if (!cancelled) setDrawerAccountRows([]); });
    return () => { cancelled = true; };
  }, [clientOnQuoteOpen, drawerAccountRows.length]);

  /** Infer account id for the drawer: client → corporate account, property site → account, else persisted `source_account_id`. */
  useEffect(() => {
    const idChanged = lastQuoteIdForAccountInferRef.current !== quote.id;
    if (idChanged) lastQuoteIdForAccountInferRef.current = quote.id;

    let cancelled = false;
    const clientId = quote.client_id?.trim();
    const propId = quote.property_id?.trim();
    void (async () => {
      try {
        if (clientId) {
          const sid = await resolveCorporateAccountIdForClient(clientId);
          if (!cancelled) setDrawerAccountDraftId(sid || "");
          return;
        }
        if (propId) {
          const prop = await getAccountProperty(propId);
          if (!cancelled) setDrawerAccountDraftId(prop?.account_id?.trim() || "");
          return;
        }
        const srcRaw = quote.source_account_id;
        if (!idChanged && prevSyncedSourceAccountIdRef.current === srcRaw) return;
        prevSyncedSourceAccountIdRef.current = srcRaw;
        if (!cancelled) setDrawerAccountDraftId(srcRaw?.trim() || "");
      } catch {
        /* Leave drawer pick unchanged on lookup errors — user may still send via account picker. */
      }
    })();
    return () => { cancelled = true; };
  }, [quote.id, quote.client_id, quote.property_id, quote.source_account_id, quote.updated_at]);

  /** Keep manual-address draft aligned with what's currently stored when toggling to "No client". */
  useEffect(() => {
    setDrawerManualAddress(bidPayloadTrimmedString(quote.property_address as unknown));
    setDrawerAddClient(Boolean(quote.client_id?.trim()));
  }, [quote.id, quote.client_id, quote.property_address, quote.updated_at]);

  useEffect(() => {
    if (quote.status === "awaiting_payment" || quote.status === "converted_to_job") {
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
      const padStatuses = ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"];
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
    const res = await listPartners({ pageSize: 200, status: "active" });
    setPartners(res.data ?? []);
  }, []);

  useEffect(() => {
    if (invitePartnerOpen) { loadPartners(); setSelectedPartnerIds(new Set()); }
  }, [invitePartnerOpen, loadPartners]);

  useEffect(() => {
    if (!invitePartnerOpen) return;
    setInvitePartnerScopeDraft(bidPayloadTrimmedString(quote.scope as unknown));
    setInvitePartnerScopeEditing(false);
  }, [invitePartnerOpen, quote.id, quote.scope]);

  useEffect(() => {
    const svc = bidPayloadTrimmedString(quote.service_type as unknown);
    const ttl = bidPayloadTrimmedString(quote.title as unknown);
    const st = normalizeTypeOfWork(svc) || normalizeTypeOfWork(ttl);
    setRoutingTitleDraft(st || "");
  }, [quote.id, quote.service_type, quote.title]);

  /** Keep routing-draft site address aligned with the quote row (also set from Account / client panel above). */
  useEffect(() => {
    setRoutingPropertyAddress(bidPayloadTrimmedString(quote.property_address as unknown));
  }, [quote.id, quote.property_address, quote.updated_at]);

  /** Centre the Mapbox picker when we already have a saved address string. */
  useEffect(() => {
    const addr = bidPayloadTrimmedString(routingPropertyAddress).trim();
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    if (!token || !addr) {
      setRoutingMapCenter(undefined);
      setRoutingMapGeocoding(false);
      return;
    }
    setRoutingMapGeocoding(true);
    let cancelled = false;
    fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${token}&limit=1&types=${MAPBOX_GB_FORWARD_TYPES}${mapboxGbForwardBiasAppend(addr)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        const c = data.features?.[0]?.center as [number, number] | undefined;
        if (!cancelled) setRoutingMapCenter(c);
      })
      .catch(() => {
        if (!cancelled) setRoutingMapCenter(undefined);
      })
      .finally(() => {
        if (!cancelled) setRoutingMapGeocoding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routingPropertyAddress]);

  useEffect(() => {
    setRoutingPhotoFiles([]);
    setRoutingPhotoPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
  }, [quote.id]);

  /** Type of work used for “Match” / deselect-matched in Invite Partners modal. */
  const invitePartnerTypeOfWork = useMemo(() => {
    const st = bidPayloadTrimmedString(quote.service_type as unknown);
    if (st) return st;
    return proposalFirstLineLabel(quote);
  }, [quote]);

  const partnersEligibleForInvite = useMemo(
    () =>
      partners.filter(
        (p) => isPartnerEligibleForWork(p) && typeof p.id === "string" && p.id.trim().length > 0,
      ),
    [partners],
  );

  /** Invite modal: trade-matching partners first, then name. */
  const partnersEligibleForInviteSorted = useMemo(() => {
    const t = invitePartnerTypeOfWork.trim();
    const rows = [...partnersEligibleForInvite];
    rows.sort((a, b) => {
      const ma = Boolean(t && safePartnerMatchesTypeOfWork(a, t, quote.catalog_service_id));
      const mb = Boolean(t && safePartnerMatchesTypeOfWork(b, t, quote.catalog_service_id));
      if (ma !== mb) return ma ? -1 : 1;
      return (a.company_name || "").localeCompare(b.company_name || "", undefined, { sensitivity: "base" });
    });
    return rows;
  }, [partnersEligibleForInvite, invitePartnerTypeOfWork, quote.catalog_service_id]);

  const inviteModalTradeMatchedPartners = useMemo(() => {
    const t = invitePartnerTypeOfWork.trim();
    if (!t) return [];
    return partnersEligibleForInvite.filter((p) => safePartnerMatchesTypeOfWork(p, t, quote.catalog_service_id));
  }, [partnersEligibleForInvite, invitePartnerTypeOfWork, quote.catalog_service_id]);

  const loadBids = useCallback(
    async (quoteId: string) => {
      setBidsLoading(true);
      try {
        const list = await getBidsByQuoteId(quoteId);
        if (quoteRef.current.id !== quoteId) return;
        setBids(list);
        setSelectedReviewBidId((prev) => (prev && list.some((b) => b.id === prev) ? prev : null));
      } finally {
        if (quoteRef.current.id === quoteId) setBidsLoading(false);
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

  const actions = isDraftRoutingPhase(quote) ? [] : getQuoteActions(quote);
  /** Start Bidding lives on the Bids tab, not under Review & Send. Hide Reject until the customer has received the proposal. */
  const overviewActions = actions.filter((a) => {
    if (a.status === "bidding") return false;
    if (a.status === "rejected") return quoteCustomerHasReceivedProposal(quote, quoteEmailedInSession);
    return true;
  });

  /** When `linkedAccountPreview` is still null (e.g. account-only quote without `property_id`), show denormalised quote fields. */
  const accountOnQuoteHeader = useMemo(() => {
    if (linkedAccountPreview) {
      return { mode: "resolved" as const, ...linkedAccountPreview };
    }
    const srcAcct = bidPayloadTrimmedString(quote.source_account_name as unknown);
    const noContactClient = !bidPayloadTrimmedString(quote.client_id as unknown);
    const accountOnlyName = noContactClient ? bidPayloadTrimmedString(quote.client_name as unknown) : "";
    const title = srcAcct || accountOnlyName;
    if (!title) return { mode: "none" as const };
    return {
      mode: "denorm" as const,
      title,
      email: bidPayloadTrimmedString(quote.client_email as unknown),
    };
  }, [
    linkedAccountPreview,
    quote.source_account_name,
    quote.client_id,
    quote.client_name,
    quote.client_email,
  ]);

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
  /** Preview £ matching the active deposit input mode (for hints and save). */
  const proposalDepositAmount = useMemo(() => {
    if (depositInputMode === "amount") {
      const raw = Math.max(0, Number(depositAmountInput) || 0);
      return lineTotal > 0 ? Math.min(lineTotal, Math.round(raw * 100) / 100) : 0;
    }
    return depositAmountFromPercent(lineTotal, Number(depositPercent));
  }, [depositInputMode, depositAmountInput, lineTotal, depositPercent]);
  const proposalInferredDepositPercent = useMemo(() => {
    if (lineTotal < 0.01) return 0;
    return inferDepositPercentFromLegacy(proposalDepositAmount, lineTotal);
  }, [lineTotal, proposalDepositAmount]);
  const partnerBasisLines01 = proposalLine0Partner + proposalLine1Partner;
  const canUseProposalMarginSlider = partnerBasisLines01 > 0;

  // Email flow step-by-step (only relevant when quote.status === "awaiting_customer")
  const sendStep1Ready =
    bidPayloadTrimmedString(scopeText as unknown).length > 0 ||
    lineItems.some((li) => bidPayloadTrimmedString(li.description as unknown).length > 0);
  const sendStep2Ready = !!startDate1 || !!startDate2;
  const sendDepositPercentNum = Number(depositPercent);
  const sendDepositStepReady =
    depositInputMode === "amount"
      ? Number.isFinite(Number(depositAmountInput)) && !Number.isNaN(Number(depositAmountInput)) && Number(depositAmountInput) >= 0
      : sendDepositPercentNum >= 0 &&
        sendDepositPercentNum <= 100 &&
        !Number.isNaN(sendDepositPercentNum);
  const sendStep3Ready = sendDepositStepReady && bidPayloadTrimmedString(sendEmail as unknown).includes("@");

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

  /**
   * Late-stage statuses expose a read-only "Details" snapshot of the quote (what was sent to the customer)
   * instead of the Bids board — bids aren't actionable after the quote moved past Bidding.
   */
  const isLateStageQuote =
    quote.status === "awaiting_customer" ||
    quote.status === "awaiting_payment" ||
    quote.status === "converted_to_job" ||
    quote.status === "rejected";
  const routingDraft = isDraftRoutingPhase(quote);
  const drawerTabs = isLateStageQuote
    ? [
        { id: "overview", label: "Review & Send" },
        { id: "details", label: "Details" },
        { id: "history", label: "History" },
      ]
    : routingDraft
      ? [
          { id: "overview", label: "New" },
          { id: "history", label: "History" },
        ]
      : [
          { id: "overview", label: "Review & Send" },
          { id: "bids", label: "Bids" },
          { id: "history", label: "History" },
        ];

  const saveRoutingJobDetails = useCallback(async (): Promise<boolean> => {
    const title = normalizeTypeOfWork(routingTitleDraft).trim();
    if (!title) {
      toast.error("Add a type of work");
      return false;
    }
    setRoutingDetailsSaving(true);
    try {
      const existing = [...(quote.images ?? [])].filter((u): u is string => typeof u === "string" && !!u.trim());
      let nextImages = existing;
      if (routingPhotoFiles.length > 0) {
        const { uploadQuoteInviteImages } = await import("@/services/quote-invite-images");
        const folder =
          typeof crypto !== "undefined" && "randomUUID" in crypto ? `draft-route-${quote.id}-${crypto.randomUUID()}` : `draft-route-${quote.id}-${Date.now()}`;
        const urls = await uploadQuoteInviteImages(routingPhotoFiles, folder);
        if (urls?.length) nextImages = [...nextImages, ...urls];
      }
      const scopeTrim = bidPayloadTrimmedString(scopeText as unknown).trim();
      const typeNorm = normalizeTypeOfWork(routingTitleDraft).trim();
      const addrTrim = bidPayloadTrimmedString(routingPropertyAddress).trim();
      const postcodeFromAddr = addrTrim ? extractUkPostcode(addrTrim) : null;
      const updated = await updateQuote(quote.id, {
        title: typeNorm,
        ...(typeNorm ? { service_type: typeNorm } : {}),
        ...(scopeTrim ? { scope: scopeTrim } : { scope: undefined }),
        ...(addrTrim
          ? {
              property_address: addrTrim,
              ...(postcodeFromAddr ? { postcode: postcodeFromAddr } : {}),
            }
          : {}),
        ...(nextImages.length ? { images: nextImages } : {}),
      });
      onQuoteUpdate?.(updated);
      setRoutingPhotoFiles([]);
      setRoutingPhotoPreviews((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
      toast.success("Job details saved");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save job details");
      return false;
    } finally {
      setRoutingDetailsSaving(false);
    }
  }, [
    quote.id,
    quote.images,
    routingTitleDraft,
    routingPropertyAddress,
    scopeText,
    routingPhotoFiles,
    onQuoteUpdate,
  ]);

  const prepareSendToBid = useCallback(async () => {
    const nm = bidPayloadTrimmedString(quote.client_name as unknown);
    if (!nm || /^pending$/i.test(nm)) {
      toast.error("Link an account (Account on this quote)");
      return;
    }
    const siteAddr =
      bidPayloadTrimmedString(routingPropertyAddress).trim() ||
      bidPayloadTrimmedString(quote.property_address as unknown);
    if (!siteAddr) {
      toast.error("Pin or enter the work address below");
      return;
    }
    if (!normalizeTypeOfWork(routingTitleDraft).trim()) {
      toast.error("Add type of work");
      return;
    }
    if (!bidPayloadTrimmedString(scopeText as unknown).trim()) {
      toast.error("Add scope — partners need to know what to bid on.");
      return;
    }
    const ok = await saveRoutingJobDetails();
    if (ok) setInvitePartnerOpen(true);
  }, [
    quote.client_name,
    quote.property_address,
    routingTitleDraft,
    routingPropertyAddress,
    scopeText,
    saveRoutingJobDetails,
  ]);

  const handleDrawerContinueManual = useCallback(
    async (
      _quoteId: string,
      patch: Partial<Quote>,
      options?: {
        manualLineItems?: ProposalLineRow[];
        sendToCustomer?: boolean;
        markAsSentExternally?: boolean;
      },
    ) => {
      const sendToCustomer = options?.sendToCustomer === true;
      const markAsSentExternally = options?.markAsSentExternally === true;
      setManualContinueSending(true);
      try {
        const supabase = getSupabase();
        const lines = options?.manualLineItems;
        if (lines?.length) {
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
          await insertQuoteLineItemsResilient(supabase, rows);
        }
        const updated = await updateQuote(quote.id, {
          ...patch,
          draft_route_completed: true,
          quote_type: "internal",
        });
        onQuoteUpdate?.(updated);
        setManualContinueOpen(false);

        if (!sendToCustomer && !markAsSentExternally) {
          toast.success("Manual quote saved — complete Review & Send to email the customer.");
          return;
        }

        const scopeSend =
          bidPayloadTrimmedString(patch.scope as unknown)?.trim() ||
          (lines ?? [])
            .map((li) => bidPayloadTrimmedString(li.description as unknown).trim())
            .filter(Boolean)
            .join("\n") ||
          "";
        if (!scopeSend) {
          toast.error("Add scope or line descriptions before sending.");
          throw new Error("incomplete_scope");
        }
        const rawD1 = bidPayloadTrimmedString(patch.start_date_option_1 as unknown);
        const rawD2 = bidPayloadTrimmedString(patch.start_date_option_2 as unknown);
        if (!normalizeCalendarDateToYmd(rawD1) && !normalizeCalendarDateToYmd(rawD2)) {
          toast.error("Choose at least one proposed start date before sending.");
          throw new Error("incomplete_dates");
        }
        const depPctTry = patch.deposit_percent != null ? Number(patch.deposit_percent) : NaN;
        if (!Number.isFinite(depPctTry) || depPctTry < 0 || depPctTry > 100) {
          toast.error("Set a valid deposit before sending.");
          throw new Error("incomplete_deposit");
        }

        /** Matches Review & Send / `billing_type`; modal omits `client_email` so DB may lack it until resolved. */
        let rowForSend = updated;
        const computedEmail = bidPayloadTrimmedString(
          (
            await getQuoteProposalRecipientEmail(supabase, {
              clientId: rowForSend.client_id?.trim() || null,
              propertyId: rowForSend.client_id?.trim() ? null : rowForSend.property_id?.trim() || null,
              accountId:
                rowForSend.client_id?.trim() || rowForSend.property_id?.trim()
                  ? null
                  : drawerAccountDraftId.trim() || rowForSend.source_account_id?.trim() || null,
              fallbackName: rowForSend.client_name ?? null,
              fallbackEmail: rowForSend.client_email ?? null,
            })
          ) as unknown,
        );
        const recipient =
          computedEmail || bidPayloadTrimmedString(rowForSend.client_email as unknown);
        if (!recipient.includes("@")) {
          const accountInboxUnresolved =
            !computedEmail &&
            (Boolean(drawerAccountDraftId.trim()) ||
              Boolean(rowForSend.property_id?.trim()) ||
              Boolean(rowForSend.source_account_id?.trim()));
          toast.error(
            accountInboxUnresolved
              ? "This account has no main or finance email on file — add one under Accounts (Directory), or enter a recipient in Review & Send before sending."
              : "Add a valid customer email on this quote before sending.",
          );
          throw new Error("incomplete_email");
        }

        if (
          computedEmail &&
          computedEmail !== bidPayloadTrimmedString(rowForSend.client_email as unknown)
        ) {
          rowForSend = await updateQuote(rowForSend.id, { client_email: computedEmail });
          onQuoteUpdate?.(rowForSend);
        }

        if (markAsSentExternally) {
          const ok = await Promise.resolve(
            onStatusChange(rowForSend, "awaiting_customer", {
              successToast: "Awaiting Customer — no email sent from the app (you marked it sent already).",
            }),
          );
          if (ok === false) return;
          const stamped = await updateQuote(rowForSend.id, { customer_pdf_sent_at: new Date().toISOString() });
          onQuoteUpdate?.(stamped);
          setQuoteEmailedInSession(true);
          const refreshed = await getQuote(quote.id);
          if (refreshed) onQuoteUpdate?.(refreshed);
          onClose();
          return;
        }

        const items = (lines ?? []).map((li, idx) => {
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
            quoteId: rowForSend.id,
            recipientEmail: recipient,
            recipientName: bidPayloadTrimmedString(rowForSend.client_name as unknown),
            customMessage: bidPayloadTrimmedString(rowForSend.email_custom_message as unknown) || undefined,
            items: items.length ? items : undefined,
            scope: scopeSend || undefined,
            attachRequestPhotos: Boolean(rowForSend.email_attach_request_photos),
          }),
        });
        const data = (await res.json()) as { error?: string; emailSent?: boolean; reason?: string; sentTo?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to send email");
        }
        if (!data.emailSent) {
          toast.warning(data.reason ?? "Quote updated but email was not sent.");
        } else {
          toast.success(
            `Proposal saved — PDF sent to ${recipient}. Customer can Accept or Reject via the email link.`,
          );
          setQuoteEmailedInSession(true);
        }
        const refreshed = await getQuote(quote.id);
        if (refreshed) onQuoteUpdate?.(refreshed);
      } catch (e) {
        if (e instanceof Error && /^incomplete_/.test(e.message)) return;
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setManualContinueSending(false);
      }
    },
    [quote.id, onQuoteUpdate, onStatusChange, onClose, drawerAccountDraftId],
  );

  const guidance = getStageGuidance(quote.status);

  const addLineItem = () =>
    setLineItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0", partnerUnitCost: "0", notes: "" }]);
  const removeLineItem = (idx: number) => {
    setLineItems((prev) => {
      if (
        prev.length <= 1 &&
        ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"].includes(quote.status)
      ) {
        toast.info("Keep at least the labour line.");
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
    let depositPct: number;
    let depositRequiredAmount: number;
    if (opts?.depositOverride !== undefined) {
      depositPct = clampDepositPercent(Number(opts.depositOverride) || 0);
      depositRequiredAmount = depositAmountFromPercent(lineTot, depositPct);
    } else if (depositInputMode === "amount") {
      const raw = Math.max(0, Number(depositAmountInput) || 0);
      depositRequiredAmount = lineTot > 0 ? Math.min(lineTot, Math.round(raw * 100) / 100) : 0;
      depositPct = inferDepositPercentFromLegacy(depositRequiredAmount, lineTot);
    } else {
      depositPct = clampDepositPercent(Number(depositPercent) || 0);
      depositRequiredAmount = depositAmountFromPercent(lineTot, depositPct);
    }

    let clientNamePatch: { client_name?: string } = {};
    if (quote.client_id?.trim()) {
      const b = await resolveNominalBillingParty(supabase, {
        clientId: quote.client_id.trim(),
        fallbackName: quote.client_name,
        fallbackEmail: quote.client_email,
      });
      clientNamePatch = { client_name: b.displayName };
    }

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
      ...clientNamePatch,
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
      setDepositInputMode("percent");
      setDepositAmountInput("");
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
      setDepositInputMode("percent");
      setDepositAmountInput((Math.round((Number(q.deposit_required ?? 0) || 0) * 100) / 100).toFixed(2));
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
      onClose();
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

  /** Pinned below scroll — avoids flex “dead space” above actions. */
  const quoteDrawerFooter =
    routingDraft && tab === "overview" ? (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Choose how to continue</p>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <Button
              type="button"
              size="sm"
              className="border-0 bg-[#ED4B00] text-white hover:bg-[#d84300]"
              icon={<Users className="h-3.5 w-3.5" />}
              onClick={() => void prepareSendToBid()}
            >
              Send to bid
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() =>
                void (async () => {
                  const siteAddr =
                    bidPayloadTrimmedString(routingPropertyAddress).trim() ||
                    bidPayloadTrimmedString(quote.property_address as unknown);
                  if (!siteAddr) {
                    toast.error("Pin or enter the work address");
                    return;
                  }
                  if (!normalizeTypeOfWork(routingTitleDraft).trim()) {
                    toast.error("Add type of work");
                    return;
                  }
                  const ok = await saveRoutingJobDetails();
                  if (ok) setManualContinueOpen(true);
                })()
              }
            >
              Create manually
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-[11px] text-text-tertiary hover:text-red-600"
            icon={<XCircle className="h-3.5 w-3.5" />}
            onClick={() => void onStatusChange(quote, "rejected")}
          >
            Reject quote
          </Button>
        </div>
      </div>
    ) : (tab === "overview" || tab === "bids") && !routingDraft ? (
      <div className="space-y-3">
        {quote.request_id &&
        !["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"].includes(quote.status) ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border-light bg-card/60 px-3 py-2.5 dark:bg-card/40">
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-card dark:bg-card/80">
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
        <div className="space-y-2 pb-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Move this quote</p>
          <div
            className={cn(
              "-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-visible px-1 py-1 scroll-smooth sm:gap-2",
              "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
              "[&_button]:shrink-0",
            )}
          >
            {(quote.status === "awaiting_customer" || quote.status === "awaiting_payment") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sendState === "sending" || !sendStep3Ready}
                icon={
                  sendState === "sending" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )
                }
                onClick={() => void handleSendToCustomer()}
                title={
                  quote.status === "awaiting_payment"
                    ? "Saves the latest figures and emails the updated PDF to the customer"
                    : "Saves the latest proposal and emails the PDF (Accept / Reject links stay the same)"
                }
              >
                {sendState === "sending" ? "Saving…" : "Resend Quote"}
              </Button>
            )}
            {overviewActions.map((action) => {
              const sendToCustomerClick = async () => {
                if (!sendStep1Ready || !sendStep2Ready || !sendStep3Ready) {
                  toast.error(
                    "Complete the customer proposal above (scope or line items, at least one start date, deposit, and customer email).",
                  );
                  return;
                }
                await handleSendToCustomer();
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
                      if (action.status === "approve_quote") {
                        onApproveQuote(quote);
                        return;
                      }
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
    ) : undefined;

  return (
    <Drawer
      open={!!quote}
      onClose={onClose}
      title={bidPayloadTrimmedString(quote.reference as unknown) || "Quote"}
      subtitle={bidPayloadTrimmedString(quote.title as unknown) || undefined}
      width="w-full max-w-[440px]"
      footer={quoteDrawerFooter}
      footerClassName="bg-card px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:bg-surface-secondary/40"
    >
      <div className="min-w-0">
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
                <p className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Total Price</p>
                <p className="mt-0.5 text-base font-bold tabular-nums leading-none text-text-primary">{formatCurrency(lineTotal)}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] tabular-nums text-text-tertiary">
                  <span className="shrink-0 whitespace-nowrap rounded-sm bg-emerald-100 px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Inc VAT
                  </span>
                </p>
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
        {/* OVERVIEW TAB: Status + Details together */}
        {tab === "overview" && (
            <div className="space-y-3 p-3 sm:p-4">
              {!routingDraft ? <QuotePipelineStepper status={quote.status} /> : null}
              {quote.status === "rejected" && quote.rejection_reason?.trim() ? (
                <div className="rounded-lg border border-red-200/80 bg-red-50/70 px-3 py-2 text-xs leading-snug text-text-secondary dark:border-red-900/40 dark:bg-red-950/25">
                  {quote.rejection_reason}
                </div>
              ) : null}

              <div
                key={`client-on-quote-${quote.id}`}
                className="rounded-lg border border-border-light bg-card shadow-sm dark:border-border dark:bg-card"
              >
                <div className="flex items-start gap-2 px-2.5 pt-2.5 pb-1 sm:px-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Account on this quote</p>
                      <FixfyHintIcon
                        text={
                          quote.status === "awaiting_customer"
                            ? "The PDF uses the account and property shown here."
                            : "Recipient account and property for this proposal — expand below to change."
                        }
                      />
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-text-tertiary">
                      {quote.status === "awaiting_customer"
                        ? "PDF will be sent to the account below."
                        : "This quote will be sent to the account email below."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-light bg-card px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
                    aria-expanded={clientOnQuoteOpen}
                    aria-label={clientOnQuoteOpen ? "Hide change account" : "Change account or property"}
                    onClick={() => setClientOnQuoteOpen((o) => !o)}
                  >
                    <span>{clientOnQuoteOpen ? "Close" : "Change"}</span>
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform duration-200", clientOnQuoteOpen && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                </div>

                <div className="px-2.5 pb-2.5 sm:px-3">
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
                        {accountOnQuoteHeader.mode === "resolved" ? (
                          <>
                            <p className="truncate text-sm font-semibold leading-tight text-text-primary">
                              {accountOnQuoteHeader.companyName}
                            </p>
                            <p className="mt-0.5 break-all text-[11px] leading-snug text-text-secondary">{accountOnQuoteHeader.email}</p>
                            {accountOnQuoteHeader.financeEmail &&
                            accountOnQuoteHeader.financeEmail.toLowerCase() !== accountOnQuoteHeader.email.toLowerCase() ? (
                              <p className="mt-1 text-[10px] leading-snug text-text-tertiary">
                                Finance · <span className="text-text-secondary break-all">{accountOnQuoteHeader.financeEmail}</span>
                              </p>
                            ) : null}
                          </>
                        ) : accountOnQuoteHeader.mode === "denorm" ? (
                          <>
                            <p className="truncate text-sm font-semibold leading-tight text-text-primary">{accountOnQuoteHeader.title}</p>
                            {accountOnQuoteHeader.email ? (
                              <p className="mt-0.5 break-all text-[11px] leading-snug text-text-secondary">{accountOnQuoteHeader.email}</p>
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
                      <p className="text-[11px] font-medium text-text-secondary">Change account, client or property</p>
                      <FixfyHintIcon text="Pick a different account. You can optionally attach a contact client; otherwise we save just the site address." />
                    </div>

                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Account
                      </label>
                      <Select
                        value={drawerAccountDraftId}
                        onChange={(e) => {
                          const next = e.target.value;
                          setDrawerAccountDraftId(next);
                          setQuoteClientPick({ client_name: "", property_address: "" });
                        }}
                        options={[
                          { value: "", label: "— No account —" },
                          ...drawerAccountRows.map((a) => ({
                            value: a.id,
                            label:
                              bidPayloadTrimmedString(a.company_name as unknown) ||
                              bidPayloadTrimmedString(a.contact_name as unknown) ||
                              a.id,
                          })),
                        ]}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-light bg-surface-hover/40 px-2.5 py-2 dark:bg-surface-secondary/20">
                      <p className="text-[11px] font-medium text-text-secondary">Add a contact client to this quote?</p>
                      <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border-light">
                        <button
                          type="button"
                          className={cn(
                            "px-2.5 py-1 text-[11px] font-medium transition-colors",
                            drawerAddClient ? "bg-primary text-white" : "bg-card text-text-secondary hover:bg-surface-hover",
                          )}
                          onClick={() => setDrawerAddClient(true)}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "border-l border-border-light px-2.5 py-1 text-[11px] font-medium transition-colors",
                            !drawerAddClient ? "bg-primary text-white" : "bg-card text-text-secondary hover:bg-surface-hover",
                          )}
                          onClick={() => setDrawerAddClient(false)}
                        >
                          No
                        </button>
                      </div>
                    </div>

                    {drawerAddClient ? (
                      <ClientAddressPicker
                        value={quoteClientPick}
                        onChange={setQuoteClientPick}
                        labelClient="Client"
                        labelAddress="Property address"
                        restrictToSourceAccountId={drawerAccountDraftId.trim() || undefined}
                      />
                    ) : (
                      <div>
                        <AddressAutocomplete
                          label="Property / site address"
                          value={drawerManualAddress}
                          onChange={(v) => setDrawerManualAddress(v)}
                          onSelect={(parts: AddressParts) => setDrawerManualAddress(parts.full_address)}
                          placeholder="Street, city, postcode…"
                        />
                        <p className="mt-1 text-[10px] text-text-tertiary">
                          No contact client will be stored. The account label above will be used as the recipient name.
                        </p>
                      </div>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={savingClient}
                      icon={savingClient ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
                      onClick={async () => {
                        const accountRow = drawerAccountRows.find((a) => a.id === drawerAccountDraftId);
                        const accountDisplayName =
                          bidPayloadTrimmedString(accountRow?.company_name as unknown) ||
                          bidPayloadTrimmedString(accountRow?.contact_name as unknown) ||
                          "";
                        if (drawerAddClient) {
                          if (!quoteClientPick.client_id || !quoteClientPick.property_address?.trim()) {
                            toast.error("Select a client and property address");
                            return;
                          }
                        } else if (!drawerManualAddress.trim()) {
                          toast.error("Enter a site address (or switch the toggle to Yes to pick a client).");
                          return;
                        }
                        setSavingClient(true);
                        try {
                          let updates: Partial<Quote>;
                          if (drawerAddClient) {
                            updates = {
                              client_id: quoteClientPick.client_id,
                              client_address_id: quoteClientPick.client_address_id,
                              client_name: quoteClientPick.client_name,
                              client_email: quoteClientPick.client_email ?? "",
                              property_address: quoteClientPick.property_address,
                              source_account_id: null,
                            };
                            if (quoteClientPick.client_id?.trim()) {
                              const b = await resolveNominalBillingParty(getSupabase(), {
                                clientId: quoteClientPick.client_id.trim(),
                                fallbackName: quoteClientPick.client_name,
                                fallbackEmail: quoteClientPick.client_email,
                              });
                              updates = {
                                ...updates,
                                client_name: b.displayName,
                                client_email: b.documentEmail ?? updates.client_email,
                              };
                            }
                          } else {
                            const addr = drawerManualAddress.trim();
                            /**
                             * Account-only flow: ensure an AccountProperty exists so the preview can resolve
                             * account → account_id (falls back to free-text if the account isn't selected).
                             */
                            let resolvedPropertyId: string | null = null;
                            const accountId = drawerAccountDraftId.trim();
                            if (accountId) {
                              try {
                                const existing = await listAccountProperties({
                                  accountId,
                                  page: 1,
                                  pageSize: 50,
                                  search: addr.slice(0, 40),
                                });
                                const needle = addr.toLowerCase();
                                const match = (existing.data ?? []).find(
                                  (p) =>
                                    bidPayloadTrimmedString(p.full_address as unknown).toLowerCase() === needle,
                                );
                                if (match) {
                                  resolvedPropertyId = match.id;
                                } else {
                                  const created = await createAccountProperty({
                                    account_id: accountId,
                                    name: addr.split(",")[0]?.trim() || "Site",
                                    full_address: addr,
                                    property_type: "Other",
                                  });
                                  resolvedPropertyId = created.id;
                                }
                              } catch (e) {
                                console.error("Ensure account property failed", e);
                              }
                            }
                            updates = {
                              client_id: null as unknown as undefined,
                              client_address_id: null as unknown as undefined,
                              client_name: accountDisplayName || quote.client_name || "Account",
                              client_email: "",
                              property_address: addr,
                              source_account_id: accountId.trim() ? accountId.trim() : null,
                              ...(resolvedPropertyId ? { property_id: resolvedPropertyId } : {}),
                            };
                          }
                          const updated = await updateQuote(quote.id, updates);
                          onQuoteUpdate?.(updated);
                          setSendEmail(bidPayloadTrimmedString(updated.client_email as unknown));
                          if (!drawerAddClient && accountRow) {
                            /**
                             * Set the preview optimistically so the header card reflects the picked account
                             * even if we could not create/find an AccountProperty (e.g. stale PostgREST schema cache).
                             */
                            const mainEmail = bidPayloadTrimmedString(accountRow.email as unknown);
                            const feRaw = bidPayloadTrimmedString(accountRow.finance_email as unknown);
                            setLinkedAccountPreview({
                              companyName: accountDisplayName || "—",
                              email: mainEmail || "—",
                              financeEmail: feRaw.length > 0 ? feRaw : null,
                            });
                            /** No contact client: prefer finance inbox, matching account-mode billing resolver. */
                            const accountDefaultEmail = feRaw || mainEmail;
                            if (accountDefaultEmail) setSendEmail(accountDefaultEmail);
                          }
                          toast.success(drawerAddClient ? "Client updated on this quote" : "Account updated on this quote");
                          setClientOnQuoteOpen(false);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to update quote");
                        } finally {
                          setSavingClient(false);
                        }
                      }}
                    >
                      {savingClient ? "Saving…" : drawerAddClient ? "Save client to quote" : "Save account to quote"}
                    </Button>
                  </div>
                ) : null}
              </div>

              {routingDraft ? (
                <div className="rounded-xl border border-border-light bg-card/90 p-3 space-y-3 dark:bg-surface-secondary/25">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#020040]">Job on this draft</p>
                    <FixfyHintIcon text="Pick the trade, pin the site on the map, then describe scope — or use the Account card above first. Finish with Partner bid or Manual quote." />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Type of work
                    </label>
                    <Select
                      label=""
                      aria-label="Type of work"
                      value={routingTitleDraft}
                      onChange={(e) => setRoutingTitleDraft(e.target.value)}
                      className="h-10 min-h-10 w-full rounded-xl text-sm"
                      options={[
                        { value: "", label: "Select type of work…" },
                        ...typeOfWorkLabelsFromCatalog(routingTypeOfWorkCatalog, routingTitleDraft || quote.service_type)
                          .map((name) => ({ value: name, label: name })),
                      ]}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Work site address
                    </label>
                    <p className="text-[11px] text-text-tertiary mb-2">
                      Search or tap the map — pin updates the quote site address for partners.
                    </p>
                    {routingPropertyAddress.trim() !== "" && routingMapGeocoding ? (
                      <div
                        className="rounded-xl border border-border bg-card/70 animate-pulse"
                        style={{ height: "200px" }}
                        aria-busy="true"
                        aria-label="Loading map"
                      />
                    ) : (
                      <LocationPicker
                        key={`routing-site-${quote.id}-${routingMapCenter ? `${routingMapCenter[0].toFixed(2)}_${routingMapCenter[1].toFixed(2)}` : "no-center"}`}
                        value={routingPropertyAddress}
                        onChange={(r) => setRoutingPropertyAddress((r.address ?? "").trim())}
                        placeholder="Search address or postcode…"
                        mapHeight="200px"
                        center={routingMapCenter ?? MAPBOX_UK_CENTER_LON_LAT}
                        restrictToUk
                      />
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Scope</label>
                    <textarea
                      value={scopeText}
                      onChange={(e) => setScopeText(e.target.value)}
                      placeholder="What needs doing, access, materials, exclusions…"
                      rows={5}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Site photos (optional)</p>
                    <p className="text-[11px] text-text-tertiary">
                      Up to 8 images (5 MB each). Partners see these on the bid invite.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(quote.images ?? [])
                        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
                        .map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-light bg-surface-hover"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="h-full w-full object-cover" />
                          </a>
                        ))}
                      {routingPhotoPreviews.map((src) => (
                        <div
                          key={src}
                          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-light bg-surface-hover"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-text-primary hover:border-primary/30">
                      <ImagePlus className="h-3.5 w-3.5" />
                      Add photos
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        multiple
                        className="sr-only"
                        disabled={(quote.images?.length ?? 0) + routingPhotoFiles.length >= 8 || routingDetailsSaving}
                        onChange={(e) => {
                          const list = e.target.files;
                          if (!list?.length) return;
                          const cap = 8 - (quote.images?.length ?? 0) - routingPhotoFiles.length;
                          const nextFiles = [...routingPhotoFiles, ...Array.from(list)].slice(0, Math.max(0, cap));
                          setRoutingPhotoFiles(nextFiles);
                          setRoutingPhotoPreviews((prev) => {
                            prev.forEach((u) => URL.revokeObjectURL(u));
                            return nextFiles.map((f) => URL.createObjectURL(f));
                          });
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={routingDetailsSaving}
                    disabled={routingDetailsSaving}
                    onClick={() => void saveRoutingJobDetails()}
                  >
                    Save job details
                  </Button>
                </div>
              ) : null}

              {/* Bid Summary — partner submission (read-only reference); pricing control is in Customer proposal. Hidden for manual quotes with no invited partners. */}
              {quote.quote_type === "partner" && !routingDraft ? (
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
              ) : null}

              {convertedJob && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-2"><Briefcase className="h-4 w-4 text-emerald-600" /><label className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Converted to Job</label></div>
                  <a href={`/jobs?jobId=${convertedJob.id}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/50 text-sm font-semibold text-primary">
                    <Briefcase className="h-4 w-4" /> {convertedJob.reference}
                  </a>
                </div>
              )}

              {["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"].includes(quote.status) && !routingDraft && (
                <div className="space-y-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-2.5">
                  {quote.status === "awaiting_customer" && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-2.5 py-2 dark:border-amber-800/50 dark:bg-amber-950/25">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Edit after sending</p>
                      <FixfyHintIcon
                        text={
                          quote.quote_type === "partner"
                            ? "You can still change line items, scope, dates, deposit, message, use the customer sell scale below, and review Bid Summary. Use Save Quote to store only, or Resend Quote under Move this quote to email the PDF."
                            : "You can still change line items, scope, dates, deposit, message and use the customer sell scale below. Use Save Quote to store only, or Resend Quote under Move this quote to email the PDF."
                        }
                      />
                    </div>
                  )}
                  {quote.status === "awaiting_payment" && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-2.5 py-2 dark:border-amber-800/50 dark:bg-amber-950/25">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Edit while awaiting payment</p>
                      <FixfyHintIcon
                        text={
                          "Change line items, sell totals, scope, start dates, deposit % and customer email as needed. Save Quote updates the record and figures; if deposit or final amounts differ from linked invoices, sync them from the Invoices page after saving."
                        }
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#020040]" aria-hidden />
                    <span className="text-xs font-semibold text-text-primary">Customer proposal</span>
                    {["draft", "in_survey", "bidding"].includes(quote.status) ? (
                      <span className="rounded-full bg-[#ED4B00]/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#C4461F]">
                        Required before send
                      </span>
                    ) : quote.status === "awaiting_payment" ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                        Awaiting deposit
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
                        <p className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Total Price</p>
                        <p className="mt-0.5 text-base font-bold tabular-nums leading-none text-text-primary">{formatCurrency(lineTotal)}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] tabular-nums text-text-tertiary">
                          <span className="shrink-0 whitespace-nowrap rounded-sm bg-emerald-100 px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Inc VAT
                          </span>
                        </p>
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
                    <div
                      className={cn(
                        "grid grid-cols-1 gap-2 pt-1",
                        lineItems.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1",
                      )}
                    >
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
                      {lineItems.length > 1 ? (
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
                      ) : null}
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
                      <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Line items / notes</label>
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
                            {lineItems.length > 1 &&
                              (idx >= 1 ||
                                !["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"].includes(
                                  quote.status,
                                )) && (
                              <button
                                type="button"
                                onClick={() => removeLineItem(idx)}
                                className="text-text-tertiary hover:text-red-500"
                                title={idx === 1 ? "Remove materials line" : "Remove line"}
                                aria-label={idx === 1 ? "Remove materials line" : "Remove line"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Deposit</label>
                      <div className="inline-flex shrink-0 rounded-lg border border-border-light bg-surface-tertiary/40 p-0.5 gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setDepositInputMode("percent");
                          }}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                            depositInputMode === "percent"
                              ? "bg-[#020040] text-white dark:bg-primary dark:text-white"
                              : "text-text-secondary hover:text-text-primary",
                          )}
                        >
                          % of total
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (depositInputMode !== "amount") {
                              setDepositAmountInput(proposalDepositAmount.toFixed(2));
                            }
                            setDepositInputMode("amount");
                          }}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                            depositInputMode === "amount"
                              ? "bg-[#020040] text-white dark:bg-primary dark:text-white"
                              : "text-text-secondary hover:text-text-primary",
                          )}
                        >
                          Fixed £
                        </button>
                      </div>
                    </div>
                    {depositInputMode === "percent" ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <Input
                          type="number"
                          value={depositAmountInput}
                          onChange={(e) => setDepositAmountInput(e.target.value)}
                          placeholder="0.00"
                          min={0}
                          step={0.01}
                        />
                        <p className="text-[10px] text-text-tertiary mt-1.5">
                          ≈{" "}
                          <span className="font-semibold tabular-nums text-text-primary">{proposalInferredDepositPercent.toFixed(1)}%</span>{" "}
                          of total ({formatCurrency(lineTotal)})
                        </p>
                      </>
                    )}
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

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={cn("rounded-md px-2 py-0.5", sendStep1Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>1 Scope / items</span>
                    <span className={cn("rounded-md px-2 py-0.5", sendStep2Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>2 Start dates</span>
                    <span className={cn("rounded-md px-2 py-0.5", sendStep3Ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-surface-hover text-text-tertiary")}>3 Deposit & email</span>
                    <button
                      type="button"
                      onClick={() => setProposalDetailsExpanded(false)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-border-light bg-card px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                      aria-label="Hide scope, line items, dates &amp; email"
                      title="Hide scope, line items, dates &amp; email"
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                      <span>Hide</span>
                    </button>
                  </div>
                    </>
                  ) : null}
                </div>
              )}

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

          {/* DETAILS TAB — read-only snapshot of the quote sent to the customer (late-stage statuses only) */}
          {tab === "details" && (
            <div className="space-y-4 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusConfig[quote.status]?.variant ?? "default"} dot>
                    {statusLabels[quote.status] ?? quote.status}
                  </Badge>
                  <span className="text-xs text-text-secondary">
                    Updated {formatYmdUkDisplay(quote.updated_at?.slice(0, 10) ?? "") || "—"}
                  </span>
                </div>
              </div>

              {quote.status === "rejected" && quote.rejection_reason?.trim() ? (
                <div className="rounded-xl border border-red-200/80 bg-red-50/80 px-3.5 py-3 text-sm leading-snug text-text-primary dark:border-red-900/40 dark:bg-red-950/30">
                  <p className="mb-1 text-xs font-semibold text-red-800 dark:text-red-200">Rejection reason</p>
                  <p className="text-text-secondary dark:text-red-100/90">{quote.rejection_reason}</p>
                </div>
              ) : null}

              <section>
                <h3 className="mb-2 text-xs font-semibold text-text-primary">Summary</h3>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 bg-border/25 shadow-sm">
                  <div className="bg-card p-3.5 sm:p-4">
                    <p className="text-[11px] font-medium text-text-secondary">Total price</p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums leading-tight text-text-primary sm:text-xl">
                      {formatCurrency(Number(quote.total_value) || 0)}
                    </p>
                    <span className="mt-1.5 inline-flex rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      Inc VAT
                    </span>
                  </div>
                  <div className="bg-card p-3.5 sm:p-4">
                    <p className="text-[11px] font-medium text-text-secondary">Margin</p>
                    <p
                      className={cn(
                        "mt-0.5 text-lg font-bold tabular-nums leading-tight sm:text-xl",
                        (quote.margin_percent ?? 0) >= 40
                          ? "text-emerald-600 dark:text-emerald-400"
                          : (quote.margin_percent ?? 0) >= 25
                            ? "text-amber-600 dark:text-amber-500"
                            : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {Number(quote.margin_percent ?? 0).toFixed(1)}%
                    </p>
                    <p className="mt-1.5 text-[11px] text-text-secondary">
                      Partner {formatCurrency(Number(quote.partner_cost) || 0)}
                    </p>
                  </div>
                  <div className="bg-card p-3.5 sm:p-4">
                    <p className="text-[11px] font-medium text-text-secondary">Deposit</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-text-primary sm:text-lg">
                      {formatCurrency(Number(quote.deposit_required) || 0)}
                    </p>
                    <p className="mt-1.5 text-[11px] text-text-secondary">
                      {Number(quote.deposit_percent) || 0}% of total
                    </p>
                  </div>
                  <div className="bg-card p-3.5 sm:p-4">
                    <p className="text-[11px] font-medium text-text-secondary">Final balance</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-text-primary sm:text-lg">
                      {formatCurrency(Math.max(0, (Number(quote.total_value) || 0) - (Number(quote.deposit_required) || 0)))}
                    </p>
                    <p className="mt-1.5 text-[11px] text-text-secondary">
                      {quote.customer_deposit_paid ? "Deposit received" : "After deposit"}
                    </p>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
                <h3 className="border-b border-border/50 bg-surface/40 px-3.5 py-2.5 text-xs font-semibold text-text-primary">
                  Account & contact
                </h3>
                <div className="divide-y divide-border/40">
                  {linkedAccountPreview ? (
                    <div className="flex items-start gap-3 p-3.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-xs font-bold text-primary">
                        {linkedAccountPreview.companyName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-text-secondary">Account</p>
                        <p className="text-sm font-semibold text-text-primary">{linkedAccountPreview.companyName}</p>
                        <p className="mt-0.5 break-all text-sm text-text-secondary">{linkedAccountPreview.email}</p>
                        {linkedAccountPreview.financeEmail &&
                        linkedAccountPreview.financeEmail.toLowerCase() !== linkedAccountPreview.email.toLowerCase() ? (
                          <p className="mt-1 text-xs text-text-tertiary">Billing: {linkedAccountPreview.financeEmail}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {quote.client_id ? (
                    <div className="p-3.5">
                      <p className="text-xs text-text-secondary">Contact</p>
                      <p className="text-sm font-semibold text-text-primary">{quote.client_name || "—"}</p>
                      {quote.client_email ? <p className="mt-0.5 text-sm text-text-secondary">{quote.client_email}</p> : null}
                    </div>
                  ) : null}
                  <div className="p-3.5">
                    <p className="text-xs text-text-secondary">Property</p>
                    <p className="text-sm font-medium leading-relaxed text-text-primary whitespace-pre-wrap">
                      {quote.property_address?.trim() || "—"}
                    </p>
                    {quote.postcode?.trim() ? (
                      <p className="mt-1 text-xs font-medium text-text-secondary">{quote.postcode}</p>
                    ) : null}
                  </div>
                </div>
              </section>

              {lineItems.length > 0 ? (
                <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
                  <h3 className="border-b border-border/50 bg-surface/40 px-3.5 py-2.5 text-xs font-semibold text-text-primary">
                    Line items
                  </h3>
                  <ul className="divide-y divide-border/40">
                    {lineItems.map((li, idx) => {
                      const qty = Number(li.quantity) || 0;
                      const unit = Number(li.unitPrice) || 0;
                      const total = qty * unit;
                      const desc = (li.description ?? "").trim() || (idx === 0 ? "Labour" : idx === 1 ? "Materials" : `Line ${idx + 1}`);
                      const lineNoteDisplay = proposalLineHintDisplay(parseProposalLineNotes(li.notes));
                      return (
                        <li key={idx} className="flex flex-col gap-1.5 px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-text-primary">{desc}</p>
                            <p className="mt-0.5 text-xs tabular-nums text-text-secondary">
                              {qty} × {formatCurrency(unit)}
                            </p>
                            {lineNoteDisplay.trim() ? (
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-primary/90">{lineNoteDisplay}</p>
                            ) : null}
                          </div>
                          <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary sm:pt-0.5 sm:text-base">
                            {formatCurrency(total)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center justify-between border-t border-border/50 bg-surface/30 px-3.5 py-3">
                    <span className="text-xs font-medium text-text-secondary">Subtotal (inc. VAT)</span>
                    <span className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(lineTotal)}</span>
                  </div>
                </section>
              ) : null}

              {formatQuoteDurationDisplay(quote) ? (
                <section className="rounded-2xl border border-border/50 bg-card px-3.5 py-3 shadow-sm">
                  <h3 className="text-xs font-semibold text-text-primary">Duration</h3>
                  <p className="mt-1 text-sm text-text-primary">{formatQuoteDurationDisplay(quote)}</p>
                </section>
              ) : null}

              {quote.scope?.trim() ? (
                <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
                  <h3 className="border-b border-border/50 bg-surface/40 px-3.5 py-2.5 text-xs font-semibold text-text-primary">
                    Scope & notes
                  </h3>
                  <div className="max-h-[min(50vh,22rem)] overflow-y-auto px-3.5 py-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary/95">{quote.scope}</p>
                  </div>
                </section>
              ) : null}

              {quote.partner_id || quote.partner_name?.trim() ? (
                <section className="rounded-2xl border border-border/50 bg-card px-3.5 py-3 shadow-sm">
                  <h3 className="text-xs font-semibold text-text-primary">Partner</h3>
                  <p className="mt-1 text-sm font-medium text-text-primary">{quote.partner_name?.trim() || quote.partner_id}</p>
                  <p className="mt-1 text-sm text-text-secondary tabular-nums">
                    Agreed cost {formatCurrency(Number(quote.partner_cost) || 0)}
                  </p>
                </section>
              ) : null}

              <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
                <h3 className="border-b border-border/50 bg-surface/40 px-3.5 py-2.5 text-xs font-semibold text-text-primary">
                  Timeline
                </h3>
                <dl className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-3.5">
                  {(
                    [
                      ["Created", formatYmdUkDisplay(quote.created_at?.slice(0, 10) ?? "") || "—"],
                      ["Quote expires", formatYmdUkDisplay(quote.expires_at?.slice(0, 10) ?? "") || "—"],
                      ["Start option 1", formatYmdUkDisplay(quote.start_date_option_1?.slice(0, 10) ?? "") || "—"],
                      ["Start option 2", formatYmdUkDisplay(quote.start_date_option_2?.slice(0, 10) ?? "") || "—"],
                      [
                        "Customer PDF sent",
                        formatYmdUkDisplay(quote.customer_pdf_sent_at?.slice(0, 10) ?? "") || "Not sent",
                      ],
                      ["Owner", quote.owner_name?.trim() || "—"],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] text-text-secondary">{label}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-text-primary">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}

        {/* HISTORY TAB */}
        {tab === "history" && (
          <div className="p-6"><AuditTimeline entityType="quote" entityId={quote.id} /></div>
        )}
      </div>

      <Modal
        open={manualContinueOpen}
        onClose={() => setManualContinueOpen(false)}
        title="Manual quote · review & send"
        subtitle={`${bidPayloadTrimmedString(quote.reference as unknown) || "Quote"} — review figures, then send the PDF to the customer (Approval)`}
        size="lg"
        scrollBody
      >
        <CreateQuoteForm
          continuationQuote={quote}
          continuationSubmitting={manualContinueSending}
          onContinueManualDraft={handleDrawerContinueManual}
          onCancel={() => setManualContinueOpen(false)}
        />
      </Modal>

      {/* Invite Partner Modal */}
      <Modal
        open={invitePartnerOpen}
        onClose={() => {
          setInvitePartnerOpen(false);
          setInvitePartnerScopeEditing(false);
        }}
        title="Invite Partners"
        subtitle="Select partners to send this quote request"
        size="lg"
        scrollBody={false}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 min-w-0 p-4 sm:p-5">
          {/* Double-check: what partners receive context from */}
          <section
            aria-label="Account and site on this invitation"
            className="shrink-0 rounded-lg border border-border-light bg-card/90 dark:bg-card/60 px-3 py-2.5 sm:px-3.5 sm:py-3 space-y-2"
          >
            <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">
              Double-check — sent to partners
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 sm:gap-3">
              <div className="flex gap-2.5 min-w-0">
                {bidPayloadTrimmedString(quote.source_account_logo_url as unknown) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={bidPayloadTrimmedString(quote.source_account_logo_url as unknown)}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-md border border-border-light object-cover bg-surface-hover"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-light bg-surface-hover text-text-tertiary">
                    <Building2 className="h-4 w-4" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Account</p>
                  <p className="text-sm font-semibold text-text-primary leading-snug break-words">
                    {bidPayloadTrimmedString(quote.source_account_name as unknown) ||
                      bidPayloadTrimmedString(quote.client_name as unknown) ||
                      "—"}
                  </p>
                </div>
              </div>
              <div className="min-w-0 flex gap-2 border-t border-border-light pt-2 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-3">
                <MapPin className="h-3.5 w-3.5 text-text-tertiary shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Work site</p>
                  <p className="text-sm font-medium text-text-primary leading-snug break-words whitespace-pre-wrap">
                    {bidPayloadTrimmedString(quote.property_address as unknown) || "—"}
                  </p>
                  {bidPayloadTrimmedString(quote.postcode as unknown) ? (
                    <p className="text-[11px] text-text-secondary mt-0.5 tabular-nums">{bidPayloadTrimmedString(quote.postcode as unknown)}</p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="border-t border-border-light pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Type of work</p>
              <p className="mt-0.5 text-sm font-semibold text-text-primary leading-snug break-words">
                {invitePartnerTypeOfWork.trim() || "—"}
              </p>
            </div>
            <div className="border-t border-border-light pt-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Scope</p>
                <button
                  type="button"
                  onClick={() => {
                    setInvitePartnerScopeEditing((prev) => {
                      if (prev) return false;
                      queueMicrotask(() => invitePartnerScopeTextareaRef.current?.focus());
                      return true;
                    });
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border-light bg-card px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors touch-manipulation"
                  aria-expanded={invitePartnerScopeEditing}
                >
                  {invitePartnerScopeEditing ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Done
                    </>
                  ) : (
                    <>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </>
                  )}
                </button>
              </div>
              {invitePartnerScopeEditing ? (
                <textarea
                  ref={invitePartnerScopeTextareaRef}
                  value={invitePartnerScopeDraft}
                  onChange={(e) => setInvitePartnerScopeDraft(e.target.value)}
                  placeholder="What should partners price? (saved on this quote when you send)"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/15 min-h-[4.5rem]"
                />
              ) : (
                <p className="text-sm font-medium text-text-primary leading-snug whitespace-pre-wrap break-words rounded-md bg-surface-hover/40 border border-transparent px-2 py-1 min-h-[2.25rem]">
                  {invitePartnerScopeDraft.trim() ? invitePartnerScopeDraft : "— Tap Edit to describe the scope for partners."}
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Site photos</p>
              {((quote.images ?? []) as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0).length > 0 ? (
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
                  {(quote.images ?? [])
                    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
                    .map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border-light bg-surface-hover"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                </div>
              ) : (
                <p className="text-[11px] text-text-secondary leading-snug rounded-md border border-dashed border-border-light bg-surface-hover/50 px-2 py-1.5">
                  No site photos — add images on the quote if you want partners to see them.
                </p>
              )}
            </div>
          </section>

          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-light pb-2">
            <button
              type="button"
              onClick={() =>
                setSelectedPartnerIds(partnersEligibleForInvite.length ? new Set(partnersEligibleForInvite.map((p) => p.id)) : new Set())
              }
              className="text-xs font-medium text-primary hover:underline"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={inviteModalTradeMatchedPartners.length === 0}
              onClick={() =>
                setSelectedPartnerIds(new Set(inviteModalTradeMatchedPartners.map((p) => p.id).filter(Boolean)))
              }
              className="text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:pointer-events-none"
            >
              Select matched
            </button>
            <button
              type="button"
              disabled={!invitePartnerTypeOfWork.trim()}
              onClick={() =>
                setSelectedPartnerIds((prev) => {
                  const next = new Set(prev);
                  for (const p of partnersEligibleForInvite) {
                    if (p.id && safePartnerMatchesTypeOfWork(p, invitePartnerTypeOfWork, quote.catalog_service_id)) next.delete(p.id);
                  }
                  return next;
                })
              }
              className="text-xs font-medium text-amber-800 dark:text-amber-400 hover:underline disabled:opacity-40 disabled:pointer-events-none"
            >
              Deselect matched
            </button>
            <button type="button" onClick={() => setSelectedPartnerIds(new Set())} className="text-xs font-medium text-text-tertiary hover:underline">
              Clear selection
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary shrink-0">Partners</p>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border-light bg-card p-1.5 space-y-1.5 pb-2">
              {partnersEligibleForInviteSorted.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-10 px-4">No active partners found</p>
              ) : (
                partnersEligibleForInviteSorted.map((p) => {
                  const isSelected = selectedPartnerIds.has(p.id);
                  const isTradeMatch =
                    !!invitePartnerTypeOfWork.trim() &&
                    safePartnerMatchesTypeOfWork(p, invitePartnerTypeOfWork, quote.catalog_service_id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setSelectedPartnerIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        });
                      }}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Deselect" : "Select"} ${p.company_name}`}
                      className={cn(
                        "group flex min-h-[4rem] w-full min-w-0 touch-manipulation items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors sm:gap-3 sm:px-3.5 sm:py-3",
                        isSelected
                          ? "border-primary bg-[#020040]/[0.04] ring-2 ring-[#020040]/20 dark:bg-primary/[0.08] dark:border-primary dark:ring-primary/35"
                          : "border-border-light bg-transparent hover:bg-surface-hover hover:border-[#020040]/30 dark:hover:bg-surface-secondary/40",
                      )}
                    >
                      <Avatar name={p.company_name} size="md" src={p.avatar_url ?? undefined} className="shrink-0" />
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-sm font-semibold leading-tight text-text-primary line-clamp-2 sm:line-clamp-1">{p.company_name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-text-tertiary sm:line-clamp-1">
                          {isTradeMatch ? partnerMatchTypeLabel(p, invitePartnerTypeOfWork) : (p.trade || "Trade not set")}
                          {p.location?.trim() ? <> · {p.location}</> : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-row items-center gap-2.5">
                        <div className="flex min-h-[24px] w-[4.25rem] items-center justify-center sm:justify-end">
                          {isTradeMatch ? (
                            <span className="inline-flex rounded-full border border-[#020040]/25 bg-[#020040]/6 px-2 py-px text-[9px] font-bold uppercase tracking-wide text-[#020040] dark:border-primary/40 dark:bg-primary/15 dark:text-primary">
                              Match
                            </span>
                          ) : null}
                        </div>
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                            isSelected
                              ? "border-[#020040] bg-[#020040] text-white dark:border-primary dark:bg-primary"
                              : "border-border bg-card group-hover:border-[#020040]/35 dark:bg-surface-secondary",
                          )}
                        >
                          {isSelected ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : null}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border-light bg-card pt-3 mt-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs sm:text-sm text-text-tertiary text-center sm:text-left tabular-nums">
              {selectedPartnerIds.size === 0 ? "Select at least one partner" : `${selectedPartnerIds.size} selected`}
            </p>
            <Button
              size="sm"
              className="w-full sm:w-auto shrink-0"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={sendingInvitePush}
              disabled={selectedPartnerIds.size === 0 || sendingInvitePush}
              onClick={async () => {
                if (selectedPartnerIds.size === 0) return;
                setSendingInvitePush(true);
                try {
                  const partnerIds = Array.from(selectedPartnerIds);
                  const scopeMerged = bidPayloadTrimmedString(invitePartnerScopeDraft).trim();
                  if (!scopeMerged) {
                    throw new Error("Describe the work partners should bid on (scope).");
                  }
                  const titleNorm =
                    normalizeTypeOfWork(routingTitleDraft).trim() ||
                    normalizeTypeOfWork(bidPayloadTrimmedString(quote.service_type as unknown));
                  const svc = titleNorm;
                  const patched = await updateQuote(quote.id, {
                    scope: scopeMerged,
                    quote_type: "partner",
                    status: "bidding",
                    partner_quotes_count: partnerIds.length,
                    draft_route_completed: true,
                    ...(titleNorm ? { title: titleNorm } : {}),
                    ...(svc ? { service_type: svc } : {}),
                  });
                  onQuoteUpdate?.(patched);
                  const inviteBody =
                    `${patched.title} — ${patched.property_address ?? patched.client_name ?? ""}`.trim() ||
                    patched.reference;
                  const res = await fetch("/api/push/notify-partner", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      partnerIds,
                      title: "New quote invitation",
                      body: inviteBody,
                      data: {
                        type: "quote_invite",
                        quoteId: quote.id,
                        photoUrls: patched.images ?? quote.images ?? [],
                      },
                    }),
                  });
                  if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error((body && typeof body.error === "string" && body.error) || "Failed to send push invite");
                  }
                  const pushBody = (await res.json().catch(() => ({}))) as {
                    sent?: number;
                    errors?: number;
                    tokensFound?: number;
                  };
                  const sent = Number(pushBody?.sent ?? 0);
                  const tokensFound = Number(pushBody?.tokensFound ?? 0);
                  if (sent <= 0) {
                    throw new Error(
                      tokensFound <= 0
                        ? "No valid push token found for selected partner(s). Ask them to open the app and allow notifications."
                        : "Push request was accepted but not delivered (0 sent).",
                    );
                  }
                  const trade = bidPayloadTrimmedString(patched.service_type as unknown);
                  if (trade) {
                    void fetch("/api/push/notify-partner", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        trades: [trade],
                        title: "New Job Invitation",
                        body: `${patched.title} — ${patched.property_address ?? patched.client_name ?? ""}`,
                        data: { type: "quote_invite", quoteId: quote.id },
                      }),
                    }).catch(() => {});
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

/** Required fields before leaving draft/survey; partner bidding allows zero totals once scope is set. */
function quoteBasicsForPipeline(quote: Quote, nextStatus?: string): { ok: boolean; message?: string } {
  if (!bidPayloadTrimmedString(quote.client_name as unknown)) return { ok: false, message: "Fill client or account name (Step 1: Job details)." };
  if (!bidPayloadTrimmedString(quote.property_address as unknown)) return { ok: false, message: "Fill property address (Step 1: Job details)." };
  if (!bidPayloadTrimmedString(quote.title as unknown)) return { ok: false, message: "Fill job title / service (Step 1: Job details)." };
  const isPartner = (quote.quote_type ?? "internal") === "partner";
  if (isPartner && nextStatus === "bidding") {
    if (!bidPayloadTrimmedString(quote.scope as unknown)) {
      return { ok: false, message: "Add scope before starting bidding." };
    }
    return { ok: true };
  }
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

/** Monetary deposit expected on the quote (Stripe / customer pay before job). */
function quoteRequiresCustomerDeposit(quote: Quote): boolean {
  return Number(quote.deposit_required ?? 0) > 0.02;
}

function canAdvanceQuote(quote: Quote, nextStatus: string): { ok: boolean; message?: string } {
  if (quote.status === "draft" && (nextStatus === "in_survey" || nextStatus === "bidding")) {
    return quoteBasicsForPipeline(quote, nextStatus);
  }
  if ((quote.status === "draft" || quote.status === "in_survey") && nextStatus === "awaiting_customer") {
    const basics = quoteBasicsForPipeline(quote, nextStatus);
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

/** Customer has the proposal PDF / links (persisted timestamp, session send, or already in customer-facing statuses). */
function quoteCustomerHasReceivedProposal(quote: Quote, emailedInSession: boolean): boolean {
  if (emailedInSession) return true;
  if (bidPayloadTrimmedString(quote.customer_pdf_sent_at as unknown)) return true;
  if (quote.status === "awaiting_customer" || quote.status === "awaiting_payment") return true;
  return false;
}

function getQuoteActions(quote: Quote) {
  const isManual = (quote.quote_type ?? "internal") === "internal";
  switch (quote.status) {
    case "draft":
      if (quote.draft_route_completed !== true) {
        return [];
      }
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
          { label: "Back to New", status: "draft", icon: RotateCcw, primary: false },
          { label: "Reject", status: "rejected", icon: XCircle, primary: false },
        ];
      }
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Start Bidding", status: "bidding", icon: Send, primary: false },
        { label: "Back to New", status: "draft", icon: RotateCcw, primary: false },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "bidding":
      return [
        { label: "Send to Customer", status: "awaiting_customer", icon: Mail, primary: true },
        { label: "Back to New", status: "draft", icon: RotateCcw, primary: false },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "awaiting_customer":
      return [
        { label: "Approved", status: "approve_quote", icon: CheckCircle2, primary: true },
        { label: "Reject", status: "rejected", icon: XCircle, primary: false },
      ];
    case "awaiting_payment":
      return [
        { label: "Mark as Paid", status: "mark_as_paid", icon: CheckCircle2, primary: true },
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

function CreateJobFromQuoteModal({
  quote,
  onClose,
  onSubmit,
  markDepositAsPaid = false,
  recordedDepositAmount,
  initialCreateWithoutDeposit = false,
}: {
  quote: Quote | null;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    client_id?: string;
    client_address_id?: string;
    client_name: string;
    property_address: string;
    partner_id?: string;
    partner_name?: string;
    client_price: number;
    partner_cost: number;
    materials_cost: number;
    scheduled_date?: string;
    scheduled_start_at?: string;
    scheduled_end_at?: string;
    scheduled_finish_date?: string | null;
    expected_finish_at?: string | null;
    job_kind?: JobKind;
    series?: JobScheduleV2SeriesPayload;
    createWithoutDeposit?: boolean;
    depositOverrideReason?: string;
    job_type?: "fixed" | "hourly";
    scope?: string;
  }) => void | Promise<void>;
  /** When true, the caller will record the deposit as a received client payment on the newly created job. */
  markDepositAsPaid?: boolean;
  /** Explicit £ deposit (e.g. after operator adjusted amount in confirm step); falls back to quote.deposit_required. */
  recordedDepositAmount?: number;
  /** From Approval gate: pre-check “create without deposit” when waiver is required. */
  initialCreateWithoutDeposit?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    partner_id: "",
    client_price: "",
    partner_cost: "",
    materials_cost: "",
    scheduled_date: "",
    arrival_from: "09:00",
    arrival_window_mins: "180",
    job_kind: "one_off" as JobKind,
    end_date: "",
    end_time: "17:00",
    scope: "",
    createWithoutDeposit: false,
    job_type: "fixed",
  });
  const [recurrence, setRecurrence] = useState<RecurrenceFormState>(DEFAULT_RECURRENCE_FORM);
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [partners, setPartners] = useState<Partner[]>([]);
  /** DB / approved-bid partner when not in `partners` list (label for Select + submit). */
  const [partnerFromQuote, setPartnerFromQuote] = useState<{ id: string; name: string } | null>(null);
  const [towCatalog, setTowCatalog] = useState<CatalogService[]>([]);
  useEffect(() => {
    void listCatalogServicesForPicker().then(setTowCatalog).catch(() => setTowCatalog([]));
  }, []);
  /** Account inherited from the quote (via client.source_account_id or property.account_id). */
  const [linkedAccount, setLinkedAccount] = useState<{
    id: string;
    name: string;
    email: string | null;
    logoUrl: string | null;
  } | null>(null);
  /** When true → render the ClientAddressPicker below and attach a contact. When false → use the account only. */
  const [addContactClient, setAddContactClient] = useState<boolean>(true);
  /** Manual property/site address used in the "no contact client" branch. */
  const [manualPropertyAddress, setManualPropertyAddress] = useState<string>("");
  /** Deposit override fields — only relevant when coming from "Create Job" and deposit_required > 0. */
  const [depositOverrideReason, setDepositOverrideReason] = useState<string>("");
  const [depositOverrideAgreed, setDepositOverrideAgreed] = useState<boolean>(false);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot form bootstrap when modal opens (parent uses key=quote.id) */
  useEffect(() => {
    if (!quote) return;
    const depositRequiredBootstrap = Math.max(0, Number(quote.deposit_required ?? 0));
    const presetWaiver =
      initialCreateWithoutDeposit === true && !markDepositAsPaid && depositRequiredBootstrap > 0.02;
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
      job_kind: "one_off",
      end_date: "",
      end_time: "17:00",
      scope: qScope,
      createWithoutDeposit: presetWaiver,
      job_type: "fixed",
    });
    setRecurrence(DEFAULT_RECURRENCE_FORM);
    setClientAddress({
      client_id: quote.client_id ?? undefined,
      client_address_id: quote.client_address_id ?? undefined,
      client_name: quote.client_name ?? "",
      client_email: quote.client_email ?? undefined,
      property_address: quote.property_address ?? "",
    });
    listPartners({ pageSize: 200, status: "active" }).then((r) => setPartners(r.data ?? []));
    let cancelled = false;
    setLinkedAccount(null);
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
      let resolvedAddr = q.property_address ?? "";
      let accountId =
        bidPayloadTrimmedString((q as { source_account_id?: unknown }).source_account_id)?.trim() || null;
      if (!resolvedAddr.trim() && q.property_id?.trim()) {
        const prop = await getAccountProperty(String(q.property_id).trim()).catch(() => null);
        if (prop?.full_address) resolvedAddr = prop.full_address;
        if (!accountId && prop?.account_id?.trim()) accountId = prop.account_id.trim();
      }
      try {
        if (!accountId && q.client_id?.trim()) {
          accountId = await resolveCorporateAccountIdForClient(q.client_id.trim());
        }
        if (!accountId && q.property_id?.trim()) {
          const propAcct = await getAccountProperty(String(q.property_id).trim()).catch(() => null);
          if (propAcct?.account_id?.trim()) accountId = propAcct.account_id.trim();
        }
        if (cancelled) return;
        if (accountId) {
          const acc = await getAccount(accountId);
          if (!cancelled && acc) {
            setLinkedAccount({
              id: acc.id,
              name: (acc.company_name || acc.contact_name || "—").trim(),
              email: (acc.email ?? "").trim() || null,
              logoUrl: (acc.logo_url ?? "").trim() || null,
            });
            setAddContactClient(true);
          } else if (!cancelled) {
            setLinkedAccount(null);
          }
        } else if (!cancelled) {
          setLinkedAccount(null);
        }
      } catch {
        if (!cancelled) setLinkedAccount(null);
      }

      setClientAddress({
        client_id: q.client_id ?? undefined,
        client_address_id: q.client_address_id ?? undefined,
        client_name: q.client_name ?? "",
        client_email: q.client_email ?? undefined,
        property_address: resolvedAddr,
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
    setAddContactClient(true);
    setManualPropertyAddress(quote.property_address ?? "");
    setDepositOverrideReason("");
    setDepositOverrideAgreed(false);
    return () => {
      cancelled = true;
    };
  }, [quote, initialCreateWithoutDeposit, markDepositAsPaid]);
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
    () => typeOfWorkLabelsFromCatalog(towCatalog, form.title).map((name) => ({ value: name, label: name })),
    [towCatalog, form.title],
  );

  if (!quote) return null;
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const depositRequired = Math.max(0, Number(quote.deposit_required ?? 0));
  const showDepositOverride = !markDepositAsPaid && depositRequired > 0.02;
  const overrideActive = showDepositOverride && form.createWithoutDeposit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.title?.trim()) { toast.error("Job title is required"); return; }

    const useContactOnJob = Boolean(linkedAccount) || addContactClient;

    if (linkedAccount) {
      if (!clientAddress.client_id?.trim()) {
        toast.error(
          `Choose a contact from ${linkedAccount.name} (pick from the list — only contacts on this account are shown).`,
        );
        return;
      }
      if (!clientAddress.property_address?.trim()) {
        toast.error("Choose a property address before creating the job.");
        return;
      }
    } else if (addContactClient) {
      if (!clientAddress.client_id?.trim()) {
        toast.error("Select a client from the list (click the name or press Enter) — typing alone does not link the client.");
        return;
      }
      if (!clientAddress.property_address?.trim()) {
        toast.error("Choose a property address or add a new one under Property address.");
        return;
      }
    } else {
      if (!manualPropertyAddress.trim()) {
        toast.error("Add the property / site address before creating the job.");
        return;
      }
    }
    if (overrideActive) {
      if (!depositOverrideReason.trim()) {
        toast.error("Add a reason for overriding the deposit.");
        return;
      }
      if (!depositOverrideAgreed) {
        toast.error("Confirm you accept responsibility for overriding the deposit.");
        return;
      }
    }
    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    const partnerNameResolved =
      selectedPartner?.company_name ||
      selectedPartner?.contact_name ||
      (partnerFromQuote?.id === form.partner_id ? partnerFromQuote.name : undefined) ||
      bidPayloadTrimmedString(quote.partner_name as unknown) ||
      undefined;
    const effectivePartnerId = form.partner_id || partnerFromQuote?.id || quote.partner_id;
    const schedV2 = resolveJobModalScheduleV2({
      kind: form.job_kind,
      scheduled_date: form.scheduled_date,
      arrival_from: form.arrival_from,
      arrival_window_mins: form.arrival_window_mins,
      end_date: form.end_date,
      end_time: form.end_time,
      recurrence,
      hasPartner: !!effectivePartnerId,
    });
    if (!schedV2.ok) {
      toast.error(schedV2.error);
      return;
    }
    const scheduled_finish_date: string | null = schedV2.payload.scheduled_finish_date ?? null;
    const expected_finish_at: string | null = schedV2.payload.expected_finish_at ?? null;
    const job_kind: JobKind = schedV2.payload.job_kind;

    const scheduled_date = parseIsoDateOnly(schedV2.payload.scheduled_date ?? "") || undefined;
    let scheduled_start_at: string | undefined = schedV2.payload.scheduled_start_at;
    let scheduled_end_at: string | undefined = schedV2.payload.scheduled_end_at;
    if (!scheduled_date) {
      scheduled_start_at = undefined;
      scheduled_end_at = undefined;
    } else {
      if (!isValidIsoDateTime(scheduled_start_at)) scheduled_start_at = undefined;
      if (!isValidIsoDateTime(scheduled_end_at)) scheduled_end_at = undefined;
    }
    const scopeTrimmed = (form.scope ?? "").trim();
    if (effectivePartnerId) {
      const block = getPartnerAssignmentBlockReason({
        property_address: useContactOnJob ? clientAddress.property_address : manualPropertyAddress,
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
    const effectiveClientName = useContactOnJob
      ? clientAddress.client_name
      : (linkedAccount?.name || quote.client_name || "");
    const effectivePropertyAddress = useContactOnJob ? clientAddress.property_address : manualPropertyAddress.trim();
    setSubmitting(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        client_id: useContactOnJob ? clientAddress.client_id : undefined,
        client_address_id: useContactOnJob ? clientAddress.client_address_id : undefined,
        client_name: effectiveClientName,
        property_address: effectivePropertyAddress,
        partner_id: form.partner_id || undefined,
        partner_name: partnerNameResolved,
        client_price: Number(form.client_price) || 0,
        partner_cost: Number(form.partner_cost) || 0,
        materials_cost: Number(form.materials_cost) || 0,
        scheduled_date,
        scheduled_start_at,
        scheduled_end_at,
        scheduled_finish_date,
        expected_finish_at,
        job_kind,
        series: schedV2.series,
        createWithoutDeposit: overrideActive,
        depositOverrideReason: overrideActive ? depositOverrideReason.trim() : undefined,
        job_type: form.job_type as "fixed" | "hourly",
        scope: scopeTrimmed || (quote.scope ?? "").trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const depositForBanner = markDepositAsPaid
    ? (recordedDepositAmount != null && Number.isFinite(recordedDepositAmount)
        ? Math.max(0, recordedDepositAmount)
        : Math.max(0, Number(quote.deposit_required ?? 0)))
    : 0;

  return (
    <Modal
      open={!!quote}
      onClose={onClose}
      title={markDepositAsPaid ? "Mark as paid & create job" : "Create Job from Quote"}
      subtitle={`${quote.reference} — ${markDepositAsPaid ? "record deposit paid & create job" : "create job"}`}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {markDepositAsPaid && depositForBanner > 0.02 ? (
          <div className="rounded-lg border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-200">
            <p className="font-semibold">Deposit will be recorded as paid</p>
            <p className="mt-0.5 opacity-90">
              After the job is created, a client payment of {formatCurrency(depositForBanner)} will be logged as customer deposit received.
            </p>
          </div>
        ) : null}
        <div className="rounded-xl border border-border bg-surface/60 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Account *</p>
              {linkedAccount ? (
                <div className="mt-1 flex items-center gap-2 min-w-0">
                  {linkedAccount.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={linkedAccount.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-md border border-border object-contain bg-white" />
                  ) : (
                    <div className="h-7 w-7 shrink-0 rounded-md border border-border bg-surface flex items-center justify-center text-[10px] font-semibold uppercase text-text-tertiary">
                      {linkedAccount.name.slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{linkedAccount.name}</p>
                    {linkedAccount.email ? (
                      <p className="truncate text-[11px] text-text-secondary">{linkedAccount.email}</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-text-secondary">
                  No corporate account tied to this quote yet (missing source account on the quote, client link, or asset).
                  Pick a contact below without account restriction, or cancel and resolve the quote first.
                </p>
              )}
            </div>
          </div>
          {linkedAccount ? (
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                  Contact client <span className="text-primary">*</span>
                </label>
                <p className="text-[10px] text-text-tertiary mb-1.5">
                  Required — choose someone under <span className="font-medium text-text-secondary">{linkedAccount.name}</span>. Typing alone does not link.
                </p>
              </div>
              {!quote.client_id ? (
                <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-text-secondary dark:border-primary/30 dark:bg-primary/10">
                  This quote has no linked contact yet. Select or create a client from this account below before creating the job.
                </p>
              ) : null}
              <ClientAddressPicker
                value={clientAddress}
                onChange={setClientAddress}
                loadAllClientsOnOpen
                restrictToSourceAccountId={linkedAccount.id}
              />
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border/70 bg-card/60 p-2.5">
                <p className="text-[11px] font-medium text-text-secondary mb-1.5">Bill this job to:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAddContactClient(true)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${addContactClient ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-text-secondary hover:bg-surface"}`}
                  >
                    Contact client
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddContactClient(false)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${!addContactClient ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-text-secondary hover:bg-surface"}`}
                  >
                    Site address only (no named contact)
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-text-tertiary">
                  {addContactClient
                    ? "Search any client when no account is pinned on this quote."
                    : "Enter the property address below — no personal contact will be attached to the job."}
                </p>
              </div>
              {addContactClient ? (
                <div>
                  {!quote.client_id ? (
                    <p className="mb-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-text-secondary dark:border-primary/30 dark:bg-primary/10">
                      Select or create a contact before creating the job.
                    </p>
                  ) : null}
                  <ClientAddressPicker value={clientAddress} onChange={setClientAddress} loadAllClientsOnOpen />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Property / site address *</label>
                  <Input
                    value={manualPropertyAddress}
                    onChange={(e) => setManualPropertyAddress(e.target.value)}
                    placeholder="Full site address for the job"
                  />
                  <p className="mt-1 text-[10px] text-text-tertiary">Pre-filled from the quote property address when available.</p>
                </div>
              )}
            </>
          )}
        </div>
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
            { value: "fixed", label: pricingModeLabel("fixed") },
            { value: "hourly", label: pricingModeLabel("hourly") },
          ]}
        />
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
          jobKind={form.job_kind}
          scheduledDate={form.scheduled_date}
          arrivalFrom={form.arrival_from}
          arrivalWindowMins={form.arrival_window_mins}
          endDate={form.end_date}
          endTime={form.end_time}
          recurrence={recurrence}
          onRecurrenceChange={(patch) => setRecurrence((r) => ({ ...r, ...patch }))}
          onChange={(field, v) => update(field, v)}
          startDateRequired={form.job_kind !== "one_off" || !!form.scheduled_date?.trim()}
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
        {showDepositOverride ? (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 space-y-2 dark:border-amber-500/30 dark:bg-amber-950/20">
            <div>
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Deposit required on this quote</p>
              <p className="mt-0.5 text-[11px] text-amber-700/90 dark:text-amber-200/80">
                A deposit of {formatCurrency(depositRequired)} ({quote.deposit_percent || 0}%) is due. Override only when justified.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.createWithoutDeposit}
                onChange={(e) => setForm((p) => ({ ...p, createWithoutDeposit: e.target.checked }))}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs font-medium text-text-primary">Override deposit (create job without deposit)</span>
            </label>
            {overrideActive ? (
              <div className="space-y-2 pl-6">
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">Reason for override *</label>
                  <textarea
                    value={depositOverrideReason}
                    onChange={(e) => setDepositOverrideReason(e.target.value)}
                    rows={2}
                    placeholder="Why are we proceeding without the deposit? (logged for audit)"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                  />
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={depositOverrideAgreed}
                    onChange={(e) => setDepositOverrideAgreed(e.target.checked)}
                    className="mt-0.5 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-[11px] leading-snug text-text-secondary">
                    I confirm the client has agreed to the job terms without a deposit and I accept responsibility for this override.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} type="button" disabled={submitting}>Cancel</Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Creating job…
              </>
            ) : (
              "Create Job"
            )}
          </Button>
        </div>
      </form>
      {submitting ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/70 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2 shadow-md">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-text-primary">Creating job…</span>
          </div>
        </div>
      ) : null}
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
  continuationQuote,
  onContinueManualDraft,
  variant = "full",
  continuationSubmitting = false,
  routingCollectTrade = false,
}: {
  onSubmit?: (
    d: Partial<Quote>,
    options?: { manualLineItems?: ProposalLineRow[]; oneShotBiddingPartnerIds?: string[]; sendToCustomer?: boolean },
  ) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  continuationQuote?: Quote | null;
  onContinueManualDraft?: (
    quoteId: string,
    patch: Partial<Quote>,
    options?: {
      manualLineItems?: ProposalLineRow[];
      sendToCustomer?: boolean;
      markAsSentExternally?: boolean;
    },
  ) => Promise<void>;
  /** `routing_minimal` — account, site, scope, photos only (draft stays in New). */
  variant?: "full" | "routing_minimal";
  continuationSubmitting?: boolean;
  /** When true with `routing_minimal`, collect type of work in this modal (New bidding → partner invite flow). */
  routingCollectTrade?: boolean;
}) {
  const [quoteType, setQuoteType] = useState<"internal" | "partner">("internal");
  const [form, setForm] = useState({ title: "", total_value: "" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [lineItems, setLineItems] = useState<ProposalLineRow[]>(() => seedManualProposalLines(""));
  const [scopeText, setScopeText] = useState("");
  const [startDate1, setStartDate1] = useState("");
  const [startDate2, setStartDate2] = useState("");
  const [depositPercent, setDepositPercent] = useState("50");
  const [depositInputMode, setDepositInputMode] = useState<"percent" | "amount">("percent");
  const [depositAmountInput, setDepositAmountInput] = useState("");
  /** When disabled, the quote will skip the Awaiting Payment stage and convert directly to a job on customer accept. */
  const [depositRequiredEnabled, setDepositRequiredEnabled] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [towCatalog, setTowCatalog] = useState<CatalogService[]>([]);
  useEffect(() => {
    void listCatalogServicesForPicker().then(setTowCatalog).catch(() => setTowCatalog([]));
  }, []);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [invitePhotos, setInvitePhotos] = useState<File[]>([]);
  const [invitePhotoPreviews, setInvitePhotoPreviews] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const inviteUploadFolderRef = useRef(`create-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`);
  const quoteTypePrevRef = useRef(quoteType);
  const [accountRows, setAccountRows] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [addContactClient, setAddContactClient] = useState(true);
  /** Free-text work address when there is no contact on the quote — stored only on the quote row, not as an account property. */
  const [manualSiteAddress, setManualSiteAddress] = useState("");
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const selectedAccountLabel = useMemo(() => {
    const a = accountRows.find((x) => x.id === selectedAccountId);
    return (
      bidPayloadTrimmedString(a?.company_name as unknown) ||
      bidPayloadTrimmedString(a?.contact_name as unknown) ||
      ""
    );
  }, [accountRows, selectedAccountId]);
  const linePartnerTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.partnerUnitCost) || 0), 0);
  const lineSellTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const createProposalMarginAbs = lineSellTotal - linePartnerTotal;
  const createProposalMarginPct = marginPctOnSell(lineSellTotal, linePartnerTotal);
  const createDepositAmount = useMemo(() => {
    if (depositInputMode === "amount") {
      const raw = Math.max(0, Number(depositAmountInput) || 0);
      return lineSellTotal > 0 ? Math.min(lineSellTotal, Math.round(raw * 100) / 100) : 0;
    }
    return depositAmountFromPercent(lineSellTotal, Number(depositPercent));
  }, [depositInputMode, depositAmountInput, lineSellTotal, depositPercent]);
  const createInferredDepositPercent = useMemo(() => {
    if (lineSellTotal < 0.01) return 0;
    return inferDepositPercentFromLegacy(createDepositAmount, lineSellTotal);
  }, [lineSellTotal, createDepositAmount]);
  const minCreateStartDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [marginPct, setMarginPct] = useState(0);
  const [routingInviteBusy, setRoutingInviteBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);

  const updateCreateLineItem = (idx: number, field: keyof ProposalLineRow, value: string) => {
    setLineItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };
  const typeOfWorkOptions = useMemo(
    () =>
      typeOfWorkLabelsFromCatalog(towCatalog, form.title)
        .map((name) => ({ value: name, label: name })),
    [towCatalog, form.title],
  );

  const partnersForTrade = useMemo(() => {
    const t = form.title.trim();
    if (!t) return [];
    return partners.filter((p) => isPartnerEligibleForWork(p) && safePartnerMatchesTypeOfWork(p, t));
  }, [partners, form.title]);

  useEffect(() => {
    if (quoteType !== "partner" && !(routingCollectTrade && variant === "routing_minimal")) return;
    setPartnersLoading(true);
    listPartners({ pageSize: 200, status: "active" })
      .then((r) => setPartners(r.data ?? []))
      .catch(() => setPartners([]))
      .finally(() => setPartnersLoading(false));
  }, [quoteType, routingCollectTrade, variant]);

  useEffect(() => {
    if (quoteType !== "partner" && !(routingCollectTrade && variant === "routing_minimal")) return;
    if (!form.title.trim()) {
      setSelectedPartnerIds(new Set());
      return;
    }
    setSelectedPartnerIds((prev) => {
      const allowed = new Set(partnersForTrade.map((p) => p.id));
      return new Set([...prev].filter((id) => allowed.has(id)));
    });
  }, [quoteType, routingCollectTrade, variant, form.title, partnersForTrade]);

  useEffect(() => {
    const prev = quoteTypePrevRef.current;
    quoteTypePrevRef.current = quoteType;
    if (quoteType !== "internal" || prev === "internal") return;
    setLineItems(seedManualProposalLines(form.title));
    setDepositPercent("50");
    setDepositInputMode("percent");
    setDepositAmountInput("");
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

  useEffect(() => {
    setAccountsLoading(true);
    listAccounts({ page: 1, pageSize: 500, status: "all" })
      .then((r) => setAccountRows(r.data ?? []))
      .catch(() => setAccountRows([]))
      .finally(() => setAccountsLoading(false));
  }, []);

  /** New quote / New bidding modals must never fall through to the full partner-invite branch (duplicate scope + partner pickers). */
  useLayoutEffect(() => {
    if (variant === "routing_minimal") setQuoteType("internal");
  }, [variant]);

  useEffect(() => {
    setClientAddress({ client_name: "", property_address: "" });
    setManualSiteAddress("");
  }, [selectedAccountId]);

  useEffect(() => {
    if (!continuationQuote?.id) return;
    let cancelled = false;
    void (async () => {
      const cq = continuationQuote;
      const t = cq.title ?? "";
      setQuoteType("internal");
      setForm({ title: t, total_value: String(cq.total_value ?? "") });
      setScopeText(bidPayloadTrimmedString(cq.scope as unknown));
      setStartDate1(normalizeCalendarDateToYmd(bidPayloadTrimmedString(cq.start_date_option_1 as unknown)) || "");
      setStartDate2(normalizeCalendarDateToYmd(bidPayloadTrimmedString(cq.start_date_option_2 as unknown)) || "");
      const dPctRaw = cq.deposit_percent;
      setDepositPercent(
        dPctRaw != null && Number.isFinite(Number(dPctRaw))
          ? String(Number(dPctRaw))
          : String(inferDepositPercentFromLegacy(Number(cq.deposit_required ?? 0), Number(cq.total_value ?? 0))),
      );
      setDepositInputMode("percent");
      setDepositAmountInput((Math.round((Number(cq.deposit_required ?? 0) || 0) * 100) / 100).toFixed(2));
      const hasDeposit = Number(cq.deposit_required ?? 0) > 0.02 || Number(dPctRaw ?? 0) > 0;
      setDepositRequiredEnabled(hasDeposit);
      const supabase = getSupabase();
      const { data } = await supabase.from("quote_line_items").select("*").eq("quote_id", cq.id).order("sort_order");
      if (cancelled) return;
      if (data && data.length > 0) {
        setLineItems(
          data.map(
            (
              li: {
                description: string;
                quantity: number;
                unit_price: number;
                partner_unit_cost?: number | null;
                notes?: string | null;
              },
              i: number,
            ) => ({
              description:
                i < 2
                  ? stripPartnerLineIndexSuffix(bidPayloadTrimmedString(li.description as unknown))
                  : bidPayloadTrimmedString(li.description as unknown),
              quantity: String(li.quantity ?? 1),
              unitPrice: String(li.unit_price ?? 0),
              partnerUnitCost: String(li.partner_unit_cost ?? 0),
              notes: bidPayloadTrimmedString(li.notes as unknown),
            }),
          ),
        );
      } else {
        setLineItems(seedManualProposalLines(t));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [continuationQuote?.id]);

  const submitManualContinuation = async (mode: "email_customer" | "mark_sent_external") => {
    if (!continuationQuote || !onContinueManualDraft) return;
    if (!form.title?.trim()) {
      toast.error("Type of work is required");
      return;
    }
    if (quoteType !== "internal") {
      toast.error("Use manual (build lines yourself) on this modal");
      return;
    }
    const durNumCo = Math.round(Number(continuationQuote.duration_value ?? 1) * 1000) / 1000;
    if (!Number.isFinite(durNumCo) || durNumCo <= 0) {
      toast.error("Enter a duration greater than zero.");
      return;
    }
    const scopeFromLineItems = lineItems.map((li) => li.description.trim()).filter(Boolean).join("\n");
    const scopeResolvedInternal =
      bidPayloadTrimmedString(scopeText as unknown).trim() || scopeFromLineItems.trim() || undefined;
    let depPctCo = 0;
    let depAmtCo = 0;
    if (depositRequiredEnabled) {
      if (depositInputMode === "amount") {
        const raw = Math.max(0, Number(depositAmountInput) || 0);
        depAmtCo = lineSellTotal > 0 ? Math.min(lineSellTotal, Math.round(raw * 100) / 100) : 0;
        depPctCo = inferDepositPercentFromLegacy(depAmtCo, lineSellTotal);
      } else {
        depPctCo = clampDepositPercent(Number(depositPercent));
        depAmtCo = depositAmountFromPercent(lineSellTotal, depPctCo);
      }
    }
    try {
      await onContinueManualDraft(
        continuationQuote.id,
        {
          title: normalizeTypeOfWork(form.title),
          total_value: lineSellTotal > 0 ? lineSellTotal : linePartnerTotal,
          cost: linePartnerTotal,
          partner_cost: linePartnerTotal,
          sell_price: lineSellTotal > 0 ? lineSellTotal : linePartnerTotal,
          margin_percent: marginPct,
          scope: scopeResolvedInternal,
          start_date_option_1: startDate1 || undefined,
          start_date_option_2: startDate2 || undefined,
          deposit_percent: depPctCo,
          deposit_required: depAmtCo,
          ...(form.title.trim() ? { service_type: form.title.trim() } : {}),
          duration_value: durNumCo,
          duration_unit: (continuationQuote.duration_unit as QuoteDurationUnit) ?? "week",
          engagement_kind:
            continuationQuote.engagement_kind === "recurring"
              ? "recurring"
              : ("one_off" as QuoteEngagementKind),
        },
        {
          manualLineItems: lineItems,
          ...(mode === "email_customer"
            ? { sendToCustomer: true }
            : { markAsSentExternally: true }),
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save or send");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.title?.trim()) {
      toast.error("Type of work is required");
      return;
    }
    const scopeFromLineItems = lineItems
      .map((li) => li.description.trim())
      .filter(Boolean)
      .join("\n");
    const scopeResolvedInternal =
      bidPayloadTrimmedString(scopeText as unknown).trim() || scopeFromLineItems.trim() || undefined;

    if (continuationQuote && onContinueManualDraft) {
      await submitManualContinuation("email_customer");
      return;
    }

    if (variant === "routing_minimal") {
      if (!onSubmit) {
        toast.error("Form is missing a save handler");
        return;
      }
      if (!selectedAccountId.trim()) {
        toast.error("Select an account");
        return;
      }
      if (addContactClient) {
        if (!clientAddress.client_id) {
          toast.error("Select a client from the list (click the name or press Enter) — typing alone does not link the client.");
          return;
        }
        if (!clientAddress.property_address?.trim()) {
          toast.error("Choose a property address or add a new one under Property address.");
          return;
        }
      } else {
        const addr = manualSiteAddress.trim();
        if (!addr) {
          toast.error("Enter the property / work address.");
          return;
        }
      }
      const scopeRouting = bidPayloadTrimmedString(scopeText as unknown).trim();
      if (!scopeRouting) {
        toast.error("Describe the scope — you can refine it before inviting partners.");
        return;
      }

      const routingTitleStored = normalizeTypeOfWork(form.title).trim();
      if (!routingTitleStored) {
        toast.error("Select type of work");
        return;
      }
      if (routingCollectTrade) {
        if (partnersForTrade.length === 0) {
          toast.error("No partners match this type of work yet — add partners in Directory or choose another trade.");
          return;
        }
        if (selectedPartnerIds.size === 0) {
          toast.error("Select at least one partner");
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
              ? `${err.message} Continuing without photos.`
              : "Failed to upload images. Continuing without photos.",
          );
          imageUrls = undefined;
        }
        setUploadingPhotos(false);
      }

      const accountDisplayName = selectedAccountLabel || "Account";
      const noClientAddress = addContactClient ? clientAddress.property_address : manualSiteAddress.trim();
      const addrTrim = bidPayloadTrimmedString(noClientAddress as unknown).trim();
      const postcodeFromAddr = addrTrim ? extractUkPostcode(addrTrim) : null;
      const payload: Partial<Quote> = {
        title: routingTitleStored,
        ...(addContactClient
          ? {
              client_id: clientAddress.client_id,
              client_address_id: clientAddress.client_address_id,
              client_name: clientAddress.client_name,
              client_email: clientAddress.client_email ?? "",
              property_address: addrTrim,
              ...(postcodeFromAddr ? { postcode: postcodeFromAddr } : {}),
            }
          : {
              client_name: accountDisplayName,
              client_email: "",
              property_address: addrTrim,
              ...(postcodeFromAddr ? { postcode: postcodeFromAddr } : {}),
              ...(selectedAccountId.trim()
                ? { source_account_id: selectedAccountId.trim() }
                : {}),
            }),
        catalog_service_id: null,
        total_value: 0,
        cost: 0,
        sell_price: 0,
        margin_percent: 0,
        quote_type: "internal",
        status: "draft",
        scope: scopeRouting,
        deposit_percent: 50,
        deposit_required: 0,
        service_type: routingTitleStored,
        ...(imageUrls?.length ? { images: imageUrls } : {}),
        duration_value: 1,
        duration_unit: "week",
        engagement_kind: "one_off",
      };
      setRoutingInviteBusy(true);
      try {
        const ok = await onSubmit(
          payload,
          routingCollectTrade ? { oneShotBiddingPartnerIds: Array.from(selectedPartnerIds) } : undefined,
        );
        if (ok === false) return;
        inviteUploadFolderRef.current = `create-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
        setForm({ title: "", total_value: "" });
        setSelectedAccountId("");
        setAddContactClient(true);
        setManualSiteAddress("");
        setClientAddress({ client_name: "", property_address: "" });
        setLineItems(seedManualProposalLines(""));
        setScopeText("");
        setDepositPercent("50");
        setDepositInputMode("percent");
        setDepositAmountInput("");
        setStartDate1("");
        setStartDate2("");
        setQuoteType("internal");
        setPartners([]);
        setSelectedPartnerIds(new Set());
        setInvitePhotos([]);
        setInvitePhotoPreviews((prev) => {
          prev.forEach((u) => URL.revokeObjectURL(u));
          return [];
        });
      } finally {
        setRoutingInviteBusy(false);
      }
      return;
    }

    if (!onSubmit) {
      toast.error("Form is missing a save handler");
      return;
    }

    if (!selectedAccountId.trim()) {
      toast.error("Select an account");
      return;
    }
    if (addContactClient) {
      if (!clientAddress.client_id) {
        toast.error("Select a client from the list (click the name or press Enter) — typing alone does not link the client.");
        return;
      }
      if (!clientAddress.property_address?.trim()) {
        toast.error("Choose a property address or add a new one under Property address.");
        return;
      }
    } else {
      const addr = manualSiteAddress.trim();
      if (!addr) {
        toast.error("Enter the property / work address.");
        return;
      }
    }
    const scopePartnerTrim = bidPayloadTrimmedString(scopeText as unknown).trim();
    if (quoteType === "partner") {
      if (partnersForTrade.length === 0) {
        toast.error("No partners match this type of work yet — add partners in Directory or choose another trade.");
        return;
      }
      if (selectedPartnerIds.size === 0) {
        toast.error("Please select at least one partner");
        return;
      }
      if (!scopePartnerTrim) {
        toast.error("Enter the scope — partners see this on the invitation.");
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
            : "Failed to upload images. Continuing without photos.",
        );
        imageUrls = undefined;
      }
      setUploadingPhotos(false);
    }

    let depPct = 0;
    let depAmt = 0;
    if (depositRequiredEnabled) {
      if (depositInputMode === "amount") {
        const raw = Math.max(0, Number(depositAmountInput) || 0);
        depAmt = lineSellTotal > 0 ? Math.min(lineSellTotal, Math.round(raw * 100) / 100) : 0;
        depPct = inferDepositPercentFromLegacy(depAmt, lineSellTotal);
      } else {
        depPct = clampDepositPercent(Number(depositPercent));
        depAmt = depositAmountFromPercent(lineSellTotal, depPct);
      }
    }

    const accountDisplayName = selectedAccountLabel || "Account";
    const noClientAddress = addContactClient ? clientAddress.property_address : manualSiteAddress.trim();

    const payload: Partial<Quote> = {
      title: normalizeTypeOfWork(form.title),
      ...(addContactClient
        ? {
            client_id: clientAddress.client_id,
            client_address_id: clientAddress.client_address_id,
            client_name: clientAddress.client_name,
            client_email: clientAddress.client_email ?? "",
            property_address: noClientAddress,
          }
        : {
            client_name: accountDisplayName,
            client_email: "",
            property_address: noClientAddress,
            ...(selectedAccountId.trim()
              ? { source_account_id: selectedAccountId.trim() }
              : {}),
          }),
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
      scope: quoteType === "internal" ? scopeResolvedInternal : scopePartnerTrim || undefined,
      start_date_option_1: quoteType === "internal" ? startDate1 || undefined : undefined,
      start_date_option_2: quoteType === "internal" ? startDate2 || undefined : undefined,
      deposit_percent: quoteType === "internal" ? depPct : 50,
      deposit_required: quoteType === "internal" ? depAmt : 0,
      ...(form.title.trim() ? { service_type: form.title.trim() } : {}),
      ...(imageUrls?.length ? { images: imageUrls } : {}),
      duration_value: 1,
      duration_unit: "week",
      engagement_kind: "one_off",
    };
    setSubmitBusy(true);
    try {
      const second =
        quoteType === "internal"
          ? { manualLineItems: lineItems, sendToCustomer: true }
          : undefined;
      const ok = await Promise.resolve(onSubmit(payload, second));
      if (ok === false) return;
      inviteUploadFolderRef.current = `create-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
      setForm({ title: "", total_value: "" });
      setSelectedAccountId("");
      setAddContactClient(true);
      setManualSiteAddress("");
      setClientAddress({ client_name: "", property_address: "" });
      setLineItems(seedManualProposalLines(""));
      setScopeText("");
      setDepositPercent("50");
      setDepositInputMode("percent");
      setDepositAmountInput("");
      setStartDate1("");
      setStartDate2("");
      setQuoteType("internal");
      setPartners([]);
      setSelectedPartnerIds(new Set());
      setInvitePhotos([]);
      setInvitePhotoPreviews((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
    } finally {
      setSubmitBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
      <div className="max-h-[min(65dvh,520px)] overflow-y-auto overscroll-contain px-4 py-4 sm:max-h-[min(72dvh,580px)] sm:px-6 sm:py-5">
        <div className="space-y-4">
      {continuationQuote ? (
        <div className="rounded-xl border border-[#020040]/18 bg-[#020040]/[0.04] px-3 py-2.5 dark:bg-[#020040]/14">
          <p className="text-sm font-semibold text-[#020040]">Review & send · {continuationQuote.reference}</p>
          <p className="mt-1 text-[11px] leading-snug text-text-secondary">
            Saves your line items and emails the PDF to the customer — quote moves to Approval when the send succeeds.
          </p>
        </div>
      ) : variant === "routing_minimal" ? null : (
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
      {!continuationQuote ? (
        <>
      <Select
        label="Account *"
        value={selectedAccountId}
        onChange={(e) => setSelectedAccountId(e.target.value)}
        disabled={accountsLoading}
        options={[
          { value: "", label: accountsLoading ? "Loading accounts…" : "Select account…" },
          ...accountRows.map((a) => ({
            value: a.id,
            label:
              bidPayloadTrimmedString(a.company_name as unknown) ||
              bidPayloadTrimmedString(a.contact_name as unknown) ||
              a.id,
          })),
        ]}
      />
      <label
        className={cn(
          "flex cursor-pointer gap-2 rounded-lg border border-border-light bg-card text-sm text-text-primary",
          addContactClient ? "items-start px-3 py-2.5" : "items-center px-2.5 py-1.5",
        )}
      >
        <input
          type="checkbox"
          className={cn(
            "h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/20",
            addContactClient ? "mt-0.5" : "",
          )}
          checked={addContactClient}
          onChange={(e) => {
            const on = e.target.checked;
            setAddContactClient(on);
            if (!on) {
              setClientAddress((p) => ({
                ...p,
                client_id: undefined,
                client_address_id: undefined,
                client_email: undefined,
              }));
            }
          }}
        />
        <span className="font-medium leading-tight">Add a contact client on this quote</span>
      </label>
      {addContactClient ? (
        selectedAccountId.trim() ? (
          <ClientAddressPicker
            value={clientAddress}
            onChange={setClientAddress}
            loadAllClientsOnOpen
            restrictToSourceAccountId={selectedAccountId.trim()}
            restrictToSourceAccountLabel={selectedAccountLabel || undefined}
          />
        ) : (
          <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100/90">
            Select an account above to choose a contact and property address.
          </p>
        )
      ) : (
        <div className="space-y-1.5 rounded-md border border-border-light bg-surface-hover/25 px-2 py-1.5 dark:bg-surface-secondary/20">
          <AddressAutocomplete
            label="Property address *"
            value={manualSiteAddress}
            onChange={(v) => setManualSiteAddress(v)}
            onSelect={(parts: AddressParts) => setManualSiteAddress(parts.full_address)}
            placeholder="Start typing the work address…"
          />
        </div>
      )}
        </>
      ) : null}
      {variant === "routing_minimal" && !continuationQuote ? (
        <>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              Scope <span className="text-[#ED4B00]">*</span>
            </label>
            <textarea
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder="What needs doing, access, materials, exclusions…"
              rows={5}
              className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>
          <div className="space-y-2 rounded-xl border border-border-light bg-surface-hover/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Photos (optional)</p>
            <p className="text-[11px] text-text-tertiary">
              {routingCollectTrade
                ? "Up to 8 images — partners see these on the invitation."
                : "Up to 8 images — shown when you send this draft to bidding."}
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-text-primary hover:border-primary/30">
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
            {invitePhotoPreviews.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {invitePhotoPreviews.map((src, i) => (
                  <div key={src} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-light bg-surface-hover">
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
          {routingCollectTrade ? (
            <div>
              <div className="mb-2 space-y-2 flex flex-col items-center">
                <div className="flex w-full max-w-lg flex-col items-center gap-2">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide text-center">
                    Partners <span className="text-[#ED4B00]">*</span>
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
                    Pick who gets the invitation — we create the bid request and send the push when you submit.
                  </p>
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-amber-200/50 dark:border-amber-900/40 bg-card/80 p-2 max-h-[min(38dvh,280px)] overflow-y-auto overscroll-contain">
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
          ) : null}
        </>
      ) : null}
      {(continuationQuote || variant !== "routing_minimal") ? (
      <>
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
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Line items / notes</label>
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
            <label className="block text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
              Scope
            </label>
            <textarea
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder="What needs doing, access, materials, exclusions…"
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

          <div className="rounded-xl border border-border-light bg-surface-hover/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Deposit required</label>
                  <FixfyHintIcon text="When ON the customer must pay a deposit via Stripe before the quote converts to a job. When OFF, customer accept converts straight to a job — use this for trusted / repeat clients or account billing." />
                </div>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  {depositRequiredEnabled
                    ? "Customer pays a deposit on accept; quote sits in Awaiting payment until Stripe confirms."
                    : "No deposit — quote converts directly to a job when the customer accepts."}
                </p>
              </div>
              <div className="inline-flex shrink-0 rounded-lg border border-border-light bg-card p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setDepositRequiredEnabled(true)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                    depositRequiredEnabled
                      ? "bg-[#020040] text-white"
                      : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setDepositRequiredEnabled(false)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                    !depositRequiredEnabled
                      ? "bg-[#020040] text-white"
                      : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  No
                </button>
              </div>
            </div>

            {depositRequiredEnabled ? (
              <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Deposit</span>
                  <div className="inline-flex shrink-0 rounded-lg border border-border-light bg-card p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => setDepositInputMode("percent")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                        depositInputMode === "percent"
                          ? "bg-[#020040] text-white"
                          : "text-text-secondary hover:text-text-primary",
                      )}
                    >
                      % of total
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (depositInputMode !== "amount") {
                          setDepositAmountInput(createDepositAmount.toFixed(2));
                        }
                        setDepositInputMode("amount");
                      }}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                        depositInputMode === "amount"
                          ? "bg-[#020040] text-white"
                          : "text-text-secondary hover:text-text-primary",
                      )}
                    >
                      Fixed £
                    </button>
                  </div>
                </div>
                {depositInputMode === "percent" ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      value={depositAmountInput}
                      onChange={(e) => setDepositAmountInput(e.target.value)}
                      placeholder="0.00"
                      min={0}
                      step={0.01}
                    />
                    <p className="text-[10px] text-text-tertiary mt-1.5">
                      ≈{" "}
                      <span className="font-semibold tabular-nums text-text-primary">
                        {createInferredDepositPercent.toFixed(1)}%
                      </span>{" "}
                      of total ({formatCurrency(lineSellTotal)})
                    </p>
                  </>
                )}
              </div>
            ) : null}
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
      ) : quoteType === "partner" && variant !== "routing_minimal" ? (
        <>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              Scope <span className="text-[#ED4B00]">*</span>
            </label>
            <textarea
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder="What needs doing, access, materials, exclusions… — same text customers and partners see on documents and invitations."
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
      ) : null}
      </>
      ) : null}
        </div>
      </div>
      <div className="shrink-0 border-t border-border-light bg-card px-4 py-3 sm:px-6">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            type="button"
            disabled={uploadingPhotos || continuationSubmitting || routingInviteBusy || submitBusy}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          {continuationQuote && onContinueManualDraft ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<MailCheck className="h-3.5 w-3.5" />}
              onClick={() => void submitManualContinuation("mark_sent_external")}
              disabled={uploadingPhotos || continuationSubmitting || routingInviteBusy || submitBusy}
              className="w-full sm:w-auto"
              title="Save the manual quote, move to Approval, and record that you already delivered the PDF (no email from this app)"
            >
              Mark as sent
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            loading={uploadingPhotos || continuationSubmitting || routingInviteBusy || submitBusy}
            disabled={uploadingPhotos || continuationSubmitting || routingInviteBusy || submitBusy}
            className="w-full border-0 bg-[#ED4B00] text-white hover:bg-[#d84300] sm:w-auto"
          >
            {continuationQuote
              ? "Review & send to customer"
              : variant === "routing_minimal"
                ? routingCollectTrade
                  ? "Create & notify partners"
                  : "Create & open draft"
                : quoteType === "internal"
                  ? "Send quote to customer"
                  : "Create quote"}
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
