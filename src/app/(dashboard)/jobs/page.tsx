"use client";

import { useState, useCallback, useEffect, useRef, useMemo, Suspense, useId } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column, type ColumnSortOption } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, List, LayoutGrid, Calendar, Map as MapIcon, Download, RefreshCw,
  ArrowRight, Briefcase, Receipt, Wallet,
  MapPin, Building2, TrendingUp,
  AlertTriangle, XCircle, Undo2, ImagePlus, Loader2, Lock, Clock3, Wrench, Sparkles, ChevronDown, ChevronUp, Search,
  Timer,
} from "lucide-react";
import { cn, formatCurrency, formatCurrencyPrecise, formatRelativeTime, getErrorMessage, parseIsoDateOnly } from "@/lib/utils";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useBuFilter } from "@/hooks/use-bu-filter";
import {
  listJobs,
  createJob,
  updateJob,
  getJob,
  fetchAllJobsFinancialKpiRows,
  fetchFirstEnteredFinalChecksAtByJobIds,
  computeAvgScheduleToFinalChecksPipelineSeconds,
  JOB_LIST_ALL_TAB_STATUSES,
  jobRowMatchesJobsManagementTab,
  jobsManagementClosedBucket,
  jobsManagementClosedBucketLabel,
  type JobsManagementClosedBucket,
} from "@/services/jobs";
import { getArchivedDeletedJobsOverlappingScheduleCount } from "@/services/job-period-overlap-queries";
import { refreshSelfBillPayoutState, refreshSelfBillPayoutStatesForJobIds } from "@/services/self-bills";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import { computeOfficeTimerElapsedSeconds, formatOfficeTimer, statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { notifyAssignedPartnerAboutJob } from "@/lib/notify-partner-job-push";
import { createSelfBillFromJob } from "@/services/self-bills";
import { getSupabase, getStatusCounts, type ListParams } from "@/services/base";
import { getAccountIdsForBu } from "@/services/business-units";
import { sumCustomerCollectionsByJobIds } from "@/services/job-payments";
import { softDeleteInvoicesForArchivedJobs, cancelOpenInvoicesForJobCancellation } from "@/services/invoices";
import { patchOfficeCancelZeroJobEconomics } from "@/lib/job-cancel-economics";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { useProfile } from "@/hooks/use-profile";
import type { Partner } from "@/types/database";
import { listPartners } from "@/services/partners";
import { isPartnerEligibleForWork } from "@/lib/partner-status";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { logAudit, logBulkAction } from "@/services/audit";
import { findDuplicateJobs, formatJobDuplicateLines } from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { KanbanBoard } from "@/components/shared/kanban-board";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { canAdvanceJob, getPreviousJobStatus, JOB_ONSITE_PROGRESS_STATUSES, normalizeTotalPhases } from "@/lib/job-phases";
import {
  effectiveJobStatusForDisplay,
  getPartnerAssignmentBlockReason,
  jobHasPartnerSet,
} from "@/lib/job-partner-assign";
import { applyJobDbCompat, prepareJobRowForUpdate } from "@/lib/job-schema-compat";
import { JOB_STATUS_BADGE_VARIANT, JOBS_MANAGEMENT_TAB_ACCENTS } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { setJobsNavQueue } from "@/lib/jobs-nav-queue";
import {
  formatArrivalTimeRange,
  formatJobScheduleLine,
  formatJobScheduleListLabel,
  formatHourMinuteAmPm,
  jobFinishYmd,
  jobScheduleYmd,
} from "@/lib/schedule-calendar";
import { formatBritishDate } from "@/lib/utils/date";
import {
  catalogServiceIdForTypeOfWorkLabel,
  typeOfWorkLabelsFromCatalog,
  normalizeTypeOfWork,
} from "@/lib/type-of-work";
import { resolveJobModalSchedule, resolveJobModalScheduleV2, DEFAULT_RECURRENCE_FORM, type RecurrenceFormState } from "@/lib/job-modal-schedule";
import { JobModalScheduleFields } from "@/components/shared/job-modal-schedule-fields";
import { createJobOrSeries } from "@/services/job-recurrence-series";
import { useResolvedJobPricing } from "@/hooks/use-resolved-job-pricing";
import { PricingSourceChip } from "@/components/shared/pricing-source-chip";
import type { AccountServicePrice, Job, JobKind } from "@/types/database";
import { TimeSelect } from "@/components/ui/time-select";
import { ARRIVAL_WINDOW_OPTIONS } from "@/lib/job-arrival-window";
import {
  jobBillableRevenue,
  jobCustomerBillableRevenueForCollections,
  jobMarginPercent,
  jobProfit,
  SUGGESTED_PARTNER_MARGIN_HINT_PCT,
} from "@/lib/job-financials";
import { pricingModeLabel } from "@/lib/pricing-mode-labels";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import {
  computeHourlyTotals,
  partnerHourlyRateFromCatalogBundle,
} from "@/lib/job-hourly-billing";
import {
  defaultPricingPresetId,
  mergeCatalogWithPricingPreset,
  parsePricingAddons,
  parsePricingPresets,
  sortPricingAddonsDisplay,
  sortPricingPresetsDisplay,
} from "@/lib/catalog-pricing-presets";
import {
  catalogHasStackableAddons,
  resolveCatalogLinePricing,
  type ResolvedCatalogLinePricing,
} from "@/lib/catalog-line-pricing";
import { getAccountServicePrice } from "@/services/account-service-prices";
import { getPartnerServicePrice } from "@/services/partner-service-prices";
import { computeAccessSurcharge, effectiveInCczForAddress, isLikelyCczAddress } from "@/lib/ccz";
import { safePartnerMatchesTypeOfWork, partnerMatchTypeLabel } from "@/lib/partner-type-of-work-match";
import { batchResolveClientAccountLogoUrls, batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import { coerceJobImagesArray, capJobImagesArray, JOB_SITE_PHOTOS_MAX } from "@/lib/job-images";
import { uploadQuoteInviteImages } from "@/services/quote-invite-images";
import { JobSitePhotosStrip, jobSitePhotoUrls } from "@/components/shared/job-site-photos-strip";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";
import { JobScheduleTimingChip, getJobScheduleTimingKind } from "@/components/shared/job-schedule-timing-chip";
import { ZendeskTicketBadge } from "@/components/shared/zendesk-ticket-badge";
import { ZendeskTicketField, isZendeskTicketFieldValid, type ZendeskTicketFieldValue } from "@/components/shared/zendesk-ticket-field";
import { notifyPartnerJobChange } from "@/lib/notify-partner-job-zendesk";
import { ExportCsvModal } from "@/components/shared/export-csv-modal";
import { buildCsvFromRows, downloadCsvFile } from "@/lib/csv-export";
import {
  OFFICE_JOB_CANCELLATION_REASONS,
  buildOfficeCancellationReasonText,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import {
  addDaysYmd,
  getScheduleRangeYmd,
  ukTodayYmd,
  type ScheduleDatePreset,
} from "@/lib/uk-schedule-range";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import type { DateFilterMode, DateFilterValue } from "@/lib/date-range-filter";

const JOB_STATUSES = ["unassigned", "auto_assigning", "scheduled", "late", "in_progress", "on_hold", "final_check", "awaiting_payment", "need_attention", "completed", "cancelled"] as const;

type JobsClosedJobsListFilterMode = JobsManagementClosedBucket | "all";

/** Map removed tab IDs (bookmarks / deep links) to the new Jobs Management UX. */
const LEGACY_JOBS_MANAGEMENT_TAB: Partial<
  Record<string, { tab: string; closedFilter?: JobsClosedJobsListFilterMode }>
> = {
  unassigned: { tab: "action_required" },
  on_hold: { tab: "action_required" },
  awaiting_payment: { tab: "closed", closedFilter: "awaiting_payment" },
  completed: { tab: "closed", closedFilter: "paid" },
  cancelled: { tab: "closed", closedFilter: "lost" },
  deleted: { tab: "closed", closedFilter: "archived" },
};

const JOBS_PAGE_SIZE_OPTIONS = [30, 10, 100] as const;

const RESTORE_ALLOWED_JOB_STATUSES = new Set<string>([...JOB_STATUSES]);

function parseRestoredJobStatus(raw: string | null | undefined): Job["status"] {
  const s = (raw ?? "").trim();
  if (RESTORE_ALLOWED_JOB_STATUSES.has(s)) return s as Job["status"];
  return "unassigned";
}

const NO_SCHEDULE_LIST_PARAMS: Partial<ListParams> = {};
const BULK_MARK_PAID_NOTE_TAG = "PAID_MARKED_BY::";

type JobsSortMode = "schedule_nearest" | "schedule_farthest" | "booking_recent" | "booking_oldest";

/** BU filter matches client-linked jobs and jobs on account properties (same rule as Quotes). */
function jobPassesJobsPageBuFilter(
  j: Pick<Job, "client_id" | "property_id">,
  selectedBuId: string | null,
  clientIdsInBu: Set<string> | null | undefined,
  buAccountIds: Set<string>,
  propertyIdToAccountId: Record<string, string>,
): boolean {
  if (!selectedBuId) return true;
  if (clientIdsInBu == null) return true;
  if (clientIdsInBu.size === 0 && buAccountIds.size === 0) return true;
  const clientInBu = Boolean(j.client_id && clientIdsInBu.has(j.client_id));
  const pid = j.property_id?.trim();
  const accFromProperty = pid ? propertyIdToAccountId[pid] : undefined;
  const propertyInBu = Boolean(accFromProperty && buAccountIds.has(accFromProperty));
  return clientInBu || propertyInBu;
}

function jobScheduleStartYmdUk(job: Pick<Job, "scheduled_start_at" | "scheduled_date">): string | null {
  if (job.scheduled_start_at) {
    const dt = new Date(job.scheduled_start_at);
    if (!Number.isNaN(dt.getTime())) return ukTodayYmd(dt);
  }
  const raw = String(job.scheduled_date ?? "").trim();
  const ymd = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/**
 * Second row under the schedule date in Jobs Management — arrival window only for Unassigned/Scheduled
 * pipeline jobs; on-site in-progress uses {@link ScheduleInProgressLiveSecondary}; on hold / final checks
 * show durations; awaiting payment, completed, and cancelled show date only (no second row).
 */
function jobManagementScheduleSecondaryLine(job: Job): string | null {
  const s = job.status;
  if (s === "awaiting_payment" || s === "completed" || s === "cancelled") {
    return null;
  }
  if (jobRowMatchesJobsManagementTab(job, "unassigned") || jobRowMatchesJobsManagementTab(job, "scheduled")) {
    const startIso = job.scheduled_start_at?.trim();
    if (!startIso) return "Arrival: —";
    const dt = new Date(startIso);
    if (Number.isNaN(dt.getTime())) return "Arrival: —";
    const endIso = job.scheduled_end_at?.trim();
    if (endIso) {
      const range = formatArrivalTimeRange(startIso, endIso);
      if (range) return `Arrival: ${range}`;
    }
    return `Arrival: ${formatHourMinuteAmPm(dt)}`;
  }
  if ((JOB_ONSITE_PROGRESS_STATUSES as readonly string[]).includes(s)) {
    return null;
  }
  if (s === "on_hold") {
    return null;
  }
  if (s === "final_check" || s === "need_attention") {
    const finishedIso = job.partner_timer_ended_at?.trim();
    if (finishedIso) {
      const t = new Date(finishedIso);
      if (!Number.isNaN(t.getTime())) {
        return `Finished ${formatRelativeTime(t)}`;
      }
    }
    return `In final checks ${formatRelativeTime(new Date(job.updated_at))}`;
  }
  return null;
}

/**
 * Office timer (live running segment) when active; otherwise wall-clock since partner / last start —
 * matches job detail partner-style elapsed for the list cell.
 */
function jobInProgressDisplayElapsedSeconds(job: Job, nowMs: number): number {
  const office = computeOfficeTimerElapsedSeconds(job, nowMs);
  if (office > 0 || job.timer_is_running) return office;
  const p = job.partner_timer_started_at?.trim();
  if (p) {
    const t = new Date(p).getTime();
    if (!Number.isNaN(t)) return Math.max(0, Math.floor((nowMs - t) / 1000));
  }
  const tl = job.timer_last_started_at?.trim();
  if (tl) {
    const t = new Date(tl).getTime();
    if (!Number.isNaN(t)) return Math.max(0, Math.floor((nowMs - t) / 1000));
  }
  return 0;
}

function ScheduleInProgressLiveSecondary({ job }: { job: Job }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [job.id]);
  // Intentional: 1s setInterval forces a re-render so elapsed seconds stay live.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const secs = jobInProgressDisplayElapsedSeconds(job, now);
  const startIso = job.timer_last_started_at?.trim() || job.partner_timer_started_at?.trim() || "";
  let startedSub: string | null = null;
  if (startIso) {
    const t = new Date(startIso);
    if (!Number.isNaN(t.getTime())) {
      startedSub = `${formatRelativeTime(t)} · ${formatHourMinuteAmPm(t)}`;
    }
  }
  return (
    <div className="mt-0.5 w-full space-y-0.5 text-left">
      <p className="text-[11px] font-semibold tabular-nums tracking-tight text-text-secondary">{formatOfficeTimer(secs)}</p>
      {startedSub ? <p className="text-[10px] leading-snug text-text-tertiary">{startedSub}</p> : null}
    </div>
  );
}

const JOBS_SCHEDULE_PRESET_STORAGE_KEY = "master-os-jobs-schedule-preset-v2";
const SCHEDULE_PRESET_IDS: readonly ScheduleDatePreset[] = ["all", "today", "tomorrow", "week", "month", "qtd", "custom"];

function readStoredJobsSchedulePreset(): ScheduleDatePreset {
  if (typeof window === "undefined") return "all";
  try {
    const v = localStorage.getItem(JOBS_SCHEDULE_PRESET_STORAGE_KEY);
    if (v && (SCHEDULE_PRESET_IDS as readonly string[]).includes(v)) return v as ScheduleDatePreset;
  } catch {
    /* ignore */
  }
  return "all";
}

const JOBS_DEFAULT_TAB_STORAGE_KEY = "master-os-jobs-default-tab-v1";
const JOBS_DEFAULT_TAB_IDS = [
  "all",
  "action_required",
  "scheduled",
  "in_progress",
  "final_check",
  "closed",
] as const;
type JobsDefaultTabId = (typeof JOBS_DEFAULT_TAB_IDS)[number];
const JOBS_DEFAULT_TAB_LABELS: Record<JobsDefaultTabId, string> = {
  all: "Active jobs",
  action_required: "Action Required",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  final_check: "Final Checks",
  closed: "Closed",
};

function readStoredJobsDefaultTab(): JobsDefaultTabId {
  if (typeof window === "undefined") return "all";
  try {
    const v = localStorage.getItem(JOBS_DEFAULT_TAB_STORAGE_KEY);
    if (v && (JOBS_DEFAULT_TAB_IDS as readonly string[]).includes(v)) return v as JobsDefaultTabId;
  } catch {
    /* ignore */
  }
  return "all";
}

function formatMediumYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return formatBritishDate(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

/** Schedule window label for the page info tooltip (no duplicate revenue copy — that lives in the tooltip body). */
function scheduleWindowHintLine(
  preset: ScheduleDatePreset,
  range: { from: string; to: string } | null
): string | null {
  if (!range || preset === "all") return null;
  if (range.from === range.to) {
    return `Scheduled ${formatMediumYmd(range.from)}`;
  }
  return `Scheduled ${formatMediumYmd(range.from)} – ${formatMediumYmd(range.to)}`;
}

function jobBillableAmount(j: Job) {
  return Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);
}

/** Mini financial strip: amount (incl. extras), partner cost, margin £, margin %. */
function JobCardFinanceRow({ job }: { job: Job }) {
  const amount = jobBillableAmount(job);
  const pc = Number(job.partner_cost ?? 0);
  const profit = jobProfit(job);
  const marginPct = jobMarginPercent(job);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 pt-2.5 border-t border-border-light">
      <div className="min-w-0">
        <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Job amount</p>
        <p className="text-xs font-semibold text-text-primary tabular-nums truncate">{formatCurrency(amount)}</p>
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Partner cost</p>
        <p className="text-xs font-semibold text-text-secondary tabular-nums truncate">{formatCurrency(pc)}</p>
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Margin</p>
        <p
          className={cn(
            "text-xs font-semibold tabular-nums truncate",
            profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
          )}
        >
          {formatCurrency(profit)}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Margin %</p>
        <p
          className={cn(
            "text-xs font-semibold tabular-nums",
            marginPct >= 20 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
          )}
        >
          {marginPct}%
        </p>
      </div>
    </div>
  );
}

function ukYmdFromJobInstant(rawIso: string): string | null {
  const d = new Date(rawIso.trim());
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Calendar days between two UK calendar dates (`YYYY-MM-DD`), end − start (inclusive sense: same day → 0). */
function ukCalendarDaysBetweenUkYmd(startYmd: string, endYmd: string): number {
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const [ye, me, de] = endYmd.split("-").map(Number);
  const s = Date.UTC(ys, ms - 1, ds);
  const e = Date.UTC(ye, me - 1, de);
  return Math.round((e - s) / 86400000);
}

/** Subtitle under Status for on-hold jobs: `On Hold · 21 days` (minimal SLA line). */
function jobOnHoldDurationSubtitle(job: Pick<Job, "on_hold_at">): string {
  const raw = job.on_hold_at?.trim();
  if (!raw) return "On Hold · —";
  const startUk = ukYmdFromJobInstant(raw);
  if (!startUk) return "On Hold · —";
  const todayUk = ukTodayYmd(new Date());
  const n = ukCalendarDaysBetweenUkYmd(startUk, todayUk);
  if (n <= 0) return "On Hold · today";
  if (n === 1) return "On Hold · 1 day";
  return `On Hold · ${n} days`;
}

const statusConfig: Record<string, { label: string; variant: BadgeVariant; dot?: boolean }> = {
  unassigned: { label: "Unassigned", variant: JOB_STATUS_BADGE_VARIANT.unassigned, dot: true },
  auto_assigning: { label: "Assigning", variant: JOB_STATUS_BADGE_VARIANT.auto_assigning, dot: true },
  scheduled: { label: "Scheduled", variant: JOB_STATUS_BADGE_VARIANT.scheduled, dot: true },
  late: { label: "Late", variant: JOB_STATUS_BADGE_VARIANT.late, dot: true },
  in_progress: { label: "In Progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress, dot: true },
  on_hold: { label: "On Hold", variant: JOB_STATUS_BADGE_VARIANT.on_hold, dot: true },
  final_check: { label: "Final Check", variant: JOB_STATUS_BADGE_VARIANT.final_check, dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: JOB_STATUS_BADGE_VARIANT.awaiting_payment, dot: true },
  need_attention: { label: "Final Check", variant: JOB_STATUS_BADGE_VARIANT.need_attention, dot: true },
  completed: { label: "Paid & Completed", variant: JOB_STATUS_BADGE_VARIANT.completed, dot: true },
  cancelled: { label: "Lost & Cancelled", variant: JOB_STATUS_BADGE_VARIANT.cancelled, dot: true },
  deleted: { label: "Deleted", variant: JOB_STATUS_BADGE_VARIANT.deleted, dot: true },
};

/** Account group header tint — matches Invoices list. */
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

function firstJobAccountLabel(jobs: Job[], clientAccountMap: Record<string, string>): string {
  const j = jobs.find((x) => x.client_id && clientAccountMap[x.client_id]);
  return j ? clientAccountMap[j.client_id!]! : "No account";
}

const JOB_SORT_CLEAR: ColumnSortOption = { label: "Default order", sortKey: null, direction: "asc" };

const JOB_SORT_CREATED: ColumnSortOption[] = [
  { label: "Newest booking first", sortKey: "__created_at", direction: "desc" },
  { label: "Oldest booking first", sortKey: "__created_at", direction: "asc" },
  JOB_SORT_CLEAR,
];

function jobColumnSortPack(columnKey: string, title: string): ColumnSortOption[] {
  return [
    { label: `${title} A → Z`, sortKey: columnKey, direction: "asc" },
    { label: `${title} Z → A`, sortKey: columnKey, direction: "desc" },
    ...JOB_SORT_CREATED,
  ];
}

const JOB_SORT_SCHEDULE: ColumnSortOption[] = [
  { label: "Soonest scheduled first", sortKey: "schedule", direction: "asc" },
  { label: "Latest scheduled first", sortKey: "schedule", direction: "desc" },
  ...JOB_SORT_CREATED,
];

const JOB_SORT_AMOUNT: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "margin_percent", direction: "asc" },
  { label: "High to low", sortKey: "margin_percent", direction: "desc" },
  ...JOB_SORT_CREATED,
];

const JOB_SORT_COST: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "partner_cost", direction: "asc" },
  { label: "High to low", sortKey: "partner_cost", direction: "desc" },
  ...JOB_SORT_CREATED,
];

