"use client";

import type { JobDetailBundle } from "@/services/jobs";
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { formatDistanceStrict } from "date-fns/formatDistanceStrict";
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
import { parseISO } from "date-fns/parseISO";
import { PageTransition } from "@/components/layout/page-transition";
import { JobDocumentsPanel } from "@/components/jobs/job-documents-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";
import { JobScheduleTimingChip } from "@/components/shared/job-schedule-timing-chip";
import { ZendeskTicketBadge } from "@/components/shared/zendesk-ticket-badge";
import { JobZendeskStatus } from "@/components/jobs/job-zendesk-status";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { FinalReviewModal } from "@/components/job-card/FinalReviewModal/FinalReviewModal";
import type {
  CompletionDelivery,
  FinalReviewSummarySnapshot,
  ReportItem,
} from "@/components/job-card/FinalReviewModal/types";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import {
  accountFinalEmailPolicyFromRow,
  canSendClientEmailWithPack,
  type AccountFinalEmailPolicy,
} from "@/lib/account-final-email-policy";
import { Select } from "@/components/ui/select";
import { TimeSelect } from "@/components/ui/time-select";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  Search,
  Copy,
  CreditCard,
  FileText,
  HardHat,
  Hammer,
  Zap,
  Droplets,
  Paintbrush,
  Sparkles,
  Wrench,
  Leaf,
  KeyRound,
  Grid3x3,
  Briefcase,
  Upload,
  ShieldCheck,
  Plus,
  ImagePlus,
  ExternalLink,
  Info,
  AlertTriangle,
  PauseCircle,
  RefreshCw,
  Clock,
  Lock,
  Timer,
  X,
  Pencil,
  MoreVertical,
  XCircle,
  UserX,
} from "lucide-react";
import { postgrestFullErrorText } from "@/lib/supabase-schema-compat";
import { cn, formatCurrency, formatCurrencyPrecise, formatDate, getErrorMessage } from "@/lib/utils";
import { getAdjacentJobId } from "@/lib/jobs-nav-queue";
import { pricingModeLabel } from "@/lib/pricing-mode-labels";
import { toast } from "sonner";
import { getJob, getJobDetailBundle, updateJob } from "@/services/jobs";
import { getClient } from "@/services/clients";
import { getAccount } from "@/services/accounts";
import { uploadQuoteInviteImages } from "@/services/quote-invite-images";
import { listQuoteLineItems } from "@/services/quotes";
import { createSelfBillFromJob, getSelfBill, listSelfBillsLinkedToJob, syncSelfBillAfterJobChange, updateSelfBillStatus } from "@/services/self-bills";
import { listJobPayments, deleteJobPayment } from "@/services/job-payments";
import { listAssignableUsers, type AssignableUser } from "@/services/profiles";
import { listPartners } from "@/services/partners";
import { isPartnerEligibleForWork } from "@/lib/partner-status";
import { uploadManualJobReport } from "@/services/job-report-storage";
import {
  createSignedJobReportAssetUrl,
  createSignedJobReportPdfUrl,
  listAppJobReports,
  type AppJobReportRow,
} from "@/services/job-reports";
import { useProfile } from "@/hooks/use-profile";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { useCancelJob } from "@/hooks/use-cancel-job";
import { CancelJobModal } from "@/components/jobs/cancel-job-modal";
import { jobOnHoldPresetSelectOptions } from "@/lib/frontend-setup";
import { JOB_DETAIL_MULTI_VISITS_UI_ENABLED } from "@/lib/constants";
import { logAudit, logFieldChanges } from "@/services/audit";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Avatar } from "@/components/ui/avatar";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import type {
  AccountServicePrice,
  CatalogService,
  Invoice,
  Job,
  JobExtraEntry,
  JobPayment,
  JobPaymentMethod,
  Partner,
  QuoteLineItem,
  SelfBill,
} from "@/types/database";
import { createInvoice, listInvoicesLinkedToJob, updateInvoice } from "@/services/invoices";
import { getInvoiceDueDateIsoForClient } from "@/services/invoice-due-date";
import { createOrAppendJobInvoice } from "@/services/weekly-account-invoice";
import { getSupabase } from "@/services/base";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import {
  allConfiguredReportsApproved,
  canAdvanceJob,
  getPreviousJobStatus,
  canApproveReport,
  canMarkReportUploaded,
  canSendReportAndRequestFinalPayment,
  getJobStatusActions,
  jobStatusAfterResumeFromOnHold,
  normalizeTotalPhases,
  reportPhaseIndices,
  reportPhaseLabel,
  shouldAutoAdvanceToFinalCheckAfterMerge,
} from "@/lib/job-phases";
import {
  jobBillableRevenue,
  jobDirectCost,
  deriveStoredJobFinancials,
  partnerPaymentCap,
  partnerCashOutDisplaySplit,
  partnerSelfBillGrossAmount,
  customerScheduledTotal,
  jobCustomerBillableRevenueForCollections,
  suggestedPartnerCostForTargetMargin,
  SUGGESTED_PARTNER_MARGIN_HINT_PCT,
} from "@/lib/job-financials";
import { effectiveInCczForAddress, isLikelyCczAddress } from "@/lib/ccz";
import { patchJobFinancialsForAccessTransition } from "@/lib/job-access-fee-financials";
import { jobPaymentNoteWithoutLedgerPrefix, parseJobPaymentLedgerLabel } from "@/lib/job-payment-history-label";
import { isLegacyMisclassifiedPartnerPayment, sumPartnerRecordedPayoutsForCap } from "@/lib/job-payment-ledger";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { notifyAssignedPartnerAboutJob, shouldNotifyPartnerForJobPatch } from "@/lib/notify-partner-job-push";
import { notifyPartnerJobChange } from "@/lib/notify-partner-job-zendesk";
import {
  effectiveJobStatusForDisplay,
  getPartnerAssignmentBlockReason,
  jobHasPartnerSet,
  JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED,
} from "@/lib/job-partner-assign";
import {
  computePartnerLiveTimerActiveMs,
  formatPartnerLiveTimer,
  isPartnerLiveTimerRunning,
  statusChangePartnerTimerPatch,
} from "@/lib/partner-live-timer";
import {
  computeOfficeTimerElapsedSeconds,
  formatOfficeTimer,
  statusChangeOfficeTimerPatch,
} from "@/lib/office-job-timer";
import {
  computeHourlyTotals,
  partnerHourlyRateFromCatalogBundle,
  resolveJobHourlyRates,
} from "@/lib/job-hourly-billing";
import {
  ARRIVAL_SLOTS,
  ARRIVAL_WINDOW_OPTIONS,
  canonicalArrivalSlotValues,
  matchArrivalSlot,
  scheduledEndFromWindow,
  snapArrivalWindowMinutes,
} from "@/lib/job-arrival-window";
import { ArrivalSlotPicker } from "@/components/shared/arrival-slot-picker";
import { jobModalClientArrivalPreview } from "@/lib/job-modal-schedule";
import { ukWallClockToUtcIso, utcIsoToUkWallClock } from "@/lib/utils/uk-time";
import { JobReportV2Card, JobReportV2DownloadButton } from "@/components/jobs/job-report-v2-card";
import { JobPartnerMediaCard } from "@/components/jobs/job-partner-media-card";
import { JobOnHoldSubmissionCard } from "@/components/jobs/job-on-hold-submission-card";
import { PartnerReportLinkPanel } from "@/components/jobs/partner-report-link-panel";
import { JobZendeskLinkCard } from "@/components/jobs/job-zendesk-link-card";
import { normalizeTypeOfWork, typeOfWorkLabelsFromCatalog, withTypeOfWorkFallback } from "@/lib/type-of-work";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { getAccountServicePrice } from "@/services/account-service-prices";
import { resolveCatalogAddonChargeOptions } from "@/lib/catalog-line-pricing";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { isJobForcePaid, markJobAsForcePaidNote } from "@/lib/job-force-paid";
import {
  OFFICE_JOB_CANCELLATION_REASONS,
  buildOfficeCancellationReasonText,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import { patchOfficeCancelZeroJobEconomics, partnerCancellationClawbackOwedGbp } from "@/lib/job-cancel-economics";
import { formatArrivalTimeRange, formatHourMinuteAmPm, formatLocalYmd, formatJobScheduleLine } from "@/lib/schedule-calendar";
import { coerceJobImagesArray, JOB_SITE_PHOTOS_MAX } from "@/lib/job-images";
import { jobReportLinkHref } from "@/lib/job-report-link";
import { invoiceAmountPaid, invoiceBalanceDue, isInvoiceFullyPaidByAmount } from "@/lib/invoice-balance";
import {
  JobMoneyDrawer,
  type JobMoneyDrawerClientCashContext,
  type JobMoneyDrawerFlow,
  type JobMoneySubmitPayload,
} from "@/components/jobs/job-money-drawer";
import { executeJobMoneyAction } from "@/services/job-money-actions";
import {
  applyCustomerExtraPatch,
  applyPartnerExtraPatch,
  reverseCustomerExtraPatch,
  reversePartnerExtraPatch,
} from "@/lib/job-extra-charges";
import {
  customerExtraLedgerAllocation,
  isJobExtraDiscountExtraType,
  partnerDiscountAllocationFromExtraType,
  signedLedgerDisplayAmount,
} from "@/lib/job-extra-discount";
import { isJobExtraEntriesTableUnavailable, listJobExtraEntries, softDeleteJobExtraEntry, updateJobExtraEntry } from "@/services/job-extra-entries";
import { JOB_STATUS_BADGE_VARIANT, jobPartnerListKind, jobStatusLabel } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";
import {
  buildSchedulePatchForResume,
  onHoldSnapshotArrivalYmd,
  resumeRequiresStrictFutureArrivalDate,
  validateResumeArrivalDate,
} from "@/lib/job-on-hold";
import { RecurringEditScopeDialog, type RecurrenceEditScope } from "@/components/jobs/recurring-edit-scope-dialog";
import { VisitsTab } from "./visits-tab";
import { applyEditScope } from "@/services/job-recurrence-series";

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
  completed: { label: "Completed", variant: JOB_STATUS_BADGE_VARIANT.completed, dot: true },
  cancelled: { label: "Cancelled", variant: JOB_STATUS_BADGE_VARIANT.cancelled, dot: true },
};

/** Neutral fields + brand focus ring (replaces one-off beige / mint hex pairs). */
const JOB_DETAIL_MULTILINE_FIELD_CLASS =
  "w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm leading-tight text-text-primary placeholder:text-text-tertiary shadow-sm transition-colors focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-surface-secondary dark:focus:bg-surface dark:focus:ring-primary/35";

/** Details tab — collapsed scope read view (~7 lines). */
const JOB_SCOPE_COLLAPSED_MAX_HEIGHT = "10rem";
const JOB_SCOPE_COLLAPSE_MIN_CHARS = 280;
const JOB_SCOPE_COLLAPSE_MIN_LINES = 7;

function scopeTextNeedsCollapse(text: string): boolean {
  if (!text) return false;
  if (text.length >= JOB_SCOPE_COLLAPSE_MIN_CHARS) return true;
  return text.split(/\n/).length >= JOB_SCOPE_COLLAPSE_MIN_LINES;
}

const JOB_DETAIL_INLINE_INPUT_FIELD_CLASS =
  "rounded-lg border border-border bg-card py-2 text-sm text-text-primary placeholder:text-text-tertiary shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-surface-secondary dark:focus:ring-primary/35";

/** Healthy-margin threshold for job-card Net margin bar — below this the bar turns red and a hint badge appears. */
export const JOB_DETAIL_HEALTHY_MARGIN_PCT = 45;

function jobDetailMarginAppearance(marginPct: number): {
  pctClass: string;
  barClass: string;
  low: boolean;
} {
  if (marginPct < JOB_DETAIL_HEALTHY_MARGIN_PCT) {
    return {
      pctClass: "text-red-600 dark:text-red-400",
      barClass: "bg-red-500",
      low: true,
    };
  }
  return {
    pctClass: "text-emerald-600 dark:text-emerald-400",
    barClass: "bg-emerald-500",
    low: false,
  };
}

function getStatusColors(status: string): {
  healthBarClass: string;
  activeStepDotClass: string;
  activeStepLabelClass: string;
  topBadgeClass: string;
  completedAllSteps: boolean;
} {
  const s = status.trim().toLowerCase();
  if (s === "on_hold") {
    return {
      healthBarClass: "bg-[#d97706]",
      activeStepDotClass: "bg-[#fef3c7] border-[#d97706] text-[#d97706]",
      activeStepLabelClass: "text-[#d97706] font-semibold",
      topBadgeClass: "bg-[#fef3c7] text-[#92400e] border border-[#d97706]",
      completedAllSteps: false,
    };
  }
  if (s === "awaiting_payment") {
    return {
      healthBarClass: "bg-[#d97706]",
      activeStepDotClass: "bg-[#fef3c7] border-[#d97706] text-[#d97706]",
      activeStepLabelClass: "text-[#d97706] font-semibold",
      topBadgeClass: "",
      completedAllSteps: false,
    };
  }
  if (s === "cancelled") {
    return {
      healthBarClass: "bg-red-600",
      activeStepDotClass: "bg-red-50 border-red-600 text-red-600 dark:bg-red-950/40 dark:border-red-500 dark:text-red-400",
      activeStepLabelClass: "text-red-600 dark:text-red-400 font-semibold",
      topBadgeClass: "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/30 dark:text-red-200 dark:border-red-800",
      completedAllSteps: false,
    };
  }
  if (s === "completed") {
    return {
      healthBarClass: "bg-emerald-600",
      activeStepDotClass: "bg-emerald-600 border-emerald-600 text-white",
      activeStepLabelClass: "text-emerald-700 dark:text-emerald-400 font-semibold",
      topBadgeClass: "",
      completedAllSteps: true,
    };
  }
  return {
    healthBarClass: "bg-emerald-600",
    activeStepDotClass: "bg-emerald-600 border-emerald-600 text-white",
    activeStepLabelClass: "text-emerald-700 dark:text-emerald-400 font-semibold",
    topBadgeClass: "",
    completedAllSteps: false,
  };
}

type JobDetailStatusContext = {
  chipClass: string;
  primary: string;
  secondary?: string;
  title: string;
};

function formatJobStatusContextTimestamp(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  try {
    const t = parseISO(iso);
    if (Number.isNaN(t.getTime())) return null;
    return t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return null;
  }
}

function buildJobDetailStatusContext(
  job: Job,
  opts?: { forcedPaidBySystemOwner?: boolean },
): JobDetailStatusContext | null {
  if (job.status === "on_hold") {
    const reason = job.on_hold_reason?.trim() || "No reason recorded";
    const since = formatJobStatusContextTimestamp(job.on_hold_at);
    const was = job.on_hold_previous_status ? jobStatusLabel(job.on_hold_previous_status) : null;
    const title = [reason, since ? `Since ${since}` : null, was ? `Was ${was}` : null].filter(Boolean).join(" · ");
    return {
      chipClass: "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100",
      primary: reason,
      secondary: since ?? undefined,
      title,
    };
  }

  if (job.status === "cancelled") {
    if (job.partner_cancelled_at) {
      const reason = job.partner_cancellation_reason?.trim() || "Partner cancelled";
      const fee = Number(job.partner_cancellation_fee ?? 0).toFixed(2);
      return {
        chipClass: "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100",
        primary: reason,
        secondary: `Fee £${fee}`,
        title: `${reason} · Fee £${fee}`,
      };
    }
    const reason = job.cancellation_reason?.trim();
    const when = formatJobStatusContextTimestamp(job.cancelled_at);
    if (reason) {
      return {
        chipClass: "border-red-500/35 bg-red-500/10 text-red-900 dark:text-red-100",
        primary: reason,
        secondary: when ?? undefined,
        title: [reason, when ? `Recorded ${when}` : null].filter(Boolean).join(" · "),
      };
    }
    return {
      chipClass: "border-red-500/35 bg-red-500/10 text-red-900 dark:text-red-100",
      primary: "Lost",
      title: when ? `Lost · ${when}` : "Lost — no reason recorded",
    };
  }

  if (job.status === "completed") {
    if (opts?.forcedPaidBySystemOwner) {
      return {
        chipClass: "border-red-500/35 bg-red-500/10 text-red-800 dark:text-red-200",
        primary: "Force paid",
        title: "Forced and guaranteed by system owner",
      };
    }
    if (job.finance_status === "paid") {
      const approved = job.owner_name?.trim();
      return {
        chipClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
        primary: "Paid",
        secondary: approved ? approved : undefined,
        title: approved ? `Paid · Approved by ${approved}` : "Customer paid in full",
      };
    }
    if (job.finance_status === "partial") {
      return {
        chipClass: "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100",
        primary: "Partially paid",
        title: "Partial customer payment recorded",
      };
    }
    return null;
  }

  if (job.status === "deleted") {
    return {
      chipClass: "border-border bg-muted/50 text-text-secondary",
      primary: "Deleted",
      title: "Job archived",
    };
  }

  return null;
}

function JobDetailStatusContextChip({ ctx }: { ctx: JobDetailStatusContext }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-[10rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-snug sm:max-w-[13rem] md:max-w-[16rem]",
        ctx.chipClass,
      )}
      title={ctx.title}
    >
      <span className="truncate">{ctx.primary}</span>
      {ctx.secondary ? (
        <span className="hidden shrink-0 truncate text-[9px] font-normal opacity-75 sm:inline max-w-[5.5rem] md:max-w-[8rem]">
          · {ctx.secondary}
        </span>
      ) : null}
    </span>
  );
}

function getJobTypeIcon(jobType: string): LucideIcon {
  const t = jobType.toLowerCase();
  if (t.includes("carpenter") || t.includes("carpentry")) return Hammer;
  if (t.includes("electrician") || t.includes("electrical")) return Zap;
  if (t.includes("plumber") || t.includes("plumbing")) return Droplets;
  if (t.includes("painter") || t.includes("painting")) return Paintbrush;
  if (t.includes("cleaner") || t.includes("cleaning")) return Sparkles;
  if (t.includes("general maintenance") || t.includes("maintenance")) return Wrench;
  if (t.includes("gardener") || t.includes("gardening")) return Leaf;
  if (t.includes("locksmith")) return KeyRound;
  if (t.includes("tiler") || t.includes("tiling")) return Grid3x3;
  return Briefcase;
}

function getJobTypePillClass(jobType: string): string {
  const t = jobType.toLowerCase();
  if (t.includes("carpenter") || t.includes("carpentry")) return "bg-[#5b3a1a] text-white";
  if (t.includes("electrician") || t.includes("electrical")) return "bg-[#3a2a00] text-[#ffd86b]";
  if (t.includes("plumber") || t.includes("plumbing")) return "bg-[#0f3b66] text-[#d9ecff]";
  if (t.includes("painter") || t.includes("painting")) return "bg-[#4f2d63] text-[#f3ddff]";
  if (t.includes("cleaner") || t.includes("cleaning")) return "bg-[#0f4d3a] text-[#d5ffe8]";
  if (t.includes("general maintenance") || t.includes("maintenance")) return "bg-[#1f2937] text-white";
  if (t.includes("gardener") || t.includes("gardening")) return "bg-[#1f4d1f] text-[#dcffd9]";
  if (t.includes("locksmith")) return "bg-[#3a3a3a] text-[#f5f5f5]";
  if (t.includes("tiler") || t.includes("tiling")) return "bg-[#0f3e3e] text-[#d7ffff]";
  return "bg-[#1a1a1a] text-white";
}

const selfBillStatusConfig: Record<
  string,
  { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }
> = {
  draft: { label: "Draft", variant: "default" },
  accumulating: { label: "Open Week", variant: "default" },
  pending_review: { label: "Review & Approve", variant: "primary" },
  needs_attention: { label: "Needs Attention", variant: "danger" },
  awaiting_payment: { label: "Awaiting Payment", variant: "warning" },
  ready_to_pay: { label: "Ready To Pay", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  audit_required: { label: "Audit Required", variant: "danger" },
  rejected: { label: "Rejected", variant: "default" },
};

function JobDetailSelfBillPanel({ sb, job }: { sb: SelfBill; job: Job }) {
  const [open, setOpen] = useState(false);
  const st = selfBillStatusConfig[sb.status] ?? { label: sb.status, variant: "default" as const };
  const partnerFieldBill = sb.bill_origin !== "internal";
  const paymentDueYmd =
    partnerFieldBill && sb.week_end?.trim() ? partnerFieldSelfBillPaymentDueDate(sb.week_end.trim()) : null;
  const weekLine =
    sb.week_start && sb.week_end
      ? `${sb.week_start} → ${sb.week_end}${sb.week_label ? ` (${sb.week_label})` : ""}`
      : sb.week_label ?? sb.period;
  const compactWeekLine =
    sb.week_start && sb.week_end
      ? `${sb.week_start} -> ${sb.week_end}${sb.week_label ? ` (${sb.week_label})` : ""}`
      : weekLine;
  const jobLabourOnBill = Math.round(partnerPaymentCap(job) * 100) / 100;
  const jobMaterialsOnBill = Math.round(Math.max(0, Number(job.materials_cost ?? 0)) * 100) / 100;
  const jobGrossOnBill = Math.round(partnerSelfBillGrossAmount(job) * 100) / 100;
  return (
    <div className="rounded-lg border border-border-light p-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide self-bill details" : "Show self-bill details"}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-transparent p-1.5 text-text-secondary transition-colors hover:border-border-light hover:bg-surface-tertiary hover:text-text-primary mt-0.5"
        >
          <ChevronDown className={cn("h-5 w-5 transition-transform duration-200", open && "rotate-180")} />
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          {!open ? (
            <div className="flex items-start justify-between gap-2 pt-0.5">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-primary truncate">{sb.reference}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5 leading-tight">
                  <span className="sm:hidden block break-words">Week {compactWeekLine}</span>
                  <span className="hidden sm:block truncate" title={`Week ${weekLine}`}>Week {weekLine}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <p className="text-lg font-bold tabular-nums text-primary tracking-tight">{formatCurrency(jobGrossOnBill)}</p>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<FileText className="h-3 w-3" />}
                  onClick={() => window.open(`/api/self-bills/${sb.id}/pdf`, "_blank", "noopener,noreferrer")}
                >
                  PDF
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text-primary">{sb.reference}</p>
                <Badge variant={st.variant} size="sm">{st.label}</Badge>
              </div>
              <p className="text-[11px] text-text-secondary truncate" title={sb.partner_name}>
                Partner → us · {sb.partner_name}
              </p>
              <p className="text-sm font-bold tabular-nums text-primary">{formatCurrency(jobGrossOnBill)}</p>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">This job on the bill</p>
              <div className="grid grid-cols-1 gap-2 pt-1 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-text-tertiary">Labour (this job)</p>
                  <p className="font-semibold tabular-nums text-text-primary">{formatCurrency(jobLabourOnBill)}</p>
                </div>
                <div>
                  <p className="text-text-tertiary">Materials (this job)</p>
                  <p className="font-semibold tabular-nums text-text-primary">{formatCurrency(jobMaterialsOnBill)}</p>
                </div>
              </div>
              <p className="text-[11px] text-text-tertiary pt-0.5 leading-snug">
                <span className="font-medium text-text-secondary">Week:</span> {weekLine} · {sb.jobs_count} job{sb.jobs_count === 1 ? "" : "s"} on this bill
                {sb.jobs_count > 1 ? (
                  <>
                    {" "}
                    · Whole bill total {formatCurrency(sb.net_payout)}
                  </>
                ) : null}
                {" "}
                Payouts on the job reduce amount due only; extra payout on the job increases this line.
              </p>
              {paymentDueYmd ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium pt-0.5">
                  Office payment due: {formatDate(paymentDueYmd)} (Friday after the week ends)
                </p>
              ) : null}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<FileText className="h-3 w-3" />}
                  onClick={() => window.open(`/api/self-bills/${sb.id}/pdf`, "_blank", "noopener,noreferrer")}
                >
                  PDF
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Six-stage pipeline shown on job detail (matches ops mental model). */
const JOB_FLOW_STEPS: readonly { label: string; statuses: readonly Job["status"][]; icon: LucideIcon }[] = [
  { label: "Booked", statuses: ["unassigned", "auto_assigning", "scheduled", "late"], icon: Calendar },
  { label: "On Site", statuses: ["in_progress"], icon: HardHat },
  { label: "On Hold", statuses: ["on_hold"], icon: PauseCircle },
  { label: "Final Checks", statuses: ["final_check", "need_attention"], icon: ClipboardCheck },
  { label: "Awaiting Payment", statuses: ["awaiting_payment"], icon: CreditCard },
  { label: "Completed", statuses: ["completed"], icon: CheckCircle2 },
];

function jobFlowActiveStepIndex(status: Job["status"]): number {
  if (status === "cancelled" || status === "deleted") return -1;
  const i = JOB_FLOW_STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(status));
  return i >= 0 ? i : 0;
}

function extractReportMediaUrls(notes: string | null | undefined): string[] {
  const text = notes ?? "";
  if (!text.trim()) return [];
  const hits = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return hits.filter((u) => /\.(png|jpe?g|webp|gif)$/i.test(u));
}

/** `https://wa.me/{digits}` — same rules as partners list (UK 07… → 44…). */
function whatsAppHrefFromPhoneForJob(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if ((d.length === 10 || d.length === 11) && d.startsWith("0")) {
    d = `44${d.slice(1)}`;
  }
  if (d.length < 8 || d.length > 15) return null;
  return `https://wa.me/${d}`;
}

function JobHeaderWhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function extractLastMarkedPaidBy(internalNotes: string | null | undefined): string | null {
  const text = (internalNotes ?? "").trim();
  if (!text) return null;
  const matches = [...text.matchAll(/PAID_MARKED_BY::([^\n\r]+)/g)];
  if (!matches.length) return null;
  const who = matches[matches.length - 1]?.[1]?.trim() ?? "";
  return who || null;
}

interface JobDetailClientProps {
  /**
   * Server-rendered job bundle (Phase 3 server-shell). When present, the
   * initial useEffect skips the network round-trip and hydrates state
   * synchronously from this payload.
   */
  initialBundle?: JobDetailBundle | null;
}

type InternalJobNote = {
  iso: string;
  author: string;
  text: string;
};

type ExtraHistoryEntry = {
  id: string;
  side: "client" | "partner";
  amount: number;
  extraType: string;
  reason: string;
  clientConfirmed?: boolean;
  createdAt: string;
  userName?: string;
  allocation: "labour" | "extras" | "materials" | "partner_cost";
  linkedGroupId?: string | null;
  idRaw: string;
};

function encodeClientExtraReason(reason: string, clientConfirmed: boolean): string {
  const base = reason.trim();
  return `${clientConfirmed ? "[CLIENT_CONFIRMED]" : "[CLIENT_UNCONFIRMED]"} ${base}`.trim();
}

function decodeClientExtraReason(raw: string): { reason: string; clientConfirmed?: boolean } {
  const text = raw.trim();
  if (text.startsWith("[CLIENT_CONFIRMED]")) {
    return { reason: text.replace("[CLIENT_CONFIRMED]", "").trim(), clientConfirmed: true };
  }
  if (text.startsWith("[CLIENT_UNCONFIRMED]")) {
    return { reason: text.replace("[CLIENT_UNCONFIRMED]", "").trim(), clientConfirmed: false };
  }
  return { reason: text };
}

type ExtraHistoryBucket = "extra" | "ccz" | "parking" | "materials";

function extraHistoryBucket(extraType: string): ExtraHistoryBucket {
  const key = extraType.trim().toUpperCase();
  if (key === "CCZ") return "ccz";
  if (key === "PARKING") return "parking";
  if (key === "MATERIALS") return "materials";
  return "extra";
}

function isFallbackExtraEntry(entry: ExtraHistoryEntry): boolean {
  return entry.idRaw.startsWith("fallback-");
}

function extractExtraHistory(entries: JobExtraEntry[]): ExtraHistoryEntry[] {
  return entries
    .map((row) => {
      const decoded = row.side === "client"
        ? decodeClientExtraReason(String(row.reason ?? ""))
        : { reason: String(row.reason ?? "").trim(), clientConfirmed: undefined };
      return {
        id: row.id,
        idRaw: row.id,
        side: row.side,
        amount: Number(row.amount ?? 0),
        extraType: String(row.extra_type ?? "").trim() || "Extra",
        reason: decoded.reason,
        clientConfirmed: decoded.clientConfirmed,
        createdAt: String(row.created_at ?? ""),
        userName: String(row.created_by_name ?? "").trim() || undefined,
        allocation: (row.allocation ?? "extras") as ExtraHistoryEntry["allocation"],
        linkedGroupId: row.linked_group_id,
      } satisfies ExtraHistoryEntry;
    })
    .filter((v) => v.amount > 0.009)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function extraHistorySignedAmount(entry: Pick<ExtraHistoryEntry, "extraType" | "amount">): number {
  return signedLedgerDisplayAmount(entry.extraType, Number(entry.amount ?? 0));
}

function formatSignedCurrency(signed: number): string {
  const abs = Math.abs(Math.round(signed * 100) / 100);
  const core = formatCurrency(abs);
  return signed < -0.009 ? `−${core}` : signed > 0.009 ? `+${core}` : core;
}

function extraHistoryTooltipText(entries: ExtraHistoryEntry[], emptyText: string): string {
  if (entries.length === 0) return emptyText;
  return entries
    .slice(0, 25)
    .map((entry) => {
      const when = new Date(entry.createdAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const by = entry.userName ? ` · ${entry.userName}` : "";
      const reason = entry.reason?.trim() ? `\nReason: ${entry.reason.trim()}` : "";
      const line = `${when} · ${entry.extraType} · ${formatSignedCurrency(extraHistorySignedAmount(entry))}${by}${reason}`;
      return line;
    })
    .join("\n\n");
}

const JOB_CARD_HINT_BTN_CLASS =
  "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-border-light text-[9px] font-bold text-text-tertiary transition-colors hover:border-text-primary hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/30";

function JobCardHint({
  title,
  ariaLabel,
  onClick,
  className,
}: {
  title: string;
  ariaLabel?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      className={cn(JOB_CARD_HINT_BTN_CLASS, className)}
    >
      !
    </button>
  );
}

/** Hint icon immediately before the section/field title (same row). */
function JobCardTitleWithHint({
  title,
  hint,
  titleClassName = "text-[11px] font-semibold uppercase tracking-wide text-text-secondary",
  className,
  hintAriaLabel,
  onHintClick,
  hintClassName,
}: {
  title: React.ReactNode;
  hint?: string;
  titleClassName?: string;
  className?: string;
  hintAriaLabel?: string;
  onHintClick?: () => void;
  hintClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {hint ? (
        <JobCardHint
          title={hint}
          ariaLabel={hintAriaLabel ?? (typeof title === "string" ? `${title}: ${hint}` : hint)}
          onClick={onHintClick}
          className={hintClassName}
        />
      ) : null}
      <span className={titleClassName}>{title}</span>
    </div>
  );
}

function FinSetupSectionTitle({ children, hint }: { children: React.ReactNode; hint: string }) {
  return <JobCardTitleWithHint title={children} hint={hint} />;
}

function FinSetupFieldLabel({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      {hint ? <JobCardHint title={hint} ariaLabel={`${label}: ${hint}`} /> : null}
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
    </div>
  );
}

/** Schedule tab — CCZ / Parking toggles share the same off-state (light gray container + track). */
function accessFeeToggleButtonClass(active: boolean, disabled?: boolean) {
  return cn(
    "mt-1.5 flex w-full max-w-[13rem] items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
    active
      ? "border-emerald-500 bg-emerald-50 shadow-sm dark:border-emerald-500/70 dark:bg-emerald-950/30"
      : "border-[#E4E4E8] bg-[#F5F5F7] hover:border-[#D4D4DA] dark:border-[#2f3440] dark:bg-[#1e2430] dark:hover:border-[#3a4252]",
    disabled && "cursor-not-allowed opacity-50",
  );
}

function accessFeeToggleTrackClass(active: boolean) {
  return cn(
    "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors",
    active ? "bg-emerald-600" : "bg-[#D4D4DA] dark:bg-stone-600",
  );
}

function accessFeeToggleThumbClass(active: boolean) {
  return cn(
    "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform dark:bg-[#d8dee9]",
    active ? "translate-x-[14px]" : "translate-x-[2px]",
  );
}

function accessFeeToggleLabelClass(active: boolean) {
  return cn("text-[10px] font-medium", active ? "text-emerald-700 dark:text-emerald-300" : "text-text-tertiary");
}

function accessFeeCardClass(active: boolean) {
  return cn(
    "min-w-0 rounded-[10px] p-[12px_14px] transition-colors",
    active ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-white",
  );
}

function accessFeeCardBorderStyle(active: boolean): React.CSSProperties {
  return { border: active ? "0.5px solid #10B981" : "0.5px solid #E4E4E8" };
}

export function JobDetailClient({ initialBundle }: JobDetailClientProps = {}) {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const { profile } = useProfile();
  const { jobOnHoldPresets, officeCancellationPresets, accessFees } = useFrontendSetup();
  const cancelJob = useCancelJob();
  const putOnHoldReasonOptions = useMemo(
    () => jobOnHoldPresetSelectOptions(jobOnHoldPresets),
    [jobOnHoldPresets],
  );

  // Hydrate from server bundle when present so the page is interactive on
  // first paint instead of after a useEffect waterfall.
  const initialPayments = (initialBundle?.payments ?? []) as Array<{ type?: string }>;
  const [job, setJob] = useState<Job | null>((initialBundle?.job as Job | undefined) ?? null);
  const [loading, setLoading] = useState(initialBundle?.job ? false : true);
  const skipFirstFetchRef = useRef(initialBundle?.job != null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  /** mig 158: pending recurring-scope decision when editing a job that's part of a series. */
  const [recurringScopePending, setRecurringScopePending] = useState<{
    jobId: string;
    patch: Partial<Job>;
    sequenceIndex: number | null;
    actionLabel: string;
  } | null>(null);
  /** Preset minutes after arrival-from for window end (replaces manual “arrival to” time). */
  const [scheduleWindowMins, setScheduleWindowMins] = useState("");
  /** Civil end day for calendar (`scheduled_finish_date`). */
  const [scheduleExpectedFinishDate, setScheduleExpectedFinishDate] = useState("");
  const [partnerPayments, setPartnerPayments] = useState<JobPayment[]>(
    () => (initialPayments.filter((p) => p.type === "partner") as JobPayment[]),
  );
  const [customerPayments, setCustomerPayments] = useState<JobPayment[]>(
    () => (initialPayments.filter(
      (p) => p.type === "customer_deposit" || p.type === "customer_final",
    ) as JobPayment[]),
  );
  const [extraHistory, setExtraHistory] = useState<ExtraHistoryEntry[]>([]);
  const [deletingExtraId, setDeletingExtraId] = useState<string | null>(null);
  const [deleteExtraTarget, setDeleteExtraTarget] = useState<ExtraHistoryEntry | null>(null);
  const [deleteLinkedPartnerAlso, setDeleteLinkedPartnerAlso] = useState(true);
  const [confirmingDeleteExtra, setConfirmingDeleteExtra] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [moneyDrawerOpen, setMoneyDrawerOpen] = useState(false);
  const [moneyDrawerFlow, setMoneyDrawerFlow] = useState<JobMoneyDrawerFlow | null>(null);
  const [moneyDrawerInitialExtraType, setMoneyDrawerInitialExtraType] = useState<string | undefined>(undefined);
  const [moneyDrawerAccountPrice, setMoneyDrawerAccountPrice] = useState<AccountServicePrice | null>(null);
  const [extraManagerSide, setExtraManagerSide] = useState<"client" | "partner" | null>(null);
  const [extraManagerFocusBucket, setExtraManagerFocusBucket] = useState<ExtraHistoryBucket | null>(null);
  const [editExtraTarget, setEditExtraTarget] = useState<ExtraHistoryEntry | null>(null);
  const [editExtraAmount, setEditExtraAmount] = useState("");
  const [editExtraReason, setEditExtraReason] = useState("");
  const [editExtraClientConfirmed, setEditExtraClientConfirmed] = useState(true);
  const [savingExtraEdit, setSavingExtraEdit] = useState(false);
  const [moneySubmitting, setMoneySubmitting] = useState(false);
  /** Layout-only: job detail tabs and accordions (money actions use drawer modal). */
  const [detailTab, setDetailTab] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
  /** One-shot: when a job lands in `final_check`, open the Reports tab by default (only on first paint for this job). */
  const detailTabInitialisedForJobRef = useRef<string | null>(null);
  const [clientEditAccordionOpen, setClientEditAccordionOpen] = useState(false);
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<{ id: string; amount: number; type: string } | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [propertyEdit, setPropertyEdit] = useState<ClientAndAddressValue | null>(null);
  /** Map card: linked account (label + optional `accounts.logo_url`) + client phone/email. */
  const [jobHeaderAccount, setJobHeaderAccount] = useState<{ label: string; logoUrl: string | null } | null>(null);
  const [jobHeaderContact, setJobHeaderContact] = useState<{ phone?: string; email?: string } | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [unlinkedAddressDraft, setUnlinkedAddressDraft] = useState("");
  const [savingUnlinkedAddress, setSavingUnlinkedAddress] = useState(false);
  const [savingAccessFees, setSavingAccessFees] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [cancelJobOpen, setCancelJobOpen] = useState(false);
  const [putOnHoldOpen, setPutOnHoldOpen] = useState(false);
  const [putOnHoldReason, setPutOnHoldReason] = useState("");
  const [putOnHoldPreset, setPutOnHoldPreset] = useState<string | null>(null);
  const [putOnHoldSaving, setPutOnHoldSaving] = useState(false);
  const putOnHoldReasonRef = useRef<HTMLTextAreaElement>(null);
  const [resumeJobOpen, setResumeJobOpen] = useState(false);
  const [resumeAction, setResumeAction] = useState<"reschedule" | "cancel" | "complete">("reschedule");
  const [resumeArrivalDate, setResumeArrivalDate] = useState("");
  const [resumeArrivalTime, setResumeArrivalTime] = useState("");
  const [resumeArrivalWindowMins, setResumeArrivalWindowMins] = useState("");
  const [resumeExpectedFinishDate, setResumeExpectedFinishDate] = useState("");
  const [resumeSaving, setResumeSaving] = useState(false);
  const [validateCompleteOpen, setValidateCompleteOpen] = useState(false);
  const [validatingComplete, setValidatingComplete] = useState(false);

  /**
   * Drag-from-Beacon entry point: when the URL carries `?action=approve|cancel`
   * (set by Beacon Kanban when a card is dropped on Completed / Cancelled),
   * open the matching modal once the page mounts and strip the param so a
   * refresh doesn't re-trigger.
   */
  const searchParams = useSearchParams();
  const actionFromUrl = searchParams?.get("action");
  useEffect(() => {
    if (!actionFromUrl) return;
    if (actionFromUrl === "approve") {
      setValidateCompleteOpen(true);
    } else if (actionFromUrl === "cancel") {
      setCancelJobOpen(true);
    }
    // Strip the query param so subsequent refreshes don't re-open the modal.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("action");
      window.history.replaceState({}, "", url.toString());
    }
    // intentionally only run on first mount + when action param appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFromUrl]);
  /** Loaded when opening Final review from the job’s client → account. */
  const [accountEmailPolicy, setAccountEmailPolicy] = useState<AccountFinalEmailPolicy>({
    canIncludeInvoice: true,
    canIncludeReport: true,
  });
  // Default to stage_only (internal completion, no client email) — the user-facing
  // "Client communication" radio was removed from FinalReviewModal. Email pack
  // can still be triggered programmatically by setting this to "email".
  const [completionDelivery, setCompletionDelivery] = useState<CompletionDelivery | null>("stage_only");
  const [includeInvoiceInEmail, setIncludeInvoiceInEmail] = useState(true);
  const [includeReportInEmail, setIncludeReportInEmail] = useState(true);
  const [finalReviewBillingLabel, setFinalReviewBillingLabel] = useState<{
    invoiceTo: string;
    email: string | null;
    linkedAccountName: string | null;
  } | null>(null);
  const [finalReviewBillingLoading, setFinalReviewBillingLoading] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"review_approve" | "validate_complete">("validate_complete");
  const [ownerApprovalChecked, setOwnerApprovalChecked] = useState(false);
  const [forceApprovalChecked, setForceApprovalChecked] = useState(false);
  const [forceApprovalReason, setForceApprovalReason] = useState("");
  /** Second mandatory attestation on the Final review modal — separate from report + payment responsibility. */
  const [sentToAccountsChecked, setSentToAccountsChecked] = useState(false);
  const [approvalBilledHoursInput, setApprovalBilledHoursInput] = useState("");
  const [cancelPresetId, setCancelPresetId] = useState<string>(OFFICE_JOB_CANCELLATION_REASONS[0].id);
  const [cancelDetail, setCancelDetail] = useState("");
  const [cancellingJob, setCancellingJob] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [savingPartner, setSavingPartner] = useState(false);
  const [signingOffPartner, setSigningOffPartner] = useState(false);
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [partnerPickerSearch, setPartnerPickerSearch] = useState("");
  const partnerPickerRef = useRef<HTMLDivElement>(null);
  const partnerPickerSearchInputRef = useRef<HTMLInputElement>(null);
  const partnerCostSectionRef = useRef<HTMLDivElement>(null);
  const [partnerAssignRateType, setPartnerAssignRateType] = useState<"fixed" | "hourly">("fixed");
  const [partnerAssignServiceId, setPartnerAssignServiceId] = useState("");
  const [partnerAssignFixedCost, setPartnerAssignFixedCost] = useState("");
  const [partnerAssignBilledHours, setPartnerAssignBilledHours] = useState("1");
  const [partnerAssignClientHourlyRate, setPartnerAssignClientHourlyRate] = useState("");
  const [partnerAssignPartnerHourlyRate, setPartnerAssignPartnerHourlyRate] = useState("");
  const [partnerAssignExtraInputs, setPartnerAssignExtraInputs] = useState<{
    extra: string;
    ccz: string;
    parking: string;
    materials: string;
  }>({
    extra: "",
    ccz: "",
    parking: "",
    materials: "",
  });
  const [finForm, setFinForm] = useState({
    client_price: "",
    extras_amount: "",
    partner_cost: "",
    materials_cost: "",
    partner_agreed_value: "",
    customer_deposit: "",
    customer_final_payment: "",
  });
  const [jobMoreMenuOpen, setJobMoreMenuOpen] = useState(false);
  const jobMoreMenuRef = useRef<HTMLDivElement>(null);
  /** Bumped from header ⋮ → opens Add visit on Visits tab. */
  const [visitOpenCreateSignal, setVisitOpenCreateSignal] = useState(0);
  /** ⋮ → “Reschedule & confirm” — one modal for date, partner, service, pricing. */
  const [quickRescheduleOpen, setQuickRescheduleOpen] = useState(false);
  const [quickRescheduleSaving, setQuickRescheduleSaving] = useState(false);
  const [qrDate, setQrDate] = useState("");
  const [qrTime, setQrTime] = useState("");
  const [qrWindowMins, setQrWindowMins] = useState("");
  const [qrExpectedFinish, setQrExpectedFinish] = useState("");
  const [qrPartnerId, setQrPartnerId] = useState("");
  const [qrCatalogServiceId, setQrCatalogServiceId] = useState("");
  const [qrClientPrice, setQrClientPrice] = useState("");
  const [qrPartnerCost, setQrPartnerCost] = useState("");
  const [savingFin, setSavingFin] = useState(false);
  const [jobTypeEditOpen, setJobTypeEditOpen] = useState(false);
  const [jobTypeEditTarget, setJobTypeEditTarget] = useState<"fixed" | "hourly">("fixed");
  const [jobAssignmentEditMode, setJobAssignmentEditMode] = useState<"manual" | "auto">("manual");
  const [jobTypeEditCatalogId, setJobTypeEditCatalogId] = useState("");
  const [jobTypeEditFixedTitle, setJobTypeEditFixedTitle] = useState("");
  const [catalogServicesJobType, setCatalogServicesJobType] = useState<CatalogService[]>([]);
  const [loadingJobTypeCatalog, setLoadingJobTypeCatalog] = useState(false);
  const [savingJobTypeEdit, setSavingJobTypeEdit] = useState(false);
  const [jobBillingDetailsOpen, setJobBillingDetailsOpen] = useState(false);
  const [jobInvoices, setJobInvoices] = useState<Invoice[]>([]);
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  /** Job invoice cards: collapsed shows amount only; expand for ref, status, Stripe, actions. */
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Set<string>>(new Set());
  const [invoiceDueDateDrafts, setInvoiceDueDateDrafts] = useState<Record<string, string>>({});
  const [savingInvoiceDueDateId, setSavingInvoiceDueDateId] = useState<string | null>(null);
  const [jobSelfBill, setJobSelfBill] = useState<SelfBill | null>(null);
  const [loadingSelfBill, setLoadingSelfBill] = useState(false);
  const [linkingSelfBill, setLinkingSelfBill] = useState(false);
  const [syncingInvoiceId, setSyncingInvoiceId] = useState<string | null>(null);
  const [manualReportFile, setManualReportFile] = useState<File | null>(null);
  const [manualReportNotes, setManualReportNotes] = useState("");
  const [manualReportResult, setManualReportResult] = useState("");
  const [analyzingManualReport, setAnalyzingManualReport] = useState(false);
  const [phaseReportFiles, setPhaseReportFiles] = useState<Record<number, File | null>>({});
  const [analyzingPhase, setAnalyzingPhase] = useState<number | null>(null);
  const [appJobReports, setAppJobReports] = useState<AppJobReportRow[]>([]);
  const [loadingAppJobReports, setLoadingAppJobReports] = useState(false);
  const [openingReportId, setOpeningReportId] = useState<string | null>(null);
  const [openingReportImageKey, setOpeningReportImageKey] = useState<string | null>(null);
  const [scopeDraft, setScopeDraft] = useState("");
  const [scopeEditing, setScopeEditing] = useState(false);
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const [prevJobNavId, setPrevJobNavId] = useState<string | null>(null);
  const [nextJobNavId, setNextJobNavId] = useState<string | null>(null);
  const [savingScope, setSavingScope] = useState(false);
  const [additionalNotesDraft, setAdditionalNotesDraft] = useState("");
  const [additionalNotesEditing, setAdditionalNotesEditing] = useState(false);
  const [savingAdditionalNotes, setSavingAdditionalNotes] = useState(false);
  const [reportLinkDraft, setReportLinkDraft] = useState("");
  const [reportLinkEditing, setReportLinkEditing] = useState(false);
  const [savingReportLink, setSavingReportLink] = useState(false);
  const [internalNoteDraft, setInternalNoteDraft] = useState("");
  const [savingInternalNote, setSavingInternalNote] = useState(false);
  const [sitePhotoUploading, setSitePhotoUploading] = useState(false);
  const [clientExtrasUiValue, setClientExtrasUiValue] = useState(0);
  const [partnerExtrasUiValue, setPartnerExtrasUiValue] = useState(0);
  const [hourlyTimeEditOpen, setHourlyTimeEditOpen] = useState(false);
  const [hourlyEditHours, setHourlyEditHours] = useState("");
  const [hourlyEditMinutes, setHourlyEditMinutes] = useState("");
  const [savingHourlyTimeEdit, setSavingHourlyTimeEdit] = useState(false);
  const [fixedRatesInlineOpen, setFixedRatesInlineOpen] = useState(false);
  const [fixedInlineClientRate, setFixedInlineClientRate] = useState("");
  const [fixedInlinePartnerCost, setFixedInlinePartnerCost] = useState("");
  const [savingFixedInlineRates, setSavingFixedInlineRates] = useState(false);
  const [partnerExtraBreakdownUi, setPartnerExtraBreakdownUi] = useState<{ extra: number; ccz: number; parking: number }>({
    extra: 0,
    ccz: 0,
    parking: 0,
  });
  const isAdmin = profile?.role === "admin";
  const jobRef = useRef<Job | null>(null);
  const autoOwnerFillRef = useRef<Set<string>>(new Set());
  /** User chose "Unassigned" for job owner — do not auto-fill with current profile. */
  const ownerKeepUnassignedRef = useRef<Set<string>>(new Set());
  const autoInvoiceEnsureRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  useEffect(() => {
    if (!jobMoreMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = jobMoreMenuRef.current;
      if (el && !el.contains(e.target as Node)) setJobMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [jobMoreMenuOpen]);
  useEffect(() => {
    if (!job?.id) return;
    setClientExtrasUiValue(Math.max(0, Number(job.extras_amount ?? 0)));
    setPartnerExtrasUiValue(Math.max(0, Number(job.partner_extras_amount ?? 0)));
    setPartnerExtraBreakdownUi({
      extra: Math.max(0, Number(job.partner_extras_amount ?? 0)),
      ccz: 0,
      parking: 0,
    });
  }, [job?.id]);

  useEffect(() => {
    if (!validateCompleteOpen || !job || job.job_type !== "hourly") return;
    const { clientRate, partnerRate } = resolveJobHourlyRates(job);
    const timerSeconds = computeOfficeTimerElapsedSeconds(job);
    const billedSeconds = Math.round(Math.max(0, Number(job.billed_hours ?? 0) || 0) * 3600);
    const elapsedSeconds = Math.max(timerSeconds, billedSeconds);
    const preview = computeHourlyTotals({
      elapsedSeconds,
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
    setApprovalBilledHoursInput(String(preview.billedHours));
  }, [
    validateCompleteOpen,
    job?.id,
    job?.job_type,
    job?.billed_hours,
    job?.timer_elapsed_seconds,
    job?.timer_is_running,
    job?.timer_last_started_at,
    job?.client_price,
    job?.partner_cost,
    job?.hourly_client_rate,
    job?.hourly_partner_rate,
  ]);

  useEffect(() => {
    if (!validateCompleteOpen || !job?.client_id?.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const c = await getClient(job.client_id!.trim());
        const acc = c?.source_account_id?.trim() ? await getAccount(c.source_account_id.trim()) : null;
        const policy = accountFinalEmailPolicyFromRow(acc);
        if (cancelled) return;
        setAccountEmailPolicy(policy);
        setIncludeInvoiceInEmail(policy.canIncludeInvoice);
        setIncludeReportInEmail(policy.canIncludeReport);
        setCompletionDelivery(canSendClientEmailWithPack(policy) ? null : "stage_only");
      } catch {
        if (!cancelled) {
          const fallback: AccountFinalEmailPolicy = { canIncludeInvoice: true, canIncludeReport: true };
          setAccountEmailPolicy(fallback);
          setIncludeInvoiceInEmail(true);
          setIncludeReportInEmail(true);
          setCompletionDelivery(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validateCompleteOpen, job?.client_id]);

  useEffect(() => {
    if (!validateCompleteOpen || !job?.client_id?.trim()) {
      setFinalReviewBillingLabel(null);
      setFinalReviewBillingLoading(false);
      return;
    }
    let cancelled = false;
    setFinalReviewBillingLoading(true);
    void resolveNominalBillingParty(getSupabase(), {
      clientId: job.client_id.trim(),
      fallbackName: job.client_name ?? undefined,
    })
      .then(async (r) => {
        if (cancelled) return;
        let linkedAccountName: string | null = null;
        const aid = r.sourceAccountId?.trim();
        if (aid) {
          try {
            const acc = await getAccount(aid);
            linkedAccountName = acc?.company_name?.trim() || null;
          } catch {
            linkedAccountName = null;
          }
        }
        if (cancelled) return;
        setFinalReviewBillingLabel({
          invoiceTo: r.displayName,
          email: r.documentEmail,
          linkedAccountName,
        });
        setFinalReviewBillingLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFinalReviewBillingLabel({
          invoiceTo: job.client_name?.trim() || "—",
          email: null,
          linkedAccountName: null,
        });
        setFinalReviewBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [validateCompleteOpen, job?.client_id, job?.client_name]);

  const [partnerTimerTick, setPartnerTimerTick] = useState(0);
  useEffect(() => {
    if (!job || !isPartnerLiveTimerRunning(job)) return;
    const t = window.setInterval(() => setPartnerTimerTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [job?.partner_timer_started_at, job?.partner_timer_ended_at, job?.id]);

  useEffect(() => {
    if (!id || !job || !isPartnerLiveTimerRunning(job)) return;
    /** 2s polling generated ~1800 RPS / hour against the jobs row for every open tab.
     *  Bumped to 10s — partner timer end transitions still feel near-realtime via the local 1s tick. */
    const poll = window.setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const j = await getJob(id);
        if (j) setJob(j);
      } catch {
        /* ignore */
      }
    }, 10000);
    return () => window.clearInterval(poll);
  }, [id, job?.partner_timer_started_at, job?.partner_timer_ended_at]);

  const [officeTimerTick, setOfficeTimerTick] = useState(0);
  useEffect(() => {
    if (!job?.timer_is_running || !job.timer_last_started_at) return;
    const t = window.setInterval(() => setOfficeTimerTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [job?.timer_is_running, job?.timer_last_started_at, job?.id]);

  const partnerLiveActiveMs = useMemo(() => {
    void partnerTimerTick;
    if (!job?.partner_timer_started_at) return null;
    /** Unassigned / auto-assigning → hide the live counter immediately (backend also wipes the timer fields on the next update). */
    if (job.status === "unassigned" || job.status === "auto_assigning") return null;
    return computePartnerLiveTimerActiveMs(job);
  }, [job, partnerTimerTick]);

  const officeTimerDisplaySeconds = useMemo(() => {
    void officeTimerTick;
    if (!job) return null;
    const useOffice =
      job.timer_is_running ||
      (Number(job.timer_elapsed_seconds ?? 0) > 0) ||
      !!job.timer_last_started_at;
    if (!useOffice) return null;
    return computeOfficeTimerElapsedSeconds(job);
  }, [job, officeTimerTick]);

  const hourlyBilledSeconds = useMemo(() => {
    if (!job || job.job_type !== "hourly") return 0;
    const billedHours = Math.max(0, Number(job.billed_hours ?? 0) || 0);
    return Math.round(billedHours * 3600);
  }, [job]);

  const hourlyWorkDisplaySeconds = useMemo(() => {
    if (!job) return 0;
    const timerSeconds = officeTimerDisplaySeconds ?? (Number(job.timer_elapsed_seconds ?? 0) || 0);
    if (job.job_type !== "hourly") return timerSeconds;
    return Math.max(timerSeconds, hourlyBilledSeconds);
  }, [job, officeTimerDisplaySeconds, hourlyBilledSeconds]);

  const hourlyAutoBilling = useMemo(() => {
    if (!job || job.job_type !== "hourly") return null;
    const { clientRate, partnerRate } = resolveJobHourlyRates(job);
    const billedH = Number(job.billed_hours ?? 0);
    const approvedStage =
      job.internal_invoice_approved ||
      job.status === "awaiting_payment" ||
      job.status === "completed";
    const elapsedSeconds =
      billedH > 0 && approvedStage
        ? Math.round(billedH * 3600)
        : officeTimerDisplaySeconds ?? (Number(job.timer_elapsed_seconds ?? 0) || 0);
    const totals = computeHourlyTotals({
      elapsedSeconds,
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
    return {
      ...totals,
      clientRate,
      partnerRate,
      customerFinalPayment: totals.clientTotal - Number(job.customer_deposit ?? 0),
    };
  }, [job, officeTimerDisplaySeconds]);

  useEffect(() => {
    if (!job || job.job_type !== "hourly") {
      setHourlyTimeEditOpen(false);
      return;
    }
    const secs = hourlyWorkDisplaySeconds;
    const totalMins = Math.floor(Math.max(0, secs) / 60);
    setHourlyEditHours(String(Math.floor(totalMins / 60)));
    setHourlyEditMinutes(String(totalMins % 60));
  }, [job?.id, job?.job_type, hourlyWorkDisplaySeconds]);

  const openWorkTimeEditor = useCallback(() => {
    if (!job) return;
    const secs =
      job.job_type === "hourly"
        ? hourlyWorkDisplaySeconds
        : officeTimerDisplaySeconds ?? (Number(job.timer_elapsed_seconds ?? 0) || 0);
    const totalMins = Math.floor(Math.max(0, secs) / 60);
    setHourlyEditHours(String(Math.floor(totalMins / 60)));
    setHourlyEditMinutes(String(totalMins % 60));
    setHourlyTimeEditOpen(true);
  }, [job, hourlyWorkDisplaySeconds, officeTimerDisplaySeconds]);

  const canEditWorkTime =
    job?.job_type === "hourly" ||
    Number(job?.timer_elapsed_seconds ?? 0) > 0 ||
    officeTimerDisplaySeconds != null ||
    Boolean(job?.timer_is_running);

  useEffect(() => {
    if (!job || job.job_type !== "fixed") {
      setFixedRatesInlineOpen(false);
      return;
    }
    setFixedInlineClientRate(String(Math.max(0, Number(job.client_price ?? 0))));
    setFixedInlinePartnerCost(String(Math.max(0, Number(job.partner_cost ?? 0))));
  }, [job?.id, job?.job_type, job?.client_price, job?.partner_cost]);

  const isHousekeepJobDetail = useMemo(() => {
    if (!job) return false;
    const v = (job.title ?? "").trim().toLowerCase();
    return v.includes("housekeep") || v.includes("house keep");
  }, [job]);

  /** Active recurring series member — finish date must not precede start date. */
  const isRecurringSeriesJob = useMemo(
    () => Boolean(job?.recurrence_series_id && !job?.recurrence_detached_at),
    [job?.recurrence_series_id, job?.recurrence_detached_at],
  );

  /** One-off jobs: preset arrival slots (create-job modals); no expected-finish field. */
  const isOneOffScheduleUi = useMemo(() => {
    if (isRecurringSeriesJob) return false;
    return (job?.job_kind ?? "one_off") === "one_off";
  }, [isRecurringSeriesJob, job?.job_kind]);

  const jobScheduleKindLabel = useMemo(() => {
    if (isRecurringSeriesJob) return "Recurring";
    const kind = job?.job_kind ?? "one_off";
    if (kind === "recurring") return "Recurring";
    if (kind === "multi_day") return "Multi-day";
    return "One-off";
  }, [isRecurringSeriesJob, job?.job_kind]);

  const scheduleStartDisplayYmd =
    scheduleDate.trim() || job?.scheduled_date?.slice(0, 10) || "";
  const scheduleFinishDisplayYmd = useMemo(() => {
    if (isOneOffScheduleUi) return scheduleStartDisplayYmd;
    return (
      scheduleExpectedFinishDate.trim() ||
      job?.scheduled_finish_date?.slice(0, 10) ||
      scheduleStartDisplayYmd ||
      ""
    );
  }, [
    isOneOffScheduleUi,
    scheduleStartDisplayYmd,
    scheduleExpectedFinishDate,
    job?.scheduled_finish_date,
  ]);

  const canOpenQuickReschedule =
    job != null && job.status !== "cancelled" && job.status !== "deleted";

  const cczEligibleAddress = useMemo(
    () => Boolean(job) && !isHousekeepJobDetail && isLikelyCczAddress(job!.property_address),
    [job, isHousekeepJobDetail],
  );

  const effectiveCustomerInCcz = useMemo(
    () => effectiveInCczForAddress(job?.in_ccz, job?.property_address),
    [job?.in_ccz, job?.property_address],
  );

  const loadPayments = useCallback(async (jobId: string) => {
    setLoadingPayments(true);
    try {
      // Single query for all payment types — split client-side to halve round-trips.
      const all = await listJobPayments(jobId);
      setPartnerPayments(all.filter((p) => p.type === "partner"));
      setCustomerPayments(all.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"));
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  const loadExtraHistory = useCallback(async (jobId: string) => {
    try {
      const rows = await listJobExtraEntries(jobId);
      if (rows.length === 0 && isJobExtraEntriesTableUnavailable()) return;
      setExtraHistory(extractExtraHistory(rows));
    } catch {
      setExtraHistory([]);
    }
  }, []);

  const loadJobInvoices = useCallback(async (j: Job) => {
    if (!j.reference?.trim()) {
      setJobInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    try {
      let rows = await listInvoicesLinkedToJob(j.reference, j.invoice_id);
      if (rows.length === 0 && !j.invoice_id && !autoInvoiceEnsureRef.current.has(j.id)) {
        autoInvoiceEnsureRef.current.add(j.id);
        const amount = Math.max(0, jobBillableRevenue(j));
        if (amount > 0.01) {
          try {
            const inv = await createOrAppendJobInvoice(j, {
              client_name: j.client_name ?? "Client",
              amount,
              status: "draft",
              invoice_kind: "final",
            });
            const updated = await updateJob(j.id, { invoice_id: inv.id });
            setJob(updated);
            rows = await listInvoicesLinkedToJob(updated.reference, updated.invoice_id);
          } catch {
            // Non-blocking fallback: user can still link manually from Job card.
          }
        }
      }
      setJobInvoices(rows);
    } catch {
      toast.error("Failed to load invoices");
      setJobInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const loadJobSelfBill = useCallback(async (j: Job) => {
    if (!j.self_bill_id?.trim()) {
      setJobSelfBill(null);
      return;
    }
    setLoadingSelfBill(true);
    try {
      const sb = await getSelfBill(j.self_bill_id);
      setJobSelfBill(sb);
    } catch {
      toast.error("Failed to load self-bill");
      setJobSelfBill(null);
    } finally {
      setLoadingSelfBill(false);
    }
  }, []);

  const createDocumentAsDraft = useCallback(async (
    type: "invoice" | "selfbill",
    j: Job,
    opts?: { amount?: number; financeAnchorDate?: Date; dueDate?: string; selfBillIdHint?: string | null },
  ): Promise<string | null> => {
    if (type === "invoice") {
      if (j.invoice_id) return j.invoice_id;
      const amount = Math.max(0, Number(opts?.amount ?? 0));
      const inv = await createOrAppendJobInvoice(
        j,
        {
          client_name: j.client_name ?? "Client",
          amount,
          status: "draft",
          invoice_kind: "combined",
          collection_stage: "awaiting_final",
        },
        { financeAnchorDate: opts?.financeAnchorDate },
      );
      return inv.id;
    }
    if (opts?.selfBillIdHint) return opts.selfBillIdHint;
    if (j.self_bill_id) return j.self_bill_id;
    if (!j.partner_id?.trim()) return null;
    const selfBill = await createSelfBillFromJob(
      {
        id: j.id,
        reference: j.reference,
        partner_name: j.partner_name ?? "Unassigned",
        partner_cost: j.partner_cost,
        materials_cost: j.materials_cost,
      },
      { weekAnchorDate: opts?.financeAnchorDate },
    );
    return selfBill.id;
  }, []);

  const finalizeDocument = useCallback(async (
    type: "invoice" | "selfbill",
    documentId: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    if (type === "invoice") {
      await updateInvoice(documentId, payload as Partial<Invoice>);
      return;
    }
    if (typeof payload.status === "string") {
      await updateSelfBillStatus(documentId, payload.status as SelfBill["status"]);
    }
  }, []);

  const loadQuoteLineItems = useCallback(async (j: Job) => {
    if (!j.quote_id) {
      setQuoteLineItems([]);
      return;
    }
    try {
      const rows = await listQuoteLineItems(j.quote_id);
      setQuoteLineItems(rows);
    } catch {
      setQuoteLineItems([]);
    }
  }, []);

  const [refreshingJob, setRefreshingJob] = useState(false);
  const refreshJobFinance = useCallback(async () => {
    if (!id) return;
    setRefreshingJob(true);
    try {
      const j = await getJob(id);
      setJob(j);
      if (j) {
        await Promise.all([
          loadPayments(j.id),
          loadJobInvoices(j),
          loadQuoteLineItems(j),
          loadJobSelfBill(j),
          loadExtraHistory(j.id),
        ]);
      }
    } catch {
      toast.error("Failed to refresh");
    } finally {
      setRefreshingJob(false);
    }
  }, [id, loadPayments, loadJobInvoices, loadQuoteLineItems, loadJobSelfBill, loadExtraHistory]);

  const quoteLineBreakdown = useMemo(() => {
    if (!quoteLineItems.length) return null;
    const classify = (desc: string): "labour" | "materials" | "other" => {
      const d = desc.toLowerCase();
      if (/(labou?r|call.?out|install|fitting|hour|engineer|technician)/.test(d)) return "labour";
      if (/(material|part|supply|consumable|component)/.test(d)) return "materials";
      return "other";
    };
    const totals = { labour: 0, materials: 0, other: 0 };
    const lines = quoteLineItems.map((li) => {
      const qty = Number(li.quantity ?? 0);
      const unit = Number(li.unit_price ?? 0);
      const total = Math.round((Number(li.total ?? (qty * unit)) || 0) * 100) / 100;
      const kind = classify(li.description ?? "");
      totals[kind] += total;
      return { id: li.id, description: li.description, total, kind };
    });
    return { lines, totals };
  }, [quoteLineItems]);

  const handleStripeInvoiceSync = useCallback(
    async (inv: Invoice) => {
      if (!inv.stripe_payment_link_id) {
        toast.error("This invoice has no Stripe payment link yet — open it in Invoices to create one.");
        return;
      }
      setSyncingInvoiceId(inv.id);
      try {
        const res = await fetch("/api/stripe/check-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: inv.id, paymentLinkId: inv.stripe_payment_link_id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        if (data.paymentStatus === "paid") {
          toast.success("Stripe payment confirmed — job deposit/final flags and payment lines updated.");
        } else {
          toast.info(`Stripe: ${data.paymentStatus ?? "unchanged"}`);
        }
        await refreshJobFinance();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncingInvoiceId(null);
      }
    },
    [refreshJobFinance]
  );

  useEffect(() => {
    if (!id) return;

    // Server shell already hydrated state from the bundle — skip exactly once.
    if (skipFirstFetchRef.current) {
      skipFirstFetchRef.current = false;
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Fast path: one RPC returns job + payments + invoice + self_bill
        // + line_items + reports + audit. Falls back to the legacy parallel
        // fetch if the RPC is missing.
        const bundle = await getJobDetailBundle(id);

        if (cancelled) return;

        if (bundle?.job) {
          setJob(bundle.job);
          const allPayments = (bundle.payments ?? []) as Array<{ type?: string }>;
          setPartnerPayments(
            allPayments.filter((p) => p.type === "partner") as JobPayment[],
          );
          setCustomerPayments(
            allPayments.filter(
              (p) => p.type === "customer_deposit" || p.type === "customer_final",
            ) as JobPayment[],
          );
        } else {
          // Legacy fallback
          const [j, allPayments] = await Promise.all([
            getJob(id),
            listJobPayments(id),
          ]);
          if (cancelled) return;
          setJob(j ?? null);
          setPartnerPayments(allPayments.filter((p) => p.type === "partner"));
          setCustomerPayments(
            allPayments.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"),
          );
        }
      } catch {
        if (!cancelled) toast.error("Failed to load job");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!job?.id) {
      setExtraHistory([]);
      return;
    }
    void loadExtraHistory(job.id);
  }, [job?.id, loadExtraHistory]);

  useEffect(() => {
    if (!job?.id) {
      setAppJobReports([]);
      return;
    }
    let cancelled = false;
    setLoadingAppJobReports(true);
    (async () => {
      try {
        const rows = await listAppJobReports(job.id);
        if (!cancelled) setAppJobReports(rows);
      } catch {
        if (!cancelled) setAppJobReports([]);
      } finally {
        if (!cancelled) setLoadingAppJobReports(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job?.id, job?.updated_at]);

  useEffect(() => {
    setExpandedInvoiceIds(new Set());
    setInvoiceDueDateDrafts({});
  }, [job?.id]);

  const saveInvoiceDueDate = useCallback(
    async (inv: Invoice, draftValue: string) => {
      if (!job) return;
      const trimmed = draftValue.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        toast.error("Enter a valid due date");
        return;
      }
      const prev = inv.due_date ? String(inv.due_date).slice(0, 10) : "";
      if (trimmed === prev) return;
      setSavingInvoiceDueDateId(inv.id);
      try {
        await updateInvoice(inv.id, { due_date: trimmed });
        setInvoiceDueDateDrafts((d) => {
          const next = { ...d };
          delete next[inv.id];
          return next;
        });
        await loadJobInvoices(job);
        toast.success("Due date updated");
      } catch {
        toast.error("Failed to update due date");
      } finally {
        setSavingInvoiceDueDateId(null);
      }
    },
    [job, loadJobInvoices],
  );

  useEffect(() => {
    if (!job?.reference?.trim()) {
      setJobInvoices([]);
      return;
    }
    void loadJobInvoices(job);
  }, [job?.id, job?.reference, job?.invoice_id, job?.updated_at, loadJobInvoices]);

  useEffect(() => {
    if (!job) {
      setJobSelfBill(null);
      return;
    }
    void loadJobSelfBill(job);
  }, [job?.id, job?.self_bill_id, job?.updated_at, loadJobSelfBill]);

  useEffect(() => {
    if (job?.scheduled_start_at) {
      const { ymd, hm } = utcIsoToUkWallClock(job.scheduled_start_at);
      setScheduleDate(ymd);
      let time = hm;
      let wm = "";
      if (job.scheduled_end_at) {
        const startMs = new Date(job.scheduled_start_at).getTime();
        const endMs = new Date(job.scheduled_end_at).getTime();
        wm = snapArrivalWindowMinutes(startMs, endMs);
      }
      const oneOffSlots =
        !(job.recurrence_series_id && !job.recurrence_detached_at) &&
        (job.job_kind ?? "one_off") === "one_off";
      if (oneOffSlots && time && wm) {
        const canon = canonicalArrivalSlotValues(time, wm);
        time = canon.from;
        wm = canon.mins;
      }
      setScheduleTime(time);
      setScheduleWindowMins(wm);
    } else if (job?.scheduled_date) {
      setScheduleDate(job.scheduled_date);
      const oneOff =
        !(job.recurrence_series_id && !job.recurrence_detached_at) &&
        (job.job_kind ?? "one_off") === "one_off";
      if (oneOff) {
        setScheduleTime("09:00");
        setScheduleWindowMins("180");
      } else {
        setScheduleTime("");
        setScheduleWindowMins("");
      }
    } else {
      setScheduleDate("");
      setScheduleTime("");
      setScheduleWindowMins("");
    }
    const oneOffFinish =
      !(job?.recurrence_series_id && !job?.recurrence_detached_at) &&
      (job?.job_kind ?? "one_off") === "one_off";
    setScheduleExpectedFinishDate(
      oneOffFinish
        ? ""
        : job?.scheduled_finish_date?.slice(0, 10) ?? job?.scheduled_date?.slice(0, 10) ?? "",
    );
  }, [
    job?.id,
    job?.job_kind,
    job?.recurrence_series_id,
    job?.recurrence_detached_at,
    job?.scheduled_start_at,
    job?.scheduled_end_at,
    job?.scheduled_date,
    job?.scheduled_finish_date,
  ]);

  useEffect(() => {
    if (!job) {
      setPropertyEdit(null);
      setUnlinkedAddressDraft("");
      return;
    }
    if (job.client_id) {
      setPropertyEdit({
        client_id: job.client_id,
        client_address_id: job.client_address_id,
        client_name: job.client_name,
        client_email: undefined,
        property_address: job.property_address,
      });
      setUnlinkedAddressDraft("");
    } else {
      setPropertyEdit(null);
      setUnlinkedAddressDraft(job.property_address ?? "");
    }
  }, [job?.id, job?.client_id, job?.client_address_id, job?.client_name, job?.property_address]);

  useEffect(() => {
    let cancelled = false;
    const cid = job?.client_id?.trim();
    if (!cid) {
      setJobHeaderAccount(null);
      setJobHeaderContact(null);
      return;
    }
    void (async () => {
      try {
        const c = await getClient(cid);
        if (cancelled) return;
        if (!c) {
          setJobHeaderAccount(null);
          setJobHeaderContact(null);
          return;
        }
        const phone = c.phone?.trim() || "";
        const email = c.email?.trim() || "";
        setJobHeaderContact(phone || email ? { phone: phone || undefined, email: email || undefined } : null);
        const sid = c.source_account_id?.trim();
        if (!sid) {
          setJobHeaderAccount(null);
          return;
        }
        const acc = await getAccount(sid);
        if (cancelled || !acc) {
          if (!cancelled) setJobHeaderAccount(null);
          return;
        }
        const label = (acc.company_name?.trim() || acc.contact_name?.trim() || "").trim();
        const logoUrl = acc.logo_url?.trim() || null;
        if (!cancelled) {
          setJobHeaderAccount(label || logoUrl ? { label: label || "—", logoUrl } : null);
        }
      } catch {
        if (!cancelled) {
          setJobHeaderAccount(null);
          setJobHeaderContact(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job?.client_id, job?.updated_at]);

  useEffect(() => {
    if (!isAdmin) return;
    listAssignableUsers().then(setAssignableUsers).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!partnerModalOpen) return;
    setLoadingPartners(true);
    listPartners({ pageSize: 200, status: "all" })
      .then((r) => setPartners(r.data ?? []))
      .catch(() => {
        setPartners([]);
        toast.error("Failed to load partners");
      })
      .finally(() => setLoadingPartners(false));
    if (catalogServicesJobType.length === 0) {
      setLoadingJobTypeCatalog(true);
      listCatalogServicesForPicker()
        .then(setCatalogServicesJobType)
        .catch(() => {
          setCatalogServicesJobType([]);
        })
        .finally(() => setLoadingJobTypeCatalog(false));
    }
  }, [partnerModalOpen]);

  useEffect(() => {
    if (!quickRescheduleOpen) return;
    setLoadingPartners(true);
    listPartners({ pageSize: 200, status: "all" })
      .then((r) => setPartners(r.data ?? []))
      .catch(() => {
        setPartners([]);
        toast.error("Failed to load partners");
      })
      .finally(() => setLoadingPartners(false));
    if (catalogServicesJobType.length === 0) {
      setLoadingJobTypeCatalog(true);
      listCatalogServicesForPicker()
        .then(setCatalogServicesJobType)
        .catch(() => {
          setCatalogServicesJobType([]);
          toast.error("Failed to load services catalog");
        })
        .finally(() => setLoadingJobTypeCatalog(false));
    }
  }, [quickRescheduleOpen]);

  useEffect(() => {
    if (!jobTypeEditOpen) return;
    setLoadingJobTypeCatalog(true);
    listCatalogServicesForPicker()
      .then(setCatalogServicesJobType)
      .catch(() => {
        setCatalogServicesJobType([]);
        toast.error("Failed to load services catalog");
      })
      .finally(() => setLoadingJobTypeCatalog(false));
  }, [jobTypeEditOpen]);

  useEffect(() => {
    if (!job) return;
    setSelectedPartnerId(job.partner_id ?? "");
  }, [job?.id, job?.partner_id]);

  useEffect(() => {
    if (!partnerModalOpen || !job) return;
    setPartnerAssignRateType(job.job_type === "hourly" ? "hourly" : "fixed");
    setPartnerAssignServiceId(job.catalog_service_id ?? "");
    const existingPartnerExtras = Math.max(0, Number(job.partner_extras_amount ?? 0));
    const existingMaterials = Math.max(0, Number(job.materials_cost ?? 0));
    setPartnerAssignFixedCost(
      String(Math.max(0, Number(job.partner_cost ?? 0) - existingPartnerExtras)),
    );
    if (job.job_type === "hourly") {
      setPartnerAssignBilledHours(String(Math.max(0.5, Number(job.billed_hours) || 1)));
      setPartnerAssignClientHourlyRate(String(Math.max(0, Number(job.hourly_client_rate) || 0)));
      setPartnerAssignPartnerHourlyRate(String(Math.max(0, Number(job.hourly_partner_rate) || 0)));
    } else {
      setPartnerAssignBilledHours("1");
      setPartnerAssignClientHourlyRate("");
      setPartnerAssignPartnerHourlyRate("");
    }
    const cczDefault = job.in_ccz && accessFees.cczFeeGbp > 0 ? String(accessFees.cczFeeGbp) : "";
    const parkingDefault = job.has_free_parking === false && accessFees.parkingFeeGbp > 0 ? String(accessFees.parkingFeeGbp) : "";
    setPartnerAssignExtraInputs({
      extra: existingPartnerExtras > 0 ? String(existingPartnerExtras) : "",
      ccz: cczDefault,
      parking: parkingDefault,
      materials: existingMaterials > 0 ? String(existingMaterials) : "",
    });
  }, [
    partnerModalOpen,
    job?.id,
    job?.job_type,
    job?.catalog_service_id,
    job?.billed_hours,
    job?.hourly_client_rate,
    job?.hourly_partner_rate,
    job?.partner_cost,
    job?.partner_extras_amount,
    job?.materials_cost,
    job?.in_ccz,
    job?.has_free_parking,
    accessFees.cczFeeGbp,
    accessFees.parkingFeeGbp,
  ]);

  useEffect(() => {
    if (!partnerPickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (partnerPickerRef.current && !partnerPickerRef.current.contains(e.target as Node)) {
        setPartnerPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [partnerPickerOpen]);

  useEffect(() => {
    if (!partnerModalOpen) setPartnerPickerSearch("");
  }, [partnerModalOpen]);

  useEffect(() => {
    if (!partnerPickerOpen) return;
    queueMicrotask(() => partnerPickerSearchInputRef.current?.focus());
  }, [partnerPickerOpen]);

  const partnersFilteredForPicker = useMemo(() => {
    const jobTypeNormalized = (normalizeTypeOfWork(job?.title ?? "") || job?.title || "").trim().toLowerCase();
    const jobTypeTokens = jobTypeNormalized
      .split(/[\s/-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 4);
    const isMatchForJob = (p: Partner) => {
      if (!jobTypeNormalized) return false;
      const trade = (p.trade ?? "").toLowerCase();
      const tradesFlat = (p.trades ?? [])
        .filter((t): t is string => typeof t === "string")
        .join(" ")
        .toLowerCase();
      const haystack = `${trade} ${tradesFlat}`.trim();
      if (!haystack) return false;
      if (
        haystack.includes(jobTypeNormalized) ||
        jobTypeNormalized.includes(trade) ||
        (trade && trade.includes(jobTypeNormalized))
      ) {
        return true;
      }
      return jobTypeTokens.some((token) => haystack.includes(token));
    };
    const q = partnerPickerSearch.trim().toLowerCase();
    const eligible = partners.filter((p) => isPartnerEligibleForWork(p));
    const filtered = !q
      ? eligible
      : eligible.filter((p) => {
      const name = (p.company_name ?? p.contact_name ?? "").toLowerCase();
      const trade = (p.trade ?? "").toLowerCase();
      const loc = (p.location ?? "").toLowerCase();
      const tradesFlat = (p.trades ?? []).filter((t): t is string => typeof t === "string").join(" ").toLowerCase();
      return name.includes(q) || trade.includes(q) || loc.includes(q) || tradesFlat.includes(q);
    });
    return filtered
      .map((p) => ({ partner: p, matched: isMatchForJob(p) }))
      .sort((a, b) => {
        if (a.matched !== b.matched) return a.matched ? -1 : 1;
        const an = (a.partner.company_name ?? a.partner.contact_name ?? "").toLowerCase();
        const bn = (b.partner.company_name ?? b.partner.contact_name ?? "").toLowerCase();
        return an.localeCompare(bn);
      });
  }, [partners, partnerPickerSearch, job?.title]);

  const partnerAssignService = useMemo(
    () => catalogServicesJobType.find((s) => s.id === partnerAssignServiceId) ?? null,
    [catalogServicesJobType, partnerAssignServiceId],
  );
  const partnerAssignHourlyPreview = useMemo(() => {
    const billedHours = Math.max(0.5, Number(partnerAssignBilledHours) || 0);
    const clientRate = Math.max(0, Number(partnerAssignClientHourlyRate) || 0);
    const partnerRate = Math.max(0, Number(partnerAssignPartnerHourlyRate) || 0);
    if (clientRate <= 0 && partnerRate <= 0) return null;
    return {
      billedHours,
      clientTotal: Math.round(clientRate * billedHours * 100) / 100,
      partnerTotal: Math.round(partnerRate * billedHours * 100) / 100,
    };
  }, [partnerAssignBilledHours, partnerAssignClientHourlyRate, partnerAssignPartnerHourlyRate]);
  const partnerAssignExtraBreakdown = useMemo(() => {
    const toAmount = (v: string) => Math.round(Math.max(0, Number(v) || 0) * 100) / 100;
    return {
      extra: toAmount(partnerAssignExtraInputs.extra),
      ccz: toAmount(partnerAssignExtraInputs.ccz),
      parking: toAmount(partnerAssignExtraInputs.parking),
      materials: toAmount(partnerAssignExtraInputs.materials),
    };
  }, [partnerAssignExtraInputs]);
  const partnerAssignExtrasTotal = useMemo(
    () =>
      Math.round(
        (partnerAssignExtraBreakdown.extra +
          partnerAssignExtraBreakdown.ccz +
          partnerAssignExtraBreakdown.parking) *
          100,
      ) / 100,
    [partnerAssignExtraBreakdown],
  );
  const partnerAssignMaterialsTotal = useMemo(
    () => Math.round(partnerAssignExtraBreakdown.materials * 100) / 100,
    [partnerAssignExtraBreakdown],
  );
  const partnerAssignBaseCost = useMemo(() => {
    if (partnerAssignRateType === "hourly") {
      return Math.round(Math.max(0, Number(partnerAssignHourlyPreview?.partnerTotal ?? 0)) * 100) / 100;
    }
    return Math.round(Math.max(0, Number(partnerAssignFixedCost) || 0) * 100) / 100;
  }, [partnerAssignRateType, partnerAssignHourlyPreview, partnerAssignFixedCost]);
  const partnerAssignTotal = useMemo(
    () => Math.round((partnerAssignBaseCost + partnerAssignExtrasTotal + partnerAssignMaterialsTotal) * 100) / 100,
    [partnerAssignBaseCost, partnerAssignExtrasTotal, partnerAssignMaterialsTotal],
  );
  const partnerAssignCanConfirm =
    !!selectedPartnerId &&
    (partnerAssignRateType === "hourly"
      ? !!partnerAssignServiceId &&
        Math.max(0.5, Number(partnerAssignBilledHours) || 0) > 0 &&
        Math.max(0, Number(partnerAssignClientHourlyRate) || 0) > 0 &&
        Math.max(0, Number(partnerAssignPartnerHourlyRate) || 0) > 0
      : partnerAssignBaseCost > 0);

  useEffect(() => {
    if (!job) return;
    const r2 = (v: unknown) => String(Math.round(Number(v ?? 0) * 100) / 100);
    setFinForm({
      client_price: r2(job.client_price),
      extras_amount: r2(job.extras_amount),
      partner_cost: r2(job.partner_cost),
      materials_cost: r2(job.materials_cost),
      partner_agreed_value: r2(job.partner_agreed_value),
      customer_deposit: r2(job.customer_deposit),
      customer_final_payment: r2(job.customer_final_payment),
    });
  }, [job?.id, job?.updated_at]);

  useEffect(() => {
    if (!job) return;
    setScopeDraft(job.scope ?? "");
    setScopeEditing(false);
    setScopeExpanded(false);
  }, [job?.id, job?.scope]);

  const scopeReadText = (scopeDraft.trim() || job?.scope?.trim() || "").trim();
  const scopeIsLong = useMemo(() => scopeTextNeedsCollapse(scopeReadText), [scopeReadText]);
  useEffect(() => {
    if (!scopeIsLong) setScopeExpanded(false);
  }, [scopeIsLong]);

  useEffect(() => {
    if (!job?.id) {
      setPrevJobNavId(null);
      setNextJobNavId(null);
      return;
    }
    setPrevJobNavId(getAdjacentJobId(job.id, "prev"));
    setNextJobNavId(getAdjacentJobId(job.id, "next"));
  }, [job?.id]);

  const goToPreviousJob = useCallback(() => {
    if (!prevJobNavId) {
      toast.message("Open jobs from the Jobs list to jump to the previous one.");
      return;
    }
    router.push(`/jobs/${prevJobNavId}`);
  }, [prevJobNavId, router]);

  const goToNextJob = useCallback(() => {
    if (!nextJobNavId) {
      toast.message("Open jobs from the Jobs list to jump to the next one.");
      return;
    }
    router.push(`/jobs/${nextJobNavId}`);
  }, [nextJobNavId, router]);

  useEffect(() => {
    if (!job) return;
    setAdditionalNotesDraft(job.additional_notes ?? "");
    setAdditionalNotesEditing(false);
  }, [job?.id, job?.additional_notes]);

  useEffect(() => {
    if (!isAdmin && detailTab === 5) {
      setDetailTab(0);
    }
  }, [isAdmin, detailTab]);

  useEffect(() => {
    if (!JOB_DETAIL_MULTI_VISITS_UI_ENABLED && detailTab === 6) {
      setDetailTab(0);
    }
  }, [detailTab]);

  /** Jobs in Final checks default to the Reports tab (office usually opens the card to review reports). */
  useEffect(() => {
    if (!job?.id) return;
    if (detailTabInitialisedForJobRef.current === job.id) return;
    detailTabInitialisedForJobRef.current = job.id;
    if (job.status === "final_check") setDetailTab(3);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!job) return;
    setReportLinkDraft(job.report_link ?? "");
    setReportLinkEditing(false);
  }, [job?.id, job?.report_link]);

  const additionalNotesReadText = (additionalNotesDraft.trim() || job?.additional_notes?.trim() || "").trim();
  const reportLinkReadRaw = (reportLinkDraft.trim() || job?.report_link?.trim() || "").trim();
  const reportLinkReadHref = jobReportLinkHref(reportLinkReadRaw || null);

  const handleJobUpdate = useCallback(async (
    jobId: string,
    updates: Partial<Job>,
    opts?: { notifyPartner?: boolean; silent?: boolean; skipSelfBillSync?: boolean },
  ): Promise<Job | undefined> => {
    const current = jobRef.current;
    try {
      let payload: Partial<Job> = { ...updates };
      let didAutoFinalCheck = false;
      if (current && current.id === jobId) {
        const merged = { ...current, ...updates } as Job;
        const touchesMargin =
          updates.client_price !== undefined ||
          updates.partner_cost !== undefined ||
          updates.materials_cost !== undefined ||
          updates.extras_amount !== undefined;
        if (touchesMargin) {
          const derived = deriveStoredJobFinancials(merged);
          payload = { ...payload, ...derived };
        }
      }
      if (current && current.id === jobId && updates.partner_id != null && updates.partner_id !== "") {
        const mergedForGate = { ...current, ...payload } as Job;
        const block = getPartnerAssignmentBlockReason(mergedForGate);
        if (block) {
          toast.error(block);
          return undefined;
        }
      }
      if (current && current.id === jobId) {
        const mergedFull = { ...current, ...payload } as Job;
        if (shouldAutoAdvanceToFinalCheckAfterMerge(mergedFull, updates, current.status)) {
          didAutoFinalCheck = true;
          payload = {
            ...payload,
            status: "final_check",
            ...statusChangePartnerTimerPatch(mergedFull, "final_check"),
            ...statusChangeOfficeTimerPatch(mergedFull, "final_check"),
          };
        }
      }
      const updated = await updateJob(jobId, payload, { skipSelfBillSync: opts?.skipSelfBillSync });
      setJob(updated);
      if (didAutoFinalCheck) {
        toast.success("All reports validated — job moved to Final check.");
        await logAudit({
          entityType: "job",
          entityId: jobId,
          entityRef: updated.reference,
          action: "status_changed",
          fieldName: "status",
          oldValue: current?.status,
          newValue: "final_check",
          userId: profile?.id,
          userName: profile?.full_name,
        });
        if (updated.partner_id) {
          const statusLabel = statusConfig.final_check?.label ?? "Final check";
          notifyAssignedPartnerAboutJob({
            partnerId: updated.partner_id,
            job: updated,
            kind: "job_status_changed",
            statusLabel,
          });
          void notifyPartnerJobChange({
            jobId: updated.id,
            jobReference: updated.reference,
            kind: "status_changed",
            newStatusLabel: statusLabel,
            skipPush: true,
          });
        }
      } else if (!opts?.silent) {
        toast.success("Job updated");
      }

      const wantNotify =
        opts?.notifyPartner !== false &&
        !didAutoFinalCheck &&
        shouldNotifyPartnerForJobPatch(updates);
      if (wantNotify) {
        const prevPid = current?.id === jobId ? (current.partner_id ?? null) : null;
        const newPid = updated.partner_id ?? null;
        const partnerKeyTouched = updates.partner_id !== undefined;
        if (partnerKeyTouched && prevPid && prevPid !== newPid) {
          notifyAssignedPartnerAboutJob({ partnerId: prevPid, job: updated, kind: "job_unassigned" });
        }
        if (newPid) {
          const assignedFresh = Boolean(partnerKeyTouched && newPid !== prevPid);
          notifyAssignedPartnerAboutJob({
            partnerId: newPid,
            job: updated,
            kind: assignedFresh ? "job_assigned" : "job_updated",
          });
          // Zendesk side conversation: only on FRESH assignment to this partner.
          // No-op server-side when the job didn't come from Zendesk.
          if (assignedFresh) {
            void notifyPartnerJobChange({
              jobId,
              jobReference: updated.reference,
              kind: "assigned",
              skipPush: true, // notifyAssignedPartnerAboutJob already pushed
            });
          } else {
            // Detect a reschedule (date or time-window changed without
            // changing the partner). Send the rescheduled email + push.
            const SCHEDULE_KEYS = ["scheduled_date", "scheduled_start_at", "scheduled_end_at", "scheduled_finish_date"] as const;
            const scheduleTouched = SCHEDULE_KEYS.some((k) => k in updates);
            if (scheduleTouched) {
              void notifyPartnerJobChange({
                jobId,
                jobReference: updated.reference,
                kind: "rescheduled",
                oldDateLine: (current && formatJobScheduleLine(current)) || "Previously scheduled",
                oldTimeLine: null,
                newDateLine: formatJobScheduleLine(updated) || "New schedule",
                newTimeLine: null,
                skipPush: true, // notifyAssignedPartnerAboutJob already pushed
              });
            }
          }
        }
      }
      return updated;
    } catch {
      toast.error("Failed to update");
      return undefined;
    }
  }, [profile?.id, profile?.full_name]);

  const handleQuickUnassignPartner = useCallback(async () => {
    if (!job?.partner_id?.trim()) return;
    if (!JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED.includes(job.status)) {
      toast.error(
        "Can't remove the partner while the job is in this status. Use Assign → No partner when the job is Scheduled, Late, or Unassigned.",
      );
      setSelectedPartnerId("");
      setPartnerModalOpen(true);
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm("Remove this partner? The job will return to Unassigned.")
    ) {
      return;
    }
    setSigningOffPartner(true);
    try {
      const updated = await handleJobUpdate(
        job.id,
        { partner_id: null, partner_name: null, partner_ids: [] },
        { silent: true },
      );
      if (updated) {
        toast.success("Partner removed — job is Unassigned");
      }
    } finally {
      setSigningOffPartner(false);
    }
  }, [job?.id, job?.partner_id, job?.status, handleJobUpdate]);

  const openJobBillingTypeEdit = useCallback(() => {
    if (!job) return;
    setFixedRatesInlineOpen(false);
    setFixedInlineClientRate(String(Math.max(0, Number(job.client_price ?? 0))));
    setFixedInlinePartnerCost(String(Math.max(0, Number(job.partner_cost ?? 0))));
    setJobTypeEditTarget(job.job_type === "hourly" ? "hourly" : "fixed");
    setJobTypeEditCatalogId(job.catalog_service_id ?? "");
    setJobTypeEditFixedTitle(job.title ?? "");
    setJobAssignmentEditMode(job.status === "auto_assigning" ? "auto" : "manual");
    setJobTypeEditOpen(true);
  }, [job]);

  const jobAssignmentModePatch = useCallback(
    (
      current: Job,
      mode: "manual" | "auto",
    ): { patch: Partial<Job> & { auto_assign_invited_partner_ids?: string[] | null }; dispatchAutoAssign: boolean } | null => {
      if (jobHasPartnerSet(current)) return null;
      if (mode === "auto") {
        if (current.status === "auto_assigning") return { patch: {}, dispatchAutoAssign: false };
        return { patch: { status: "auto_assigning" }, dispatchAutoAssign: true };
      }
      if (current.status === "auto_assigning") {
        return { patch: { status: "unassigned", auto_assign_invited_partner_ids: null }, dispatchAutoAssign: false };
      }
      return null;
    },
    [],
  );

  const handleSaveJobTypeEdit = useCallback(async () => {
    if (!job) return;
    const extras = Number(job.extras_amount ?? 0);
    const deposit = Number(job.customer_deposit ?? 0);
    const prev = job;
    const assignmentChange = jobAssignmentModePatch(job, jobAssignmentEditMode);

    if (jobTypeEditTarget === "hourly") {
      const service = catalogServicesJobType.find((c) => c.id === jobTypeEditCatalogId);
      if (!jobTypeEditCatalogId || !service) {
        toast.error("Select a Call Out type from Services.");
        return;
      }
      const hrs = Math.max(1, Number(service.default_hours) || 1);
      const clientRate = Number(service.hourly_rate) || 0;
      const partnerRate = partnerHourlyRateFromCatalogBundle(service.partner_cost, service.default_hours);
      const totals = computeHourlyTotals({
        elapsedSeconds: hrs * 3600,
        clientHourlyRate: clientRate,
        partnerHourlyRate: partnerRate,
      });
      const customer_final_payment =
        Math.round(Math.max(0, totals.clientTotal + extras - deposit) * 100) / 100;
      const titleOut = normalizeTypeOfWork(service.name) || service.name;
      const patch: Partial<Job> = {
        job_type: "hourly",
        catalog_service_id: jobTypeEditCatalogId,
        hourly_client_rate: clientRate,
        hourly_partner_rate: partnerRate,
        billed_hours: totals.billedHours,
        client_price: totals.clientTotal,
        partner_cost: totals.partnerTotal,
        title: titleOut,
        customer_final_payment,
      };
      if (assignmentChange) Object.assign(patch, assignmentChange.patch);
      setSavingJobTypeEdit(true);
      try {
        const updated = await handleJobUpdate(job.id, patch, { silent: true });
        await logFieldChanges(
          "job",
          prev.id,
          prev.reference,
          prev as unknown as Record<string, unknown>,
          patch as Record<string, unknown>,
          profile?.id,
          profile?.full_name,
        );
        if (updated) {
          await bumpLinkedInvoiceAmountsToJobSchedule(updated);
          await syncSelfBillAfterJobChange(updated);
          try {
            await reconcileJobCustomerPaymentFlags(getSupabase(), updated.id);
          } catch {
            /* non-blocking */
          }
          await refreshJobFinance();
          if (assignmentChange?.dispatchAutoAssign) {
            try {
              const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/dispatch-auto-assign-invites`, {
                method: "POST",
              });
              if (res.ok) {
                toast.success("Auto assign — matched partners invited");
              } else {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                toast.error(body?.error ?? "Could not send auto assign invites");
              }
            } catch {
              toast.error("Could not send auto assign invites");
            }
          } else if (assignmentChange?.patch.status === "unassigned" && prev.status === "auto_assigning") {
            toast.success("Switched to manual assign");
          }
          setJobTypeEditOpen(false);
          toast.success("Job is now hourly — amounts and invoice updated.");
          toast.success(`Rates updated to ${titleOut} pricing`, { duration: 3000 });
        }
      } finally {
        setSavingJobTypeEdit(false);
      }
      return;
    }

    const titleTrim = jobTypeEditFixedTitle.trim();
    if (!titleTrim) {
      toast.error("Select type of work.");
      return;
    }
    const titleOut = normalizeTypeOfWork(titleTrim) || titleTrim;
    const clientPriceConfirmed = Math.max(0, Math.round((Number(fixedInlineClientRate) || 0) * 100) / 100);
    const partnerCostConfirmed = Math.max(0, Math.round((Number(fixedInlinePartnerCost) || 0) * 100) / 100);
    const matchedService = catalogServicesJobType.find((s) => {
      const a = (normalizeTypeOfWork(s.name) || s.name || "").trim().toLowerCase();
      const b = titleOut.trim().toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    const defaultHours = Math.max(1, Number(matchedService?.default_hours) || 1);
    const clientRate = Number(matchedService?.hourly_rate ?? 0) || 0;
    const partnerRate = matchedService
      ? partnerHourlyRateFromCatalogBundle(matchedService.partner_cost, matchedService.default_hours)
      : 0;
    const matchedTotals = matchedService
      ? computeHourlyTotals({
          elapsedSeconds: defaultHours * 3600,
          clientHourlyRate: clientRate,
          partnerHourlyRate: partnerRate,
        })
      : null;
    const patch: Partial<Job> = {
      job_type: "fixed",
      catalog_service_id: matchedService?.id ?? null,
      hourly_client_rate: matchedService ? clientRate : null,
      hourly_partner_rate: matchedService ? partnerRate : null,
      billed_hours: null,
      title: titleOut,
      client_price: clientPriceConfirmed > 0 ? clientPriceConfirmed : matchedTotals?.clientTotal ?? Number(job.client_price ?? 0),
      partner_cost: partnerCostConfirmed > 0 ? partnerCostConfirmed : matchedTotals?.partnerTotal ?? Number(job.partner_cost ?? 0),
      customer_final_payment: Math.round(
        Math.max(
          0,
          (clientPriceConfirmed > 0 ? clientPriceConfirmed : matchedTotals?.clientTotal ?? Number(job.client_price ?? 0)) +
            Number(job.extras_amount ?? 0) -
            Number(job.customer_deposit ?? 0),
        ) * 100,
      ) / 100,
    };
    if (assignmentChange) Object.assign(patch, assignmentChange.patch);
    setSavingJobTypeEdit(true);
    try {
      const updated = await handleJobUpdate(job.id, patch, { silent: true });
      await logFieldChanges(
        "job",
        prev.id,
        prev.reference,
        prev as unknown as Record<string, unknown>,
        patch as Record<string, unknown>,
        profile?.id,
        profile?.full_name,
      );
      if (updated) {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        await syncSelfBillAfterJobChange(updated);
        try {
          await reconcileJobCustomerPaymentFlags(getSupabase(), updated.id);
        } catch {
          /* non-blocking */
        }
        await refreshJobFinance();
        if (assignmentChange?.dispatchAutoAssign) {
          try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/dispatch-auto-assign-invites`, {
              method: "POST",
            });
            if (res.ok) {
              toast.success("Auto assign — matched partners invited");
            } else {
              const body = (await res.json().catch(() => null)) as { error?: string } | null;
              toast.error(body?.error ?? "Could not send auto assign invites");
            }
          } catch {
            toast.error("Could not send auto assign invites");
          }
        } else if (assignmentChange?.patch.status === "unassigned" && prev.status === "auto_assigning") {
          toast.success("Switched to manual assign");
        }
        setJobTypeEditOpen(false);
        toast.success("Job is now fixed price.");
        if (matchedService) {
          toast.success(`Rates updated to ${titleOut} pricing`, { duration: 3000 });
        }
      }
    } finally {
      setSavingJobTypeEdit(false);
    }
  }, [
    job,
    jobTypeEditTarget,
    jobTypeEditCatalogId,
    jobTypeEditFixedTitle,
    fixedInlineClientRate,
    fixedInlinePartnerCost,
    catalogServicesJobType,
    jobAssignmentEditMode,
    jobAssignmentModePatch,
    handleJobUpdate,
    profile?.id,
    profile?.full_name,
    refreshJobFinance,
  ]);

  const handleSaveHourlyTimeEdit = useCallback(async () => {
    if (!job) return;
    const hours = Math.max(0, Math.floor(Number(hourlyEditHours) || 0));
    const minsRaw = Math.max(0, Math.floor(Number(hourlyEditMinutes) || 0));
    const mins = Math.min(59, minsRaw);
    const elapsedSeconds = Math.max(0, hours * 3600 + mins * 60);
    let patch: Partial<Job>;
    let billedHoursForApproval: number | null = null;
    if (job.job_type === "hourly") {
      const { clientRate, partnerRate } = resolveJobHourlyRates(job);
      const totals = computeHourlyTotals({
        elapsedSeconds,
        clientHourlyRate: clientRate,
        partnerHourlyRate: partnerRate,
      });
      billedHoursForApproval = totals.billedHours;
      patch = {
        timer_elapsed_seconds: elapsedSeconds,
        timer_last_started_at: job.timer_is_running ? new Date().toISOString() : job.timer_last_started_at,
        billed_hours: totals.billedHours,
        client_price: totals.clientTotal,
        partner_cost: totals.partnerTotal,
        customer_final_payment: Math.round(
          Math.max(0, totals.clientTotal + Number(job.extras_amount ?? 0) - Number(job.customer_deposit ?? 0)) * 100,
        ) / 100,
      };
    } else {
      patch = {
        timer_elapsed_seconds: elapsedSeconds,
        timer_last_started_at: job.timer_is_running ? new Date().toISOString() : job.timer_last_started_at,
      };
    }
    setSavingHourlyTimeEdit(true);
    try {
      const updated = await handleJobUpdate(job.id, patch, { silent: true });
      if (updated) {
        if (job.job_type === "hourly") {
          await bumpLinkedInvoiceAmountsToJobSchedule(updated);
          await syncSelfBillAfterJobChange(updated);
        }
        await refreshJobFinance();
        if (billedHoursForApproval != null) {
          setApprovalBilledHoursInput(String(billedHoursForApproval));
        }
        setHourlyTimeEditOpen(false);
        toast.success(job.job_type === "hourly" ? "Work time and pricing updated" : "Recorded time updated");
      }
    } finally {
      setSavingHourlyTimeEdit(false);
    }
  }, [job, hourlyEditHours, hourlyEditMinutes, handleJobUpdate, refreshJobFinance]);

  const handleSaveFixedInlineRates = useCallback(async () => {
    if (!job || job.job_type !== "fixed") return;
    const clientPrice = Math.max(0, Math.round((Number(fixedInlineClientRate) || 0) * 100) / 100);
    const partnerCost = Math.max(0, Math.round((Number(fixedInlinePartnerCost) || 0) * 100) / 100);
    const patch: Partial<Job> = {
      client_price: clientPrice,
      partner_cost: partnerCost,
      customer_final_payment: Math.round(
        Math.max(0, clientPrice + Number(job.extras_amount ?? 0) - Number(job.customer_deposit ?? 0)) * 100,
      ) / 100,
    };
    setSavingFixedInlineRates(true);
    try {
      const updated = await handleJobUpdate(job.id, patch, { silent: true });
      if (updated) {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        await syncSelfBillAfterJobChange(updated);
        await refreshJobFinance();
        setFixedRatesInlineOpen(false);
        toast.success("Fixed rates updated");
      }
    } finally {
      setSavingFixedInlineRates(false);
    }
  }, [job, fixedInlineClientRate, fixedInlinePartnerCost, handleJobUpdate, refreshJobFinance]);

  const saveAccessFeeFlags = useCallback(
    async (patch: Partial<Pick<Job, "in_ccz" | "has_free_parking">>) => {
      if (!job) return;
      setSavingAccessFees(true);
      try {
        const nextInCcz = patch.in_ccz !== undefined ? patch.in_ccz : job.in_ccz;
        const nextHasFreeParking = patch.has_free_parking !== undefined ? patch.has_free_parking : job.has_free_parking;
        const accessFin = patchJobFinancialsForAccessTransition(
          job,
          {
            in_ccz: nextInCcz,
            has_free_parking: nextHasFreeParking,
          },
          accessFees,
        );
        const updated = await handleJobUpdate(job.id, {
          ...patch,
          extras_amount: accessFin.extras_amount,
          customer_final_payment: accessFin.customer_final_payment,
        });
        if (updated) {
          await bumpLinkedInvoiceAmountsToJobSchedule(updated);
          await syncSelfBillAfterJobChange(updated);
          try {
            await reconcileJobCustomerPaymentFlags(getSupabase(), job.id);
          } catch {
            /* non-blocking */
          }
          await refreshJobFinance();
        }
      } finally {
        setSavingAccessFees(false);
      }
    },
    [job, handleJobUpdate, refreshJobFinance, accessFees],
  );

  const reportByPhase = useMemo(() => {
    const map = new Map<number, AppJobReportRow>();
    for (const row of appJobReports) {
      const prev = map.get(row.phase);
      const rowTs = new Date(row.uploaded_at ?? row.created_at ?? 0).getTime();
      const prevTs = prev ? new Date(prev.uploaded_at ?? prev.created_at ?? 0).getTime() : -1;
      if (!prev || rowTs >= prevTs) map.set(row.phase, row);
    }
    return map;
  }, [appJobReports]);

  const internalNotesEntries = useMemo<InternalJobNote[]>(() => {
    const raw = (job?.internal_notes ?? "").trim();
    if (!raw) return [];
    return raw
      .split("\n\n")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const m = chunk.match(/^\[([^\]]+)\]\s+(.+?):\s*([\s\S]+)$/);
        if (m) {
          return {
            iso: m[1].trim(),
            author: m[2].trim(),
            text: m[3].trim(),
          };
        }
        return {
          iso: "",
          author: "Team",
          text: chunk,
        };
      })
      .reverse();
  }, [job?.internal_notes]);

  const openPartnerReportPdf = useCallback(async (row: AppJobReportRow) => {
    if (!row.pdf_url?.trim()) {
      toast.error("This report has no PDF.");
      return;
    }
    setOpeningReportId(row.id);
    try {
      const signed = await createSignedJobReportPdfUrl(row.pdf_url, 60 * 60);
      if (!signed) {
        toast.error("Could not sign PDF URL.");
        return;
      }
      window.open(signed, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningReportId(null);
    }
  }, []);

  const openPartnerReportImage = useCallback(async (rawUrl: string, key: string) => {
    setOpeningReportImageKey(key);
    try {
      const signed = await createSignedJobReportAssetUrl(rawUrl, 60 * 60);
      if (!signed) {
        toast.error("Could not sign image URL.");
        return;
      }
      window.open(signed, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningReportImageKey(null);
    }
  }, []);

  const handleSaveFinancials = useCallback(async () => {
    if (!job) return;
    setSavingFin(true);
    try {
      const r2 = (s: string) => Math.round((parseFloat(s) || 0) * 100) / 100;
      let client_price = r2(finForm.client_price);
      const extras_amount = r2(finForm.extras_amount);
      let partner_cost = r2(finForm.partner_cost);
      const materials_cost = r2(finForm.materials_cost);
      const partner_agreed_value = r2(finForm.partner_agreed_value);
      const customer_deposit = r2(finForm.customer_deposit);
      let customer_final_payment = r2(finForm.customer_final_payment);
      let billed_hours: number | undefined;
      if (job.job_type === "hourly") {
        const billedH = Number(job.billed_hours ?? 0);
        const approvedStage =
          job.internal_invoice_approved ||
          job.status === "awaiting_payment" ||
          job.status === "completed";
        const useBilledHoursSeconds = billedH > 0 && approvedStage;
        const { clientRate, partnerRate } = resolveJobHourlyRates(job);
        if (useBilledHoursSeconds) {
          const elapsedSeconds = Math.round(billedH * 3600);
          const totals = computeHourlyTotals({
            elapsedSeconds,
            clientHourlyRate: clientRate,
            partnerHourlyRate: partnerRate,
          });
          client_price = totals.clientTotal;
          partner_cost = totals.partnerTotal;
          customer_final_payment = Math.round(Math.max(0, client_price + extras_amount - customer_deposit) * 100) / 100;
          billed_hours = totals.billedHours;
        } else if (approvedStage && !useBilledHoursSeconds) {
          // Post-approval: do not overwrite stored totals with the office timer (e.g. legacy DB without billed_hours).
          client_price = r2(finForm.client_price);
          partner_cost = r2(finForm.partner_cost);
          customer_final_payment = r2(finForm.customer_final_payment);
          billed_hours = billedH > 0 ? billedH : undefined;
        } else {
          const elapsedSeconds = computeOfficeTimerElapsedSeconds(job);
          const totals = computeHourlyTotals({
            elapsedSeconds,
            clientHourlyRate: clientRate,
            partnerHourlyRate: partnerRate,
          });
          client_price = totals.clientTotal;
          partner_cost = totals.partnerTotal;
          customer_final_payment = Math.round(Math.max(0, client_price + extras_amount - customer_deposit) * 100) / 100;
          billed_hours = totals.billedHours;
        }
      }
      const newFields = {
        client_price,
        extras_amount,
        partner_cost,
        materials_cost,
        partner_agreed_value,
        customer_deposit,
        customer_final_payment,
        ...(billed_hours != null ? { billed_hours } : {}),
      };
      const updated = await handleJobUpdate(job.id, newFields);
      await logFieldChanges(
        "job", job.id, job.reference,
        job as unknown as Record<string, unknown>,
        newFields as Record<string, unknown>,
        profile?.id, profile?.full_name,
      );
      if (updated) {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        try {
          await reconcileJobCustomerPaymentFlags(getSupabase(), updated.id);
        } catch {
          /* non-blocking */
        }
        await refreshJobFinance();
      }
    } finally {
      setSavingFin(false);
    }
  }, [job, finForm, handleJobUpdate, profile?.id, profile?.full_name, refreshJobFinance]);

  const handleSaveLinkedProperty = useCallback(async () => {
    if (!job || !propertyEdit?.property_address?.trim()) {
      toast.error("Property address is required");
      return;
    }
    if (!propertyEdit.client_id?.trim()) {
      toast.error("Select a client");
      return;
    }
    const trimmed = propertyEdit.property_address.trim();
    const mergedInCcz = effectiveInCczForAddress(job.in_ccz, trimmed);
    const accessFin = patchJobFinancialsForAccessTransition(
      job,
      {
        property_address: trimmed,
        in_ccz: mergedInCcz,
      },
      accessFees,
    );
    setSavingProperty(true);
    try {
      const updated = await handleJobUpdate(job.id, {
        client_id: propertyEdit.client_id,
        client_name: propertyEdit.client_name?.trim() || job.client_name,
        property_address: trimmed,
        client_address_id: propertyEdit.client_address_id,
        in_ccz: mergedInCcz,
        extras_amount: accessFin.extras_amount,
        customer_final_payment: accessFin.customer_final_payment,
      });
      if (updated) {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        try {
          await reconcileJobCustomerPaymentFlags(getSupabase(), job.id);
        } catch {
          /* non-blocking */
        }
        await refreshJobFinance();
      }
    } finally {
      setSavingProperty(false);
    }
  }, [job, propertyEdit, handleJobUpdate, refreshJobFinance, accessFees]);

  const handleSaveUnlinkedProperty = useCallback(async () => {
    if (!job || !unlinkedAddressDraft.trim()) {
      toast.error("Property address is required");
      return;
    }
    const trimmed = unlinkedAddressDraft.trim();
    const mergedInCcz = effectiveInCczForAddress(job.in_ccz, trimmed);
    const accessFin = patchJobFinancialsForAccessTransition(
      job,
      {
        property_address: trimmed,
        in_ccz: mergedInCcz,
      },
      accessFees,
    );
    setSavingUnlinkedAddress(true);
    try {
      const updated = await handleJobUpdate(job.id, {
        property_address: trimmed,
        in_ccz: mergedInCcz,
        extras_amount: accessFin.extras_amount,
        customer_final_payment: accessFin.customer_final_payment,
      });
      if (updated) {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        try {
          await reconcileJobCustomerPaymentFlags(getSupabase(), job.id);
        } catch {
          /* non-blocking */
        }
        await refreshJobFinance();
      }
    } finally {
      setSavingUnlinkedAddress(false);
    }
  }, [job, unlinkedAddressDraft, handleJobUpdate, refreshJobFinance, accessFees]);

  useEffect(() => {
    if (!resumeJobOpen || resumeAction !== "cancel") return;
    setCancelPresetId(officeCancellationPresets[0]?.id ?? OFFICE_JOB_CANCELLATION_REASONS[0].id);
    setCancelDetail("");
  }, [resumeJobOpen, resumeAction, officeCancellationPresets]);

  const handleConfirmOfficeCancel = useCallback(async (): Promise<boolean> => {
    if (!job) return false;
    setCancellingJob(true);
    try {
      const result = await cancelJob.submit({
        jobId: job.id,
        presetId: cancelPresetId,
        detail: cancelDetail,
        presets: officeCancellationPresets,
      });
      if (!result.ok) return false;
      setJob(result.updated);
      void refreshJobFinance();
      setCancelJobOpen(false);
      setCancelDetail("");
      return true;
    } finally {
      setCancellingJob(false);
    }
  }, [job, cancelJob, cancelPresetId, cancelDetail, officeCancellationPresets, refreshJobFinance]);

  const handleStatusChange = useCallback(
    async (j: Job, newStatus: Job["status"], opts?: { skipHourlyRecalc?: boolean; silent?: boolean; skipSelfBillSync?: boolean; extraPatch?: Partial<Job> }): Promise<Job | null> => {
    const forceCloseFromAwaitingPayment = j.status === "awaiting_payment" && newStatus === "completed";
    if (!forceCloseFromAwaitingPayment) {
      const check = canAdvanceJob(j, newStatus, {
        customerPayments: customerPayments.map((p) => ({ type: p.type, amount: p.amount })),
        partnerPayments: partnerPayments.map((p) => ({ type: p.type, amount: p.amount })),
      });
      if (!check.ok) {
        toast.error(check.message ?? "Complete the current step before advancing.");
        return null;
      }
    }
    try {
      let selfBillId: string | undefined = j.self_bill_id ?? undefined;
      if (newStatus === "awaiting_payment" && j.partner_id?.trim()) {
        const partnerPaid = sumPartnerRecordedPayoutsForCap(partnerPayments);
        const partnerDue = Math.max(0, partnerPaymentCap(j) - partnerPaid);
        let primarySelfBillId = j.self_bill_id ?? null;
        try {
          /** Skip the listSelfBillsLinkedToJob round-trip when the job already points at a self-bill —
           *  the list was only used to *find* a candidate when none was set. */
          if (!primarySelfBillId) {
            const linkedSelfBills = await listSelfBillsLinkedToJob(j.reference, primarySelfBillId);
            if (linkedSelfBills.length > 0) {
              const pick =
                linkedSelfBills.find((s) => s.status === "accumulating") ??
                linkedSelfBills.find((s) => s.status === "pending_review") ??
                linkedSelfBills[linkedSelfBills.length - 1];
              primarySelfBillId = pick.id;
            }
          }
          const shouldCreateSelfBill =
            partnerSelfBillGrossAmount(j) > 0 || partnerDue > 0.02;
          if (!primarySelfBillId && shouldCreateSelfBill) {
            const selfBill = await createSelfBillFromJob({
              id: j.id,
              reference: j.reference,
              partner_name: j.partner_name ?? "Unassigned",
              partner_cost: j.partner_cost,
              materials_cost: j.materials_cost,
            });
            primarySelfBillId = selfBill.id;
          }
          if (primarySelfBillId) selfBillId = primarySelfBillId;
        } catch (e) {
          console.error("Self-bill link failed", e);
          toast.warning(
            e instanceof Error ? e.message : "Could not link weekly self-bill; use Finance or Link on this job.",
          );
        }
      }
      const hourlyPatch: Partial<Job> = {};
      if (j.job_type === "hourly" && !opts?.skipHourlyRecalc) {
        const billedH = Number(j.billed_hours ?? 0);
        /**
         * Review & approve already persists client/partner totals from the modal. If `billed_hours` is missing
         * (e.g. legacy DB strip) or zero, the timer path below would overwrite approved amounts and desync
         * the Finance summary from the updated invoice — skip recalculation when totals are already on the row.
         */
        const shouldSkipHourlyRecalc =
          j.internal_invoice_approved &&
          billedH <= 0 &&
          (Number(j.client_price) > 0.02 || Number(j.partner_cost) > 0.02);

        if (!shouldSkipHourlyRecalc) {
          const { clientRate, partnerRate } = resolveJobHourlyRates(j);
          // After approval, `billed_hours` is the confirmed total — do not overwrite with raw timer seconds
          // (timer can disagree with "Final billed hours" in the modal and would desync job vs invoice).
          const useBilledHoursSeconds =
            billedH > 0 &&
            (j.internal_invoice_approved ||
              j.status === "awaiting_payment" ||
              j.status === "completed");
          const elapsedSeconds = useBilledHoursSeconds
            ? Math.round(billedH * 3600)
            : computeOfficeTimerElapsedSeconds(j);
          const totals = computeHourlyTotals({
            elapsedSeconds,
            clientHourlyRate: clientRate,
            partnerHourlyRate: partnerRate,
          });
          const customerDeposit = Number(j.customer_deposit ?? 0);
          const customerFinal = Math.max(
            0,
            totals.clientTotal + Number(j.extras_amount ?? 0) - customerDeposit,
          );
          const derived = deriveStoredJobFinancials({
            ...j,
            client_price: totals.clientTotal,
            partner_cost: totals.partnerTotal,
          } as Job);
          Object.assign(hourlyPatch, {
            billed_hours: totals.billedHours,
            hourly_client_rate: clientRate,
            hourly_partner_rate: partnerRate,
            client_price: totals.clientTotal,
            partner_cost: totals.partnerTotal,
            customer_final_payment: customerFinal,
            ...derived,
          });
        }
      }
      const forcePaidPatch: Partial<Job> = forceCloseFromAwaitingPayment
        ? {
            finance_status: "paid",
            customer_deposit_paid: Number(j.customer_deposit ?? 0) > 0 ? true : j.customer_deposit_paid,
            customer_final_paid: true,
            partner_payment_1_paid: Number(j.partner_payment_1 ?? 0) > 0 ? true : j.partner_payment_1_paid,
            partner_payment_2_paid: Number(j.partner_payment_2 ?? 0) > 0 ? true : j.partner_payment_2_paid,
            partner_payment_3_paid: Number(j.partner_payment_3 ?? 0) > 0 ? true : j.partner_payment_3_paid,
            internal_notes: markJobAsForcePaidNote(j.internal_notes),
          }
        : {};

      const statusPatch: Partial<Job> = {
        status: newStatus,
        ...(selfBillId ? { self_bill_id: selfBillId } : {}),
        ...forcePaidPatch,
        ...hourlyPatch,
        ...statusChangePartnerTimerPatch(j, newStatus),
        ...statusChangeOfficeTimerPatch(j, newStatus),
        ...(opts?.extraPatch ?? {}),
      };
      const updated = await updateJob(j.id, statusPatch, { skipSelfBillSync: opts?.skipSelfBillSync });
      if (forceCloseFromAwaitingPayment) {
        const linked = await listInvoicesLinkedToJob(updated.reference, updated.invoice_id);
        await Promise.all(
          linked.map((inv) =>
            updateInvoice(inv.id, {
              status: "paid",
              paid_date: new Date().toISOString().slice(0, 10),
              collection_stage: "completed",
            }),
          ),
        );
      }
      await logAudit({ entityType: "job", entityId: j.id, entityRef: j.reference, action: "status_changed", fieldName: "status", oldValue: j.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
      setJob(updated);
      if (!opts?.silent) {
        toast.success(
          forceCloseFromAwaitingPayment
            ? "Job marked Completed & paid."
            : selfBillId && selfBillId !== j.self_bill_id
              ? "Self-bill linked. Job updated."
              : "Job updated",
        );
      }
      if (updated.partner_id && j.status !== newStatus) {
        const statusLabel = statusConfig[newStatus]?.label ?? newStatus;
        notifyAssignedPartnerAboutJob({
          partnerId: updated.partner_id,
          job: updated,
          kind: "job_status_changed",
          statusLabel,
        });
        // Map OS status → Zendesk email kind so the partner gets the right copy.
        const zdKind: "on_hold" | "resumed" | "completed" | "status_changed" =
          newStatus === "on_hold"
            ? "on_hold"
            : j.status === "on_hold"
              ? "resumed"
              : newStatus === "completed"
                ? "completed"
                : "status_changed";
        const reason = newStatus === "on_hold" ? (updated.on_hold_reason ?? null) : null;
        void notifyPartnerJobChange({
          jobId: updated.id,
          jobReference: updated.reference,
          kind: zdKind,
          newStatusLabel: statusLabel,
          reason,
          skipPush: true,
        });
      }
      return updated;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      return null;
    }
  }, [profile?.id, profile?.full_name, customerPayments, partnerPayments]);

  const confirmPutOnHold = useCallback(async () => {
    if (!job) return;
    const reason = putOnHoldReason.trim();
    if (!reason) {
      toast.error("Add a short reason for on hold.");
      return;
    }
    setPutOnHoldSaving(true);
    try {
      const extraPatch: Partial<Job> = {
        on_hold_previous_status: job.status,
        on_hold_at: new Date().toISOString(),
        on_hold_reason: reason,
        on_hold_snapshot_scheduled_date: job.scheduled_date ?? null,
        on_hold_snapshot_scheduled_start_at: job.scheduled_start_at ?? null,
        on_hold_snapshot_scheduled_end_at: job.scheduled_end_at ?? null,
        on_hold_snapshot_scheduled_finish_date: job.scheduled_finish_date ?? null,
      };
      const updated = await handleStatusChange(job, "on_hold", { extraPatch });
      if (updated) {
        await logAudit({
          entityType: "job",
          entityId: job.id,
          entityRef: job.reference,
          action: "updated",
          fieldName: "on_hold_reason",
          newValue: reason,
          userId: profile?.id,
          userName: profile?.full_name,
          metadata: { source: "put_on_hold_modal" },
        });
        setPutOnHoldOpen(false);
        setPutOnHoldReason("");
        setPutOnHoldPreset(null);
        try {
          await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        } catch {
          /* non-blocking */
        }
      }
    } finally {
      setPutOnHoldSaving(false);
    }
  }, [job, putOnHoldReason, handleStatusChange, profile?.id, profile?.full_name]);

  const openResumeJobModal = useCallback(() => {
    if (!job || job.status !== "on_hold") return;
    const snapshotArrival = onHoldSnapshotArrivalYmd(job);
    const savedArrival = snapshotArrival ?? job.scheduled_date?.trim().slice(0, 10) ?? "";
    const today = formatLocalYmd(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = formatLocalYmd(tomorrowDate);
    let nextArrival = savedArrival.trim().slice(0, 10);
    if (!nextArrival) {
      nextArrival = resumeRequiresStrictFutureArrivalDate(snapshotArrival) ? tomorrow : today;
    } else if (resumeRequiresStrictFutureArrivalDate(snapshotArrival) && nextArrival <= today) {
      nextArrival = tomorrow;
    } else if (nextArrival < today) {
      nextArrival = today;
    }
    setResumeArrivalDate(nextArrival);
    const usesSlots = isOneOffScheduleUi;
    const startAt = job.on_hold_snapshot_scheduled_start_at ?? job.scheduled_start_at ?? null;
    const endAt = job.on_hold_snapshot_scheduled_end_at ?? job.scheduled_end_at ?? null;
    if (startAt) {
      const { hm } = utcIsoToUkWallClock(startAt);
      let time = hm;
      let wm = "";
      if (endAt) {
        const startMs = new Date(startAt).getTime();
        const endMs = new Date(endAt).getTime();
        wm = snapArrivalWindowMinutes(startMs, endMs);
      }
      if (usesSlots && time && wm) {
        const canon = canonicalArrivalSlotValues(time, wm);
        time = canon.from;
        wm = canon.mins;
      }
      setResumeArrivalTime(time);
      setResumeArrivalWindowMins(wm);
    } else {
      setResumeArrivalTime(usesSlots ? "09:00" : scheduleTime.trim());
      setResumeArrivalWindowMins(usesSlots ? "180" : "");
    }
    const finishYmd = (job.on_hold_snapshot_scheduled_finish_date ?? job.scheduled_finish_date ?? "").trim().slice(0, 10);
    setResumeExpectedFinishDate(isRecurringSeriesJob ? finishYmd : "");
    setResumeAction("reschedule");
    setResumeJobOpen(true);
  }, [job, scheduleTime, isOneOffScheduleUi, isRecurringSeriesJob]);

  const confirmResumeJob = useCallback(async () => {
    if (!job || job.status !== "on_hold") return;
    const snapYmd = onHoldSnapshotArrivalYmd(job);
    const gate = validateResumeArrivalDate({ snapshotYmd: snapYmd, selectedYmd: resumeArrivalDate });
    if (!gate.ok) {
      toast.error(gate.message);
      return;
    }
    if (!resumeArrivalTime.trim()) {
      toast.error("Set an arrival time.");
      return;
    }
    const wmTrim = resumeArrivalWindowMins.trim();
    const windowMins = wmTrim ? Number(wmTrim) : NaN;
    const hasWindow = Number.isFinite(windowMins) && windowMins > 0;
    if (job.partner_id?.trim() && !hasWindow) {
      toast.error("Choose an arrival window length when a partner is assigned.");
      return;
    }
    if (isOneOffScheduleUi && !hasWindow) {
      toast.error("Choose an arrival window length.");
      return;
    }
    const schedule = buildSchedulePatchForResume({
      arrivalDateYmd: resumeArrivalDate,
      arrivalTimeHm: resumeArrivalTime,
      arrivalWindowMins: resumeArrivalWindowMins,
      snapshotStartAt: job.on_hold_snapshot_scheduled_start_at,
      snapshotEndAt: job.on_hold_snapshot_scheduled_end_at,
      snapshotFinishDate: job.on_hold_snapshot_scheduled_finish_date,
      fallbackFinishDate: job.scheduled_finish_date,
      oneOff: isOneOffScheduleUi,
    });
    const arrY = resumeArrivalDate.trim().slice(0, 10);
    const finishY = isRecurringSeriesJob
      ? resumeExpectedFinishDate.trim().slice(0, 10) ||
        (schedule.scheduled_finish_date ?? "").toString().slice(0, 10)
      : (schedule.scheduled_finish_date ?? "").toString().slice(0, 10);
    if (isRecurringSeriesJob && finishY && finishY < arrY) {
      toast.error("Arrival date cannot be after the expected finish date.");
      return;
    }
    const prevRaw = (job.on_hold_previous_status ?? "in_progress").trim();
    const prev = jobStatusAfterResumeFromOnHold(prevRaw as Job["status"]);
    const timerBasis = { ...job, status: "on_hold" as Job["status"] };
    const patch: Partial<Job> = {
      status: prev,
      ...schedule,
      scheduled_finish_date: finishY || null,
      on_hold_previous_status: null,
      on_hold_at: null,
      on_hold_reason: null,
      on_hold_snapshot_scheduled_date: null,
      on_hold_snapshot_scheduled_start_at: null,
      on_hold_snapshot_scheduled_end_at: null,
      on_hold_snapshot_scheduled_finish_date: null,
      ...statusChangePartnerTimerPatch(timerBasis, prev),
      ...statusChangeOfficeTimerPatch(timerBasis, prev),
    };
    setResumeSaving(true);
    try {
      const updated = await handleJobUpdate(job.id, patch, { silent: true, notifyPartner: false });
      if (updated) {
        await logAudit({
          entityType: "job",
          entityId: job.id,
          entityRef: job.reference,
          action: "status_changed",
          fieldName: "status",
          oldValue: job.status,
          newValue: prev,
          userId: profile?.id,
          userName: profile?.full_name,
        });
        setResumeJobOpen(false);
        toast.success("Job resumed");
        try {
          await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        } catch {
          /* non-blocking */
        }
        if (updated.partner_id) {
          notifyAssignedPartnerAboutJob({
            partnerId: updated.partner_id,
            job: updated,
            kind: "job_status_changed",
            statusLabel: statusConfig[prev]?.label ?? prev,
          });
        }
      }
    } finally {
      setResumeSaving(false);
    }
  }, [
    job,
    resumeArrivalDate,
    resumeArrivalTime,
    resumeArrivalWindowMins,
    resumeExpectedFinishDate,
    isOneOffScheduleUi,
    isRecurringSeriesJob,
    handleJobUpdate,
    profile?.id,
    profile?.full_name,
  ]);

  const openCompleteFromResumeModal = useCallback(() => {
    setResumeJobOpen(false);
    setApprovalMode("review_approve");
    setOwnerApprovalChecked(true);
    setForceApprovalChecked(false);
    setForceApprovalReason("");
    setSentToAccountsChecked(false);
    setValidateCompleteOpen(true);
  }, []);

  const handleResumeModalAction = useCallback(async () => {
    if (resumeAction === "cancel") {
      const cancelled = await handleConfirmOfficeCancel();
      if (cancelled) setResumeJobOpen(false);
      return;
    }
    if (resumeAction === "complete") {
      openCompleteFromResumeModal();
      return;
    }
    await confirmResumeJob();
  }, [resumeAction, handleConfirmOfficeCancel, openCompleteFromResumeModal, confirmResumeJob]);

  /** When the job is part of an active recurring series, intercept the
   *  update by routing through the RecurringEditScopeDialog. The user picks
   *  whether to apply this only / this and following / entire series. */
  const dispatchRecurrenceAware = useCallback(
    (j: Job, patch: Partial<Job>, actionLabel: string) => {
      if (j.recurrence_series_id && !j.recurrence_detached_at) {
        setRecurringScopePending({
          jobId: j.id,
          patch,
          sequenceIndex: j.recurrence_sequence_index ?? null,
          actionLabel,
        });
      } else {
        void handleJobUpdate(j.id, patch);
      }
    },
    [handleJobUpdate],
  );

  /** Shared with Details schedule strip and the ⋮ “Reschedule & confirm” modal — no network. */
  const buildSchedulePatchForInputs = useCallback(
    (
      j: Job,
      startDate: string,
      startTime: string,
      windowMinsStr: string,
      expectedFinishDate: string,
      opts?: { oneOff?: boolean },
    ): Partial<Job> | null => {
      const oneOff = opts?.oneOff === true;
      const d = startDate.trim();
      const tFrom = startTime.trim();
      const expectedTrim = expectedFinishDate.trim();
      const wm = windowMinsStr.trim();
      const windowMins = wm ? Number(wm) : NaN;
      const hasWindow = Number.isFinite(windowMins) && windowMins > 0;
      const arrivalDayForCompare = d || (typeof j.scheduled_date === "string" ? j.scheduled_date.trim().slice(0, 10) : "");

      if (!oneOff && expectedTrim && arrivalDayForCompare && expectedTrim < arrivalDayForCompare) {
        toast.error("Expected finish date must be on or after the arrival date.");
        return null;
      }

      if (!d) {
        return {
          scheduled_date: null,
          scheduled_start_at: null,
          scheduled_end_at: null,
          scheduled_finish_date: null,
        } as unknown as Partial<Job>;
      }

      if (!oneOff && !expectedTrim) {
        toast.error("Expected finish date is required when a start date is set.");
        return null;
      }

      const finishForPatch = oneOff ? null : expectedTrim;

      if (!tFrom) {
        return {
          scheduled_date: d,
          scheduled_start_at: null,
          scheduled_end_at: null,
          scheduled_finish_date: finishForPatch,
        } as unknown as Partial<Job>;
      }

      if (wm !== "" && !hasWindow) {
        toast.error("Choose a valid arrival window length.");
        return null;
      }

      const hasPartner = !!(j.partner_id?.trim());
      if (hasPartner && !hasWindow) {
        toast.error("Choose an arrival window length when a partner is assigned.");
        return null;
      }

      // Treat the form's date+time as UK wall-clock and persist as proper UTC.
      const scheduled_start_at = ukWallClockToUtcIso(d, tFrom);
      if (!scheduled_start_at) {
        toast.error("Invalid arrival date or time.");
        return null;
      }
      let scheduled_end_at: string | null = null;
      if (hasWindow) {
        const startMs = new Date(scheduled_start_at).getTime();
        const endMs = startMs + windowMins * 60_000;
        if (!(endMs > startMs)) {
          toast.error("Arrival window must end after the start time.");
          return null;
        }
        scheduled_end_at = new Date(endMs).toISOString();
      }

      return {
        scheduled_date: d,
        scheduled_start_at,
        scheduled_end_at,
        scheduled_finish_date: finishForPatch,
      } as Partial<Job>;
    },
    [],
  );

  const openQuickReschedule = useCallback(() => {
    if (!job) return;
    setJobMoreMenuOpen(false);
    const usesSlots = isOneOffScheduleUi;
    if (job.scheduled_start_at) {
      const { ymd, hm } = utcIsoToUkWallClock(job.scheduled_start_at);
      setQrDate(ymd);
      let time = hm;
      let wm = "";
      if (job.scheduled_end_at) {
        const startMs = new Date(job.scheduled_start_at).getTime();
        const endMs = new Date(job.scheduled_end_at).getTime();
        wm = snapArrivalWindowMinutes(startMs, endMs);
      }
      if (usesSlots && time && wm) {
        const canon = canonicalArrivalSlotValues(time, wm);
        time = canon.from;
        wm = canon.mins;
      }
      setQrTime(time);
      setQrWindowMins(wm);
    } else if (job.scheduled_date) {
      setQrDate(job.scheduled_date.slice(0, 10));
      if (usesSlots) {
        setQrTime("09:00");
        setQrWindowMins("180");
      } else {
        setQrTime("");
        setQrWindowMins("");
      }
    } else {
      setQrDate("");
      setQrTime(usesSlots ? "09:00" : "");
      setQrWindowMins(usesSlots ? "180" : "");
    }
    setQrExpectedFinish(
      usesSlots
        ? ""
        : job.scheduled_finish_date?.slice(0, 10) ?? job.scheduled_date?.slice(0, 10) ?? "",
    );
    setQrPartnerId(job.partner_id ?? "");
    setQrCatalogServiceId(job.catalog_service_id ?? "");
    setQrClientPrice(String(job.client_price ?? 0));
    setQrPartnerCost(String(job.partner_cost ?? 0));
    setQuickRescheduleOpen(true);
  }, [job, isOneOffScheduleUi]);

  const confirmQuickReschedule = useCallback(async () => {
    if (!job) return;
    const effective = { ...job, partner_id: qrPartnerId?.trim() ? qrPartnerId.trim() : null } as Job;
    const schedulePatch = buildSchedulePatchForInputs(
      effective,
      qrDate,
      qrTime,
      qrWindowMins,
      isOneOffScheduleUi ? "" : qrExpectedFinish,
      { oneOff: isOneOffScheduleUi },
    );
    if (!schedulePatch) return;

    const clientVal = Math.max(0, Math.round((Number(qrClientPrice) || 0) * 100) / 100);
    const partnerVal = Math.max(0, Math.round((Number(qrPartnerCost) || 0) * 100) / 100);

    const svc = qrCatalogServiceId.trim()
      ? catalogServicesJobType.find((c) => c.id === qrCatalogServiceId.trim())
      : undefined;
    const titlePatch: Partial<Job> = {};
    if (qrCatalogServiceId.trim() && svc) {
      titlePatch.catalog_service_id = qrCatalogServiceId.trim();
      titlePatch.title = normalizeTypeOfWork(svc.name) || svc.name;
    }

    const pid = qrPartnerId.trim();
    const partnerRow = pid ? partners.find((p) => p.id === pid) : undefined;

    const merged: Partial<Job> = {
      ...schedulePatch,
      ...titlePatch,
      partner_id: pid || null,
      partner_name: partnerRow ? (partnerRow.company_name?.trim() || partnerRow.contact_name) : null,
      client_price: clientVal,
      partner_cost: partnerVal,
    };

    if (job.recurrence_series_id && !job.recurrence_detached_at) {
      setRecurringScopePending({
        jobId: job.id,
        patch: merged,
        sequenceIndex: job.recurrence_sequence_index ?? null,
        actionLabel: "reschedule",
      });
      setQuickRescheduleOpen(false);
      toast.success("Choose how to apply this change to the series.");
      return;
    }

    setQuickRescheduleSaving(true);
    try {
      const prev = job;
      const updated = await handleJobUpdate(job.id, merged, { silent: true });
      if (!updated) return;
      await logFieldChanges(
        "job",
        prev.id,
        prev.reference,
        prev as unknown as Record<string, unknown>,
        merged as Record<string, unknown>,
        profile?.id,
        profile?.full_name,
      );
      try {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
      } catch {
        /* non-blocking */
      }
      await syncSelfBillAfterJobChange(updated);
      try {
        await reconcileJobCustomerPaymentFlags(getSupabase(), updated.id);
      } catch {
        /* non-blocking */
      }
      await refreshJobFinance();
      setScheduleDate(qrDate.trim());
      setScheduleTime(qrTime.trim());
      setScheduleWindowMins(qrWindowMins.trim());
      setScheduleExpectedFinishDate(isOneOffScheduleUi ? "" : qrExpectedFinish.trim());
      setQuickRescheduleOpen(false);
      toast.success("Booking updated — partner notified when assigned.");
    } finally {
      setQuickRescheduleSaving(false);
    }
  }, [
    job,
    qrDate,
    qrTime,
    qrWindowMins,
    qrExpectedFinish,
    qrPartnerId,
    qrCatalogServiceId,
    qrClientPrice,
    qrPartnerCost,
    partners,
    catalogServicesJobType,
    buildSchedulePatchForInputs,
    isOneOffScheduleUi,
    handleJobUpdate,
    profile?.id,
    profile?.full_name,
    refreshJobFinance,
  ]);

  const jobMoneyClientCashContext = useMemo((): JobMoneyDrawerClientCashContext | undefined => {
    if (!job) return undefined;
    const sched = Number(job.customer_deposit ?? 0);
    const paid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    return { depositScheduled: sched, depositRemaining: Math.max(0, sched - paid) };
  }, [job, customerPayments]);

  const jobCatalogService = useMemo(() => {
    if (!job || catalogServicesJobType.length === 0) return null;
    const byId = job.catalog_service_id?.trim();
    if (byId) {
      const hit = catalogServicesJobType.find((s) => s.id === byId);
      if (hit) return hit;
    }
    const titleOut = normalizeTypeOfWork(job.title || job.job_type || "") || job.job_type || job.title || "";
    const key = titleOut.trim().toLowerCase();
    if (!key) return null;
    return (
      catalogServicesJobType.find((s) => {
        const a = (normalizeTypeOfWork(s.name) || s.name || "").trim().toLowerCase();
        return a === key || a.includes(key) || key.includes(a);
      }) ?? null
    );
  }, [job, catalogServicesJobType]);

  const moneyDrawerCatalogAddonOptions = useMemo(() => {
    if (!jobCatalogService) return [];
    return resolveCatalogAddonChargeOptions(jobCatalogService, moneyDrawerAccountPrice);
  }, [jobCatalogService, moneyDrawerAccountPrice]);

  useEffect(() => {
    if (!moneyDrawerOpen) return;
    if (catalogServicesJobType.length > 0) return;
    let cancelled = false;
    listCatalogServicesForPicker()
      .then((rows) => {
        if (!cancelled) setCatalogServicesJobType(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalogServicesJobType([]);
      });
    return () => {
      cancelled = true;
    };
  }, [moneyDrawerOpen, catalogServicesJobType.length]);

  useEffect(() => {
    const serviceId = jobCatalogService?.id?.trim();
    if (!moneyDrawerOpen || !serviceId || !job?.client_id?.trim()) {
      queueMicrotask(() => setMoneyDrawerAccountPrice(null));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const c = await getClient(job.client_id!.trim());
        const aid = c?.source_account_id?.trim();
        if (!aid) {
          if (!cancelled) setMoneyDrawerAccountPrice(null);
          return;
        }
        const row = await getAccountServicePrice(aid, serviceId).catch(() => null);
        if (!cancelled) setMoneyDrawerAccountPrice(row);
      } catch {
        if (!cancelled) setMoneyDrawerAccountPrice(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moneyDrawerOpen, jobCatalogService?.id, job?.client_id]);

  const cczParkingFieldTooltipText = useMemo(() => {
    const lines = [
      `CCZ is only available for central London postcodes (TfL Congestion Charge / Zone 1 core: EC1–4, WC1–2, W1, SW1, SE1). Outside that list the control stays off. Inside the list you still choose whether to apply the ${formatCurrency(accessFees.cczFeeGbp)} fee — it is not turned on automatically.`,
    ];
    if (!cczEligibleAddress && job?.in_ccz) {
      lines.push(
        "This job has CCZ enabled in the database, but the current address is outside the central London postcode list — no CCZ surcharge is applied until you save an eligible address and turn CCZ on.",
      );
    }
    return lines.join("\n\n");
  }, [cczEligibleAddress, job?.in_ccz, accessFees.cczFeeGbp]);

  const handleMoneyDrawerSubmit = useCallback(
    async (payload: JobMoneySubmitPayload) => {
      if (!job) return;
      setMoneySubmitting(true);
      try {
        const linkedPartnerExtra =
          payload.flow === "client_extra" && payload.linkedPartnerExtra
            ? payload.linkedPartnerExtra
            : undefined;
        const linkedGroupId =
          linkedPartnerExtra
            ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
            : undefined;
        let workingJob: Job = job;
        const actions: JobMoneySubmitPayload[] = [payload];
        if (linkedPartnerExtra) {
          const p = linkedPartnerExtra;
          actions.push({
            flow: "partner_extra",
            amount: p.amount,
            paymentDate: payload.paymentDate,
            method: "other",
            note: `${p.extraType} — ${p.extraReason}`,
            extraType: p.extraType,
            extraReason: p.extraReason,
          });
        }

        for (const actionPayload of actions) {
          const reasonForSubmit =
            actionPayload.flow === "client_extra"
              ? encodeClientExtraReason(
                  actionPayload.extraReason ?? "",
                  Boolean(actionPayload.clientProofConfirmed),
                )
              : actionPayload.extraReason;
          const updated = await executeJobMoneyAction({
            job: workingJob,
            mode: actionPayload.flow,
            amount: actionPayload.amount,
            paymentDate: actionPayload.paymentDate,
            method: actionPayload.method,
            note: actionPayload.note,
            extraType: actionPayload.extraType,
            extraReason: reasonForSubmit,
            actorUserId: profile?.id ?? undefined,
            actorUserName: profile?.full_name ?? undefined,
            linkedGroupId,
            customerPayments,
            partnerPayments,
            ...(actionPayload.flow === "client_pay" && actionPayload.clientPayApplyAs
              ? { clientPayApplyAs: actionPayload.clientPayApplyAs }
              : {}),
            ...(actionPayload.paymentLedgerLabel?.trim()
              ? { paymentLedgerLabel: actionPayload.paymentLedgerLabel.trim() }
              : {}),
          });
          if (
            isJobExtraEntriesTableUnavailable() &&
            (actionPayload.flow === "client_extra" || actionPayload.flow === "partner_extra")
          ) {
            const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setExtraHistory((prev) => [
              {
                id: localId,
                idRaw: localId,
                side: actionPayload.flow === "client_extra" ? "client" : "partner",
                amount: actionPayload.amount,
                extraType: actionPayload.extraType?.trim() || "Extra",
                reason: actionPayload.extraReason?.trim() || "",
                clientConfirmed:
                  actionPayload.flow === "client_extra"
                    ? Boolean(actionPayload.clientProofConfirmed)
                    : undefined,
                createdAt: new Date().toISOString(),
                userName: profile?.full_name ?? undefined,
                allocation: (() => {
                  const et = actionPayload.extraType?.trim() ?? "";
                  if (actionPayload.flow === "client_extra") {
                    const a = customerExtraLedgerAllocation(et);
                    return a === "materials" ? "materials" : a === "labour" ? "labour" : "extras";
                  }
                  return actionPayload.extraType?.trim().toUpperCase() === "MATERIALS"
                    ? "materials"
                    : isJobExtraDiscountExtraType(et)
                      ? partnerDiscountAllocationFromExtraType(et)
                      : "partner_cost";
                })(),
                linkedGroupId: linkedGroupId ?? null,
              },
              ...prev,
            ]);
          }
          if (actionPayload.flow === "client_extra") {
            const et = actionPayload.extraType?.trim() ?? "";
            if (customerExtraLedgerAllocation(et) === "extras") {
              const delta = signedLedgerDisplayAmount(et, actionPayload.amount);
              setClientExtrasUiValue((v) => Math.round((v + delta) * 100) / 100);
            }
          } else if (actionPayload.flow === "partner_extra") {
            const et = actionPayload.extraType?.trim() ?? "";
            const typeUpper = et.toUpperCase();
            const isMaterials =
              typeUpper === "MATERIALS" || (isJobExtraDiscountExtraType(et) && typeUpper.includes("MATERIAL"));
            if (!isMaterials) {
              const delta = signedLedgerDisplayAmount(et, actionPayload.amount);
              setPartnerExtrasUiValue((v) => Math.round((v + delta) * 100) / 100);
            }
            /* Materials line reads from job.materials_cost after save — do not fold into extra/ccz/parking breakdown. */
            if (!isMaterials) {
              const type: "ccz" | "parking" | "extra" =
                typeUpper === "CCZ"
                  ? "ccz"
                  : typeUpper === "PARKING"
                    ? "parking"
                    : "extra";
              const delta = signedLedgerDisplayAmount(et, actionPayload.amount);
              setPartnerExtraBreakdownUi((prev) => ({
                ...prev,
                [type]: Math.round(((prev[type] ?? 0) + delta) * 100) / 100,
              }));
            }
          }
          workingJob = updated;
          setJob(updated);
          const fieldName =
            actionPayload.flow === "client_pay"
              ? "customer_payment"
              : actionPayload.flow === "client_extra"
                ? "customer_extra_charge"
                : actionPayload.flow === "partner_pay"
                  ? "partner_payment"
                  : "partner_extra_payout";
          await logAudit({
            entityType: "job",
            entityId: job.id,
            entityRef: job.reference,
            action: actionPayload.flow === "client_pay" || actionPayload.flow === "partner_pay" ? "payment" : "updated",
            fieldName,
            newValue: formatCurrency(actionPayload.amount),
            userId: profile?.id,
            userName: profile?.full_name,
            metadata: {
              mode: actionPayload.flow,
              method: actionPayload.method,
              date: actionPayload.paymentDate,
              ...(actionPayload.note.trim() ? { note: actionPayload.note.trim() } : {}),
              ...(actionPayload.extraType?.trim() ? { extra_type: actionPayload.extraType.trim() } : {}),
              ...(actionPayload.extraReason?.trim() ? { extra_reason: actionPayload.extraReason.trim() } : {}),
              ...(actionPayload.flow === "client_extra"
                ? { client_proof_confirmed: Boolean(actionPayload.clientProofConfirmed) }
                : {}),
              ...(linkedGroupId ? { linked_group_id: linkedGroupId } : {}),
              ...(actionPayload.flow === "client_pay" && actionPayload.clientPayApplyAs
                ? { client_pay_apply_as: actionPayload.clientPayApplyAs }
                : {}),
            },
          });
        }
        const toastMsg =
          payload.flow === "client_extra" && payload.linkedPartnerExtra
            ? "Client and partner extras added"
            : payload.flow === "client_pay"
              ? "Payment recorded"
              : payload.flow === "client_extra"
                ? isJobExtraDiscountExtraType(payload.extraType)
                  ? "Client discount saved"
                  : "Extra charge added"
                : payload.flow === "partner_pay"
                  ? "Payout recorded"
                  : isJobExtraDiscountExtraType(payload.extraType)
                    ? "Partner discount saved"
                    : "Extra payout added";
        toast.success(toastMsg);
        setMoneyDrawerOpen(false);
        setMoneyDrawerFlow(null);
        setMoneyDrawerInitialExtraType(undefined);
        await refreshJobFinance();
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "object" && e !== null && "message" in (e as object)
              ? String((e as { message: unknown }).message)
              : "Could not save";
        console.error("Job money action failed", e);
        toast.error(msg);
      } finally {
        setMoneySubmitting(false);
      }
    },
    [job, customerPayments, partnerPayments, profile?.id, profile?.full_name, refreshJobFinance],
  );

  const confirmDeletePayment = useCallback(async () => {
    if (!deletePaymentTarget || !job) return;
    setDeletingPayment(true);
    try {
      await deleteJobPayment(deletePaymentTarget.id);
      await logAudit({
        entityType: "job", entityId: job.id, entityRef: job.reference,
        action: "deleted",
        fieldName: "payment",
        oldValue: formatCurrency(deletePaymentTarget.amount),
        userId: profile?.id, userName: profile?.full_name,
        metadata: { payment_type: deletePaymentTarget.type },
      });
      await refreshJobFinance();
      toast.success("Payment removed");
    } catch {
      toast.error("Failed to remove payment");
    } finally {
      setDeletingPayment(false);
      setDeletePaymentTarget(null);
    }
  }, [deletePaymentTarget, job, profile?.id, profile?.full_name, refreshJobFinance]);

  const openExtraManager = useCallback((side: "client" | "partner", focus?: ExtraHistoryBucket) => {
    setExtraManagerSide(side);
    setExtraManagerFocusBucket(focus ?? null);
  }, []);

  const bucketHasLedgerEntries = useCallback(
    (side: "client" | "partner", bucket: ExtraHistoryBucket) =>
      extraHistory
        .filter((row) => row.side === side)
        .some((row) => extraHistoryBucket(row.extraType) === bucket),
    [extraHistory],
  );

  const handleOpenEditExtra = useCallback((entry: ExtraHistoryEntry) => {
    if (isFallbackExtraEntry(entry)) return;
    setEditExtraTarget(entry);
    setEditExtraAmount(String(Math.round(Math.abs(Number(entry.amount)) * 100) / 100));
    setEditExtraReason(entry.reason);
    setEditExtraClientConfirmed(entry.clientConfirmed ?? true);
  }, []);

  const handleDeleteExtraEntry = useCallback(
    (entry: ExtraHistoryEntry) => {
      if (isFallbackExtraEntry(entry)) return;
      const hasLinkedPartner =
        entry.side === "client" &&
        Boolean(entry.linkedGroupId) &&
        extraHistory.some(
          (row) =>
            row.side === "partner" &&
            row.linkedGroupId &&
            row.linkedGroupId === entry.linkedGroupId &&
            !isFallbackExtraEntry(row),
        );
      setDeleteExtraTarget(entry);
      setDeleteLinkedPartnerAlso(hasLinkedPartner);
    },
    [extraHistory],
  );

  const confirmDeleteExtraEntry = useCallback(async () => {
    if (!deleteExtraTarget || !job) return;
    setConfirmingDeleteExtra(true);
    setDeletingExtraId(deleteExtraTarget.idRaw);
    try {
      const targets: ExtraHistoryEntry[] =
        deleteExtraTarget.side === "client" &&
        Boolean(deleteExtraTarget.linkedGroupId) &&
        deleteLinkedPartnerAlso
          ? extraHistory.filter(
              (row) =>
                row.linkedGroupId &&
                row.linkedGroupId === deleteExtraTarget.linkedGroupId &&
                !isFallbackExtraEntry(row),
            )
          : [deleteExtraTarget];

      let workingJob: Job = job;
      for (const entry of targets) {
        if (entry.side === "client") {
          const rawAlloc = entry.allocation ?? "extras";
          const allocation =
            rawAlloc === "materials" ? "materials" : rawAlloc === "labour" ? "labour" : "extras";
          const mag = Math.abs(Number(entry.amount));
          const discount = isJobExtraDiscountExtraType(entry.extraType);
          const patch = discount
            ? applyCustomerExtraPatch(workingJob, mag, allocation)
            : reverseCustomerExtraPatch(workingJob, mag, allocation);
          if (Object.keys(patch).length > 0) {
            const updated = await updateJob(workingJob.id, patch);
            await bumpLinkedInvoiceAmountsToJobSchedule(updated);
            await syncSelfBillAfterJobChange(updated);
            await reconcileJobCustomerPaymentFlags(getSupabase(), workingJob.id);
            workingJob = updated;
            setJob(updated);
          }
        } else {
          const allocation = entry.allocation === "materials" ? "materials" : "partner_cost";
          const mag = Math.abs(Number(entry.amount));
          const discount = isJobExtraDiscountExtraType(entry.extraType);
          const patch = discount
            ? applyPartnerExtraPatch(workingJob, mag, allocation)
            : reversePartnerExtraPatch(workingJob, mag, allocation);
          if (Object.keys(patch).length > 0) {
            const updated = await updateJob(workingJob.id, patch);
            await syncSelfBillAfterJobChange(updated);
            workingJob = updated;
            setJob(updated);
          }
        }

        if (!entry.idRaw.startsWith("local-")) {
          await softDeleteJobExtraEntry({
            id: entry.idRaw,
            deletedBy: profile?.id,
            deletedByName: profile?.full_name ?? undefined,
            reason: "Removed from job card extra history",
          });
        }

        await logAudit({
          entityType: "job",
          entityId: job.id,
          entityRef: job.reference,
          action: "deleted",
          fieldName: entry.side === "client" ? "customer_extra_charge" : "partner_extra_payout",
          oldValue: formatCurrency(entry.amount),
          userId: profile?.id,
          userName: profile?.full_name,
          metadata: {
            extra_entry_id: entry.idRaw,
            extra_type: entry.extraType,
            extra_reason: entry.reason,
            ...(entry.linkedGroupId ? { linked_group_id: entry.linkedGroupId } : {}),
            ...(deleteLinkedPartnerAlso && deleteExtraTarget.side === "client" ? { delete_linked_partner: true } : {}),
          },
        });
      }

      setExtraHistory((prev) => prev.filter((row) => !targets.some((target) => target.idRaw === row.idRaw)));
      await refreshJobFinance();
      toast.success(
        targets.length > 1
          ? "Client and linked partner extras removed"
          : "Extra removed",
      );
    } catch {
      toast.error("Could not remove extra");
    } finally {
      setDeletingExtraId(null);
      setConfirmingDeleteExtra(false);
      setDeleteExtraTarget(null);
      setDeleteLinkedPartnerAlso(false);
    }
  }, [
    deleteExtraTarget,
    job,
    deleteLinkedPartnerAlso,
    extraHistory,
    profile?.id,
    profile?.full_name,
    refreshJobFinance,
  ]);

  const confirmEditExtraEntry = useCallback(async () => {
    if (!editExtraTarget || !job) return;
    const newMag = Math.round((parseFloat(editExtraAmount) || 0) * 100) / 100;
    if (newMag <= 0) {
      toast.error("Enter an amount greater than zero, or remove the extra instead.");
      return;
    }
    const reasonTrim = editExtraReason.trim();
    if (!reasonTrim) {
      toast.error("Add a reason for this extra.");
      return;
    }
    const oldMag = Math.round(Math.abs(Number(editExtraTarget.amount)) * 100) / 100;
    const reasonChanged =
      editExtraTarget.side === "client"
        ? encodeClientExtraReason(reasonTrim, editExtraClientConfirmed) !==
          encodeClientExtraReason(editExtraTarget.reason, editExtraTarget.clientConfirmed ?? true)
        : reasonTrim !== editExtraTarget.reason.trim();
    if (Math.abs(newMag - oldMag) < 0.009 && !reasonChanged) {
      setEditExtraTarget(null);
      return;
    }

    setSavingExtraEdit(true);
    setDeletingExtraId(editExtraTarget.idRaw);
    try {
      let workingJob: Job = job;
      const discount = isJobExtraDiscountExtraType(editExtraTarget.extraType);

      if (Math.abs(newMag - oldMag) >= 0.009) {
        if (editExtraTarget.side === "client") {
          const allocation =
            editExtraTarget.allocation === "materials"
              ? "materials"
              : editExtraTarget.allocation === "labour"
                ? "labour"
                : customerExtraLedgerAllocation(editExtraTarget.extraType);
          const reversePatch = discount
            ? applyCustomerExtraPatch(workingJob, oldMag, allocation)
            : reverseCustomerExtraPatch(workingJob, oldMag, allocation);
          if (Object.keys(reversePatch).length > 0) {
            workingJob = await updateJob(workingJob.id, reversePatch);
          }
          const applyPatch = discount
            ? reverseCustomerExtraPatch(workingJob, newMag, allocation)
            : applyCustomerExtraPatch(workingJob, newMag, allocation);
          if (Object.keys(applyPatch).length > 0) {
            workingJob = await updateJob(workingJob.id, applyPatch);
            await bumpLinkedInvoiceAmountsToJobSchedule(workingJob);
            await syncSelfBillAfterJobChange(workingJob);
            await reconcileJobCustomerPaymentFlags(getSupabase(), workingJob.id);
          }
        } else {
          const allocation =
            editExtraTarget.allocation === "materials"
              ? "materials"
              : isJobExtraDiscountExtraType(editExtraTarget.extraType)
                ? partnerDiscountAllocationFromExtraType(editExtraTarget.extraType)
                : "partner_cost";
          const reversePatch = discount
            ? applyPartnerExtraPatch(workingJob, oldMag, allocation)
            : reversePartnerExtraPatch(workingJob, oldMag, allocation);
          if (Object.keys(reversePatch).length > 0) {
            workingJob = await updateJob(workingJob.id, reversePatch);
          }
          const applyPatch = discount
            ? reversePartnerExtraPatch(workingJob, newMag, allocation)
            : applyPartnerExtraPatch(workingJob, newMag, allocation);
          if (Object.keys(applyPatch).length > 0) {
            workingJob = await updateJob(workingJob.id, applyPatch);
            await syncSelfBillAfterJobChange(workingJob);
          }
        }
        setJob(workingJob);
      }

      if (!editExtraTarget.idRaw.startsWith("local-")) {
        const storedReason =
          editExtraTarget.side === "client"
            ? encodeClientExtraReason(reasonTrim, editExtraClientConfirmed)
            : reasonTrim;
        await updateJobExtraEntry({
          id: editExtraTarget.idRaw,
          amount: newMag,
          reason: storedReason,
        });
      }

      setExtraHistory((prev) =>
        prev.map((row) =>
          row.idRaw === editExtraTarget.idRaw
            ? {
                ...row,
                amount: newMag,
                reason: reasonTrim,
                clientConfirmed: editExtraTarget.side === "client" ? editExtraClientConfirmed : row.clientConfirmed,
              }
            : row,
        ),
      );

      await logAudit({
        entityType: "job",
        entityId: job.id,
        entityRef: job.reference,
        action: "updated",
        fieldName: editExtraTarget.side === "client" ? "customer_extra_charge" : "partner_extra_payout",
        oldValue: formatCurrency(oldMag),
        newValue: formatCurrency(newMag),
        userId: profile?.id,
        userName: profile?.full_name,
        metadata: {
          extra_entry_id: editExtraTarget.idRaw,
          extra_type: editExtraTarget.extraType,
          extra_reason: reasonTrim,
        },
      });

      await refreshJobFinance();
      toast.success("Extra updated");
      setEditExtraTarget(null);
      setExtraManagerSide(null);
      setExtraManagerFocusBucket(null);
    } catch {
      toast.error("Could not update extra");
    } finally {
      setSavingExtraEdit(false);
      setDeletingExtraId(null);
    }
  }, [
    editExtraTarget,
    editExtraAmount,
    editExtraReason,
    editExtraClientConfirmed,
    job,
    profile?.id,
    profile?.full_name,
    refreshJobFinance,
  ]);

  useEffect(() => {
    if (!job?.id || !profile?.id) return;
    if (job.owner_id) return;
    if (ownerKeepUnassignedRef.current.has(job.id)) return;
    if (autoOwnerFillRef.current.has(job.id)) return;
    autoOwnerFillRef.current.add(job.id);
    (async () => {
      try {
        const updated = await updateJob(job.id, {
          owner_id: profile.id,
          owner_name: profile.full_name ?? undefined,
        });
        setJob(updated);
      } catch {
        // silent fallback: keeps UI stable even if owner autofill fails
      }
    })();
  }, [job?.id, job?.owner_id, profile?.id, profile?.full_name]);

  const handleManualReportAnalyze = useCallback(async () => {
    if (!job) return;
    if (!manualReportFile) {
      toast.error("Select a report file first.");
      return;
    }
    setAnalyzingManualReport(true);
    try {
      const uploaded = await uploadManualJobReport(job.id, manualReportFile);
      const res = await fetch("/api/jobs/analyze-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobReference: job.reference,
          fileUrl: uploaded.publicUrl,
          mimeType: uploaded.mimeType,
          notes: manualReportNotes.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { analysis?: string; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to analyse report");
      const analysis = body.analysis ?? "";
      setManualReportResult(analysis);
      await handleJobUpdate(job.id, {
        report_notes: [
          job.report_notes,
          `Manual report file: ${uploaded.publicUrl}`,
          `Manual report analysis (${new Date().toLocaleString()}):`,
          analysis,
        ].filter(Boolean).join("\n\n"),
      });
      toast.success("Report analysed and saved to report notes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to analyse report");
    } finally {
      setAnalyzingManualReport(false);
    }
  }, [job, manualReportFile, manualReportNotes, handleJobUpdate]);

  const handlePhaseReportUploadAnalyze = useCallback(
    async (phase: number, jobContext?: Job): Promise<Job | null> => {
      const j = jobContext ?? job;
      if (!j) return null;
      const file = phaseReportFiles[phase] ?? null;
      if (!file) {
        toast.error("Select a report file first.");
        return null;
      }
      setAnalyzingPhase(phase);
      try {
        const uploaded = await uploadManualJobReport(j.id, file);
        const res = await fetch("/api/jobs/analyze-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobReference: j.reference,
            fileUrl: uploaded.publicUrl,
            mimeType: uploaded.mimeType,
            notes: `Phase ${phase} report.`,
          }),
        });
        const body = (await res.json()) as { analysis?: string; error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to analyse report");
        const analysis = body.analysis ?? "";
        const updated = await handleJobUpdate(j.id, {
          [`report_${phase}_uploaded`]: true,
          [`report_${phase}_uploaded_at`]: new Date().toISOString(),
          report_notes: [
            j.report_notes,
            `Phase ${phase} file: ${uploaded.publicUrl}`,
            `Phase ${phase} report analysis (${new Date().toLocaleString()}):`,
            analysis,
          ]
            .filter(Boolean)
            .join("\n\n"),
        } as Partial<Job>);
        setPhaseReportFiles((prev) => ({ ...prev, [phase]: null }));
        toast.success(`Phase ${phase} report uploaded and analysed.`);
        return updated ?? null;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to upload/analyse report");
        return null;
      } finally {
        setAnalyzingPhase(null);
      }
    },
    [job, phaseReportFiles, handleJobUpdate],
  );

  const handleSendReportAndInvoice = useCallback(async (opts?: {
    reviewSentAt?: string;
    reviewSendMethod?: "email" | "manual";
    jobOverride?: Job;
  }) => {
    const j = opts?.jobOverride ?? jobRef.current;
    if (!j) return;
    const gate = canSendReportAndRequestFinalPayment(j);
    if (!gate.ok) {
      toast.error(gate.message ?? "Cannot proceed");
      return;
    }
    const updated = await handleJobUpdate(
      j.id,
      {
        report_submitted: true,
        report_submitted_at: new Date().toISOString(),
        internal_report_approved: true,
        internal_invoice_approved: true,
        ...(opts?.reviewSentAt ? { review_sent_at: opts.reviewSentAt } : {}),
        ...(opts?.reviewSendMethod ? { review_send_method: opts.reviewSendMethod } : {}),
      } as Partial<Job>,
      { notifyPartner: false },
    );
    if (!updated) return;
    try {
      const financeAnchorDate = updated.scheduled_date ? new Date(updated.scheduled_date) : new Date();
      const [linked, dueForAnchor, linkedSelfBills] = await Promise.all([
        listInvoicesLinkedToJob(updated.reference, updated.invoice_id),
        getInvoiceDueDateIsoForClient(updated.client_id ?? null, financeAnchorDate),
        updated.partner_id?.trim()
          ? listSelfBillsLinkedToJob(updated.reference, updated.self_bill_id ?? null)
          : Promise.resolve([] as Awaited<ReturnType<typeof listSelfBillsLinkedToJob>>),
      ]);
      const primaryInvoice =
        (updated.invoice_id ? linked.find((i) => i.id === updated.invoice_id) : undefined) ??
        linked.find((i) => i.invoice_kind === "combined" || i.invoice_kind === "weekly_batch") ??
        linked[0];
      const invoiceId = await createDocumentAsDraft("invoice", updated, {
        amount: Math.max(0, jobBillableRevenue(updated)),
        financeAnchorDate,
        dueDate: dueForAnchor,
      });
      const partnerPaid = sumPartnerRecordedPayoutsForCap(partnerPayments);
      const partnerDue = Math.max(0, partnerPaymentCap(updated) - partnerPaid);
      const selfBillHint =
        updated.self_bill_id ??
        linkedSelfBills.find((s) => s.status === "accumulating" || s.status === "pending_review" || s.status === "draft")?.id ??
        null;
      const selfBillId =
        updated.partner_id?.trim() && (partnerSelfBillGrossAmount(updated) > 0 || partnerDue > 0.02)
          ? await createDocumentAsDraft("selfbill", updated, { financeAnchorDate, selfBillIdHint: selfBillHint })
          : selfBillHint;
      const selfBillPrev = selfBillId ? linkedSelfBills.find((s) => s.id === selfBillId)?.status ?? "accumulating" : null;
      const invoicePrev = primaryInvoice?.status ?? "draft";
      let invoiceDone = false;
      let selfBillDone = false;
      try {
        if (invoiceId) {
          await finalizeDocument("invoice", invoiceId, {
            amount: Math.max(0, jobBillableRevenue(updated)),
            status: "pending",
            paid_date: undefined,
            collection_stage: "awaiting_final",
            due_date: dueForAnchor,
          });
          invoiceDone = true;
        }
        if (selfBillId) {
          await finalizeDocument("selfbill", selfBillId, { status: "awaiting_payment" });
          selfBillDone = true;
        }
      } catch (error) {
        if (invoiceDone && invoiceId) {
          try { await finalizeDocument("invoice", invoiceId, { status: invoicePrev }); } catch { /* best effort */ }
        }
        if (selfBillDone && selfBillId && selfBillPrev) {
          try { await finalizeDocument("selfbill", selfBillId, { status: selfBillPrev }); } catch { /* best effort */ }
        }
        throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not finalize draft invoice/self-bill.");
      return;
    }
    const depositPaid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    const finalPaid = customerPayments.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
    const paid = depositPaid + finalPaid;
    const bill = jobBillableRevenue(updated);
    const dueAfter = Math.max(0, bill - paid);
    if (dueAfter > 0.02) {
      await handleStatusChange(updated, "awaiting_payment");
    } else {
      const completeCheck = canAdvanceJob(updated, "completed", {
        customerPayments: customerPayments.map((p) => ({ type: p.type, amount: p.amount })),
        partnerPayments: partnerPayments.map((p) => ({ type: p.type, amount: p.amount })),
      });
      if (completeCheck.ok) {
        await handleStatusChange(updated, "completed");
        toast.success("Report sent — no customer balance due; job marked completed.");
      } else {
        await handleStatusChange(updated, "awaiting_payment");
        toast.info(completeCheck.message ?? "Moved to Awaiting payment to settle partner / admin checks.");
      }
    }
  }, [
    handleJobUpdate,
    handleStatusChange,
    customerPayments,
    partnerPayments,
    createDocumentAsDraft,
    finalizeDocument,
  ]);

  const handleValidateAndComplete = useCallback(async () => {
    const j = jobRef.current;
    if (!j) return;
    const localPhaseIndexes = reportPhaseIndices(normalizeTotalPhases(j.total_phases));
    const localReportsUploaded = localPhaseIndexes.every((n) => Boolean(j[`report_${n}_uploaded` as keyof Job]));
    const localReportsApproved = localPhaseIndexes.every((n) => Boolean(j[`report_${n}_approved` as keyof Job]));
    if ((!localReportsUploaded || !localReportsApproved || !ownerApprovalChecked) && !forceApprovalChecked) {
      toast.error("Complete all mandatory checks: reports uploaded/approved and owner authorization.");
      return;
    }
    if (
      (!localReportsUploaded || !localReportsApproved || !ownerApprovalChecked) &&
      forceApprovalChecked &&
      !forceApprovalReason.trim()
    ) {
      toast.error("Enter a written reason for force approval.");
      return;
    }
    const usedForceApprove =
      (!localReportsUploaded || !localReportsApproved || !ownerApprovalChecked) && forceApprovalChecked;
    setValidatingComplete(true);
    try {
      let current = j;
      if (current.status === "on_hold") {
        const timerBasis = { ...current, status: "on_hold" as Job["status"] };
        const unholdPatch: Partial<Job> = {
          status: "final_check",
          on_hold_previous_status: null,
          on_hold_at: null,
          on_hold_reason: null,
          on_hold_snapshot_scheduled_date: null,
          on_hold_snapshot_scheduled_start_at: null,
          on_hold_snapshot_scheduled_end_at: null,
          on_hold_snapshot_scheduled_finish_date: null,
          ...statusChangePartnerTimerPatch(timerBasis, "final_check"),
          ...statusChangeOfficeTimerPatch(timerBasis, "final_check"),
        };
        const unheld = await handleJobUpdate(current.id, unholdPatch, {
          notifyPartner: false,
          silent: true,
          skipSelfBillSync: true,
        });
        if (!unheld) {
          throw new Error("Could not move job out of On hold before approval.");
        }
        current = unheld;
      }

      const r2 = (s: string) => Math.round((parseFloat(s) || 0) * 100) / 100;
      const extrasFromForm = r2(finForm.extras_amount);
      const materialsFromForm = r2(finForm.materials_cost);
      const depositFromForm = r2(finForm.customer_deposit);

      /** One round-trip instead of 2–3 sequential updates (each updateJob did 2× getJob + self-bill sync). */
      const mergedApprovalPatch: Partial<Job> = {
        report_submitted: true,
        report_submitted_at: current.report_submitted_at ?? new Date().toISOString(),
        internal_report_approved: true,
        internal_invoice_approved: true,
        extras_amount: extrasFromForm,
        materials_cost: materialsFromForm,
        customer_deposit: depositFromForm,
      };

      if (current.job_type === "hourly") {
        const { clientRate, partnerRate } = resolveJobHourlyRates(current);
        const typedHours = Math.max(0, Number(approvalBilledHoursInput) || 0);
        const elapsedSeconds =
          typedHours > 0
            ? Math.round(typedHours * 3600)
            : (officeTimerDisplaySeconds ?? computeOfficeTimerElapsedSeconds(current));
        const totals = computeHourlyTotals({
          elapsedSeconds,
          clientHourlyRate: clientRate,
          partnerHourlyRate: partnerRate,
        });
        const customerFinal = Math.max(0, totals.clientTotal + extrasFromForm - depositFromForm);
        const mergedForDerived = {
          ...current,
          client_price: totals.clientTotal,
          partner_cost: totals.partnerTotal,
          extras_amount: extrasFromForm,
          customer_deposit: depositFromForm,
        } as Job;
        Object.assign(mergedApprovalPatch, {
          billed_hours: totals.billedHours,
          hourly_client_rate: clientRate,
          hourly_partner_rate: partnerRate,
          client_price: totals.clientTotal,
          partner_cost: totals.partnerTotal,
          customer_final_payment: customerFinal,
          ...deriveStoredJobFinancials(mergedForDerived),
        });
      }

      const afterBatch = await handleJobUpdate(current.id, mergedApprovalPatch, {
        notifyPartner: false,
        silent: true,
        skipSelfBillSync: true,
      });
      if (!afterBatch) {
        throw new Error("Could not save approval and billing on the job.");
      }
      current = afterBatch;
      /** Downstream payout-state refresh — does not feed any read below; fire-and-forget to keep the critical path lean. */
      if (current.self_bill_id) {
        void syncSelfBillAfterJobChange(current).catch(() => {});
      }

      const depositPaid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
      const finalPaid = customerPayments.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
      const billableForCollections = Math.max(jobBillableRevenue(current), customerScheduledTotal(current));
      const customerDue = Math.max(0, billableForCollections - (depositPaid + finalPaid));
      const partnerPaid = sumPartnerRecordedPayoutsForCap(partnerPayments);
      const partnerDue = Math.max(0, partnerPaymentCap(current) - partnerPaid);

      /** Single instant for invoice due date, weekly invoice week, and partner self-bill week (this approve action only). */
      const financeAnchorDate = current.scheduled_date ? new Date(current.scheduled_date) : new Date();
      const wantsSelfBill = !!current.partner_id?.trim();
      const selfBillIdBeforePartnerSection = current.self_bill_id ?? null;

      /** Read all linked documents before deciding draft/final transitions. */
      const [linked, linkedSelfBills, dueForAnchor] = await Promise.all([
        listInvoicesLinkedToJob(current.reference, current.invoice_id),
        wantsSelfBill
          ? listSelfBillsLinkedToJob(current.reference, current.self_bill_id ?? null)
          : Promise.resolve([] as Awaited<ReturnType<typeof listSelfBillsLinkedToJob>>),
        getInvoiceDueDateIsoForClient(current.client_id ?? null, financeAnchorDate),
      ]);

      // Default path is internal; optional client email runs when `completionDelivery === "email"`.
      let primaryInvoiceId = current.invoice_id ?? null;
      if (!primaryInvoiceId && linked.length > 0) {
        const pick =
          linked.find((i) => i.invoice_kind === "combined" || i.invoice_kind === "weekly_batch") ?? linked[linked.length - 1];
        primaryInvoiceId = pick.id;
      }
      const primaryInvoiceRow = primaryInvoiceId ? linked.find((i) => i.id === primaryInvoiceId) : undefined;
      const invoiceForPaidCheck =
        primaryInvoiceRow ??
        linked.find((i) => i.invoice_kind === "combined" || i.invoice_kind === "weekly_batch") ??
        linked[0];
      const invoiceShowsPaidInDb =
        Boolean(invoiceForPaidCheck) &&
        (invoiceForPaidCheck!.status === "paid" || isInvoiceFullyPaidByAmount(invoiceForPaidCheck!));
      const customerDueForStatus = invoiceShowsPaidInDb ? 0 : customerDue;

      let primarySelfBillId = current.self_bill_id ?? null;
      if (!primarySelfBillId && linkedSelfBills.length > 0) {
        const pick =
          linkedSelfBills.find((s) => s.status === "accumulating" || s.status === "pending_review") ??
          linkedSelfBills[linkedSelfBills.length - 1];
        primarySelfBillId = pick?.id ?? null;
      }
      const shouldCreateSelfBill = wantsSelfBill && (partnerSelfBillGrossAmount(current) > 0 || partnerDue > 0.02);

      const [draftInvoiceId, draftSelfBillId] = await Promise.all([
        createDocumentAsDraft("invoice", current, {
          amount: Math.max(customerDue, Math.max(0, jobBillableRevenue(current))),
          financeAnchorDate,
          dueDate: dueForAnchor,
        }),
        shouldCreateSelfBill
          ? createDocumentAsDraft("selfbill", current, { financeAnchorDate, selfBillIdHint: primarySelfBillId })
          : Promise.resolve(primarySelfBillId),
      ]);

      const invoiceRowForFinalize =
        (draftInvoiceId ? linked.find((i) => i.id === draftInvoiceId) : undefined) ??
        linked.find((i) => i.id === primaryInvoiceId) ??
        linked.find((i) => i.invoice_kind === "combined" || i.invoice_kind === "weekly_batch") ??
        linked[0];
      const selfBillRowForFinalize = draftSelfBillId
        ? linkedSelfBills.find((s) => s.id === draftSelfBillId) ?? null
        : null;

      const previousInvoiceStatus = invoiceRowForFinalize?.status ?? "draft";
      const previousSelfBillStatus = selfBillRowForFinalize?.status ?? "accumulating";
      const finalInvoiceStatus: Invoice["status"] = customerDue <= 0.02 ? "paid" : "pending";
      const finalSelfBillStatus: SelfBill["status"] = partnerDue > 0.02 ? "awaiting_payment" : "ready_to_pay";
      let invoiceFinalized = false;
      let selfBillFinalized = false;
      try {
        if (draftInvoiceId) {
          await finalizeDocument("invoice", draftInvoiceId, {
            amount: Math.max(0, customerDue),
            status: finalInvoiceStatus,
            paid_date: finalInvoiceStatus === "paid" ? new Date().toISOString().slice(0, 10) : undefined,
            collection_stage: finalInvoiceStatus === "paid" ? "completed" : "awaiting_final",
            due_date: dueForAnchor,
          });
          invoiceFinalized = true;
        }
        if (draftSelfBillId) {
          await finalizeDocument("selfbill", draftSelfBillId, { status: finalSelfBillStatus });
          selfBillFinalized = true;
        }
      } catch (error) {
        if (invoiceFinalized && draftInvoiceId) {
          try {
            await finalizeDocument("invoice", draftInvoiceId, { status: previousInvoiceStatus });
          } catch {
            /* best-effort rollback */
          }
        }
        if (selfBillFinalized && draftSelfBillId) {
          try {
            await finalizeDocument("selfbill", draftSelfBillId, { status: previousSelfBillStatus });
          } catch {
            /* best-effort rollback */
          }
        }
        throw error;
      }

      const invoiceResult = { id: draftInvoiceId, markPaid: finalInvoiceStatus === "paid" };
      const resolvedSelfBillId = draftSelfBillId;

      if (invoiceResult.markPaid && invoiceResult.id) {
        // Ledger sync is downstream; nothing below reads from it — fire-and-forget.
        void syncJobAfterInvoicePaidToLedger(getSupabase(), invoiceResult.id, "Manual").catch((e) =>
          console.error("syncJobAfterInvoicePaidToLedger failed", e),
        );
      }

      /** Merge invoice_id + self_bill_id links into the status change PATCH — eliminates a separate round-trip. */
      const linkPatch: Partial<Job> = {};
      if (invoiceResult.id && invoiceResult.id !== current.invoice_id) {
        linkPatch.invoice_id = invoiceResult.id;
      }
      if (resolvedSelfBillId && resolvedSelfBillId !== selfBillIdBeforePartnerSection) {
        linkPatch.self_bill_id = resolvedSelfBillId;
      }

      // Never re-derive hourly totals from the office timer here — this flow already applied modal hours + rates,
      // and timer-based recalc would overwrite approved amounts (and desync the finance summary from the invoice).
      const statusOpts = { skipHourlyRecalc: current.job_type === "hourly", silent: true, skipSelfBillSync: true, extraPatch: linkPatch };
      let approvalToast: string;
      if (customerDueForStatus > 0.02 || partnerDue > 0.02) {
        const next = await handleStatusChange(current, "awaiting_payment", statusOpts);
        if (next) current = next;
        approvalToast = "Approved. Job moved to Awaiting payment.";
      } else {
        const next = await handleStatusChange(current, "completed", statusOpts);
        if (next) current = next;
        approvalToast = "Approved. Job marked Completed & paid.";
      }
      /** Self-bill sync after status change — fire-and-forget to keep critical path lean. */
      if (current.self_bill_id) {
        void syncSelfBillAfterJobChange(current).catch(() => {});
      }
      if (usedForceApprove && forceApprovalReason.trim()) {
        const reason = forceApprovalReason.trim();
        const stampLine = `[${new Date().toISOString().slice(0, 19)}Z] Forced approval (mandatory checks incomplete). Reason: ${reason} — ${profile?.full_name?.trim() || "User"}`;
        const prevNotes = (current.internal_notes ?? "").trim();
        const combined = prevNotes ? `${prevNotes}\n\n${stampLine}` : stampLine;
        /** Audit log + notes update are independent writes — run them in parallel. */
        const [, withNotes] = await Promise.all([
          logAudit({
            entityType: "job",
            entityId: current.id,
            entityRef: current.reference,
            action: "note",
            fieldName: "review_force_approve",
            newValue: stampLine,
            userId: profile?.id,
            userName: profile?.full_name,
            metadata: { forced: true, reason },
          }),
          handleJobUpdate(current.id, { internal_notes: combined }, {
            notifyPartner: false,
            silent: true,
            skipSelfBillSync: true,
          }),
        ]);
        if (withNotes) current = withNotes;
      }
      if (completionDelivery === "email") {
        const wantInv = includeInvoiceInEmail && accountEmailPolicy.canIncludeInvoice;
        const wantRep = includeReportInEmail && accountEmailPolicy.canIncludeReport;
        try {
          const res = await fetch(`/api/jobs/${current.id}/final-review-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ includeInvoice: wantInv, includeReport: wantRep }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            toast.success(approvalToast);
            toast.error(
              data.error ?? "The job is finalised, but the client email could not be sent.",
              { duration: 10000 },
            );
          } else {
            toast.success(`${approvalToast} Client email sent.`);
          }
        } catch {
          toast.success(approvalToast);
          toast.error("The job is finalised, but the client email could not be sent.", { duration: 10000 });
        }
      } else {
        toast.success(approvalToast);
      }
      /** Finance refresh fans out 4 reads; nothing in this handler depends on it — let it run while the modal closes. */
      void refreshJobFinance().catch(() => {});
      setValidateCompleteOpen(false);
      setOwnerApprovalChecked(false);
      setForceApprovalChecked(false);
      setForceApprovalReason("");
      setSentToAccountsChecked(false);
      setApprovalBilledHoursInput("");
      setCompletionDelivery(null);
      setIncludeInvoiceInEmail(true);
      setIncludeReportInEmail(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to validate and complete job");
    } finally {
      setValidatingComplete(false);
    }
  }, [
    handleJobUpdate,
    handleStatusChange,
    customerPayments,
    partnerPayments,
    ownerApprovalChecked,
    forceApprovalChecked,
    forceApprovalReason,
    approvalBilledHoursInput,
    profile?.id,
    profile?.full_name,
    officeTimerDisplaySeconds,
    refreshJobFinance,
    createDocumentAsDraft,
    finalizeDocument,
    finForm.extras_amount,
    finForm.materials_cost,
    finForm.customer_deposit,
    completionDelivery,
    includeInvoiceInEmail,
    includeReportInEmail,
    accountEmailPolicy,
  ]);

  const billableRevenueForApproval = job ? jobCustomerBillableRevenueForCollections(job) : 0;
  const partnerCapForApproval = job ? partnerPaymentCap(job) : 0;

  const approvalModalElapsedSeconds = useMemo(() => {
    if (!job) return 0;
    return officeTimerDisplaySeconds ?? computeOfficeTimerElapsedSeconds(job);
  }, [job, officeTimerDisplaySeconds]);

  const approvalModalHourlyTotals = useMemo(() => {
    if (!job || job.job_type !== "hourly") return null;
    const { clientRate, partnerRate } = resolveJobHourlyRates(job);
    const typedHours = Math.max(0, Number(approvalBilledHoursInput) || 0);
    const elapsedSeconds = typedHours > 0 ? Math.round(typedHours * 3600) : approvalModalElapsedSeconds;
    return computeHourlyTotals({
      elapsedSeconds,
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
  }, [job, approvalModalElapsedSeconds, approvalBilledHoursInput]);

  const approvalBillableRevenue = useMemo(() => {
    if (!job) return 0;
    if (job.job_type === "hourly" && approvalModalHourlyTotals) {
      return approvalModalHourlyTotals.clientTotal + Number(job.extras_amount ?? 0);
    }
    return billableRevenueForApproval;
  }, [job, approvalModalHourlyTotals, billableRevenueForApproval]);

  const approvalPartnerCostForDirect = useMemo(() => {
    if (!job) return 0;
    if (job.job_type === "hourly" && approvalModalHourlyTotals) return approvalModalHourlyTotals.partnerTotal;
    return Number(job.partner_cost ?? 0);
  }, [job, approvalModalHourlyTotals]);

  const approvalPartnerCap = useMemo(() => {
    if (!job) return 0;
    if (job.job_type === "hourly" && approvalModalHourlyTotals) {
      return partnerPaymentCap({ ...job, partner_cost: approvalModalHourlyTotals.partnerTotal });
    }
    return partnerCapForApproval;
  }, [job, approvalModalHourlyTotals, partnerCapForApproval]);

  /** Partner “extra payout” slice for the same cap shown in this modal (recorded extras or hourly delta). */
  const approvalPartnerExtrasSplit = useMemo(() => {
    if (!job) return { base: 0, extra: 0 };
    const hourlyBasis = job.job_type === "hourly" && approvalModalHourlyTotals ? approvalModalHourlyTotals.partnerTotal : null;
    return partnerCashOutDisplaySplit(job, approvalPartnerCap, hourlyBasis);
  }, [job, approvalPartnerCap, approvalModalHourlyTotals]);

  /** Client-side add-ons included in billable (field extras_amount; may include access fees). */
  const approvalClientExtrasAmount = useMemo(
    () => (job ? Math.round(Math.max(0, Number(job.extras_amount ?? 0)) * 100) / 100 : 0),
    [job?.extras_amount, job?.id],
  );

  /** Suggested partner_cost for ~40% gross margin on client_price + extras_amount (materials fixed). */
  const suggestedPartnerCost40ForFinForm = useMemo(() => {
    if (!job || job.job_type === "hourly") return null;
    const cp = parseFloat(finForm.client_price) || 0;
    const ex = parseFloat(finForm.extras_amount) || 0;
    const mat = parseFloat(finForm.materials_cost) || 0;
    if (cp + ex <= 0) return null;
    return suggestedPartnerCostForTargetMargin({
      clientPrice: cp,
      extrasAmount: ex,
      materialsCost: mat,
      targetMarginPercent: SUGGESTED_PARTNER_MARGIN_HINT_PCT,
    });
  }, [job?.id, job?.job_type, finForm.client_price, finForm.extras_amount, finForm.materials_cost]);

  const jobTypeEditFixedSelectOptions = useMemo(
    () => [
      { value: "", label: "Select type of work..." },
      ...typeOfWorkLabelsFromCatalog(catalogServicesJobType, job?.title).map((name) => ({ value: name, label: name })),
    ],
    [job?.title, catalogServicesJobType],
  );

  const fixedSwitchPreview = useMemo(() => {
    if (!job || jobTypeEditTarget !== "fixed" || job.job_type !== "hourly") return null;
    const titleTrim = jobTypeEditFixedTitle.trim();
    if (!titleTrim) return null;
    const titleOut = normalizeTypeOfWork(titleTrim) || titleTrim;
    const matchedService = catalogServicesJobType.find((s) => {
      const a = (normalizeTypeOfWork(s.name) || s.name || "").trim().toLowerCase();
      const b = titleOut.trim().toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    if (matchedService) {
      const hrs = Math.max(1, Number(matchedService.default_hours) || 1);
      const clientRate = Number(matchedService.hourly_rate) || 0;
      const partnerRate = partnerHourlyRateFromCatalogBundle(matchedService.partner_cost, matchedService.default_hours);
      const totals = computeHourlyTotals({
        elapsedSeconds: hrs * 3600,
        clientHourlyRate: clientRate,
        partnerHourlyRate: partnerRate,
      });
      const sale = totals.clientTotal;
      const cost = totals.partnerTotal;
      const margin = sale - cost;
      const marginPct = sale > 0 ? Math.round((margin / sale) * 1000) / 10 : 0;
      return { sale, cost, margin, marginPct };
    }
    const sale = Math.max(0, Number(job.client_price ?? 0));
    const cost = Math.max(0, Number(job.partner_cost ?? 0));
    const margin = sale - cost;
    const marginPct = sale > 0 ? Math.round((margin / sale) * 1000) / 10 : 0;
    return { sale, cost, margin, marginPct };
  }, [job, jobTypeEditTarget, jobTypeEditFixedTitle, catalogServicesJobType]);

  /** Must run before any early return — same render as other hooks. */
  const finalReviewSummarySnapshot: FinalReviewSummarySnapshot | null = useMemo(() => {
    if (!validateCompleteOpen || !job) return null;
    const phaseCountInner = normalizeTotalPhases(job.total_phases);
    const phaseIndexesInner = reportPhaseIndices(phaseCountInner);
    const rows = phaseIndexesInner.map((n) => ({
      n,
      uploaded: Boolean(job[`report_${n}_uploaded` as keyof Job]),
      approved: Boolean(job[`report_${n}_approved` as keyof Job]),
    }));
    const reportsOk = rows.length > 0 && rows.every((r) => r.uploaded && r.approved);
    const reportsDetail = reportsOk
      ? "All reports uploaded and approved"
      : rows
          .filter((r) => !r.uploaded || !r.approved)
          .map((r) => (!r.uploaded ? `Report ${r.n}: missing` : `Report ${r.n}: not approved`))
          .join(" · ") || "—";
    return {
      invoiceTo: finalReviewBillingLabel?.invoiceTo ?? job.client_name?.trim() ?? "—",
      linkedAccountName: finalReviewBillingLabel?.linkedAccountName ?? null,
      emailTo: finalReviewBillingLabel?.email ?? null,
      emailLoading: finalReviewBillingLoading,
      finalAmountLabel: formatCurrency(approvalBillableRevenue),
      reportsOk,
      reportsDetail,
    };
  }, [
    validateCompleteOpen,
    job,
    approvalBillableRevenue,
    finalReviewBillingLabel,
    finalReviewBillingLoading,
  ]);

  if (loading || !id) {
    return (
      <PageTransition>
        <div className="min-h-[60vh] flex items-center justify-center text-text-tertiary">Loading job…</div>
      </PageTransition>
    );
  }

  if (!job) {
    return (
      <PageTransition>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-text-secondary">
          <p>Job not found.</p>
          <Button variant="outline" onClick={() => router.push("/jobs")}>Back to Jobs</Button>
        </div>
      </PageTransition>
    );
  }

  const displayStatus = effectiveJobStatusForDisplay(job);
  const config = statusConfig[displayStatus] ?? { label: displayStatus, variant: "default" as const };
  const statusColors = getStatusColors(displayStatus);
  /**
   * Ledger-derived sums of client/partner extras (excluding materials, which
   * is tracked separately in `materials_cost`). Used below as a defensive
   * floor so the Finance summary totals match the Extras breakdown even when
   * `job.extras_amount` / `partner_cost` / `partner_extras_amount` drift from
   * the `job_extra_entries` audit log.
   */
  const clientExtrasFromLedger = extraHistory.reduce((acc, row) => {
    if (row.side !== "client") return acc;
    if (extraHistoryBucket(row.extraType) === "materials") return acc;
    return acc + extraHistorySignedAmount(row);
  }, 0);
  const partnerExtrasFromLedger = extraHistory.reduce((acc, row) => {
    if (row.side !== "partner") return acc;
    if (extraHistoryBucket(row.extraType) === "materials") return acc;
    return acc + extraHistorySignedAmount(row);
  }, 0);
  const clientExtrasFromLedgerRounded = Math.max(0, Math.round(clientExtrasFromLedger * 100) / 100);
  const partnerExtrasFromLedgerRounded = Math.max(0, Math.round(partnerExtrasFromLedger * 100) / 100);
  const clientPriceClamp = Math.max(0, Number(job.client_price ?? 0));
  /** Same basis as linked invoice targets and `syncInvoicesFromJobCustomerPayments` (ticket + extras, schedule, hourly). */
  const billableRevenue = Math.max(
    jobCustomerBillableRevenueForCollections(job),
    clientPriceClamp + clientExtrasFromLedgerRounded,
  );
  const partnerStoredExtras = Math.max(0, Number(job.partner_extras_amount ?? 0));
  /**
   * Bump partnerCap by any ledger extras that exceed `partner_extras_amount`
   * so Cash out — Partner reflects unsynced ledger rows (defensive against
   * legacy schemas where `partner_extras_amount` lags behind the entries).
   */
  const partnerLedgerExcessAgainstStored = Math.max(0, partnerExtrasFromLedgerRounded - partnerStoredExtras);
  const partnerCapBase =
    job.job_type === "hourly" && hourlyAutoBilling
      ? Math.max(partnerPaymentCap(job), hourlyAutoBilling.partnerTotal)
      : partnerPaymentCap(job);
  const partnerCap = partnerCapBase + partnerLedgerExcessAgainstStored;
  const hourlyPartnerLabourForCashOut =
    job.job_type === "hourly" && hourlyAutoBilling ? hourlyAutoBilling.partnerTotal : null;
  /**
   * Split using the ORIGINAL (un-bumped) cap so the base stays anchored to the
   * subcontract labour; ledger-excess extras are layered on top of the resulting
   * extra line so Initial balance + Extras still equal the (bumped) cap.
   */
  const { base: partnerCashOutBase, extra: partnerCashOutExtraRaw } = partnerCashOutDisplaySplit(
    job,
    partnerCapBase,
    hourlyPartnerLabourForCashOut,
  );
  const partnerCashOutExtra = Math.round((partnerCashOutExtraRaw + partnerLedgerExcessAgainstStored) * 100) / 100;
  const partnerExtraFallback = Math.max(0, Number(job.partner_extras_amount ?? 0));
  const partnerExtraDisplay = Math.max(partnerCashOutExtra, partnerExtraFallback, partnerExtrasUiValue, partnerExtrasFromLedgerRounded);
  const hasPartnerExtra = partnerExtraDisplay > 0.02;
  const partnerExtraBreakdownTotal =
    Number(partnerExtraBreakdownUi.extra ?? 0) +
    Number(partnerExtraBreakdownUi.ccz ?? 0) +
    Number(partnerExtraBreakdownUi.parking ?? 0);
  const partnerExtraResidual = Math.max(0, Math.round((partnerExtraDisplay - partnerExtraBreakdownTotal) * 100) / 100);
  const partnerExtraLine = Math.round((Number(partnerExtraBreakdownUi.extra ?? 0) + partnerExtraResidual) * 100) / 100;
  const partnerMaterialsLine = Math.max(0, Number(job.materials_cost ?? 0));
  const partnerCashOutTotal = Math.max(0, partnerCap + partnerMaterialsLine);
  const directCost =
    job.job_type === "hourly" && hourlyAutoBilling
      ? hourlyAutoBilling.partnerTotal + Number(job.materials_cost ?? 0)
      : jobDirectCost(job);
  const profit = billableRevenue - directCost;
  const marginPct = billableRevenue > 0 ? Math.round((profit / billableRevenue) * 1000) / 10 : 0;
  const marginAppearance = jobDetailMarginAppearance(marginPct);
  const markedPaidBy = extractLastMarkedPaidBy(job.internal_notes);
  /** Transfers to partner only — excludes legacy rows that recorded extra payout as a payment (those are cost, not cash out). */
  const partnerPaidTotal = sumPartnerRecordedPayoutsForCap(partnerPayments);
  const partnerPayRemaining = Math.max(0, partnerCashOutTotal - partnerPaidTotal);
  const partnerClawbackOwed = partnerCancellationClawbackOwedGbp(job);
  const partnerUsesClawbackUi = job.status === "cancelled" && partnerClawbackOwed > 0.02;
  /** Partner owes office after cancel — ledger stays positive (`partner_cancellation_fee` / snapshot); payout column shows minus. */
  const partnerCashOutSummaryAmount = partnerUsesClawbackUi ? -partnerClawbackOwed : partnerCashOutTotal;
  const partnerPayoutLedgerRows = partnerPayments.filter(
    (p) => p.type === "partner" && !isLegacyMisclassifiedPartnerPayment(p),
  );
  const partnerLegacyCostAsPayoutRows = partnerPayments.filter(
    (p) => p.type === "partner" && isLegacyMisclassifiedPartnerPayment(p),
  );
  const customerDepositPaid = customerPayments
    .filter((p) => p.type === "customer_deposit")
    .reduce((s, p) => s + Number(p.amount), 0);
  const customerFinalPaidSum = customerPayments
    .filter((p) => p.type === "customer_final")
    .reduce((s, p) => s + Number(p.amount), 0);
  const scheduledCustomerTotal = customerScheduledTotal(job);
  const customerScheduleMismatch = Math.abs(billableRevenue - scheduledCustomerTotal) > 0.02;
  // Use actual payment records sum — not boolean flags — so the UI stays live without a page reload.
  const customerPaidTotal = customerDepositPaid + customerFinalPaidSum;
  const amountDue = Math.max(0, billableRevenue - customerPaidTotal);
  const finalBalanceTotal = Math.max(0, Number(job.customer_final_payment ?? 0));
  /** `extras_amount` includes manual extras and access fees folded in by CCZ/parking toggles — split display so CCZ/parking stay positive lines, not double-counted under “Extra charges”. */
  const explicitExtras = Math.max(0, Number(job.extras_amount ?? 0));
  const effectiveExtrasAmountForDisplay = Math.max(explicitExtras, clientExtrasUiValue);
  const cczFeeNominal = effectiveCustomerInCcz ? accessFees.cczFeeGbp : 0;
  const parkingFeeNominal = job.has_free_parking === false ? accessFees.parkingFeeGbp : 0;
  const attributedAccessNominal = cczFeeNominal + parkingFeeNominal;
  const attributedAccessForExtrasLine = Math.min(attributedAccessNominal, effectiveExtrasAmountForDisplay);
  const extrasNetOfAccess = Math.max(0, Math.round((effectiveExtrasAmountForDisplay - attributedAccessForExtrasLine) * 100) / 100);
  const clientExtraHistory = extraHistory.filter((row) => row.side === "client");
  const partnerExtraHistory = extraHistory.filter((row) => row.side === "partner");
  const partnerExtraEntriesSignedTotal = partnerExtraHistory.reduce(
    (sum, row) => sum + extraHistorySignedAmount(row),
    0,
  );
  const clientItemizedExtras = clientExtraHistory.length > 0;
  const partnerItemizedExtras = partnerExtraHistory.length > 0;
  const clientExtraTypeTotals = clientExtraHistory.reduce(
    (acc, row) => {
      const bucket = extraHistoryBucket(row.extraType);
      acc[bucket] += extraHistorySignedAmount(row);
      return acc;
    },
    { extra: 0, ccz: 0, parking: 0, materials: 0 },
  );
  const partnerExtraTypeTotals = partnerExtraHistory.reduce(
    (acc, row) => {
      const bucket = extraHistoryBucket(row.extraType);
      acc[bucket] += extraHistorySignedAmount(row);
      return acc;
    },
    { extra: 0, ccz: 0, parking: 0, materials: 0 },
  );
  const clientExtraCczDisplay = Math.max(
    effectiveCustomerInCcz ? accessFees.cczFeeGbp : 0,
    Math.round(clientExtraTypeTotals.ccz * 100) / 100,
  );
  const clientExtraParkingDisplay = Math.max(
    job.has_free_parking === false ? accessFees.parkingFeeGbp : 0,
    Math.round(clientExtraTypeTotals.parking * 100) / 100,
  );
  const clientExtraMaterialsDisplay = clientItemizedExtras
    ? Math.round(clientExtraTypeTotals.materials * 100) / 100
    : Math.max(0, Math.round(clientExtraTypeTotals.materials * 100) / 100);
  const extrasNetOfAccessAndMaterials = Math.max(
    0,
    Math.round((extrasNetOfAccess - Math.max(0, clientExtraMaterialsDisplay)) * 100) / 100,
  );
  const clientExtraPlainDisplay = clientItemizedExtras
    ? Math.round(clientExtraTypeTotals.extra * 100) / 100
    : Math.max(
        extrasNetOfAccessAndMaterials,
        Math.round(clientExtraTypeTotals.extra * 100) / 100,
      );
  const clientExtraTotalDisplay = Math.round(
    (clientExtraPlainDisplay + clientExtraCczDisplay + clientExtraParkingDisplay + clientExtraMaterialsDisplay) * 100,
  ) / 100;
  const partnerExtraUnifiedAmount = partnerItemizedExtras
    ? Math.round(partnerExtraEntriesSignedTotal * 100) / 100
    : Math.max(partnerExtraLine, Math.round(partnerExtraEntriesSignedTotal * 100) / 100);
  const partnerExtraPlainDisplay = partnerItemizedExtras
    ? Math.round(partnerExtraTypeTotals.extra * 100) / 100
    : Math.max(partnerExtraLine, Math.round(partnerExtraTypeTotals.extra * 100) / 100);
  const partnerExtraCczDisplay = Math.max(
    Math.round(Number(partnerExtraBreakdownUi.ccz ?? 0) * 100) / 100,
    Math.round(partnerExtraTypeTotals.ccz * 100) / 100,
  );
  const partnerExtraParkingDisplay = Math.max(
    Math.round(Number(partnerExtraBreakdownUi.parking ?? 0) * 100) / 100,
    Math.round(partnerExtraTypeTotals.parking * 100) / 100,
  );
  const partnerExtraTotalDisplay = Math.max(
    0,
    Math.round((partnerExtraPlainDisplay + partnerExtraCczDisplay + partnerExtraParkingDisplay + partnerMaterialsLine) * 100) / 100,
  );
  /**
   * Locked partner "Initial balance" — defensive against legacy schemas.
   *
   * `partnerCashOutBase` relies solely on `partner_extras_amount`. If that column is missing or
   * the `job_extra_entries` ledger hasn't been migrated, the recorded extras stay at 0 while
   * `partner_cost` grows, which would make Initial balance drift upward on refresh.
   *
   * We subtract the MAX of every available "extras against partner_cost" source so the base
   * stays anchored to the original subcontract labour regardless of which source lags.
   */
  const partnerPartnerCostLedgerTotal = partnerExtraHistory
    .filter((row) => {
      const alloc = row.allocation ?? null;
      return alloc === "partner_cost" || alloc === null;
    })
    .reduce((sum, row) => sum + extraHistorySignedAmount(row), 0);
  const partnerExtrasEffectiveAgainstCost = Math.max(
    Math.round(Number(job.partner_extras_amount ?? 0) * 100) / 100,
    Math.round(partnerPartnerCostLedgerTotal * 100) / 100,
    Math.round(partnerExtrasUiValue * 100) / 100,
  );
  const partnerInitialBalance = Math.max(
    0,
    Math.round((partnerCap - Math.min(partnerExtrasEffectiveAgainstCost, partnerCap)) * 100) / 100,
  );
  const clientFallbackEntries: ExtraHistoryEntry[] = clientExtraHistory.length === 0
    ? ([
        { key: "Extras", amount: clientExtraPlainDisplay, allocation: "extras" as const },
        { key: "CCZ", amount: clientExtraCczDisplay, allocation: "extras" as const },
        { key: "Parking", amount: clientExtraParkingDisplay, allocation: "extras" as const },
        { key: "Materials", amount: clientExtraMaterialsDisplay, allocation: "materials" as const },
      ]
        .filter((row) => row.amount > 0.02)
        .map((row, idx) => ({
          id: `fallback-client-${idx}`,
          idRaw: `fallback-client-${idx}`,
          side: "client" as const,
          amount: row.amount,
          extraType: row.key,
          reason: "Derived from current totals. Itemized history is unavailable in this environment.",
          createdAt: "",
          allocation: row.allocation,
        })))
    : [];
  const partnerFallbackEntries: ExtraHistoryEntry[] = partnerExtraHistory.length === 0
    ? ([
        { key: "Extra", amount: partnerExtraPlainDisplay, allocation: "partner_cost" as const },
        { key: "CCZ", amount: partnerExtraCczDisplay, allocation: "partner_cost" as const },
        { key: "Parking", amount: partnerExtraParkingDisplay, allocation: "partner_cost" as const },
        { key: "Materials", amount: partnerMaterialsLine, allocation: "materials" as const },
      ]
        .filter((row) => row.amount > 0.02)
        .map((row, idx) => ({
          id: `fallback-partner-${idx}`,
          idRaw: `fallback-partner-${idx}`,
          side: "partner" as const,
          amount: row.amount,
          extraType: row.key,
          reason: "Derived from current totals. Itemized history is unavailable in this environment.",
          createdAt: "",
          allocation: row.allocation,
        })))
    : [];
  const extraManagerEntries = extraManagerSide === "client"
    ? (clientExtraHistory.length > 0 ? clientExtraHistory : clientFallbackEntries)
    : (partnerExtraHistory.length > 0 ? partnerExtraHistory : partnerFallbackEntries);
  const extraManagerTitle = extraManagerSide === "client" ? "Manage client extras" : "Manage partner extras";
  const extraManagerEmptyText =
    extraManagerSide === "client"
      ? "No client charges or discounts recorded yet."
      : "No partner payouts or discounts recorded yet.";
  const extraManagerGroups: { key: ExtraHistoryBucket; label: string; entries: ExtraHistoryEntry[] }[] = [
    { key: "extra", label: "Labour", entries: [] },
    { key: "materials", label: "Materials", entries: [] },
    { key: "ccz", label: "CCZ", entries: [] },
    { key: "parking", label: "Parking", entries: [] },
  ];
  for (const entry of extraManagerEntries) {
    const bucket = extraHistoryBucket(entry.extraType);
    const g = extraManagerGroups.find((row) => row.key === bucket);
    if (g) g.entries.push(entry);
  }
  const renderExtraCategoryPencil = (
    side: "client" | "partner",
    bucket: ExtraHistoryBucket,
    visible: boolean,
  ) => {
    if (!visible) return null;
    return (
      <button
        type="button"
        className="text-text-tertiary transition-colors hover:text-text-primary"
        title="Edit or remove"
        aria-label="Edit or remove extras in this category"
        onClick={() => openExtraManager(side, bucketHasLedgerEntries(side, bucket) ? bucket : undefined)}
      >
        <Pencil className="h-3 w-3" />
      </button>
    );
  };

  let finalSplitRemain = finalBalanceTotal;
  const finalExtraCharges = Math.min(extrasNetOfAccess, finalSplitRemain);
  finalSplitRemain = Math.max(0, finalSplitRemain - finalExtraCharges);
  const finalCczLine = Math.min(cczFeeNominal, finalSplitRemain);
  finalSplitRemain = Math.max(0, finalSplitRemain - finalCczLine);
  const finalParkingLine = Math.min(parkingFeeNominal, finalSplitRemain);
  finalSplitRemain = Math.max(0, finalSplitRemain - finalParkingLine);
  const matsCap = Math.max(0, Number(job.materials_cost ?? 0));
  const finalMaterials = Math.min(matsCap, finalSplitRemain);
  finalSplitRemain = Math.max(0, finalSplitRemain - finalMaterials);
  const finalLabour = finalSplitRemain;

  const statusActions = getJobStatusActions(job);
  /** Primary bar: keep cancel out of the strip — it lives under ⋮. */
  const inlineStatusActions = statusActions.filter((a) => a.status !== "cancelled");
  const showCancelInJobMoreMenu = statusActions.some((a) => a.status === "cancelled");
  const phaseCount = normalizeTotalPhases(job.total_phases);
  /** V2 reports progress: counts only the reports the partner has actually
   *  submitted (denominator = 0/1/2). Pre-mig-162 jobs without V2 payloads
   *  fall back to the legacy phase counters. */
  const v2StartSubmitted = !!(job.start_report && Object.keys(job.start_report).length > 0);
  const v2FinalSubmitted = !!(job.final_report && Object.keys(job.final_report).length > 0);
  const v2SubmittedCount = (v2StartSubmitted ? 1 : 0) + (v2FinalSubmitted ? 1 : 0);
  const v2ApprovedCount =
    (v2StartSubmitted && job.start_report_approved_at ? 1 : 0) +
    (v2FinalSubmitted && job.final_report_approved_at ? 1 : 0);
  const reportsValidatedCount = v2SubmittedCount > 0
    ? v2ApprovedCount
    : reportPhaseIndices(phaseCount).filter((n) => Boolean(job[`report_${n}_approved` as keyof Job])).length;
  const reportsTotalCount = v2SubmittedCount > 0 ? v2SubmittedCount : phaseCount;
  const reportsProgressPercent =
    reportsTotalCount > 0 ? Math.min(100, Math.round((reportsValidatedCount / reportsTotalCount) * 100)) : 0;
  const displayPhase = phaseCount === 2 ? (job.report_2_uploaded ? 2 : 1) : 1;
  const sendReportFinalCheck = canSendReportAndRequestFinalPayment(job);
  const primaryInvoiceForBadge = job.invoice_id
    ? jobInvoices.find((inv) => inv.id === job.invoice_id) ?? jobInvoices[0]
    : jobInvoices[0];
  /** Invoice + self-bill stay “Draft” on this job until Review & approve (same gate as finalize in FinalReviewModal). */
  const financeDocsAwaitingJobApproval = !job.internal_invoice_approved;
  const financeDocDraftBadge = {
    label: "Draft" as const,
    className: "border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  };
  const financeDocSentBadge = {
    label: "Sent" as const,
    className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  };
  const financeDocCancelledBadge = {
    label: "Cancelled" as const,
    className: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
  const selfBillDbDraftStatuses = new Set<SelfBill["status"]>(["draft", "accumulating", "pending_review"]);
  const invoiceLifecycleBadge: { label: "Draft" | "Sent" | "Cancelled"; className: string } | null =
    primaryInvoiceForBadge
      ? primaryInvoiceForBadge.status === "cancelled"
        ? financeDocCancelledBadge
        : financeDocsAwaitingJobApproval || primaryInvoiceForBadge.status === "draft"
          ? financeDocDraftBadge
          : financeDocSentBadge
      : null;
  const selfBillLifecycleBadge: { label: "Draft" | "Sent" | "Cancelled"; className: string } | null = jobSelfBill
    ? ["payout_cancelled", "payout_lost", "payout_archived", "rejected"].includes(jobSelfBill.status)
      ? financeDocCancelledBadge
      : financeDocsAwaitingJobApproval || selfBillDbDraftStatuses.has(jobSelfBill.status)
        ? financeDocDraftBadge
        : financeDocSentBadge
    : null;
  const flowStep = jobFlowActiveStepIndex(job.status);
  const previousStageStatus = getPreviousJobStatus(job);
  const canReverseStage =
    Boolean(previousStageStatus) &&
    flowStep > 0 &&
    job.status !== "cancelled" &&
    job.status !== "completed";
  const reportsApproved = allConfiguredReportsApproved(job);
  const phaseIndexes = reportPhaseIndices(phaseCount);
  const reportsUploaded = phaseIndexes.every((n) => Boolean(job[`report_${n}_uploaded` as keyof Job]));
  const reportMediaUrls = extractReportMediaUrls(job.report_notes);
  const hasRecordedWorkTime = Number(job.timer_elapsed_seconds ?? 0) > 0 || (job.job_type === "hourly" && hourlyBilledSeconds > 0);
  const timeSpentLabel = job.job_type === "hourly"
    ? formatOfficeTimer(hourlyWorkDisplaySeconds)
    : officeTimerDisplaySeconds != null
      ? formatOfficeTimer(officeTimerDisplaySeconds)
      : partnerLiveActiveMs != null
        ? formatPartnerLiveTimer(partnerLiveActiveMs)
        : formatOfficeTimer(Number(job.timer_elapsed_seconds ?? 0) || 0);
  const progressTimerActiveVisual =
    job.timer_is_running ||
    (partnerLiveActiveMs != null && !job.partner_timer_ended_at && officeTimerDisplaySeconds == null);
  const progressTimerPausedBadge =
    (job.partner_timer_is_paused && !job.partner_timer_ended_at && officeTimerDisplaySeconds == null) ||
    job.status === "on_hold" ||
    (officeTimerDisplaySeconds != null &&
      !job.timer_is_running &&
      job.status === "scheduled" &&
      Number(job.timer_elapsed_seconds ?? 0) > 0);
  const progressTimerSubline =
    officeTimerDisplaySeconds != null
      ? job.timer_is_running
        ? "Running"
        : job.status === "on_hold"
          ? "On Hold"
          : job.status === "scheduled" && Number(job.timer_elapsed_seconds ?? 0) > 0
            ? "Paused"
            : "Saved"
      : partnerLiveActiveMs != null
        ? job.partner_timer_ended_at
          ? "Ended"
          : "Live"
        : hasRecordedWorkTime
          ? "Recorded"
          : "Not started";
  const attestationDisplayName = profile?.full_name?.trim() || job.owner_name?.trim() || "Victor";
  const ownerAttestationText = `I, ${attestationDisplayName}, confirm I checked this report and I take full responsibility for report and payment approval for this job.`;
  const forcedPaidBySystemOwner = isJobForcePaid(job.internal_notes);
  const jobStatusContext = buildJobDetailStatusContext(job, { forcedPaidBySystemOwner });
  const mandatoryChecksOk =
    reportsUploaded && reportsApproved && ownerApprovalChecked && sentToAccountsChecked;
  /** Either all mandatory checks pass, OR force flow (force requires both attestations + a reason ≥ 10 chars). */
  const canSubmitApproval =
    mandatoryChecksOk ||
    (forceApprovalChecked &&
      ownerApprovalChecked &&
      sentToAccountsChecked &&
      forceApprovalReason.trim().length >= 10);
  const customerPaidPct = billableRevenue > 0 ? Math.max(0, Math.min(100, (customerPaidTotal / billableRevenue) * 100)) : 100;
  const partnerPaidPct = partnerCap > 0 ? Math.max(0, Math.min(100, (partnerPaidTotal / partnerCap) * 100)) : 100;

  const invoicePastDueUnpaid = jobInvoices.some(
    (inv) =>
      inv.status !== "paid" &&
      inv.status !== "cancelled" &&
      inv.due_date &&
      invoiceBalanceDue(inv) > 0.02 &&
      new Date(String(inv.due_date).slice(0, 10)) < new Date(new Date().toISOString().slice(0, 10)),
  );
  const healthPaymentOverdue = amountDue > 0.02 && (invoicePastDueUnpaid || job.status === "awaiting_payment");
  const healthMissingPartner = !job.partner_id?.trim();
  const healthMissingScope = !(job.scope?.trim());
  const healthBarColorClass = statusColors.healthBarClass;
  const onHoldCalendarDays =
    job.status === "on_hold" && job.on_hold_at
      ? Math.max(0, differenceInCalendarDays(new Date(), parseISO(job.on_hold_at)))
      : 0;

  const approvalMaterialsCost = Number(job.materials_cost ?? 0);
  const approvalProfit = approvalBillableRevenue - approvalPartnerCostForDirect - approvalMaterialsCost;
  const approvalMarginPct = approvalBillableRevenue > 0 ? Math.round((approvalProfit / approvalBillableRevenue) * 10000) / 100 : 0;

  const approvalAmountDue = Math.max(0, approvalBillableRevenue - customerPaidTotal);
  /** Matches the main finance card: partner takes labour cap + materials reimbursement (same basis as partnerSelfBillGrossAmount). */
  const approvalPartnerGross = Math.max(0, approvalPartnerCap + approvalMaterialsCost);
  const approvalPartnerPayRemaining = Math.max(0, approvalPartnerGross - partnerPaidTotal);
  const approvalPrimaryInvoice = job.invoice_id
    ? jobInvoices.find((i) => i.id === job.invoice_id) ??
      jobInvoices.find((i) => i.invoice_kind === "combined" || i.invoice_kind === "weekly_batch") ??
      jobInvoices[0] ??
      null
    : jobInvoices.find((i) => i.invoice_kind === "combined" || i.invoice_kind === "weekly_batch") ?? jobInvoices[0] ?? null;
  const approvalInvoiceShowsPaid =
    Boolean(approvalPrimaryInvoice) &&
    (approvalPrimaryInvoice.status === "paid" || isInvoiceFullyPaidByAmount(approvalPrimaryInvoice));
  const approvalEffectiveCustomerDue = approvalInvoiceShowsPaid ? 0 : approvalAmountDue;
  const approvalCustomerPaidPct =
    approvalBillableRevenue > 0 ? Math.max(0, Math.min(100, (customerPaidTotal / approvalBillableRevenue) * 100)) : 100;
  const approvalPartnerPaidPct =
    approvalPartnerCap > 0 ? Math.max(0, Math.min(100, (partnerPaidTotal / approvalPartnerCap) * 100)) : 100;

  const jobBillingDetailsBody = (
    <div className="max-h-[min(72vh,620px)] space-y-4 overflow-y-auto pr-1 text-sm">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/30 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Client (money in)</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Total billable</span>
              <span className="font-semibold tabular-nums text-emerald-700">{formatCurrency(billableRevenue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Deposit scheduled</span>
              <span className="font-semibold tabular-nums">{formatCurrency(Number(job.customer_deposit ?? 0))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Final balance scheduled</span>
              <span className="font-semibold tabular-nums">{formatCurrency(Number(job.customer_final_payment ?? 0))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Extras (manual)</span>
              <span className={cn("font-semibold tabular-nums", extrasNetOfAccess > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                {extrasNetOfAccess > 0.02 ? `+${formatCurrency(extrasNetOfAccess)}` : formatCurrency(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">CCZ + Parking</span>
              <span className={cn("font-semibold tabular-nums", attributedAccessNominal > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                {attributedAccessNominal > 0.02 ? `+${formatCurrency(attributedAccessNominal)}` : formatCurrency(0)}
              </span>
            </div>
            <div className="border-t border-emerald-200/70 pt-1.5 flex items-center justify-between">
              <span className="text-text-secondary">Collected</span>
              <span className="font-semibold tabular-nums">{formatCurrency(customerPaidTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Still due</span>
              <span className={cn("font-bold tabular-nums", amountDue > 0.02 ? "text-red-600" : "text-emerald-700")}>
                {formatCurrency(amountDue)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-rose-200/70 bg-rose-50/30 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">Partner (money out)</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">
                {partnerUsesClawbackUi ? "Cancellation clawback (partner owes)" : "Partner total (incl. materials)"}
              </span>
              <span className="font-semibold tabular-nums text-rose-700">
                {partnerUsesClawbackUi ? formatCurrencyPrecise(-partnerClawbackOwed) : formatCurrency(partnerCashOutTotal)}
              </span>
            </div>
            {!partnerUsesClawbackUi ? (
              <>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Base labour</span>
              <span className="font-semibold tabular-nums">-{formatCurrency(partnerCashOutBase)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Total Extras</span>
              <span className={cn("font-semibold tabular-nums", hasPartnerExtra ? "text-rose-700" : "text-text-tertiary")}>
                {hasPartnerExtra ? `-${formatCurrency(partnerExtraDisplay)}` : formatCurrency(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Materials</span>
              <span className="font-semibold tabular-nums">-{formatCurrency(Math.max(0, Number(job.materials_cost ?? 0)))}</span>
            </div>
              </>
            ) : null}
            <div className="border-t border-rose-200/70 pt-1.5 flex items-center justify-between">
              <span className="text-text-secondary">Paid out</span>
              <span className="font-semibold tabular-nums">{formatCurrency(partnerPaidTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">{partnerUsesClawbackUi ? "Clawback (payout −)" : "Still due"}</span>
              <span className={cn("font-bold tabular-nums", partnerUsesClawbackUi || partnerPayRemaining > 0.02 ? "text-amber-700" : "text-emerald-700")}>
                {partnerUsesClawbackUi ? formatCurrencyPrecise(-partnerClawbackOwed) : formatCurrency(partnerPayRemaining)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-light bg-card p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Profit & Loss</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Revenue (client)</span>
            <span className="font-semibold tabular-nums text-emerald-700">{formatCurrency(billableRevenue)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Direct costs (partner + materials)</span>
            <span className="font-semibold tabular-nums text-red-600">-{formatCurrency(directCost)}</span>
          </div>
          <div className="border-t border-border-light pt-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Net profit / margin</span>
            <span className={cn("text-base font-bold tabular-nums", profit >= 0 ? "text-emerald-700" : "text-red-600")}>
              {formatCurrency(profit)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary">Margin %</span>
            <span className={cn("font-semibold tabular-nums", marginPct >= 0 ? "text-amber-700" : "text-red-600")}>
              {marginPct}%
            </span>
          </div>
        </div>
      </div>

      {quoteLineBreakdown && (
        <div className="rounded-md border border-border-light bg-surface-hover/30 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Client quote lines</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-card px-2 py-2">
              <p className="text-[10px] text-text-tertiary uppercase">Labour</p>
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(quoteLineBreakdown.totals.labour)}</p>
            </div>
            <div className="rounded-md border border-border bg-card px-2 py-2">
              <p className="text-[10px] text-text-tertiary uppercase">Materials</p>
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(quoteLineBreakdown.totals.materials)}</p>
            </div>
            <div className="rounded-md border border-border bg-card px-2 py-2">
              <p className="text-[10px] text-text-tertiary uppercase">Other</p>
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(quoteLineBreakdown.totals.other)}</p>
            </div>
          </div>
        </div>
      )}

      {customerScheduleMismatch ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Scheduled deposit + final ({formatCurrency(scheduledCustomerTotal)}) differs from billable total (
          {formatCurrency(billableRevenue)}). Adjust deposit/final on the Setup tab if needed.
        </p>
      ) : null}
    </div>
  );

  return (
    <PageTransition>
      <div className="w-full bg-[#fdfdfd] py-4 px-4 dark:bg-[#0f1115] sm:px-5">
        <div className="mx-auto w-full max-w-[1280px] overflow-hidden rounded-lg border border-border bg-card">
          <div className={cn("h-[3px] w-full shrink-0", healthBarColorClass)} aria-hidden />

          {/* ── TOP BAR ── */}
          <div className="border-b border-border-light px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  aria-label="Previous job"
                  title={prevJobNavId ? "Previous job in list" : "No previous job — open from Jobs list"}
                  disabled={!prevJobNavId}
                  onClick={() => goToPreviousJob()}
                  icon={<ChevronLeft className="h-3.5 w-3.5" />}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={refreshingJob}
                  className="h-7 w-7 shrink-0 rounded-full p-0"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={() => void refreshJobFinance()}
                  title="Reload job, payments, and documents from the server"
                  aria-label="Refresh job"
                />
                <h1 className="text-lg font-bold text-text-primary tabular-nums">{job.reference}</h1>
                <ZendeskTicketBadge
                  source={job.external_source}
                  ref={job.external_ref}
                  jobId={job.id}
                  zendeskSubdomain={process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN ?? null}
                />
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
                  <Badge variant={config.variant} dot={config.dot} size="sm" className={statusColors.topBadgeClass || undefined}>
                    {config.label}
                  </Badge>
                  <JobScheduleTimingChip job={job} />
                  {jobStatusContext ? <JobDetailStatusContextChip ctx={jobStatusContext} /> : null}
                </div>
                <JobOverdueBadge job={job} size="sm" />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {healthMissingPartner ? (
                  <span className="text-[10px] font-medium rounded-full px-2 py-0.5 border border-amber-500/45 bg-amber-500/10 text-amber-900 dark:text-amber-100">
                    {jobPartnerListKind(job) === "auto_assign" ? "⏳ Auto assigning" : "⚠ No partner"}
                  </span>
                ) : null}
                {healthMissingScope ? (
                  <span className="text-[10px] font-medium rounded-full px-2 py-0.5 border border-amber-500/45 bg-amber-500/10 text-amber-900 dark:text-amber-100">
                    ⚠ No scope
                  </span>
                ) : null}
            {inlineStatusActions.map((action, idx) => {
              const completeGreenClass =
                "border-emerald-600/45 bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm dark:border-emerald-700/55 dark:bg-emerald-600 dark:hover:bg-emerald-500";
              const holdDarkRedClass =
                "border-red-950/40 bg-red-950/[0.08] text-red-950 hover:bg-red-950/12 dark:border-red-900/55 dark:bg-red-950/45 dark:text-red-50 dark:hover:bg-red-950/55";
              const variant =
                action.destructive ? "danger" : action.primary && action.tone !== "success" ? "primary" : "outline";
              const toneClass = action.tone === "success" ? completeGreenClass : action.tone === "hold" ? holdDarkRedClass : undefined;
              return (
                <Button
                  key={`${action.special ?? action.status}-${idx}`}
                  variant={variant}
                  className={cn(toneClass, "h-8 px-2.5 text-xs")}
                  size="sm"
                  icon={<action.icon className="h-3.5 w-3.5" />}
                  disabled={action.special === "send_report_invoice" ? !sendReportFinalCheck.ok : false}
                  title={action.special === "send_report_invoice" ? sendReportFinalCheck.message : undefined}
                  onClick={() => {
                    if (action.special === "put_on_hold") {
                      setPutOnHoldReason("");
                      setPutOnHoldPreset(null);
                      setPutOnHoldOpen(true);
                      return;
                    }
                    if (action.special === "resume_job") {
                      openResumeJobModal();
                      return;
                    }
                    if (action.special === "send_report_invoice") {
                      setApprovalMode("review_approve");
                      setOwnerApprovalChecked(true);
                      setForceApprovalChecked(false);
                      setForceApprovalReason("");
                      setSentToAccountsChecked(false);
                      setValidateCompleteOpen(true);
                      return;
                    }
                    if (job.status === "need_attention" && action.status === "completed") {
                      setApprovalMode("validate_complete");
                      setOwnerApprovalChecked(false);
                      setForceApprovalChecked(false);
                      setForceApprovalReason("");
                      setSentToAccountsChecked(false);
                      setValidateCompleteOpen(true);
                      return;
                    }
                    void handleStatusChange(job, action.status as Job["status"]);
                  }}
                >
                  {action.label}
                </Button>
              );
            })}
                <div className="relative" ref={jobMoreMenuRef}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    aria-label="More job actions"
                    aria-expanded={jobMoreMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setJobMoreMenuOpen((o) => !o)}
                    icon={<MoreVertical className="h-3.5 w-3.5" />}
                  />
                  {jobMoreMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-1 min-w-[12.5rem] rounded-lg border border-border-light bg-card py-1 shadow-lg dark:border-border"
                    >
                      {JOB_DETAIL_MULTI_VISITS_UI_ENABLED ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-primary hover:bg-surface-hover"
                          onClick={() => {
                            setJobMoreMenuOpen(false);
                            setVisitOpenCreateSignal((k) => k + 1);
                            setDetailTab(6);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0" />
                          Add visit
                        </button>
                      ) : null}
                      {job.status !== "cancelled" && job.status !== "deleted" ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-primary hover:bg-surface-hover"
                          onClick={() => void openQuickReschedule()}
                        >
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          Reschedule
                        </button>
                      ) : null}
                      {showCancelInJobMoreMenu ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                          onClick={() => {
                            setJobMoreMenuOpen(false);
                            setCancelJobOpen(true);
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          Cancel job
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  aria-label="Next job"
                  title={nextJobNavId ? "Next job in list" : "No next job — open from Jobs list"}
                  disabled={!nextJobNavId}
                  onClick={() => goToNextJob()}
                  icon={<ChevronRight className="h-3.5 w-3.5" />}
                />
              </div>
            </div>
          </div>

        <div className="space-y-0">
        {/* Status context (on hold reason, cancellation, paid, lost) — compact chip in header next to badge */}

        {job.status !== "cancelled" && job.status !== "deleted" ? (
          <section className="border-b border-border-light bg-card/30" aria-label="Work time and job progress">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-baseline gap-2">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {JOB_FLOW_STEPS[flowStep]?.label ?? "Progress"}
                  </p>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-text-tertiary">
                    Step {Math.min(flowStep + 1, JOB_FLOW_STEPS.length)} of {JOB_FLOW_STEPS.length}
                  </span>
                  {canReverseStage ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#ddd] bg-transparent px-2.5 py-1 text-xs text-[#888] transition-colors hover:border-[#d97706] hover:bg-[#fef3c7] hover:text-[#d97706]"
                      onClick={() => {
                        if (!previousStageStatus) return;
                        void handleStatusChange(job, previousStageStatus);
                      }}
                      title="Go back one stage"
                    >
                      <ChevronLeft className="h-[11px] w-[11px]" />
                      Back stage
                    </button>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div
                    className={cn(
                      "inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-border-light bg-card/80 px-1.5 py-0.5",
                      progressTimerActiveVisual && "border-emerald-500/25 bg-emerald-500/10",
                    )}
                  >
                    <Timer className="h-3 w-3 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden />
                    <span className="truncate text-[10px] text-text-secondary">{progressTimerSubline}</span>
                    <span className="text-[11px] font-bold tabular-nums text-text-primary">{timeSpentLabel}</span>
                    {canEditWorkTime ? (
                      <button
                        type="button"
                        className="ml-0.5 shrink-0 rounded p-0.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-primary"
                        onClick={openWorkTimeEditor}
                        title={
                          job.job_type === "hourly"
                            ? "Edit work time (updates pricing)"
                            : "Edit recorded time"
                        }
                        aria-label="Edit work time"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                  {progressTimerPausedBadge ? (
                    <Badge variant="warning" size="sm" className="h-5 px-1 text-[9px]">
                      Paused
                    </Badge>
                  ) : null}
                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {Math.round(((flowStep + 1) / JOB_FLOW_STEPS.length) * 100)}% complete
                  </span>
                </div>
              </div>
              <ol
                className="mt-1.5 flex w-full items-start gap-0 overflow-x-auto pb-1 [scrollbar-width:thin] md:grid md:grid-cols-6 md:overflow-visible"
                role="list"
              >
                {JOB_FLOW_STEPS.map((step, idx) => {
                  const done = statusColors.completedAllSteps || flowStep > idx;
                  const current = flowStep === idx;
                  const currentOrCompletedActive = statusColors.completedAllSteps || current;
                  const Icon = step.icon;
                  const isOnHoldStep = (step.statuses as readonly string[]).includes("on_hold");
                  const isAwaitingPayStep = (step.statuses as readonly string[]).includes("awaiting_payment");
                  const onHoldStuck = isOnHoldStep && job.status === "on_hold" && onHoldCalendarDays > 2;
                  const payStepOverdue = isAwaitingPayStep && healthPaymentOverdue;
                  const dotClass = payStepOverdue
                    ? "border-red-600 bg-red-50 text-red-700 dark:bg-red-950/35 dark:text-red-300"
                    : onHoldStuck
                      ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                      : currentOrCompletedActive
                        ? statusColors.activeStepDotClass
                        : done
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-border bg-muted/60 text-text-tertiary";
                  const labelClass = payStepOverdue
                    ? "text-red-600 dark:text-red-400 font-semibold"
                    : onHoldStuck
                      ? "text-amber-700 dark:text-amber-300 font-semibold"
                      : currentOrCompletedActive
                        ? statusColors.activeStepLabelClass
                        : done
                          ? "text-emerald-800 dark:text-emerald-300/90 font-medium"
                          : "text-text-tertiary font-medium";
                  return (
                    <li
                      key={step.label}
                      className="relative flex min-w-[3.5rem] flex-1 flex-col items-center px-0.5 text-center md:min-w-0"
                      aria-current={current ? "step" : undefined}
                    >
                      {idx > 0 ? (
                        <div
                          className="absolute left-0 top-[11px] hidden h-px w-1/2 -translate-x-1/2 bg-border md:block"
                          aria-hidden
                        />
                      ) : null}
                      <div className="relative z-[1] flex flex-col items-center gap-0.5">
                        {done && !(isAwaitingPayStep && payStepOverdue) && !onHoldStuck ? (
                          <span
                            className={cn(
                              "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-600 text-white shadow-sm",
                            )}
                          >
                            <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                              dotClass,
                            )}
                          >
                            <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} aria-hidden />
                          </span>
                        )}
                        <span className={cn("max-w-[5.5rem] text-[10px] leading-tight text-balance sm:max-w-none", labelClass)}>
                          {step.label}
                        </span>
                        {onHoldStuck ? (
                          <span className="text-[9px] font-medium text-amber-700 dark:text-amber-400">{onHoldCalendarDays}d parado</span>
                        ) : payStepOverdue ? (
                          <span className="text-[9px] font-medium text-red-600 dark:text-red-400">Payment overdue</span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        ) : (
          <p className="mx-3 mb-3 text-sm text-text-tertiary">This job was cancelled — workflow stopped.</p>
        )}

        {/* ── Job amount / margin (compact metrics bar) ── */}
        <div className="grid min-h-0 grid-cols-2 divide-x divide-y divide-border-light border-b border-border-light bg-surface-hover/30 px-1 py-2 dark:bg-surface-secondary/20 lg:grid-cols-4 lg:divide-y-0">
          <div className="flex min-w-0 flex-col justify-center border-border-light px-3 py-3 sm:px-4 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Job Amount</p>
            <p className="text-2xl font-bold tabular-nums leading-tight tracking-tight text-text-primary">{formatCurrency(billableRevenue)}</p>
            <p className="mt-0.5 text-[10px] text-text-tertiary leading-none">Incl. extras</p>
          </div>
          <div className="flex min-w-0 flex-col justify-center border-border-light px-3 py-3 sm:px-4 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Partner Cost</p>
            <p className="text-2xl font-bold tabular-nums leading-tight tracking-tight text-text-secondary">{formatCurrency(Number(job.partner_cost ?? 0))}</p>
          </div>
          <div className="flex min-w-0 flex-col justify-center border-border-light px-3 py-3 sm:px-4 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Margin</p>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums leading-tight tracking-tight",
                profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
              )}
            >
              {formatCurrency(profit)}
            </p>
            <p className="mt-0.5 text-[10px] text-text-tertiary leading-none">After partner + materials</p>
          </div>
          <div className="flex min-w-0 flex-col justify-center px-3 py-3 sm:px-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Margin %</p>
            <p className={cn("text-2xl font-bold tabular-nums tracking-tight", marginAppearance.pctClass)}>{marginPct}%</p>
          </div>
        </div>

        {/* ── MAIN GRID (sidebar stacks below main until lg) ── */}
        <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
          {/* ═══ LEFT — operational column ═══ */}
          <div className="min-h-0 min-w-0 space-y-3 border-border-light p-3 sm:p-4 lg:border-r">

            {/* MAP + CLIENT + SCHEDULE */}
            <div className="overflow-hidden rounded-xl border border-border-light bg-white shadow-sm ring-1 ring-black/[0.04] dark:border-[#2b313d] dark:bg-[#141922] dark:ring-white/[0.03]">
              <div className="grid min-h-0 grid-cols-1 bg-white dark:bg-[#141922] sm:grid-cols-2 sm:divide-x sm:divide-border-light dark:sm:divide-[#2b313d]">
                <div className="relative min-h-[200px] w-full min-w-0 border-b border-border-light bg-gradient-to-b from-sky-50/50 to-surface-hover/40 sm:min-h-[240px] sm:border-b-0">
                  <LocationMiniMap
                    address={job.property_address}
                    className="flex h-full min-h-[200px] w-full min-w-0 flex-col sm:min-h-[240px]"
                    mapHeight="100%"
                    showAddressBelowMap={false}
                    lazy
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-3 p-4">
                  {(() => {
                    const JobTypeIcon = getJobTypeIcon(job.title ?? "");
                    const typePillClass = getJobTypePillClass(job.title ?? "");
                    return job.title?.trim() ? (
                      <div className="mb-3 inline-flex self-start items-center gap-1.5">
                        <p className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold", typePillClass)}>
                          <JobTypeIcon className="h-[11px] w-[11px] shrink-0" />
                          {job.title.trim()}
                        </p>
                        <button
                          type="button"
                          className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-surface-hover text-text-tertiary transition-colors hover:border-primary/35 hover:bg-primary-light/60 hover:text-primary dark:border-[#2f3440] dark:bg-[#1a202a] dark:hover:border-primary/45 dark:hover:bg-primary/15 dark:hover:text-primary"
                          disabled={job.status === "cancelled"}
                          onClick={openJobBillingTypeEdit}
                          title="Edit type of work, pricing & assignment"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-text-tertiary">No service title</p>
                    );
                  })()}
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-sm font-semibold leading-tight text-text-primary">{job.client_name}</p>
                      {jobHeaderAccount ? (
                        <span
                          title={`Account: ${jobHeaderAccount.label}`}
                          className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border-light bg-surface-hover/90 px-2 py-0.5 text-xs font-semibold text-text-primary shadow-sm dark:border-[#2b313d] dark:bg-[#1a202a]/90"
                        >
                          {jobHeaderAccount.logoUrl ? (
                            <img
                              src={jobHeaderAccount.logoUrl}
                              alt=""
                              width={16}
                              height={16}
                              className="h-3.5 w-3.5 shrink-0 rounded object-contain sm:h-4 sm:w-4"
                              loading="lazy"
                            />
                          ) : (
                            <Building2 className="h-3 w-3 shrink-0 text-text-tertiary opacity-70" aria-hidden />
                          )}
                          <span className="min-w-0 truncate normal-case tracking-normal">{jobHeaderAccount.label}</span>
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-snug text-text-tertiary line-clamp-4">{job.property_address}</p>
                    {jobHeaderContact && (jobHeaderContact.phone || jobHeaderContact.email) ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-snug">
                        {jobHeaderContact.phone ? (() => {
                          const waHref = whatsAppHrefFromPhoneForJob(jobHeaderContact.phone);
                          return (
                            <span className="inline-flex min-w-0 items-center gap-1 text-text-secondary">
                              {waHref ? (
                                <a
                                  href={waHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 text-[#25D366] hover:opacity-90"
                                  title="WhatsApp"
                                  aria-label="Open WhatsApp chat"
                                >
                                  <JobHeaderWhatsAppIcon className="h-3 w-3" />
                                </a>
                              ) : null}
                              <a href={`tel:${jobHeaderContact.phone!.replace(/\s/g, "")}`} className="font-medium hover:underline">
                                {jobHeaderContact.phone}
                              </a>
                            </span>
                          );
                        })() : null}
                        {jobHeaderContact.email ? (
                          <a
                            href={`mailto:${jobHeaderContact.email}`}
                            className="min-w-0 max-w-[min(100%,14rem)] truncate text-text-tertiary hover:text-primary hover:underline"
                          >
                            {jobHeaderContact.email}
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {(() => {
                    const displayDate =
                      scheduleDate.trim() ||
                      job.scheduled_date?.slice(0, 10) ||
                      job.scheduled_start_at?.slice(0, 10) ||
                      "";
                    // Form state is in UK wall-clock; convert to UTC ISO so the
                    // UK-timezone formatters render the same hours back.
                    const uiStartUtcIso =
                      displayDate && scheduleTime.trim()
                        ? ukWallClockToUtcIso(displayDate, scheduleTime.trim())
                        : "";
                    const startIso = uiStartUtcIso || job.scheduled_start_at?.trim() || "";
                    const windowValue = Number(scheduleWindowMins);
                    const hasWindow = Number.isFinite(windowValue) && windowValue > 0;
                    const windowLabel =
                      ARRIVAL_WINDOW_OPTIONS.find((opt) => opt.value === scheduleWindowMins)?.label ??
                      (hasWindow ? `${Math.round(windowValue / 60)}h` : "No");
                    const rangeFromStored =
                      job.scheduled_start_at && job.scheduled_end_at
                        ? formatArrivalTimeRange(job.scheduled_start_at, job.scheduled_end_at)
                        : null;
                    const rangeFromUi =
                      hasWindow && uiStartUtcIso
                        ? formatArrivalTimeRange(
                            uiStartUtcIso,
                            new Date(new Date(uiStartUtcIso).getTime() + windowValue * 60_000).toISOString(),
                          )
                        : null;
                    const agreedArrivalRange = rangeFromStored || rangeFromUi;
                    const slotId =
                      scheduleTime.trim() && scheduleWindowMins.trim()
                        ? matchArrivalSlot(scheduleTime.trim(), scheduleWindowMins)
                        : null;
                    const slotLabel = slotId ? ARRIVAL_SLOTS.find((s) => s.id === slotId)?.label : null;
                    const arrivalDisplay = slotLabel ?? agreedArrivalRange;
                    return (
                      <div className="border-t border-[#e8e5e0] py-2.5 dark:border-[#2b313d]">
                        <div className="mt-1.5 flex items-center gap-2 text-sm text-[#444] dark:text-[#d2d8e2]">
                          <Calendar className="h-[13px] w-[13px] text-[#aaa] dark:text-[#7f899a]" />
                          <span>
                            {displayDate ? formatDate(displayDate) : "Not set"}{" "}
                            <span className="text-[#9a9a9a] dark:text-[#909aac]">visit date</span>
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-[#444] dark:text-[#d2d8e2]">
                          <Clock className="h-[13px] w-[13px] shrink-0 text-[#aaa] dark:text-[#7f899a]" />
                          <span>
                            {arrivalDisplay ? (
                              <span className="font-medium">Arrival: {arrivalDisplay}</span>
                            ) : startIso ? (
                              <>
                                {formatHourMinuteAmPm(new Date(startIso))}
                                <span className="text-[#9a9a9a] dark:text-[#909aac]"> · {windowLabel} window</span>
                              </>
                            ) : (
                              "Not set"
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  {!isHousekeepJobDetail ? (
                    <>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-start gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-[10px] sm:text-[11px] font-bold leading-snug max-w-[13rem]",
                            job.job_type === "hourly"
                              ? "border-[#7c3aed] bg-[#f5f3ff] text-[#5b21b6]"
                              : "border-[#333] bg-[#f4f2ef] text-[#1a1a1a] dark:border-[#6b7280] dark:bg-[#1f2631] dark:text-[#e5e7eb]",
                          )}
                        >
                          {job.job_type === "hourly" ? <Clock className="h-[11px] w-[11px] shrink-0 mt-0.5" /> : <Lock className="h-[11px] w-[11px] shrink-0 mt-0.5" />}
                          {pricingModeLabel(job.job_type === "hourly" ? "hourly" : "fixed")}
                        </span>
                        <button
                          type="button"
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface-hover text-text-tertiary transition-colors hover:border-primary/35 hover:bg-primary-light/60 hover:text-primary dark:border-[#2f3440] dark:bg-[#1a202a] dark:hover:border-primary/45 dark:hover:bg-primary/15 dark:hover:text-primary"
                          disabled={job.status === "cancelled"}
                          onClick={openJobBillingTypeEdit}
                          title="Edit pricing & assignment"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <span className="mx-1 h-4 border-l border-[#e8e5e0] dark:border-[#2f3440]" />
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            jobScheduleKindLabel === "Recurring"
                              ? "border-primary/35 bg-primary/10 text-primary"
                              : "border-border bg-surface-hover text-text-secondary dark:border-[#2f3440] dark:bg-[#1a202a]",
                          )}
                        >
                          {jobScheduleKindLabel}
                        </span>
                        {jobPartnerListKind(job) === "auto_assign" ? (
                          <Badge variant="info" dot size="sm" className="h-5 text-[10px] font-semibold normal-case">
                            Auto assign
                          </Badge>
                        ) : null}
                      </div>
                      {job.job_type === "hourly" && hourlyTimeEditOpen ? (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={hourlyEditHours}
                            onChange={(e) => setHourlyEditHours(e.target.value)}
                            className="h-8 w-14 text-center text-sm"
                          />
                          <span className="text-xs text-text-secondary">h</span>
                          <Input
                            type="number"
                            min={0}
                            max={59}
                            value={hourlyEditMinutes}
                            onChange={(e) => setHourlyEditMinutes(e.target.value)}
                            className="h-8 w-14 text-center text-sm"
                          />
                          <span className="text-xs text-text-secondary">m</span>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 px-3 text-xs"
                            loading={savingHourlyTimeEdit}
                            onClick={() => void handleSaveHourlyTimeEdit()}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            disabled={savingHourlyTimeEdit}
                            onClick={() => setHourlyTimeEditOpen(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                      {job.job_type === "fixed" && fixedRatesInlineOpen ? (
                        <div className="mt-2 rounded-lg border border-border bg-surface-secondary p-3 dark:border-[#2b313d] dark:bg-[#161c26]">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-text-secondary">Client rate £</label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={fixedInlineClientRate}
                                onChange={(e) => setFixedInlineClientRate(e.target.value)}
                                className="h-9 text-sm"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-text-secondary">Partner Cost £</label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={fixedInlinePartnerCost}
                                onChange={(e) => setFixedInlinePartnerCost(e.target.value)}
                                className="h-9 text-sm"
                              />
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              className="h-9"
                              loading={savingFixedInlineRates}
                              onClick={() => void handleSaveFixedInlineRates()}
                            >
                              Update rates
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9"
                              disabled={savingFixedInlineRates}
                              onClick={() => setFixedRatesInlineOpen(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                          <p className="mt-2 text-[10px] text-text-tertiary">This will update the invoice amount</p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              <div style={{ borderTop: "0.5px solid #E4E4E8" }}>
                <button
                  type="button"
                  onClick={() => setClientEditAccordionOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 px-[18px] py-[14px] text-left"
                  style={{ background: "#FAFAFB" }}
                >
                  <span
                    className="inline-flex items-center gap-[6px] text-[13px] font-medium"
                    style={{ color: "#020040" }}
                  >
                    <Pencil className="h-[12px] w-[12px] shrink-0" aria-hidden />
                    Edit client &amp; address
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 transition-transform", clientEditAccordionOpen && "rotate-180")}
                    style={{ color: "#9A9AA0" }}
                  />
                </button>
                {clientEditAccordionOpen ? (
                  <div className={cn("space-y-2 border-t border-border-light px-3 py-2", job.status === "cancelled" && "pointer-events-none opacity-50")}>
                    {job.client_id && propertyEdit ? (
                      <>
                        <ClientAddressPicker
                          value={propertyEdit}
                          onChange={setPropertyEdit}
                          labelClient="Client"
                          labelAddress="Property address"
                          jobCurrentAddressOnly
                          clientNameInputClassName={cn(
                            JOB_DETAIL_INLINE_INPUT_FIELD_CLASS,
                            "px-3 text-sm outline-none",
                          )}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={savingProperty}
                          disabled={job.status === "cancelled"}
                          onClick={handleSaveLinkedProperty}
                        >
                          Save client & address
                        </Button>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <AddressAutocomplete
                          value={unlinkedAddressDraft}
                          onChange={setUnlinkedAddressDraft}
                          onSelect={(p) => setUnlinkedAddressDraft(p.full_address)}
                          label="Property address"
                          placeholder="Type address or postcode…"
                          fieldClassName={cn(JOB_DETAIL_INLINE_INPUT_FIELD_CLASS, "px-3")}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={savingUnlinkedAddress}
                          onClick={handleSaveUnlinkedProperty}
                        >
                          Save address
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <div
                className="p-[18px] space-y-[14px]"
                style={{ background: "#FAFAFB", borderTop: "0.5px solid #E4E4E8" }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p
                    className="text-[10px] font-medium uppercase"
                    style={{ color: "#020040", letterSpacing: "0.6px" }}
                  >
                    Schedule
                  </p>
                  {canOpenQuickReschedule ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      icon={<Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                      className="w-full shrink-0 flex-nowrap [&>span]:whitespace-nowrap sm:w-auto"
                      onClick={() => void openQuickReschedule()}
                    >
                      Reschedule
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                  <div
                    className="min-w-0 bg-white rounded-[10px] p-[12px_14px]"
                    style={{ border: "0.5px solid #E4E4E8" }}
                  >
                    <p
                      className="text-[10px] font-medium uppercase"
                      style={{ color: "#020040", letterSpacing: "0.6px" }}
                    >
                      Start date
                    </p>
                    <p className="mt-[6px] flex h-8 items-center text-[13px] text-text-primary">
                      {scheduleStartDisplayYmd ? formatDate(scheduleStartDisplayYmd) : "—"}
                    </p>
                  </div>
                  <div
                    className="min-w-0 bg-white rounded-[10px] p-[12px_14px]"
                    style={{ border: "0.5px solid #E4E4E8" }}
                  >
                    <p
                      className="text-[10px] font-medium uppercase"
                      style={{ color: "#020040", letterSpacing: "0.6px" }}
                    >
                      Expected finish
                    </p>
                    <p className="mt-[6px] flex h-8 items-center text-[13px] text-text-primary">
                      {scheduleFinishDisplayYmd ? formatDate(scheduleFinishDisplayYmd) : "—"}
                    </p>
                  </div>
                  {isOneOffScheduleUi ? (
                    <div
                      className="min-w-0 bg-white rounded-[10px] p-[12px_14px] sm:col-span-2"
                      style={{ border: "0.5px solid #E4E4E8" }}
                    >
                      <p
                        className="mb-2 text-[10px] font-medium uppercase"
                        style={{ color: "#020040", letterSpacing: "0.6px" }}
                      >
                        Arrival Time
                      </p>
                      <ArrivalSlotPicker
                        readOnly
                        hideLabel
                        arrivalFrom={scheduleTime}
                        arrivalWindowMins={scheduleWindowMins}
                        onPick={() => {}}
                      />
                      {jobModalClientArrivalPreview(scheduleDate, scheduleTime, scheduleWindowMins, {
                        useArrivalSlots: isOneOffScheduleUi,
                      }) ? (
                        <p className="mt-1.5 text-[10px] font-medium text-text-secondary">
                          {jobModalClientArrivalPreview(scheduleDate, scheduleTime, scheduleWindowMins, {
                            useArrivalSlots: isOneOffScheduleUi,
                          })}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[10px] text-text-tertiary">—</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div
                        className="min-w-0 bg-white rounded-[10px] p-[12px_14px]"
                        style={{ border: "0.5px solid #E4E4E8" }}
                      >
                        <p
                          className="text-[10px] font-medium uppercase"
                          style={{ color: "#020040", letterSpacing: "0.6px" }}
                        >
                          Arrival Time
                        </p>
                        <p className="mt-[6px] flex h-8 items-center text-[13px] text-text-primary">
                          {scheduleTime.trim()
                            ? (() => {
                                const iso = scheduleStartDisplayYmd
                                  ? ukWallClockToUtcIso(scheduleStartDisplayYmd, scheduleTime.trim())
                                  : "";
                                return iso ? formatHourMinuteAmPm(new Date(iso)) : scheduleTime.trim();
                              })()
                            : "—"}
                        </p>
                      </div>
                      <div
                        className="min-w-0 bg-white rounded-[10px] p-[12px_14px]"
                        style={{ border: "0.5px solid #E4E4E8" }}
                      >
                        <p
                          className="text-[10px] font-medium uppercase"
                          style={{ color: "#020040", letterSpacing: "0.6px" }}
                        >
                          Window
                        </p>
                        <p className="mt-[6px] flex h-8 items-center text-[13px] text-text-primary">
                          {(() => {
                            const wm = scheduleWindowMins.trim();
                            const n = wm ? Number(wm) : NaN;
                            if (!Number.isFinite(n) || n <= 0) return "—";
                            return (
                              ARRIVAL_WINDOW_OPTIONS.find((opt) => opt.value === wm)?.label ??
                              `${Math.round(n / 60)}h`
                            );
                          })()}
                        </p>
                      </div>
                    </>
                  )}
                </div>
                {!isHousekeepJobDetail ? (
                  <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                    <div
                      className={accessFeeCardClass(effectiveCustomerInCcz)}
                      style={accessFeeCardBorderStyle(effectiveCustomerInCcz)}
                    >
                      <div className="flex items-center gap-1">
                        <p
                          className="text-[10px] font-medium uppercase"
                          style={{
                            color: effectiveCustomerInCcz ? "#0F6E56" : "#020040",
                            letterSpacing: "0.6px",
                          }}
                        >
                          CCZ
                        </p>
                          <span className="group relative shrink-0">
                            <span
                              tabIndex={0}
                              className="inline-flex cursor-help rounded p-px text-text-tertiary outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-primary/25"
                              aria-label="Congestion charge zone details"
                            >
                              <Info className="h-3 w-3" aria-hidden />
                            </span>
                            <span
                              role="tooltip"
                              className="pointer-events-none invisible absolute bottom-full left-0 z-[60] mb-1 w-44 whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1 text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                            >
                              {cczParkingFieldTooltipText}
                            </span>
                          </span>
                      </div>
                      <button
                          type="button"
                          disabled={
                            job.status === "cancelled" || savingAccessFees || (!cczEligibleAddress && !job.in_ccz)
                          }
                          onClick={() => {
                            if (cczEligibleAddress) void saveAccessFeeFlags({ in_ccz: !Boolean(job.in_ccz) });
                            else if (job.in_ccz) void saveAccessFeeFlags({ in_ccz: false });
                          }}
                      className={accessFeeToggleButtonClass(
                            effectiveCustomerInCcz,
                            !cczEligibleAddress && !job.in_ccz,
                          )}
                      >
                          <span className={accessFeeToggleTrackClass(effectiveCustomerInCcz)}>
                            <span className={accessFeeToggleThumbClass(effectiveCustomerInCcz)} />
                          </span>
                          <span className={accessFeeToggleLabelClass(effectiveCustomerInCcz)}>
                            {effectiveCustomerInCcz ? `+${formatCurrency(accessFees.cczFeeGbp)}` : "No fee"}
                          </span>
                      </button>
                    </div>
                    <div
                      className={accessFeeCardClass(job.has_free_parking === false)}
                      style={accessFeeCardBorderStyle(job.has_free_parking === false)}
                    >
                      <p
                        className="text-[10px] font-medium uppercase"
                        style={{
                          color: job.has_free_parking === false ? "#0F6E56" : "#020040",
                          letterSpacing: "0.6px",
                        }}
                      >
                        Parking
                      </p>
                      <button
                          type="button"
                          disabled={job.status === "cancelled" || savingAccessFees}
                          onClick={() => void saveAccessFeeFlags({ has_free_parking: !Boolean(job.has_free_parking) })}
                          className={accessFeeToggleButtonClass(job.has_free_parking === false)}
                      >
                          <span className={accessFeeToggleTrackClass(job.has_free_parking === false)}>
                            <span className={accessFeeToggleThumbClass(job.has_free_parking === false)} />
                          </span>
                          <span className={accessFeeToggleLabelClass(job.has_free_parking === false)}>
                            {job.has_free_parking === false ? `+${formatCurrency(accessFees.parkingFeeGbp)}` : "No fee"}
                          </span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Scope / photos / reports / financial — tabbed */}
            <div className="overflow-hidden rounded-xl border border-border-light bg-[#fdfdfd] shadow-sm dark:border-[#2b313d] dark:bg-[#141922]">
              <div className="flex flex-wrap border-b border-border-light bg-[#fdfdfd] dark:border-[#2b313d] dark:bg-[#141922]">
                {(
                  [
                    { label: "Details", index: 0 as const },
                    ...(JOB_DETAIL_MULTI_VISITS_UI_ENABLED ? [{ label: "Visits", index: 6 as const }] : []),
                    { label: "Site Photos", index: 1 as const },
                    { label: "Documents", index: 2 as const },
                    { label: "Reports", index: 3 as const },
                    { label: "Notes", index: 4 as const },
                    ...(isAdmin ? [{ label: "Setup", index: 5 as const }] : []),
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setDetailTab(tab.index)}
                    className={cn(
                      "min-w-0 flex-1 px-1.5 py-2.5 text-center text-[12px] font-semibold transition-colors sm:px-2",
                      detailTab === tab.index
                        ? "border-b-2 border-primary text-primary"
                        : "border-b-2 border-transparent text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="p-3 space-y-3 bg-[#fdfdfd] dark:bg-[#161c26]">
              {JOB_DETAIL_MULTI_VISITS_UI_ENABLED && detailTab === 6 ? (
                <VisitsTab
                  job={job}
                  openCreateSignal={visitOpenCreateSignal}
                  onJobStatusBumpRequested={(suggestedStatus) => {
                    if (job.status !== suggestedStatus) {
                      void updateJob(job.id, { status: suggestedStatus });
                    }
                  }}
                />
              ) : null}
              {detailTab === 1 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-text-secondary">Site reference photos</p>
                  {job ? (
                    <p className="text-[11px] text-text-tertiary tabular-nums">
                      {coerceJobImagesArray(job.images).length}/{JOB_SITE_PHOTOS_MAX}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 items-start">
                  {job && coerceJobImagesArray(job.images).map((url, i) => (
                    <div key={`${url}-${i}`} className="relative shrink-0 group">
                      <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-border-light ring-1 ring-black/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-16 w-16 object-cover sm:h-[4.5rem] sm:w-[4.5rem]" />
                      </a>
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-card border border-border text-xs text-text-tertiary hover:text-red-600 hover:border-red-200"
                        title="Remove photo"
                        onClick={async () => {
                          if (!job) return;
                          const next = coerceJobImagesArray(job.images).filter((_, j) => j !== i);
                          await handleJobUpdate(job.id, { images: next }, { silent: true });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {job && coerceJobImagesArray(job.images).length < JOB_SITE_PHOTOS_MAX ? (
                  <label className="inline-flex items-center justify-center h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem] rounded-lg border border-dashed border-border bg-surface-hover/50 cursor-pointer hover:border-primary/40 transition-colors">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      className="hidden"
                      disabled={sitePhotoUploading || !job}
                      onChange={async (e) => {
                        const files = e.target.files ? Array.from(e.target.files) : [];
                        if (!files.length || !job) return;
                        const current = coerceJobImagesArray(job.images);
                        const room = JOB_SITE_PHOTOS_MAX - current.length;
                        if (room <= 0) {
                          toast.error(`Maximum ${JOB_SITE_PHOTOS_MAX} photos per job.`);
                          e.target.value = "";
                          return;
                        }
                        const take = files.slice(0, room);
                        if (files.length > take.length) {
                          toast.message(`Only ${take.length} photo(s) added (limit ${JOB_SITE_PHOTOS_MAX} per job).`);
                        }
                        setSitePhotoUploading(true);
                        try {
                          const urls = await uploadQuoteInviteImages(take, `job/${job.id}`);
                          const next = [...current, ...urls];
                          await handleJobUpdate(job.id, { images: next }, { silent: true });
                          toast.success(take.length === 1 ? "Photo added" : `${take.length} photos added`);
                        } catch (err) {
                          toast.error(getErrorMessage(err, "Upload failed"));
                        } finally {
                          setSitePhotoUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
                    {sitePhotoUploading ? (
                      <span className="text-[10px] text-text-tertiary">…</span>
                    ) : (
                      <ImagePlus className="h-5 w-5 text-text-tertiary" aria-hidden />
                    )}
                  </label>
                  ) : null}
                </div>
              </div>
              ) : null}

              {detailTab === 0 ? (
              <div className="space-y-3">
              <div className="space-y-1.5 border-t border-border pt-2">
                <div className="flex items-center justify-between gap-2">
                  <JobCardTitleWithHint
                    title="Scope"
                    hint="Scope is required before assigning a partner. Site photos are on the Site photos tab."
                    titleClassName="text-xs font-semibold text-text-primary"
                  />
                  {!scopeEditing ? (
                    <button
                      type="button"
                      onClick={() => setScopeEditing(true)}
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface-hover text-text-tertiary transition-colors hover:border-primary/35 hover:bg-primary-light/60 hover:text-primary dark:border-[#2f3440] dark:bg-[#1a202a] dark:hover:border-primary/45 dark:hover:bg-primary/15 dark:hover:text-primary"
                      title="Edit scope"
                      aria-label="Edit scope"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                {!scopeEditing ? (
                  scopeReadText ? (
                    <div className="relative">
                      <div
                        className={cn(
                          "text-sm leading-relaxed text-text-primary whitespace-pre-wrap",
                          scopeIsLong && !scopeExpanded && "overflow-hidden pb-10",
                        )}
                        style={
                          scopeIsLong && !scopeExpanded
                            ? { maxHeight: JOB_SCOPE_COLLAPSED_MAX_HEIGHT }
                            : undefined
                        }
                      >
                        {scopeReadText}
                      </div>
                      {scopeIsLong && !scopeExpanded ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-card from-35% via-card/85 to-transparent pt-12 pb-0.5 dark:from-[#141922] dark:via-[#141922]/85">
                          <button
                            type="button"
                            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-card px-4 py-1.5 text-xs font-semibold text-primary shadow-md ring-1 ring-primary/10 transition-colors hover:border-primary/50 hover:bg-primary-light/60 dark:border-primary/40 dark:bg-[#1a202a] dark:hover:bg-primary/15"
                            onClick={() => setScopeExpanded(true)}
                          >
                            See more
                            <ChevronDown className="h-4 w-4 shrink-0 animate-bounce" aria-hidden />
                          </button>
                        </div>
                      ) : null}
                      {scopeIsLong && scopeExpanded ? (
                        <div className="mt-2 flex justify-center">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-hover px-4 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-border hover:bg-muted/80 hover:text-text-primary dark:border-[#2f3440] dark:bg-[#1a202a]"
                            onClick={() => setScopeExpanded(false)}
                          >
                            See less
                            <ChevronDown className="h-4 w-4 shrink-0 rotate-180" aria-hidden />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-text-tertiary italic">No scope yet — use the pencil to add one.</p>
                  )
                ) : (
                  <>
                    <textarea
                      value={scopeDraft}
                      onChange={(e) => setScopeDraft(e.target.value)}
                      rows={6}
                      placeholder="Describe what the partner is expected to do…"
                      className={cn(JOB_DETAIL_MULTILINE_FIELD_CLASS, "min-h-[140px]")}
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={savingScope}
                        onClick={async () => {
                          if (!job) return;
                          setSavingScope(true);
                          try {
                            await handleJobUpdate(job.id, { scope: scopeDraft.trim() || undefined });
                            setScopeEditing(false);
                          } finally {
                            setSavingScope(false);
                          }
                        }}
                      >
                        Save scope
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingScope}
                        onClick={() => {
                          setScopeDraft(job.scope ?? "");
                          setScopeEditing(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <div className="flex items-center justify-between gap-2">
                  <JobCardTitleWithHint
                    title="Notes"
                    hint="Internal only — not shown to the client; use for access, keys, or context beyond the scope."
                    titleClassName="text-xs font-semibold text-text-primary"
                  />
                  {!additionalNotesEditing ? (
                    <button
                      type="button"
                      onClick={() => setAdditionalNotesEditing(true)}
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface-hover text-text-tertiary transition-colors hover:border-primary/35 hover:bg-primary-light/60 hover:text-primary dark:border-[#2f3440] dark:bg-[#1a202a] dark:hover:border-primary/45 dark:hover:bg-primary/15 dark:hover:text-primary"
                      title="Edit additional notes"
                      aria-label="Edit additional notes"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                {!additionalNotesEditing ? (
                  additionalNotesReadText ? (
                    <p className="text-sm leading-relaxed text-text-primary whitespace-pre-wrap">{additionalNotesReadText}</p>
                  ) : (
                    <p className="text-sm text-text-tertiary italic">No additional notes yet — use the pencil to add some.</p>
                  )
                ) : (
                  <>
                    <textarea
                      value={additionalNotesDraft}
                      onChange={(e) => setAdditionalNotesDraft(e.target.value)}
                      rows={3}
                      placeholder="Parking, entry, preferences…"
                      className={cn(JOB_DETAIL_MULTILINE_FIELD_CLASS, "min-h-[86px]")}
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={savingAdditionalNotes}
                        onClick={async () => {
                          if (!job) return;
                          setSavingAdditionalNotes(true);
                          try {
                            await handleJobUpdate(job.id, { additional_notes: additionalNotesDraft.trim() || null });
                            setAdditionalNotesEditing(false);
                          } finally {
                            setSavingAdditionalNotes(false);
                          }
                        }}
                      >
                        Save additional notes
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingAdditionalNotes}
                        onClick={() => {
                          setAdditionalNotesDraft(job.additional_notes ?? "");
                          setAdditionalNotesEditing(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <div className="flex items-center justify-between gap-2">
                  <JobCardTitleWithHint
                    title="Report link (optional)"
                    hint="External URL — Google Drive, Notion, shared doc. Not shown to the client."
                    titleClassName="text-xs font-semibold text-text-primary"
                  />
                  <div className="flex items-center gap-2">
                    {!reportLinkEditing && reportLinkReadHref ? (
                      <a
                        href={reportLinkReadHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Open link
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                    {!reportLinkEditing ? (
                      <button
                        type="button"
                        onClick={() => setReportLinkEditing(true)}
                        className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface-hover text-text-tertiary transition-colors hover:border-primary/35 hover:bg-primary-light/60 hover:text-primary dark:border-[#2f3440] dark:bg-[#1a202a] dark:hover:border-primary/45 dark:hover:bg-primary/15 dark:hover:text-primary"
                        title="Edit report link"
                        aria-label="Edit report link"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
                {!reportLinkEditing ? (
                  reportLinkReadRaw ? (
                    reportLinkReadHref ? (
                      <a
                        href={reportLinkReadHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-primary break-all hover:underline"
                      >
                        {reportLinkReadRaw}
                      </a>
                    ) : (
                      <p className="text-sm text-text-primary break-all">{reportLinkReadRaw}</p>
                    )
                  ) : (
                    <p className="text-sm text-text-tertiary italic">No report link yet — use the pencil to add one.</p>
                  )
                ) : (
                  <>
                    <Input
                      type="url"
                      value={reportLinkDraft}
                      onChange={(e) => setReportLinkDraft(e.target.value)}
                      placeholder="https://…"
                      className={cn(JOB_DETAIL_INLINE_INPUT_FIELD_CLASS, "h-auto min-h-0")}
                      autoFocus
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={savingReportLink}
                        onClick={async () => {
                          if (!job) return;
                          setSavingReportLink(true);
                          try {
                            await handleJobUpdate(job.id, { report_link: reportLinkDraft.trim() || null });
                            setReportLinkEditing(false);
                          } finally {
                            setSavingReportLink(false);
                          }
                        }}
                      >
                        Save report link
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingReportLink}
                        onClick={() => {
                          setReportLinkDraft(job.report_link ?? "");
                          setReportLinkEditing(false);
                        }}
                      >
                        Cancel
                      </Button>
                      {jobReportLinkHref(reportLinkDraft) ? (
                        <a
                          href={jobReportLinkHref(reportLinkDraft)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                        >
                          Open link
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              </div>
              ) : null}

              {detailTab === 2 && job ? <JobDocumentsPanel job={job} onUpdate={handleJobUpdate} /> : null}

              {detailTab === 3 ? (
            <>
            {/* Fixfy visual system: navy labels, inset card, coral for pending, emerald for validated success feedback. */}
            <div
              className="rounded-[12px] overflow-hidden bg-white"
              style={{ border: "0.5px solid #E4E4E8", boxShadow: "0 1px 3px rgba(2,0,64,0.04)" }}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-[18px] py-[14px]"
                style={{ background: "#FAFAFB", borderBottom: "0.5px solid #E4E4E8" }}
              >
                <p
                  className="text-[11px] font-medium uppercase flex items-center gap-1.5"
                  style={{ color: "#020040", letterSpacing: "0.6px" }}
                >
                  <FileText className="h-3.5 w-3.5" /> Reports
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Progress
                    value={reportsProgressPercent}
                    size="sm"
                    color={reportsProgressPercent === 100 ? "emerald" : "primary"}
                    className="w-24 min-w-[6rem]"
                  />
                  <span
                    className="text-[11px] font-semibold tabular-nums"
                    style={{ color: "#020040" }}
                  >
                    {reportsProgressPercent}%
                  </span>
                </div>
              </div>

              <div className="p-[18px] space-y-[14px]">
              <PartnerReportLinkPanel
                jobId={job.id}
                hasPartner={!!job.partner_id}
                isZendeskLinked={job.external_source === "zendesk" && !!job.external_ref}
                bothReportsSubmitted={v2StartSubmitted && v2FinalSubmitted}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
                <JobReportV2Card
                  jobId={job.id}
                  kind="start"
                  rawReport={job.start_report}
                  approvedAt={job.start_report_approved_at ?? null}
                  onApprovalChange={() => router.refresh()}
                />
                <JobReportV2Card
                  jobId={job.id}
                  kind="final"
                  rawReport={job.final_report}
                  approvedAt={job.final_report_approved_at ?? null}
                  onApprovalChange={() => router.refresh()}
                />
              </div>
              <JobPartnerMediaCard jobId={job.id} />
              <JobOnHoldSubmissionCard jobId={job.id} />
              {(v2StartSubmitted || v2FinalSubmitted) ? (
                <div
                  className="flex items-center justify-between gap-2 pt-[12px]"
                  style={{ borderTop: "0.5px solid #E4E4E8" }}
                >
                  <p className="text-[11px]" style={{ color: "#6B6B70" }}>
                    {v2ApprovedCount}/{v2SubmittedCount} report{v2SubmittedCount === 1 ? "" : "s"} validated
                  </p>
                  <JobReportV2DownloadButton jobId={job.id} reference={job.reference} />
                </div>
              ) : null}
              {allConfiguredReportsApproved(job) && (
                <div
                  className="rounded-[10px] p-[14px] flex flex-col sm:flex-row sm:items-center gap-3"
                  style={{ background: "#F4F5FB", border: "0.5px solid #D8DBEE" }}
                >
                  <p
                    className="flex-1 text-[13px] font-medium"
                    style={{ color: "#020040" }}
                  >
                    All reports validated — ready to send report &amp; request final payment.
                  </p>
                  <button
                    type="button"
                    disabled={!sendReportFinalCheck.ok}
                    title={sendReportFinalCheck.message}
                    onClick={() => void handleSendReportAndInvoice()}
                    className="inline-flex items-center gap-[6px] text-white border-none rounded-[6px] px-[14px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "#020040" }}
                    onMouseEnter={(e) => {
                      if (!(e.currentTarget as HTMLButtonElement).disabled)
                        (e.currentTarget as HTMLButtonElement).style.background = "#0a0860";
                    }}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#020040")}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Review &amp; approve
                  </button>
                </div>
              )}
              </div>
            </div>

            {/* MANUAL REPORT + AI ANALYSIS */}
            <details
              className="group rounded-[12px] overflow-hidden bg-white"
              style={{ border: "0.5px solid #E4E4E8", boxShadow: "0 1px 3px rgba(2,0,64,0.04)" }}
            >
              <summary
                className="flex list-none items-center justify-between gap-2 px-[18px] py-[14px] cursor-pointer select-none [&::-webkit-details-marker]:hidden"
                style={{ background: "#FAFAFB" }}
              >
                <p
                  className="text-[11px] font-medium uppercase flex items-center gap-1.5 min-w-0"
                  style={{ color: "#020040", letterSpacing: "0.6px" }}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" /> Manual report analysis (AI)
                </p>
                <ChevronDown
                  className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                  style={{ color: "#9A9AA0" }}
                  aria-hidden
                />
              </summary>
              <div
                className="space-y-3 px-[18px] py-[18px]"
                style={{ borderTop: "0.5px solid #E4E4E8" }}
              >
                <div>
                  <label
                    className="block text-[11px] font-medium uppercase mb-[6px]"
                    style={{ color: "#020040", letterSpacing: "0.6px" }}
                  >
                    Report file
                  </label>
                  <input
                    id="manual-report-file"
                    type="file"
                    accept=".pdf,.doc,.docx,image/jpeg,image/jpg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={(e) => setManualReportFile(e.target.files?.[0] ?? null)}
                  />
                  <div
                    className="rounded-[8px] p-3 bg-white"
                    style={{ border: "0.5px dashed #D8D8DD" }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <label
                        htmlFor="manual-report-file"
                        className="inline-flex items-center gap-2 rounded-[6px] bg-white px-3 py-[6px] text-[12px] font-medium cursor-pointer"
                        style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLLabelElement).style.background = "#FAFAFB")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLLabelElement).style.background = "#FFFFFF")}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {manualReportFile ? "Change file" : "Choose file"}
                      </label>
                      {manualReportFile && (
                        <button
                          type="button"
                          onClick={() => setManualReportFile(null)}
                          className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px]"
                          style={{ color: "#6B6B70", border: "0.5px solid #D8D8DD" }}
                        >
                          <X className="h-3 w-3" /> Remove
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] truncate" style={{ color: "#6B6B70" }}>
                      {manualReportFile?.name ?? "No file selected"}
                    </p>
                  </div>
                  <p className="text-[11px] mt-[6px]" style={{ color: "#6B6B70" }}>
                    Supported: PDF, DOC, DOCX or images (max 10MB).
                  </p>
                </div>
                <div>
                  <label
                    className="block text-[11px] font-medium uppercase mb-[6px]"
                    style={{ color: "#020040", letterSpacing: "0.6px" }}
                  >
                    Ops notes (recommended)
                  </label>
                  <textarea
                    value={manualReportNotes}
                    onChange={(e) => setManualReportNotes(e.target.value)}
                    rows={3}
                    placeholder="Add context, what was done, issues found, materials used, safety notes..."
                    className="w-full rounded-[8px] px-3 py-[10px] text-[13px] outline-none bg-white"
                    style={{
                      border: "0.5px solid #D8D8DD",
                      color: "#020040",
                      fontFamily: "inherit",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    disabled={!manualReportFile || analyzingManualReport}
                    onClick={() => void handleManualReportAnalyze()}
                    className="inline-flex items-center gap-[6px] text-white border-none rounded-[6px] px-[14px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "#020040" }}
                    onMouseEnter={(e) => {
                      if (!(e.currentTarget as HTMLButtonElement).disabled)
                        (e.currentTarget as HTMLButtonElement).style.background = "#0a0860";
                    }}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#020040")}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {analyzingManualReport ? "Analyzing…" : "Upload & analyze"}
                  </button>
                  {manualReportFile && (
                    <span className="text-[11px] truncate" style={{ color: "#6B6B70" }}>
                      {manualReportFile.name}
                    </span>
                  )}
                </div>
                {manualReportResult && (
                  <div
                    className="rounded-[8px] p-3"
                    style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
                  >
                    <p
                      className="text-[11px] font-medium uppercase mb-[6px]"
                      style={{ color: "#020040", letterSpacing: "0.6px" }}
                    >
                      AI response
                    </p>
                    <pre className="text-[12px] whitespace-pre-wrap" style={{ color: "#020040" }}>
                      {manualReportResult}
                    </pre>
                  </div>
                )}
              </div>
            </details>
            </>
            ) : null}

            {detailTab === 4 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border-light bg-card p-3 space-y-2">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Notes</p>
                <textarea
                  value={internalNoteDraft}
                  onChange={(e) => setInternalNoteDraft(e.target.value)}
                  rows={3}
                  placeholder="Add an internal note…"
                  className={cn(JOB_DETAIL_MULTILINE_FIELD_CLASS, "min-h-[86px]")}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={savingInternalNote}
                    disabled={!internalNoteDraft.trim()}
                    onClick={async () => {
                      if (!job || !internalNoteDraft.trim()) return;
                      const note = internalNoteDraft.trim();
                      const stamp = new Date().toISOString();
                      const author = profile?.full_name?.trim() || profile?.email?.trim() || "User";
                      const line = `[${stamp}] ${author}: ${note}`;
                      const prev = (job.internal_notes ?? "").trim();
                      const combined = prev ? `${prev}\n\n${line}` : line;
                      setSavingInternalNote(true);
                      try {
                        const updated = await handleJobUpdate(job.id, { internal_notes: combined }, { silent: true, notifyPartner: false });
                        if (updated) {
                          await logAudit({
                            entityType: "job",
                            entityId: job.id,
                            entityRef: job.reference,
                            action: "note",
                            fieldName: "internal_note",
                            newValue: note,
                            userId: profile?.id,
                            userName: profile?.full_name,
                            metadata: { source: "job_notes_tab", at: stamp },
                          });
                          setInternalNoteDraft("");
                          toast.success("Note saved");
                        }
                      } finally {
                        setSavingInternalNote(false);
                      }
                    }}
                  >
                    Save note
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-border-light bg-card p-3 space-y-2">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Archived notes</p>
                {internalNotesEntries.length === 0 ? (
                  <p className="text-xs text-text-tertiary">No internal notes yet.</p>
                ) : (
                  <div className="space-y-2">
                    {internalNotesEntries.map((entry, idx) => (
                      <div key={`${entry.iso}-${idx}`} className="rounded-lg border border-border-light bg-surface-hover/30 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-text-primary">{entry.author}</p>
                          <p className="text-[10px] text-text-tertiary">
                            {entry.iso ? new Date(entry.iso).toLocaleString() : "—"}
                          </p>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{entry.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            ) : null}

            {isAdmin && detailTab === 5 ? (
            <div className="space-y-3">
            <details className="group rounded-xl border border-border-light bg-card overflow-hidden" open>
              <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Zendesk ticket</p>
                <ChevronDown className="h-4 w-4 text-text-tertiary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-3 space-y-4 border-t border-border-light pt-3">
                <JobZendeskLinkCard
                  embedded
                  jobId={job.id}
                  externalSource={job.external_source}
                  externalRef={job.external_ref}
                  zendeskSubdomain={process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN ?? null}
                  onChanged={() => router.refresh()}
                />
                <JobZendeskStatus
                  jobId={job.id}
                  zendeskSubdomain={process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN ?? null}
                />
              </div>
            </details>

            <details className="group rounded-xl border border-border-light bg-card overflow-hidden" open>
              <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Financial setup</p>
                <ChevronDown className="h-4 w-4 text-text-tertiary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-3 space-y-3 border-t border-border-light pt-3">
                {customerScheduleMismatch && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 text-xs text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Deposit + final ({formatCurrency(scheduledCustomerTotal)}) ≠ billable total ({formatCurrency(billableRevenue)}). Align below.
                  </div>
                )}
                {hourlyAutoBilling && (
                  <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-3 text-xs text-sky-900 dark:text-sky-100 space-y-1">
                    <p className="font-semibold">Hourly auto-billing active</p>
                    <p>
                      Logged: {formatOfficeTimer(computeOfficeTimerElapsedSeconds(job))} · Billed: {hourlyAutoBilling.billedHours}h
                      (minimum 1h, then 30-minute increments).
                    </p>
                    <p>
                      Client total: {formatCurrency(hourlyAutoBilling.clientTotal)} · Partner total: {formatCurrency(hourlyAutoBilling.partnerTotal)}
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-3 space-y-3 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-950/20">
                  <FinSetupSectionTitle hint="Amounts billed to the client — not paid directly to the partner. Use Charge or discount in Finance summary for line-item extras.">
                    Cash in — client
                  </FinSetupSectionTitle>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <FinSetupFieldLabel
                        label="Job price"
                        hint="Main price for the job before any add-ons (same as Initial balance in Finance summary)."
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={finForm.client_price}
                        onChange={(e) => {
                          const price = parseFloat(e.target.value) || 0;
                          const extras = parseFloat(finForm.extras_amount) || 0;
                          const dep = parseFloat(finForm.customer_deposit) || 0;
                          const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                          setFinForm((f) => ({ ...f, client_price: e.target.value, customer_final_payment: autoFinal }));
                        }}
                      />
                    </div>
                    <div>
                      <FinSetupFieldLabel
                        label="Add-ons & extras"
                        hint="Extra charges for the client (e.g. parking, CCZ). Matches Total Extras on Finance summary."
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={finForm.extras_amount}
                        onChange={(e) => {
                          const price = parseFloat(finForm.client_price) || 0;
                          const extras = parseFloat(e.target.value) || 0;
                          const dep = parseFloat(finForm.customer_deposit) || 0;
                          const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                          setFinForm((f) => ({ ...f, extras_amount: e.target.value, customer_final_payment: autoFinal }));
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-emerald-200/60 pt-3 dark:border-emerald-500/20">
                    <FinSetupSectionTitle hint="Deposit and final payment should add up to the total charged to the customer.">
                      Payment schedule
                    </FinSetupSectionTitle>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <FinSetupFieldLabel label="Deposit" hint="Amount the customer pays upfront." />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={finForm.customer_deposit}
                          onChange={(e) => {
                            const price = parseFloat(finForm.client_price) || 0;
                            const extras = parseFloat(finForm.extras_amount) || 0;
                            const dep = parseFloat(e.target.value) || 0;
                            const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                            setFinForm((f) => ({ ...f, customer_deposit: e.target.value, customer_final_payment: autoFinal }));
                          }}
                        />
                      </div>
                      <div>
                        <FinSetupFieldLabel
                          label="Final payment"
                          hint="Usually auto from job price + add-ons minus deposit. Change only for a custom split."
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={finForm.customer_final_payment}
                          onChange={(e) => setFinForm((f) => ({ ...f, customer_final_payment: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-rose-200/80 bg-rose-50/45 p-3 space-y-3 shadow-sm dark:border-rose-500/25 dark:bg-rose-950/20">
                  <FinSetupSectionTitle hint="What this job costs you — partner labour and materials. Feeds Cash out — partner and self-bill.">
                    Cash out — partner
                  </FinSetupSectionTitle>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <FinSetupFieldLabel
                        label="Partner payout"
                        hint="Amount owed to the partner for their work. Extra payouts in Finance summary add on top of this."
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={finForm.partner_cost}
                        onChange={(e) => setFinForm((f) => ({ ...f, partner_cost: e.target.value }))}
                      />
                      {suggestedPartnerCost40ForFinForm != null && (
                        <p className="mt-1.5 text-[10px] leading-snug text-text-tertiary">
                          ~{SUGGESTED_PARTNER_MARGIN_HINT_PCT}% margin hint:{" "}
                          <span className="font-semibold tabular-nums text-text-secondary">
                            {formatCurrency(suggestedPartnerCost40ForFinForm)}
                          </span>{" "}
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={() =>
                              setFinForm((f) => ({ ...f, partner_cost: String(suggestedPartnerCost40ForFinForm) }))
                            }
                          >
                            Apply
                          </button>
                        </p>
                      )}
                    </div>
                    <div>
                      <FinSetupFieldLabel
                        label="Materials cost"
                        hint="Materials you pay for on this job. Included on the partner self-bill."
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={finForm.materials_cost}
                        onChange={(e) => setFinForm((f) => ({ ...f, materials_cost: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="border-t border-rose-200/60 pt-3 dark:border-rose-500/20">
                    <FinSetupFieldLabel
                      label="Agreed partner payout (optional)"
                      hint="Leave at 0 to use Partner payout above. Set only if you agreed a different fixed amount with the partner."
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={finForm.partner_agreed_value}
                      onChange={(e) => setFinForm((f) => ({ ...f, partner_agreed_value: e.target.value }))}
                    />
                  </div>
                </div>

                                <Button type="button" size="sm" variant="primary" loading={savingFin} onClick={handleSaveFinancials}>Save</Button>
              </div>
            </details>
            </div>
            ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-border-light bg-card p-2 space-y-2">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Command history</p>
              <AuditTimeline entityType="job" entityId={job.id} deferUntilVisible />
            </div>

          </div>

          {/* ═══ RIGHT — partner + financial (fixed width on lg) ═══ */}
          <div className="min-h-0 min-w-0 w-full space-y-3 p-3 sm:p-4 lg:w-[352px] lg:shrink-0">

            {/* PRIMARY PARTNER */}
            <div className="rounded-lg border border-border-light bg-card p-2 space-y-2">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Primary partner</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {job.partner_id?.trim() ? (
                    <Avatar
                      src={partners.find((p) => p.id === job.partner_id)?.avatar_url}
                      name={job.partner_name || "Partner"}
                      size="sm"
                      className="h-8 w-8 border border-border-light ring-0"
                    />
                  ) : (
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-hover"
                      aria-hidden
                    >
                      <UserX className="h-4 w-4 text-text-tertiary" />
                    </div>
                  )}
                  {job.partner_name ? (
                    <div className="group/partner-name relative min-w-0">
                      <p className="truncate text-xs font-bold text-text-primary cursor-default">{job.partner_name}</p>
                      {job.partner_id ? (
                        <span
                          role="tooltip"
                          className="pointer-events-none invisible absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-normal leading-snug text-white opacity-0 shadow-md transition-opacity group-hover/partner-name:visible group-hover/partner-name:opacity-100"
                        >
                          ID: {job.partner_id}
                        </span>
                      ) : null}
                    </div>
                  ) : jobPartnerListKind(job) === "auto_assign" ? (
                    <Badge variant="info" dot className="text-[10px] font-medium normal-case">
                      Auto assign
                    </Badge>
                  ) : (
                    <p className="text-xs font-medium text-text-tertiary">Unassigned</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {job.partner_id?.trim() ? (
                    <button
                      type="button"
                      aria-label="Unassign partner"
                      title="Remove partner — job returns to Unassigned"
                      disabled={signingOffPartner || savingPartner}
                      onClick={() => void handleQuickUnassignPartner()}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full border border-border-light bg-surface-hover text-text-tertiary transition-colors",
                        "hover:border-primary/30 hover:bg-primary-light/80 hover:text-primary",
                        "dark:hover:bg-primary/10",
                        "disabled:pointer-events-none disabled:opacity-45",
                      )}
                    >
                      <UserX className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    </button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={signingOffPartner}
                    className="h-auto shrink-0 rounded-md border-primary/35 bg-primary-light/70 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light dark:border-primary/45 dark:bg-primary/10 dark:hover:bg-primary/15"
                    onClick={() => setPartnerModalOpen(true)}
                  >
                    {job.partner_id ? "Swap" : "Assign"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border-light bg-card p-2 space-y-2">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Job owner</p>
              {isAdmin ? (
                <JobOwnerSelect
                  value={job.owner_id}
                  fallbackName={job.owner_name}
                  users={assignableUsers}
                  disabled={savingOwner}
                  emptyLabel="Unassigned"
                  onChange={async (ownerId) => {
                    const owner = ownerId ? assignableUsers.find((u) => u.id === ownerId) : undefined;
                    if (!ownerId && job.id) ownerKeepUnassignedRef.current.add(job.id);
                    else if (job.id) ownerKeepUnassignedRef.current.delete(job.id);
                    setSavingOwner(true);
                    try {
                      await handleJobUpdate(job.id, {
                        owner_id: ownerId ?? null,
                        owner_name: owner?.full_name ?? null,
                      });
                      if (!ownerId) toast.success("Job owner cleared");
                    } finally {
                      setSavingOwner(false);
                    }
                  }}
                />
              ) : job.owner_name ? (
                <div className="flex items-center gap-2">
                  <Avatar name={job.owner_name} size="sm" className="h-7 w-7 text-[9px]" />
                  <p className="text-xs font-medium text-text-primary">{job.owner_name}</p>
                  <Badge variant="outline" size="sm" className="h-5 text-[10px]">
                    Owner
                  </Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-hover">
                    <UserX className="h-3.5 w-3.5" aria-hidden />
                  </div>
                  <p className="text-sm italic">Unassigned</p>
                </div>
              )}
            </div>

            {/* FINANCIAL COMPLETION */}
            <div className="rounded-lg border border-border-light bg-card p-3 shadow-sm space-y-2.5 dark:border-[#2b313d] dark:bg-[#141922]">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1">
                <CreditCard className="h-3 w-3" /> Finance summary
              </p>

              {/* CLIENT cash in */}
              <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-2 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Cash in — client</span>
                    <Badge variant={amountDue > 0.02 ? "warning" : "success"} size="sm" className="h-5 text-[10px]">
                      {amountDue > 0.02 ? "Pending" : "Settled"}
                    </Badge>
                  </div>
                  <span
                    className="text-sm font-bold tabular-nums text-text-primary shrink-0"
                    title="Extra charge / CCZ / parking change this total and the invoice. Record Payment only reduces amount due."
                  >
                    {formatCurrency(billableRevenue)}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div
                    className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-md border border-border-light/70 bg-background/60 px-2 py-1.5 dark:border-[#2f3642] dark:bg-[#101621]"
                    title="Base client price at the start of this job (field client_price). Extras are tracked below."
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-text-primary">Initial balance</span>
                      <Badge variant="outline" size="sm" className="h-5 text-[10px]">Base</Badge>
                    </div>
                    <span className="font-semibold tabular-nums text-text-primary shrink-0">
                      {formatCurrency(Math.max(0, Number(job.client_price ?? 0)))}
                    </span>
                  </div>
                  {(job.customer_deposit ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-primary">Upfront deposit</span>
                        <Badge variant={job.customer_deposit_paid ? "success" : "warning"} size="sm" className="h-5 text-xs">{job.customer_deposit_paid ? "Paid" : "Pending"}</Badge>
                      </div>
                      <span className="font-semibold tabular-nums">{formatCurrency(job.customer_deposit ?? 0)}</span>
                    </div>
                  )}
                  <div className="space-y-1 rounded-md border border-border-light/80 bg-muted/30 p-2 dark:border-[#323a46] dark:bg-[#1a212d]">
                    <div className="flex items-center gap-1.5">
                      <JobCardHint
                        title="View all client extras"
                        onClick={() => openExtraManager("client")}
                        className="focus:ring-emerald-400"
                      />
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Extras</p>
                    </div>
                    <div className="py-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-text-secondary">Total Extras</span>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("font-semibold tabular-nums", clientExtraTotalDisplay > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                            {clientExtraTotalDisplay > 0.02 ? `+${formatCurrency(clientExtraTotalDisplay)}` : formatCurrency(0)}
                          </span>
                          <button
                            type="button"
                            className="text-text-tertiary transition-colors hover:text-text-primary"
                            title="Edit or remove extras"
                            aria-label="Edit or remove client extras"
                            onClick={() => openExtraManager("client")}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">Labour</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", clientExtraPlainDisplay > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                          {clientExtraPlainDisplay > 0.02 ? `+${formatCurrency(clientExtraPlainDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("client", "extra", clientExtraPlainDisplay > 0.02 || bucketHasLedgerEntries("client", "extra"))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">CCZ</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", clientExtraCczDisplay > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                          {clientExtraCczDisplay > 0.02 ? `+${formatCurrency(clientExtraCczDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("client", "ccz", clientExtraCczDisplay > 0.02 || bucketHasLedgerEntries("client", "ccz"))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">Parking</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", clientExtraParkingDisplay > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                          {clientExtraParkingDisplay > 0.02 ? `+${formatCurrency(clientExtraParkingDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("client", "parking", clientExtraParkingDisplay > 0.02 || bucketHasLedgerEntries("client", "parking"))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">Materials</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", clientExtraMaterialsDisplay > 0.02 ? "text-emerald-700" : "text-text-tertiary")}>
                          {clientExtraMaterialsDisplay > 0.02 ? `+${formatCurrency(clientExtraMaterialsDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("client", "materials", clientExtraMaterialsDisplay > 0.02 || bucketHasLedgerEntries("client", "materials"))}
                      </div>
                    </div>
                  </div>
                  {/* Payment history: always show header so empty state is visible */}
                  <div className="mt-1 space-y-0.5">
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Payment history</p>
                    {customerPayments.length === 0 ? (
                      <p className="text-[10px] text-text-tertiary pl-0.5">No payments recorded yet.</p>
                    ) : null}
                    {customerPayments.map((p) => {
                      const ledgerTag = parseJobPaymentLedgerLabel(p.note);
                      const noteRest = jobPaymentNoteWithoutLedgerPrefix(p.note);
                      const scheduleTag = p.type === "customer_deposit" ? "Scheduled deposit" : "Final balance";
                      return (
                      <div key={p.id} className="flex items-start justify-between gap-1.5 rounded-md bg-surface-hover/40 px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-semibold text-text-tertiary uppercase">
                              {ledgerTag ?? scheduleTag}
                            </span>
                            <Badge variant="success" size="sm">Received</Badge>
                            {p.payment_method && (
                              <span className="text-[10px] text-text-tertiary">
                                ·{" "}
                                {p.payment_method === "bank_transfer"
                                  ? "Bank"
                                  : p.payment_method === "cash"
                                    ? "Cash"
                                    : p.payment_method === "stripe"
                                      ? "Stripe"
                                      : p.payment_method}
                              </span>
                            )}
                            <span className="text-[10px] text-text-tertiary">
                              · {new Date(p.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </span>
                          </div>
                          {ledgerTag ? (
                            <p className="text-[10px] text-text-tertiary truncate pl-0.5">{scheduleTag}</p>
                          ) : null}
                          {p.bank_reference && <p className="text-[10px] text-text-tertiary truncate">Ref: {p.bank_reference}</p>}
                          {noteRest ? <p className="text-[10px] text-text-tertiary truncate">{noteRest}</p> : null}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400" title="Reduces amount due">
                            {formatCurrencyPrecise(-Number(p.amount))}
                          </span>
                          {isAdmin && (
                            <button onClick={() => setDeletePaymentTarget({ id: p.id, amount: Number(p.amount), type: p.type })} className="text-text-tertiary hover:text-red-500 transition-colors">
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between border-t border-border-light pt-1.5 text-xs dark:border-[#2f3642]">
                    <span className={`font-semibold ${amountDue > 0.02 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {amountDue > 0.02 ? "Amount due" : "Fully collected"}
                    </span>
                    <span className={`font-bold tabular-nums ${amountDue > 0.02 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {amountDue > 0.02 ? formatCurrency(amountDue) : formatCurrency(0)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex w-full flex-col gap-2">
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="primary"
                      className="min-h-[2.75rem] w-full rounded-lg px-3 text-sm font-semibold shadow-sm"
                      disabled={job.status === "cancelled" || job.status === "deleted"}
                      icon={<Plus className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMoneyDrawerInitialExtraType(undefined);
                        setMoneyDrawerFlow("client_pay");
                        setMoneyDrawerOpen(true);
                      }}
                      title="Records money received from the client. Reduces amount due only — use Charge or discount for line-item extras."
                    >
                      Record payment
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "min-h-[2.75rem] w-full rounded-lg border-emerald-300/90 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 shadow-sm hover:bg-emerald-100 dark:border-emerald-500/35 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/45",
                    )}
                    disabled={job.status === "cancelled" || job.status === "deleted"}
                    icon={<Plus className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMoneyDrawerInitialExtraType(undefined);
                      setMoneyDrawerFlow("client_extra");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Charge or discount
                  </Button>
                </div>
              </div>

              {/* Cash out (partner payout) */}
              <div className="rounded-lg border border-rose-200/80 bg-rose-50/45 p-2 shadow-sm dark:border-rose-500/25 dark:bg-rose-950/20">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Cash out — partner</span>
                    <Badge
                      variant={
                        partnerUsesClawbackUi
                          ? partnerClawbackOwed > 0.02
                            ? "warning"
                            : "success"
                          : partnerPayRemaining > 0.02
                            ? "warning"
                            : "success"
                      }
                      size="sm"
                      className="h-5 text-[10px]"
                    >
                      {partnerUsesClawbackUi
                        ? partnerClawbackOwed > 0.02
                          ? "Pending"
                          : "Settled"
                        : partnerPayRemaining > 0.02
                          ? "Pending"
                          : "Settled"}
                    </Badge>
                  </div>
                  <span
                    className="text-sm font-bold tabular-nums text-text-primary shrink-0"
                    title="Labour + materials and cancellation clawback (−) when applicable."
                  >
                    {formatCurrencyPrecise(partnerCashOutSummaryAmount)}
                  </span>
                </div>
                {partnerUsesClawbackUi ? (
                  <p className="mb-1.5 text-[10px] text-text-tertiary leading-snug">
                    Negative total = partner owes you (cancellation fee). Stored as a positive GBP snapshot for Finance /
                    self-bill follow-up.
                  </p>
                ) : null}
                <div className="space-y-2 text-xs">
                  <div
                    className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-md border border-border-light/70 bg-background/60 px-2 py-1.5 dark:border-[#2f3642] dark:bg-[#101621]"
                    title="Subcontract labour agreed at the start of this job. Stays locked — extras and materials are tracked below."
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-text-primary">Initial balance</span>
                      <Badge variant="outline" size="sm" className="h-5 text-[10px]">Base</Badge>
                    </div>
                    <span className="font-semibold tabular-nums text-text-primary shrink-0">
                      {formatCurrency(partnerInitialBalance)}
                    </span>
                  </div>
                  <div className="space-y-1 rounded-md border border-border-light/80 bg-muted/30 p-2 dark:border-[#323a46] dark:bg-[#1a212d]">
                    <div className="flex items-center gap-1.5">
                      <JobCardHint
                        title="View all partner extras"
                        onClick={() => openExtraManager("partner")}
                        className="focus:ring-rose-400"
                      />
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Extras</p>
                    </div>
                    <div className="py-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-text-secondary">Total Extras</span>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("font-semibold tabular-nums", partnerExtraTotalDisplay > 0.02 ? "text-rose-700" : "text-text-tertiary")}>
                            {partnerExtraTotalDisplay > 0.02 ? `+${formatCurrency(partnerExtraTotalDisplay)}` : formatCurrency(0)}
                          </span>
                          <button
                            type="button"
                            className="text-text-tertiary transition-colors hover:text-text-primary"
                            onClick={() => openExtraManager("partner")}
                            title="Edit or remove extras"
                            aria-label="Edit or remove partner extras"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">Labour</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", partnerExtraPlainDisplay > 0.02 ? "text-rose-700" : "text-text-tertiary")}>
                          {partnerExtraPlainDisplay > 0.02 ? `+${formatCurrency(partnerExtraPlainDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("partner", "extra", partnerExtraPlainDisplay > 0.02 || bucketHasLedgerEntries("partner", "extra"))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">CCZ</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", partnerExtraCczDisplay > 0.02 ? "text-rose-700" : "text-text-tertiary")}>
                          {partnerExtraCczDisplay > 0.02 ? `+${formatCurrency(partnerExtraCczDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("partner", "ccz", partnerExtraCczDisplay > 0.02 || bucketHasLedgerEntries("partner", "ccz"))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">Parking</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", partnerExtraParkingDisplay > 0.02 ? "text-rose-700" : "text-text-tertiary")}>
                          {partnerExtraParkingDisplay > 0.02 ? `+${formatCurrency(partnerExtraParkingDisplay)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("partner", "parking", partnerExtraParkingDisplay > 0.02 || bucketHasLedgerEntries("partner", "parking"))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 text-xs">
                      <span className="text-text-secondary">Materials</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular-nums", partnerMaterialsLine > 0.02 ? "text-rose-700" : "text-text-tertiary")}>
                          {partnerMaterialsLine > 0.02 ? `+${formatCurrency(partnerMaterialsLine)}` : formatCurrency(0)}
                        </span>
                        {renderExtraCategoryPencil("partner", "materials", partnerMaterialsLine > 0.02 || bucketHasLedgerEntries("partner", "materials"))}
                      </div>
                    </div>
                  </div>
                  {/* Partner payment history: always show header when there is a partner cost so empty state is visible */}
                  {partnerCashOutTotal > 0.02 || partnerUsesClawbackUi ? (
                    <div className="mt-1 space-y-2">
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-1">Payment history</p>
                        {partnerPayoutLedgerRows.length === 0 && partnerLegacyCostAsPayoutRows.length === 0 ? (
                          <p className="text-[10px] text-text-tertiary pl-0.5">No payouts recorded yet.</p>
                        ) : null}
                        {partnerPayoutLedgerRows.map((p) => {
                            const ledgerTag = parseJobPaymentLedgerLabel(p.note);
                            const noteRest = jobPaymentNoteWithoutLedgerPrefix(p.note);
                            const primaryLabel = ledgerTag ?? "Partner payout";
                            return (
                              <div
                                key={p.id}
                                className="flex items-start justify-between gap-2 rounded-lg bg-surface-hover/40 px-2.5 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-semibold text-text-tertiary uppercase">{primaryLabel}</span>
                                    <Badge variant="outline" size="sm">
                                      Paid
                                    </Badge>
                                    {p.payment_method && (
                                      <span className="text-[10px] text-text-tertiary">
                                        {p.payment_method === "bank_transfer"
                                          ? "Bank"
                                          : p.payment_method === "cash"
                                            ? "Cash"
                                            : p.payment_method === "other"
                                              ? "Other"
                                              : p.payment_method}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-text-tertiary">
                                      ·{" "}
                                      {new Date(p.payment_date).toLocaleDateString("en-GB", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                      })}
                                    </span>
                                  </div>
                                  {ledgerTag ? (
                                    <p className="text-[10px] text-text-tertiary truncate pl-0.5">Cash out</p>
                                  ) : null}
                                  {p.bank_reference && (
                                    <p className="text-[10px] text-text-tertiary truncate">Ref: {p.bank_reference}</p>
                                  )}
                                  {noteRest ? <p className="text-[10px] text-text-tertiary truncate">{noteRest}</p> : null}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span
                                    className="text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300"
                                    title="Reduces amount due only"
                                  >
                                    {formatCurrencyPrecise(-Number(p.amount))}
                                  </span>
                                  {isAdmin && (
                                    <button
                                      onClick={() =>
                                        setDeletePaymentTarget({ id: p.id, amount: Number(p.amount), type: p.type })
                                      }
                                      className="text-text-tertiary hover:text-red-500 transition-colors"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                      {partnerLegacyCostAsPayoutRows.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-1">
                            Cost adjustment (legacy)
                          </p>
                          {partnerLegacyCostAsPayoutRows.map((p) => {
                            const noteRest = jobPaymentNoteWithoutLedgerPrefix(p.note);
                            return (
                              <div
                                key={p.id}
                                className="flex items-start justify-between gap-2 rounded-lg bg-surface-hover/40 px-2.5 py-2 border border-orange-500/20"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <Badge variant="warning" size="sm">
                                      Extra cost
                                    </Badge>
                                    <span className="text-[10px] text-text-tertiary">
                                      ·{" "}
                                      {new Date(p.payment_date).toLocaleDateString("en-GB", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                      })}
                                    </span>
                                  </div>
                                  {noteRest ? <p className="text-[10px] text-text-tertiary truncate">{noteRest}</p> : null}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span
                                    className="text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400"
                                    title="Positive partner cost (legacy row)"
                                  >
                                    +{formatCurrencyPrecise(Number(p.amount))}
                                  </span>
                                  {isAdmin && (
                                    <button
                                      onClick={() =>
                                        setDeletePaymentTarget({ id: p.id, amount: Number(p.amount), type: p.type })
                                      }
                                      className="text-text-tertiary hover:text-red-500 transition-colors"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {(partnerCashOutTotal > 0.02 || partnerUsesClawbackUi) ? (
                    <div className="flex items-center justify-between pt-1.5 border-t border-border-light dark:border-[#2f3642]">
                      <span
                        className={`text-xs font-semibold ${
                          (partnerUsesClawbackUi ? partnerClawbackOwed > 0.02 : partnerPayRemaining > 0) ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {partnerUsesClawbackUi
                          ? partnerClawbackOwed > 0.02
                            ? "Outstanding clawback"
                            : "No clawback recorded"
                          : partnerPayRemaining > 0
                            ? "Amount due"
                            : "Fully paid out"}
                      </span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          (partnerUsesClawbackUi ? partnerClawbackOwed > 0.02 : partnerPayRemaining > 0) ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {partnerUsesClawbackUi
                          ? partnerClawbackOwed > 0.02
                            ? formatCurrencyPrecise(-partnerClawbackOwed)
                            : formatCurrencyPrecise(0)
                          : partnerPayRemaining > 0
                            ? formatCurrency(partnerPayRemaining)
                            : formatCurrency(0)}
                      </span>
                    </div>
                  ) : null}
                </div>
                {/* Always stack — right rail (~352px) is too narrow for two side-by-side action buttons */}
                <div className="mt-2 flex w-full flex-col gap-2">
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="primary"
                      className="min-h-[2.75rem] w-full rounded-lg px-3 text-sm font-semibold shadow-sm dark:bg-[#020040]"
                      disabled={!job.partner_id?.trim() || job.status === "cancelled"}
                      icon={<Plus className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMoneyDrawerFlow("partner_pay");
                        setMoneyDrawerOpen(true);
                      }}
                      title='Records real money paid to partner (not an extra labour line). Choose "Deposit pass-through" or "Advance" if paying ahead of the labour cap.'
                    >
                      Record partner payment
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "min-h-[2.75rem] w-full rounded-lg border-rose-300/90 bg-rose-50 px-3 text-sm font-semibold text-rose-900 shadow-sm hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-950/30 dark:text-rose-100 dark:hover:bg-rose-950/45",
                    )}
                    disabled={!job.partner_id?.trim() || job.status === "cancelled"}
                    icon={<Plus className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMoneyDrawerFlow("partner_extra");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Payout or discount
                  </Button>
                </div>
              </div>

              {/* Net margin */}
              <div className="space-y-1.5 border-t border-border-light pt-2 dark:border-[#2f3642]">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Net margin</p>
                      {marginAppearance.low ? (
                        <span className="group relative inline-flex">
                          <span
                            tabIndex={0}
                            aria-label="Margin below target — click for details"
                            className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-full bg-red-100 text-red-600 text-[10px] font-bold leading-none dark:bg-red-950/50 dark:text-red-400"
                          >
                            !
                          </span>
                          <span
                            role="tooltip"
                            className="pointer-events-none invisible absolute bottom-full left-1/2 z-[60] mb-1 w-52 -translate-x-1/2 whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1.5 text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                          >
                            Net margin is below {JOB_DETAIL_HEALTHY_MARGIN_PCT}% — review the partner cost or raise the client price before approving.
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xl font-bold tabular-nums tracking-tight text-text-primary">{formatCurrency(profit)}</p>
                  </div>
                  <p className={cn("text-xl font-bold tabular-nums tracking-tight", marginAppearance.pctClass)}>{marginPct}%</p>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary dark:bg-[#2a3038]">
                  <div
                    className={cn("h-full rounded-full transition-all", marginAppearance.barClass)}
                    style={{ width: `${Math.max(0, Math.min(100, marginPct))}%` }}
                  />
                </div>
                {(quoteLineBreakdown || (job.customer_final_payment ?? 0) > 0.02 || customerScheduleMismatch) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 h-9 w-full rounded-lg text-xs font-medium"
                    onClick={() => setJobBillingDetailsOpen(true)}
                  >
                    View full billing details
                  </Button>
                ) : null}
              </div>

              {/* Fully paid */}
              {job.customer_final_paid && (
                <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 p-2 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <p className="text-xs font-medium text-emerald-700">Job fully paid</p>
                </div>
              )}
              {markedPaidBy ? (
                <div className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 dark:border-sky-500/35 dark:bg-sky-950/20">
                  <p className="text-[11px] font-medium text-sky-800 dark:text-sky-200">Marked as paid by {markedPaidBy}</p>
                </div>
              ) : null}
            </div>

            {/* Financial documents: client invoices (us→client) */}
            <div className="rounded-lg border border-border-light bg-card p-2 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Financial documents</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] shrink-0">
                  <Link href="/finance/billing/invoices" className="text-primary hover:underline inline-flex items-center gap-1">
                    All invoices <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link href="/finance/billing/selfbill" className="text-primary hover:underline inline-flex items-center gap-1">
                    All self bills <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client invoices</p>
                  {invoiceLifecycleBadge ? (
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", invoiceLifecycleBadge.className)}>
                      {invoiceLifecycleBadge.label}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                      Not created
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  We invoice the <strong className="font-medium text-text-secondary">client</strong> for this job.
                </p>
                {loadingInvoices ? (
                  <p className="text-xs text-text-tertiary">Loading…</p>
                ) : jobInvoices.length === 0 ? (
                  <p className="text-xs text-text-tertiary">
                    No invoices linked yet. They appear when finance raises an invoice for this job reference (or when a job is created with auto-invoice).
                  </p>
                ) : (
                  jobInvoices.map((inv) => {
                      const stripePaid = inv.stripe_payment_status === "paid";
                      const invOpen = expandedInvoiceIds.has(inv.id);
                      const canEditInvoiceDueDate = inv.status !== "paid" && inv.status !== "cancelled";
                      const dueDraft =
                        invoiceDueDateDrafts[inv.id] ??
                        (inv.due_date ? String(inv.due_date).slice(0, 10) : "");
                      const duePrev = inv.due_date ? String(inv.due_date).slice(0, 10) : "";
                      return (
                        <div key={inv.id} className="rounded-md border border-border-light p-2">
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              aria-expanded={invOpen}
                              aria-label={invOpen ? "Hide invoice details" : "Show invoice details"}
                              onClick={() => {
                                setExpandedInvoiceIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(inv.id)) next.delete(inv.id);
                                  else next.add(inv.id);
                                  return next;
                                });
                              }}
                              className="shrink-0 rounded-lg border border-transparent p-1.5 text-text-secondary transition-colors hover:border-border-light hover:bg-surface-tertiary hover:text-text-primary mt-0.5"
                            >
                              <ChevronDown className={cn("h-5 w-5 transition-transform duration-200", invOpen && "rotate-180")} />
                            </button>
                            <div className="min-w-0 flex-1 space-y-2">
                              {!invOpen ? (
                                <div className="flex items-start justify-between gap-2 pt-0.5">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-text-primary truncate">{inv.reference}</p>
                                    {inv.due_date ? (
                                      <p className="text-[10px] text-text-tertiary mt-0.5">Due {formatDate(inv.due_date)}</p>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <p className="text-lg font-bold tabular-nums text-primary tracking-tight">
                                      {formatCurrency(inv.amount)}
                                    </p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      icon={<FileText className="h-3 w-3" />}
                                      title="Download receipt PDF"
                                      onClick={() =>
                                        window.open(`/api/invoices/${inv.id}/pdf`, "_blank", "noopener,noreferrer")
                                      }
                                    >
                                      PDF
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-text-primary truncate">{inv.reference}</p>
                                    <Badge
                                      variant={
                                        inv.status === "paid"
                                          ? "success"
                                          : inv.status === "partially_paid"
                                            ? "info"
                                            : "warning"
                                      }
                                      size="sm"
                                    >
                                      {inv.status === "partially_paid" ? "Partial" : inv.status}
                                    </Badge>
                                  </div>
                                  <p className="text-sm font-bold tabular-nums">{formatCurrency(inv.amount)}</p>
                                  <div className="space-y-1.5 pt-0.5">
                                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
                                      Due date
                                    </p>
                                    {canEditInvoiceDueDate ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Input
                                          type="date"
                                          className="w-full min-w-[9.5rem] max-w-[11rem]"
                                          value={dueDraft}
                                          onChange={(e) =>
                                            setInvoiceDueDateDrafts((d) => ({ ...d, [inv.id]: e.target.value }))
                                          }
                                          aria-label={`Invoice due date (${inv.reference})`}
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          loading={savingInvoiceDueDateId === inv.id}
                                          disabled={
                                            savingInvoiceDueDateId === inv.id || dueDraft.trim() === duePrev
                                          }
                                          onClick={() => void saveInvoiceDueDate(inv, dueDraft)}
                                        >
                                          Save
                                        </Button>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-text-secondary">
                                        {inv.due_date ? formatDate(inv.due_date) : "—"}
                                      </p>
                                    )}
                                  </div>
                                  {(inv.status === "partially_paid" || invoiceAmountPaid(inv) > 0.02) && inv.status !== "paid" ? (
                                    <p className="text-[11px] text-text-tertiary">
                                      Paid {formatCurrency(invoiceAmountPaid(inv))} · Due {formatCurrency(invoiceBalanceDue(inv))}
                                    </p>
                                  ) : null}
                                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      icon={<FileText className="h-3 w-3" />}
                                      onClick={() =>
                                        window.open(`/api/invoices/${inv.id}/pdf`, "_blank", "noopener,noreferrer")
                                      }
                                    >
                                      Receipt PDF
                                    </Button>
                                    <Badge variant={stripePaid ? "success" : "default"} size="sm">Stripe: {inv.stripe_payment_status ?? "none"}</Badge>
                                    {inv.stripe_payment_link_url && (
                                      <>
                                        <Button size="sm" variant="outline" icon={<CreditCard className="h-3 w-3" />} onClick={() => window.open(inv.stripe_payment_link_url!, "_blank", "noopener,noreferrer")}>Pay link</Button>
                                        <Button size="sm" variant="secondary" loading={syncingInvoiceId === inv.id} icon={<RefreshCw className="h-3 w-3" />} onClick={() => void handleStripeInvoiceSync(inv)}>Sync</Button>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border-light bg-card p-2 space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Partner self-bill</p>
                {selfBillLifecycleBadge ? (
                  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", selfBillLifecycleBadge.className)}>
                    {selfBillLifecycleBadge.label}
                  </span>
                ) : null}
              </div>
              <p className="text-[10px] text-text-tertiary leading-snug">Assign a partner on this job to use self billing.</p>
              {!job.partner_id?.trim() ? null : loadingSelfBill ? (
                <p className="text-xs text-text-tertiary">Loading…</p>
              ) : jobSelfBill ? (
                <JobDetailSelfBillPanel sb={jobSelfBill} job={job} />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-text-tertiary">
                    This job is not linked to a weekly self bill yet. New jobs with a partner usually link automatically; you can attach it now.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={linkingSelfBill}
                    onClick={async () => {
                      if (!job) return;
                      setLinkingSelfBill(true);
                      try {
                        await createSelfBillFromJob({
                          id: job.id,
                          reference: job.reference,
                          partner_name: job.partner_name,
                          partner_cost: job.partner_cost,
                          materials_cost: job.materials_cost,
                        });
                        const j2 = await getJob(job.id);
                        if (j2) {
                          setJob(j2);
                          await loadJobSelfBill(j2);
                        }
                        toast.success("Linked to this week’s self bill");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not link self bill");
                      } finally {
                        setLinkingSelfBill(false);
                      }
                    }}
                  >
                    Link weekly self bill
                  </Button>
                </div>
              )}
            </div>

          </div>
        </div>
        </div>
      </div>
      </div>

      <FinalReviewModal
        isOpen={validateCompleteOpen}
        reviewSummary={finalReviewSummarySnapshot}
        onClose={() => {
          if (validatingComplete) return;
          setValidateCompleteOpen(false);
          setOwnerApprovalChecked(false);
          setForceApprovalChecked(false);
          setForceApprovalReason("");
          setSentToAccountsChecked(false);
          setApprovalBilledHoursInput("");
          setCompletionDelivery(null);
          setIncludeInvoiceInEmail(true);
          setIncludeReportInEmail(true);
        }}
        jobId={job.reference}
        jobTitle={job.title ?? ""}
        clientName={job.client_name ?? ""}
        partnerName={job.partner_name ?? ""}
        currentUserName={attestationDisplayName}
        jobValue={approvalBillableRevenue}
        partnerPayout={approvalPartnerGross}
        margin={approvalProfit}
        marginPct={Math.max(0, approvalMarginPct)}
        received={customerPaidTotal}
        paidOut={partnerPaidTotal}
        clientOutstanding={approvalEffectiveCustomerDue}
        partnerOutstanding={approvalPartnerPayRemaining}
        invoiceStatus={job.invoice_id ? "issued" : "pending"}
        selfBillStatus={job.self_bill_id ? "issued" : "pending"}
        invoiceReference={approvalPrimaryInvoice?.reference ?? null}
        selfBillReference={jobSelfBill?.reference ?? null}
        reports={phaseIndexes.map<ReportItem>((n) => ({
          id: `report-${n}`,
          name: `Report ${n}`,
          uploaded: Boolean(job[`report_${n}_uploaded` as keyof Job]),
          approved: Boolean(job[`report_${n}_approved` as keyof Job]),
        }))}
        confirmed={ownerApprovalChecked}
        onConfirmedChange={setOwnerApprovalChecked}
        sentToAccounts={sentToAccountsChecked}
        onSentToAccountsChange={setSentToAccountsChecked}
        forceMode={forceApprovalChecked}
        onForceModeChange={setForceApprovalChecked}
        forceReason={forceApprovalReason}
        onForceReasonChange={setForceApprovalReason}
        completionDelivery={completionDelivery}
        onCompletionDeliveryChange={setCompletionDelivery}
        includeInvoiceInEmail={includeInvoiceInEmail}
        onIncludeInvoiceInEmailChange={setIncludeInvoiceInEmail}
        includeReportInEmail={includeReportInEmail}
        onIncludeReportInEmailChange={setIncludeReportInEmail}
        accountEmailPolicy={accountEmailPolicy}
        submitting={validatingComplete}
        onApprove={() => {
          setForceApprovalChecked(false);
          setForceApprovalReason("");
          void handleValidateAndComplete();
        }}
        onForceApprove={() => void handleValidateAndComplete()}
        hourlySlot={
          job.job_type === "hourly" ? (
            <div
              className="rounded-[10px] flex items-end gap-3"
              style={{
                background: "#FAFAFB",
                border: "0.5px solid #E4E4E7",
                padding: "10px 12px",
              }}
            >
              <div className="flex-1">
                <label
                  className="block text-[10px] font-medium uppercase mb-1"
                  style={{ color: "#6B6B70", letterSpacing: "0.5px" }}
                >
                  Final billed hours
                </label>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={approvalBilledHoursInput}
                  onChange={(e) => setApprovalBilledHoursInput(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <p className="text-[11px] pb-[9px]" style={{ color: "#6B6B70" }}>
                Confirm before finalise
              </p>
            </div>
          ) : null
        }
      />


      <Modal
        open={putOnHoldOpen}
        onClose={() => {
          if (!putOnHoldSaving) {
            setPutOnHoldOpen(false);
            setPutOnHoldReason("");
            setPutOnHoldPreset(null);
          }
        }}
        title="Put job on hold"
        subtitle={job.reference}
        size="md"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">
            The job leaves the on-site step until you resume. Current schedule is saved for the resume flow; add a reason for your team and the audit trail.
          </p>
          <div>
            <Select
              label="Reason preset"
              value={putOnHoldPreset ?? ""}
              options={putOnHoldReasonOptions}
              onChange={(e) => {
                const preset = e.target.value;
                setPutOnHoldPreset(preset || null);
                if (!preset) return;
                if (preset.trim().toLowerCase() === "other") {
                  putOnHoldReasonRef.current?.focus();
                  return;
                }
                setPutOnHoldReason(preset);
              }}
              className="mb-3 h-10"
            />
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason *</label>
            <textarea
              ref={putOnHoldReasonRef}
              value={putOnHoldReason}
              onChange={(e) => setPutOnHoldReason(e.target.value)}
              rows={3}
              placeholder="Why is this job on hold?"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[72px]"
            />
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={putOnHoldSaving}
              onClick={() => {
                setPutOnHoldOpen(false);
                setPutOnHoldReason("");
                setPutOnHoldPreset(null);
              }}
            >
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-red-950/40 bg-red-950/[0.08] text-red-950 hover:bg-red-950/12 dark:border-red-900/55 dark:bg-red-950/45 dark:text-red-50 dark:hover:bg-red-950/55"
              loading={putOnHoldSaving}
              onClick={() => void confirmPutOnHold()}
            >
              Put on hold
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={resumeJobOpen}
        onClose={() => {
          if (!resumeSaving) setResumeJobOpen(false);
        }}
        title="Resume job"
        subtitle={job.reference}
        size="md"
      >
        <div className="p-4 space-y-4">
          {job.on_hold_at ? (
            <div className="rounded-lg border border-border-light bg-surface-hover/50 px-3 py-2 space-y-1 text-xs text-text-secondary">
              <p>
                <span className="font-semibold text-text-primary">Time on hold:</span>{" "}
                {(() => {
                  try {
                    const t = parseISO(job.on_hold_at!);
                    return Number.isNaN(t.getTime()) ? "—" : formatDistanceStrict(t, new Date(), { addSuffix: false });
                  } catch {
                    return "—";
                  }
                })()}
              </p>
              {job.on_hold_reason?.trim() ? (
                <p>
                  <span className="font-semibold text-text-primary">Reason:</span> {job.on_hold_reason.trim()}
                </p>
              ) : (
                <p className="text-text-tertiary italic">No reason recorded.</p>
              )}
            </div>
          ) : null}
          <p className="text-sm text-text-secondary">
            Choose what you want to do with this on-hold job.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              variant={resumeAction === "reschedule" ? "primary" : "outline"}
              size="sm"
              className="min-h-[2.25rem] w-full flex-1 basis-0 sm:min-h-8 sm:w-auto"
              disabled={resumeSaving}
              onClick={() => setResumeAction("reschedule")}
            >
              Reschedule
            </Button>
            <Button
              variant={resumeAction === "complete" ? "outline" : "outline"}
              size="sm"
              disabled={resumeSaving}
              onClick={() => setResumeAction("complete")}
              className={cn(
                "min-h-[2.25rem] w-full flex-1 basis-0 sm:min-h-8 sm:w-auto",
                resumeAction === "complete" &&
                  "border-emerald-600/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300",
              )}
            >
              Complete
            </Button>
            <Button
              variant={resumeAction === "cancel" ? "danger" : "outline"}
              size="sm"
              disabled={resumeSaving}
              className="min-h-[2.25rem] w-full flex-1 basis-0 sm:min-h-8 sm:w-auto"
              onClick={() => setResumeAction("cancel")}
            >
              Cancel
            </Button>
          </div>
          {resumeAction === "reschedule" ? (
            <>
              <p className="text-xs text-text-tertiary">
                If the saved arrival date is no longer in the future, choose a valid date/time before resuming.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className={cn(isOneOffScheduleUi && "sm:col-span-2")}>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Arrival Date *</label>
                  <Input
                    type="date"
                    value={resumeArrivalDate}
                    disabled={resumeSaving}
                    onChange={(e) => {
                      const v = e.target.value;
                      setResumeArrivalDate(v);
                      if (isRecurringSeriesJob && resumeExpectedFinishDate.trim() && v && resumeExpectedFinishDate < v) {
                        setResumeExpectedFinishDate(v);
                      }
                    }}
                    className="h-10"
                  />
                </div>
                {isOneOffScheduleUi ? (
                  <div
                    className={cn(
                      "sm:col-span-2",
                      resumeSaving && "pointer-events-none opacity-60",
                    )}
                  >
                    <ArrivalSlotPicker
                      arrivalFrom={resumeArrivalTime}
                      arrivalWindowMins={resumeArrivalWindowMins}
                      onPick={(from, mins) => {
                        setResumeArrivalTime(from);
                        setResumeArrivalWindowMins(mins);
                      }}
                    />
                    {(() => {
                      const preview = jobModalClientArrivalPreview(
                        resumeArrivalDate,
                        resumeArrivalTime,
                        resumeArrivalWindowMins,
                        { useArrivalSlots: isOneOffScheduleUi },
                      );
                      return preview ? (
                        <p className="mt-2 text-[11px] font-medium text-text-secondary">{preview}</p>
                      ) : null;
                    })()}
                  </div>
                ) : (
                  <>
                    <div>
                      <TimeSelect
                        label="Arrival Time"
                        value={resumeArrivalTime}
                        disabled={resumeSaving}
                        onChange={(v) => setResumeArrivalTime(v)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-secondary">Window</label>
                      <Select
                        className="h-10"
                        value={resumeArrivalWindowMins}
                        disabled={resumeSaving}
                        onChange={(e) => setResumeArrivalWindowMins(e.target.value)}
                        options={[...ARRIVAL_WINDOW_OPTIONS]}
                      />
                    </div>
                  </>
                )}
                {isRecurringSeriesJob ? (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                      Expected Finish Date{resumeArrivalDate.trim() ? <span className="text-red-600"> *</span> : null}
                    </label>
                    <Input
                      type="date"
                      value={resumeExpectedFinishDate}
                      min={resumeArrivalDate.trim() ? resumeArrivalDate.trim() : undefined}
                      disabled={resumeSaving || !resumeArrivalDate.trim()}
                      title={!resumeArrivalDate.trim() ? "Set the arrival date first" : undefined}
                      onChange={(e) => {
                        const min = resumeArrivalDate.trim();
                        const v = e.target.value;
                        if (min && v && v < min) return;
                        setResumeExpectedFinishDate(v);
                      }}
                      className="h-10"
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {resumeAction === "cancel" ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-3">
              <p className="text-xs text-red-700 dark:text-red-300">
                The assigned partner will be notified with this reason.
              </p>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason</label>
                <select
                  value={cancelPresetId}
                  onChange={(e) => setCancelPresetId(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-card text-sm text-text-primary px-3"
                  disabled={cancellingJob}
                >
                  {officeCancellationPresets.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  {officeCancellationDetailRequired(cancelPresetId) ? "Details (required)" : "Additional details (optional)"}
                </label>
                <textarea
                  value={cancelDetail}
                  onChange={(e) => setCancelDetail(e.target.value)}
                  rows={3}
                  placeholder={officeCancellationDetailRequired(cancelPresetId) ? "Describe why this job is being cancelled…" : "Optional context for the partner or internal record…"}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[72px]"
                  disabled={cancellingJob}
                />
              </div>
            </div>
          ) : null}
          {resumeAction === "complete" ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              Continue to the existing completion validation flow.
            </div>
          ) : null}
          {!jobHasPartnerSet(job) && (job.status === "unassigned" || job.status === "auto_assigning") ? (
            <div className="space-y-2 border-t border-border-light pt-3">
              <p className="text-xs font-medium text-text-secondary">Partner assignment</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={savingJobTypeEdit}
                  onClick={() => setJobAssignmentEditMode("manual")}
                  className={cn(
                    "text-left rounded-lg border px-2.5 py-2 text-sm transition-colors min-w-0",
                    jobAssignmentEditMode === "manual"
                      ? "border-[#1DB87A]/40 bg-[#1DB87A]/10 text-[#157a55]"
                      : "border-border bg-card text-text-secondary",
                  )}
                >
                  <p className="font-medium">Manual assign</p>
                  <p className="text-xs opacity-80">Pick a partner from the sidebar</p>
                </button>
                <button
                  type="button"
                  disabled={savingJobTypeEdit}
                  onClick={() => setJobAssignmentEditMode("auto")}
                  className={cn(
                    "text-left rounded-lg border px-2.5 py-2 text-sm transition-colors min-w-0",
                    jobAssignmentEditMode === "auto"
                      ? "border-[#1DB87A]/40 bg-[#1DB87A]/10 text-[#157a55]"
                      : "border-border bg-card text-text-secondary",
                  )}
                >
                  <p className="font-medium">Auto assign</p>
                  <p className="text-xs opacity-80">Invite matched partners — first accept wins</p>
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={resumeSaving || cancellingJob}
              onClick={() => setResumeJobOpen(false)}
            >
              Back
            </Button>
            <Button
              variant={resumeAction === "cancel" ? "danger" : "primary"}
              size="sm"
              loading={(resumeAction === "reschedule" && resumeSaving) || (resumeAction === "cancel" && cancellingJob)}
              onClick={() => void handleResumeModalAction()}
            >
              {resumeAction === "reschedule" ? "Reschedule & Resume" : resumeAction === "cancel" ? "Cancel Job" : "Final Review"}
            </Button>
          </div>
        </div>
      </Modal>

      <CancelJobModal
        jobId={job.id}
        jobReference={job.reference}
        isOpen={cancelJobOpen}
        onClose={() => setCancelJobOpen(false)}
        onCancelled={(updated) => {
          setJob(updated);
          void refreshJobFinance();
        }}
      />

      <Modal
        open={jobBillingDetailsOpen}
        onClose={() => setJobBillingDetailsOpen(false)}
        title="Full billing details"
        subtitle={job.reference}
        size="lg"
        scrollBody
      >
        <div className="p-4">{jobBillingDetailsBody}</div>
      </Modal>

      <Modal
        open={jobTypeEditOpen}
        onClose={() => {
          if (savingJobTypeEdit) return;
          setJobTypeEditOpen(false);
        }}
        title="Billing type"
        subtitle={job.reference ? `${job.reference} — pricing & partner assignment` : "Switch pricing and assignment mode"}
        size="md"
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-text-tertiary leading-snug">
            <strong className="text-text-secondary">{pricingModeLabel("hourly")}</strong> uses a Call Out from Services — amounts follow the catalogue with account/partner overrides.{" "}
            <strong className="text-text-secondary">{pricingModeLabel("fixed")}</strong> keeps labour totals you set here unless you change them in Finance.
          </p>
          <Select
            label="Job type"
            value={jobTypeEditTarget}
            disabled={savingJobTypeEdit}
            onChange={(e) => {
              const v = e.target.value as "fixed" | "hourly";
              setJobTypeEditTarget(v);
              if (v === "fixed") {
                setJobTypeEditFixedTitle(job.title ?? "");
                setFixedInlineClientRate(String(Math.max(0, Number(job.client_price ?? 0))));
                setFixedInlinePartnerCost(String(Math.max(0, Number(job.partner_cost ?? 0))));
              }
            }}
            options={[
              { value: "fixed", label: pricingModeLabel("fixed") },
              { value: "hourly", label: pricingModeLabel("hourly") },
            ]}
          />
          {jobTypeEditTarget === "hourly" ? (
            <div className={cn(loadingJobTypeCatalog && "opacity-70 pointer-events-none")}>
              <ServiceCatalogSelect
                label="Call Out type *"
                emptyOptionLabel="Select from Services..."
                catalog={catalogServicesJobType}
                value={jobTypeEditCatalogId}
                disabled={savingJobTypeEdit}
                onChange={(id) => setJobTypeEditCatalogId(id)}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <Select
                label="Type Of Work *"
                value={jobTypeEditFixedTitle}
                disabled={savingJobTypeEdit}
                onChange={(e) => setJobTypeEditFixedTitle(e.target.value)}
                options={jobTypeEditFixedSelectOptions}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Client rate £</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={fixedInlineClientRate}
                    onChange={(e) => setFixedInlineClientRate(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Partner Cost £</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={fixedInlinePartnerCost}
                    onChange={(e) => setFixedInlinePartnerCost(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              {fixedSwitchPreview ? (
                <div className="rounded-lg border border-border-light bg-surface-hover/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Confirm fixed values</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-md border border-border-light bg-card px-2 py-1.5">
                      <p className="text-text-tertiary">Client value (sale)</p>
                      <p className="font-semibold tabular-nums text-text-primary">
                        {formatCurrency(Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale))}
                      </p>
                    </div>
                    <div className="rounded-md border border-border-light bg-card px-2 py-1.5">
                      <p className="text-text-tertiary">Partner cost</p>
                      <p className="font-semibold tabular-nums text-text-primary">
                        {formatCurrency(Math.max(0, Number(fixedInlinePartnerCost) || fixedSwitchPreview.cost))}
                      </p>
                    </div>
                    <div className="rounded-md border border-border-light bg-card px-2 py-1.5">
                      <p className="text-text-tertiary">Margin</p>
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          (Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale) -
                            Math.max(0, Number(fixedInlinePartnerCost) || fixedSwitchPreview.cost)) >= 0
                            ? "text-emerald-700"
                            : "text-red-600",
                        )}
                      >
                        {formatCurrency(
                          Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale) -
                            Math.max(0, Number(fixedInlinePartnerCost) || fixedSwitchPreview.cost),
                        )}
                      </p>
                    </div>
                    <div className="rounded-md border border-border-light bg-card px-2 py-1.5">
                      <p className="text-text-tertiary">Margin %</p>
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          ((Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale) -
                            Math.max(0, Number(fixedInlinePartnerCost) || fixedSwitchPreview.cost)) /
                            Math.max(1, Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale))) >= 0
                            ? "text-emerald-700"
                            : "text-red-600",
                        )}
                      >
                        {Math.round(
                          ((Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale) -
                            Math.max(0, Number(fixedInlinePartnerCost) || fixedSwitchPreview.cost)) /
                            Math.max(1, Math.max(0, Number(fixedInlineClientRate) || fixedSwitchPreview.sale))) *
                            1000,
                        ) / 10}
                        %
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={savingJobTypeEdit}
              onClick={() => setJobTypeEditOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              loading={savingJobTypeEdit}
              disabled={
                savingJobTypeEdit ||
                (jobTypeEditTarget === "hourly" && (!jobTypeEditCatalogId || loadingJobTypeCatalog)) ||
                (jobTypeEditTarget === "fixed" && !jobTypeEditFixedTitle.trim())
              }
              onClick={() => void handleSaveJobTypeEdit()}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={extraManagerSide != null}
        onClose={() => {
          setExtraManagerSide(null);
          setExtraManagerFocusBucket(null);
        }}
        title={extraManagerTitle}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-text-tertiary leading-snug max-w-[60%]">
              Tap edit or remove on any listed extra. Use the pencil on Finance Summary to open this list.
            </p>
            <Button
              size="sm"
              variant="outline"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => {
                if (extraManagerSide === "client") {
                  setMoneyDrawerInitialExtraType(undefined);
                  setMoneyDrawerFlow("client_extra");
                } else {
                  setMoneyDrawerFlow("partner_extra");
                }
                setExtraManagerSide(null);
                setMoneyDrawerOpen(true);
              }}
            >
              {extraManagerSide === "client" ? "Charge or discount" : "Payout or discount"}
            </Button>
          </div>

          <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
            {extraManagerEntries.length === 0 ? (
              <p className="text-xs text-text-tertiary">{extraManagerEmptyText}</p>
            ) : null}
            {extraManagerEntries.length > 0
              ? extraManagerGroups
                  .filter((group) => group.entries.length > 0)
                  .map((group) => {
                    const groupTotal = group.entries.reduce((sum, row) => sum + extraHistorySignedAmount(row), 0);
                    const groupHasEditableEntries = group.entries.some((row) => !isFallbackExtraEntry(row));
                    const groupFocused = extraManagerFocusBucket === group.key;
                    return (
                      <div
                        key={group.key}
                        className={cn(
                          "rounded-lg border border-border-light/70 bg-background/50 p-2 dark:border-[#2f3642] dark:bg-[#101621]",
                          groupFocused && "ring-2 ring-primary/35",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 pb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{group.label}</span>
                            {!groupHasEditableEntries ? (
                              <Badge variant="outline" size="sm" className="h-4 text-[9px]">Summary only</Badge>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              "text-[11px] font-semibold tabular-nums",
                              extraManagerSide === "client" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-300",
                            )}
                          >
                            {formatSignedCurrency(groupTotal)}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {group.entries.map((entry) => (
                            <div key={entry.id} className="flex items-start justify-between gap-2 rounded-md bg-surface-hover/40 px-2.5 py-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] font-semibold uppercase text-text-tertiary">{entry.extraType}</span>
                                  {entry.side === "client" && !isJobExtraDiscountExtraType(entry.extraType) ? (
                                    <Badge
                                      variant={
                                        entry.clientConfirmed == null
                                          ? "outline"
                                          : entry.clientConfirmed
                                            ? "success"
                                            : "warning"
                                      }
                                      size="sm"
                                    >
                                      {entry.clientConfirmed == null
                                        ? "Confirmation unknown"
                                        : entry.clientConfirmed
                                          ? "Client confirmed"
                                          : "Not confirmed"}
                                    </Badge>
                                  ) : null}
                                  {entry.createdAt ? (
                                    <span className="text-[10px] text-text-tertiary">
                                      · {new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                    </span>
                                  ) : null}
                                  {entry.userName ? <span className="text-[10px] text-text-tertiary">· {entry.userName}</span> : null}
                                </div>
                                {entry.reason ? <p className="text-[11px] text-text-secondary">{entry.reason}</p> : null}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className={cn(
                                    "text-xs font-semibold tabular-nums",
                                    entry.side === "client" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-300",
                                  )}
                                >
                                  {formatSignedCurrency(extraHistorySignedAmount(entry))}
                                </span>
                                {!isFallbackExtraEntry(entry) ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditExtra(entry)}
                                      disabled={deletingExtraId === entry.idRaw || savingExtraEdit}
                                      className="text-text-tertiary transition-colors hover:text-text-primary disabled:opacity-50"
                                      title="Edit amount or reason"
                                      aria-label="Edit extra"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteExtraEntry(entry)}
                                      disabled={deletingExtraId === entry.idRaw || savingExtraEdit}
                                      className="text-text-tertiary transition-colors hover:text-red-500 disabled:opacity-50"
                                      title="Remove this extra"
                                      aria-label="Remove extra"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
              : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={editExtraTarget != null}
        onClose={() => {
          if (savingExtraEdit) return;
          setEditExtraTarget(null);
        }}
        title="Edit extra"
      >
        {editExtraTarget ? (
          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{editExtraTarget.extraType}</p>
              <p className="text-xs text-text-secondary">
                {editExtraTarget.side === "client" ? "Client charge or discount" : "Partner payout or discount"}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount (£)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={editExtraAmount}
                onChange={(e) => setEditExtraAmount(e.target.value)}
                className="h-9 text-sm"
                autoFocus
              />
              {isJobExtraDiscountExtraType(editExtraTarget.extraType) ? (
                <p className="text-[10px] text-text-tertiary mt-1">Stored as a discount — enter the positive amount to reduce the bill.</p>
              ) : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason</label>
              <textarea
                value={editExtraReason}
                onChange={(e) => setEditExtraReason(e.target.value)}
                rows={3}
                className={cn(JOB_DETAIL_MULTILINE_FIELD_CLASS, "min-h-[80px]")}
              />
            </div>
            {editExtraTarget.side === "client" && !isJobExtraDiscountExtraType(editExtraTarget.extraType) ? (
              <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={editExtraClientConfirmed}
                  onChange={(e) => setEditExtraClientConfirmed(e.target.checked)}
                />
                Client confirmed this extra
              </label>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={savingExtraEdit}
                onClick={() => setEditExtraTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={savingExtraEdit}
                onClick={() => {
                  handleDeleteExtraEntry(editExtraTarget);
                  setEditExtraTarget(null);
                }}
              >
                Remove
              </Button>
              <Button size="sm" loading={savingExtraEdit} onClick={() => void confirmEditExtraEntry()}>
                Save changes
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!deleteExtraTarget}
        onClose={() => {
          if (confirmingDeleteExtra) return;
          setDeleteExtraTarget(null);
          setDeleteLinkedPartnerAlso(false);
        }}
        title="Remove extra entry"
      >
        <div className="p-4 space-y-3">
          {deleteExtraTarget ? (
            <>
              <p className="text-sm text-text-secondary">
                Remove this extra entry from the job?
              </p>
              <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {deleteExtraTarget.extraType}
                </p>
                {deleteExtraTarget.reason ? (
                  <p className="text-xs text-text-secondary">{deleteExtraTarget.reason}</p>
                ) : null}
                <p className="text-sm font-semibold tabular-nums text-text-primary mt-1">
                  +{formatCurrency(deleteExtraTarget.amount)}
                </p>
              </div>
              {deleteExtraTarget.side === "client" &&
              deleteExtraTarget.linkedGroupId &&
              extraHistory.some(
                (row) =>
                  row.side === "partner" &&
                  row.linkedGroupId &&
                  row.linkedGroupId === deleteExtraTarget.linkedGroupId &&
                  !isFallbackExtraEntry(row),
              ) ? (
                <label className="inline-flex items-start gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={deleteLinkedPartnerAlso}
                    onChange={(e) => setDeleteLinkedPartnerAlso(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Also remove linked partner extra from the same action.</span>
                </label>
              ) : null}
            </>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={confirmingDeleteExtra}
              onClick={() => {
                setDeleteExtraTarget(null);
                setDeleteLinkedPartnerAlso(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={confirmingDeleteExtra}
              onClick={() => void confirmDeleteExtraEntry()}
            >
              Remove extra
            </Button>
          </div>
        </div>
      </Modal>

      {/* DELETE PAYMENT CONFIRMATION MODAL */}
      <Modal
        open={!!deletePaymentTarget}
        onClose={() => setDeletePaymentTarget(null)}
        title="Remove payment"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to remove this payment record?
          </p>
          {deletePaymentTarget && (
            <div className="rounded-xl border border-border-light bg-surface-hover/40 px-4 py-3 space-y-1">
              <p className="text-xs text-text-tertiary capitalize">
                {deletePaymentTarget.type === "customer_deposit" ? "Deposit" : deletePaymentTarget.type === "customer_final" ? "Final balance" : "Partner payment"}
              </p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{formatCurrency(deletePaymentTarget.amount)}</p>
            </div>
          )}
          <p className="text-xs text-text-tertiary">This will update the Amount due immediately.</p>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => setDeletePaymentTarget(null)}>Cancel</Button>
            <Button variant="danger" size="sm" loading={deletingPayment} onClick={() => void confirmDeletePayment()}>
              Remove payment
            </Button>
          </div>
        </div>
      </Modal>

      <JobMoneyDrawer
        open={moneyDrawerOpen}
        flow={moneyDrawerFlow}
        onClose={() => {
          setMoneyDrawerOpen(false);
          setMoneyDrawerFlow(null);
          setMoneyDrawerInitialExtraType(undefined);
        }}
        onSubmit={handleMoneyDrawerSubmit}
        submitting={moneySubmitting}
        stripeInvoices={jobInvoices}
        clientCashContext={jobMoneyClientCashContext}
        initialExtraType={moneyDrawerInitialExtraType}
        catalogAddonOptions={moneyDrawerCatalogAddonOptions}
      />

      <Modal
        open={partnerModalOpen}
        onClose={() => {
          setPartnerModalOpen(false);
          setPartnerPickerOpen(false);
          setPartnerPickerSearch("");
        }}
        title={job.partner_id ? "Change partner" : "Assign partner"}
        scrollBody
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-text-tertiary">
            Select the partner responsible for this job. You need a property address, scope of work, and a scheduled date (and times) on this job before assigning.
          </p>
          <div ref={partnerPickerRef} className="relative">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner</label>
            <button
              type="button"
              disabled={loadingPartners}
              onClick={() => setPartnerPickerOpen((o) => !o)}
              className={`w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-surface-hover/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/35 ${partnerPickerOpen ? "ring-2 ring-primary/15 border-primary/30" : ""}`}
            >
              {selectedPartnerId ? (
                <>
                  <Avatar
                    name={partners.find((p) => p.id === selectedPartnerId)?.company_name?.trim() || partners.find((p) => p.id === selectedPartnerId)?.contact_name || "Partner"}
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="flex-1 text-text-primary font-medium truncate">
                    {partners.find((p) => p.id === selectedPartnerId)?.company_name?.trim() || partners.find((p) => p.id === selectedPartnerId)?.contact_name || "Partner"}
                  </span>
                </>
              ) : (
                <>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-hover">
                    <UserX className="h-4 w-4 text-text-tertiary" aria-hidden />
                  </div>
                  <span className="flex-1 text-text-tertiary">Unassigned</span>
                </>
              )}
              <ChevronDown className={`h-4 w-4 text-text-tertiary transition-transform shrink-0 ${partnerPickerOpen ? "rotate-180" : ""}`} />
            </button>
            {partnerPickerOpen && (
              <div
                className="mt-1.5 w-full max-h-[min(50vh,360px)] min-h-0 flex flex-col rounded-xl border border-border bg-card shadow-lg ring-1 ring-black/5 dark:ring-white/10 overflow-hidden"
                role="listbox"
                aria-label="Partners"
              >
                <div className="shrink-0 p-2 border-b border-border-light bg-surface-hover/40">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" aria-hidden />
                    <input
                      ref={partnerPickerSearchInputRef}
                      type="search"
                      value={partnerPickerSearch}
                      onChange={(e) => setPartnerPickerSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="Search name, trade, location…"
                      className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-card text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15"
                      autoComplete="off"
                      aria-label="Filter partners"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 [-webkit-overflow-scrolling:touch]">
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover ${!selectedPartnerId ? "bg-primary/8" : ""}`}
                    onClick={() => {
                      setSelectedPartnerId("");
                      setPartnerPickerOpen(false);
                      queueMicrotask(() => partnerCostSectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                    }}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-hover">
                      <UserX className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
                    </div>
                    <span className="flex-1 font-medium text-text-secondary">Unassigned</span>
                    {!selectedPartnerId && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                  <div className="mx-2 h-px bg-border-light" />
                  {partnersFilteredForPicker.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-text-tertiary">
                      {partnerPickerSearch.trim() ? "No partners match your search." : "No partners loaded."}
                    </p>
                  ) : (
                    partnersFilteredForPicker.map(({ partner: p, matched }) => {
                      const name = p.company_name?.trim() || p.contact_name || "Partner";
                      const isSel = selectedPartnerId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover ${isSel ? "bg-primary/8" : ""}`}
                          onClick={() => {
                            setSelectedPartnerId(p.id);
                            setPartnerPickerOpen(false);
                            queueMicrotask(() => partnerCostSectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                          }}
                        >
                          <Avatar name={name} size="sm" className="shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-text-primary truncate">{name}</p>
                              {matched ? (
                                <span className="shrink-0 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  Matched
                                </span>
                              ) : null}
                            </div>
                            {p.trade ? <p className="text-[11px] text-text-tertiary truncate">{p.trade}</p> : null}
                          </div>
                          {isSel && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <div ref={partnerCostSectionRef} className="space-y-3 border-t border-border-light pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Rate & cost</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPartnerAssignRateType("fixed")}
                className={cn(
                  "inline-flex min-h-9 min-w-0 flex-1 shrink items-center justify-center rounded-full border-[1.5px] px-2 py-2 text-xs font-bold transition-colors",
                  partnerAssignRateType === "fixed"
                    ? "border-[#333] bg-[#f4f2ef] text-[#1a1a1a] dark:border-[#6b7280] dark:bg-[#1f2631] dark:text-[#e5e7eb]"
                    : "border-border-light bg-card text-text-tertiary hover:border-[#333]/60 hover:text-text-primary",
                )}
              >
                Fixed
              </button>
              <button
                type="button"
                onClick={() => setPartnerAssignRateType("hourly")}
                className={cn(
                  "inline-flex min-h-9 min-w-0 flex-1 shrink items-center justify-center rounded-full border-[1.5px] px-2 py-2 text-xs font-bold transition-colors",
                  partnerAssignRateType === "hourly"
                    ? "border-[#7c3aed] bg-[#f5f3ff] text-[#5b21b6] dark:border-[#8b5cf6] dark:bg-[#2a2148] dark:text-[#c4b5fd]"
                    : "border-border-light bg-card text-text-tertiary hover:border-[#7c3aed]/60 hover:text-text-primary",
                )}
              >
                Hourly
              </button>
            </div>
            {partnerAssignRateType === "hourly" ? (
              <div className={cn("space-y-2", loadingJobTypeCatalog && "opacity-70 pointer-events-none")}>
                <label className="block text-xs font-medium text-text-secondary">Service</label>
                <select
                  value={partnerAssignServiceId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPartnerAssignServiceId(id);
                    const service = catalogServicesJobType.find((s) => s.id === id);
                    if (!service) return;
                    setPartnerAssignClientHourlyRate(String(Math.max(0, Number(service.hourly_rate) || 0)));
                    setPartnerAssignPartnerHourlyRate(
                      String(
                        Math.max(
                          0,
                          partnerHourlyRateFromCatalogBundle(service.partner_cost, service.default_hours),
                        ),
                      ),
                    );
                    setPartnerAssignBilledHours(String(Math.max(0.5, Number(service.default_hours) || 1)));
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                >
                  <option value="">Select service...</option>
                  {catalogServicesJobType.map((service) => {
                    const perHour = Math.max(
                      0,
                      partnerHourlyRateFromCatalogBundle(service.partner_cost, service.default_hours),
                    );
                    return (
                      <option key={service.id} value={service.id}>
                        {`${service.name} · ${formatCurrency(perHour)}/h partner rate`}
                      </option>
                    );
                  })}
                </select>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span>Client rate £/h</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={partnerAssignClientHourlyRate}
                      onChange={(e) => setPartnerAssignClientHourlyRate(e.target.value)}
                      className="h-9"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span>Partner rate £/h</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={partnerAssignPartnerHourlyRate}
                      onChange={(e) => setPartnerAssignPartnerHourlyRate(e.target.value)}
                      className="h-9"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span>Min hours</span>
                    <Input
                      type="number"
                      min={0.5}
                      step="0.5"
                      value={partnerAssignBilledHours}
                      onChange={(e) => setPartnerAssignBilledHours(e.target.value)}
                      className="h-9"
                    />
                  </label>
                </div>
                {partnerAssignHourlyPreview ? (
                  <div className="rounded-lg border border-border-light bg-surface-hover/40 px-2.5 py-2 text-[11px] text-text-secondary space-y-1">
                    <p>
                      Client labour:{" "}
                      <span className="font-semibold text-text-primary tabular-nums">
                        {formatCurrency(partnerAssignHourlyPreview.clientTotal)}
                      </span>
                      <span className="text-text-tertiary">
                        {" "}
                        ({partnerAssignHourlyPreview.billedHours}h × {formatCurrency(Math.max(0, Number(partnerAssignClientHourlyRate) || 0))}/h)
                      </span>
                    </p>
                    <p>
                      Partner labour:{" "}
                      <span className="font-semibold text-text-primary tabular-nums">
                        {formatCurrency(partnerAssignHourlyPreview.partnerTotal)}
                      </span>
                      <span className="text-text-tertiary">
                        {" "}
                        ({partnerAssignHourlyPreview.billedHours}h × {formatCurrency(Math.max(0, Number(partnerAssignPartnerHourlyRate) || 0))}/h)
                      </span>
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Partner cost £</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={partnerAssignFixedCost}
                  onChange={(e) => setPartnerAssignFixedCost(e.target.value)}
                  className="h-9"
                />
              </div>
            )}
            <div className="space-y-2.5 rounded-lg border border-border-light bg-surface-hover/30 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: "extra", label: "Labour" },
                  { key: "materials", label: "Materials" },
                ] as const).map((row) => (
                  <label key={row.key} className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span>{row.label}</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={partnerAssignExtraInputs[row.key]}
                      onChange={(e) =>
                        setPartnerAssignExtraInputs((prev) => ({
                          ...prev,
                          [row.key]: e.target.value,
                        }))
                      }
                      className="h-8 text-xs"
                      placeholder="0.00"
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-border-light pt-2.5">
                {([
                  { key: "ccz", label: "CCZ", fee: accessFees.cczFeeGbp },
                  { key: "parking", label: "Parking", fee: accessFees.parkingFeeGbp },
                ] as const).map((row) => {
                  const active = Number(partnerAssignExtraInputs[row.key]) > 0;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() =>
                        setPartnerAssignExtraInputs((prev) => ({
                          ...prev,
                          [row.key]: active ? "" : String(row.fee),
                        }))
                      }
                      aria-pressed={active}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "border-[#1DB87A] bg-[#ecfff6] text-[#157a55] dark:border-emerald-500/50 dark:bg-emerald-950/30 dark:text-emerald-200"
                          : "border-border-light bg-card text-text-secondary hover:border-primary/30",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="font-medium leading-tight">{row.label}</p>
                        <p className="text-[10px] leading-tight opacity-80 tabular-nums">
                          {active ? `+${formatCurrency(row.fee)}` : `${formatCurrency(row.fee)} fee`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "flex-shrink-0 h-5 w-9 rounded-full border p-0.5 transition-colors",
                          active ? "border-[#1DB87A] bg-[#1DB87A]" : "border-border bg-border-light",
                        )}
                      >
                        <span
                          className={cn(
                            "block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                            active && "translate-x-3.5",
                          )}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-right text-sm font-semibold text-text-primary">Partner total: {formatCurrency(partnerAssignTotal)}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPartnerModalOpen(false); setPartnerPickerOpen(false); }}
              disabled={savingPartner}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={savingPartner || loadingPartners}
              disabled={!partnerAssignCanConfirm}
              className="w-full rounded-lg py-2.5 font-semibold disabled:opacity-50"
              onClick={async () => {
                const selected = partners.find((p) => p.id === selectedPartnerId);
                setSavingPartner(true);
                try {
                  const extrasCombined = partnerAssignExtrasTotal;
                  const materialsExtra = partnerAssignMaterialsTotal;
                  const partnerPatch: Partial<Job> = {
                    partner_id: selectedPartnerId || null,
                    partner_name: selectedPartnerId
                      ? (selected?.company_name?.trim() || selected?.contact_name || null)
                      : null,
                    partner_ids: selectedPartnerId ? [selectedPartnerId] : [],
                  };
                  if (selectedPartnerId) {
                    if (partnerAssignRateType === "hourly" && partnerAssignService) {
                      const billedHours = Math.max(0.5, Number(partnerAssignBilledHours) || 0);
                      const clientRate = Math.max(0, Number(partnerAssignClientHourlyRate) || 0);
                      const partnerRate = Math.max(0, Number(partnerAssignPartnerHourlyRate) || 0);
                      const hourlyTotals = partnerAssignHourlyPreview;
                      const titleOut =
                        normalizeTypeOfWork(partnerAssignService.name) || partnerAssignService.name;
                      partnerPatch.job_type = "hourly";
                      partnerPatch.catalog_service_id = partnerAssignService.id;
                      partnerPatch.title = titleOut;
                      partnerPatch.hourly_client_rate = clientRate;
                      partnerPatch.hourly_partner_rate = partnerRate;
                      partnerPatch.billed_hours = billedHours;
                      if (hourlyTotals) {
                        partnerPatch.client_price = hourlyTotals.clientTotal;
                        partnerPatch.partner_cost = hourlyTotals.partnerTotal;
                      }
                      const deposit = Math.max(0, Number(job.customer_deposit) || 0);
                      const extrasAmount = Math.max(0, Number(job.extras_amount) || 0);
                      partnerPatch.customer_final_payment = Math.round(
                        Math.max(0, (hourlyTotals?.clientTotal ?? 0) + extrasAmount - deposit) * 100,
                      ) / 100;
                    } else {
                      partnerPatch.job_type = "fixed";
                      partnerPatch.partner_cost = partnerAssignBaseCost;
                    }
                    partnerPatch.partner_cost = Math.round((Number(partnerPatch.partner_cost ?? 0) + extrasCombined) * 100) / 100;
                    partnerPatch.partner_extras_amount = extrasCombined;
                    partnerPatch.materials_cost = materialsExtra;
                    partnerPatch.partner_agreed_value = Math.round((Number(partnerPatch.partner_cost ?? 0) + materialsExtra) * 100) / 100;
                  }
                  if (selectedPartnerId && (job.status === "unassigned" || job.status === "auto_assigning")) {
                    partnerPatch.status = "scheduled";
                  }
                  if (
                    !selectedPartnerId &&
                    JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED.includes(job.status)
                  ) {
                    partnerPatch.status = "unassigned";
                  }
                  const prevPartnerId = job.partner_id ?? null;
                  await handleJobUpdate(job.id, partnerPatch);
                  if (selectedPartnerId) {
                    setPartnerExtrasUiValue(extrasCombined);
                    setPartnerExtraBreakdownUi({
                      extra: partnerAssignExtraBreakdown.extra,
                      ccz: partnerAssignExtraBreakdown.ccz,
                      parking: partnerAssignExtraBreakdown.parking,
                    });
                    toast.success(`${selected?.company_name?.trim() || selected?.contact_name || "Partner"} assigned · ${formatCurrency(partnerAssignTotal)} partner cost`);
                    // Fire Zendesk notify only when handleJobUpdate didn't
                    // already fire it. handleJobUpdate fires kind="assigned"
                    // on a FRESH partner change; on same-partner re-confirm
                    // it stays silent, so we fire here to honour the operator's
                    // explicit "Assign & confirm" intent (re-deliver the
                    // Job booked side conv).
                    // Without this guard the partner gets the "Job booked"
                    // email twice on every partner change.
                    if (selectedPartnerId === prevPartnerId) {
                      void notifyPartnerJobChange({
                        jobId: job.id,
                        jobReference: job.reference,
                        kind: "assigned",
                        skipPush: true,
                        silent: true,
                      });
                    }
                  }
                  setPartnerModalOpen(false);
                } finally {
                  setSavingPartner(false);
                }
              }}
            >
              Assign & Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={quickRescheduleOpen}
        onClose={() => {
          if (!quickRescheduleSaving) setQuickRescheduleOpen(false);
        }}
        title="Reschedule"
        subtitle={job.reference}
        size="md"
      >
        <div className="space-y-4 p-4">
          <p className="text-xs text-text-tertiary leading-snug">
            Confirm the visit date, assigned partner, service (type of work), and labour amounts. Saving updates the job, linked invoices, and self-bill where applicable; the partner is notified on the usual rules (assignment vs reschedule).
          </p>
          {job.job_type === "hourly" ? (
            <p className="rounded-md border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-[11px] text-amber-900 dark:text-amber-200">
              Hourly job: client and partner totals below should match your billed labour; adjust in Finance after if timers override these.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={cn(isOneOffScheduleUi && "sm:col-span-2")}>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Arrival Date *</label>
              <Input
                type="date"
                className="h-10"
                value={qrDate}
                disabled={quickRescheduleSaving}
                onChange={(e) => {
                  const v = e.target.value;
                  setQrDate(v);
                  if (isRecurringSeriesJob && qrExpectedFinish.trim() && v && qrExpectedFinish < v) {
                    setQrExpectedFinish(v);
                  }
                }}
              />
            </div>
            {isOneOffScheduleUi ? (
              <div
                className={cn(
                  "sm:col-span-2",
                  quickRescheduleSaving && "pointer-events-none opacity-60",
                )}
              >
                <ArrivalSlotPicker
                  arrivalFrom={qrTime}
                  arrivalWindowMins={qrWindowMins}
                  onPick={(from, mins) => {
                    setQrTime(from);
                    setQrWindowMins(mins);
                  }}
                />
                {(() => {
                  const preview = jobModalClientArrivalPreview(qrDate, qrTime, qrWindowMins, {
                    useArrivalSlots: isOneOffScheduleUi,
                  });
                  return preview ? (
                    <p className="mt-2 text-[11px] font-medium text-text-secondary">{preview}</p>
                  ) : null;
                })()}
              </div>
            ) : (
              <>
                <div>
                  <TimeSelect
                    label="Arrival Time"
                    value={qrTime}
                    disabled={quickRescheduleSaving}
                    onChange={(v) => setQrTime(v)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Window</label>
                  <Select
                    className="h-10"
                    value={qrWindowMins}
                    disabled={quickRescheduleSaving}
                    onChange={(e) => setQrWindowMins(e.target.value)}
                    options={[...ARRIVAL_WINDOW_OPTIONS]}
                  />
                </div>
              </>
            )}
            {!isOneOffScheduleUi ? (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  Expected Finish Date{qrDate.trim() ? <span className="text-red-600"> *</span> : null}
                </label>
                <Input
                  type="date"
                  className="h-10"
                  value={qrExpectedFinish}
                  min={isRecurringSeriesJob && qrDate.trim() ? qrDate.trim() : undefined}
                  disabled={quickRescheduleSaving || (isRecurringSeriesJob && !qrDate.trim())}
                  title={
                    isRecurringSeriesJob && !qrDate.trim()
                      ? "Set the arrival date first"
                      : isRecurringSeriesJob && qrDate.trim()
                        ? `On or after ${qrDate.trim()}`
                        : undefined
                  }
                  onChange={(e) => {
                    const min = isRecurringSeriesJob ? qrDate.trim() : "";
                    const v = e.target.value;
                    if (min && v && v < min) return;
                    setQrExpectedFinish(v);
                  }}
                />
              </div>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Partner</label>
            <select
              className="h-10 w-full rounded-lg border border-border-light bg-surface px-3 text-sm"
              value={qrPartnerId}
              disabled={quickRescheduleSaving || loadingPartners}
              onChange={(e) => setQrPartnerId(e.target.value)}
            >
              <option value="">— No Partner —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.company_name?.trim() || p.contact_name} · {p.trade ?? "—"}
                </option>
              ))}
            </select>
          </div>
          <div className={cn(loadingJobTypeCatalog && "pointer-events-none opacity-60")}>
            <ServiceCatalogSelect
              label="Type Of Work (Services)"
              emptyOptionLabel="Keep current / not linked to catalog"
              catalog={catalogServicesJobType}
              value={qrCatalogServiceId}
              disabled={quickRescheduleSaving}
              compactOptionLabels
              onChange={(id) => setQrCatalogServiceId(id)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Client Price (£)</label>
              <Input
                type="number"
                step="0.01"
                min={0}
                className="h-10"
                value={qrClientPrice}
                disabled={quickRescheduleSaving}
                onChange={(e) => setQrClientPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Partner Cost (£)</label>
              <Input
                type="number"
                step="0.01"
                min={0}
                className="h-10"
                value={qrPartnerCost}
                disabled={quickRescheduleSaving}
                onChange={(e) => setQrPartnerCost(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border-light pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={quickRescheduleSaving}
              onClick={() => setQuickRescheduleOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              loading={quickRescheduleSaving}
              onClick={() => void confirmQuickReschedule()}
            >
              Confirm &amp; Update
            </Button>
          </div>
        </div>
      </Modal>

      {/* mig 158: scope picker for recurring-job edits. */}
      <RecurringEditScopeDialog
        open={!!recurringScopePending}
        onClose={() => setRecurringScopePending(null)}
        actionLabel={recurringScopePending?.actionLabel ?? "change"}
        sequenceIndex={recurringScopePending?.sequenceIndex ?? null}
        onConfirm={async (scope: RecurrenceEditScope) => {
          if (!recurringScopePending) return;
          try {
            const { updated, detached } = await applyEditScope(
              recurringScopePending.jobId,
              recurringScopePending.patch,
              scope,
            );
            const note = scope === "this_only"
              ? "Visit detached and updated"
              : scope === "this_and_following"
                ? `Updated ${updated} visits (this + following)`
                : `Updated ${updated} visits across the series`;
            toast.success(detached ? `${note} (detached)` : note);
            setRecurringScopePending(null);
            // Refresh from the canonical handler so derived state stays in sync.
            await handleJobUpdate(recurringScopePending.jobId, {}, { silent: true });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to apply change");
          }
        }}
      />
    </PageTransition>
  );
}
