"use client";

import type { JobDetailBundle } from "@/services/jobs";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatDistanceStrict } from "date-fns/formatDistanceStrict";
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
import { parseISO } from "date-fns/parseISO";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { TimeSelect } from "@/components/ui/time-select";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
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
} from "lucide-react";
import { cn, formatCurrency, formatCurrencyPrecise, formatDate, getErrorMessage } from "@/lib/utils";
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
import { logAudit, logFieldChanges } from "@/services/audit";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Avatar } from "@/components/ui/avatar";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import type { CatalogService, Invoice, Job, JobPayment, JobPaymentMethod, Partner, QuoteLineItem, SelfBill } from "@/types/database";
import { listInvoicesLinkedToJob, updateInvoice } from "@/services/invoices";
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
import {
  ACCESS_CCZ_FEE_GBP,
  ACCESS_PARKING_FEE_GBP,
  effectiveInCczForAddress,
  isLikelyCczAddress,
} from "@/lib/ccz";
import { patchJobFinancialsForAccessTransition } from "@/lib/job-access-fee-financials";
import { jobPaymentNoteWithoutLedgerPrefix, parseJobPaymentLedgerLabel } from "@/lib/job-payment-history-label";
import { isLegacyMisclassifiedPartnerPayment, sumPartnerRecordedPayoutsForCap } from "@/lib/job-payment-ledger";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { notifyAssignedPartnerAboutJob, shouldNotifyPartnerForJobPatch } from "@/lib/notify-partner-job-push";
import {
  effectiveJobStatusForDisplay,
  getPartnerAssignmentBlockReason,
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
import { ARRIVAL_WINDOW_OPTIONS, scheduledEndFromWindow, snapArrivalWindowMinutes } from "@/lib/job-arrival-window";
import { normalizeTypeOfWork, withTypeOfWorkFallback } from "@/lib/type-of-work";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { isJobForcePaid, markJobAsForcePaidNote } from "@/lib/job-force-paid";
import {
  OFFICE_JOB_CANCELLATION_REASONS,
  buildOfficeCancellationReasonText,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";
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
import { reverseCustomerExtraPatch, reversePartnerExtraPatch } from "@/lib/job-extra-charges";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";
import {
  buildSchedulePatchForResume,
  localHmFromIsoTimestamp,
  onHoldSnapshotArrivalYmd,
  validateResumeArrivalDate,
} from "@/lib/job-on-hold";

const statusConfig: Record<string, { label: string; variant: BadgeVariant; dot?: boolean }> = {
  unassigned: { label: "Unassigned", variant: JOB_STATUS_BADGE_VARIANT.unassigned, dot: true },
  auto_assigning: { label: "Assigning", variant: JOB_STATUS_BADGE_VARIANT.auto_assigning, dot: true },
  scheduled: { label: "Scheduled", variant: JOB_STATUS_BADGE_VARIANT.scheduled, dot: true },
  late: { label: "Late", variant: JOB_STATUS_BADGE_VARIANT.late, dot: true },
  in_progress_phase1: { label: "In Progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase1, dot: true },
  in_progress_phase2: { label: "In Progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase2, dot: true },
  in_progress_phase3: { label: "In Progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase3, dot: true },
  on_hold: { label: "On Hold", variant: JOB_STATUS_BADGE_VARIANT.on_hold, dot: true },
  final_check: { label: "Final Check", variant: JOB_STATUS_BADGE_VARIANT.final_check, dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: JOB_STATUS_BADGE_VARIANT.awaiting_payment, dot: true },
  need_attention: { label: "Final Check", variant: JOB_STATUS_BADGE_VARIANT.need_attention, dot: true },
  completed: { label: "Completed", variant: JOB_STATUS_BADGE_VARIANT.completed, dot: true },
  cancelled: { label: "Cancelled", variant: JOB_STATUS_BADGE_VARIANT.cancelled, dot: true },
};

const PUT_ON_HOLD_PRESET_REASONS = [
  "Waiting for materials",
  "Client rescheduled",
  "Access issue",
  "Partner unavailable",
  "Awaiting confirmation",
  "Other",
] as const;

const PUT_ON_HOLD_REASON_OPTIONS = [
  { value: "", label: "Select a reason..." },
  ...PUT_ON_HOLD_PRESET_REASONS.map((r) => ({ value: r, label: r })),
];

/** Neutral fields + brand focus ring (replaces one-off beige / mint hex pairs). */
const JOB_DETAIL_MULTILINE_FIELD_CLASS =
  "w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm leading-tight text-text-primary placeholder:text-text-tertiary shadow-sm transition-colors focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-surface-secondary dark:focus:bg-surface dark:focus:ring-primary/35";

const JOB_DETAIL_INLINE_INPUT_FIELD_CLASS =
  "rounded-lg border border-border bg-card py-2 text-sm text-text-primary placeholder:text-text-tertiary shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-surface-secondary dark:focus:ring-primary/35";

function jobDetailMarginAppearance(marginPct: number): { pctClass: string; barClass: string } {
  if (marginPct < 0) {
    return { pctClass: "text-red-600 dark:text-red-400", barClass: "bg-red-500" };
  }
  if (marginPct < 15) {
    return { pctClass: "text-amber-600 dark:text-amber-400", barClass: "bg-amber-500" };
  }
  return { pctClass: "text-emerald-600 dark:text-emerald-400", barClass: "bg-primary" };
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
  accumulating: { label: "Open week", variant: "default" },
  pending_review: { label: "Review & approve", variant: "primary" },
  needs_attention: { label: "Needs attention", variant: "danger" },
  awaiting_payment: { label: "Awaiting payment", variant: "warning" },
  ready_to_pay: { label: "Ready to pay", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  audit_required: { label: "Audit required", variant: "danger" },
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
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
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
  { label: "On site", statuses: ["in_progress_phase1", "in_progress_phase2", "in_progress_phase3"], icon: HardHat },
  { label: "On hold", statuses: ["on_hold"], icon: PauseCircle },
  { label: "Final checks", statuses: ["final_check", "need_attention"], icon: ClipboardCheck },
  { label: "Awaiting payment", statuses: ["awaiting_payment"], icon: CreditCard },
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

export function JobDetailClient({ initialBundle }: JobDetailClientProps = {}) {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const { profile } = useProfile();

  // Hydrate from server bundle when present so the page is interactive on
  // first paint instead of after a useEffect waterfall.
  const initialPayments = (initialBundle?.payments ?? []) as Array<{ type?: string }>;
  const [job, setJob] = useState<Job | null>((initialBundle?.job as Job | undefined) ?? null);
  const [loading, setLoading] = useState(initialBundle?.job ? false : true);
  const skipFirstFetchRef = useRef(initialBundle?.job != null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
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
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [moneyDrawerOpen, setMoneyDrawerOpen] = useState(false);
  const [moneyDrawerFlow, setMoneyDrawerFlow] = useState<JobMoneyDrawerFlow | null>(null);
  const [moneySubmitting, setMoneySubmitting] = useState(false);
  /** Layout-only: job detail tabs and accordions (money actions use drawer modal). */
  const [detailTab, setDetailTab] = useState<0 | 1 | 2 | 3 | 4>(0);
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
  const [resumeArrivalDate, setResumeArrivalDate] = useState("");
  const [resumeArrivalTime, setResumeArrivalTime] = useState("");
  const [resumeSaving, setResumeSaving] = useState(false);
  const [validateCompleteOpen, setValidateCompleteOpen] = useState(false);
  const [validatingComplete, setValidatingComplete] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"review_approve" | "validate_complete">("validate_complete");
  const [ownerApprovalChecked, setOwnerApprovalChecked] = useState(false);
  const [forceApprovalChecked, setForceApprovalChecked] = useState(false);
  const [forceApprovalReason, setForceApprovalReason] = useState("");
  const [approvalBilledHoursInput, setApprovalBilledHoursInput] = useState("");
  const [cancelPresetId, setCancelPresetId] = useState<string>(OFFICE_JOB_CANCELLATION_REASONS[0].id);
  const [cancelDetail, setCancelDetail] = useState("");
  const [cancellingJob, setCancellingJob] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [savingPartner, setSavingPartner] = useState(false);
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [partnerPickerSearch, setPartnerPickerSearch] = useState("");
  const partnerPickerRef = useRef<HTMLDivElement>(null);
  const partnerPickerSearchInputRef = useRef<HTMLInputElement>(null);
  const partnerCostSectionRef = useRef<HTMLDivElement>(null);
  const [partnerAssignRateType, setPartnerAssignRateType] = useState<"fixed" | "hourly">("fixed");
  const [partnerAssignServiceId, setPartnerAssignServiceId] = useState("");
  const [partnerAssignFixedCost, setPartnerAssignFixedCost] = useState("");
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
  const [savingFin, setSavingFin] = useState(false);
  const [jobTypeEditOpen, setJobTypeEditOpen] = useState(false);
  const [jobTypeEditTarget, setJobTypeEditTarget] = useState<"fixed" | "hourly">("fixed");
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
  const [savingScope, setSavingScope] = useState(false);
  const [additionalNotesDraft, setAdditionalNotesDraft] = useState("");
  const [savingAdditionalNotes, setSavingAdditionalNotes] = useState(false);
  const [reportLinkDraft, setReportLinkDraft] = useState("");
  const [savingReportLink, setSavingReportLink] = useState(false);
  const [internalNoteDraft, setInternalNoteDraft] = useState("");
  const [savingInternalNote, setSavingInternalNote] = useState(false);
  const [sitePhotoUploading, setSitePhotoUploading] = useState(false);
  const [clientExtrasUiValue, setClientExtrasUiValue] = useState(0);
  const [partnerExtrasUiValue, setPartnerExtrasUiValue] = useState(0);
  const [cashOutExtraExpanded, setCashOutExtraExpanded] = useState<string | null>(null);
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
  const autoInvoiceEnsureRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    jobRef.current = job;
  }, [job]);
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
    const preview = computeHourlyTotals({
      elapsedSeconds: computeOfficeTimerElapsedSeconds(job),
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
    setApprovalBilledHoursInput(String(preview.billedHours));
  }, [validateCompleteOpen, job?.id, job?.job_type]);

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
    const secs = officeTimerDisplaySeconds ?? (Number(job.timer_elapsed_seconds ?? 0) || 0);
    const totalMins = Math.floor(Math.max(0, secs) / 60);
    setHourlyEditHours(String(Math.floor(totalMins / 60)));
    setHourlyEditMinutes(String(totalMins % 60));
  }, [job?.id, job?.job_type, job?.timer_elapsed_seconds, officeTimerDisplaySeconds]);

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
      if (amount <= 0.01) return null;
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
        await Promise.all([loadPayments(j.id), loadJobInvoices(j), loadQuoteLineItems(j), loadJobSelfBill(j)]);
      }
    } catch {
      toast.error("Failed to refresh");
    } finally {
      setRefreshingJob(false);
    }
  }, [id, loadPayments, loadJobInvoices, loadQuoteLineItems, loadJobSelfBill]);

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
          const [j, all] = await Promise.all([
            getJob(id),
            listJobPayments(id),
          ]);
          if (cancelled) return;
          setJob(j ?? null);
          setPartnerPayments(all.filter((p) => p.type === "partner"));
          setCustomerPayments(
            all.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"),
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
      const d = new Date(job.scheduled_start_at);
      setScheduleDate(d.toISOString().slice(0, 10));
      setScheduleTime(d.toTimeString().slice(0, 5));
      if (job.scheduled_end_at) {
        const startMs = new Date(job.scheduled_start_at).getTime();
        const endMs = new Date(job.scheduled_end_at).getTime();
        setScheduleWindowMins(snapArrivalWindowMinutes(startMs, endMs));
      } else {
        setScheduleWindowMins("");
      }
    } else if (job?.scheduled_date) {
      setScheduleDate(job.scheduled_date);
      setScheduleTime("");
      setScheduleWindowMins("");
    } else {
      setScheduleDate("");
      setScheduleTime("");
      setScheduleWindowMins("");
    }
    setScheduleExpectedFinishDate(
      job?.scheduled_finish_date?.slice(0, 10) ?? job?.scheduled_date?.slice(0, 10) ?? "",
    );
  }, [job?.id, job?.scheduled_start_at, job?.scheduled_end_at, job?.scheduled_date, job?.scheduled_finish_date]);

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
    setPartnerAssignExtraInputs({
      extra: existingPartnerExtras > 0 ? String(existingPartnerExtras) : "",
      ccz: "",
      parking: "",
      materials: existingMaterials > 0 ? String(existingMaterials) : "",
    });
  }, [partnerModalOpen, job?.id, job?.job_type, job?.catalog_service_id, job?.partner_cost, job?.partner_extras_amount, job?.materials_cost]);

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
    if (!job || !partnerAssignService) return null;
    const elapsedSeconds = computeOfficeTimerElapsedSeconds(job);
    const effectiveSeconds = elapsedSeconds > 0 ? elapsedSeconds : 3600;
    const clientRate = Math.max(0, Number(partnerAssignService.hourly_rate) || 0);
    const partnerRate = Math.max(
      0,
      partnerHourlyRateFromCatalogBundle(partnerAssignService.partner_cost, partnerAssignService.default_hours),
    );
    return computeHourlyTotals({
      elapsedSeconds: effectiveSeconds,
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
  }, [job, partnerAssignService]);
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
    (partnerAssignRateType === "hourly" ? !!partnerAssignServiceId && partnerAssignBaseCost > 0 : partnerAssignBaseCost > 0);

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
  }, [job?.id, job?.scope]);

  useEffect(() => {
    if (!job) return;
    setAdditionalNotesDraft(job.additional_notes ?? "");
  }, [job?.id, job?.additional_notes]);

  useEffect(() => {
    if (!isAdmin && detailTab === 4) {
      setDetailTab(0);
    }
  }, [isAdmin, detailTab]);

  useEffect(() => {
    if (!job) return;
    setReportLinkDraft(job.report_link ?? "");
  }, [job?.id, job?.report_link]);

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
          notifyAssignedPartnerAboutJob({
            partnerId: updated.partner_id,
            job: updated,
            kind: "job_status_changed",
            statusLabel: statusConfig.final_check?.label ?? "Final check",
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
        }
      }
      return updated;
    } catch {
      toast.error("Failed to update");
      return undefined;
    }
  }, [profile?.id, profile?.full_name]);

  const handleSaveJobTypeEdit = useCallback(async () => {
    if (!job) return;
    const extras = Number(job.extras_amount ?? 0);
    const deposit = Number(job.customer_deposit ?? 0);
    const prev = job;

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
    handleJobUpdate,
    profile?.id,
    profile?.full_name,
    refreshJobFinance,
  ]);

  const handleSaveHourlyTimeEdit = useCallback(async () => {
    if (!job || job.job_type !== "hourly") return;
    const hours = Math.max(0, Math.floor(Number(hourlyEditHours) || 0));
    const minsRaw = Math.max(0, Math.floor(Number(hourlyEditMinutes) || 0));
    const mins = Math.min(59, minsRaw);
    const elapsedSeconds = Math.max(0, hours * 3600 + mins * 60);
    const { clientRate, partnerRate } = resolveJobHourlyRates(job);
    const totals = computeHourlyTotals({
      elapsedSeconds,
      clientHourlyRate: clientRate,
      partnerHourlyRate: partnerRate,
    });
    const patch: Partial<Job> = {
      timer_elapsed_seconds: elapsedSeconds,
      timer_last_started_at: job.timer_is_running ? new Date().toISOString() : job.timer_last_started_at,
      billed_hours: totals.billedHours,
      client_price: totals.clientTotal,
      partner_cost: totals.partnerTotal,
      customer_final_payment: Math.round(
        Math.max(0, totals.clientTotal + Number(job.extras_amount ?? 0) - Number(job.customer_deposit ?? 0)) * 100,
      ) / 100,
    };
    setSavingHourlyTimeEdit(true);
    try {
      const updated = await handleJobUpdate(job.id, patch, { silent: true });
      if (updated) {
        await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        await syncSelfBillAfterJobChange(updated);
        await refreshJobFinance();
        setHourlyTimeEditOpen(false);
        toast.success("Work time updated");
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
        const accessFin = patchJobFinancialsForAccessTransition(job, {
          in_ccz: nextInCcz,
          has_free_parking: nextHasFreeParking,
        });
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
    [job, handleJobUpdate, refreshJobFinance],
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
    const accessFin = patchJobFinancialsForAccessTransition(job, {
      property_address: trimmed,
      in_ccz: mergedInCcz,
    });
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
  }, [job, propertyEdit, handleJobUpdate, refreshJobFinance]);

  const handleSaveUnlinkedProperty = useCallback(async () => {
    if (!job || !unlinkedAddressDraft.trim()) {
      toast.error("Property address is required");
      return;
    }
    const trimmed = unlinkedAddressDraft.trim();
    const mergedInCcz = effectiveInCczForAddress(job.in_ccz, trimmed);
    const accessFin = patchJobFinancialsForAccessTransition(job, {
      property_address: trimmed,
      in_ccz: mergedInCcz,
    });
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
  }, [job, unlinkedAddressDraft, handleJobUpdate, refreshJobFinance]);

  const handleConfirmOfficeCancel = useCallback(async () => {
    if (!job) return;
    if (officeCancellationDetailRequired(cancelPresetId) && !cancelDetail.trim()) {
      toast.error("Add details when the reason is “Other”.");
      return;
    }
    const reasonText = buildOfficeCancellationReasonText(cancelPresetId, cancelDetail);
    setCancellingJob(true);
    try {
      const now = new Date().toISOString();
      const statusPatch: Partial<Job> = {
        status: "cancelled",
        cancellation_reason: reasonText,
        cancelled_at: now,
        cancelled_by: profile?.id ?? null,
        ...statusChangePartnerTimerPatch(job, "cancelled"),
        ...statusChangeOfficeTimerPatch(job, "cancelled"),
      };
      const updated = await updateJob(job.id, statusPatch);
      await logAudit({
        entityType: "job",
        entityId: job.id,
        entityRef: job.reference,
        action: "status_changed",
        fieldName: "status",
        oldValue: job.status,
        newValue: "cancelled",
        userId: profile?.id,
        userName: profile?.full_name,
      });
      await logAudit({
        entityType: "job",
        entityId: job.id,
        entityRef: job.reference,
        action: "updated",
        fieldName: "financial_documents",
        newValue: "Invoice and self-bill cancelled",
        userId: profile?.id,
        userName: profile?.full_name,
      });
      setJob(updated);
      setCancelJobOpen(false);
      setCancelDetail("");
      toast.success("Job cancelled");
      if (updated.partner_id) {
        notifyAssignedPartnerAboutJob({
          partnerId: updated.partner_id,
          job: updated,
          kind: "job_cancelled_by_office",
          cancellationReason: reasonText,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel job");
    } finally {
      setCancellingJob(false);
    }
  }, [job, cancelPresetId, cancelDetail, profile?.id, profile?.full_name]);

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
        notifyAssignedPartnerAboutJob({
          partnerId: updated.partner_id,
          job: updated,
          kind: "job_status_changed",
          statusLabel: statusConfig[newStatus]?.label ?? newStatus,
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
    const ymd = onHoldSnapshotArrivalYmd(job) ?? job.scheduled_date?.trim().slice(0, 10) ?? "";
    setResumeArrivalDate(ymd);
    const hm =
      localHmFromIsoTimestamp(job.on_hold_snapshot_scheduled_start_at ?? job.scheduled_start_at ?? null) ||
      scheduleTime.trim();
    setResumeArrivalTime(hm);
    setResumeJobOpen(true);
  }, [job, scheduleTime]);

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
    const schedule = buildSchedulePatchForResume({
      arrivalDateYmd: resumeArrivalDate,
      arrivalTimeHm: resumeArrivalTime,
      snapshotStartAt: job.on_hold_snapshot_scheduled_start_at,
      snapshotEndAt: job.on_hold_snapshot_scheduled_end_at,
      snapshotFinishDate: job.on_hold_snapshot_scheduled_finish_date,
      fallbackFinishDate: job.scheduled_finish_date,
    });
    const arrY = resumeArrivalDate.trim().slice(0, 10);
    const finishY = (schedule.scheduled_finish_date ?? "").toString().slice(0, 10);
    if (finishY && finishY < arrY) {
      toast.error("Arrival date cannot be after the expected finish date.");
      return;
    }
    const prevRaw = (job.on_hold_previous_status ?? "in_progress_phase1").trim();
    const prev = jobStatusAfterResumeFromOnHold(prevRaw as Job["status"]);
    const timerBasis = { ...job, status: "on_hold" as Job["status"] };
    const patch: Partial<Job> = {
      status: prev,
      ...schedule,
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
    handleJobUpdate,
    profile?.id,
    profile?.full_name,
  ]);

  const handleScheduleChange = useCallback(
    (j: Job, startDate: string, startTime: string, windowMinsStr: string, expectedFinishDate: string) => {
      const d = startDate.trim();
      const tFrom = startTime.trim();
      const expectedTrim = expectedFinishDate.trim();
      const wm = windowMinsStr.trim();
      const windowMins = wm ? Number(wm) : NaN;
      const hasWindow = Number.isFinite(windowMins) && windowMins > 0;
      const arrivalDayForCompare = d || (typeof j.scheduled_date === "string" ? j.scheduled_date.trim().slice(0, 10) : "");

      if (expectedTrim && arrivalDayForCompare && expectedTrim < arrivalDayForCompare) {
        toast.error("Expected finish date must be on or after the arrival date.");
        return;
      }

      if (!d) {
        handleJobUpdate(
          j.id,
          {
            scheduled_date: null,
            scheduled_start_at: null,
            scheduled_end_at: null,
            scheduled_finish_date: null,
          } as unknown as Partial<Job>,
        );
        return;
      }

      if (!expectedTrim) {
        toast.error("Expected finish date is required when a start date is set.");
        return;
      }

      if (!tFrom) {
        handleJobUpdate(
          j.id,
          {
            scheduled_date: d,
            scheduled_start_at: null,
            scheduled_end_at: null,
            scheduled_finish_date: expectedTrim,
          } as unknown as Partial<Job>,
        );
        return;
      }

      if (wm !== "" && !hasWindow) {
        toast.error("Choose a valid arrival window length.");
        return;
      }

      const hasPartner = !!(j.partner_id?.trim());
      if (hasPartner && !hasWindow) {
        toast.error("Choose an arrival window length when a partner is assigned.");
        return;
      }

      const scheduled_start_at = `${d}T${tFrom}:00`;
      let scheduled_end_at: string | null = null;
      if (hasWindow) {
        const endIso = scheduledEndFromWindow(d, tFrom, windowMins);
        const startMs = new Date(scheduled_start_at).getTime();
        const endMs = new Date(endIso).getTime();
        if (!(endMs > startMs)) {
          toast.error("Arrival window must end after the start time.");
          return;
        }
        scheduled_end_at = endIso;
      }

      handleJobUpdate(
        j.id,
        {
          scheduled_date: d,
          scheduled_start_at,
          scheduled_end_at,
          scheduled_finish_date: expectedTrim,
        } as unknown as Partial<Job>,
      );
    },
    [handleJobUpdate],
  );

  const jobMoneyClientCashContext = useMemo((): JobMoneyDrawerClientCashContext | undefined => {
    if (!job) return undefined;
    const sched = Number(job.customer_deposit ?? 0);
    const paid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    return { depositScheduled: sched, depositRemaining: Math.max(0, sched - paid) };
  }, [job, customerPayments]);

  const clientVisibleArrivalPreview = useMemo(() => {
    const d = scheduleDate.trim();
    const t = scheduleTime.trim();
    const wm = scheduleWindowMins.trim();
    if (!d || !t) return null;
    const windowMins = wm ? Number(wm) : NaN;
    const hasWindow = Number.isFinite(windowMins) && windowMins > 0;
    const startIso = `${d}T${t}:00`;
    if (!hasWindow) {
      return `Client & partner will see: Arrival time ${formatHourMinuteAmPm(new Date(startIso))} — add a window length (2–3h typical) for a clear range.`;
    }
    const endIso = scheduledEndFromWindow(d, t, windowMins);
    const range = formatArrivalTimeRange(startIso, endIso);
    return range ? `Client & partner will see: Arrival time (${range})` : null;
  }, [scheduleDate, scheduleTime, scheduleWindowMins]);

  const SCHEDULE_HELP_TOOLTIP =
    "Window end = start time + length (often 2–3 hours). That range is what clients and partners see as arrival time. Expected finish is calendar-only (no time); late is still based on window end.";

  const arrivalFieldTooltipText = useMemo(
    () =>
      [clientVisibleArrivalPreview, SCHEDULE_HELP_TOOLTIP]
        .filter((s): s is string => Boolean(s))
        .join("\n\n"),
    [clientVisibleArrivalPreview],
  );

  const cczParkingFieldTooltipText = useMemo(() => {
    const lines = [
      "CCZ is only available for central London postcodes (TfL Congestion Charge / Zone 1 core: EC1–4, WC1–2, W1, SW1, SE1). Outside that list the control stays off. Inside the list you still choose whether to apply the +£15 fee — it is not turned on automatically.",
    ];
    if (!cczEligibleAddress && job?.in_ccz) {
      lines.push(
        "This job has CCZ enabled in the database, but the current address is outside the central London postcode list — no CCZ surcharge is applied until you save an eligible address and turn CCZ on.",
      );
    }
    return lines.join("\n\n");
  }, [cczEligibleAddress, job?.in_ccz]);

  const handleMoneyDrawerSubmit = useCallback(
    async (payload: JobMoneySubmitPayload) => {
      if (!job) return;
      setMoneySubmitting(true);
      try {
        const updated = await executeJobMoneyAction({
          job,
          mode: payload.flow,
          amount: payload.amount,
          paymentDate: payload.paymentDate,
          method: payload.method,
          note: payload.note,
          customerPayments,
          partnerPayments,
          ...(payload.flow === "client_pay" && payload.clientPayApplyAs
            ? { clientPayApplyAs: payload.clientPayApplyAs }
            : {}),
          ...(payload.paymentLedgerLabel?.trim() ? { paymentLedgerLabel: payload.paymentLedgerLabel.trim() } : {}),
        });
        if (payload.flow === "client_extra") {
          setClientExtrasUiValue((v) => Math.round((v + payload.amount) * 100) / 100);
        } else if (payload.flow === "partner_extra") {
          setPartnerExtrasUiValue((v) => Math.round((v + payload.amount) * 100) / 100);
          const noteUpper = payload.note.trim().toUpperCase();
          /* Materials line reads from job.materials_cost after save — do not fold into extra/ccz/parking breakdown. */
          if (!noteUpper.startsWith("MATERIALS")) {
            const type: "ccz" | "parking" | "extra" =
              noteUpper.startsWith("CCZ")
                ? "ccz"
                : noteUpper.startsWith("PARKING")
                  ? "parking"
                  : "extra";
            setPartnerExtraBreakdownUi((prev) => ({
              ...prev,
              [type]: Math.round(((prev[type] ?? 0) + payload.amount) * 100) / 100,
            }));
          }
        }
        setJob(updated);
        const fieldName =
          payload.flow === "client_pay"
            ? "customer_payment"
            : payload.flow === "client_extra"
              ? "customer_extra_charge"
              : payload.flow === "partner_pay"
                ? "partner_payment"
                : "partner_extra_payout";
        await logAudit({
          entityType: "job",
          entityId: job.id,
          entityRef: job.reference,
          action: payload.flow === "client_pay" || payload.flow === "partner_pay" ? "payment" : "updated",
          fieldName,
          newValue: formatCurrency(payload.amount),
          userId: profile?.id,
          userName: profile?.full_name,
          metadata: {
            mode: payload.flow,
            method: payload.method,
            date: payload.paymentDate,
            ...(payload.note.trim() ? { note: payload.note.trim() } : {}),
            ...(payload.flow === "client_pay" && payload.clientPayApplyAs
              ? { client_pay_apply_as: payload.clientPayApplyAs }
              : {}),
          },
        });
        const toastMsg =
          payload.flow === "client_pay"
            ? "Payment recorded"
            : payload.flow === "client_extra"
              ? "Extra charge added"
              : payload.flow === "partner_pay"
                ? "Payout recorded"
                : "Extra payout added";
        toast.success(toastMsg);
        setMoneyDrawerOpen(false);
        setMoneyDrawerFlow(null);
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

  useEffect(() => {
    if (!job?.id || !profile?.id) return;
    if (job.owner_id) return;
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
      const financeAnchorDate = new Date();
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
      const financeAnchorDate = new Date();
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

      // Keep this action internal only: no external send/notify workflow.
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
      toast.success(approvalToast);
      /** Finance refresh fans out 4 reads; nothing in this handler depends on it — let it run while the modal closes. */
      void refreshJobFinance().catch(() => {});
      setValidateCompleteOpen(false);
      setOwnerApprovalChecked(false);
      setForceApprovalChecked(false);
      setForceApprovalReason("");
      setApprovalBilledHoursInput("");
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
      ...withTypeOfWorkFallback(job?.title).map((name) => ({ value: name, label: name })),
    ],
    [job?.title],
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
  /** Same basis as linked invoice targets and `syncInvoicesFromJobCustomerPayments` (ticket + extras, schedule, hourly). */
  const billableRevenue = jobCustomerBillableRevenueForCollections(job);
  const partnerCap =
    job.job_type === "hourly" && hourlyAutoBilling
      ? Math.max(partnerPaymentCap(job), hourlyAutoBilling.partnerTotal)
      : partnerPaymentCap(job);
  const hourlyPartnerLabourForCashOut =
    job.job_type === "hourly" && hourlyAutoBilling ? hourlyAutoBilling.partnerTotal : null;
  const { base: partnerCashOutBase, extra: partnerCashOutExtra } = partnerCashOutDisplaySplit(
    job,
    partnerCap,
    hourlyPartnerLabourForCashOut,
  );
  const partnerExtraFallback = Math.max(0, Number(job.partner_extras_amount ?? 0));
  const partnerExtraDisplay = Math.max(partnerCashOutExtra, partnerExtraFallback, partnerExtrasUiValue);
  const hasPartnerExtra = partnerExtraDisplay > 0.02;
  const partnerExtraBreakdownTotal =
    Number(partnerExtraBreakdownUi.extra ?? 0) +
    Number(partnerExtraBreakdownUi.ccz ?? 0) +
    Number(partnerExtraBreakdownUi.parking ?? 0);
  const partnerExtraResidual = Math.max(0, Math.round((partnerExtraDisplay - partnerExtraBreakdownTotal) * 100) / 100);
  const partnerExtraLine = Math.round((Number(partnerExtraBreakdownUi.extra ?? 0) + partnerExtraResidual) * 100) / 100;
  const partnerCczLine = Math.max(0, Number(partnerExtraBreakdownUi.ccz ?? 0));
  const partnerParkingLine = Math.max(0, Number(partnerExtraBreakdownUi.parking ?? 0));
  const partnerMaterialsLine = Math.max(0, Number(job.materials_cost ?? 0));
  const cashOutExtraRows = [
    { key: "extra", label: "Extra payout", amount: partnerExtraLine, active: partnerExtraLine > 0.02, allocation: "partner_cost" as const },
    { key: "ccz", label: "CCZ", amount: partnerCczLine, active: partnerCczLine > 0.02, allocation: "partner_cost" as const },
    { key: "parking", label: "Parking", amount: partnerParkingLine, active: partnerParkingLine > 0.02, allocation: "partner_cost" as const },
    { key: "materials", label: "Materials", amount: partnerMaterialsLine, active: partnerMaterialsLine > 0.02, allocation: "materials" as const },
  ] as const;
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
  const cczFeeNominal = effectiveCustomerInCcz ? ACCESS_CCZ_FEE_GBP : 0;
  const parkingFeeNominal = job.has_free_parking === false ? ACCESS_PARKING_FEE_GBP : 0;
  const attributedAccessNominal = cczFeeNominal + parkingFeeNominal;
  const attributedAccessForExtrasLine = Math.min(attributedAccessNominal, effectiveExtrasAmountForDisplay);
  const extrasNetOfAccess = Math.max(0, Math.round((effectiveExtrasAmountForDisplay - attributedAccessForExtrasLine) * 100) / 100);
  const cashInExtraRows = [
    { key: "extra", label: "Extra charges", amount: extrasNetOfAccess, active: extrasNetOfAccess > 0.02 },
    { key: "ccz", label: "CCZ", amount: effectiveCustomerInCcz ? ACCESS_CCZ_FEE_GBP : 0, active: effectiveCustomerInCcz },
    { key: "parking", label: "Parking", amount: job.has_free_parking === false ? ACCESS_PARKING_FEE_GBP : 0, active: job.has_free_parking === false },
    {
      key: "materials",
      label: "Materials",
      amount: Math.max(0, Number(job.materials_cost ?? 0)),
      active: Math.max(0, Number(job.materials_cost ?? 0)) > 0.02,
    },
  ] as const;
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
  const phaseCount = normalizeTotalPhases(job.total_phases);
  const reportsValidatedCount = reportPhaseIndices(phaseCount).filter(
    (n) => Boolean(job[`report_${n}_approved` as keyof Job]),
  ).length;
  const reportsProgressPercent =
    phaseCount > 0 ? Math.min(100, Math.round((reportsValidatedCount / phaseCount) * 100)) : 0;
  const displayPhase = phaseCount === 2 ? (job.report_2_uploaded ? 2 : 1) : 1;
  const sendReportFinalCheck = canSendReportAndRequestFinalPayment(job);
  const primaryInvoiceForBadge = job.invoice_id
    ? jobInvoices.find((inv) => inv.id === job.invoice_id) ?? jobInvoices[0]
    : jobInvoices[0];
  const invoiceLifecycleBadge: { label: "Draft" | "Sent" | "Cancelled"; className: string } | null = primaryInvoiceForBadge
    ? primaryInvoiceForBadge.status === "draft"
      ? { label: "Draft", className: "border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300" }
      : primaryInvoiceForBadge.status === "cancelled"
        ? { label: "Cancelled", className: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300" }
      : { label: "Sent", className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
    : null;
  const selfBillLifecycleBadge: { label: "Draft" | "Sent" | "Cancelled"; className: string } | null = jobSelfBill
    ? ["accumulating", "pending_review", "draft"].includes(jobSelfBill.status)
      ? { label: "Draft", className: "border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300" }
      : ["payout_cancelled", "payout_lost", "payout_archived", "rejected"].includes(jobSelfBill.status)
        ? { label: "Cancelled", className: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300" }
      : { label: "Sent", className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
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
  const timeSpentLabel = officeTimerDisplaySeconds != null
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
          ? "On hold"
          : job.status === "scheduled" && Number(job.timer_elapsed_seconds ?? 0) > 0
            ? "Paused"
            : "Saved"
      : partnerLiveActiveMs != null
        ? job.partner_timer_ended_at
          ? "Ended"
          : "Live"
        : Number(job.timer_elapsed_seconds ?? 0) > 0
          ? "Recorded"
          : "Not started";
  const attestationDisplayName = profile?.full_name?.trim() || job.owner_name?.trim() || "Victor";
  const ownerAttestationText = `I, ${attestationDisplayName}, confirm I checked this report and I take full responsibility for report and payment approval for this job.`;
  const forcedPaidBySystemOwner = isJobForcePaid(job.internal_notes);
  const mandatoryChecksOk = reportsUploaded && reportsApproved && ownerApprovalChecked;
  const canSubmitApproval =
    mandatoryChecksOk || (forceApprovalChecked && forceApprovalReason.trim().length > 0);
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
  const approvalPartnerPayRemaining = Math.max(0, approvalPartnerCap - partnerPaidTotal);
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
              <span className="text-text-secondary">Partner total (incl. materials)</span>
              <span className="font-semibold tabular-nums text-rose-700">{formatCurrency(partnerCashOutTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Base labour</span>
              <span className="font-semibold tabular-nums">-{formatCurrency(partnerCashOutBase)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Extra payout</span>
              <span className={cn("font-semibold tabular-nums", hasPartnerExtra ? "text-rose-700" : "text-text-tertiary")}>
                {hasPartnerExtra ? `-${formatCurrency(partnerExtraDisplay)}` : formatCurrency(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Materials</span>
              <span className="font-semibold tabular-nums">-{formatCurrency(Math.max(0, Number(job.materials_cost ?? 0)))}</span>
            </div>
            <div className="border-t border-rose-200/70 pt-1.5 flex items-center justify-between">
              <span className="text-text-secondary">Paid out</span>
              <span className="font-semibold tabular-nums">{formatCurrency(partnerPaidTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Still due</span>
              <span className={cn("font-bold tabular-nums", partnerPayRemaining > 0.02 ? "text-amber-700" : "text-emerald-700")}>
                {formatCurrency(partnerPayRemaining)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-light bg-card p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Profit & Loss</p>
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
          {formatCurrency(billableRevenue)}). Adjust deposit/final on the Financial setup tab if needed.
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
                  variant="outline"
                  size="sm"
                  className="h-auto shrink-0 rounded-full px-3 py-1.5 text-xs font-medium"
                  icon={<ArrowLeft className="h-3.5 w-3.5" />}
                  onClick={() => router.push("/jobs")}
                >
                  Back
                </Button>
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
                <Badge variant={config.variant} dot={config.dot} size="sm" className={statusColors.topBadgeClass || undefined}>
                  {config.label}
                </Badge>
                <JobOverdueBadge job={job} size="sm" />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {healthMissingPartner ? (
                  <span className="text-[10px] font-medium rounded-full px-2 py-0.5 border border-amber-500/45 bg-amber-500/10 text-amber-900 dark:text-amber-100">
                    ⚠ No partner
                  </span>
                ) : null}
                {healthMissingScope ? (
                  <span className="text-[10px] font-medium rounded-full px-2 py-0.5 border border-amber-500/45 bg-amber-500/10 text-amber-900 dark:text-amber-100">
                    ⚠ No scope
                  </span>
                ) : null}
            {statusActions.map((action, idx) => {
              const completeGreenClass =
                "border-emerald-600/45 bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm dark:border-emerald-700/55 dark:bg-emerald-600 dark:hover:bg-emerald-500";
              const holdDarkRedClass =
                "border-red-950/40 bg-red-950/[0.08] text-red-950 hover:bg-red-950/12 dark:border-red-900/55 dark:bg-red-950/45 dark:text-red-50 dark:hover:bg-red-950/55";
              const cancelJobClass =
                action.status === "cancelled"
                  ? "h-auto border-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-none hover:bg-red-700"
                  : undefined;
              const variant =
                action.destructive ? "danger" : action.primary && action.tone !== "success" ? "primary" : "outline";
              const toneClass = action.tone === "success" ? completeGreenClass : action.tone === "hold" ? holdDarkRedClass : undefined;
              return (
                <Button
                  key={`${action.special ?? action.status}-${idx}`}
                  variant={variant}
                  className={cn(toneClass, "h-8 px-2.5 text-xs", cancelJobClass)}
                  size="sm"
                  icon={<action.icon className="h-3.5 w-3.5" />}
                  disabled={action.special === "send_report_invoice" ? !sendReportFinalCheck.ok : false}
                  title={action.special === "send_report_invoice" ? sendReportFinalCheck.message : undefined}
                  onClick={() => {
                    if (action.status === "cancelled") {
                      setCancelPresetId(OFFICE_JOB_CANCELLATION_REASONS[0].id);
                      setCancelDetail("");
                      setCancelJobOpen(true);
                      return;
                    }
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
                      setValidateCompleteOpen(true);
                      return;
                    }
                    if (job.status === "need_attention" && action.status === "completed") {
                      setApprovalMode("validate_complete");
                      setOwnerApprovalChecked(false);
                      setForceApprovalChecked(false);
                      setForceApprovalReason("");
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
              </div>
            </div>
          </div>

        <div className="space-y-0">
        {job.status === "cancelled" && job.partner_cancelled_at ? (
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-text-secondary mx-3 mt-3">
            <p className="font-semibold text-text-primary">Partner cancellation</p>
            <p>
              Fee recorded: £{Number(job.partner_cancellation_fee ?? 0).toFixed(2)}
              {job.partner_cancellation_reason?.trim()
                ? ` · Reason: ${job.partner_cancellation_reason.trim()}`
                : ""}
            </p>
          </div>
        ) : null}
        {job.status === "cancelled" && !job.partner_cancelled_at && job.cancellation_reason?.trim() ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-xs text-text-secondary">
            <p className="font-semibold text-text-primary">Office cancellation</p>
            <p className="text-text-secondary mt-0.5">{job.cancellation_reason.trim()}</p>
            {job.cancelled_at ? (
              <p className="text-[10px] text-text-tertiary mt-1">
                Recorded {new Date(job.cancelled_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            ) : null}
          </div>
        ) : null}
        {job.status === "completed" ? (
          <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-text-secondary">
            <p className="font-semibold text-text-primary">Job approval</p>
            <p>
              Approved by:{" "}
              <span className="font-medium text-text-primary">
                {(job.owner_name?.trim() || "Job owner")}
              </span>
            </p>
            <p className="text-[10px] text-text-tertiary mt-1">
              Recorded{" "}
              {new Date(job.report_submitted_at ?? job.updated_at ?? new Date().toISOString()).toLocaleString(
                undefined,
                { dateStyle: "medium", timeStyle: "short" },
              )}
            </p>
            {forcedPaidBySystemOwner ? (
              <p className="mt-1 text-[11px] font-semibold text-red-600">
                Forced and guaranteed by system owner.
              </p>
            ) : null}
          </div>
        ) : null}

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
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Job amount</p>
            <p className="text-2xl font-bold tabular-nums leading-tight tracking-tight text-text-primary">{formatCurrency(billableRevenue)}</p>
            <p className="mt-0.5 text-[10px] text-text-tertiary leading-none">Incl. extras</p>
          </div>
          <div className="flex min-w-0 flex-col justify-center border-border-light px-3 py-3 sm:px-4 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Partner cost</p>
            <p className="text-2xl font-bold tabular-nums leading-tight tracking-tight text-text-secondary">{formatCurrency(Number(job.partner_cost ?? 0))}</p>
          </div>
          <div className="flex min-w-0 flex-col justify-center border-border-light px-3 py-3 sm:px-4 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Margin</p>
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
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Margin %</p>
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
                          onClick={() => {
                            setJobTypeEditTarget(job.job_type === "hourly" ? "hourly" : "fixed");
                            setJobTypeEditCatalogId(job.catalog_service_id ?? "");
                            setJobTypeEditFixedTitle(job.title ?? "");
                            setJobTypeEditOpen(true);
                          }}
                          title="Edit type of work"
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
                    const startIso =
                      displayDate && scheduleTime.trim()
                        ? `${displayDate}T${scheduleTime.trim()}:00`
                        : job.scheduled_start_at?.trim() || "";
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
                      hasWindow && displayDate && scheduleTime.trim()
                        ? formatArrivalTimeRange(
                            `${displayDate}T${scheduleTime.trim()}:00`,
                            scheduledEndFromWindow(displayDate, scheduleTime.trim(), windowValue),
                          )
                        : null;
                    const agreedArrivalRange = rangeFromStored || rangeFromUi;
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
                            {agreedArrivalRange ? (
                              <span className="font-medium">Arrival: {agreedArrivalRange}</span>
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
                            "inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold",
                            job.job_type === "hourly"
                              ? "border-[#7c3aed] bg-[#f5f3ff] text-[#5b21b6]"
                              : "border-[#333] bg-[#f4f2ef] text-[#1a1a1a] dark:border-[#6b7280] dark:bg-[#1f2631] dark:text-[#e5e7eb]",
                          )}
                        >
                          {job.job_type === "hourly" ? <Clock className="h-[11px] w-[11px]" /> : <Lock className="h-[11px] w-[11px]" />}
                          {job.job_type === "hourly" ? "Hourly" : "Fixed"}
                        </span>
                        <button
                          type="button"
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface-hover text-text-tertiary transition-colors hover:border-primary/35 hover:bg-primary-light/60 hover:text-primary dark:border-[#2f3440] dark:bg-[#1a202a] dark:hover:border-primary/45 dark:hover:bg-primary/15 dark:hover:text-primary"
                          disabled={job.status === "cancelled"}
                          onClick={() => {
                            setFixedRatesInlineOpen(false);
                            setFixedInlineClientRate(String(Math.max(0, Number(job.client_price ?? 0))));
                            setFixedInlinePartnerCost(String(Math.max(0, Number(job.partner_cost ?? 0))));
                            setJobTypeEditTarget(job.job_type === "hourly" ? "hourly" : "fixed");
                            setJobTypeEditCatalogId(job.catalog_service_id ?? "");
                            setJobTypeEditFixedTitle(job.title ?? "");
                            setJobTypeEditOpen(true);
                          }}
                          title="Edit pricing"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        {job.job_type === "hourly" ? (
                          <>
                            <span className="mx-1 h-4 border-l border-[#e8e5e0] dark:border-[#2f3440]" />
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[#333] tabular-nums dark:text-[#d8dee9]">
                                {formatOfficeTimer(officeTimerDisplaySeconds ?? (Number(job.timer_elapsed_seconds ?? 0) || 0))}
                              </span>
                              <button
                                type="button"
                                className="text-text-tertiary transition-colors hover:text-primary dark:text-[#8a93a5]"
                                onClick={() => setHourlyTimeEditOpen((v) => !v)}
                                title="Edit time"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          </>
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
                          <div className="grid grid-cols-2 gap-2">
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
                              <label className="mb-1 block text-[11px] font-medium text-text-secondary">Partner cost £</label>
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
                          <div className="mt-2 grid grid-cols-2 gap-2">
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
              <div className="border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setClientEditAccordionOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-text-secondary hover:bg-surface-hover/50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Pencil className="h-3 w-3 shrink-0 text-text-tertiary" aria-hidden />
                    Edit client &amp; address
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", clientEditAccordionOpen && "rotate-180")} />
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
              <div className="space-y-2 border-t border-border-light bg-surface-secondary p-3 dark:border-[#2b313d] dark:bg-[#161c26]">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-light bg-border-light">
                  <div className="min-w-0 bg-card p-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Start date</p>
                    <Input
                      type="date"
                      value={scheduleDate}
                      disabled={job.status === "cancelled"}
                      className="mt-0.5 h-7 text-[13px]"
                      onChange={(e) => {
                        const v = e.target.value;
                        setScheduleDate(v);
                        if (!v.trim()) setScheduleExpectedFinishDate("");
                        handleScheduleChange(job, v, scheduleTime, scheduleWindowMins, v.trim() ? scheduleExpectedFinishDate : "");
                      }}
                    />
                  </div>
                  <div className="min-w-0 bg-card p-2">
                    <div className="flex items-center gap-0.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Arrival time</p>
                      <span className="group relative shrink-0">
                        <span
                          tabIndex={0}
                          className="inline-flex cursor-help rounded p-px text-text-tertiary outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-primary/25"
                          aria-label="How arrival time is shown to clients and partners"
                        >
                          <Info className="h-3 w-3" aria-hidden />
                        </span>
                        <span
                          role="tooltip"
                          className="pointer-events-none invisible absolute bottom-full left-0 z-[60] mb-1 w-44 whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1 text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                        >
                          {arrivalFieldTooltipText}
                        </span>
                      </span>
                    </div>
                    <TimeSelect
                      value={scheduleTime}
                      disabled={job.status === "cancelled"}
                      className="mt-0.5 h-7 text-[13px]"
                      onChange={(v) => {
                        setScheduleTime(v);
                        handleScheduleChange(job, scheduleDate, v, scheduleWindowMins, scheduleExpectedFinishDate);
                      }}
                    />
                  </div>
                  <div className="min-w-0 bg-card p-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Window</p>
                    <Select
                      value={scheduleWindowMins}
                      disabled={job.status === "cancelled"}
                      className="mt-0.5 h-7 text-[13px]"
                      onChange={(e) => {
                        const v = e.target.value;
                        setScheduleWindowMins(v);
                        handleScheduleChange(job, scheduleDate, scheduleTime, v, scheduleExpectedFinishDate);
                      }}
                      options={[...ARRIVAL_WINDOW_OPTIONS]}
                    />
                  </div>
                  <div className="min-w-0 bg-card p-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Expected finish{scheduleDate.trim() ? " *" : ""}
                    </p>
                    <Input
                      type="date"
                      value={scheduleExpectedFinishDate}
                      disabled={job.status === "cancelled"}
                      className="mt-0.5 h-7 text-[13px]"
                      onChange={(e) => {
                        setScheduleExpectedFinishDate(e.target.value);
                        handleScheduleChange(job, scheduleDate, scheduleTime, scheduleWindowMins, e.target.value);
                      }}
                    />
                  </div>
                </div>
                {!isHousekeepJobDetail ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0 rounded-lg border border-border-light bg-surface-hover/80 p-2.5 shadow-sm dark:border-[#2b313d] dark:bg-[#1a202a]">
                      <div className="flex items-center gap-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">CCZ</p>
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
                      className={cn(
                            "mt-1.5 flex w-full max-w-[13rem] items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                            effectiveCustomerInCcz
                              ? "border-emerald-500/45 bg-white shadow-sm dark:border-emerald-500/50 dark:bg-[#141a24]"
                              : "border-border bg-white/90 hover:border-border dark:border-[#2f3440] dark:bg-[#171d28] dark:hover:border-[#3a4252]",
                            !cczEligibleAddress && !job.in_ccz && "cursor-not-allowed opacity-50",
                          )}
                      >
                          <span
                            className={cn(
                              "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors",
                              effectiveCustomerInCcz ? "bg-emerald-600" : "bg-stone-300/90 dark:bg-stone-600",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform dark:bg-[#d8dee9]",
                                effectiveCustomerInCcz ? "translate-x-[14px]" : "translate-x-[2px]",
                              )}
                            />
                          </span>
                          <span className={cn("text-[10px] font-medium", effectiveCustomerInCcz ? "text-amber-600" : "text-text-tertiary")}>
                            {effectiveCustomerInCcz ? `+£${ACCESS_CCZ_FEE_GBP}` : "No fee"}
                          </span>
                      </button>
                    </div>
                    <div className="min-w-0 rounded-lg border border-border-light bg-surface-hover/80 p-2.5 shadow-sm dark:border-[#2b313d] dark:bg-[#1a202a]">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Parking</p>
                      <button
                          type="button"
                          disabled={job.status === "cancelled" || savingAccessFees}
                          onClick={() => void saveAccessFeeFlags({ has_free_parking: !Boolean(job.has_free_parking) })}
                          className={cn(
                            "mt-1.5 flex w-full max-w-[13rem] items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                            job.has_free_parking === false
                              ? "border-amber-500/40 bg-white shadow-sm dark:border-amber-500/45 dark:bg-[#141a24]"
                              : "border-border bg-white/90 hover:border-border dark:border-[#2f3440] dark:bg-[#171d28] dark:hover:border-[#3a4252]",
                          )}
                      >
                          <span
                            className={cn(
                              "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors",
                              job.has_free_parking === false ? "bg-emerald-600" : "bg-stone-300/90 dark:bg-stone-600",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform dark:bg-[#d8dee9]",
                                job.has_free_parking === false ? "translate-x-[14px]" : "translate-x-[2px]",
                              )}
                            />
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-medium",
                              job.has_free_parking === false ? "text-amber-600" : "text-text-tertiary",
                            )}
                          >
                            {job.has_free_parking === false ? `+£${ACCESS_PARKING_FEE_GBP}` : "No fee"}
                          </span>
                      </button>
                    </div>
                  </div>
                ) : null}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {job.quote_id && <Link href="/quotes" className="inline-flex items-center gap-1 text-primary hover:underline">Quote <ExternalLink className="h-3 w-3" /></Link>}
                    {job.self_bill_id && <Link href="/finance/selfbill" className="inline-flex items-center gap-1 text-primary hover:underline">Self-bill <ExternalLink className="h-3 w-3" /></Link>}
                    {job.invoice_id && <Link href="/finance/invoices" className="inline-flex items-center gap-1 text-primary hover:underline">Invoice <ExternalLink className="h-3 w-3" /></Link>}
                  </div>
              </div>
            </div>

            {/* Scope / photos / reports / financial — tabbed */}
            <div className="overflow-hidden rounded-xl border border-border-light bg-[#fdfdfd] shadow-sm dark:border-[#2b313d] dark:bg-[#141922]">
              <div className="flex flex-wrap border-b border-border-light bg-[#fdfdfd] dark:border-[#2b313d] dark:bg-[#141922]">
                {(
                  [
                    { label: "Details", index: 0 as const },
                    { label: "Site Photos", index: 1 as const },
                    { label: "Reports", index: 2 as const },
                    { label: "Notes", index: 3 as const },
                    ...(isAdmin ? [{ label: "Financial Setup", index: 4 as const }] : []),
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setDetailTab(tab.index)}
                    className={cn(
                      "min-w-0 flex-1 px-1.5 py-2 text-center text-[11px] font-medium transition-colors sm:px-2",
                      detailTab === tab.index
                        ? "border-b-2 border-primary text-primary"
                        : "border-b-2 border-transparent text-text-tertiary hover:text-text-secondary",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="p-3 space-y-3 bg-[#fdfdfd] dark:bg-[#161c26]">
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
              <p className="text-[11px] text-text-tertiary">Scope is required before assigning a partner. Site photos are on the Site photos tab.</p>
              <div className="space-y-1.5 border-t border-border-light pt-2">
                <p className="text-xs font-medium text-text-secondary">Scope</p>
                <textarea
                  value={scopeDraft}
                  onChange={(e) => setScopeDraft(e.target.value)}
                  rows={2}
                  placeholder="Describe what the partner is expected to do…"
                  className={cn(JOB_DETAIL_MULTILINE_FIELD_CLASS, "min-h-[72px]")}
                />
                <Button type="button" variant="outline" size="sm" loading={savingScope} onClick={async () => {
                  if (!job) return;
                  setSavingScope(true);
                  try {
                    await handleJobUpdate(job.id, { scope: scopeDraft.trim() || undefined });
                  } finally {
                    setSavingScope(false);
                  }
                }}>
                  Save scope
                </Button>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border-light">
                <p className="text-xs font-medium text-text-secondary">Additional notes</p>
                <p className="text-[11px] text-text-tertiary">Internal only — not shown to the client; use for access, keys, or context beyond the scope.</p>
                <textarea
                  value={additionalNotesDraft}
                  onChange={(e) => setAdditionalNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Parking, entry, preferences…"
                  className={cn(JOB_DETAIL_MULTILINE_FIELD_CLASS, "min-h-[86px]")}
                />
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
                    } finally {
                      setSavingAdditionalNotes(false);
                    }
                  }}
                >
                  Save additional notes
                </Button>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border-light">
                <p className="text-xs font-medium text-text-secondary">Report link (optional)</p>
                <p className="text-[11px] text-text-tertiary">External URL — Google Drive, Notion, shared doc. Not shown to the client.</p>
                <Input
                  type="url"
                  value={reportLinkDraft}
                  onChange={(e) => setReportLinkDraft(e.target.value)}
                  placeholder="https://…"
                  className={cn(JOB_DETAIL_INLINE_INPUT_FIELD_CLASS, "h-auto min-h-0")}
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
                      } finally {
                        setSavingReportLink(false);
                      }
                    }}
                  >
                    Save report link
                  </Button>
                  {(() => {
                    const href = jobReportLinkHref(reportLinkDraft || job.report_link);
                    return href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        Open link
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null;
                  })()}
                </div>
              </div>
              </div>
              ) : null}

              {detailTab === 2 ? (
            <>
            <div className="rounded-xl border border-border-light bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Reports
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Progress
                    value={reportsProgressPercent}
                    size="sm"
                    color={reportsProgressPercent === 100 ? "emerald" : "primary"}
                    className="w-24 min-w-[6rem]"
                  />
                  <span className="text-[11px] font-semibold text-text-primary tabular-nums">{reportsProgressPercent}%</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {reportPhaseIndices(job.total_phases).map((n) => {
                  const uploaded = job[`report_${n}_uploaded` as keyof Job] as boolean;
                  const approved = job[`report_${n}_approved` as keyof Job] as boolean;
                  const uploadedAt = job[`report_${n}_uploaded_at` as keyof Job] as string | undefined;
                  const approvedAt = job[`report_${n}_approved_at` as keyof Job] as string | undefined;
                  const phaseLabel = reportPhaseLabel(n, job.total_phases);
                  const uploadCheck = canMarkReportUploaded(job, n);
                  const approveCheck = canApproveReport(job, n);
                  const appReport = reportByPhase.get(n);
                  const reportImages = [
                    ...(appReport?.images ?? []),
                    ...(appReport?.before_images ?? []),
                    ...(appReport?.after_images ?? []),
                  ].filter(Boolean);
                  return (
                    <div key={n} className={`rounded-xl border p-3 space-y-2 ${approved ? "border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/20" : uploaded ? "border-amber-200 bg-amber-50/30 dark:bg-amber-950/10" : "border-border-light bg-surface-hover/40"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {approved ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : uploaded ? <Upload className="h-4 w-4 text-amber-500" /> : <FileText className="h-4 w-4 text-text-tertiary" />}
                          <p className="text-sm font-semibold text-text-primary">{phaseLabel}</p>
                        </div>
                        <Badge variant={approved ? "success" : uploaded ? "warning" : "default"} size="sm">
                          {approved ? "Validated" : uploaded ? "Pending review" : "Not uploaded"}
                        </Badge>
                      </div>
                      {approvedAt && <p className="text-xs text-emerald-600">Approved {new Date(approvedAt).toLocaleDateString()}</p>}
                      {uploadedAt && !approvedAt && <p className="text-xs text-amber-600">Uploaded {new Date(uploadedAt).toLocaleDateString()}</p>}
                      {appReport && (
                        <div className="rounded-lg border border-border-light bg-card/70 p-3 space-y-2">
                          {appReport.description?.trim() ? (
                            <p className="text-xs text-text-secondary">
                              <span className="font-semibold text-text-primary">Notes:</span> {appReport.description.trim()}
                            </p>
                          ) : null}
                          {appReport.materials?.trim() ? (
                            <p className="text-xs text-text-secondary">
                              <span className="font-semibold text-text-primary">Materials:</span> {appReport.materials.trim()}
                            </p>
                          ) : null}
                          {reportImages.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {reportImages.slice(0, 4).map((url, idx) => (
                                <button
                                  key={`${appReport.id}-${idx}`}
                                  type="button"
                                  onClick={() => void openPartnerReportImage(url, `${appReport.id}-${idx}`)}
                                  className="text-[11px] underline text-primary hover:opacity-80"
                                >
                                  {openingReportImageKey === `${appReport.id}-${idx}` ? "Opening..." : `Image ${idx + 1}`}
                                </button>
                              ))}
                              {reportImages.length > 4 && (
                                <span className="text-[11px] text-text-tertiary">+{reportImages.length - 4} more</span>
                              )}
                            </div>
                          )}
                          {appReport.pdf_url ? (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<ExternalLink className="h-3.5 w-3.5" />}
                              loading={openingReportId === appReport.id}
                              onClick={() => void openPartnerReportPdf(appReport)}
                            >
                              Open PDF
                            </Button>
                          ) : null}
                        </div>
                      )}
                      <div className="space-y-2 pt-1">
                        {!uploaded && (
                          <>
                            <input
                              id={`phase-report-file-${n}`}
                              type="file"
                              accept=".pdf,.doc,.docx,image/jpeg,image/jpg,image/png,image/webp,image/gif"
                              className="sr-only"
                              onChange={(e) => setPhaseReportFiles((prev) => ({ ...prev, [n]: e.target.files?.[0] ?? null }))}
                            />
                            <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/40 p-3">
                              <div className="flex items-center gap-2">
                                <label
                                  htmlFor={`phase-report-file-${n}`}
                                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-text-primary cursor-pointer hover:border-primary/30 hover:bg-surface-hover transition-colors"
                                >
                                  <Upload className="h-3.5 w-3.5" />
                                  {phaseReportFiles[n] ? "Change file" : "Choose file"}
                                </label>
                                {phaseReportFiles[n] && (
                                  <button
                                    type="button"
                                    onClick={() => setPhaseReportFiles((prev) => ({ ...prev, [n]: null }))}
                                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
                                  >
                                    <X className="h-3 w-3" /> Remove
                                  </button>
                                )}
                              </div>
                              <p className="mt-2 text-xs text-text-tertiary truncate">
                                {phaseReportFiles[n]?.name ?? "No file selected"}
                              </p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <Button
                                size="sm"
                                variant="primary"
                                icon={<Upload className="h-3.5 w-3.5" />}
                                disabled={!uploadCheck.ok || !phaseReportFiles[n]}
                                loading={analyzingPhase === n}
                                title={uploadCheck.message}
                                onClick={() => {
                                  if (!uploadCheck.ok) {
                                    toast.error(uploadCheck.message ?? "Cannot upload yet");
                                    return;
                                  }
                                  void handlePhaseReportUploadAnalyze(n);
                                }}
                              >
                                Upload & analyze
                              </Button>
                            </div>
                          </>
                        )}
                        {uploaded && !approved && (
                          <Button size="sm" variant="primary" icon={<ShieldCheck className="h-3.5 w-3.5" />} disabled={!approveCheck.ok} title={approveCheck.message}
                            onClick={() => { if (!approveCheck.ok) { toast.error(approveCheck.message ?? "Cannot approve yet"); return; } handleJobUpdate(job.id, { [`report_${n}_approved`]: true, [`report_${n}_approved_at`]: new Date().toISOString() } as Partial<Job>); }}>
                            Validate now
                          </Button>
                        )}
                      </div>
                      {!uploadCheck.ok && !uploaded && uploadCheck.message && <p className="text-[11px] text-amber-600 dark:text-amber-400">{uploadCheck.message}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-text-tertiary">
                  {loadingAppJobReports ? "Loading partner reports..." : `${appJobReports.length} report record(s) from partner app`}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={async () => {
                    if (!job?.id) return;
                    setLoadingAppJobReports(true);
                    try {
                      const rows = await listAppJobReports(job.id);
                      setAppJobReports(rows);
                    } finally {
                      setLoadingAppJobReports(false);
                    }
                  }}
                >
                  Refresh reports
                </Button>
              </div>
              {allConfiguredReportsApproved(job) && (
                <div className="mt-2 p-2.5 rounded-xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-2">
                  <p className="flex-1 text-sm font-medium text-text-primary">All reports validated — ready to send report & request final payment.</p>
                  <Button
                    size="sm"
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    disabled={!sendReportFinalCheck.ok}
                    title={sendReportFinalCheck.message}
                    onClick={() => void handleSendReportAndInvoice()}
                  >
                    Review & Approve
                  </Button>
                </div>
              )}
            </div>

            {/* MANUAL REPORT + AI ANALYSIS */}
            <details className="group rounded-xl border border-border-light bg-card overflow-hidden">
              <summary className="flex list-none items-center justify-between gap-2 p-3 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0" /> Manual report analysis (AI)
                </p>
                <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-2.5 border-t border-border-light px-3 pb-3 pt-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Report file</label>
                  <input
                    id="manual-report-file"
                    type="file"
                    accept=".pdf,.doc,.docx,image/jpeg,image/jpg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={(e) => setManualReportFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="rounded-xl border border-dashed border-border-light bg-surface-hover/40 p-3">
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="manual-report-file"
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-text-primary cursor-pointer hover:border-primary/30 hover:bg-surface-hover transition-colors"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {manualReportFile ? "Change file" : "Choose file"}
                      </label>
                      {manualReportFile && (
                        <button
                          type="button"
                          onClick={() => setManualReportFile(null)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
                        >
                          <X className="h-3 w-3" /> Remove
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-text-tertiary truncate">{manualReportFile?.name ?? "No file selected"}</p>
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-1">Supported: PDF, DOC, DOCX or images (max 10MB).</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Ops notes (recommended)</label>
                  <textarea
                    value={manualReportNotes}
                    onChange={(e) => setManualReportNotes(e.target.value)}
                    rows={3}
                    placeholder="Add context, what was done, issues found, materials used, safety notes..."
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    loading={analyzingManualReport}
                    disabled={!manualReportFile}
                    icon={<Upload className="h-3.5 w-3.5" />}
                    onClick={() => void handleManualReportAnalyze()}
                  >
                    Upload & Analyze
                  </Button>
                  {manualReportFile && <span className="text-xs text-text-tertiary truncate">{manualReportFile.name}</span>}
                </div>
                {manualReportResult && (
                  <div className="rounded-xl border border-border-light bg-surface-hover/40 p-3">
                    <p className="text-xs font-semibold text-text-secondary mb-1">AI response</p>
                    <pre className="text-xs whitespace-pre-wrap text-text-primary">{manualReportResult}</pre>
                  </div>
                )}
              </div>
            </details>
            </>
            ) : null}

            {detailTab === 3 ? (
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

            {isAdmin && detailTab === 4 ? (
            <details className="group rounded-xl border border-border-light bg-card overflow-hidden">
              <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Financial setup</p>
                <ChevronDown className="h-4 w-4 text-text-tertiary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-3 space-y-3 border-t border-border-light pt-3">
                <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2.5 space-y-2">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">How this maps in code</p>
                  <ul className="text-[11px] text-text-tertiary leading-relaxed space-y-1.5 list-disc pl-4">
                    <li>
                      <span className="font-medium text-text-secondary">Client billable</span> —{" "}
                      <span className="font-mono text-[10px] text-text-secondary">client_price</span> +{" "}
                      <span className="font-mono text-[10px] text-text-secondary">extras_amount</span>
                      {" "}(same as <span className="font-mono text-[10px] text-text-secondary">jobBillableRevenue</span>). Drives invoices, collections, and the customer “amount due” on this job.
                    </li>
                    <li>
                      <span className="font-medium text-text-secondary">Your direct cost</span> —{" "}
                      <span className="font-mono text-[10px] text-text-secondary">partner_cost</span> +{" "}
                      <span className="font-mono text-[10px] text-text-secondary">materials_cost</span>
                      {" "}(same as <span className="font-mono text-[10px] text-text-secondary">jobDirectCost</span>). Subtracted from client billable for margin; both lines roll into the weekly self-bill (labour + materials).
                    </li>
                    <li>
                      <span className="font-medium text-text-secondary">Partner labour cap (cash out / self-bill labour)</span> —{" "}
                      <span className="font-mono text-[10px] text-text-secondary">partner_agreed_value</span> if &gt; 0, otherwise{" "}
                      <span className="font-mono text-[10px] text-text-secondary">partner_cost</span>
                      {" "}(<span className="font-mono text-[10px] text-text-secondary">partnerPaymentCap</span>). Materials are separate on the self-bill.
                    </li>
                    <li>
                      <span className="font-medium text-text-secondary">Deposit / final</span> —{" "}
                      <span className="font-mono text-[10px] text-text-secondary">customer_deposit</span> +{" "}
                      <span className="font-mono text-[10px] text-text-secondary">customer_final_payment</span>
                      {" "}should match client billable for a clean payment schedule.
                    </li>
                  </ul>
                </div>
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
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">1 · Client billing (what we invoice / collect)</p>
                  <p className="text-[10px] text-text-tertiary">Not paid to the partner directly — this is revenue from the customer.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Core ticket — client_price</label>
                      <Input type="number" min={0} step="0.01" value={finForm.client_price} onChange={(e) => {
                        const price = parseFloat(e.target.value) || 0;
                        const extras = parseFloat(finForm.extras_amount) || 0;
                        const dep = parseFloat(finForm.customer_deposit) || 0;
                        const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                        setFinForm((f) => ({ ...f, client_price: e.target.value, customer_final_payment: autoFinal }));
                      }} />
                      <p className="text-[10px] text-text-tertiary mt-1">Main labour / sell price before add-ons (field <span className="font-mono text-[10px]">client_price</span>).</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Add-ons — extras_amount</label>
                      <Input type="number" min={0} step="0.01" value={finForm.extras_amount} onChange={(e) => {
                        const price = parseFloat(finForm.client_price) || 0;
                        const extras = parseFloat(e.target.value) || 0;
                        const dep = parseFloat(finForm.customer_deposit) || 0;
                        const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                        setFinForm((f) => ({ ...f, extras_amount: e.target.value, customer_final_payment: autoFinal }));
                      }} />
                      <p className="text-[10px] text-text-tertiary mt-1">Surcharges / upsells billed to the client (field <span className="font-mono text-[10px]">extras_amount</span>; CCZ/parking may also sit here).</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1 border-t border-border-light/80">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">2 · Internal cost (margin)</p>
                  <p className="text-[10px] text-text-tertiary">What the job costs you — subtracted from client billable for margin. Feeds self-bill lines (partner labour + materials).</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Subcontract labour — partner_cost</label>
                      <Input type="number" min={0} step="0.01" value={finForm.partner_cost} onChange={(e) => setFinForm((f) => ({ ...f, partner_cost: e.target.value }))} />
                      {suggestedPartnerCost40ForFinForm != null && (
                        <p className="text-[10px] text-text-tertiary mt-1.5 leading-snug">
                          ~{SUGGESTED_PARTNER_MARGIN_HINT_PCT}% margin hint:{" "}
                          <span className="font-semibold text-text-secondary tabular-nums">{formatCurrency(suggestedPartnerCost40ForFinForm)}</span>
                          {" "}(billable ticket + add-ons − materials).{" "}
                          <button
                            type="button"
                            className="text-primary hover:underline font-medium"
                            onClick={() =>
                              setFinForm((f) => ({ ...f, partner_cost: String(suggestedPartnerCost40ForFinForm) }))
                            }
                          >
                            Apply
                          </button>
                        </p>
                      )}
                      <p className="text-[10px] text-text-tertiary mt-1">Amount owed to the partner for work (field <span className="font-mono text-[10px]">partner_cost</span>). “Add extra payout” in Cash Out increases this and <span className="font-mono text-[10px]">partner_extras_amount</span>.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Your materials spend — materials_cost</label>
                      <Input type="number" min={0} step="0.01" value={finForm.materials_cost} onChange={(e) => setFinForm((f) => ({ ...f, materials_cost: e.target.value }))} />
                      <p className="text-[10px] text-text-tertiary mt-1">Materials you pay for (field <span className="font-mono text-[10px]">materials_cost</span>). Included in self-bill gross; not client revenue unless you also add to client side.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1 border-t border-border-light/80">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">3 · Partner labour cap (Cash Out / self-bill labour line)</p>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Optional override — partner_agreed_value</label>
                    <Input type="number" min={0} step="0.01" value={finForm.partner_agreed_value} onChange={(e) => setFinForm((f) => ({ ...f, partner_agreed_value: e.target.value }))} />
                    <p className="text-[10px] text-text-tertiary mt-1">
                      Leave <span className="font-semibold text-text-secondary">0</span> so <span className="font-mono text-[10px]">partnerPaymentCap</span> = <span className="font-mono text-[10px]">partner_cost</span>. If &gt; 0, Cash Out and self-bill use this number for labour instead (still add <span className="font-mono text-[10px]">materials_cost</span> on the bill).
                    </p>
                  </div>
                </div>

                <div className="space-y-2 pt-1 border-t border-border-light/80">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">4 · Client payment schedule</p>
                  <p className="text-[10px] text-text-tertiary">How the customer pays over time (deposit vs final) — must line up with client billable above.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Deposit — customer_deposit</label>
                      <Input type="number" min={0} step="0.01" value={finForm.customer_deposit} onChange={(e) => {
                        const price = parseFloat(finForm.client_price) || 0;
                        const extras = parseFloat(finForm.extras_amount) || 0;
                        const dep = parseFloat(e.target.value) || 0;
                        const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                        setFinForm((f) => ({ ...f, customer_deposit: e.target.value, customer_final_payment: autoFinal }));
                      }} />
                      <p className="text-[10px] text-text-tertiary mt-1">Upfront portion; maps to deposit payments and invoice stages.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Final balance — customer_final_payment</label>
                      <Input type="number" min={0} step="0.01" value={finForm.customer_final_payment} onChange={(e) => setFinForm((f) => ({ ...f, customer_final_payment: e.target.value }))} />
                      <p className="text-[10px] text-text-tertiary mt-1">
                        Auto from (client_price + extras_amount) − deposit; maps to final-balance collections. Adjust only if you need a manual split.
                      </p>
                    </div>
                  </div>
                </div>
                <Button type="button" size="sm" variant="primary" loading={savingFin} onClick={handleSaveFinancials}>Save pricing</Button>
              </div>
            </details>
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
                  <Avatar
                    src={partners.find((p) => p.id === job.partner_id)?.avatar_url}
                    name={job.partner_name || "Partner"}
                    size="sm"
                    className="h-8 w-8 border border-border-light ring-0"
                  />
                  {job.partner_name ? (
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-text-primary">{job.partner_name}</p>
                      <p className="text-[10px] text-text-tertiary">{job.partner_id ? `ID: ${job.partner_id.slice(0, 8)}…` : "No partner ID"}</p>
                    </div>
                  ) : (
                    <p className="text-xs font-medium text-text-tertiary">Unassigned</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-auto shrink-0 rounded-md border-primary/35 bg-primary-light/70 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light dark:border-primary/45 dark:bg-primary/10 dark:hover:bg-primary/15"
                  onClick={() => setPartnerModalOpen(true)}
                >
                  {job.partner_id ? "Swap" : "Assign"}
                </Button>
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
                  onChange={async (ownerId) => {
                    const owner = assignableUsers.find((u) => u.id === ownerId);
                    setSavingOwner(true);
                    try {
                      await handleJobUpdate(job.id, { owner_id: ownerId, owner_name: owner?.full_name });
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
                <p className="text-sm text-text-tertiary italic">No owner</p>
              )}
            </div>

            {/* FINANCIAL COMPLETION */}
            <div className="rounded-lg border border-border-light bg-card p-3 shadow-sm space-y-2.5 dark:border-[#2b313d] dark:bg-[#141922]">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1">
                <CreditCard className="h-3 w-3" /> Finance summary
              </p>

              {/* CLIENT cash in */}
              <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-2 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light/80 pb-1.5 text-xs dark:border-[#2f3642]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Cash in — client</span>
                    <Badge variant={amountDue > 0.02 ? "warning" : "success"} size="sm" className="h-5 text-[10px]">
                      {amountDue > 0.02 ? "Pending" : "Settled"}
                    </Badge>
                  </div>
                  <span
                    className="text-sm font-bold tabular-nums text-text-primary"
                    title="Extra charge / CCZ / parking change this total and the invoice. Record Payment only reduces amount due."
                  >
                    {formatCurrency(billableRevenue)}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
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
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Extras</p>
                    {cashInExtraRows.map((row) => (
                      <div key={row.key} className="flex items-center justify-between gap-2 py-1 text-xs">
                        <span className="text-text-secondary">{row.label}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("font-semibold tabular-nums", row.active ? "text-emerald-700" : "text-text-tertiary")}>
                            {row.active ? `+${formatCurrency(row.amount)}` : formatCurrency(0)}
                          </span>
                          <button
                            type="button"
                            className="text-text-tertiary transition-colors hover:text-text-primary"
                            title={`Edit ${row.label}`}
                            onClick={() => {
                              setMoneyDrawerFlow("client_extra");
                              setMoneyDrawerOpen(true);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
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
                <div className="mt-2 grid w-full grid-cols-1">
                  <Button
                    size="sm"
                    variant="primary"
                    className="h-10 w-full rounded-lg px-3 text-sm font-semibold shadow-sm"
                    icon={<Plus className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMoneyDrawerFlow("client_extra");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Extra charge
                  </Button>
                </div>
              </div>

              {/* Cash out (partner payout) */}
              <div className="rounded-lg border border-rose-200/80 bg-rose-50/45 p-2 shadow-sm dark:border-rose-500/25 dark:bg-rose-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light/80 pb-1.5 text-xs dark:border-[#2f3642]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Cash out — partner</span>
                    <Badge variant={partnerPayRemaining > 0.02 ? "warning" : "success"} size="sm" className="h-5 text-[10px]">
                      {partnerPayRemaining > 0.02 ? "Pending" : "Settled"}
                    </Badge>
                  </div>
                  <span
                    className="text-sm font-bold tabular-nums text-text-primary"
                    title="Partner cash out includes labour, extras, and materials cost."
                  >
                    {formatCurrency(partnerCashOutTotal)}
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="space-y-1 rounded-md border border-border-light/80 bg-muted/30 p-2 dark:border-[#323a46] dark:bg-[#1a212d]">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Extras</p>
                    {cashOutExtraRows.map((row) => (
                      <div key={row.key} className="py-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-text-secondary">{row.label}</span>
                          <div className="flex items-center gap-1.5">
                            <span className={cn("font-semibold tabular-nums", row.active ? "text-rose-700" : "text-text-tertiary")}>
                              {row.active ? `+${formatCurrency(row.amount)}` : formatCurrency(0)}
                            </span>
                            <button
                              type="button"
                              className="text-text-tertiary transition-colors hover:text-text-primary"
                              onClick={() => setCashOutExtraExpanded((prev) => (prev === row.key ? null : row.key))}
                              title={`Actions for ${row.label}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        {cashOutExtraExpanded === row.key ? (
                          <div className="mt-1 flex items-center gap-3 pl-4">
                            <button
                              type="button"
                              className="text-[10px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                              onClick={() => {
                                setMoneyDrawerFlow("partner_extra");
                                setMoneyDrawerOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-[10px] font-medium text-red-500 transition-colors hover:text-red-600"
                              onClick={() => {
                                void (async () => {
                                  if (!job || row.amount <= 0.02) return;
                                  try {
                                    const patch = reversePartnerExtraPatch(job, row.amount, row.allocation);
                                    if (Object.keys(patch).length === 0) return;
                                    const updated = await updateJob(job.id, patch);
                                    await syncSelfBillAfterJobChange(updated);
                                    setJob(updated);
                                    if (row.allocation === "materials") {
                                      // Materials line comes from job.materials_cost; no breakdown reset needed.
                                    } else {
                                      setPartnerExtrasUiValue((v) => Math.max(0, Math.round((v - row.amount) * 100) / 100));
                                      setPartnerExtraBreakdownUi((prev) => ({
                                        ...prev,
                                        [row.key]: Math.max(0, Math.round(((prev[row.key as "extra" | "ccz" | "parking"] ?? 0) - row.amount) * 100) / 100),
                                      }));
                                    }
                                    setCashOutExtraExpanded(null);
                                    await refreshJobFinance();
                                    toast.success("Extra updated");
                                  } catch {
                                    toast.error("Could not update extra");
                                  }
                                })();
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {/* Partner payment history: always show header when there is a partner cost so empty state is visible */}
                  {partnerCashOutTotal > 0.02 && (
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
                  )}
                  {partnerCashOutTotal > 0 && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-border-light dark:border-[#2f3642]">
                      <span className={`text-xs font-semibold ${partnerPayRemaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {partnerPayRemaining > 0 ? "Amount due" : "Fully paid out"}
                      </span>
                      <span className={`text-sm font-bold tabular-nums ${partnerPayRemaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {partnerPayRemaining > 0 ? formatCurrency(partnerPayRemaining) : formatCurrency(0)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-2 grid w-full grid-cols-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 w-full rounded-lg border-rose-300/90 bg-rose-50 px-3 text-sm font-semibold text-rose-900 shadow-sm hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-950/30 dark:text-rose-100 dark:hover:bg-rose-950/45"
                    disabled={!job.partner_id?.trim()}
                    icon={<Plus className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMoneyDrawerFlow("partner_extra");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Extra payout
                  </Button>
                </div>
              </div>

              {/* Net margin */}
              <div className="space-y-1.5 border-t border-border-light pt-2 dark:border-[#2f3642]">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Net margin</p>
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Financial documents</p>
                  {invoiceLifecycleBadge ? (
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", invoiceLifecycleBadge.className)}>
                      Invoice {invoiceLifecycleBadge.label}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                      Invoice not created
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] shrink-0">
                  <Link href="/finance/invoices" className="text-primary hover:underline inline-flex items-center gap-1">
                    All invoices <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link href="/finance/selfbill" className="text-primary hover:underline inline-flex items-center gap-1">
                    All self bills <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client invoices</p>
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

      <Modal
        open={validateCompleteOpen}
        onClose={() => {
          if (validatingComplete) return;
          setValidateCompleteOpen(false);
          setOwnerApprovalChecked(false);
          setForceApprovalChecked(false);
          setForceApprovalReason("");
          setApprovalBilledHoursInput("");
        }}
        title={approvalMode === "review_approve" ? "Review and approve" : "Validate and complete"}
        subtitle={`${job.reference} — review before approval`}
        size="lg"
        className="max-w-5xl"
      >
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border-light bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Total price</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{formatCurrency(approvalBillableRevenue)}</p>
              {approvalEffectiveCustomerDue > 0.02 ? (
                <p className="text-[11px] font-semibold text-amber-600 mt-1">Amount due: {formatCurrency(approvalEffectiveCustomerDue)}</p>
              ) : approvalInvoiceShowsPaid ? (
                <p className="text-[11px] font-semibold text-emerald-600 mt-1">Client invoice paid — collections satisfied for close.</p>
              ) : null}
            </div>
            <div className="rounded-xl border border-border-light bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Partner cost</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{formatCurrency(approvalPartnerCap)}</p>
              <p className="text-[11px] text-text-tertiary mt-1">Total partner payout cap</p>
            </div>
            <div className="rounded-xl border border-border-light bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Operating margin</p>
              <p className={cn("text-2xl font-bold mt-1", approvalProfit >= 0 ? "text-emerald-600" : "text-red-600")}>{formatCurrency(approvalProfit)}</p>
              <p className="text-[11px] text-text-tertiary mt-1">{formatCurrency(approvalProfit)} / {Math.max(0, approvalMarginPct).toFixed(1)}%</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border-light bg-card p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Client extra charges</p>
                <p className="text-[11px] text-text-tertiary mt-1 leading-snug">
                  Included in total price · <span className="font-mono text-[10px] text-text-secondary">extras_amount</span>
                  {" "}(add-ons / upsells; CCZ or parking may be folded in here).
                </p>
              </div>
              <p
                className={cn(
                  "text-xl sm:text-2xl font-bold tabular-nums shrink-0 text-right",
                  approvalClientExtrasAmount > 0.02 ? "text-emerald-600" : "text-text-tertiary",
                )}
              >
                {approvalClientExtrasAmount > 0.02 ? `+${formatCurrency(approvalClientExtrasAmount)}` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-border-light bg-card p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Partner extra payout</p>
                <p className="text-[11px] text-text-tertiary mt-1 leading-snug">
                  On top of base labour cap · <span className="font-mono text-[10px] text-text-secondary">partner_extras_amount</span>
                  {" "}or hourly vs cap delta (same as Cash Out breakdown).
                </p>
              </div>
              <p
                className={cn(
                  "text-xl sm:text-2xl font-bold tabular-nums shrink-0 text-right",
                  approvalPartnerExtrasSplit.extra > 0.02 ? "text-emerald-600" : "text-text-tertiary",
                )}
              >
                {approvalPartnerExtrasSplit.extra > 0.02 ? `+${formatCurrency(approvalPartnerExtrasSplit.extra)}` : "—"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Finance</p>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Client payment: Paid</span>
                  <span className="font-semibold text-text-primary">{formatCurrency(customerPaidTotal)}</span>
                </div>
                <Progress value={approvalCustomerPaidPct} className="h-2 mt-2" />
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-text-secondary">Client payment: Due</span>
                  <span className={cn("font-semibold", approvalEffectiveCustomerDue <= 0.02 ? "text-emerald-600" : "text-red-600")}>{formatCurrency(approvalEffectiveCustomerDue)}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Partner payment: Paid</span>
                  <span className="font-semibold text-text-primary">{formatCurrency(partnerPaidTotal)}</span>
                </div>
                <Progress value={approvalPartnerPaidPct} className="h-2 mt-2" />
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-text-secondary">Partner payment: Due</span>
                  <span className={cn("font-semibold", approvalPartnerPayRemaining <= 0.02 ? "text-emerald-600" : "text-red-600")}>{formatCurrency(approvalPartnerPayRemaining)}</span>
                </div>
              </div>
              {job.job_type === "hourly" ? (
                <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Final billed hours confirmation</p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-tertiary mb-1">Final billed hours</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={approvalBilledHoursInput}
                        onChange={(e) => setApprovalBilledHoursInput(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="text-[11px] text-text-tertiary pb-1">
                      Confirm total hours before approve
                    </div>
                  </div>
                </div>
              ) : null}
              <p className="text-[10px] text-text-tertiary px-1 leading-snug">
                Client invoice is created or updated on approve. Partner self-bill links when the database allows; otherwise use Finance or this job’s self-bill section. Totals use the figures stored on the job (adjust hourly/timer on the job page if needed).
              </p>
            </div>

            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Job summary</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Client invoice</span>
                  <span className={cn("font-semibold", job.invoice_id ? "text-emerald-600" : "text-red-600")}>{job.invoice_id ? "Ready" : "Not linked"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Partner self-bill</span>
                  <span className={cn("font-semibold", job.self_bill_id ? "text-emerald-600" : "text-amber-600")}>
                    {job.self_bill_id ? "Linked (weekly Mon–Sun)" : "Not linked"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">All reports uploaded</span>
                  <span className={cn("font-semibold", reportsUploaded ? "text-emerald-600" : "text-red-600")}>{reportsUploaded ? "Complete" : "Incomplete"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">All reports approved</span>
                  <span className={cn("font-semibold", reportsApproved ? "text-emerald-600" : "text-red-600")}>{reportsApproved ? "Complete" : "Incomplete"}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 text-xs">
                <p className="text-text-tertiary">Next status</p>
                <p className="font-semibold text-text-primary mt-0.5">{approvalEffectiveCustomerDue > 0.02 || approvalPartnerPayRemaining > 0.02 ? "Awaiting payment" : "Completed & paid"}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Reports</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {phaseIndexes.map((n) => {
                const uploaded = Boolean(job[`report_${n}_uploaded` as keyof Job]);
                const approved = Boolean(job[`report_${n}_approved` as keyof Job]);
                return (
                  <div key={n} className="rounded-lg border border-border-light bg-surface-hover/40 px-3 py-2 text-xs text-text-secondary">
                    <p className="font-medium text-text-primary">Report {n}</p>
                    <p className={cn(uploaded ? "text-emerald-600" : "text-red-600")}>{uploaded ? "Uploaded" : "Missing upload"}</p>
                    <p className={cn(approved ? "text-emerald-600" : "text-red-600")}>{approved ? "Approved" : "Pending approval"}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-text-tertiary">{reportMediaUrls.length > 0 ? `${reportMediaUrls.length} report image(s) attached.` : "No report image files found yet."}</p>
          </div>

          <div className="rounded-xl border border-border-light bg-surface-hover/30 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ownerApprovalChecked} onChange={(e) => setOwnerApprovalChecked(e.target.checked)} />
              <span className="text-xs text-text-secondary">{ownerAttestationText}</span>
            </label>
          </div>
          {!mandatoryChecksOk && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={forceApprovalChecked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setForceApprovalChecked(on);
                    if (!on) setForceApprovalReason("");
                  }}
                />
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  Force approve: allow Review & approve even when mandatory checks are incomplete.
                </span>
              </label>
              {forceApprovalChecked ? (
                <div>
                  <label className="block text-[10px] font-medium text-amber-800 dark:text-amber-200 mb-1.5">
                    Reason (required)
                  </label>
                  <textarea
                    value={forceApprovalReason}
                    onChange={(e) => setForceApprovalReason(e.target.value)}
                    rows={3}
                    required
                    placeholder="Explain why you are approving without completing all mandatory checks…"
                    className="w-full rounded-lg border border-amber-200/80 dark:border-amber-800/60 bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/40 resize-y min-h-[72px]"
                  />
                </div>
              ) : null}
            </div>
          )}
          <p className="text-xs text-text-tertiary">
            Approve updates the client invoice first, then attempts partner self-bill linkage, then moves the job to Awaiting payment or Completed &amp; paid.
          </p>
          {!mandatoryChecksOk && !forceApprovalChecked ? (
            <p className="text-xs text-red-600">
              Mandatory before approval: all phase reports uploaded + approved, and owner authorization checked.
            </p>
          ) : null}
          {!mandatoryChecksOk && forceApprovalChecked ? (
            <p className="text-xs text-amber-600">
              Force approve enabled: your reason is saved on the job and in command history.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              type="button"
              disabled={validatingComplete}
              onClick={() => {
                setValidateCompleteOpen(false);
                setOwnerApprovalChecked(false);
                setForceApprovalChecked(false);
                setForceApprovalReason("");
                setApprovalBilledHoursInput("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" loading={validatingComplete} disabled={!canSubmitApproval} onClick={() => void handleValidateAndComplete()}>
              {approvalMode === "review_approve" ? "Review & approve" : "Approve and continue"}
            </Button>
          </div>
        </div>
      </Modal>

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
              options={PUT_ON_HOLD_REASON_OPTIONS}
              onChange={(e) => {
                const preset = e.target.value;
                setPutOnHoldPreset(preset || null);
                if (!preset) return;
                if (preset === "Other") {
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
            Confirm arrival for the partner. If the saved arrival date is no longer in the future, you must pick a later date before resuming.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Arrival date *</label>
              <Input type="date" value={resumeArrivalDate} onChange={(e) => setResumeArrivalDate(e.target.value)} className="h-10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Arrival time *</label>
              <TimeSelect value={resumeArrivalTime} onChange={(v) => setResumeArrivalTime(v)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" disabled={resumeSaving} onClick={() => setResumeJobOpen(false)}>
              Back
            </Button>
            <Button variant="primary" size="sm" loading={resumeSaving} onClick={() => void confirmResumeJob()}>
              Resume job
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={cancelJobOpen}
        onClose={() => {
          if (!cancellingJob) {
            setCancelJobOpen(false);
            setCancelDetail("");
          }
        }}
        title="Cancel job"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">
            The assigned partner will be notified with the reason below. The same note stays on this job for your team.
          </p>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason</label>
            <select
              value={cancelPresetId}
              onChange={(e) => setCancelPresetId(e.target.value)}
              className="w-full h-10 rounded-lg border border-border bg-card text-sm text-text-primary px-3"
            >
              {OFFICE_JOB_CANCELLATION_REASONS.map((r) => (
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
            />
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" disabled={cancellingJob} onClick={() => { setCancelJobOpen(false); setCancelDetail(""); }}>
              Back
            </Button>
            <Button variant="danger" size="sm" loading={cancellingJob} onClick={() => void handleConfirmOfficeCancel()}>
              Cancel job
            </Button>
          </div>
        </div>
      </Modal>

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
        subtitle={job.reference ? `${job.reference} — switch fixed ↔ hourly` : "Switch fixed ↔ hourly"}
        size="md"
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-text-tertiary leading-snug">
            Hourly uses a Call Out type from Services (same as new job). Amounts, linked invoice, and partner cost update from the catalog. Fixed keeps your current labour totals unless you edit them in Finance.
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
              { value: "fixed", label: "Fixed" },
              { value: "hourly", label: "Hourly" },
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
                label="Type of work *"
                value={jobTypeEditFixedTitle}
                disabled={savingJobTypeEdit}
                onChange={(e) => setJobTypeEditFixedTitle(e.target.value)}
                options={jobTypeEditFixedSelectOptions}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Partner cost £</label>
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
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Confirm fixed values</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
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
        }}
        onSubmit={handleMoneyDrawerSubmit}
        submitting={moneySubmitting}
        stripeInvoices={jobInvoices}
        clientCashContext={jobMoneyClientCashContext}
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
                <span className="flex-1 text-text-tertiary">No partner</span>
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
                    <span className="flex-1 text-text-secondary font-medium">No partner</span>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Rate & cost</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPartnerAssignRateType("fixed")}
                className={cn(
                  "inline-flex h-9 items-center justify-center rounded-full border-[1.5px] px-3 text-xs font-bold transition-colors",
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
                  "inline-flex h-9 items-center justify-center rounded-full border-[1.5px] px-3 text-xs font-bold transition-colors",
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
                  onChange={(e) => setPartnerAssignServiceId(e.target.value)}
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
                {partnerAssignService ? (
                  <p className="text-xs text-text-tertiary">
                    Client rate: <span className="font-medium text-text-primary">{formatCurrency(Math.max(0, Number(partnerAssignService.hourly_rate) || 0))}/h</span>
                  </p>
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
            <div className="space-y-2 rounded-lg border border-border-light bg-surface-hover/30 p-2.5">
              {[
                { key: "extra", label: "Extra payout" },
                { key: "ccz", label: "CCZ" },
                { key: "parking", label: "Parking" },
                { key: "materials", label: "Materials" },
              ].map((row) => (
                <label key={row.key} className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                  <span>{row.label}</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={partnerAssignExtraInputs[row.key as keyof typeof partnerAssignExtraInputs]}
                    onChange={(e) =>
                      setPartnerAssignExtraInputs((prev) => ({
                        ...prev,
                        [row.key]: e.target.value,
                      }))
                    }
                    className="h-8 w-28 text-xs"
                    placeholder="0.00"
                  />
                </label>
              ))}
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
                      const clientRate = Math.max(0, Number(partnerAssignService.hourly_rate) || 0);
                      const partnerRate = Math.max(
                        0,
                        partnerHourlyRateFromCatalogBundle(partnerAssignService.partner_cost, partnerAssignService.default_hours),
                      );
                      const hourlyTotals = partnerAssignHourlyPreview;
                      partnerPatch.job_type = "hourly";
                      partnerPatch.catalog_service_id = partnerAssignService.id;
                      partnerPatch.hourly_client_rate = clientRate;
                      partnerPatch.hourly_partner_rate = partnerRate;
                      if (hourlyTotals) {
                        partnerPatch.billed_hours = hourlyTotals.billedHours;
                        partnerPatch.client_price = hourlyTotals.clientTotal;
                        partnerPatch.partner_cost = hourlyTotals.partnerTotal;
                      }
                    } else {
                      partnerPatch.job_type = "fixed";
                      partnerPatch.partner_cost = partnerAssignBaseCost;
                    }
                    partnerPatch.partner_cost = Math.round((Number(partnerPatch.partner_cost ?? 0) + extrasCombined) * 100) / 100;
                    partnerPatch.partner_extras_amount = extrasCombined;
                    partnerPatch.materials_cost = materialsExtra;
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
                  await handleJobUpdate(job.id, partnerPatch);
                  if (selectedPartnerId) {
                    setPartnerExtrasUiValue(extrasCombined);
                    setPartnerExtraBreakdownUi({
                      extra: partnerAssignExtraBreakdown.extra,
                      ccz: partnerAssignExtraBreakdown.ccz,
                      parking: partnerAssignExtraBreakdown.parking,
                    });
                    toast.success(`${selected?.company_name?.trim() || selected?.contact_name || "Partner"} assigned · ${formatCurrency(partnerAssignTotal)} partner cost`);
                  }
                  setPartnerModalOpen(false);
                } finally {
                  setSavingPartner(false);
                }
              }}
            >
              Assign & confirm
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