const JOB_SORT_AMOUNT_DUE: ColumnSortOption[] = [
  { label: "Low to high", sortKey: "amount_due", direction: "asc" },
  { label: "High to low", sortKey: "amount_due", direction: "desc" },
  ...JOB_SORT_CREATED,
];

const JOB_SORT_FINANCE: ColumnSortOption[] = [
  { label: "Unpaid → paid", sortKey: "finance_status", direction: "asc" },
  { label: "Paid → unpaid", sortKey: "finance_status", direction: "desc" },
  ...JOB_SORT_CREATED,
];

const JOB_SORT_STATUS: ColumnSortOption[] = [
  { label: "Status A → Z", sortKey: "status", direction: "asc" },
  { label: "Status Z → A", sortKey: "status", direction: "desc" },
  ...JOB_SORT_CREATED,
];

const JOB_CLOSED_BUCKET_SORT_RANK: Record<JobsManagementClosedBucket, number> = {
  paid: 0,
  awaiting_payment: 1,
  archived: 2,
  lost: 3,
};

/** Schedule → first Final Checks audit → KPI label (jobs strip). */
function formatKpiAvgWorkSeconds(avgSeconds: number): string {
  const s = Math.round(avgSeconds);
  if (!Number.isFinite(s) || s <= 0) return "—";
  const m = Math.round(s / 60);
  if (m < 1) return "<1 min";
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${m} min`;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function JobsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const anchorDayKey = ukTodayYmd(new Date());
  const [scheduleDatePreset, setScheduleDatePresetState] = useState<ScheduleDatePreset>("all");
  const setScheduleDatePreset = useCallback((p: ScheduleDatePreset) => {
    setScheduleDatePresetState(p);
    try {
      localStorage.setItem(JOBS_SCHEDULE_PRESET_STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const stored = readStoredJobsSchedulePreset();
    if (stored !== "all") setScheduleDatePresetState(stored);
  }, []);

  const [defaultJobsTab, setDefaultJobsTabState] = useState<JobsDefaultTabId>(() => readStoredJobsDefaultTab());
  const setDefaultJobsTab = useCallback((tab: JobsDefaultTabId) => {
    setDefaultJobsTabState(tab);
    try {
      localStorage.setItem(JOBS_DEFAULT_TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, []);
  const [customScheduleFrom, setCustomScheduleFrom] = useState(() => ukTodayYmd(new Date()));
  const [customScheduleTo, setCustomScheduleTo] = useState(() => ukTodayYmd(new Date()));

  const scheduleRange = useMemo(
    () => getScheduleRangeYmd(scheduleDatePreset, customScheduleFrom, customScheduleTo),
    [scheduleDatePreset, customScheduleFrom, customScheduleTo, anchorDayKey],
  );

  const [closedJobsFilter, setClosedJobsFilter] = useState<JobsClosedJobsListFilterMode>("all");

  const closedJobsFilterRef = useRef(closedJobsFilter);
  closedJobsFilterRef.current = closedJobsFilter;

  const listParams = useMemo<Partial<ListParams>>(() => {
    if (!scheduleRange) return NO_SCHEDULE_LIST_PARAMS;
    return { scheduleRange };
  }, [scheduleRange]);

  const fetchJobsManagementList = useCallback((params: ListParams) => {
    const merged: ListParams = { ...params };
    if (merged.status === "closed" && closedJobsFilterRef.current !== "all") {
      merged.jobsClosedBucket = closedJobsFilterRef.current as JobsManagementClosedBucket;
    }
    return listJobs(merged);
  }, []);

  const [jobsPageSize, setJobsPageSize] = useState<number>(30);
  const { data, loading, page, totalPages, totalItems, setPage, search, setSearch, status, setStatus, refresh, refreshSilent } = useSupabaseList<Job>({
    fetcher: fetchJobsManagementList,
    pageSize: jobsPageSize,
    realtimeTable: "jobs",
    listParams,
    initialStatus: defaultJobsTab,
  });
  const { profile } = useProfile();
  const { officeCancellationPresets, accessFees } = useFrontendSetup();
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  /** "all" · "__none__" (unassigned) · partner_id */
  const [filterPartner, setFilterPartner] = useState<string>("all");
  /** "all" · account_id (corporate account) */
  const [filterAccountId, setFilterAccountId] = useState<string>("all");
  /** Dynamic option lists for the partner + account pickers (loaded once). */
  const [filterPartnersList, setFilterPartnersList] = useState<{ id: string; name: string }[]>([]);
  const [filterAccountsList, setFilterAccountsList] = useState<{ id: string; name: string }[]>([]);
  const [filterScheduled, setFilterScheduled] = useState<"all" | "scheduled" | "unscheduled">("all");
  const buFilter = useBuFilter();
  const [buAccountIds, setBuAccountIds] = useState<Set<string>>(new Set());
  /** `account_properties.id` → `account_id` — jobs with `property_id` but same BU as Quotes. */
  const [propertyIdToAccountId, setPropertyIdToAccountId] = useState<Record<string, string>>({});
  const [filterSort, setFilterSort] = useState<JobsSortMode>("schedule_nearest");
  const [jobsListSortKey, setJobsListSortKey] = useState<string | null>(null);
  const [jobsListSortDir, setJobsListSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionModal, setBulkActionModal] = useState<null | "start_job" | "cancel" | "mark_paid" | "archive" | "recover">(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkCancelPresetId, setBulkCancelPresetId] = useState<string>(OFFICE_JOB_CANCELLATION_REASONS[0].id);
  const [bulkCancelDetail, setBulkCancelDetail] = useState("");
  const [bulkMarkPaidConfirm, setBulkMarkPaidConfirm] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [kpiFinancialLoading, setKpiFinancialLoading] = useState(true);
  const [kpiAvgWorkTimeLabel, setKpiAvgWorkTimeLabel] = useState("—");
  const [avgTicket, setAvgTicket] = useState(0);
  const [avgMarginPct, setAvgMarginPct] = useState(0);
  const [clientAccountMap, setClientAccountMap] = useState<Record<string, string>>({});
  const [clientAccountLogoByClientId, setClientAccountLogoByClientId] = useState<Record<string, string | null>>({});
  const [clientIdToSourceAccountId, setClientIdToSourceAccountId] = useState<Record<string, string | null>>({});
  const [expandedAwaitingPaymentAccountGroups, setExpandedAwaitingPaymentAccountGroups] = useState<Record<string, boolean>>({});

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
    const ids = [...new Set(data.map((j) => j.property_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setPropertyIdToAccountId({});
      return;
    }
    let cancelled = false;
    void (async () => {
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
    const legacy = LEGACY_JOBS_MANAGEMENT_TAB[status];
    if (!legacy) return;
    if (legacy.tab === "closed") {
      setClosedJobsFilter(legacy.closedFilter ?? "all");
    } else {
      setClosedJobsFilter("all");
    }
    setStatus(legacy.tab);
  }, [status, setStatus]);

  useEffect(() => {
    if (status !== "closed" || closedJobsFilter !== "archived") return;
    if (viewMode !== "list") setViewMode("list");
  }, [closedJobsFilter, status, viewMode]);

  useEffect(() => {
    if (status === "closed" && closedJobsFilter === "archived") setSelectedIds(new Set());
  }, [closedJobsFilter, status]);

  useEffect(() => {
    if (status !== "closed") return;
    refreshSilent();
  }, [closedJobsFilter, refreshSilent, status]);

  useEffect(() => {
    if (!bulkActionModal) {
      setBulkCancelPresetId(officeCancellationPresets[0]?.id ?? OFFICE_JOB_CANCELLATION_REASONS[0].id);
      setBulkCancelDetail("");
      setBulkMarkPaidConfirm(false);
    }
  }, [bulkActionModal, officeCancellationPresets]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (filterOpen && filterRef.current && !filterRef.current.contains(t)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  useEffect(() => {
    setJobsListSortKey(null);
    setJobsListSortDir("asc");
  }, [status, closedJobsFilter]);

  const handleJobsListSortChange = useCallback((key: string | null, direction: "asc" | "desc") => {
    setJobsListSortKey(key);
    setJobsListSortDir(direction);
  }, []);

  // Load partner + account option lists for the filter popover (once per mount).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const [partnersRes, accountsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("partner_id, partner_name")
          .not("partner_id", "is", null)
          .not("partner_name", "is", null)
          .is("deleted_at", null)
          .limit(2000),
        supabase
          .from("accounts")
          .select("id, name")
          .order("name", { ascending: true })
          .limit(2000),
      ]);
      if (cancelled) return;
      const seen = new Map<string, string>();
      for (const r of (partnersRes.data ?? []) as { partner_id: string | null; partner_name: string | null }[]) {
        const id = r.partner_id?.trim();
        const nm = r.partner_name?.trim();
        if (!id || !nm) continue;
        if (!seen.has(id)) seen.set(id, nm);
      }
      setFilterPartnersList(
        Array.from(seen.entries())
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setFilterAccountsList(
        ((accountsRes.data ?? []) as { id: string; name: string | null }[])
          .map((r) => ({ id: r.id, name: r.name?.trim() ?? "" }))
          .filter((a) => a.id && a.name),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredData = useMemo(() => {
    return data.filter((j) => {
      if (filterPartner === "__none__") {
        if (j.partner_id || j.partner_name) return false;
      } else if (filterPartner !== "all") {
        if (j.partner_id !== filterPartner) return false;
      }
      if (filterAccountId !== "all") {
        const acc = j.client_id ? clientIdToSourceAccountId[j.client_id] ?? null : null;
        if (acc !== filterAccountId) return false;
      }
      const hasDate = !!(j.scheduled_date || j.scheduled_start_at || j.scheduled_finish_date);
      if (filterScheduled === "scheduled" && !hasDate) return false;
      if (filterScheduled === "unscheduled" && hasDate) return false;
      if (
        !jobPassesJobsPageBuFilter(j, buFilter.selectedBuId, buFilter.clientIdsInBu, buAccountIds, propertyIdToAccountId)
      ) {
        return false;
      }
      return true;
    });
  }, [
    data,
    filterPartner,
    filterAccountId,
    filterScheduled,
    buFilter.selectedBuId,
    buFilter.clientIdsInBu,
    buAccountIds,
    propertyIdToAccountId,
    clientIdToSourceAccountId,
  ]);

  /** Default sorting for Jobs Management (kanban / filter bar): nearest schedule first. */
  const scheduleSortedData = useMemo(() => {
    const today = ukTodayYmd(new Date());
    const clone = [...filteredData];
    const scheduleMeta = (j: Job) => {
      const day = jobScheduleStartYmdUk(j);
      if (!day) return { bucket: 3 as const, day: "9999-99-99" };
      if (day < today) return { bucket: 0 as const, day };
      if (day === today) return { bucket: 1 as const, day };
      return { bucket: 2 as const, day };
    };
    const createdAt = (j: Job) => new Date(j.created_at ?? 0).getTime();

    const compareSchedule = (a: Job, b: Job): number => {
      if (filterSort === "booking_recent") return createdAt(b) - createdAt(a);
      if (filterSort === "booking_oldest") return createdAt(a) - createdAt(b);
      const sa = scheduleMeta(a);
      const sb = scheduleMeta(b);
      if (sa.bucket !== sb.bucket) return sa.bucket - sb.bucket;
      if (filterSort === "schedule_farthest") return sb.day.localeCompare(sa.day);
      const dayCmp = sa.day.localeCompare(sb.day);
      if (dayCmp !== 0) return dayCmp;
      return createdAt(b) - createdAt(a);
    };

    if (status === "action_required") {
      const onHold = clone.filter((j) => j.status === "on_hold");
      const rest = clone.filter((j) => j.status !== "on_hold");
      onHold.sort((a, b) => {
        const ta = new Date(a.on_hold_at ?? a.updated_at ?? 0).getTime();
        const tb = new Date(b.on_hold_at ?? b.updated_at ?? 0).getTime();
        return ta - tb;
      });
      rest.sort(compareSchedule);
      return [...onHold, ...rest];
    }

    clone.sort(compareSchedule);
    return clone;
  }, [filteredData, filterSort, status]);

  const [customerPaidByJobId, setCustomerPaidByJobId] = useState<Record<string, number>>({});
  const [customerPaidSumsReady, setCustomerPaidSumsReady] = useState(true);

  useEffect(() => {
    // Same job set as the list table rows (`data`), not kanban-only `filteredData`.
    const ids = data.map((j) => j.id);
    if (ids.length === 0) {
      setCustomerPaidByJobId({});
      setCustomerPaidSumsReady(true);
      return;
    }
    setCustomerPaidSumsReady(false);
    let cancelled = false;
    void sumCustomerCollectionsByJobIds(ids).then(
      (sums) => {
        if (!cancelled) {
          setCustomerPaidByJobId(sums);
          setCustomerPaidSumsReady(true);
        }
      },
      () => {
        if (!cancelled) {
          setCustomerPaidByJobId({});
          setCustomerPaidSumsReady(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data]);

  const sortedDataForTable = useMemo(() => {
    if (!jobsListSortKey) return scheduleSortedData;
    const mul = jobsListSortDir === "asc" ? 1 : -1;
    const clone = [...scheduleSortedData];
    const jobAmount = (j: Job) => j.client_price + Number(j.extras_amount ?? 0);
    const amountDue = (j: Job) => {
      if (!customerPaidSumsReady) return 0;
      const billable = jobCustomerBillableRevenueForCollections(j);
      const paid = customerPaidByJobId[j.id] ?? 0;
      return Math.max(0, billable - paid);
    };
    const accountLabel = (j: Job) => (j.client_id ? clientAccountMap[j.client_id] ?? "" : "");
    clone.sort((a, b) => {
      let cmp = 0;
      switch (jobsListSortKey) {
        case "reference":
          cmp = (a.reference ?? "").localeCompare(b.reference ?? "", undefined, { sensitivity: "base" });
          break;
        case "client_name":
          cmp = (a.client_name ?? "").localeCompare(b.client_name ?? "", undefined, { sensitivity: "base" });
          break;
        case "partner_name": {
          const pa = (a.partner_name ?? "").trim();
          const pb = (b.partner_name ?? "").trim();
          cmp = pa.localeCompare(pb, undefined, { sensitivity: "base" });
          break;
        }
        case "schedule": {
          const da = jobScheduleStartYmdUk(a) ?? "9999-99-99";
          const db = jobScheduleStartYmdUk(b) ?? "9999-99-99";
          cmp = da.localeCompare(db);
          break;
        }
        case "status":
          if (status === "closed") {
            cmp =
              JOB_CLOSED_BUCKET_SORT_RANK[jobsManagementClosedBucket(a)] -
              JOB_CLOSED_BUCKET_SORT_RANK[jobsManagementClosedBucket(b)];
          } else if (status === "action_required") {
            const ra = a.status === "on_hold" ? 1 : 0;
            const rb = b.status === "on_hold" ? 1 : 0;
            cmp = ra - rb || (effectiveJobStatusForDisplay(a) ?? "").localeCompare(effectiveJobStatusForDisplay(b) ?? "");
          } else {
            cmp = (effectiveJobStatusForDisplay(a) ?? "").localeCompare(effectiveJobStatusForDisplay(b) ?? "");
          }
          break;
        case "account":
          cmp = accountLabel(a).localeCompare(accountLabel(b), undefined, { sensitivity: "base" });
          break;
        case "margin_percent":
          cmp = jobAmount(a) - jobAmount(b);
          break;
        case "partner_cost":
          cmp = Number(a.partner_cost ?? 0) - Number(b.partner_cost ?? 0);
          break;
        case "amount_due":
          cmp = amountDue(a) - amountDue(b);
          break;
        case "finance_status":
          cmp = String(a.finance_status ?? "").localeCompare(String(b.finance_status ?? ""));
          break;
        case "__created_at":
          cmp = new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
          break;
        default:
          cmp = 0;
      }
      if (cmp !== 0) return mul * cmp;
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });
    return clone;
  }, [
    scheduleSortedData,
    jobsListSortKey,
    jobsListSortDir,
    status,
    customerPaidByJobId,
    customerPaidSumsReady,
    clientAccountMap,
  ]);

  /** Active jobs tab only — sums match Job Amount & Cost columns in the list. */
  const activeJobsTabFinancialTotals = useMemo(() => {
    if (status !== "all") return { revenue: 0, cost: 0 };
    let revenue = 0;
    let cost = 0;
    for (const j of sortedDataForTable) {
      revenue += jobBillableAmount(j);
      cost += Number(j.partner_cost ?? 0);
    }
    return {
      revenue: Math.round(revenue * 100) / 100,
      cost: Math.round(cost * 100) / 100,
    };
  }, [status, sortedDataForTable]);

  const kanbanColumns = useMemo(() => {
    const defs = [
      {
        id: "action_required",
        title: "Action required",
        color: "bg-red-500",
        items: scheduleSortedData.filter((j) => jobRowMatchesJobsManagementTab(j, "action_required")),
      },
      {
        id: "scheduled",
        title: "Scheduled",
        color: "bg-emerald-500",
        items: scheduleSortedData.filter((j) => jobRowMatchesJobsManagementTab(j, "scheduled")),
      },
      {
        id: "in_progress",
        title: "In progress",
        color: "bg-blue-500",
        items: scheduleSortedData.filter((j) => jobRowMatchesJobsManagementTab(j, "in_progress")),
      },
      {
        id: "final_check",
        title: "Final checks",
        color: "bg-violet-500",
        items: scheduleSortedData.filter((j) => j.status === "final_check" || j.status === "need_attention"),
      },
      {
        id: "closed",
        title: "Closed",
        color: "bg-slate-500",
        items: scheduleSortedData.filter((j) => jobRowMatchesJobsManagementTab(j, "closed")),
      },
    ] as const;
    return defs.map((c) => ({ ...c }));
  }, [scheduleSortedData]);

  const openJobDetail = useCallback(
    (job: Job) => {
      setJobsNavQueue(scheduleSortedData.map((j) => j.id));
      router.push(`/jobs/${job.id}`);
    },
    [router, scheduleSortedData],
  );

  const jobIdFromUrl = searchParams.get("jobId");
  useEffect(() => { if (jobIdFromUrl) router.replace(`/jobs/${jobIdFromUrl}`); }, [jobIdFromUrl, router]);

  const loadDashboardStats = useCallback(async () => {
    setKpiFinancialLoading(true);
    try {
      const countOpts = scheduleRange ? { scheduleRange } : undefined;
      const supabase = getSupabase();
      try {
        const [counts, deletedHead] = await Promise.all([
          getStatusCounts("jobs", [...JOB_STATUSES], "status", countOpts),
          supabase
            .from("jobs")
            .select("*", { count: "exact", head: true })
            .eq("status", "deleted")
            .not("deleted_at", "is", null),
        ]);
        const deletedCount = deletedHead.error ? 0 : deletedHead.count ?? 0;
        const archivedOverlap =
          countOpts?.scheduleRange != null
            ? await getArchivedDeletedJobsOverlappingScheduleCount(countOpts.scheduleRange)
            : 0;
        const allTabCount = JOB_LIST_ALL_TAB_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
        setTabCounts({
          ...counts,
          all: allTabCount,
          deleted: deletedCount,
          archived_overlap_window: archivedOverlap,
        });
      } catch {
        /* tab badges — keep prior counts */
      }
      try {
        const rows = await fetchAllJobsFinancialKpiRows(scheduleRange);
        /** Same “All jobs” bucket as the first tab badge — not the currently selected tab. */
        const allWindowRows = rows.filter((r) =>
          jobRowMatchesJobsManagementTab(
            {
              status: r.status,
              partner_id: r.partner_id,
              partner_ids: r.partner_ids,
            } as Job,
            "all",
          ),
        );
        const revenueBasis = allWindowRows.filter((r) => r.status !== "cancelled" && r.status !== "deleted");
        const ticketSum = revenueBasis.reduce((s, r) => s + jobBillableRevenue(r), 0);
        setAvgTicket(revenueBasis.length ? ticketSum / revenueBasis.length : 0);

        const kpiRowIds = allWindowRows.map((r) => r.id).filter(Boolean);
        const enteredFinalChecksMap = await fetchFirstEnteredFinalChecksAtByJobIds(kpiRowIds);
        const avgPipeSec = computeAvgScheduleToFinalChecksPipelineSeconds(allWindowRows, enteredFinalChecksMap);
        setKpiAvgWorkTimeLabel(
          avgPipeSec != null && avgPipeSec > 0 ? formatKpiAvgWorkSeconds(avgPipeSec) : "—",
        );

        const marginRows = allWindowRows.filter(
          (r) => r.status !== "cancelled" && r.status !== "completed" && r.status !== "deleted",
        );
        const margins = marginRows.map((r) => jobMarginPercent(r));
        const avgM = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
        setAvgMarginPct(Math.round(avgM * 10) / 10);
      } catch {
        /* KPI strip — cosmetic */
      }
    } finally {
      setKpiFinancialLoading(false);
    }
  }, [scheduleRange]);
  useEffect(() => {
    void loadDashboardStats();
  }, [loadDashboardStats]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout>;
    const supabase = getSupabase();
    const channel = supabase
      .channel("jobs-management-dashboard-kpis")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          void loadDashboardStats();
        }, 400);
      })
      .subscribe();
    return () => {
      clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [loadDashboardStats]);

  const inProgressTabCount =
    (tabCounts.in_progress ?? 0);

  const onHoldTabCount = tabCounts.on_hold ?? 0;

  const scheduledTabCount = (tabCounts.scheduled ?? 0) + (tabCounts.late ?? 0);

  const finalChecksTabCount = (tabCounts.final_check ?? 0) + (tabCounts.need_attention ?? 0);

  const unassignedTabCount = (tabCounts.unassigned ?? 0) + (tabCounts.auto_assigning ?? 0);

  const actionRequiredTabCount = unassignedTabCount + onHoldTabCount;

  const closedTabCount =
    (tabCounts.awaiting_payment ?? 0) +
    (tabCounts.completed ?? 0) +
    (tabCounts.cancelled ?? 0) +
    (scheduleRange ? (tabCounts.archived_overlap_window ?? 0) : (tabCounts.deleted ?? 0));

  /** Jobs in Action Required → Final Checks (same scope as tab badges below). */
  const kpiActiveJobsCount =
    actionRequiredTabCount + scheduledTabCount + inProgressTabCount + finalChecksTabCount;

  /** First tab badge = Active jobs (Action Required → Final Checks). Closed
   *  buckets (awaiting_payment / completed / cancelled / deleted) live under
   *  the Closed tab and are intentionally excluded here. */
  const kpiAllJobsCount = tabCounts.all ?? 0;

  const tabs = [
    { id: "all", label: "Active jobs", count: kpiAllJobsCount, accent: JOBS_MANAGEMENT_TAB_ACCENTS.all },
    { id: "action_required", label: "Action Required", count: actionRequiredTabCount, accent: JOBS_MANAGEMENT_TAB_ACCENTS.action_required },
    { id: "scheduled", label: "Scheduled", count: scheduledTabCount, accent: JOBS_MANAGEMENT_TAB_ACCENTS.scheduled },
    { id: "in_progress", label: "In Progress", count: inProgressTabCount, accent: JOBS_MANAGEMENT_TAB_ACCENTS.in_progress },
    { id: "final_check", label: "Final Checks", count: finalChecksTabCount, accent: JOBS_MANAGEMENT_TAB_ACCENTS.final_check },
    { id: "closed", label: "Closed", count: closedTabCount, accent: JOBS_MANAGEMENT_TAB_ACCENTS.closed },
  ];

  useEffect(() => {
    const ids = [...new Set(data.map((j) => j.client_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setClientAccountMap({});
      setClientAccountLogoByClientId({});
      setClientIdToSourceAccountId({});
      return;
    }
    const supabase = getSupabase();
    let cancelled = false;
    (async () => {
      const [labels, logos, clientRowsRes] = await Promise.all([
        batchResolveLinkedAccountLabels(supabase, ids),
        batchResolveClientAccountLogoUrls(supabase, ids),
        supabase.from("clients").select("id, source_account_id").in("id", ids).is("deleted_at", null),
      ]);
      if (cancelled) return;
      const next: Record<string, string> = {};
      labels.forEach((label, clientId) => {
        next[clientId] = label;
      });
      setClientAccountMap(next);
      const nextLogo: Record<string, string | null> = {};
      logos.forEach((url, clientId) => {
        nextLogo[clientId] = url;
      });
      setClientAccountLogoByClientId(nextLogo);
      const nextSrc: Record<string, string | null> = {};
      for (const row of clientRowsRes.data ?? []) {
        const r = row as { id: string; source_account_id?: string | null };
        nextSrc[r.id] = r.source_account_id?.trim() || null;
      }
      setClientIdToSourceAccountId(nextSrc);
    })();
    return () => { cancelled = true; };
  }, [data]);

  const handleCreate = useCallback(async (
    formData: Partial<Job> & { __createZendeskTicket?: boolean },
    opts?: { series?: import("@/lib/job-modal-schedule").JobScheduleV2SeriesPayload },
  ) => {
    // ─── Zendesk: open a new ticket when the modal asked us to ──────────
    // The modal sets `__createZendeskTicket` when staff ticked "No ticket —
    // create a new one". We open the ticket FIRST so we can stamp
    // external_ref on the job record (and let the rest of the OS flow
    // sync status / post side conversations to it).
    if (formData.__createZendeskTicket) {
      try {
        const subject  = `${formData.title ?? "Job"} — ${formData.client_name ?? formData.property_address ?? "New job"}`;
        const lines: string[] = [
          `A new job is being created in the OS.`,
          ``,
          `Title:       ${formData.title ?? "—"}`,
          `Client:      ${formData.client_name ?? "—"}`,
          `Address:     ${formData.property_address ?? "—"}`,
          `Scheduled:   ${formData.scheduled_date ?? "—"}${formData.scheduled_start_at ? ` ${formData.scheduled_start_at}` : ""}`,
          formData.scope ? `Scope:       ${formData.scope}` : "",
          formData.partner_name ? `Partner:     ${formData.partner_name}` : "",
          ``,
          `This ticket was opened automatically from the Master OS Create-Job modal.`,
        ].filter(Boolean);
        const res = await fetch("/api/zendesk/create-ticket-for-entity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType:  "job",
            subject,
            commentBody: lines.join("\n"),
          }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok || !j.ticketId) {
          toast.error(`Could not open Zendesk ticket: ${j.error ?? `HTTP ${res.status}`}`);
          return;
        }
        formData.external_source = "zendesk";
        formData.external_ref    = String(j.ticketId);
      } catch (err) {
        toast.error(getErrorMessage(err, "Zendesk ticket creation failed"));
        return;
      }
      delete formData.__createZendeskTicket;
    }

    const cp = formData.client_price ?? 0;
    const pc = formData.partner_cost ?? 0;
    const mc = formData.materials_cost ?? 0;
    const margin =
      cp > 0 ? Math.round(((cp - pc - mc) / cp) * 1000) / 10 : 0;
    if (jobHasPartnerSet(formData as Job)) {
      const block = getPartnerAssignmentBlockReason({
        property_address: formData.property_address ?? "",
        scope: formData.scope,
        scheduled_date: formData.scheduled_date,
        scheduled_start_at: formData.scheduled_start_at,
        partner_id: formData.partner_id,
        partner_ids: formData.partner_ids,
      });
      if (block) {
        toast.error(block);
        return;
      }
    }
    const housekeepFromPayload =
      isHousekeepWorkLabel(formData.title) ||
      isHousekeepWorkLabel((formData as { service_type?: string }).service_type);
    const inCczEff = housekeepFromPayload
      ? false
      : effectiveInCczForAddress(formData.in_ccz, formData.property_address);
    const accessSurcharge = housekeepFromPayload
      ? 0
      : computeAccessSurcharge({
          inCcz: inCczEff,
          hasFreeParking: formData.has_free_parking,
          cczFeeGbp: accessFees.cczFeeGbp,
          parkingFeeGbp: accessFees.parkingFeeGbp,
        });
    try {
      const dupJobs = await findDuplicateJobs({
        clientId: formData.client_id,
        propertyAddress: formData.property_address ?? "",
        title: formData.title ?? "",
        scheduled_date: formData.scheduled_date ?? null,
        scheduled_start_at: formData.scheduled_start_at ?? null,
        scheduled_end_at: formData.scheduled_end_at ?? null,
      });
      if (!(await confirmDespiteDuplicates(formatJobDuplicateLines(dupJobs)))) return;

      // Recurring path: insert a series + expand 90 days of occurrences in one go.
      if (opts?.series) {
        const anchor = {
          title: formData.title ?? "",
          catalog_service_id: formData.catalog_service_id ?? null,
          catalog_pricing_preset_id: formData.catalog_pricing_preset_id ?? null,
          catalog_pricing_addon_ids: formData.catalog_pricing_addon_ids ?? [],
          client_id: formData.client_id,
          client_address_id: formData.client_address_id,
          client_name: formData.client_name ?? "",
          property_address: formData.property_address ?? "",
          partner_name: formData.partner_name,
          partner_id: formData.partner_id,
          partner_ids: formData.partner_ids,
          owner_id: formData.owner_id ?? profile?.id,
          owner_name: formData.owner_name ?? profile?.full_name,
          status: (jobHasPartnerSet(formData as Job) ? "scheduled" : "unassigned") as Job["status"],
          progress: 0,
          current_phase: 0,
          total_phases: normalizeTotalPhases(formData.total_phases),
          client_price: cp,
          extras_amount: accessSurcharge,
          partner_cost: pc,
          materials_cost: mc,
          margin_percent: margin,
          job_type: formData.job_type ?? "fixed",
          hourly_client_rate: formData.hourly_client_rate ?? null,
          hourly_partner_rate: formData.hourly_partner_rate ?? null,
          billed_hours: formData.billed_hours ?? null,
          in_ccz: housekeepFromPayload ? false : inCczEff,
          has_free_parking: housekeepFromPayload ? true : (formData.has_free_parking ?? null),
          cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
          partner_agreed_value: 0, finance_status: "unpaid" as const, service_value: cp + accessSurcharge,
          report_submitted: false,
          report_1_uploaded: false, report_1_approved: false,
          report_2_uploaded: false, report_2_approved: false,
          report_3_uploaded: false, report_3_approved: false,
          partner_payment_1: 0, partner_payment_1_paid: false,
          partner_payment_2: 0, partner_payment_2_paid: false,
          partner_payment_3: 0, partner_payment_3_paid: false,
          customer_deposit: 0, customer_deposit_paid: false,
          customer_final_payment: cp + accessSurcharge, customer_final_paid: false,
          scope: formData.scope?.trim() || undefined,
          additional_notes: formData.additional_notes?.trim() || undefined,
          report_link: (formData as { report_link?: string | null }).report_link?.trim() || undefined,
          images: capJobImagesArray(coerceJobImagesArray(formData.images)),
          external_source: formData.external_source ?? null,
          external_ref:    formData.external_ref    ?? null,
        } as Omit<Job, "id" | "reference" | "created_at" | "updated_at">;

        const seriesResult = await createJobOrSeries({
          anchorJobRow: anchor,
          series: {
            rule: opts.series.rule,
            start_time: opts.series.start_time,
            end_time: opts.series.end_time,
            start_date: opts.series.start_date,
            end_date: opts.series.end_date ?? null,
            max_occurrences: opts.series.max_occurrences ?? null,
          },
        });
        setCreateOpen(false);
        toast.success(`Series created with ${seriesResult.jobs.length} occurrences`);
        const firstJob = seriesResult.jobs[0];
        if (firstJob) {
          setJobsNavQueue(seriesResult.jobs.map((j) => j.id));
          router.push(`/jobs/${firstJob.id}`);
        }
        void loadDashboardStats();
        void Promise.resolve().then(() => refreshSilent());
        return;
      }

      const result = await createJob({
        title: formData.title ?? "",
        catalog_service_id: formData.catalog_service_id ?? null,
        catalog_pricing_preset_id: formData.catalog_pricing_preset_id ?? null,
        catalog_pricing_addon_ids: formData.catalog_pricing_addon_ids ?? [],
        client_id: formData.client_id,
        client_address_id: formData.client_address_id,
        client_name: formData.client_name ?? "",
        property_address: formData.property_address ?? "",
        partner_name: formData.partner_name, partner_id: formData.partner_id,
        partner_ids: formData.partner_ids,
        owner_id: formData.owner_id ?? profile?.id,
        owner_name: formData.owner_name ?? profile?.full_name,
        status: (() => {
          const st = formData.status as Job["status"] | undefined;
          if (st === "auto_assigning") return "auto_assigning";
          if (!jobHasPartnerSet(formData as Job)) return "unassigned";
          return st ?? "scheduled";
        })(),
        progress: 0,
        current_phase: 0,
        total_phases: normalizeTotalPhases(formData.total_phases),
        client_price: cp,
        extras_amount: accessSurcharge,
        partner_cost: pc,
        materials_cost: mc,
        margin_percent: margin,
        scheduled_date: formData.scheduled_date,
        scheduled_start_at: formData.scheduled_start_at,
        scheduled_end_at: formData.scheduled_end_at,
        scheduled_finish_date: formData.scheduled_finish_date ?? null,
        job_type: formData.job_type ?? "fixed",
        hourly_client_rate: formData.hourly_client_rate ?? null,
        hourly_partner_rate: formData.hourly_partner_rate ?? null,
        billed_hours: formData.billed_hours ?? null,
        in_ccz: housekeepFromPayload ? false : inCczEff,
        has_free_parking: housekeepFromPayload ? true : (formData.has_free_parking ?? null),
        cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
        partner_agreed_value: 0, finance_status: "unpaid", service_value: cp + accessSurcharge,
        report_submitted: false,
        report_1_uploaded: false, report_1_approved: false,
        report_2_uploaded: false, report_2_approved: false,
        report_3_uploaded: false, report_3_approved: false,
        partner_payment_1: 0, partner_payment_1_paid: false,
        partner_payment_2: 0, partner_payment_2_paid: false,
        partner_payment_3: 0, partner_payment_3_paid: false,
        customer_deposit: 0, customer_deposit_paid: false,
        customer_final_payment: cp + accessSurcharge, customer_final_paid: false,
        scope: formData.scope?.trim() || undefined,
        additional_notes: formData.additional_notes?.trim() || undefined,
        report_link: (formData as { report_link?: string | null }).report_link?.trim() || undefined,
        images: capJobImagesArray(coerceJobImagesArray(formData.images)),
        external_source: formData.external_source ?? null,
        external_ref:    formData.external_ref    ?? null,
      });
      setCreateOpen(false);
      toast.success("Job created");
      setJobsNavQueue([result.id]);
      router.push(`/jobs/${result.id}`);
      void logAudit({ entityType: "job", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name }).catch(() => {});
      void loadDashboardStats();
      void Promise.resolve().then(() => refreshSilent());
      if (result.partner_id) {
        fetch("/api/push/notify-partner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId: result.partner_id,
            title: "Job Assigned",
            body: `${result.title} — ${result.property_address}`,
            data: { type: "job_assigned", jobId: result.id },
          }),
        }).catch(() => {});
        // Direct-assign path: send the confirmation_request email with the
        // tokenised Accept link. Partner clicks → /job/confirm → POST
        // /api/jobs/confirm-acceptance → status flips + booked email follow-up.
        void notifyPartnerJobChange({
          jobId:        result.id,
          jobReference: result.reference,
          kind:         "confirmation_request",
          skipPush:     true,
        });
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to create job"));
    }
  }, [refreshSilent, loadDashboardStats, profile?.id, profile?.full_name, router, confirmDespiteDuplicates]);

  const handleStatusChange = useCallback(async (job: Job, newStatus: Job["status"]) => {
    const check = canAdvanceJob(job, newStatus);
    if (!check.ok) {
      toast.error(check.message ?? "Complete the current step before advancing.");
      return;
    }
    try {
      let selfBillId: string | undefined = job.self_bill_id ?? undefined;
      if (newStatus === "awaiting_payment" && !job.self_bill_id) {
        const selfBill = await createSelfBillFromJob({
          id: job.id,
          reference: job.reference,
          partner_name: job.partner_name ?? "Unassigned",
          partner_cost: job.partner_cost,
          materials_cost: job.materials_cost,
        });
        selfBillId = selfBill.id;
      }
      const statusPatch: Partial<Job> = {
        status: newStatus,
        ...(selfBillId ? { self_bill_id: selfBillId } : {}),
        ...statusChangePartnerTimerPatch(job, newStatus),
      };
      const updated = await updateJob(job.id, statusPatch);
      await logAudit({ entityType: "job", entityId: job.id, entityRef: job.reference, action: "status_changed", fieldName: "status", oldValue: job.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
      toast.success(selfBillId ? `Self-bill created. Job moved to ${statusConfig[newStatus]?.label ?? newStatus}` : `Job moved to ${statusConfig[newStatus]?.label ?? newStatus}`);
      refresh(); loadDashboardStats();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  }, [refresh, loadDashboardStats, profile?.id, profile?.full_name]);

  const handleJobUpdate = useCallback(async (jobId: string, updates: Partial<Job>) => {
    try {
      await updateJob(jobId, updates);
      toast.success("Job updated"); refresh(); loadDashboardStats();
    } catch { toast.error("Failed to update"); }
  }, [refresh, loadDashboardStats]);

  const handleBulkStatusChange = async (newStatus: string): Promise<boolean> => {
    if (selectedIds.size === 0) return false;
    const supabase = getSupabase();
    const ids = Array.from(selectedIds);
    const ns = newStatus as Job["status"];
    try {
      let rows: Job[] = [];

      if (newStatus === "completed") {
        const { data: jobRows, error: jobErr } = await supabase.from("jobs").select("*").in("id", ids);
        if (jobErr) throw jobErr;
        if (!jobRows?.length) {
          toast.error("No jobs found for selection.");
          return false;
        }
        const { data: payRows, error: payErr } = await supabase
          .from("job_payments")
          .select("job_id, type, amount")
          .in("job_id", ids)
          .is("deleted_at", null);
        if (payErr) throw payErr;
        const byJob = new Map<string, { type: string; amount: number }[]>();
        for (const p of payRows ?? []) {
          const jid = p.job_id as string;
          const list = byJob.get(jid) ?? [];
          list.push({ type: p.type as string, amount: Number(p.amount) });
          byJob.set(jid, list);
        }
        const allowedFrom = new Set<string>(["awaiting_payment"]);
        for (const j of jobRows as Job[]) {
          if (!allowedFrom.has(j.status)) {
            toast.error(`${j.reference}: only Awaiting payment or Need attention can be completed (now: ${j.status}).`);
            return false;
          }
          const pays = byJob.get(j.id) ?? [];
          const customerPayments = pays.filter((p) => p.type === "customer_deposit" || p.type === "customer_final");
          const partnerPayments = pays.filter((p) => p.type === "partner");
          const check = canAdvanceJob(j, "completed", { customerPayments, partnerPayments });
          if (!check.ok) {
            toast.error(`${j.reference}: ${check.message ?? "Cannot complete"}`);
            return false;
          }
        }
        const found = new Set((jobRows as Job[]).map((j) => j.id));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length) {
          toast.error(`${missing.length} selected job(s) not found.`);
          return false;
        }
        rows = jobRows as Job[];
      } else {
        const { data, error } = await supabase
          .from("jobs")
          .select("id, status, reference, partner_timer_started_at, partner_timer_ended_at")
          .in("id", ids);
        if (error) throw error;
        if (!data?.length) {
          toast.error("No jobs found for selection.");
          return false;
        }
        const found = new Set((data as { id: string }[]).map((j) => j.id));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length) {
          toast.error(`${missing.length} selected job(s) not found.`);
          return false;
        }
        rows = data as Job[];
      }

      const nowIso = new Date().toISOString();
      const actorName = profile?.full_name?.trim() || profile?.email?.trim() || "Admin";
      for (const j of rows) {
        const patch: Record<string, unknown> = {
          status: ns,
          ...statusChangePartnerTimerPatch(j, ns),
        };
        if (ns === "completed") {
          const paidMarker = `[${nowIso}] ${BULK_MARK_PAID_NOTE_TAG}${actorName}`;
          const prevNotes = (j.internal_notes ?? "").trim();
          patch.completed_date = nowIso.slice(0, 10);
          patch.internal_notes = prevNotes ? `${prevNotes}\n\n${paidMarker}` : paidMarker;
        }
        let { error: upErr } = await supabase.from("jobs").update(prepareJobRowForUpdate(patch)).eq("id", j.id);
        if (upErr && isPostgrestWriteRetryableError(upErr)) {
          const r = await supabase.from("jobs").update(applyJobDbCompat({ ...patch })).eq("id", j.id);
          upErr = r.error;
        }
        if (upErr) throw upErr;
      }

      await refreshSelfBillPayoutStatesForJobIds(ids);

      await logBulkAction("job", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${ids.length} jobs updated`);
      setSelectedIds(new Set());
      refresh();
      loadDashboardStats();
      return true;
    } catch {
      toast.error("Failed");
      return false;
    }
  };

  const handleBulkStartJob = useCallback(async (): Promise<boolean> => {
    if (selectedIds.size === 0) return false;
    const supabase = getSupabase();
    const ids = Array.from(selectedIds);
    try {
      const { data: jobRows, error: jobErr } = await supabase.from("jobs").select("*").in("id", ids).is("deleted_at", null);
      if (jobErr) throw jobErr;
      if (!jobRows?.length) {
        toast.error("No jobs found for selection.");
        return false;
      }
      const found = new Set((jobRows as Job[]).map((j) => j.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) {
        toast.error(`${missing.length} selected job(s) not found or in Deleted.`);
        return false;
      }
      const ns = "in_progress" as const;
      for (const j of jobRows as Job[]) {
        const check = canAdvanceJob(j, ns);
        if (!check.ok) {
          toast.error(`${j.reference}: ${check.message ?? "Cannot start job"}`);
          return false;
        }
      }
      for (const j of jobRows as Job[]) {
        const patch: Record<string, unknown> = {
          status: ns,
          ...statusChangePartnerTimerPatch(j, ns),
        };
        let { error: upErr } = await supabase.from("jobs").update(prepareJobRowForUpdate(patch)).eq("id", j.id);
        if (upErr && isPostgrestWriteRetryableError(upErr)) {
          const r = await supabase.from("jobs").update(applyJobDbCompat({ ...patch })).eq("id", j.id);
          upErr = r.error;
        }
        if (upErr) throw upErr;
      }
      await refreshSelfBillPayoutStatesForJobIds(ids);
      await logBulkAction("job", ids, "status_changed", "status", ns, profile?.id, profile?.full_name);
      toast.success(`${ids.length} job(s) moved to In progress`);
      setSelectedIds(new Set());
      refresh();
      loadDashboardStats();
      return true;
    } catch {
      toast.error("Failed to start jobs");
      return false;
    }
  }, [selectedIds, profile?.id, profile?.full_name, refresh, loadDashboardStats]);

  const handleBulkCancelJobs = useCallback(async (): Promise<boolean> => {
    if (selectedIds.size === 0) return false;
    const supabase = getSupabase();
    const ids = Array.from(selectedIds);
    if (officeCancellationDetailRequired(bulkCancelPresetId) && !bulkCancelDetail.trim()) {
      toast.error("Please add cancellation details for 'Other'.");
      return false;
    }
    const reason = buildOfficeCancellationReasonText(bulkCancelPresetId, bulkCancelDetail, officeCancellationPresets);
    try {
      const { data: jobRows, error: jobErr } = await supabase.from("jobs").select("*").in("id", ids).is("deleted_at", null);
      if (jobErr) throw jobErr;
      if (!jobRows?.length) {
        toast.error("No jobs found for selection.");
        return false;
      }
      const now = new Date().toISOString();
      let updatedCount = 0;
      const cancelledForInvoices: Job[] = [];
      for (const j of jobRows as Job[]) {
        if (j.status === "cancelled") continue;
        if (j.status === "completed") {
          toast.error(`${j.reference}: completed jobs cannot be cancelled in bulk.`);
          return false;
        }
        const patch: Record<string, unknown> = {
          ...patchOfficeCancelZeroJobEconomics(),
          status: "cancelled",
          cancellation_reason: reason,
          cancelled_at: now,
          cancelled_by: profile?.id ?? null,
          ...statusChangePartnerTimerPatch(j, "cancelled"),
          ...statusChangeOfficeTimerPatch(j, "cancelled"),
        };
        let { error: upErr } = await supabase.from("jobs").update(prepareJobRowForUpdate(patch)).eq("id", j.id);
        if (upErr && isPostgrestWriteRetryableError(upErr)) {
          const r = await supabase.from("jobs").update(applyJobDbCompat({ ...patch })).eq("id", j.id);
          upErr = r.error;
        }
        if (upErr) throw upErr;
        updatedCount += 1;
        const mergedForBump = { ...j, ...patch } as Job;
        void bumpLinkedInvoiceAmountsToJobSchedule(mergedForBump).catch((e) =>
          console.error("bumpLinkedInvoiceAmountsToJobSchedule", j.reference, e),
        );
        cancelledForInvoices.push(j);
        if (j.partner_id?.trim()) {
          const fresh = { ...j, ...patch } as Job;
          notifyAssignedPartnerAboutJob({
            partnerId: j.partner_id,
            job: fresh,
            kind: "job_cancelled_by_office",
            cancellationReason: reason,
          });
        }
      }
      if (updatedCount === 0) {
        toast.message("No eligible jobs to cancel (already cancelled).");
        return false;
      }
      await Promise.all(
        cancelledForInvoices.map((j) =>
          cancelOpenInvoicesForJobCancellation({
            jobReference: j.reference,
            cancellationReason: reason,
            primaryInvoiceId: j.invoice_id,
          }).catch((e) => console.error("cancelOpenInvoicesForJobCancellation", j.reference, e)),
        ),
      );
      await refreshSelfBillPayoutStatesForJobIds(ids);
      await logBulkAction("job", ids, "status_changed", "status", "cancelled", profile?.id, profile?.full_name);
      toast.success(`${updatedCount} job(s) cancelled`);
      setSelectedIds(new Set());
      refresh();
      loadDashboardStats();
      return true;
    } catch {
      toast.error("Failed to cancel jobs");
      return false;
    }
  }, [
    selectedIds,
    bulkCancelPresetId,
    bulkCancelDetail,
    profile?.id,
    profile?.full_name,
    officeCancellationPresets,
    refresh,
    loadDashboardStats,
  ]);

  const handleBulkArchive = useCallback(async (): Promise<boolean> => {
    if (selectedIds.size === 0) return false;
    try {
      const ids = Array.from(selectedIds);
      const supabase = getSupabase();
      const { data: jobRows, error: jobFetchErr } = await supabase
        .from("jobs")
        .select("id, reference, invoice_id, self_bill_id, status")
        .in("id", ids)
        .is("deleted_at", null);
      if (jobFetchErr) throw jobFetchErr;
      const rows = (jobRows ?? []) as Pick<Job, "id" | "reference" | "invoice_id" | "self_bill_id" | "status">[];
      const eligible = rows.filter((j) => j.status !== "deleted");
      if (eligible.length === 0) {
        toast.message("No eligible jobs to delete.");
        return false;
      }
      const forInvoices = eligible.map((j) => ({ reference: j.reference, invoice_id: j.invoice_id }));
      const selfBillIds = [
        ...new Set(
          eligible.map((r) => r.self_bill_id).filter((x): x is string => Boolean(x && String(x).trim())),
        ),
      ];
      await softDeleteInvoicesForArchivedJobs(forInvoices, profile?.id);
      const ts = new Date().toISOString();
      const uid = profile?.id ?? null;
      await Promise.all(
        eligible.map((j) =>
          supabase
            .from("jobs")
            .update({
              deleted_previous_status: j.status,
              status: "deleted",
              deleted_at: ts,
              deleted_by: uid,
            })
            .eq("id", j.id),
        ),
      );
      await Promise.all(selfBillIds.map((bid) => refreshSelfBillPayoutState(bid)));
      await logBulkAction("job", eligible.map((j) => j.id), "deleted", "status", "deleted", profile?.id, profile?.full_name);
      toast.success(`${eligible.length} job(s) moved to Deleted`);
      setSelectedIds(new Set());
      refresh();
      loadDashboardStats();
      return true;
    } catch {
      toast.error("Failed to delete jobs");
      return false;
    }
  }, [selectedIds, profile?.id, profile?.full_name, refresh, loadDashboardStats]);

  const handleBulkRecoverJobs = useCallback(async (): Promise<boolean> => {
    if (selectedIds.size === 0) return false;
    try {
      const ids = Array.from(selectedIds);
      const supabase = getSupabase();
      const { data: jobRows, error: jobFetchErr } = await supabase
        .from("jobs")
        .select("id, self_bill_id, deleted_previous_status")
        .in("id", ids)
        .eq("status", "deleted")
        .not("deleted_at", "is", null);
      if (jobFetchErr) throw jobFetchErr;
      const rows = (jobRows ?? []) as Pick<Job, "id" | "self_bill_id" | "deleted_previous_status">[];
      if (rows.length === 0) {
        toast.message("No deleted jobs selected.");
        return false;
      }
      const selfBillIds = [
        ...new Set(
          rows.map((r) => r.self_bill_id).filter((x): x is string => Boolean(x && String(x).trim())),
        ),
      ];
      await Promise.all(
        rows.map((j) => {
          const next = parseRestoredJobStatus(j.deleted_previous_status);
          return supabase
            .from("jobs")
            .update({
              status: next,
              deleted_at: null,
              deleted_by: null,
              deleted_previous_status: null,
            })
            .eq("id", j.id);
        }),
      );
      await Promise.all(selfBillIds.map((bid) => refreshSelfBillPayoutState(bid)));
      await logBulkAction("job", rows.map((r) => r.id), "status_changed", "deleted_at", "recovered", profile?.id, profile?.full_name);
      toast.success(`${rows.length} job(s) recovered`, {
        description: "Linked invoices stay cancelled—adjust in Finance if needed.",
      });
      setSelectedIds(new Set());
      refresh();
      loadDashboardStats();
      return true;
    } catch {
      toast.error("Failed to recover jobs");
      return false;
    }
  }, [selectedIds, profile?.id, profile?.full_name, refresh, loadDashboardStats]);

  const columns: Column<Job>[] = [
    {
      key: "reference",
      label: "Job",
      minWidth: "132px",
      cellClassName: "min-w-[8rem]",
      sortable: true,
      sortOptions: jobColumnSortPack("reference", "Job"),
      render: (item) => (
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] font-semibold text-text-primary truncate">{item.reference}</p>
          <p className="text-[10px] text-text-tertiary line-clamp-2 break-words">{normalizeTypeOfWork(item.title) || item.title}</p>
        </div>
      ),
    },
    {
      key: "client_name",
      label: "Client / Property",
      minWidth: "160px",
      cellClassName: "min-w-[10rem] max-w-[14rem] sm:max-w-[16rem]",
      sortable: true,
      sortOptions: jobColumnSortPack("client_name", "Client"),
      render: (item) => {
        const logo =
          item.client_id && clientAccountLogoByClientId[item.client_id] != null
            ? clientAccountLogoByClientId[item.client_id]?.trim() || undefined
            : undefined;
        return (
          <div className="flex items-start gap-2 min-w-0">
            <Avatar name={item.client_name} size="sm" className="shrink-0 mt-0.5" src={logo} />
            <div className="min-w-0 leading-tight">
              <p className="text-[13px] font-medium text-text-primary truncate">{item.client_name}</p>
              <p className="text-[10px] text-text-tertiary line-clamp-2 break-words">{item.property_address}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "schedule",
      label: "Schedule",
      minWidth: "200px",
      cellClassName: "min-w-[12.5rem] max-w-[16rem]",
      sortable: true,
      sortOptions: JOB_SORT_SCHEDULE,
      render: (item) => {
        const line = formatJobScheduleListLabel(item);
        const detail = formatJobScheduleLine(item);
        const secondaryLine = jobManagementScheduleSecondaryLine(item);
        const isOnsiteInProgress = (JOB_ONSITE_PROGRESS_STATUSES as readonly string[]).includes(item.status);
        const timingKind = getJobScheduleTimingKind(item);
        const hasChip = Boolean(timingKind);
        return (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {hasChip ? (
                <JobScheduleTimingChip job={item} title={detail} />
              ) : line ? (
                <span
                  className="text-[11px] text-text-secondary leading-snug whitespace-normal break-words"
                  title={detail ?? undefined}
                >
                  {line}
                </span>
              ) : (
                <span className="text-[11px] text-text-tertiary">—</span>
              )}
            </div>
            {isOnsiteInProgress ? (
              <ScheduleInProgressLiveSecondary job={item} />
            ) : secondaryLine ? (
              <p className="mt-0.5 text-[10px] text-text-tertiary leading-tight">{secondaryLine}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "type_of_work",
      label: "Partner",
      minWidth: "132px",
      cellClassName: "min-w-[7rem] max-w-[12rem]",
      headerClassName: "whitespace-nowrap normal-case",
      sortable: true,
      sortOptions: jobColumnSortPack("partner_name", "Partner"),
      render: (item) => {
        const partner = item.partner_name?.trim();
        return (
          <div className="min-w-0">
            {partner ? (
              <div className="flex items-center gap-1.5 min-w-0" title={partner}>
                <Avatar name={partner} size="xs" className="shrink-0" />
                <span className="text-[12px] text-text-secondary truncate">{partner}</span>
              </div>
            ) : (
              <span className="text-[11px] text-text-tertiary italic block">
                Unassigned
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      minWidth: "118px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap normal-case",
      sortable: true,
      sortOptions: JOB_SORT_STATUS,
      render: (item) => {
        if (status === "action_required") {
          const label = item.status === "on_hold" ? "On Hold" : "Unassigned";
          const variant = item.status === "on_hold" ? JOB_STATUS_BADGE_VARIANT.on_hold : JOB_STATUS_BADGE_VARIANT.unassigned;
          return (
            <div className="inline-flex flex-col items-start gap-0.5">
              <div className="inline-flex flex-wrap items-center gap-1.5">
                <Badge variant={variant} dot>{label}</Badge>
                <JobOverdueBadge job={item} />
              </div>
              {item.status === "on_hold" ? (
                <p className="text-[10px] leading-tight text-text-tertiary">{jobOnHoldDurationSubtitle(item)}</p>
              ) : null}
            </div>
          );
        }
        if (status === "closed") {
          const bucket = jobsManagementClosedBucket(item);
          const lbl = jobsManagementClosedBucketLabel(bucket);
          const statusKey =
            bucket === "paid"
              ? "completed"
              : bucket === "awaiting_payment"
                ? "awaiting_payment"
                : bucket === "archived"
                  ? "deleted"
                  : "cancelled";
          const variantTag = JOB_STATUS_BADGE_VARIANT[statusKey];
          return (
            <div className="inline-flex flex-wrap items-center gap-1.5">
              <Badge variant={variantTag} dot>{lbl}</Badge>
              <JobOverdueBadge job={item} />
            </div>
          );
        }
        const st = effectiveJobStatusForDisplay(item);
        const c = statusConfig[st] ?? { label: st, variant: "default" as const };
        return (
          <div className="inline-flex flex-col items-start gap-0.5">
            <div className="inline-flex flex-wrap items-center gap-1.5">
              <Badge variant={c.variant} dot={c.dot}>{c.label}</Badge>
              <JobOverdueBadge job={item} />
            </div>
            {st === "on_hold" ? (
              <p className="text-[10px] leading-tight text-text-tertiary">{jobOnHoldDurationSubtitle(item)}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "account",
      label: "Account",
      minWidth: "100px",
      cellClassName: "min-w-[6.25rem] max-w-[8rem]",
      sortable: true,
      sortOptions: jobColumnSortPack("account", "Account"),
      render: (item) =>
        item.client_id && clientAccountMap[item.client_id] ? (
          <span className="text-sm text-text-primary block truncate" title={clientAccountMap[item.client_id]}>
            {clientAccountMap[item.client_id]}
          </span>
        ) : (
          <span className="text-xs text-text-tertiary italic">No account</span>
        ),
    },
    {
      key: "margin_percent",
      label: "Job Amount",
      minWidth: "112px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap normal-case",
      sortable: true,
      sortOptions: JOB_SORT_AMOUNT,
      render: (item) => {
        const amount = jobBillableAmount(item);
        const marginPct = item.margin_percent;
        return (
          <div>
            <p className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(amount)}</p>
            <span
              className={`text-[11px] font-medium ${marginPct >= 20 ? "text-emerald-600" : "text-amber-600"}`}
            >
              {marginPct}% margin
            </span>
          </div>
        );
      },
    },
    {
      key: "amount_due",
      label: "Amount Due",
      minWidth: "96px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap normal-case",
      sortable: true,
      sortOptions: JOB_SORT_AMOUNT_DUE,
      render: (item) => {
        if (!customerPaidSumsReady) {
          return <span className="text-sm text-text-tertiary">…</span>;
        }
        const billable = jobCustomerBillableRevenueForCollections(item);
        const paid = customerPaidByJobId[item.id] ?? 0;
        const due = Math.max(0, billable - paid);
        return <span className="text-sm font-semibold text-text-primary">{formatCurrency(due)}</span>;
      },
    },
    {
      key: "finance_status",
      label: "Finance",
      minWidth: "88px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap normal-case",
      sortable: true,
      sortOptions: JOB_SORT_FINANCE,
      render: (item) => {
        const fs = item.finance_status ?? "unpaid";
        return <Badge variant={fs === "paid" ? "success" : fs === "partial" ? "warning" : "default"} size="sm">{fs === "paid" ? "Paid" : fs === "partial" ? "Partial" : "Unpaid"}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      width: "44px",
      minWidth: "44px",
      cellClassName: "w-11 px-2 sm:px-3 text-center align-middle",
      headerClassName: "w-11 normal-case",
      render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors inline-block" />,
    },
  ];

  const zendeskTicketColumn: Column<Job> = useMemo(
    () => ({
      key: "zendesk_ticket",
      label: "Ticket",
      minWidth: "96px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap normal-case",
      render: (item: Job) =>
        item.external_source === "zendesk" && item.external_ref?.trim() ? (
          <ZendeskTicketBadge source={item.external_source} ref={item.external_ref} size="sm" />
        ) : (
          <span className="text-xs text-text-tertiary">—</span>
        ),
    }),
    [],
  );

  const replaceFinanceWithTicket = useCallback(
    (cols: Column<Job>[]) => cols.map((c) => (c.key === "finance_status" ? zendeskTicketColumn : c)),
    [zendeskTicketColumn],
  );

  /** Closed tab keeps Finance; all other tabs show Zendesk ticket. Active jobs also drop Amount Due and add Cost. */
  const tableColumns = useMemo(() => {
    if (status === "closed") return columns;

    if (status !== "all") return replaceFinanceWithTicket(columns);

    const withoutDue = columns.filter((c) => c.key !== "amount_due");
    const withZendeskTicket = replaceFinanceWithTicket(withoutDue);
    const jobAmountIdx = withZendeskTicket.findIndex((c) => c.key === "margin_percent");
    if (jobAmountIdx < 0) return withZendeskTicket;
    const costColumn: Column<Job> = {
      key: "partner_cost",
      label: "Cost",
      minWidth: "88px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap normal-case",
      sortable: true,
      sortOptions: JOB_SORT_COST,
      render: (item) => (
        <span className="text-sm font-semibold text-text-secondary tabular-nums">
          {formatCurrency(Number(item.partner_cost ?? 0))}
        </span>
      ),
    };
    return [
      ...withZendeskTicket.slice(0, jobAmountIdx + 1),
      costColumn,
      ...withZendeskTicket.slice(jobAmountIdx + 1),
    ];
  }, [columns, status, replaceFinanceWithTicket]);

  const selectedJobRows = useMemo(() => data.filter((j) => selectedIds.has(j.id)), [data, selectedIds]);
  const hasArchivedSelected = selectedJobRows.some((j) => j.status === "deleted");

  const awaitingPaymentAccountGroups = useMemo(() => {
    const useAwaitingPaymentGrouping =
      status === "closed" && (closedJobsFilter === "all" || closedJobsFilter === "awaiting_payment");
    if (!useAwaitingPaymentGrouping || sortedDataForTable.length === 0) return [] as { key: string; jobs: Job[] }[];
    const awaitingRows = sortedDataForTable.filter((j) => j.status === "awaiting_payment");
    if (awaitingRows.length === 0) return [] as { key: string; jobs: Job[] }[];
    const m = new Map<string, Job[]>();
    for (const job of awaitingRows) {
      const aid = job.client_id ? clientIdToSourceAccountId[job.client_id] ?? null : null;
      const key = aid ? `acc:${aid}` : "acc:unlinked";
      const list = m.get(key);
      if (list) list.push(job);
      else m.set(key, [job]);
    }
    const list = [...m.entries()].map(([key, jobs]) => ({ key, jobs }));
    list.sort((a, b) => {
      if (a.key === "acc:unlinked") return 1;
      if (b.key === "acc:unlinked") return -1;
      return firstJobAccountLabel(a.jobs, clientAccountMap).localeCompare(
        firstJobAccountLabel(b.jobs, clientAccountMap),
      );
    });
    return list;
  }, [status, closedJobsFilter, sortedDataForTable, clientIdToSourceAccountId, clientAccountMap]);

  const awaitingPaymentGroupKeysSig = useMemo(
    () => awaitingPaymentAccountGroups.map((g) => g.key).join("|"),
    [awaitingPaymentAccountGroups],
  );
  const prevAwaitingPaymentGroupKeysSig = useRef<string | null>(null);

  useEffect(() => {
    const useGrouping =
      status === "closed" && (closedJobsFilter === "all" || closedJobsFilter === "awaiting_payment");
    if (!useGrouping || awaitingPaymentAccountGroups.length === 0) return;
    if (prevAwaitingPaymentGroupKeysSig.current === awaitingPaymentGroupKeysSig) return;
    prevAwaitingPaymentGroupKeysSig.current = awaitingPaymentGroupKeysSig;
    setExpandedAwaitingPaymentAccountGroups(() => {
      const next: Record<string, boolean> = {};
      awaitingPaymentAccountGroups.forEach((g) => {
        next[g.key] = true;
      });
      return next;
    });
  }, [status, closedJobsFilter, awaitingPaymentGroupKeysSig, awaitingPaymentAccountGroups]);

  const awaitingPaymentGroupedSections = useMemo(() => {
    const useGrouping =
      status === "closed" && (closedJobsFilter === "all" || closedJobsFilter === "awaiting_payment");
    if (!useGrouping || sortedDataForTable.length === 0 || awaitingPaymentAccountGroups.length === 0) {
      return undefined;
    }
    return awaitingPaymentAccountGroups.map((g) => {
      const open = expandedAwaitingPaymentAccountGroups[g.key] ?? true;
      const accountName =
        g.key === "acc:unlinked" ? "Unlinked account" : firstJobAccountLabel(g.jobs, clientAccountMap);
      const first = g.jobs[0];
      const logo =
        first?.client_id && clientAccountLogoByClientId[first.client_id] != null
          ? clientAccountLogoByClientId[first.client_id]?.trim() || undefined
          : undefined;
      const avBg = accountHeaderAvatarBg(accountName);
      let totalJobAmount = 0;
      let totalDue = 0;
      for (const j of g.jobs) {
        totalJobAmount += j.client_price + Number(j.extras_amount ?? 0);
        if (customerPaidSumsReady) {
          const billable = jobCustomerBillableRevenueForCollections(j);
          const paid = customerPaidByJobId[j.id] ?? 0;
          totalDue += Math.max(0, billable - paid);
        }
      }
      return {
        key: g.key,
        items: open ? g.jobs : [],
        sectionHeader: (
          <button
            type="button"
            onClick={() =>
              setExpandedAwaitingPaymentAccountGroups((prev) => {
                const was = prev[g.key] ?? true;
                return { ...prev, [g.key]: !was };
              })
            }
            className="w-full px-[14px] py-2.5 text-left bg-surface-secondary border-b border-border-light flex items-center justify-between gap-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {logo ? (
                <Avatar name={accountName} src={logo} size="sm" className="shrink-0 ring-0" />
              ) : (
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: avBg }}
                  aria-hidden
                >
                  {accountName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[#020040] dark:text-text-primary truncate">{accountName}</p>
                <p className="text-[10px] text-text-tertiary">
                  {g.jobs.length} job{g.jobs.length !== 1 ? "s" : ""} awaiting payment
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Amount due</p>
                <p className="text-sm font-semibold tabular-nums text-[#ED4B00]">
                  {customerPaidSumsReady ? formatCurrency(totalDue) : "…"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Job amount</p>
                <p className="text-sm font-semibold tabular-nums text-[#020040] dark:text-text-primary">
                  {formatCurrency(totalJobAmount)}
                </p>
              </div>
              {open ? (
                <ChevronUp className="h-4 w-4 text-text-tertiary shrink-0" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 text-text-tertiary shrink-0" aria-hidden />
              )}
            </div>
          </button>
        ),
      };
    });
  }, [
    status,
    closedJobsFilter,
    sortedDataForTable.length,
    awaitingPaymentAccountGroups,
    expandedAwaitingPaymentAccountGroups,
    clientAccountMap,
    clientAccountLogoByClientId,
    customerPaidSumsReady,
    customerPaidByJobId,
  ]);

  const [exportOpen, setExportOpen] = useState(false);
  const jobVisibleFields = ["reference", "title", "client_name", "property_address", "status", "partner_name", "client_price", "finance_status"];
  const jobAllFields = useMemo(
    () => [...new Set(data.flatMap((row) => Object.keys(row as unknown as Record<string, unknown>)))],
    [data],
  );

  const handleExportFullCsv = useCallback(async (fields: string[]) => {
    try {
      const allRows: Job[] = [];
      let p = 1;
      const pageSize = 500;
      while (true) {
        const res = await fetchJobsManagementList({
          page: p,
          pageSize,
          search: search.trim() ? search : undefined,
          status: status !== "all" ? status : undefined,
          ...(listParams ?? {}),
        });
        allRows.push(...res.data);
        if (p >= res.totalPages) break;
        p += 1;
      }
      const filtered = allRows.filter((j) => {
        if (filterPartner === "__none__") {
          if (j.partner_id || j.partner_name) return false;
        } else if (filterPartner !== "all") {
          if (j.partner_id !== filterPartner) return false;
        }
        if (filterAccountId !== "all") {
          const acc = j.client_id ? clientIdToSourceAccountId[j.client_id] ?? null : null;
          if (acc !== filterAccountId) return false;
        }
        const hasDate = !!(j.scheduled_date || j.scheduled_start_at || j.scheduled_finish_date);
        if (filterScheduled === "scheduled" && !hasDate) return false;
        if (filterScheduled === "unscheduled" && hasDate) return false;
        return jobPassesJobsPageBuFilter(j, buFilter.selectedBuId, buFilter.clientIdsInBu, buAccountIds, propertyIdToAccountId);
      });
      if (filtered.length === 0) {
        toast.info("No jobs to export");
        return;
      }
      const rows = filtered as unknown as Array<Record<string, unknown>>;
      const finalFields = fields.length > 0 ? fields : [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const csv = buildCsvFromRows(rows, finalFields);
      downloadCsvFile(`jobs-${status}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${filtered.length} jobs with full fields`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export jobs");
    }
  }, [
    search,
    status,
    listParams,
    fetchJobsManagementList,
    filterPartner,
    filterAccountId,
    filterScheduled,
    buFilter.selectedBuId,
    buFilter.clientIdsInBu,
    buAccountIds,
    propertyIdToAccountId,
    clientIdToSourceAccountId,
  ]);

  const scheduleWindowLine = scheduleWindowHintLine(scheduleDatePreset, scheduleRange);
  const jobsPageInfoTooltip = useMemo(() => {
    const parts = [
      "Track and manage jobs.",
      "First KPI = active pipeline (Action Required through Final Checks). Avg time = mean wall-clock duration from scheduled anchor (start of booking) to first transition into Final Checks (audit), in the same schedule window.",
      "On Active jobs, Revenue & Cost sum the Job Amount and partner Cost columns in the list.",
      "On other tabs, Avg ticket & margin use the same schedule window as the list when Dates is set.",
    ];
    if (scheduleWindowLine) parts.push(scheduleWindowLine);
    return parts.join("\n\n");
  }, [scheduleWindowLine]);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Jobs Management" infoTooltip={jobsPageInfoTooltip}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DateRangeFilter
              variant="chip"
              value={{
                mode: scheduleDatePreset as DateFilterMode,
                customFrom: customScheduleFrom,
                customTo: customScheduleTo,
              }}
              onChange={(next: DateFilterValue) => {
                setScheduleDatePreset(next.mode);
                if (next.mode === "custom") {
                  setCustomScheduleFrom(next.customFrom ?? customScheduleFrom);
                  setCustomScheduleTo(next.customTo ?? customScheduleTo);
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => {
                void loadDashboardStats();
                refreshSilent();
              }}
              title="Reload jobs, KPIs, and tab counts from the server (no full-table loading flash)"
            >
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setExportOpen(true)}>
              Export
            </Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Job</Button>
          </div>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
          <KpiCard
            className="min-h-[128px] h-full"
            title={scheduleRange ? "Active jobs (window)" : "Active jobs"}
            value={kpiFinancialLoading ? "—" : kpiActiveJobsCount}
            format="number"
            icon={Briefcase}
            accent="blue"
          />
          <KpiCard
            className="min-h-[128px] h-full"
            title="Avg. time per job"
            value={kpiFinancialLoading ? "—" : kpiAvgWorkTimeLabel}
            format="none"
            icon={Timer}
            accent="emerald"
          />
          {status === "all" ? (
            <>
              <KpiCard
                className="min-h-[128px] h-full"
                title="Revenue"
                value={loading ? "—" : formatCurrencyPrecise(activeJobsTabFinancialTotals.revenue)}
                format="none"
                icon={Receipt}
                accent="purple"
              />
              <KpiCard
                className="min-h-[128px] h-full"
                title="Cost"
                value={loading ? "—" : formatCurrencyPrecise(activeJobsTabFinancialTotals.cost)}
                format="none"
                icon={Wallet}
                accent="amber"
              />
            </>
          ) : (
            <>
              <KpiCard
                className="min-h-[128px] h-full"
                title="Avg ticket"
                value={kpiFinancialLoading ? "—" : formatCurrencyPrecise(avgTicket)}
                format="none"
                icon={Receipt}
                accent="purple"
              />
              <KpiCard
                className="min-h-[128px] h-full"
                title="Avg margin"
                value={kpiFinancialLoading ? "—" : avgMarginPct}
                format={kpiFinancialLoading ? "none" : "percent"}
                icon={TrendingUp}
                accent="amber"
              />
            </>
          )}
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 pb-1 -mb-1">
            <Tabs
              tabs={tabs}
              activeTab={status}
              onChange={(id) => {
                if (id !== "closed") setClosedJobsFilter("all");
                setStatus(id);
              }}
            />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: MapIcon }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}><Icon className="h-3.5 w-3.5" /></button>
                ))}
              </div>
              <SearchInput placeholder="Search jobs..." className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="relative flex items-center gap-1.5" ref={filterRef}>
                <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>
                  Filter
                </Button>
                {(filterPartner !== "all" || filterAccountId !== "all" || filterScheduled !== "all" || filterSort !== "schedule_nearest" || buFilter.selectedBuId) && (
                  <span className="text-[10px] font-medium text-primary">Active</span>
                )}
                {filterOpen && (
                  <div className="absolute top-full right-0 mt-1 w-64 rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Partner</p>
                      <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                        <option value="all">All Partners</option>
                        <option value="__none__">Unassigned Only</option>
                        {filterPartnersList.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Account</p>
                      <select value={filterAccountId} onChange={(e) => setFilterAccountId(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                        <option value="all">All Accounts</option>
                        {filterAccountsList.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Scheduled</p>
                      <select value={filterScheduled} onChange={(e) => setFilterScheduled(e.target.value as "all" | "scheduled" | "unscheduled")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                        <option value="all">All</option><option value="scheduled">Has date</option><option value="unscheduled">No date</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Sort</p>
                      <select value={filterSort} onChange={(e) => setFilterSort(e.target.value as JobsSortMode)} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                        <option value="schedule_nearest">Nearest schedule (default)</option>
                        <option value="schedule_farthest">Farthest schedule</option>
                        <option value="booking_recent">Most recent booking</option>
                        <option value="booking_oldest">Oldest booking</option>
                      </select>
                    </div>
                    {buFilter.visible && (
                      <div>
                        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Business Unit</p>
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
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFilterPartner("all"); setFilterAccountId("all"); setFilterScheduled("all"); setFilterSort("schedule_nearest"); buFilter.setSelectedBuId(null); }}>Clear filters</Button>
                    <div className="pt-2 mt-1 border-t border-border-light">
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">Default tab on open</p>
                      <select
                        value={defaultJobsTab}
                        onChange={(e) => setDefaultJobsTab(e.target.value as JobsDefaultTabId)}
                        className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2"
                      >
                        {JOBS_DEFAULT_TAB_IDS.map((id) => (
                          <option key={id} value={id}>{JOBS_DEFAULT_TAB_LABELS[id]}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-text-tertiary mt-1 leading-snug">Applies the next time you open Jobs.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {status === "closed" ? (
            <div className="flex flex-wrap items-center gap-2 mb-4 pb-1 border-b border-border-light">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Closed</span>
              {(
                [
                  ["all", "All"],
                  ["paid", "Paid"],
                  ["awaiting_payment", "Awaiting Payment"],
                  ["archived", "Archived"],
                  ["lost", "Lost"],
                ] as const
              ).map(([id, lbl]) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={closedJobsFilter === id ? "primary" : "outline"}
                  className="h-7 text-[11px] px-2.5"
                  onClick={() => setClosedJobsFilter(id)}
                >
                  {lbl}
                </Button>
              ))}
            </div>
          ) : null}
          {viewMode === "list" && (
            <DataTable
              columns={tableColumns}
              data={sortedDataForTable}
              groupedSections={awaitingPaymentGroupedSections}
              columnConfigKey="jobs-columns"
              columnConfigScope={status === "closed" ? `closed-${closedJobsFilter}` : status}
              loading={loading}
              getRowId={(item) => item.id}
              onRowClick={openJobDetail}
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={jobsPageSize}
              pageSizeOptions={[...JOBS_PAGE_SIZE_OPTIONS]}
              onPageSizeChange={(size) => {
                setJobsPageSize(size);
                setPage(1);
              }}
              onPageChange={setPage}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              sortColumnKey={jobsListSortKey}
              sortDirection={jobsListSortDir}
              onSortChange={handleJobsListSortChange}
              bulkActions={
                status === "closed" ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {hasArchivedSelected ? (
                      <BulkBtn label="Recover" onClick={() => setBulkActionModal("recover")} variant="success" />
                    ) : null}
                    {closedJobsFilter === "all" || closedJobsFilter === "awaiting_payment" ? (
                      <BulkBtn label="Mark as paid" onClick={() => setBulkActionModal("mark_paid")} variant="success" />
                    ) : null}
                    <BulkBtn label="Cancel" onClick={() => setBulkActionModal("cancel")} variant="warning" />
                    <BulkBtn label="Archive" onClick={() => setBulkActionModal("archive")} variant="danger" />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <BulkBtn label="Cancel" onClick={() => setBulkActionModal("cancel")} variant="warning" />
                    <BulkBtn label="Archive" onClick={() => setBulkActionModal("archive")} variant="danger" />
                  </div>
                )
              }
            />
          )}
          {viewMode === "kanban" && (
            <div className="min-h-[400px]">
              {loading ? (
                <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div>
              ) : (
                <KanbanBoard
                  columns={kanbanColumns}
                  getCardId={(j) => j.id}
                  onCardClick={openJobDetail}
                  renderCard={(j) => {
                    const disp = effectiveJobStatusForDisplay(j);
                    const statusCaption =
                      status === "action_required"
                        ? j.status === "on_hold"
                          ? "On Hold"
                          : "Unassigned"
                        : status === "closed"
                          ? jobsManagementClosedBucketLabel(jobsManagementClosedBucket(j))
                          : ((statusConfig[disp]?.label ?? disp) as string);
                    const sched = formatJobScheduleListLabel(j);
                    const schedDetail = formatJobScheduleLine(j);
                    const previousStatus = getPreviousJobStatus(j);
                    const prevLabel = previousStatus ? (statusConfig[previousStatus]?.label ?? previousStatus) : null;
                    return (
                      <div className="rounded-xl border border-border bg-card shadow-sm hover:border-primary/30 transition-colors cursor-pointer overflow-hidden flex flex-col">
                        {j.property_address?.trim() ? (
                          <div className="relative w-full aspect-[2/1] min-h-[100px] max-h-[140px] bg-surface-hover">
                            <LocationMiniMap address={j.property_address} className="h-full w-full" mapHeight="100%" showAddressBelowMap={false} lazy />
                          </div>
                        ) : null}
                        <div className="p-3 flex flex-col flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p>
                            <ZendeskTicketBadge source={j.external_source} ref={j.external_ref} size="xs" />
                          </div>
                          <p className="text-xs text-text-tertiary truncate">{normalizeTypeOfWork(j.title) || j.title}</p>
                          <div className="mt-1 flex flex-col items-start gap-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-1 min-w-0">
                              <p className="text-[10px] font-medium text-text-secondary truncate">{statusCaption}</p>
                              <JobOverdueBadge job={j} />
                            </div>
                            {status === "action_required" && j.status === "on_hold" ? (
                              <p className="text-[10px] leading-tight text-text-tertiary">{jobOnHoldDurationSubtitle(j)}</p>
                            ) : null}
                          </div>
                          {sched ? (
                            <p className="text-[10px] text-text-secondary mt-1 line-clamp-2 leading-snug" title={schedDetail ?? undefined}>
                              {sched}
                            </p>
                          ) : null}
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <Avatar
                              name={j.client_name}
                              size="xs"
                              className="shrink-0"
                              src={
                                j.client_id && clientAccountLogoByClientId[j.client_id] != null
                                  ? clientAccountLogoByClientId[j.client_id]?.trim() || undefined
                                  : undefined
                              }
                            />
                            <p className="text-[11px] text-text-secondary truncate min-w-0">{j.client_name}</p>
                          </div>
                          <JobCardFinanceRow job={j} />
                          {jobSitePhotoUrls(j).length > 0 ? (
                            <div className="mt-2 border-t border-border-light pt-2">
                              <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Site photos</p>
                              <JobSitePhotosStrip urls={jobSitePhotoUrls(j)} max={5} size="md" />
                            </div>
                          ) : null}
                          {previousStatus && prevLabel ? (
                            <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full h-8 text-[11px] shrink-0"
                                icon={<Undo2 className="h-3.5 w-3.5" />}
                                title={`Move to ${prevLabel}`}
                                onClick={() => void handleStatusChange(j, previousStatus)}
                              >
                                Back to {prevLabel}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }}
                />
              )}
            </div>
          )}
          {viewMode === "calendar" && <JobsCalendarView jobs={filteredData} loading={loading} onSelectJob={openJobDetail} />}
          {viewMode === "map" && <JobsMapView jobs={filteredData} loading={loading} onSelectJob={openJobDetail} />}
        </motion.div>
      </div>

      <Modal
        open={bulkActionModal != null}
        onClose={() => {
          if (!bulkRunning) setBulkActionModal(null);
        }}
        title={
          bulkActionModal === "start_job"
            ? "Start selected jobs?"
            : bulkActionModal === "cancel"
              ? "Move to Lost & Cancelled?"
              : bulkActionModal === "mark_paid"
                ? "Mark selected jobs as paid?"
                : bulkActionModal === "archive"
                  ? "Archive jobs?"
                  : bulkActionModal === "recover"
                    ? "Recover selected jobs?"
                    : ""
        }
        size="md"
      >
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary leading-relaxed">
            {bulkActionModal === "start_job" && (
              <>
                You are about to move <strong className="text-text-primary">{selectedIds.size}</strong> job(s) to{" "}
                <strong className="text-text-primary">In progress (phase 1)</strong>. Each job must have a partner assigned and a scheduled
                date. Are you sure you want to continue?
              </>
            )}
            {bulkActionModal === "cancel" && (
              <>
                Move <strong className="text-text-primary">{selectedIds.size}</strong> job(s) to{" "}
                <strong className="text-text-primary">Lost &amp; Cancelled</strong>? Completed jobs cannot be cancelled this way. Partners
                will be notified where applicable. This is not the same as Deleted (trash).
              </>
            )}
            {bulkActionModal === "mark_paid" && (
              <>
                You are about to mark <strong className="text-text-primary">{selectedIds.size}</strong> job(s) as{" "}
                <strong className="text-text-primary">paid and completed</strong>. Only jobs in{" "}
                <strong className="text-text-primary">Awaiting payment</strong> with full customer and partner settlements will be
                updated. Are you sure?
              </>
            )}
            {bulkActionModal === "archive" && (
              <>
                Move <strong className="text-text-primary">{selectedIds.size}</strong> job(s) to{" "}
                <strong className="text-text-primary">Archived</strong> under Closed (removed from KPIs / active pipelines). They appear with
                the <strong className="text-text-primary">Archived</strong> label; recover via Jobs → Closed → Archived. Linked invoices are
                cancelled and hidden from Finance—recovering a job does not restore invoices.
              </>
            )}
            {bulkActionModal === "recover" && (
              <>
                Restore <strong className="text-text-primary">{selectedIds.size}</strong> job(s) to their status before deletion (or
                Unassigned if unknown)? Self-bill totals refresh after recover.
              </>
            )}
          </p>
          {bulkActionModal === "cancel" ? (
            <div className="space-y-2 rounded-xl border border-border-light bg-surface-secondary p-3">
              <Select
                value={bulkCancelPresetId}
                onChange={(e) => setBulkCancelPresetId(e.target.value)}
                options={officeCancellationPresets.map((row) => ({ value: row.id, label: row.label }))}
              />
              <Input
                value={bulkCancelDetail}
                onChange={(e) => setBulkCancelDetail(e.target.value)}
                placeholder={officeCancellationDetailRequired(bulkCancelPresetId) ? "Required detail..." : "Optional detail..."}
              />
              {officeCancellationDetailRequired(bulkCancelPresetId) && !bulkCancelDetail.trim() ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">Please add details before confirming cancel.</p>
              ) : null}
            </div>
          ) : null}
          {bulkActionModal === "mark_paid" ? (
            <div className="space-y-2 rounded-xl border border-amber-400/50 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/20">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Attention: this action closes the job as paid and completed across operations and finance views.
              </p>
              <label className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-100">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={bulkMarkPaidConfirm}
                  onChange={(e) => setBulkMarkPaidConfirm(e.target.checked)}
                />
                Yes, I confirm these jobs are really paid.
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={bulkRunning} onClick={() => setBulkActionModal(null)}>
              Go back
            </Button>
            <Button
              type="button"
              variant={bulkActionModal === "archive" ? "danger" : "primary"}
              loading={bulkRunning}
              disabled={
                (bulkActionModal === "cancel" &&
                  officeCancellationDetailRequired(bulkCancelPresetId) &&
                  !bulkCancelDetail.trim()) ||
                (bulkActionModal === "mark_paid" && !bulkMarkPaidConfirm)
              }
              onClick={() => {
                void (async () => {
                  if (!bulkActionModal) return;
                  setBulkRunning(true);
                  try {
                    let ok = false;
                    if (bulkActionModal === "start_job") ok = await handleBulkStartJob();
                    else if (bulkActionModal === "cancel") ok = await handleBulkCancelJobs();
                    else if (bulkActionModal === "mark_paid") ok = await handleBulkStatusChange("completed");
                    else if (bulkActionModal === "archive") ok = await handleBulkArchive();
                    else if (bulkActionModal === "recover") ok = await handleBulkRecoverJobs();
                    if (ok) setBulkActionModal(null);
                  } finally {
                    setBulkRunning(false);
                  }
                })();
              }}
            >
              {bulkActionModal === "start_job"
                ? "Yes, start jobs"
                : bulkActionModal === "cancel"
                  ? "Yes, Lost & Cancelled"
                  : bulkActionModal === "mark_paid"
                    ? "Yes, mark as paid"
                    : bulkActionModal === "archive"
                      ? "Yes, archive"
                      : bulkActionModal === "recover"
                        ? "Yes, recover"
                        : "Confirm"}
            </Button>
          </div>
        </div>
      </Modal>

      <CreateJobModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
      <ExportCsvModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        allFields={jobAllFields}
        visibleFields={jobVisibleFields}
        onConfirm={handleExportFullCsv}
      />
    </PageTransition>
  );
}

export default function JobsPage() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-text-tertiary">Loading...</div>}><JobsPageContent /></Suspense>;
}

function isHousekeepWorkLabel(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return false;
  return v.includes("housekeep") || v.includes("house keep");
}

function workTypeIcon(label: string) {
  const v = label.toLowerCase();
  if (v.includes("electric")) return Sparkles;
  if (v.includes("plumb")) return MapPin;
  if (v.includes("paint") || v.includes("decor")) return Building2;
  if (v.includes("handy") || v.includes("carp") || v.includes("repair")) return Wrench;
  return Briefcase;
}

/* ========== CREATE JOB MODAL ========== */
function CreateJobModal({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (
    data: Partial<Job>,
    opts?: { series?: import("@/lib/job-modal-schedule").JobScheduleV2SeriesPayload },
  ) => void;
}) {
  const { accessFees } = useFrontendSetup();
  const requiredFieldClass = "border-[#d9d5cf] focus:border-[#b8b2aa] focus:ring-[#ede9e3] hover:border-[#cfcac3]";
  const [form, setForm] = useState({
    title: "",
    catalog_service_id: "",
    catalog_pricing_preset_id: "",
    catalog_pricing_addon_ids: [] as string[],
    partner_id: "",
    partner_ids: [] as string[],
    client_price: "",
    partner_cost: "",
    materials_cost: "0",
    job_kind: "one_off" as "one_off" | "multi_day" | "recurring",
    scheduled_date: "",
    arrival_from: "09:00",
    arrival_window_mins: "180",
    end_date: "",
    end_time: "17:00",
    job_type: "fixed",
    scope: "",
    additional_notes: "",
    report_link: "",
    hourly_client_rate: "",
    hourly_partner_rate: "",
    billed_hours: "1",
    in_ccz: false,
    has_free_parking: true,
    assignment_mode: "manual",
  });
  const [recurrence, setRecurrence] = useState<RecurrenceFormState>(DEFAULT_RECURRENCE_FORM);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [workTypeSearch, setWorkTypeSearch] = useState("");
  const [workTypeOpen, setWorkTypeOpen] = useState(false);
  const [sitePhotoFiles, setSitePhotoFiles] = useState<File[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const sitePhotosInputId = useId();
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const [zendesk, setZendesk] = useState<ZendeskTicketFieldValue>({ ticketId: "", noTicket: false });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  /** When fixed-price partner cost still matches the last auto-filled value, keep syncing to ~40% margin as inputs change. */
  const lastAutoPartnerCost = useRef<string | null>(null);

  // ─── mig 159/160: resolve per-account / per-partner pricing overrides ──
  // Resolve account_id from the picked client (clients.source_account_id).
  const [effectiveAccountId, setEffectiveAccountId] = useState<string | null>(null);
  useEffect(() => {
    const cid = clientAddress.client_id?.trim();
    if (!cid) {
      queueMicrotask(() => setEffectiveAccountId(null));
      return;
    }
    let cancelled = false;
    getSupabase()
      .from("clients")
      .select("source_account_id")
      .eq("id", cid)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const aid = (data as { source_account_id?: string | null } | null)?.source_account_id?.trim() ?? null;
        setEffectiveAccountId(aid);
      });
    return () => { cancelled = true; };
  }, [clientAddress.client_id]);

  const selectedCatalogService = catalogServices.find((s) => s.id === form.catalog_service_id);
  const serviceHasStackableAddons = selectedCatalogService ? catalogHasStackableAddons(selectedCatalogService) : false;
  /** Opt-in toggle: in Custom Price, the package/additionals UI is hidden by default; user clicks "Add additionals" to reveal it. Smart Pricing always shows. */
  const [packagePricingOpen, setPackagePricingOpen] = useState(false);

  useEffect(() => {
    setPackagePricingOpen(false);
  }, [form.catalog_service_id, form.job_type, open]);

  /** When true, the stackable package UI is active: auto-fill prices, lock inputs, enforce preset/account validation. */
  const isStackablePricing = serviceHasStackableAddons && packagePricingOpen;

  const catalogAddonOptions = useMemo(() => {
    if (!selectedCatalogService) return [];
    return sortPricingAddonsDisplay(parsePricingAddons(selectedCatalogService.pricing_addons));
  }, [selectedCatalogService]);

  const { pricing, loading: pricingResolving } = useResolvedJobPricing({
    accountId: effectiveAccountId,
    partnerId: form.assignment_mode === "manual" ? form.partner_id : null,
    catalogServiceId: isStackablePricing ? null : form.catalog_service_id,
    pricingPresetId: isStackablePricing ? null : form.catalog_pricing_preset_id,
  });

  const [accountPriceRow, setAccountPriceRow] = useState<AccountServicePrice | null>(null);
  const [stackableLinePricing, setStackableLinePricing] = useState<ResolvedCatalogLinePricing | null>(null);
  const [stackablePricingLoading, setStackablePricingLoading] = useState(false);

  useEffect(() => {
    const sid = form.catalog_service_id?.trim();
    const aid = effectiveAccountId?.trim();
    if (!sid || !aid) {
      queueMicrotask(() => setAccountPriceRow(null));
      return;
    }
    let cancelled = false;
    getAccountServicePrice(aid, sid)
      .then((row) => { if (!cancelled) setAccountPriceRow(row); })
      .catch(() => { if (!cancelled) setAccountPriceRow(null); });
    return () => { cancelled = true; };
  }, [form.catalog_service_id, effectiveAccountId]);

  useEffect(() => {
    if (!isStackablePricing || !selectedCatalogService || !form.catalog_pricing_preset_id.trim()) {
      queueMicrotask(() => {
        setStackableLinePricing(null);
        setStackablePricingLoading(false);
      });
      return;
    }
    let cancelled = false;
    setStackablePricingLoading(true);
    (async () => {
      const partnerId =
        form.assignment_mode === "manual" && form.partner_id.trim() ? form.partner_id.trim() : null;
      const partnerPrice =
        partnerId
          ? await getPartnerServicePrice(partnerId, selectedCatalogService.id).catch(() => null)
          : null;
      if (cancelled) return;
      const resolved = resolveCatalogLinePricing({
        catalog: selectedCatalogService,
        presetId: form.catalog_pricing_preset_id,
        addonIds: form.catalog_pricing_addon_ids,
        accountPrice: accountPriceRow,
        partnerPrice,
      });
      if (cancelled) return;
      setStackableLinePricing(resolved);
      setStackablePricingLoading(false);
      if (!resolved) return;
      lastAutoPartnerCost.current = null;
      setForm((prev) => ({
        ...prev,
        job_type: "fixed",
        client_price: String(resolved.clientTotal),
        partner_cost: String(resolved.partnerTotal),
      }));
    })();
    return () => { cancelled = true; };
  }, [
    isStackablePricing,
    selectedCatalogService,
    form.catalog_pricing_preset_id,
    form.catalog_pricing_addon_ids,
    form.partner_id,
    form.assignment_mode,
    accountPriceRow,
  ]);

  const applyPartnerPricing = (partnerId: string) => {
    lastAutoPartnerCost.current = null;
    setForm((prev) => ({ ...prev, partner_id: partnerId }));
  };

  // Auto-fill prices whenever the resolver returns a fresh `pricing` object.
  // The hook memoises pricing in its own state — it only changes after a fetch
  // completes for a new (account, partner, service) triple. So `[pricing]` as
  // sole dep gives correct behaviour without needing a ref guard (which used
  // to misfire when pricing lagged behind a triple change).
  useEffect(() => {
    if (isStackablePricing) return;
    if (!pricing) return;
    lastAutoPartnerCost.current = null;
    queueMicrotask(() =>
      setForm((prev) => ({
        ...prev,
        hourly_client_rate: pricing.client.hourly_rate?.toString() ?? prev.hourly_client_rate,
        hourly_partner_rate: pricing.partner.hourly_partner_rate?.toString() ?? prev.hourly_partner_rate,
        billed_hours: pricing.client.default_hours?.toString() ?? prev.billed_hours,
        client_price: pricing.client.fixed_price?.toString() ?? prev.client_price,
        partner_cost: pricing.partner.fixed_partner_cost?.toString() ?? prev.partner_cost,
      })),
    );
  }, [pricing, isStackablePricing]);
  const catalogPricingPresetOptions = useMemo(() => {
    if (!selectedCatalogService) return [];
    return sortPricingPresetsDisplay(parsePricingPresets(selectedCatalogService.pricing_presets));
  }, [selectedCatalogService]);

  useEffect(() => {
    const svc = catalogServices.find((s) => s.id === form.catalog_service_id);
    if (!svc) {
      queueMicrotask(() =>
        setForm((p) => (p.catalog_pricing_preset_id ? { ...p, catalog_pricing_preset_id: "" } : p)),
      );
      return;
    }
    const presets = sortPricingPresetsDisplay(parsePricingPresets(svc.pricing_presets));
    if (presets.length === 0) {
      queueMicrotask(() =>
        setForm((p) => (p.catalog_pricing_preset_id ? { ...p, catalog_pricing_preset_id: "" } : p)),
      );
      return;
    }
    queueMicrotask(() =>
      setForm((p) => {
        const cur = p.catalog_pricing_preset_id?.trim();
        if (cur && presets.some((x) => x.id === cur)) return p;
        return { ...p, catalog_pricing_preset_id: presets[0]?.id ?? "" };
      }),
    );
  }, [form.catalog_service_id, catalogServices]);
  const isHousekeepJob = isHousekeepWorkLabel(selectedCatalogService?.name) || isHousekeepWorkLabel(form.title);
  const targetWorkType =
    (form.job_type === "hourly" ? (selectedCatalogService?.name ?? form.title) : form.title).trim();
  const partnerSearchQ = partnerSearch.trim().toLowerCase();
  const eligiblePartners = useMemo(() => partners.filter((p) => isPartnerEligibleForWork(p)), [partners]);
  const filteredPartnersBase = !partnerSearchQ
    ? eligiblePartners
    : eligiblePartners.filter((p) => {
        const name = (p.company_name ?? p.contact_name ?? "").toLowerCase();
        const trade = (p.trade ?? "").toLowerCase();
        const location = (p.location ?? "").toLowerCase();
        const tradesFlat = (p.trades ?? []).join(" ").toLowerCase();
        return (
          name.includes(partnerSearchQ) ||
          trade.includes(partnerSearchQ) ||
          location.includes(partnerSearchQ) ||
          tradesFlat.includes(partnerSearchQ)
        );
      });
  const filteredPartners = [...filteredPartnersBase].sort((a, b) => {
    const cid = form.catalog_service_id?.trim() || "";
    const aMatch = targetWorkType ? safePartnerMatchesTypeOfWork(a, targetWorkType, cid || null) : false;
    const bMatch = targetWorkType ? safePartnerMatchesTypeOfWork(b, targetWorkType, cid || null) : false;
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    return (a.company_name ?? a.contact_name ?? "").localeCompare(b.company_name ?? b.contact_name ?? "");
  });
  const filteredWorkTypes = useMemo(() => {
    const labels = typeOfWorkLabelsFromCatalog(catalogServices, null);
    const q = workTypeSearch.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((name) => name.toLowerCase().includes(q));
  }, [workTypeSearch, catalogServices]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      listPartners({ pageSize: 200, status: "all" }).then((r) => r.data ?? []).catch(() => []),
      listCatalogServicesForPicker().catch(() => []),
    ]).then(([ps, catalog]) => {
      setPartners(ps);
      setCatalogServices(catalog);
    });
  }, [open]);

  useEffect(() => {
    if (open) return;
    queueMicrotask(() => setSitePhotoFiles([]));
  }, [open]);

  const sitePhotoPreviewUrls = useMemo(() => sitePhotoFiles.map((f) => URL.createObjectURL(f)), [sitePhotoFiles]);
  useEffect(() => {
    return () => {
      sitePhotoPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [sitePhotoPreviewUrls]);

  useEffect(() => {
    if (isHousekeepJob) return;
    const eligible = isLikelyCczAddress(clientAddress.property_address);
    queueMicrotask(() => {
      setForm((prev) => {
        if (!eligible && prev.in_ccz) return { ...prev, in_ccz: false };
        return prev;
      });
    });
  }, [clientAddress.property_address, isHousekeepJob]);

  useEffect(() => {
    if (!isHousekeepJob) return;
    queueMicrotask(() => {
      setForm((prev) =>
        prev.in_ccz || !prev.has_free_parking ? { ...prev, in_ccz: false, has_free_parking: true } : prev,
      );
    });
  }, [isHousekeepJob]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.job_type !== "hourly" && !form.title) { toast.error("Type of work is required"); return; }
    if (form.job_type === "hourly" && !form.catalog_service_id) {
      toast.error("For hourly jobs, select a Call Out type from Services.");
      return;
    }
    if (!clientAddress.client_id || !clientAddress.property_address?.trim()) { toast.error("Select a client from the list (click the name) and choose or add a property address."); return; }
    if (!isZendeskTicketFieldValid(zendesk)) {
      toast.error("Paste the Zendesk ticket id or tick 'No ticket — create a new one'.");
      return;
    }
    if (isStackablePricing && !form.catalog_pricing_preset_id.trim()) {
      toast.error("Select a property size for this service");
      return;
    }
    if (isStackablePricing && !effectiveAccountId) {
      toast.error("Select a client linked to an account for account-specific rates");
      return;
    }
    const isAutoAssign = form.assignment_mode === "auto";
    const hasPartner = !isAutoAssign && !!form.partner_id;
    const schedV2 = resolveJobModalScheduleV2({
      kind: form.job_kind,
      scheduled_date: form.scheduled_date,
      arrival_from: form.arrival_from,
      arrival_window_mins: form.arrival_window_mins,
      end_date: form.end_date,
      end_time: form.end_time,
      recurrence: recurrence,
      hasPartner,
    });
    if (!schedV2.ok) {
      toast.error(schedV2.error);
      return;
    }
    const scheduled_date = schedV2.payload.scheduled_date;
    const scheduled_start_at = schedV2.payload.scheduled_start_at;
    const scheduled_end_at = schedV2.payload.scheduled_end_at;
    const scheduled_finish_date: string | null = schedV2.payload.scheduled_finish_date ?? null;
    const expected_finish_at: string | null = schedV2.payload.expected_finish_at ?? null;
    const job_kind: JobKind = schedV2.payload.job_kind;

    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    const hourlyClientRate = Math.max(0, Number(form.hourly_client_rate) || 0);
    const hourlyPartnerRate = Math.max(0, Number(form.hourly_partner_rate) || 0);
    const initialBilledHours = Math.max(1, Number(form.billed_hours) || 1);
    const hourlyTotals = computeHourlyTotals({
      elapsedSeconds: initialBilledHours * 3600,
      clientHourlyRate: hourlyClientRate,
      partnerHourlyRate: hourlyPartnerRate,
    });
    const isHourly = form.job_type === "hourly";
    const cczEligibleAddr = !isHousekeepJob && isLikelyCczAddress(clientAddress.property_address);
    const inCczOut = cczEligibleAddr && form.in_ccz;
    const accessSurcharge = isHousekeepJob ? 0 : computeAccessSurcharge({ inCcz: inCczOut, hasFreeParking: form.has_free_parking });
    const clientPriceOut = isHourly ? hourlyTotals.clientTotal : (Number(form.client_price) || 0);
    const partnerCostOut = isHourly ? hourlyTotals.partnerTotal : (Number(form.partner_cost) || 0);

    let uploadedImageUrls: string[] = [];
    if (sitePhotoFiles.length > 0) {
      setUploadingPhotos(true);
      try {
        uploadedImageUrls = await uploadQuoteInviteImages(sitePhotoFiles, "job-new");
      } catch (err) {
        toast.error(getErrorMessage(err, "Photo upload failed"));
        setUploadingPhotos(false);
        return;
      }
      setUploadingPhotos(false);
    }

    onCreate({
      // Zendesk linkage: either paste an existing ticket id, or signal to the
      // parent that it should open a new one via /api/zendesk/create-ticket-for-entity.
      external_source: "zendesk",
      external_ref:    zendesk.noTicket ? null : zendesk.ticketId.trim(),
      ...(zendesk.noTicket ? { __createZendeskTicket: true } : {}),
      title: form.job_type === "hourly"
        ? (selectedCatalogService?.name ? (normalizeTypeOfWork(selectedCatalogService.name) || selectedCatalogService.name) : (normalizeTypeOfWork(form.title.trim()) || form.title.trim()))
        : (normalizeTypeOfWork(form.title.trim()) || form.title.trim()),
      catalog_service_id: form.catalog_service_id || null,
      catalog_pricing_preset_id:
        form.catalog_service_id?.trim() && form.catalog_pricing_preset_id?.trim()
          ? form.catalog_pricing_preset_id.trim()
          : null,
      catalog_pricing_addon_ids: isStackablePricing ? form.catalog_pricing_addon_ids : [],
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      property_address: clientAddress.property_address,
      partner_id: isAutoAssign ? null : (form.partner_id || undefined),
      partner_ids: undefined,
      partner_name: isAutoAssign ? null : (selectedPartner ? (selectedPartner.company_name?.trim() || selectedPartner.contact_name) : undefined),
      status: isAutoAssign ? "auto_assigning" : undefined,
      job_type: (form.job_type as Job["job_type"]) ?? "fixed",
      hourly_client_rate: isHourly ? hourlyClientRate : null,
      hourly_partner_rate: isHourly ? hourlyPartnerRate : null,
      billed_hours: isHourly ? hourlyTotals.billedHours : null,
      in_ccz: isHousekeepJob ? false : inCczOut,
      has_free_parking: isHousekeepJob ? true : form.has_free_parking,
      client_price: clientPriceOut,
      partner_cost: partnerCostOut,
      extras_amount: accessSurcharge,
      materials_cost: Number(form.materials_cost) || 0,
      scheduled_date,
      scheduled_start_at,
      scheduled_end_at,
      scheduled_finish_date,
      expected_finish_at,
      job_kind,
      total_phases: normalizeTotalPhases(2),
      scope: form.scope.trim() || undefined,
      additional_notes: form.additional_notes.trim() || undefined,
      report_link: form.report_link.trim() || undefined,
      images: uploadedImageUrls.length ? uploadedImageUrls : undefined,
    }, schedV2.series ? { series: schedV2.series } : undefined);
    setSitePhotoFiles([]);
    setRecurrence(DEFAULT_RECURRENCE_FORM);
    lastAutoPartnerCost.current = null;
    setForm({
      title: "",
      catalog_service_id: "",
      catalog_pricing_preset_id: "",
      catalog_pricing_addon_ids: [],
      partner_id: "",
      partner_ids: [],
      client_price: "",
      partner_cost: "",
      materials_cost: "0",
      job_kind: "one_off",
      scheduled_date: "",
      arrival_from: "09:00",
      arrival_window_mins: "180",
      end_date: "",
      end_time: "17:00",
      job_type: "fixed",
      scope: "",
      additional_notes: "",
      report_link: "",
      hourly_client_rate: "",
      hourly_partner_rate: "",
      billed_hours: "1",
      in_ccz: false,
      has_free_parking: true,
      assignment_mode: "manual",
    });
    setClientAddress({ client_name: "", property_address: "" });
    setZendesk({ ticketId: "", noTicket: false });
  };

  const cczEligible = !isHousekeepJob && isLikelyCczAddress(clientAddress.property_address);
  const inCczPreview = cczEligible && form.in_ccz;
  const accessSurchargePreview = isHousekeepJob
    ? 0
    : computeAccessSurcharge({
        inCcz: inCczPreview,
        hasFreeParking: form.has_free_parking,
        cczFeeGbp: accessFees.cczFeeGbp,
        parkingFeeGbp: accessFees.parkingFeeGbp,
      });
  const hourlyPreview = computeHourlyTotals({
    elapsedSeconds: Math.max(1, Number(form.billed_hours) || 1) * 3600,
    clientHourlyRate: Math.max(0, Number(form.hourly_client_rate) || 0),
    partnerHourlyRate: Math.max(0, Number(form.hourly_partner_rate) || 0),
  });
  const hourlyMarginPct = hourlyPreview.clientTotal > 0
    ? Math.round(((hourlyPreview.clientTotal - hourlyPreview.partnerTotal) / hourlyPreview.clientTotal) * 1000) / 10
    : 0;
  const estimatedMarginPct = useMemo(() => {
    const clientTotal =
      form.job_type === "hourly"
        ? hourlyPreview.clientTotal + accessSurchargePreview
        : (Number(form.client_price) || 0) + accessSurchargePreview;
    if (clientTotal <= 0) return 0;
    const partnerTotal = form.job_type === "hourly" ? hourlyPreview.partnerTotal : (Number(form.partner_cost) || 0);
    const materialsTotal = Number(form.materials_cost) || 0;
    return Math.round(((clientTotal - partnerTotal - materialsTotal) / clientTotal) * 1000) / 10;
  }, [
    form.job_type,
    form.client_price,
    form.partner_cost,
    form.materials_cost,
    hourlyPreview.clientTotal,
    hourlyPreview.partnerTotal,
    accessSurchargePreview,
  ]);

  useEffect(() => {
    if (isStackablePricing) {
      lastAutoPartnerCost.current = null;
      return;
    }
    if (form.job_type === "hourly") {
      lastAutoPartnerCost.current = null;
      return;
    }
    if (form.assignment_mode === "manual" && form.partner_id.trim()) {
      lastAutoPartnerCost.current = null;
      return;
    }
    const client = Number(form.client_price) || 0;
    const materials = Number(form.materials_cost) || 0;
    const revenue = client + accessSurchargePreview;
    if (revenue <= 0) return;
    const targetPct = SUGGESTED_PARTNER_MARGIN_HINT_PCT / 100;
    const nextNum = Math.max(0, Math.round((revenue * (1 - targetPct) - materials) * 100) / 100);
    const next = String(nextNum);
    const cur = form.partner_cost.trim();
    const empty = cur === "";
    const unchangedFromAuto =
      lastAutoPartnerCost.current != null && cur === lastAutoPartnerCost.current;
    if (!empty && !unchangedFromAuto) return;
    if (cur === next) return;
    lastAutoPartnerCost.current = next;
    // Intentional: syncs the partner_cost field when the suggested 40% margin recomputes.
    // Guarded by `empty / unchangedFromAuto` so user-edited values are never overwritten.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((prev) => ({ ...prev, partner_cost: next }));
  }, [form.job_type, isStackablePricing, form.assignment_mode, form.partner_id, form.client_price, form.materials_cost, form.partner_cost, accessSurchargePreview]);

  const toggleStackableAddon = (addonId: string) => {
    setForm((prev) => {
      const cur = prev.catalog_pricing_addon_ids;
      const has = cur.includes(addonId);
      return {
        ...prev,
        catalog_pricing_addon_ids: has ? cur.filter((id) => id !== addonId) : [...cur, addonId],
      };
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Job"
      subtitle="Create a new job"
      size="lg"
      className="max-w-[min(100%,36rem)]"
    >
      <form onSubmit={handleSubmit} className="@container flex min-h-0 flex-col">
        <div className="max-h-[85vh] overflow-y-auto overflow-x-hidden px-3 py-3 @sm:px-5 space-y-2.5 min-w-0">
          <section className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 space-y-2">
            <p className="text-[11px] font-semibold text-text-tertiary">Rate Type</p>
            <div className="flex gap-1 rounded-lg border border-border-light bg-card p-0.5">
              <button
                type="button"
                title="Set prices on this job"
                onClick={() => setForm((p) => ({ ...p, job_type: "fixed" }))}
                className={cn(
                  "flex min-h-8 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-all",
                  form.job_type === "fixed"
                    ? "bg-[#1DB87A] text-white shadow-sm"
                    : "text-text-secondary hover:bg-surface-hover",
                )}
              >
                <Lock className="h-3 w-3 shrink-0" />
                <span className="truncate">{pricingModeLabel("fixed")}</span>
              </button>
              <button
                type="button"
                title="From services, accounts and partners"
                onClick={() => update("job_type", "hourly")}
                className={cn(
                  "flex min-h-8 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-all",
                  form.job_type === "hourly"
                    ? "bg-[#7c3aed] text-white shadow-sm"
                    : "text-text-secondary hover:bg-surface-hover",
                )}
              >
                <Clock3 className="h-3 w-3 shrink-0" />
                <span className="truncate">{pricingModeLabel("hourly")}</span>
              </button>
            </div>
            <div
              className={cn(
                "grid gap-2 min-w-0",
                catalogPricingPresetOptions.length > 0 ? "grid-cols-1 @md:grid-cols-2" : "grid-cols-1",
              )}
            >
              <div className="min-w-0 space-y-1">
                {form.job_type === "hourly" ? (
                  <>
                    <p className="text-[11px] font-medium text-text-secondary">Type of Work Rate *</p>
                    <ServiceCatalogSelect
                      label=""
                      emptyOptionLabel="Select rate…"
                      compactOptionLabels
                      catalog={catalogServices}
                      value={form.catalog_service_id}
                      className={requiredFieldClass}
                      onChange={(id, service) => {
                        if (!service) {
                          setForm((prev) => ({
                            ...prev,
                            catalog_service_id: id,
                            catalog_pricing_preset_id: "",
                          }));
                          return;
                        }
                        const presetId = defaultPricingPresetId(service);
                        const eff = mergeCatalogWithPricingPreset(service, presetId || null);
                        const hrs = Math.max(1, Number(eff.default_hours) || 1);
                        const clientRate = Number(eff.hourly_rate) || 0;
                        const partnerRate = partnerHourlyRateFromCatalogBundle(eff.partner_cost, eff.default_hours);
                        const totals = computeHourlyTotals({
                          elapsedSeconds: hrs * 3600,
                          clientHourlyRate: clientRate,
                          partnerHourlyRate: partnerRate,
                        });
                        setForm((prev) => ({
                          ...prev,
                          catalog_service_id: id,
                          catalog_pricing_preset_id: presetId,
                          title: service ? (normalizeTypeOfWork(service.name) || service.name) : prev.title,
                          hourly_client_rate: String(clientRate || ""),
                          hourly_partner_rate: String(partnerRate || ""),
                          billed_hours: String(hrs),
                          client_price: String(totals.clientTotal),
                          partner_cost: String(totals.partnerTotal),
                        }));
                      }}
                    />
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-medium text-text-secondary">Type of Work *</p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setWorkTypeOpen((v) => !v)}
                        className={cn(
                          "h-9 w-full rounded-lg border bg-card px-3 text-left text-sm flex items-center justify-between",
                          !form.title && "text-text-tertiary",
                          form.title ? "border-border text-text-primary" : requiredFieldClass,
                        )}
                      >
                        <span className="truncate">{form.title || "Select type of work..."}</span>
                        <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", workTypeOpen && "rotate-180")} />
                      </button>
                      {workTypeOpen ? (
                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card shadow-lg p-2 space-y-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-tertiary" />
                            <Input
                              value={workTypeSearch}
                              onChange={(e) => setWorkTypeSearch(e.target.value)}
                              placeholder="Search type of work..."
                              className="h-8 pl-8"
                            />
                          </div>
                          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                            {filteredWorkTypes.length > 0 ? filteredWorkTypes.map((name) => {
                              const Icon = workTypeIcon(name);
                              return (
                                <button
                                  key={name}
                                  type="button"
                                  onClick={() => {
                                    const catId = catalogServiceIdForTypeOfWorkLabel(name, catalogServices) ?? "";
                                    const service = catId ? catalogServices.find((s) => s.id === catId) : undefined;
                                    const hasPresets =
                                      !!service &&
                                      sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets)).length > 0;
                                    const presetId = hasPresets && service ? defaultPricingPresetId(service) : "";
                                    setForm((prev) => ({
                                      ...prev,
                                      title: name,
                                      catalog_service_id: catId,
                                      catalog_pricing_preset_id: presetId,
                                      catalog_pricing_addon_ids: [],
                                    }));
                                    setWorkTypeOpen(false);
                                    setWorkTypeSearch("");
                                  }}
                                  className={cn(
                                    "w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors inline-flex items-center gap-1.5",
                                    form.title === name
                                      ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                                      : "bg-[#fafaf8] border-[#e0ddd8] text-[#555] hover:bg-surface-hover",
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{name}</span>
                                </button>
                              );
                            }) : (
                              <p className="px-2 py-2 text-xs text-text-tertiary">No work types found.</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              {catalogPricingPresetOptions.length > 0 && !isStackablePricing ? (
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <label className="block text-[11px] font-medium text-text-secondary">Price Band</label>
                    <FixfyHintIcon text="Overrides base catalogue prices before account or partner overrides." />
                  </div>
                  <select
                    value={form.catalog_pricing_preset_id}
                    onChange={(e) => setForm((p) => ({ ...p, catalog_pricing_preset_id: e.target.value }))}
                    className={cn(
                      "w-full h-9 rounded-lg border bg-card px-2.5 text-sm text-text-primary",
                      requiredFieldClass,
                    )}
                  >
                    {catalogPricingPresetOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </section>

          {serviceHasStackableAddons && !packagePricingOpen ? (
            <section className="rounded-xl border border-dashed border-border-light bg-surface-hover/10 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-text-tertiary">Additionals</p>
                  <p className="text-[10.5px] text-text-tertiary leading-snug">
                    {form.job_type === "fixed"
                      ? "Custom Price keeps prices manual. Add a package and addons if you want to stack them on top."
                      : "Optional: pick a property size and addons to layer on top of the smart price."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPackagePricingOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-text-primary hover:bg-surface-hover transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add additionals
                </button>
              </div>
            </section>
          ) : null}

          {isStackablePricing ? (
            <section className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 space-y-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-text-tertiary">Package &amp; additionals</p>
                <button
                  type="button"
                  onClick={() => {
                    setPackagePricingOpen(false);
                    setForm((p) => ({ ...p, catalog_pricing_addon_ids: [] }));
                  }}
                  className="text-[10.5px] font-medium text-text-tertiary hover:text-text-primary transition-colors"
                >
                  Hide
                </button>
              </div>
              {!effectiveAccountId ? (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                  Select a client linked to an account — account-specific cleaning rates apply.
                </p>
              ) : null}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-text-secondary">Property size *</p>
                <div className="grid grid-cols-1 @sm:grid-cols-2 gap-1.5">
                  {catalogPricingPresetOptions.map((opt) => {
                    const selected = form.catalog_pricing_preset_id === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setForm((p) => ({
                            ...p,
                            catalog_pricing_preset_id: opt.id,
                            catalog_pricing_addon_ids: p.catalog_pricing_addon_ids,
                          }))
                        }
                        className={cn(
                          "rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                          selected
                            ? "border-[#1DB87A]/50 bg-[#1DB87A]/10 text-[#157a55]"
                            : "border-border-light bg-card text-text-secondary hover:border-primary/30",
                        )}
                      >
                        <span className="font-semibold block">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {catalogAddonOptions.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-text-secondary">Additionals (optional)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {catalogAddonOptions.map((addon) => {
                      const checked = form.catalog_pricing_addon_ids.includes(addon.id);
                      return (
                        <button
                          key={addon.id}
                          type="button"
                          onClick={() => toggleStackableAddon(addon.id)}
                          className={cn(
                            "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                            checked
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border-light bg-card text-text-secondary hover:border-primary/30",
                          )}
                        >
                          <span className="font-medium">{addon.label}</span>
                          <span className="block text-[10px] tabular-nums opacity-80">
                            +{formatCurrency(addon.fixed_price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 space-y-2.5 min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary">Client & Schedule</p>
            <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
            <ZendeskTicketField value={zendesk} onChange={setZendesk} />
            <JobModalScheduleFields
              jobKind={form.job_kind}
              scheduledDate={form.scheduled_date}
              arrivalFrom={form.arrival_from}
              arrivalWindowMins={form.arrival_window_mins}
              endDate={form.end_date}
              endTime={form.end_time}
              recurrence={recurrence}
              onRecurrenceChange={(patch) => setRecurrence((p) => ({ ...p, ...patch }))}
              onChange={(field, value) => update(field, value)}
              startDateRequired={form.job_kind !== "one_off" || !!form.scheduled_date?.trim()}
              requiredFieldClassName={requiredFieldClass}
            />
          </section>

          <section className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 space-y-2 min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary">Access & Charges</p>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isHousekeepJob || !cczEligible}
                onClick={() => cczEligible && setForm((prev) => ({ ...prev, in_ccz: !prev.in_ccz }))}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-left transition-all shadow-sm",
                  "flex items-center justify-between gap-2 min-w-0",
                  (isHousekeepJob || !cczEligible) && "opacity-50 cursor-not-allowed",
                  form.in_ccz && cczEligible
                    ? "bg-[#ecfff6] border-[#1DB87A] shadow-[0_6px_16px_rgba(29,184,122,0.18)]"
                    : "bg-[#fafaf8] border-[#e0ddd8]",
                )}
              >
                <div>
                  <p className="text-xs font-medium text-text-primary leading-snug">
                    {!cczEligible && !isHousekeepJob ? "CCZ (central London)" : inCczPreview ? "CCZ fee applied" : "Apply CCZ"}
                  </p>
                  <p className="text-[10px] text-text-tertiary leading-snug">
                    {!cczEligible && !isHousekeepJob
                      ? "Only EC/WC/W/SW1/SE1 postcodes"
                      : inCczPreview
                        ? `+${formatCurrency(accessFees.cczFeeGbp)} applied`
                        : "No charge applied"}
                  </p>
                </div>
                <span className={cn("flex-shrink-0 h-7 w-12 rounded-full border-2 p-0.5 transition-colors shadow-inner", form.in_ccz && cczEligible ? "border-[#1DB87A] bg-[#1DB87A]" : "border-[#9c948a] bg-[#e8e4de]")}>
                  <span className={cn("block h-5 w-5 rounded-full bg-white shadow-md transition-transform", form.in_ccz && cczEligible && "translate-x-5")} />
                </span>
              </button>
              <button
                type="button"
                disabled={isHousekeepJob}
                onClick={() => setForm((prev) => ({ ...prev, has_free_parking: !prev.has_free_parking }))}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-left transition-all shadow-sm",
                  "flex items-center justify-between gap-2 min-w-0",
                  isHousekeepJob && "opacity-50 cursor-not-allowed",
                  !form.has_free_parking
                    ? "bg-[#ecfff6] border-[#1DB87A] shadow-[0_6px_16px_rgba(29,184,122,0.18)]"
                    : "bg-[#fafaf8] border-[#e0ddd8]",
                )}
              >
                <div>
                  <p className="text-xs font-medium text-text-primary leading-snug">{form.has_free_parking ? "Add parking" : "Parking fee applied"}</p>
                  <p className="text-[10px] text-text-tertiary leading-snug">
                    {form.has_free_parking ? "No charge applied" : `+${formatCurrency(accessFees.parkingFeeGbp)} applied`}
                  </p>
                </div>
                <span className={cn("flex-shrink-0 h-7 w-12 rounded-full border-2 p-0.5 transition-colors shadow-inner", !form.has_free_parking ? "border-[#1DB87A] bg-[#1DB87A]" : "border-[#9c948a] bg-[#e8e4de]")}>
                  <span className={cn("block h-5 w-5 rounded-full bg-white shadow-md transition-transform", !form.has_free_parking && "translate-x-5")} />
                </span>
              </button>
            </div>
            <p className="text-[10px] text-text-tertiary leading-snug">
              Parking surcharge: <span className="font-semibold text-text-primary">{formatCurrency(accessSurchargePreview)}</span>
            </p>
          </section>

          <details className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 min-w-0" open>
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-text-primary">
              Scope & notes
              <span className="text-[11px] font-normal text-text-tertiary">required ▾</span>
            </summary>
            <div className="mt-2.5 space-y-2.5 min-w-0">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Scope of work *</label>
                <textarea
                  value={form.scope}
                  onChange={(e) => update("scope", e.target.value)}
                  rows={3}
                  placeholder="Describe exactly what should be done on this job."
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-y min-h-[52px]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Notes</label>
                <textarea
                  value={form.additional_notes}
                  onChange={(e) => update("additional_notes", e.target.value)}
                  rows={2}
                  placeholder="Internal only — parking, keys, client preferences, things not in scope…"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-y min-h-[40px]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Report link (optional)</label>
                <Input
                  type="url"
                  value={form.report_link}
                  onChange={(e) => update("report_link", e.target.value)}
                  placeholder="https://…"
                  className="h-10"
                />
              </div>
              <div className="rounded-lg border border-border-light bg-card p-2.5 space-y-2">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Site reference photos</p>
                <input
                  id={sitePhotosInputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    const list = e.target.files;
                    if (!list?.length) return;
                    setSitePhotoFiles((prev) => {
                      const merged = [...prev, ...Array.from(list)];
                      if (merged.length > JOB_SITE_PHOTOS_MAX) {
                        toast.message(`Keeping the first ${JOB_SITE_PHOTOS_MAX} photos (max per job).`);
                      }
                      return merged.slice(0, JOB_SITE_PHOTOS_MAX);
                    });
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text-tertiary tabular-nums">{sitePhotoFiles.length}/{JOB_SITE_PHOTOS_MAX}</span>
                  <label
                    htmlFor={sitePhotosInputId}
                    className={sitePhotoFiles.length >= JOB_SITE_PHOTOS_MAX ? "pointer-events-none opacity-50" : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-text-primary cursor-pointer hover:bg-surface-hover">
                      <ImagePlus className="h-4 w-4" />
                      Add photos
                    </span>
                  </label>
                  {uploadingPhotos ? <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" aria-hidden /> : null}
                </div>
                {sitePhotoFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {sitePhotoFiles.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sitePhotoPreviewUrls[i]}
                          alt=""
                          className="h-14 w-14 rounded-md object-cover border border-border-light"
                        />
                        <button
                          type="button"
                          className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-card border border-border text-text-tertiary hover:text-primary"
                          onClick={() => setSitePhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </details>

          <section className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-text-tertiary">Pricing</p>
              <span className="text-[10px] font-medium text-text-tertiary shrink-0">
                {stackablePricingLoading || pricingResolving
                  ? "Loading…"
                  : isStackablePricing
                    ? "Auto from package"
                    : form.job_type === "hourly"
                      ? "Auto from rates × hours"
                      : form.partner_id && form.assignment_mode === "manual"
                        ? "From partner rates"
                        : form.catalog_service_id
                          ? "From catalogue"
                          : "Manual entry"}
              </span>
            </div>
            {isStackablePricing && stackableLinePricing ? (
              <div className="rounded-lg border border-border-light bg-card p-2 space-y-1 text-[11px]">
                {stackableLinePricing.lines.map((line) => (
                  <div key={line.id} className="flex justify-between gap-2 tabular-nums">
                    <span className="text-text-secondary truncate">
                      {line.kind === "base" ? "Base" : "+"} {line.label}
                    </span>
                    <span className="text-text-primary shrink-0">
                      {formatCurrency(line.clientAmount)} / {formatCurrency(line.partnerAmount)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between gap-2 border-t border-border-light pt-1 font-semibold tabular-nums">
                  <span>Total</span>
                  <span>
                    {formatCurrency(stackableLinePricing.clientTotal)} / {formatCurrency(stackableLinePricing.partnerTotal)}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2 min-w-0">
              <div className="min-w-0">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Client Price £
                  {!isStackablePricing && pricing ? (
                    <span className="ml-1.5">
                      <PricingSourceChip
                        source={form.job_type === "hourly" ? pricing.client.hourly_rate_source : pricing.client.fixed_price_source}
                      />
                    </span>
                  ) : null}
                </label>
                <Input
                  type="number"
                  value={form.job_type === "hourly" ? String(hourlyPreview.clientTotal + accessSurchargePreview) : form.client_price}
                  onChange={form.job_type === "hourly" || isStackablePricing ? undefined : (e) => update("client_price", e.target.value)}
                  readOnly={form.job_type === "hourly" || isStackablePricing}
                  className={cn((form.job_type === "hourly" || isStackablePricing) && "bg-surface-hover/40 cursor-not-allowed")}
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Partner Cost £
                  {!isStackablePricing && pricing ? (
                    <span className="ml-1.5">
                      <PricingSourceChip
                        source={form.job_type === "hourly" ? pricing.partner.hourly_partner_rate_source : pricing.partner.fixed_partner_cost_source}
                      />
                    </span>
                  ) : null}
                </label>
                <Input
                  type="number"
                  value={form.job_type === "hourly" ? String(hourlyPreview.partnerTotal) : form.partner_cost}
                  onChange={form.job_type === "hourly" || isStackablePricing ? undefined : (e) => update("partner_cost", e.target.value)}
                  readOnly={form.job_type === "hourly" || isStackablePricing}
                  className={cn((form.job_type === "hourly" || isStackablePricing) && "bg-surface-hover/40 cursor-not-allowed")}
                  min="0"
                  step="0.01"
                />
                {form.job_type === "fixed" ? (
                  <p className="text-[10px] text-text-tertiary mt-1.5 leading-snug">
                    Margin:{" "}
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        estimatedMarginPct >= 20
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {(Number(form.client_price) || 0) + accessSurchargePreview > 0
                        ? `${estimatedMarginPct}%`
                        : "—"}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
            {/* Rate + hours row only for Smart Pricing — drives the totals above. */}
            {form.job_type === "hourly" ? (
              <>
                <div className="grid grid-cols-2 @lg:grid-cols-3 gap-2 pt-1 border-t border-border-light/50 min-w-0">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Client hourly rate (£/h)</label>
                    <Input type="number" value={form.hourly_client_rate} onChange={(e) => update("hourly_client_rate", e.target.value)} min="0" step="0.01" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner hourly rate (£/h)</label>
                    <Input type="number" value={form.hourly_partner_rate} onChange={(e) => update("hourly_partner_rate", e.target.value)} min="0" step="0.01" />
                  </div>
                  <div className="col-span-2 @lg:col-span-1 min-w-0 max-w-full @lg:max-w-[10rem]">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Initial billed hours</label>
                    <Input type="number" value={form.billed_hours} onChange={(e) => update("billed_hours", e.target.value)} min="1" step="0.5" />
                  </div>
                </div>
                <p className="text-[10px] text-text-tertiary leading-snug">
                  Rates prefilled from the call-out — edit to override. Billing: up to 1h = 1h minimum, then 30-min increments from timer logs.
                </p>
              </>
            ) : null}
          </section>


          <section className="rounded-xl border border-border-light bg-surface-hover/20 p-2.5 space-y-2 min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary">Partner Allocation</p>
            {!form.catalog_service_id ? (
              <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                Select type of work above first — partner-specific prices load in Pricing above.
              </p>
            ) : null}
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, assignment_mode: "manual" }))}
                className={cn(
                  "text-left rounded-lg border px-2.5 py-1.5 text-sm transition-colors min-w-0",
                  form.assignment_mode === "manual"
                    ? "border-[#1DB87A]/40 bg-[#1DB87A]/10 text-[#157a55]"
                    : "border-border bg-card text-text-secondary",
                )}
              >
                <p className="font-medium">Allocate partner</p>
                <p className="text-xs opacity-80">Pick a specific partner now</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  lastAutoPartnerCost.current = null;
                  setForm((prev) => ({ ...prev, assignment_mode: "auto", partner_id: "" }));
                }}
                className={cn(
                  "text-left rounded-lg border px-2.5 py-1.5 text-sm transition-colors min-w-0",
                  form.assignment_mode === "auto"
                    ? "border-[#1DB87A]/40 bg-[#1DB87A]/10 text-[#157a55]"
                    : "border-border bg-card text-text-secondary",
                )}
              >
                <p className="font-medium">Auto assign</p>
                <p className="text-xs opacity-80">System will assign after creation</p>
              </button>
            </div>
            {form.assignment_mode === "manual" && (
              <div className="space-y-2">
                <Input
                  placeholder="Search partner by name, trade, or location..."
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                />
                <div className="max-h-44 overflow-y-auto rounded-lg border border-border-light bg-card p-1.5 space-y-1.5">
                  <label
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                      !form.partner_id ? "border-[#1DB87A]/40 bg-[#1DB87A]/10" : "border-border hover:border-[#1DB87A]/35",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary">No partner</p>
                      <p className="text-xs text-text-tertiary">Create job without assignment</p>
                    </div>
                    <input
                      type="radio"
                      name="partner-select"
                      className="h-4 w-4"
                      checked={!form.partner_id}
                      onChange={() => applyPartnerPricing("")}
                    />
                  </label>
                  {filteredPartners.map((p) => {
                    const pid = p.id;
                    const selected = form.partner_id === pid;
                    const match = targetWorkType
                      ? safePartnerMatchesTypeOfWork(p, targetWorkType, form.catalog_service_id || null)
                      : false;
                    return (
                      <label
                        key={pid}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                          selected
                          ? "border-[#1DB87A]/40 bg-[#1DB87A]/10"
                            : match
                            ? "border-amber-300 bg-amber-50/70 dark:border-amber-500/70 dark:bg-amber-950/50 hover:border-[#1DB87A]/35"
                            : "border-border hover:border-[#1DB87A]/35",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{p.company_name?.trim() || p.contact_name || "Partner"}</p>
                          <p
                            className={cn(
                              "text-xs truncate",
                              match && !selected ? "text-amber-950 dark:text-amber-100" : "text-text-secondary",
                            )}
                          >
                            {(match ? partnerMatchTypeLabel(p, targetWorkType) : (p.trade ?? "—"))} · {p.location ?? "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {match ? <Badge variant="warning" size="sm">Match</Badge> : null}
                          <input
                            type="radio"
                            name="partner-select"
                            className="h-4 w-4"
                            checked={selected}
                            onChange={() => applyPartnerPricing(pid)}
                          />
                        </div>
                      </label>
                    );
                  })}
                  {filteredPartners.length === 0 ? (
                    <p className="text-xs text-text-tertiary px-2 py-2">No partners match this search.</p>
                  ) : null}
                </div>
              </div>
            )}
          </section>


        </div>

        <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border-light bg-card/95 px-3 py-2.5 backdrop-blur @sm:flex-row @sm:items-center @sm:justify-between @sm:px-5">
          <p className="text-xs text-text-secondary shrink-0">
            Estimated margin: <span className={cn("font-semibold", estimatedMarginPct >= 20 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{estimatedMarginPct}%</span>
          </p>
          <div className="flex items-center justify-end gap-2 min-w-0">
            <Button variant="outline" onClick={onClose} type="button" disabled={uploadingPhotos}>Cancel</Button>
            <Button type="submit" loading={uploadingPhotos} disabled={uploadingPhotos} className="bg-[#ED4B00] hover:bg-[#d84300] text-white border-[#ED4B00] hover:border-[#d84300]">Create Job</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ========== CALENDAR VIEW ========== */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function JobsCalendarView({ jobs, loading, onSelectJob }: { jobs: Job[]; loading: boolean; onSelectJob: (j: Job) => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
  const calendarDays = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [firstDayOfWeek, daysInMonth]);

  const jobsByDay = useMemo(() => {
    const map: Record<number, Array<{ job: Job; kind: "start" | "end" | "span" }>> = {};
    for (const job of jobs) {
      const start = jobScheduleYmd(job);
      if (!start) continue;
      const finish = jobFinishYmd(job) ?? start;
      const startsThisMonth = start.y === year && start.m === month + 1;
      const finishesThisMonth = finish.y === year && finish.m === month + 1;

      if (startsThisMonth) {
        if (!map[start.d]) map[start.d] = [];
        map[start.d].push({ job, kind: "start" });
      }
      if (finishesThisMonth) {
        if (!map[finish.d]) map[finish.d] = [];
        map[finish.d].push({ job, kind: "end" });
      }

      const cursor = new Date(start.y, start.m - 1, start.d);
      const endDate = new Date(finish.y, finish.m - 1, finish.d);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor < endDate) {
        if (cursor.getFullYear() === year && cursor.getMonth() === month) {
          const d = cursor.getDate();
          if (!map[d]) map[d] = [];
          map[d].push({ job, kind: "span" });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [jobs, year, month]);

  if (loading) return <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div>;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button type="button" onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }} className="p-1 rounded-lg hover:bg-surface-hover"><ArrowRight className="h-4 w-4 rotate-180" /></button>
        <span className="text-sm font-semibold text-text-primary">{MONTHS[month]} {year}</span>
        <button type="button" onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }} className="p-1 rounded-lg hover:bg-surface-hover"><ArrowRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border p-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="text-[10px] font-semibold text-text-tertiary text-center py-1">{d}</div>)}
        {calendarDays.map((day, i) => (
          <div key={i} className="min-h-[80px] bg-card p-1.5">
            {day != null ? (
              <>
                <span className="text-xs font-medium text-text-secondary">{day}</span>
                {(jobsByDay[day] ?? []).slice(0, 2).map(({ job, kind }, idx) => (
                  <button
                    key={`${job.id}-${kind}-${idx}`}
                    type="button"
                    onClick={() => onSelectJob(job)}
                    className={`block w-full text-left mt-1 px-1.5 py-1 rounded text-[10px] font-medium truncate ${
                      kind === "start"
                        ? "bg-primary/10 text-primary"
                        : kind === "end"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                    }`}
                  >
                    {kind === "start" ? "Start / arrival" : kind === "end" ? "Expected finish" : "Ongoing"} · {job.reference}
                  </button>
                ))}
                {(jobsByDay[day] ?? []).length > 2 && <span className="text-[10px] text-text-tertiary">+{(jobsByDay[day] ?? []).length - 2}</span>}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function JobsMapView({ jobs, loading, onSelectJob }: { jobs: Job[]; loading: boolean; onSelectJob: (j: Job) => void }) {
  if (loading) return <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div>;
  const withAddress = jobs.filter((j) => j.property_address);
  if (withAddress.length === 0) return <div className="py-20 text-center text-text-tertiary text-sm">No jobs with address to show on map.</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {withAddress.slice(0, 12).map((j) => {
        const mapSched = formatJobScheduleListLabel(j);
        const mapSchedDetail = formatJobScheduleLine(j);
        return (
          <button
            key={j.id}
            type="button"
            onClick={() => onSelectJob(j)}
            className="text-left rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors flex flex-col w-full min-w-0"
          >
            <div className="relative w-full aspect-[16/9] min-h-[160px] sm:min-h-[180px] bg-surface-hover">
              <LocationMiniMap address={j.property_address} className="h-full w-full" mapHeight="100%" showAddressBelowMap={false} lazy />
            </div>
            <div className="p-3 sm:p-4 flex flex-col flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p>
                <ZendeskTicketBadge source={j.external_source} ref={j.external_ref} size="xs" />
                <JobOverdueBadge job={j} />
              </div>
              <p className="text-xs text-text-tertiary truncate mt-0.5">{normalizeTypeOfWork(j.title) || j.title}</p>
              <p className="text-xs text-text-tertiary truncate mt-1">{j.property_address}</p>
              {mapSched ? (
                <p className="text-[10px] text-text-secondary mt-1.5 line-clamp-2 leading-snug" title={mapSchedDetail ?? undefined}>
                  {mapSched}
                </p>
              ) : null}
              <JobCardFinanceRow job={j} />
            </div>
          </button>
        );
      })}
      {withAddress.length > 12 && <p className="col-span-full text-xs text-text-tertiary text-center">Showing 12 of {withAddress.length} jobs</p>}
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
