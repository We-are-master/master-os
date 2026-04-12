"use client";

import type { JobDetailBundle } from "@/services/jobs";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatDistanceStrict } from "date-fns/formatDistanceStrict";
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
import {
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Search,
  Copy,
  FileText,
  Upload,
  ShieldCheck,
  Plus,
  ImagePlus,
  ExternalLink,
  AlertTriangle,
  CreditCard,
  RefreshCw,
  Timer,
  X,
  Pencil,
} from "lucide-react";
import { cn, formatCurrency, formatCurrencyPrecise, formatDate, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { getJob, getJobDetailBundle, updateJob } from "@/services/jobs";
import { uploadQuoteInviteImages } from "@/services/quote-invite-images";
import { listQuoteLineItems } from "@/services/quotes";
import { createSelfBillFromJob, getSelfBill, listSelfBillsLinkedToJob, syncSelfBillAfterJobChange } from "@/services/self-bills";
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
import type { CatalogService, Invoice, Job, JobPayment, Partner, QuoteLineItem, SelfBill } from "@/types/database";
import { listInvoicesLinkedToJob, updateInvoice } from "@/services/invoices";
import { getInvoiceDueDateIsoForClient } from "@/services/invoice-due-date";
import { createOrAppendJobInvoice } from "@/services/weekly-account-invoice";
import { getSupabase } from "@/services/base";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import {
  allConfiguredReportsApproved,
  canAdvanceJob,
  canApproveReport,
  canMarkReportUploaded,
  canSendReportAndRequestFinalPayment,
  getJobStatusActions,
  isJobInProgressStatus,
  isJobOnSiteWorkStatus,
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

const selfBillStatusConfig: Record<
  string,
  { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }
> = {
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
  const st = selfBillStatusConfig[sb.status] ?? { label: sb.status, variant: "default" as const };
  const partnerFieldBill = sb.bill_origin !== "internal";
  const paymentDueYmd =
    partnerFieldBill && sb.week_end?.trim() ? partnerFieldSelfBillPaymentDueDate(sb.week_end.trim()) : null;
  const weekLine =
    sb.week_start && sb.week_end
      ? `${sb.week_start} → ${sb.week_end}${sb.week_label ? ` (${sb.week_label})` : ""}`
      : sb.week_label ?? sb.period;
  const jobLabourOnBill = Math.round(partnerPaymentCap(job) * 100) / 100;
  const jobMaterialsOnBill = Math.round(Math.max(0, Number(job.materials_cost ?? 0)) * 100) / 100;
  const jobGrossOnBill = Math.round(partnerSelfBillGrossAmount(job) * 100) / 100;
  return (
    <div className="rounded-lg border border-border-light p-3 space-y-1.5">
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
        Week: {weekLine} · {sb.jobs_count} job{sb.jobs_count === 1 ? "" : "s"} on this bill
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
    </div>
  );
}

const JOB_FLOW_STEPS: { label: string; statuses: Job["status"][] }[] = [
  { label: "Booked", statuses: ["unassigned", "auto_assigning", "scheduled", "late"] },
  { label: "On site", statuses: ["in_progress_phase1", "in_progress_phase2", "in_progress_phase3", "on_hold"] },
  { label: "Final check", statuses: ["final_check", "need_attention"] },
  { label: "Awaiting payment", statuses: ["awaiting_payment"] },
  { label: "Completed", statuses: ["completed"] },
];

function jobFlowActiveStepIndex(status: Job["status"]): number {
  if (status === "cancelled") return -1;
  const i = JOB_FLOW_STEPS.findIndex((s) => s.statuses.includes(status));
  return i >= 0 ? i : 0;
}

function extractReportMediaUrls(notes: string | null | undefined): string[] {
  const text = notes ?? "";
  if (!text.trim()) return [];
  const hits = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return hits.filter((u) => /\.(png|jpe?g|webp|gif)$/i.test(u));
}

interface JobDetailClientProps {
  /**
   * Server-rendered job bundle (Phase 3 server-shell). When present, the
   * initial useEffect skips the network round-trip and hydrates state
   * synchronously from this payload.
   */
  initialBundle?: JobDetailBundle | null;
}

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
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<{ id: string; amount: number; type: string } | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [propertyEdit, setPropertyEdit] = useState<ClientAndAddressValue | null>(null);
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
  const [putOnHoldSaving, setPutOnHoldSaving] = useState(false);
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
  const [sitePhotoUploading, setSitePhotoUploading] = useState(false);
  const isAdmin = profile?.role === "admin";
  const jobRef = useRef<Job | null>(null);
  const autoOwnerFillRef = useRef<Set<string>>(new Set());
  const autoInvoiceEnsureRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

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
              status: "pending",
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
    const q = partnerPickerSearch.trim().toLowerCase();
    const eligible = partners.filter((p) => isPartnerEligibleForWork(p));
    if (!q) return eligible;
    return eligible.filter((p) => {
      const name = (p.company_name ?? p.contact_name ?? "").toLowerCase();
      const trade = (p.trade ?? "").toLowerCase();
      const loc = (p.location ?? "").toLowerCase();
      const tradesFlat = (p.trades ?? []).filter((t): t is string => typeof t === "string").join(" ").toLowerCase();
      return name.includes(q) || trade.includes(q) || loc.includes(q) || tradesFlat.includes(q);
    });
  }, [partners, partnerPickerSearch]);

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
    const patch: Partial<Job> = {
      job_type: "fixed",
      catalog_service_id: null,
      hourly_client_rate: null,
      hourly_partner_rate: null,
      billed_hours: null,
      title: titleOut,
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
      }
    } finally {
      setSavingJobTypeEdit(false);
    }
  }, [
    job,
    jobTypeEditTarget,
    jobTypeEditCatalogId,
    jobTypeEditFixedTitle,
    catalogServicesJobType,
    handleJobUpdate,
    profile?.id,
    profile?.full_name,
    refreshJobFinance,
  ]);

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
        setPutOnHoldOpen(false);
        setPutOnHoldReason("");
        try {
          await bumpLinkedInvoiceAmountsToJobSchedule(updated);
        } catch {
          /* non-blocking */
        }
      }
    } finally {
      setPutOnHoldSaving(false);
    }
  }, [job, putOnHoldReason, handleStatusChange]);

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
    const prev = (
      isJobOnSiteWorkStatus(prevRaw as Job["status"]) ? prevRaw : "in_progress_phase1"
    ) as Job["status"];
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
  }, [handleJobUpdate, handleStatusChange, customerPayments, partnerPayments]);

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

      /** Parallelize all reads needed before invoice/self-bill decisions — they're fully independent. */
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

      /** Invoice mutation and partner self-bill creation are independent — run them in parallel. */
      const invoicePromise: Promise<{ id: string | null; markPaid: boolean }> = (async () => {
        if (!primaryInvoiceId && customerDue > 0.02) {
          const inv = await createOrAppendJobInvoice(
            current,
            {
              client_name: current.client_name ?? "Client",
              amount: Math.max(0, customerDue),
              status: customerDue <= 0.02 ? "paid" : "pending",
              paid_date: customerDue <= 0.02 ? new Date().toISOString().slice(0, 10) : undefined,
              invoice_kind: "combined",
              collection_stage: customerDue <= 0.02 ? "completed" : "awaiting_final",
            },
            { financeAnchorDate },
          );
          return { id: inv.id, markPaid: inv.status === "paid" };
        }
        if (primaryInvoiceId && customerDue > 0.02 && !invoiceShowsPaidInDb) {
          // Keep linked invoice aligned with the latest approved totals (incl. hourly billed-hours changes).
          await updateInvoice(primaryInvoiceId, {
            amount: Math.max(0, customerDue),
            paid_date: undefined,
            collection_stage: "awaiting_final",
            due_date: dueForAnchor,
          });
          return { id: primaryInvoiceId, markPaid: false };
        }
        if (customerDue <= 0.02 && primaryInvoiceId) {
          await updateInvoice(primaryInvoiceId, {
            status: "paid",
            paid_date: new Date().toISOString().slice(0, 10),
            collection_stage: "completed",
          });
          return { id: primaryInvoiceId, markPaid: true };
        }
        return { id: primaryInvoiceId, markPaid: false };
      })();

      /** Partner self-bill: never block approval if the insert/lookup fails — log and continue. */
      const selfBillPromise: Promise<string | null> = (async () => {
        if (!wantsSelfBill) return current.self_bill_id ?? null;
        try {
          let primarySelfBillId = current.self_bill_id ?? null;
          if (!primarySelfBillId && linkedSelfBills.length > 0) {
            const pick =
              linkedSelfBills.find((s) => s.status === "accumulating") ??
              linkedSelfBills.find((s) => s.status === "pending_review") ??
              linkedSelfBills[linkedSelfBills.length - 1];
            primarySelfBillId = pick.id;
          }
          const shouldCreateSelfBill =
            partnerSelfBillGrossAmount(current) > 0 || partnerDue > 0.02;
          if (!primarySelfBillId && shouldCreateSelfBill) {
            const selfBill = await createSelfBillFromJob(
              {
                id: current.id,
                reference: current.reference,
                partner_name: current.partner_name ?? "Unassigned",
                partner_cost: current.partner_cost,
                materials_cost: current.materials_cost,
              },
              { weekAnchorDate: financeAnchorDate },
            );
            primarySelfBillId = selfBill.id;
          }
          return primarySelfBillId;
        } catch (e) {
          console.error("Review & approve: self-bill link failed", e);
          toast.warning(
            e instanceof Error
              ? e.message
              : "Partner self-bill could not be linked automatically; you can attach it later from Finance or this job.",
          );
          return current.self_bill_id ?? null;
        }
      })();

      const [invoiceResult, resolvedSelfBillId] = await Promise.all([invoicePromise, selfBillPromise]);

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
  const directCost =
    job.job_type === "hourly" && hourlyAutoBilling
      ? hourlyAutoBilling.partnerTotal + Number(job.materials_cost ?? 0)
      : jobDirectCost(job);
  const profit = billableRevenue - directCost;
  const marginPct = billableRevenue > 0 ? Math.round((profit / billableRevenue) * 1000) / 10 : 0;
  /** Transfers to partner only — excludes legacy rows that recorded extra payout as a payment (those are cost, not cash out). */
  const partnerPaidTotal = sumPartnerRecordedPayoutsForCap(partnerPayments);
  const partnerPayRemaining = Math.max(0, partnerCap - partnerPaidTotal);
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
  const cczFeeNominal = effectiveCustomerInCcz ? ACCESS_CCZ_FEE_GBP : 0;
  const parkingFeeNominal = job.has_free_parking === false ? ACCESS_PARKING_FEE_GBP : 0;
  const attributedAccessNominal = cczFeeNominal + parkingFeeNominal;
  const attributedAccessForExtrasLine = Math.min(attributedAccessNominal, explicitExtras);
  const extrasNetOfAccess = Math.max(0, Math.round((explicitExtras - attributedAccessForExtrasLine) * 100) / 100);
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
  const flowStep = jobFlowActiveStepIndex(job.status);
  const reportsApproved = allConfiguredReportsApproved(job);
  const phaseIndexes = reportPhaseIndices(phaseCount);
  const reportsUploaded = phaseIndexes.every((n) => Boolean(job[`report_${n}_uploaded` as keyof Job]));
  const reportMediaUrls = extractReportMediaUrls(job.report_notes);
  const timeSpentLabel = officeTimerDisplaySeconds != null
    ? formatOfficeTimer(officeTimerDisplaySeconds)
    : partnerLiveActiveMs != null
      ? formatPartnerLiveTimer(partnerLiveActiveMs)
      : formatOfficeTimer(Number(job.timer_elapsed_seconds ?? 0) || 0);
  const attestationDisplayName = profile?.full_name?.trim() || job.owner_name?.trim() || "Victor";
  const ownerAttestationText = `I, ${attestationDisplayName}, confirm I checked this report and I take full responsibility for report and payment approval for this job.`;
  const forcedPaidBySystemOwner = isJobForcePaid(job.internal_notes);
  const mandatoryChecksOk = reportsUploaded && reportsApproved && ownerApprovalChecked;
  const canSubmitApproval =
    mandatoryChecksOk || (forceApprovalChecked && forceApprovalReason.trim().length > 0);
  const customerPaidPct = billableRevenue > 0 ? Math.max(0, Math.min(100, (customerPaidTotal / billableRevenue) * 100)) : 100;
  const partnerPaidPct = partnerCap > 0 ? Math.max(0, Math.min(100, (partnerPaidTotal / partnerCap) * 100)) : 100;

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
  return (
    <PageTransition>
      <div className="space-y-5 pb-12">

        {/* ── HEADER ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push("/jobs")}>
            Back to Jobs
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={refreshingJob}
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void refreshJobFinance()}
            title="Reload job, payments, and documents from the server"
          >
            Refresh
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-text-primary">{job.reference}</h1>
              <Badge variant={config.variant} dot={config.dot} size="md">{config.label}</Badge>
              <JobOverdueBadge job={job} size="md" />
            </div>
            <p className="text-sm text-text-tertiary mt-0.5">{job.title}</p>
            {job.status === "cancelled" && job.partner_cancelled_at ? (
              <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-text-secondary max-w-xl">
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
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/8 px-3 py-2 text-xs text-text-secondary max-w-xl">
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
              <div className="mt-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-text-secondary max-w-xl">
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
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end sm:justify-start">
            {statusActions.map((action, idx) => {
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
                  className={cn(toneClass)}
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

        {job.status !== "cancelled" ? (
          <section
            className="rounded-xl bg-card overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_28px_-6px_rgba(0,0,0,0.45)]"
            aria-label="Work time and job progress"
          >
            <div className="px-3 py-2.5 sm:px-4 sm:py-3 space-y-2.5">
              {(officeTimerDisplaySeconds != null || partnerLiveActiveMs != null) && (
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        job.timer_is_running || (partnerLiveActiveMs != null && !job.partner_timer_ended_at && officeTimerDisplaySeconds == null)
                          ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                          : "bg-surface-tertiary/70 text-text-secondary",
                      )}
                      aria-hidden
                    >
                      <Timer className="h-4 w-4" strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium uppercase tracking-wide text-text-tertiary">Work time</p>
                      <p className="text-[11px] text-text-secondary truncate leading-tight">
                        {officeTimerDisplaySeconds != null
                          ? job.timer_is_running
                            ? "Timer running"
                            : job.status === "on_hold"
                              ? "On hold — use Resume job when ready"
                              : job.status === "scheduled" && (Number(job.timer_elapsed_seconds ?? 0) > 0)
                                ? "Paused — resume with Start Job"
                                : "Time recorded"
                          : job.partner_timer_ended_at
                            ? "On-site ended"
                            : "Live timer"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(job.partner_timer_is_paused && !job.partner_timer_ended_at && officeTimerDisplaySeconds == null) ||
                    job.status === "on_hold" ||
                    (officeTimerDisplaySeconds != null &&
                      !job.timer_is_running &&
                      job.status === "scheduled" &&
                      (Number(job.timer_elapsed_seconds ?? 0) > 0)) ? (
                      <Badge variant="warning" size="sm">
                        Paused
                      </Badge>
                    ) : null}
                    <span className="text-lg sm:text-xl font-semibold tabular-nums tracking-tight text-text-primary">
                      {officeTimerDisplaySeconds != null
                        ? formatOfficeTimer(officeTimerDisplaySeconds)
                        : formatPartnerLiveTimer(partnerLiveActiveMs!)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 mb-1.5">
                  <div className="flex items-baseline gap-2">
                    <p className="text-[9px] font-medium uppercase tracking-wide text-text-tertiary">Job progress</p>
                    <span className="text-[10px] text-text-secondary tabular-nums">
                      Step {Math.min(flowStep + 1, JOB_FLOW_STEPS.length)}/{JOB_FLOW_STEPS.length}
                    </span>
                  </div>
                  <span className="text-[10px] tabular-nums text-text-tertiary">
                    {Math.round(((flowStep + 1) / JOB_FLOW_STEPS.length) * 100)}%
                  </span>
                </div>

                <div className="relative h-1 rounded-full bg-surface-tertiary/60 dark:bg-surface-tertiary/40 mb-2 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 dark:bg-emerald-500 transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.min(100, ((flowStep + 1) / JOB_FLOW_STEPS.length) * 100)}%` }}
                  />
                </div>

                <div className="overflow-x-auto overscroll-x-contain -mx-0.5 px-0.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-subtle/80">
                  <ol className="flex min-w-max sm:min-w-0 sm:flex-wrap sm:justify-between items-stretch gap-0.5 sm:gap-0">
                    {JOB_FLOW_STEPS.map((step, idx) => {
                      const done = flowStep > idx;
                      const current = flowStep === idx;
                      return (
                        <li key={step.label} className="flex items-center shrink-0">
                          {idx > 0 ? (
                            <span
                              className={cn(
                                "hidden sm:block w-2 md:w-5 lg:w-8 h-px shrink-0 mx-0.5 self-center mt-[0.875rem]",
                                done ? "bg-emerald-400/60" : "bg-border-subtle/70",
                              )}
                              aria-hidden
                            />
                          ) : null}
                          <span
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-lg px-1.5 py-1 sm:px-2 min-w-[4.25rem] sm:min-w-0 max-w-[6.5rem] text-center transition-colors",
                              current && "bg-emerald-500/[0.08] text-text-primary ring-1 ring-emerald-500/20",
                              done && !current && "text-emerald-700 dark:text-emerald-400",
                              !done && !current && "text-text-tertiary/90",
                            )}
                          >
                            {done ? (
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/12">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                                  current
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25"
                                    : "bg-surface-tertiary/80 text-text-tertiary",
                                )}
                              >
                                {idx + 1}
                              </span>
                            )}
                            <span className="text-[9px] sm:text-[10px] font-medium leading-tight px-0.5 line-clamp-2">
                              {step.label}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>

              {officeTimerDisplaySeconds == null &&
              partnerLiveActiveMs == null &&
              (isJobInProgressStatus(job.status) || job.status === "awaiting_payment") ? (
                <p className="text-[10px] leading-snug text-text-tertiary pt-1">
                  <strong className="font-medium text-text-secondary">Start Job</strong> begins the timer;{" "}
                  <strong className="font-medium text-text-secondary">On Hold</strong> pauses on site (saved schedule);{" "}
                  <strong className="font-medium text-text-secondary">Complete Job</strong> records the total;{" "}
                  <strong className="font-medium text-text-secondary">Reopen</strong> then Start Job continues from that total.
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="text-sm text-text-tertiary">This job was cancelled — workflow stopped.</p>
        )}

        {/* ── Job amount / margin (same metrics as jobs board cards) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3">
          <div className="min-w-0 rounded-xl bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_18px_-4px_rgba(0,0,0,0.4)]">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Job amount</p>
            <p className="mt-1 text-base sm:text-lg font-bold text-text-primary tabular-nums leading-tight break-words">{formatCurrency(billableRevenue)}</p>
            <p className="text-[10px] text-text-tertiary mt-1 leading-snug">Incl. extras</p>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_18px_-4px_rgba(0,0,0,0.4)]">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Partner cost</p>
            <p className="mt-1 text-base sm:text-lg font-bold text-text-secondary tabular-nums leading-tight break-words">{formatCurrency(Number(job.partner_cost ?? 0))}</p>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_18px_-4px_rgba(0,0,0,0.4)]">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Margin</p>
            <p
              className={cn(
                "mt-1 text-base sm:text-lg font-bold tabular-nums leading-tight break-words",
                profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
              )}
            >
              {formatCurrency(profit)}
            </p>
            <p className="text-[10px] text-text-tertiary mt-1 leading-snug">After partner + materials</p>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_18px_-4px_rgba(0,0,0,0.4)]">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Margin %</p>
            <p
              className={cn(
                "mt-1 text-base sm:text-lg font-bold tabular-nums",
                marginPct >= 20 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
              )}
            >
              {marginPct}%
            </p>
          </div>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* ═══ LEFT — operational column ═══ */}
          <div className="lg:col-span-2 space-y-5">

            {/* MAP + CLIENT IDENTITY */}
            <div className="rounded-xl border border-border-light bg-card overflow-hidden">
              <div className="flex flex-col">
                <div className="relative w-full aspect-[5/2] min-h-[160px] max-h-[min(260px,42vw)] bg-surface-hover/30 border-b border-border-light">
                  <LocationMiniMap
                    address={job.property_address}
                    className="h-full w-full min-h-[160px]"
                    mapHeight="100%"
                    showAddressBelowMap={false}
                    lazy
                  />
                </div>
                <div className="p-4 sm:p-5 space-y-3">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> Client identity
                  </p>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-text-primary">{job.client_name}</p>
                      <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{job.property_address}</p>
                    </div>
                    {!isHousekeepJobDetail ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" size="sm" className="font-medium">
                          {job.job_type === "hourly" ? "Hourly" : "Fixed"}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-text-secondary"
                          disabled={job.status === "cancelled"}
                          onClick={() => {
                            setJobTypeEditTarget(job.job_type === "hourly" ? "hourly" : "fixed");
                            setJobTypeEditCatalogId(job.catalog_service_id ?? "");
                            setJobTypeEditFixedTitle(job.title ?? "");
                            setJobTypeEditOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden />
                          Edit
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border-light">
                    <div>
                      <p className="text-[10px] text-text-tertiary">Start date</p>
                      <Input
                        type="date"
                        value={scheduleDate}
                        disabled={job.status === "cancelled"}
                        className="mt-0.5 h-9 text-sm"
                        onChange={(e) => {
                          const v = e.target.value;
                          setScheduleDate(v);
                          if (!v.trim()) setScheduleExpectedFinishDate("");
                          handleScheduleChange(job, v, scheduleTime, scheduleWindowMins, v.trim() ? scheduleExpectedFinishDate : "");
                        }}
                      />
                    </div>
                    <div>
                      <TimeSelect
                        label="Arrival time (from)"
                        value={scheduleTime}
                        disabled={job.status === "cancelled"}
                        className="mt-0.5"
                        onChange={(v) => { setScheduleTime(v); handleScheduleChange(job, scheduleDate, v, scheduleWindowMins, scheduleExpectedFinishDate); }}
                      />
                    </div>
                    <Select
                      label="Arrival window length"
                      value={scheduleWindowMins}
                      disabled={job.status === "cancelled"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setScheduleWindowMins(v);
                        handleScheduleChange(job, scheduleDate, scheduleTime, v, scheduleExpectedFinishDate);
                      }}
                      options={[...ARRIVAL_WINDOW_OPTIONS]}
                    />
                    <div>
                      <p className="text-[10px] text-text-tertiary">
                        Expected finish (date only){scheduleDate.trim() ? " *" : ""}
                      </p>
                      <Input
                        type="date"
                        value={scheduleExpectedFinishDate}
                        disabled={job.status === "cancelled"}
                        className="mt-0.5 h-9 text-sm"
                        onChange={(e) => { setScheduleExpectedFinishDate(e.target.value); handleScheduleChange(job, scheduleDate, scheduleTime, scheduleWindowMins, e.target.value); }}
                      />
                    </div>
                  </div>
                  {clientVisibleArrivalPreview ? (
                    <p className="text-[11px] font-medium text-text-secondary -mt-1">{clientVisibleArrivalPreview}</p>
                  ) : null}
                  <p className="text-[10px] text-text-tertiary -mt-1">
                    Window end = start time + length (often 2–3 hours). That range is what clients and partners see as arrival time. Expected finish is calendar-only (no time); late is still based on window end.
                  </p>
                  <div className="pt-1 border-t border-border-light">
                    {job.client_id && propertyEdit ? (
                      <div className={cn("space-y-2", job.status === "cancelled" && "pointer-events-none opacity-50")}>
                        <ClientAddressPicker
                          value={propertyEdit}
                          onChange={setPropertyEdit}
                          labelClient="Client"
                          labelAddress="Property address"
                          jobCurrentAddressOnly
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
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <AddressAutocomplete value={unlinkedAddressDraft} onChange={setUnlinkedAddressDraft} onSelect={(p) => setUnlinkedAddressDraft(p.full_address)} label="Property address" placeholder="Type address or postcode…" />
                        <Button type="button" variant="outline" size="sm" loading={savingUnlinkedAddress} onClick={handleSaveUnlinkedProperty}>Save address</Button>
                      </div>
                    )}
                  </div>
                  {!isHousekeepJobDetail && (
                    <div className="pt-3 border-t border-border-light space-y-2">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Congestion charge (CCZ)</p>
                      <p className="text-[11px] text-text-tertiary leading-snug">
                        CCZ is only available for central London postcodes (TfL Congestion Charge / Zone&nbsp;1 core: EC1–4, WC1–2, W1, SW1, SE1). Outside that list the control stays off. Inside the list you still choose whether to apply the +£15 fee — it is not turned on automatically.
                      </p>
                      {!cczEligibleAddress && job.in_ccz ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          This job has CCZ enabled in the database, but the current address is outside the central London postcode list — no CCZ surcharge is applied until you save an eligible address and turn CCZ on.
                        </p>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={
                            job.status === "cancelled" ||
                            savingAccessFees ||
                            (!cczEligibleAddress && !job.in_ccz)
                          }
                          onClick={() => {
                            if (cczEligibleAddress) void saveAccessFeeFlags({ in_ccz: !Boolean(job.in_ccz) });
                            else if (job.in_ccz) void saveAccessFeeFlags({ in_ccz: false });
                          }}
                          className={cn(
                            "rounded-lg border px-2.5 py-2 text-left transition-colors",
                            !cczEligibleAddress && !job.in_ccz && "opacity-50 cursor-not-allowed",
                            effectiveCustomerInCcz ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card text-text-secondary",
                          )}
                        >
                          <p className="font-medium text-xs">
                            {!cczEligibleAddress && job.in_ccz
                              ? "Clear CCZ (outside zone)"
                              : !cczEligibleAddress
                                ? "CCZ (central London only)"
                                : effectiveCustomerInCcz
                                  ? "CCZ fee applied"
                                  : "Apply CCZ"}
                          </p>
                          <p className="text-[10px] opacity-80 mt-0.5">
                            {!cczEligibleAddress && !job.in_ccz
                              ? "Postcode not in CCZ list"
                              : !cczEligibleAddress && job.in_ccz
                                ? "Tap to turn off stored flag"
                                : effectiveCustomerInCcz
                                  ? "+£15 on access bundle"
                                  : "No CCZ charge"}
                          </p>
                        </button>
                        <button
                          type="button"
                          disabled={job.status === "cancelled" || savingAccessFees}
                          onClick={() => void saveAccessFeeFlags({ has_free_parking: !Boolean(job.has_free_parking) })}
                          className={cn(
                            "rounded-lg border px-2.5 py-2 text-left transition-colors",
                            !job.has_free_parking ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card text-text-secondary",
                          )}
                        >
                          <p className="font-medium text-xs">{job.has_free_parking ? "Free parking on site" : "Parking fee applied"}</p>
                          <p className="text-[10px] opacity-80 mt-0.5">{job.has_free_parking ? "No parking charge" : "+£15 on access bundle"}</p>
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {job.quote_id && <Link href="/quotes" className="inline-flex items-center gap-1 text-primary hover:underline">Quote <ExternalLink className="h-3 w-3" /></Link>}
                    {job.self_bill_id && <Link href="/finance/selfbill" className="inline-flex items-center gap-1 text-primary hover:underline">Self-bill <ExternalLink className="h-3 w-3" /></Link>}
                    {job.invoice_id && <Link href="/finance/invoices" className="inline-flex items-center gap-1 text-primary hover:underline">Invoice <ExternalLink className="h-3 w-3" /></Link>}
                  </div>
                </div>
              </div>
            </div>

            {/* SCOPE + SITE PHOTOS */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope of work & site photos</p>
              <p className="text-[11px] text-text-tertiary">Scope is required before assigning a partner. Site photos come from the request/quote or uploads here.</p>

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

              <div className="space-y-2 pt-1 border-t border-border-light">
                <p className="text-xs font-medium text-text-secondary">Scope</p>
                <textarea
                  value={scopeDraft}
                  onChange={(e) => setScopeDraft(e.target.value)}
                  rows={5}
                  placeholder="Describe what the partner is expected to do…"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-y min-h-[100px]"
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

              <div className="space-y-2 pt-3 border-t border-border-light">
                <p className="text-xs font-medium text-text-secondary">Additional notes</p>
                <p className="text-[11px] text-text-tertiary">Internal only — not shown to the client; use for access, keys, or context beyond the scope.</p>
                <textarea
                  value={additionalNotesDraft}
                  onChange={(e) => setAdditionalNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Parking, entry, preferences…"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-y min-h-[72px]"
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

              <div className="space-y-2 pt-3 border-t border-border-light">
                <p className="text-xs font-medium text-text-secondary">Report link (optional)</p>
                <p className="text-[11px] text-text-tertiary">External URL — Google Drive, Notion, shared doc. Not shown to the client.</p>
                <Input
                  type="url"
                  value={reportLinkDraft}
                  onChange={(e) => setReportLinkDraft(e.target.value)}
                  placeholder="https://…"
                  className="h-10"
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

            {/* REPORTS */}
            <div className="rounded-xl border border-border-light bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <div key={n} className={`rounded-xl border p-4 space-y-2 ${approved ? "border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/20" : uploaded ? "border-amber-200 bg-amber-50/30 dark:bg-amber-950/10" : "border-border-light bg-surface-hover/40"}`}>
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
              <div className="mt-3 flex items-center justify-between gap-2">
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
                <div className="mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
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
              <summary className="flex list-none items-center justify-between gap-3 p-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0" /> Manual report analysis (AI)
                </p>
                <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-3 border-t border-border-light px-4 pb-4 pt-4">
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

            {/* FINANCIAL SETUP (admin edit) */}
            <details className="group rounded-xl border border-border-light bg-card overflow-hidden">
              <summary className="flex items-center justify-between p-4 cursor-pointer select-none">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Financial setup</p>
                <ChevronDown className="h-4 w-4 text-text-tertiary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 space-y-4 border-t border-border-light pt-4">
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

          </div>

          {/* ═══ RIGHT — partner + financial + history ═══ */}
          <div className="space-y-5">

            {/* PRIMARY PARTNER */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Primary partner</p>
                <Button size="sm" variant="outline" onClick={() => setPartnerModalOpen(true)}>
                  {job.partner_id ? "Swap partner" : "Assign"}
                </Button>
              </div>
              {job.partner_name ? (
                <div className="flex items-center gap-3">
                  <Avatar name={job.partner_name} size="lg" />
                  <div>
                    <p className="text-sm font-bold text-text-primary">{job.partner_name}</p>
                    <p className="text-xs text-text-tertiary">{job.partner_id ? `ID: ${job.partner_id.slice(0, 8)}…` : "No partner ID"}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-2">
                  <div className="h-10 w-10 rounded-full bg-surface-hover border border-border-light flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-text-tertiary" />
                  </div>
                  <p className="text-sm text-text-tertiary italic">Unassigned</p>
                </div>
              )}
              {/* job owner */}
              <div className="pt-2 border-t border-border-light">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Job owner</p>
                {isAdmin ? (
                  <JobOwnerSelect value={job.owner_id} fallbackName={job.owner_name} users={assignableUsers} disabled={savingOwner}
                    onChange={async (ownerId) => { const owner = assignableUsers.find((u) => u.id === ownerId); setSavingOwner(true); try { await handleJobUpdate(job.id, { owner_id: ownerId, owner_name: owner?.full_name }); } finally { setSavingOwner(false); } }}
                  />
                ) : job.owner_name ? (
                  <div className="flex items-center gap-2"><Avatar name={job.owner_name} size="sm" /><p className="text-sm font-medium text-text-primary">{job.owner_name}</p></div>
                ) : (
                  <p className="text-sm text-text-tertiary italic">No owner</p>
                )}
              </div>
            </div>

            {/* FINANCIAL COMPLETION */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-4">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> Finance summary
              </p>

              {/* CLIENT cash in */}
              <div>
                <div className="flex items-center justify-between mb-3 gap-2">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Client (cash in)</p>
                  <div className="text-right min-w-0">
                    <p className="text-[10px] text-text-tertiary">Total job value</p>
                    <p
                      className="text-base font-bold tabular-nums text-text-primary"
                      title="Extra charge / CCZ / parking change this total and the invoice. Record Payment only reduces amount due."
                    >
                      {formatCurrency(billableRevenue)}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {quoteLineBreakdown && (
                    <div className="rounded-lg border border-border-light bg-surface-hover/30 p-2.5 space-y-2">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
                        From quote lines
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                        <div className="rounded-md border border-border bg-card px-2 py-1.5">
                          <p className="text-[10px] text-text-tertiary uppercase">Labour</p>
                          <p className="text-xs font-semibold tabular-nums">{formatCurrency(quoteLineBreakdown.totals.labour)}</p>
                        </div>
                        <div className="rounded-md border border-border bg-card px-2 py-1.5">
                          <p className="text-[10px] text-text-tertiary uppercase">Materials</p>
                          <p className="text-xs font-semibold tabular-nums">{formatCurrency(quoteLineBreakdown.totals.materials)}</p>
                        </div>
                        <div className="rounded-md border border-border bg-card px-2 py-1.5">
                          <p className="text-[10px] text-text-tertiary uppercase">Other</p>
                          <p className="text-xs font-semibold tabular-nums">{formatCurrency(quoteLineBreakdown.totals.other)}</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {quoteLineBreakdown.lines.slice(0, 4).map((line) => (
                          <div key={line.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-text-secondary truncate">{line.description}</span>
                            <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(line.total)}</span>
                          </div>
                        ))}
                        {quoteLineBreakdown.lines.length > 4 && (
                          <p className="text-[10px] text-text-tertiary">+{quoteLineBreakdown.lines.length - 4} more line(s)</p>
                        )}
                      </div>
                    </div>
                  )}
                  {(job.customer_deposit ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">Upfront deposit</span>
                        <Badge variant={job.customer_deposit_paid ? "success" : "warning"} size="sm">{job.customer_deposit_paid ? "Paid" : "Pending"}</Badge>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(job.customer_deposit ?? 0)}</span>
                    </div>
                  )}
                  {(job.customer_final_payment ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-primary">Final balance</span>
                          <Badge variant={job.customer_final_paid ? "success" : "default"} size="sm">{job.customer_final_paid ? "Paid" : "Pending"}</Badge>
                        </div>
                        <div className="text-[11px] text-text-tertiary space-y-1 pl-0.5">
                          <p>Labour {formatCurrency(finalLabour)}</p>
                          <p>Materials {formatCurrency(finalMaterials)}</p>
                          <p
                            className={
                              finalExtraCharges > 0.02
                                ? "text-emerald-700 dark:text-emerald-500/90 font-medium"
                                : ""
                            }
                          >
                            Extra charges{" "}
                            {finalExtraCharges > 0.02 ? "+" : ""}
                            {formatCurrency(finalExtraCharges)}
                          </p>
                          {effectiveCustomerInCcz ? (
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={
                                  finalCczLine > 0.02
                                    ? "text-emerald-700 dark:text-emerald-500/90 font-medium"
                                    : ""
                                }
                              >
                                CCZ (congestion) {finalCczLine > 0.02 ? "+" : ""}
                                {formatCurrency(finalCczLine)}
                              </span>
                              {job.status !== "cancelled" ? (
                                <button
                                  type="button"
                                  disabled={savingAccessFees}
                                  onClick={() => void saveAccessFeeFlags({ in_ccz: false })}
                                  className="shrink-0 text-[10px] font-medium text-red-500 hover:text-red-600 hover:underline disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {job.has_free_parking === false ? (
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={
                                  finalParkingLine > 0.02
                                    ? "text-emerald-700 dark:text-emerald-500/90 font-medium"
                                    : ""
                                }
                              >
                                Parking access {finalParkingLine > 0.02 ? "+" : ""}
                                {formatCurrency(finalParkingLine)}
                              </span>
                              {job.status !== "cancelled" ? (
                                <button
                                  type="button"
                                  disabled={savingAccessFees}
                                  onClick={() => void saveAccessFeeFlags({ has_free_parking: true })}
                                  className="shrink-0 text-[10px] font-medium text-red-500 hover:text-red-600 hover:underline disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {!effectiveCustomerInCcz && job.has_free_parking !== false ? (
                            <p>CCZ / Parking {formatCurrency(0)}</p>
                          ) : null}
                        </div>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(job.customer_final_payment ?? 0)}</span>
                    </div>
                  )}
                  {/* Payment history */}
                  {customerPayments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-1">Payment history</p>
                      {customerPayments.map((p) => {
                        const ledgerTag = parseJobPaymentLedgerLabel(p.note);
                        const noteRest = jobPaymentNoteWithoutLedgerPrefix(p.note);
                        const scheduleTag = p.type === "customer_deposit" ? "Scheduled deposit" : "Final balance";
                        return (
                        <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-hover/40 px-2.5 py-2">
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
                            <span className="text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300" title="Reduces amount due">
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
                  )}
                  <div className="flex items-center justify-between pt-1.5 border-t border-border-light">
                    <span className={`text-xs font-semibold ${amountDue > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {amountDue > 0 ? "Amount due" : "Fully collected"}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${amountDue > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {amountDue > 0 ? formatCurrency(amountDue) : formatCurrency(0)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setMoneyDrawerFlow("client_pay");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Record Payment
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setMoneyDrawerFlow("client_extra");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Add extra charge
                  </Button>
                </div>
              </div>

              {/* Cash out (partner payout) */}
              <div className="pt-3 border-t border-border-light">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Cash Out</p>
                  <div className="text-right min-w-0">
                    <p className="text-[10px] text-text-tertiary">Total to pay</p>
                    <p
                      className="text-base font-bold tabular-nums text-text-primary"
                      title="Record Payment reduces amount due only. Add extra payout increases this total and self-bill."
                    >
                      {formatCurrency(partnerCap)}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">
                          {partnerCashOutExtra > 0.02 ? "Partner labour" : "Partner cost"}
                        </span>
                        <Badge variant={partnerPaidTotal >= partnerCap && partnerCap > 0 ? "success" : partnerPaidTotal > 0 ? "warning" : "default"} size="sm">
                          {partnerPaidTotal >= partnerCap && partnerCap > 0 ? "Paid" : partnerPaidTotal > 0 ? "Partial" : "Pending"}
                        </Badge>
                      </div>
                      {partnerCashOutExtra > 0.02 ? (
                        <div className="text-[11px] text-text-tertiary space-y-1 pl-0.5">
                          <p>
                            {job.job_type === "hourly" ? "Labour (hourly)" : "Labour"}{" "}
                            {formatCurrency(partnerCashOutBase)}
                          </p>
                          <p className="text-emerald-700 dark:text-emerald-500/90 font-medium">
                            Extra payout +{formatCurrency(partnerCashOutExtra)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <span className="text-sm font-semibold tabular-nums shrink-0 pt-0.5">{formatCurrency(partnerCap)}</span>
                  </div>
                  {/* Partner payment history: always show header when there is a partner cost so empty state is visible */}
                  {partnerCap > 0.02 && (
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
                                    className="text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300"
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
                  {partnerCap > 0 && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-border-light">
                      <span className={`text-xs font-semibold ${partnerPayRemaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {partnerPayRemaining > 0 ? "Amount due" : "Fully paid out"}
                      </span>
                      <span className={`text-sm font-bold tabular-nums ${partnerPayRemaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {partnerPayRemaining > 0 ? formatCurrency(partnerPayRemaining) : formatCurrency(0)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={!job.partner_id?.trim()}
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setMoneyDrawerFlow("partner_pay");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Record Payment
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={!job.partner_id?.trim()}
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setMoneyDrawerFlow("partner_extra");
                      setMoneyDrawerOpen(true);
                    }}
                  >
                    Add extra payout
                  </Button>
                </div>
              </div>

              {/* Net margin */}
              <div className="pt-3 border-t border-border-light flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Net margin</p>
                  <p className="text-lg font-bold text-text-primary tabular-nums">{formatCurrency(profit)}</p>
                </div>
                <p className={`text-xl font-bold tabular-nums ${marginPct >= 20 ? "text-emerald-600" : "text-amber-600"}`}>{marginPct}%</p>
              </div>

              {/* Fully paid */}
              {job.customer_final_paid && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700">Job fully paid</p>
                </div>
              )}
            </div>

            {/* Financial documents: client invoices (us→client) + partner self-bill (partner→us, weekly Mon–Sun) */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Financial documents</p>
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
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Client invoices</p>
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
                        <div key={inv.id} className="rounded-lg border border-border-light p-3">
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

              <div className="space-y-2 pt-2 border-t border-border-light">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner self-bill</p>
                  <p className="text-[11px] text-text-tertiary leading-snug">
                    The <strong className="font-medium text-text-secondary">partner</strong> bills us. Amounts roll into one weekly self bill per partner (Monday–Sunday); this job shares that bill with other jobs in the same week.
                  </p>
                  {!job.partner_id?.trim() ? (
                    <p className="text-xs text-text-tertiary">Assign a partner on this job to use self billing.</p>
                  ) : loadingSelfBill ? (
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

            {/* COMMAND HISTORY */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Command history</p>
              <AuditTimeline entityType="job" entityId={job.id} deferUntilVisible />
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
        <div className="p-6 space-y-5">
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
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason *</label>
            <textarea
              value={putOnHoldReason}
              onChange={(e) => setPutOnHoldReason(e.target.value)}
              rows={3}
              placeholder="Why is this job on hold?"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[72px]"
            />
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" disabled={putOnHoldSaving} onClick={() => { setPutOnHoldOpen(false); setPutOnHoldReason(""); }}>
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
            <Select
              label="Type of work *"
              value={jobTypeEditFixedTitle}
              disabled={savingJobTypeEdit}
              onChange={(e) => setJobTypeEditFixedTitle(e.target.value)}
              options={jobTypeEditFixedSelectOptions}
            />
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
                    partnersFilteredForPicker.map((p) => {
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
                          }}
                        >
                          <Avatar name={name} size="sm" className="shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-text-primary truncate">{name}</p>
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
              loading={savingPartner || loadingPartners}
              onClick={async () => {
                const selected = partners.find((p) => p.id === selectedPartnerId);
                setSavingPartner(true);
                try {
                  const partnerPatch: Partial<Job> = {
                    partner_id: selectedPartnerId || null,
                    partner_name: selectedPartnerId
                      ? (selected?.company_name?.trim() || selected?.contact_name || null)
                      : null,
                    partner_ids: selectedPartnerId ? [selectedPartnerId] : [],
                  };
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
                  setPartnerModalOpen(false);
                } finally {
                  setSavingPartner(false);
                }
              }}
            >
              Save partner
            </Button>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
