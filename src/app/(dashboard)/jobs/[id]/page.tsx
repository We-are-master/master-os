"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Copy,
  FileText,
  Upload,
  ShieldCheck,
  Plus,
  ExternalLink,
  AlertTriangle,
  CreditCard,
  RefreshCw,
  Timer,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { getJob, updateJob } from "@/services/jobs";
import { createSelfBillFromJob } from "@/services/self-bills";
import { listJobPayments, createJobPayment, deleteJobPayment } from "@/services/job-payments";
import { listAssignableUsers, type AssignableUser } from "@/services/profiles";
import { listPartners } from "@/services/partners";
import { uploadManualJobReport } from "@/services/job-report-storage";
import { useProfile } from "@/hooks/use-profile";
import { logAudit, logFieldChanges } from "@/services/audit";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Avatar } from "@/components/ui/avatar";
import { JobOwnerSelect } from "@/components/ui/job-owner-select";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import type { Invoice, Job, JobPayment, JobPaymentType, Partner } from "@/types/database";
import { listInvoicesLinkedToJob } from "@/services/invoices";
import {
  allConfiguredReportsApproved,
  canAdvanceJob,
  canApproveReport,
  canMarkReportUploaded,
  canSendReportAndRequestFinalPayment,
  getJobStatusActions,
  isJobInProgressStatus,
  normalizeTotalPhases,
  reportPhaseIndices,
  reportPhaseLabel,
} from "@/lib/job-phases";
import {
  jobBillableRevenue,
  jobDirectCost,
  jobProfit,
  jobMarginPercent,
  deriveStoredJobFinancials,
  partnerPaymentCap,
  customerScheduledTotal,
} from "@/lib/job-financials";
import { notifyAssignedPartnerAboutJob, updatesOnlyIrrelevantToPartner } from "@/lib/notify-partner-job-push";
import { getPartnerAssignmentBlockReason } from "@/lib/job-partner-assign";
import {
  computePartnerLiveTimerActiveMs,
  formatPartnerLiveTimer,
  isPartnerLiveTimerRunning,
  officePartnerTimerStartPatch,
} from "@/lib/partner-live-timer";
import { ARRIVAL_WINDOW_OPTIONS, scheduledEndFromWindow, snapArrivalWindowMinutes } from "@/lib/job-arrival-window";
import {
  OFFICE_JOB_CANCELLATION_REASONS,
  buildOfficeCancellationReasonText,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  unassigned: { label: "Unassigned", variant: "warning", dot: true },
  scheduled: { label: "Scheduled", variant: "info", dot: true },
  late: { label: "Late", variant: "danger", dot: true },
  in_progress_phase1: { label: "In Progress", variant: "primary", dot: true },
  in_progress_phase2: { label: "In Progress", variant: "primary", dot: true },
  in_progress_phase3: { label: "In Progress", variant: "primary", dot: true },
  final_check: { label: "Final Check", variant: "warning", dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: "danger", dot: true },
  need_attention: { label: "Need attention", variant: "warning", dot: true },
  completed: { label: "Completed", variant: "success", dot: true },
  cancelled: { label: "Cancelled", variant: "danger", dot: true },
};


export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const { profile } = useProfile();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  /** Preset minutes after arrival-from for window end (replaces manual “arrival to” time). */
  const [scheduleWindowMins, setScheduleWindowMins] = useState("");
  /** Civil end day for calendar (`scheduled_finish_date`). */
  const [scheduleExpectedFinishDate, setScheduleExpectedFinishDate] = useState("");
  const [partnerPayments, setPartnerPayments] = useState<JobPayment[]>([]);
  const [customerPayments, setCustomerPayments] = useState<JobPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const [addPaymentType, setAddPaymentType] = useState<JobPaymentType>("partner");
  const [addPaymentMethod, setAddPaymentMethod] = useState<"stripe" | "bank_transfer">("bank_transfer");
  const [addPaymentAmount, setAddPaymentAmount] = useState("");
  const [addPaymentDate, setAddPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addPaymentNote, setAddPaymentNote] = useState("");
  const [addPaymentBankRef, setAddPaymentBankRef] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<{ id: string; amount: number; type: string } | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [propertyEdit, setPropertyEdit] = useState<ClientAndAddressValue | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [unlinkedAddressDraft, setUnlinkedAddressDraft] = useState("");
  const [savingUnlinkedAddress, setSavingUnlinkedAddress] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [cancelJobOpen, setCancelJobOpen] = useState(false);
  const [cancelPresetId, setCancelPresetId] = useState<string>(OFFICE_JOB_CANCELLATION_REASONS[0].id);
  const [cancelDetail, setCancelDetail] = useState("");
  const [cancellingJob, setCancellingJob] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [savingPartner, setSavingPartner] = useState(false);
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const partnerPickerRef = useRef<HTMLDivElement>(null);
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
  const [jobInvoices, setJobInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [syncingInvoiceId, setSyncingInvoiceId] = useState<string | null>(null);
  const [manualReportFile, setManualReportFile] = useState<File | null>(null);
  const [manualReportNotes, setManualReportNotes] = useState("");
  const [manualReportResult, setManualReportResult] = useState("");
  const [analyzingManualReport, setAnalyzingManualReport] = useState(false);
  const [phaseReportFiles, setPhaseReportFiles] = useState<Record<number, File | null>>({});
  const [analyzingPhase, setAnalyzingPhase] = useState<number | null>(null);
  const [scopeDraft, setScopeDraft] = useState("");
  const [savingScope, setSavingScope] = useState(false);
  const isAdmin = profile?.role === "admin";
  const jobRef = useRef<Job | null>(null);
  const autoOwnerFillRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const [partnerTimerTick, setPartnerTimerTick] = useState(0);
  useEffect(() => {
    if (!job || !isPartnerLiveTimerRunning(job)) return;
    const t = window.setInterval(() => setPartnerTimerTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [job?.partner_timer_started_at, job?.partner_timer_ended_at, job?.id]);

  useEffect(() => {
    if (!id || !job || !isPartnerLiveTimerRunning(job)) return;
    const poll = window.setInterval(async () => {
      try {
        const j = await getJob(id);
        if (j) setJob(j);
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => window.clearInterval(poll);
  }, [id, job?.partner_timer_started_at, job?.partner_timer_ended_at]);

  const partnerLiveActiveMs = useMemo(() => {
    void partnerTimerTick;
    if (!job?.partner_timer_started_at) return null;
    return computePartnerLiveTimerActiveMs(job);
  }, [job, partnerTimerTick]);

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
      const rows = await listInvoicesLinkedToJob(j.reference, j.invoice_id);
      setJobInvoices(rows);
    } catch {
      toast.error("Failed to load invoices");
      setJobInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const refreshJobFinance = useCallback(async () => {
    if (!id) return;
    try {
      const j = await getJob(id);
      setJob(j);
      if (j) {
        await Promise.all([loadPayments(j.id), loadJobInvoices(j)]);
      }
    } catch {
      toast.error("Failed to refresh");
    }
  }, [id, loadPayments, loadJobInvoices]);

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
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [j, all] = await Promise.all([
          getJob(id),
          listJobPayments(id),
        ]);
        if (cancelled) return;
        setJob(j ?? null);
        setPartnerPayments(all.filter((p) => p.type === "partner"));
        setCustomerPayments(all.filter((p) => p.type === "customer_deposit" || p.type === "customer_final"));
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
    if (!job?.reference?.trim()) {
      setJobInvoices([]);
      return;
    }
    void loadJobInvoices(job);
  }, [job?.id, job?.reference, job?.invoice_id, job?.updated_at, loadJobInvoices]);

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
    setScheduleExpectedFinishDate(job?.scheduled_finish_date?.slice(0, 10) ?? "");
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

  const handleJobUpdate = useCallback(async (jobId: string, updates: Partial<Job>, opts?: { notifyPartner?: boolean }) => {
    const current = jobRef.current;
    try {
      let payload: Partial<Job> = { ...updates };
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
          return;
        }
      }
      const updated = await updateJob(jobId, payload);
      setJob(updated);
      toast.success("Job updated");

      const wantNotify = opts?.notifyPartner !== false && !updatesOnlyIrrelevantToPartner(updates);
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
    } catch {
      toast.error("Failed to update");
    }
  }, []);

  const handleSaveFinancials = useCallback(async () => {
    if (!job) return;
    setSavingFin(true);
    try {
      const r2 = (s: string) => Math.round((parseFloat(s) || 0) * 100) / 100;
      const client_price = r2(finForm.client_price);
      const extras_amount = r2(finForm.extras_amount);
      const partner_cost = r2(finForm.partner_cost);
      const materials_cost = r2(finForm.materials_cost);
      const partner_agreed_value = r2(finForm.partner_agreed_value);
      const customer_deposit = r2(finForm.customer_deposit);
      const customer_final_payment = r2(finForm.customer_final_payment);
      const newFields = { client_price, extras_amount, partner_cost, materials_cost, partner_agreed_value, customer_deposit, customer_final_payment };
      await handleJobUpdate(job.id, newFields);
      await logFieldChanges(
        "job", job.id, job.reference,
        job as unknown as Record<string, unknown>,
        newFields as Record<string, unknown>,
        profile?.id, profile?.full_name,
      );
    } finally {
      setSavingFin(false);
    }
  }, [job, finForm, handleJobUpdate, profile?.id, profile?.full_name]);

  const handleSaveLinkedProperty = useCallback(async () => {
    if (!job || !propertyEdit?.property_address?.trim()) {
      toast.error("Property address is required");
      return;
    }
    setSavingProperty(true);
    try {
      await handleJobUpdate(job.id, {
        property_address: propertyEdit.property_address.trim(),
        client_address_id: propertyEdit.client_address_id,
      });
    } finally {
      setSavingProperty(false);
    }
  }, [job, propertyEdit, handleJobUpdate]);

  const handleSaveUnlinkedProperty = useCallback(async () => {
    if (!job || !unlinkedAddressDraft.trim()) {
      toast.error("Property address is required");
      return;
    }
    setSavingUnlinkedAddress(true);
    try {
      await handleJobUpdate(job.id, { property_address: unlinkedAddressDraft.trim() });
    } finally {
      setSavingUnlinkedAddress(false);
    }
  }, [job, unlinkedAddressDraft, handleJobUpdate]);

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

  const handleStatusChange = useCallback(async (j: Job, newStatus: Job["status"]) => {
    const check = canAdvanceJob(j, newStatus, {
      customerPayments: customerPayments.map((p) => ({ type: p.type, amount: p.amount })),
      partnerPayments: partnerPayments.map((p) => ({ type: p.type, amount: p.amount })),
    });
    if (!check.ok) {
      toast.error(check.message ?? "Complete the current step before advancing.");
      return;
    }
    try {
      let selfBillId: string | undefined = j.self_bill_id ?? undefined;
      if (newStatus === "awaiting_payment" && !j.self_bill_id) {
        const selfBill = await createSelfBillFromJob({
          id: j.id,
          reference: j.reference,
          partner_name: j.partner_name ?? "Unassigned",
          partner_cost: j.partner_cost,
          materials_cost: j.materials_cost,
        });
        selfBillId = selfBill.id;
      }
      const statusPatch: Partial<Job> = {
        status: newStatus,
        ...(selfBillId ? { self_bill_id: selfBillId } : {}),
        ...(newStatus === "in_progress_phase1" && !j.partner_timer_started_at ? officePartnerTimerStartPatch() : {}),
      };
      const updated = await updateJob(j.id, statusPatch);
      await logAudit({ entityType: "job", entityId: j.id, entityRef: j.reference, action: "status_changed", fieldName: "status", oldValue: j.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
      setJob(updated);
      toast.success(selfBillId ? "Self-bill created. Job updated." : "Job updated");
      if (updated.partner_id && j.status !== newStatus) {
        notifyAssignedPartnerAboutJob({
          partnerId: updated.partner_id,
          job: updated,
          kind: "job_status_changed",
          statusLabel: statusConfig[newStatus]?.label ?? newStatus,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }, [profile?.id, profile?.full_name, customerPayments, partnerPayments]);

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
            scheduled_finish_date: expectedTrim ? expectedTrim : null,
          } as unknown as Partial<Job>,
        );
        return;
      }

      if (!tFrom) {
        handleJobUpdate(
          j.id,
          {
            scheduled_date: d,
            scheduled_start_at: null,
            scheduled_end_at: null,
            scheduled_finish_date: expectedTrim ? expectedTrim : null,
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
          scheduled_finish_date: expectedTrim ? expectedTrim : null,
        } as unknown as Partial<Job>,
      );
    },
    [handleJobUpdate],
  );

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

  const handleAddPayment = useCallback(async () => {
    if (!job || !addPaymentAmount || Number(addPaymentAmount) <= 0) return;
    const amount = Number(addPaymentAmount);
    const partnerCap = partnerPaymentCap(job);
    const partnerPaid = partnerPayments.reduce((s, p) => s + Number(p.amount), 0);
    const maxPartner = Math.max(0, partnerCap - partnerPaid);
    const depPaid = customerPayments.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
    const finPaid = customerPayments.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
    const maxDep = Math.max(0, (job.customer_deposit ?? 0) - depPaid);
    const maxFin = Math.max(0, (job.customer_final_payment ?? 0) - finPaid);

    if (addPaymentType === "partner" && amount > maxPartner + 1e-6) {
      toast.error(`Partner payment cannot exceed remaining cap (${formatCurrency(maxPartner)}).`);
      return;
    }
    if (addPaymentType === "customer_deposit" && amount > maxDep + 1e-6) {
      toast.error(`Deposit payment cannot exceed scheduled deposit remaining (${formatCurrency(maxDep)}).`);
      return;
    }
    if (addPaymentType === "customer_final" && amount > maxFin + 1e-6) {
      toast.error(`Final payment cannot exceed scheduled final remaining (${formatCurrency(maxFin)}).`);
      return;
    }

    setAddingPayment(true);
    try {
      await createJobPayment({
        job_id: job.id,
        type: addPaymentType,
        amount,
        payment_date: addPaymentDate,
        note: addPaymentNote.trim() || undefined,
        payment_method: addPaymentMethod,
        bank_reference: addPaymentBankRef.trim() || undefined,
      });
      const typeLabel = addPaymentType === "customer_deposit" ? "Customer deposit" : addPaymentType === "customer_final" ? "Customer final" : "Partner payment";
      await logAudit({
        entityType: "job", entityId: job.id, entityRef: job.reference,
        action: "payment",
        fieldName: addPaymentType,
        newValue: formatCurrency(amount),
        userId: profile?.id, userName: profile?.full_name,
        metadata: {
          type_label: typeLabel,
          method: addPaymentMethod,
          date: addPaymentDate,
          ...(addPaymentBankRef.trim() ? { bank_reference: addPaymentBankRef.trim() } : {}),
          ...(addPaymentNote.trim() ? { note: addPaymentNote.trim() } : {}),
        },
      });
      toast.success("Payment registered");
      setAddPaymentOpen(false);
      setAddPaymentAmount("");
      setAddPaymentDate(new Date().toISOString().slice(0, 10));
      setAddPaymentNote("");
      setAddPaymentBankRef("");
      await refreshJobFinance();
    } catch {
      toast.error("Failed to register payment");
    } finally {
      setAddingPayment(false);
    }
  }, [
    job,
    addPaymentAmount,
    addPaymentDate,
    addPaymentNote,
    addPaymentBankRef,
    addPaymentMethod,
    addPaymentType,
    refreshJobFinance,
    partnerPayments,
    customerPayments,
  ]);

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
        report_notes: [job.report_notes, `Manual report analysis (${new Date().toLocaleString()}):`, analysis].filter(Boolean).join("\n\n"),
      });
      toast.success("Report analysed and saved to report notes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to analyse report");
    } finally {
      setAnalyzingManualReport(false);
    }
  }, [job, manualReportFile, manualReportNotes, handleJobUpdate]);

  const handlePhaseReportUploadAnalyze = useCallback(async (phase: number) => {
    if (!job) return;
    const file = phaseReportFiles[phase] ?? null;
    if (!file) {
      toast.error("Select a report file first.");
      return;
    }
    setAnalyzingPhase(phase);
    try {
      const uploaded = await uploadManualJobReport(job.id, file);
      const res = await fetch("/api/jobs/analyze-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobReference: job.reference,
          fileUrl: uploaded.publicUrl,
          mimeType: uploaded.mimeType,
          notes: `Phase ${phase} report.`,
        }),
      });
      const body = (await res.json()) as { analysis?: string; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to analyse report");
      const analysis = body.analysis ?? "";
      await handleJobUpdate(job.id, {
        [`report_${phase}_uploaded`]: true,
        [`report_${phase}_uploaded_at`]: new Date().toISOString(),
        report_notes: [job.report_notes, `Phase ${phase} report analysis (${new Date().toLocaleString()}):`, analysis]
          .filter(Boolean)
          .join("\n\n"),
      } as Partial<Job>);
      setPhaseReportFiles((prev) => ({ ...prev, [phase]: null }));
      toast.success(`Phase ${phase} report uploaded and analysed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload/analyse report");
    } finally {
      setAnalyzingPhase(null);
    }
  }, [job, phaseReportFiles, handleJobUpdate]);

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

  const config = statusConfig[job.status] ?? { label: job.status, variant: "default" as const };
  const billableRevenue = jobBillableRevenue(job);
  const directCost = jobDirectCost(job);
  const profit = jobProfit(job);
  const marginPct = jobMarginPercent(job);
  const partnerCap = partnerPaymentCap(job);
  const partnerPaidTotal = partnerPayments.reduce((s, p) => s + Number(p.amount), 0);
  const partnerPayRemaining = Math.max(0, partnerCap - partnerPaidTotal);
  const customerDepositPaid = customerPayments
    .filter((p) => p.type === "customer_deposit")
    .reduce((s, p) => s + Number(p.amount), 0);
  const customerFinalPaidSum = customerPayments
    .filter((p) => p.type === "customer_final")
    .reduce((s, p) => s + Number(p.amount), 0);
  const maxCustomerDepositPay = Math.max(0, (job.customer_deposit ?? 0) - customerDepositPaid);
  const maxCustomerFinalPay = Math.max(0, (job.customer_final_payment ?? 0) - customerFinalPaidSum);
  const scheduledCustomerTotal = customerScheduledTotal(job);
  const customerScheduleMismatch = Math.abs(billableRevenue - scheduledCustomerTotal) > 0.02;
  // Use actual payment records sum — not boolean flags — so the UI stays live without a page reload.
  const customerPaidTotal = customerDepositPaid + customerFinalPaidSum;
  const amountDue = Math.max(0, billableRevenue - customerPaidTotal);

  const paymentAmountMax =
    addPaymentType === "partner"
      ? partnerPayRemaining
      : addPaymentType === "customer_deposit"
        ? maxCustomerDepositPay
        : addPaymentType === "customer_final"
          ? maxCustomerFinalPay
          : 0;

  const statusActions = getJobStatusActions(job);
  const phaseCount = normalizeTotalPhases(job.total_phases);
  const displayPhase = phaseCount === 2 ? (job.report_2_uploaded ? 2 : 1) : 1;
  const sendReportFinalCheck = canSendReportAndRequestFinalPayment(job);

  return (
    <PageTransition>
      <div className="space-y-5 pb-12">

        {/* ── HEADER ── */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push("/jobs")}>
            Back to Jobs
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-text-primary">{job.reference}</h1>
              <Badge variant={config.variant} dot={config.dot} size="md">{config.label}</Badge>
            </div>
            <p className="text-sm text-text-tertiary mt-0.5">{job.title}</p>
            {partnerLiveActiveMs != null ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-secondary/60 px-3 py-2 text-sm">
                <Timer className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                <span className="text-text-secondary">
                  {job.partner_timer_ended_at ? "Partner work time (last session)" : "Partner on site — active time"}
                </span>
                <span className="font-mono font-semibold tabular-nums text-text-primary">
                  {formatPartnerLiveTimer(partnerLiveActiveMs)}
                </span>
                {job.partner_timer_is_paused && !job.partner_timer_ended_at ? (
                  <Badge variant="warning" size="sm">Paused</Badge>
                ) : null}
              </div>
            ) : isJobInProgressStatus(job.status) || job.status === "awaiting_payment" ? (
              <p className="mt-2 max-w-xl text-xs text-text-tertiary">
                On-site work time appears once the job is moved to <strong className="text-text-secondary">In progress (phase 1)</strong> here or when the partner starts the job in the app. If this stays empty, apply DB migrations{" "}
                <code className="rounded bg-surface-tertiary px-1">062</code>–<code className="rounded bg-surface-tertiary px-1">063</code> on Supabase.
              </p>
            ) : null}
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
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end sm:justify-start">
            {statusActions.map((action, idx) => (
              <Button
                key={`${action.status}-${idx}`}
                variant={action.primary ? "primary" : "outline"}
                size="sm"
                icon={<action.icon className="h-3.5 w-3.5" />}
                onClick={() => {
                  if (action.status === "cancelled") {
                    setCancelPresetId(OFFICE_JOB_CANCELLATION_REASONS[0].id);
                    setCancelDetail("");
                    setCancelJobOpen(true);
                  } else {
                    void handleStatusChange(job, action.status as Job["status"]);
                  }
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>

        {/* ── Job amount / margin (same metrics as jobs board cards) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3">
          <div className="min-w-0 rounded-xl border border-border-light bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-sm">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Job amount</p>
            <p className="mt-1 text-base sm:text-lg font-bold text-text-primary tabular-nums leading-tight break-words">{formatCurrency(billableRevenue)}</p>
            <p className="text-[10px] text-text-tertiary mt-1 leading-snug">Incl. extras</p>
          </div>
          <div className="min-w-0 rounded-xl border border-border-light bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-sm">
            <p className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide">Partner cost</p>
            <p className="mt-1 text-base sm:text-lg font-bold text-text-secondary tabular-nums leading-tight break-words">{formatCurrency(Number(job.partner_cost ?? 0))}</p>
          </div>
          <div className="min-w-0 rounded-xl border border-border-light bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-sm">
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
          <div className="min-w-0 rounded-xl border border-border-light bg-surface-hover/60 dark:bg-surface-secondary/40 p-3 sm:p-4 shadow-sm">
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
                  <div>
                    <p className="text-base font-bold text-text-primary">{job.client_name}</p>
                    <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{job.property_address}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border-light">
                    <div>
                      <p className="text-[10px] text-text-tertiary">Start date</p>
                      <Input
                        type="date"
                        value={scheduleDate}
                        disabled={job.status === "cancelled"}
                        className="mt-0.5 h-9 text-sm"
                        onChange={(e) => { setScheduleDate(e.target.value); handleScheduleChange(job, e.target.value, scheduleTime, scheduleWindowMins, scheduleExpectedFinishDate); }}
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
                      <p className="text-[10px] text-text-tertiary">Expected finish (date only)</p>
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
                      <div className="space-y-2">
                        <ClientAddressPicker lockClient value={propertyEdit} onChange={setPropertyEdit} labelClient="Client" labelAddress="Property address" />
                        <Button type="button" variant="outline" size="sm" loading={savingProperty} onClick={handleSaveLinkedProperty}>Save address</Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <AddressAutocomplete value={unlinkedAddressDraft} onChange={setUnlinkedAddressDraft} onSelect={(p) => setUnlinkedAddressDraft(p.full_address)} label="Property address" placeholder="Type address or postcode…" />
                        <Button type="button" variant="outline" size="sm" loading={savingUnlinkedAddress} onClick={handleSaveUnlinkedProperty}>Save address</Button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {job.quote_id && <Link href="/quotes" className="inline-flex items-center gap-1 text-primary hover:underline">Quote <ExternalLink className="h-3 w-3" /></Link>}
                    {job.self_bill_id && <Link href="/finance/selfbill" className="inline-flex items-center gap-1 text-primary hover:underline">Self-bill <ExternalLink className="h-3 w-3" /></Link>}
                    {job.invoice_id && <Link href="/finance/invoices" className="inline-flex items-center gap-1 text-primary hover:underline">Invoice <ExternalLink className="h-3 w-3" /></Link>}
                  </div>
                </div>
              </div>
            </div>

            {/* SCOPE */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-2">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope of work</p>
              <p className="text-[11px] text-text-tertiary">Required before assigning a partner (with schedule and address).</p>
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

            {/* REPORTS */}
            <div className="rounded-xl border border-border-light bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Reports
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Progress value={job.progress} size="sm" color={job.progress === 100 ? "emerald" : "primary"} className="w-24 min-w-[6rem]" />
                  <span className="text-[11px] font-semibold text-text-primary tabular-nums">{job.progress}%</span>
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
              {allConfiguredReportsApproved(job) && (
                <div className="mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <p className="flex-1 text-sm font-medium text-text-primary">All reports validated — ready to send report & request final payment.</p>
                  <Button size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={!sendReportFinalCheck.ok} title={sendReportFinalCheck.message}
                    onClick={() => { if (!sendReportFinalCheck.ok) { toast.error(sendReportFinalCheck.message ?? "Cannot proceed"); return; } void handleJobUpdate(job.id, { report_submitted: true, report_submitted_at: new Date().toISOString() } as Partial<Job>, { notifyPartner: false }); void handleStatusChange(job, "awaiting_payment"); }}>
                    Send Report & Invoice
                  </Button>
                </div>
              )}
            </div>

            {/* MANUAL REPORT + AI ANALYSIS */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Manual report analysis (AI)
              </p>
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

            {/* FINANCIAL SETUP (admin edit) */}
            <details className="group rounded-xl border border-border-light bg-card overflow-hidden">
              <summary className="flex items-center justify-between p-4 cursor-pointer select-none">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Financial setup</p>
                <ChevronDown className="h-4 w-4 text-text-tertiary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 space-y-3 border-t border-border-light pt-4">
                {customerScheduleMismatch && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 text-xs text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Deposit + final ({formatCurrency(scheduledCustomerTotal)}) ≠ billable total ({formatCurrency(billableRevenue)}). Align below.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Client price</label><Input type="number" min={0} step="0.01" value={finForm.client_price} onChange={(e) => {
                    const price = parseFloat(e.target.value) || 0;
                    const extras = parseFloat(finForm.extras_amount) || 0;
                    const dep = parseFloat(finForm.customer_deposit) || 0;
                    const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                    setFinForm((f) => ({ ...f, client_price: e.target.value, customer_final_payment: autoFinal }));
                  }} /></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Extras (add-ons)</label><Input type="number" min={0} step="0.01" value={finForm.extras_amount} onChange={(e) => {
                    const price = parseFloat(finForm.client_price) || 0;
                    const extras = parseFloat(e.target.value) || 0;
                    const dep = parseFloat(finForm.customer_deposit) || 0;
                    const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                    setFinForm((f) => ({ ...f, extras_amount: e.target.value, customer_final_payment: autoFinal }));
                  }} /></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner cost</label><Input type="number" min={0} step="0.01" value={finForm.partner_cost} onChange={(e) => setFinForm((f) => ({ ...f, partner_cost: e.target.value }))} /></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Materials cost</label><Input type="number" min={0} step="0.01" value={finForm.materials_cost} onChange={(e) => setFinForm((f) => ({ ...f, materials_cost: e.target.value }))} /></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner pay cap</label><Input type="number" min={0} step="0.01" value={finForm.partner_agreed_value} onChange={(e) => setFinForm((f) => ({ ...f, partner_agreed_value: e.target.value }))} /></div>
                  <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Customer deposit</label><Input type="number" min={0} step="0.01" value={finForm.customer_deposit} onChange={(e) => {
                    const price = parseFloat(finForm.client_price) || 0;
                    const extras = parseFloat(finForm.extras_amount) || 0;
                    const dep = parseFloat(e.target.value) || 0;
                    const autoFinal = String(Math.round(Math.max(0, price + extras - dep) * 100) / 100);
                    setFinForm((f) => ({ ...f, customer_deposit: e.target.value, customer_final_payment: autoFinal }));
                  }} /></div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Customer final</label>
                    <Input type="number" min={0} step="0.01" value={finForm.customer_final_payment} onChange={(e) => setFinForm((f) => ({ ...f, customer_final_payment: e.target.value }))} />
                    <p className="text-[10px] text-text-tertiary mt-1">Auto-calculated from price − deposit. Edit manually if needed.</p>
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
                <CreditCard className="h-3.5 w-3.5" /> Financial completion
              </p>

              {/* CLIENT cash in */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Client (cash in)</p>
                  <div className="text-right">
                    <p className="text-[10px] text-text-tertiary">Total job value</p>
                    <p className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(billableRevenue)}</p>
                  </div>
                </div>
                <div className="space-y-2">
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
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">Final balance</span>
                        <Badge variant={job.customer_final_paid ? "success" : "default"} size="sm">{job.customer_final_paid ? "Paid" : "Pending"}</Badge>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(job.customer_final_payment ?? 0)}</span>
                    </div>
                  )}
                  {/* Payment history */}
                  {customerPayments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-1">Payment history</p>
                      {customerPayments.map((p) => (
                        <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-hover/40 px-2.5 py-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-semibold text-text-tertiary uppercase">
                                {p.type === "customer_deposit" ? "Deposit" : "Final"}
                              </span>
                              {p.payment_method && (
                                <span className="text-[10px] text-text-tertiary">· {p.payment_method === "bank_transfer" ? "Bank" : "Stripe"}</span>
                              )}
                              <span className="text-[10px] text-text-tertiary">
                                · {new Date(p.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                              </span>
                            </div>
                            {p.bank_reference && <p className="text-[10px] text-text-tertiary truncate">Ref: {p.bank_reference}</p>}
                            {p.note && <p className="text-[10px] text-text-tertiary truncate">{p.note}</p>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-sm font-semibold tabular-nums text-emerald-600">+{formatCurrency(Number(p.amount))}</span>
                            {isAdmin && (
                              <button onClick={() => setDeletePaymentTarget({ id: p.id, amount: Number(p.amount), type: p.type })} className="text-text-tertiary hover:text-red-500 transition-colors">
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1.5 border-t border-border-light">
                    <span className={`text-xs font-semibold ${amountDue > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {amountDue > 0 ? "Amount due" : "Fully collected"}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${amountDue > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {amountDue > 0 ? formatCurrency(amountDue) : formatCurrency(billableRevenue)}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  disabled={maxCustomerDepositPay <= 0 && maxCustomerFinalPay <= 0}
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    const type = maxCustomerDepositPay > 0 ? "customer_deposit" : "customer_final";
                    setAddPaymentType(type);
                    setAddPaymentOpen(true);
                  }}
                >
                  Register customer payment
                </Button>
              </div>

              {/* PARTNER cash out */}
              <div className="pt-3 border-t border-border-light">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner (cash out)</p>
                  <div className="text-right">
                    <p className="text-[10px] text-text-tertiary">Total to pay</p>
                    <p className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(partnerCap)}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">Partner cost</span>
                      <Badge variant={partnerPaidTotal >= partnerCap && partnerCap > 0 ? "success" : partnerPaidTotal > 0 ? "warning" : "default"} size="sm">
                        {partnerPaidTotal >= partnerCap && partnerCap > 0 ? "Paid" : partnerPaidTotal > 0 ? "Partial" : "Pending"}
                      </Badge>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatCurrency(partnerCap)}</span>
                  </div>
                  {/* Partner payment history */}
                  {partnerPayments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-1">Payment history</p>
                      {partnerPayments.map((p) => (
                        <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-hover/40 px-2.5 py-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {p.payment_method && (
                                <span className="text-[10px] text-text-tertiary">{p.payment_method === "bank_transfer" ? "Bank" : "Stripe"}</span>
                              )}
                              <span className="text-[10px] text-text-tertiary">
                                · {new Date(p.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                              </span>
                            </div>
                            {p.bank_reference && <p className="text-[10px] text-text-tertiary truncate">Ref: {p.bank_reference}</p>}
                            {p.note && <p className="text-[10px] text-text-tertiary truncate">{p.note}</p>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-sm font-semibold tabular-nums text-emerald-600">+{formatCurrency(Number(p.amount))}</span>
                            {isAdmin && (
                              <button onClick={() => setDeletePaymentTarget({ id: p.id, amount: Number(p.amount), type: p.type })} className="text-text-tertiary hover:text-red-500 transition-colors">
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {partnerCap > 0 && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-border-light">
                      <span className={`text-xs font-semibold ${partnerPayRemaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {partnerPayRemaining > 0 ? "Amount due" : "Fully paid out"}
                      </span>
                      <span className={`text-sm font-bold tabular-nums ${partnerPayRemaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {partnerPayRemaining > 0 ? formatCurrency(partnerPayRemaining) : formatCurrency(partnerCap)}
                      </span>
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" className="mt-3 w-full" disabled={partnerPayRemaining <= 0} icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setAddPaymentType("partner"); setAddPaymentOpen(true); }}>
                  Register partner payment
                </Button>
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

            {/* INVOICES & STRIPE */}
            {jobInvoices.length > 0 && (
              <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Invoices</p>
                  <Link href="/finance/invoices" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">All <ExternalLink className="h-3 w-3" /></Link>
                </div>
                {loadingInvoices ? <p className="text-xs text-text-tertiary">Loading…</p> : jobInvoices.map((inv) => {
                  const stripePaid = inv.stripe_payment_status === "paid";
                  return (
                    <div key={inv.id} className="rounded-lg border border-border-light p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-text-primary">{inv.reference}</p>
                        <Badge variant={inv.status === "paid" ? "success" : "warning"} size="sm">{inv.status}</Badge>
                      </div>
                      <p className="text-sm font-bold tabular-nums">{formatCurrency(inv.amount)}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={stripePaid ? "success" : "default"} size="sm">Stripe: {inv.stripe_payment_status ?? "none"}</Badge>
                        {inv.stripe_payment_link_url && (
                          <>
                            <Button size="sm" variant="outline" icon={<CreditCard className="h-3 w-3" />} onClick={() => window.open(inv.stripe_payment_link_url!, "_blank", "noopener,noreferrer")}>Pay link</Button>
                            <Button size="sm" variant="secondary" loading={syncingInvoiceId === inv.id} icon={<RefreshCw className="h-3 w-3" />} onClick={() => void handleStripeInvoiceSync(inv)}>Sync</Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* COMMAND HISTORY */}
            <div className="rounded-xl border border-border-light bg-card p-4 space-y-3">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Command history</p>
              <AuditTimeline entityType="job" entityId={job.id} deferUntilVisible />
            </div>

          </div>
        </div>
      </div>

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
                {deletePaymentTarget.type === "customer_deposit" ? "Customer deposit" : deletePaymentTarget.type === "customer_final" ? "Customer final" : "Partner payment"}
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

      <Modal
        open={addPaymentOpen}
        onClose={() => { setAddPaymentOpen(false); setAddPaymentAmount(""); setAddPaymentNote(""); setAddPaymentBankRef(""); setAddPaymentMethod("bank_transfer"); }}
        title="Register payment"
      >
        <div className="space-y-4 p-4">

          {/* METHOD SELECTOR */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Payment method</label>
            <div className="grid grid-cols-2 gap-2">
              {(["stripe", "bank_transfer"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAddPaymentMethod(m)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-all",
                    addPaymentMethod === m
                      ? "border-primary bg-primary/8 text-primary shadow-sm"
                      : "border-border-light bg-card text-text-secondary hover:border-border hover:bg-surface-hover/60",
                  )}
                >
                  {m === "stripe"
                    ? <><CreditCard className="h-4 w-4" /><span>Stripe</span><span className="text-[10px] font-normal opacity-70">Automatic</span></>
                    : <><Building2 className="h-4 w-4" /><span>Bank transfer</span><span className="text-[10px] font-normal opacity-70">Manual</span></>
                  }
                </button>
              ))}
            </div>
          </div>

          {/* STRIPE MODE */}
          {addPaymentMethod === "stripe" && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <p className="text-xs text-text-secondary leading-relaxed">
                Stripe payments are tracked <strong>automatically via webhook</strong>. Share the payment link with the client — when they pay, the system updates instantly.
              </p>
              {jobInvoices.filter((inv) => inv.stripe_payment_link_url).length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Payment links</p>
                  {jobInvoices.filter((inv) => inv.stripe_payment_link_url).map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-border-light bg-card px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold text-text-primary">{inv.reference}</p>
                        <p className="text-[11px] text-text-tertiary">{formatCurrency(inv.amount)}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<Copy className="h-3 w-3" />}
                          onClick={() => { void navigator.clipboard.writeText(inv.stripe_payment_link_url!); toast.success("Link copied"); }}
                        >Copy</Button>
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<ExternalLink className="h-3 w-3" />}
                          onClick={() => window.open(inv.stripe_payment_link_url!, "_blank", "noopener,noreferrer")}
                        >Open</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">No Stripe payment links on this job yet. Create an invoice with a Stripe link first.</p>
              )}
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setAddPaymentOpen(false); }}>Close</Button>
              </div>
            </div>
          )}

          {/* BANK TRANSFER MODE */}
          {addPaymentMethod === "bank_transfer" && (
            <>
              {(addPaymentType === "customer_deposit" || addPaymentType === "customer_final") && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Type</label>
                  <Select
                    value={addPaymentType}
                    onChange={(e) => setAddPaymentType(e.target.value as JobPaymentType)}
                    options={[
                      { value: "customer_deposit", label: "Deposit" },
                      { value: "customer_final", label: "Final payment" },
                    ]}
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
                <Input
                  type="number"
                  min={0}
                  max={paymentAmountMax > 0 ? paymentAmountMax : undefined}
                  step="0.01"
                  placeholder="0.00"
                  value={addPaymentAmount}
                  onChange={(e) => setAddPaymentAmount(e.target.value)}
                />
                <p className="text-[11px] text-text-tertiary mt-1.5">
                  Remaining: <strong className="text-text-secondary">{formatCurrency(paymentAmountMax)}</strong>
                  {paymentAmountMax <= 0 && (
                    <span className="block text-amber-600 dark:text-amber-400 mt-1">Nothing left to register for this type.</span>
                  )}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Date received</label>
                <Input type="date" value={addPaymentDate} onChange={(e) => setAddPaymentDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Bank reference / transaction ID</label>
                <input
                  type="text"
                  placeholder="e.g. TRF-20260326-001"
                  value={addPaymentBankRef}
                  onChange={(e) => setAddPaymentBankRef(e.target.value)}
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Note (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Paid by John via Barclays"
                  value={addPaymentNote}
                  onChange={(e) => setAddPaymentNote(e.target.value)}
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" size="sm" onClick={() => { setAddPaymentOpen(false); setAddPaymentAmount(""); setAddPaymentNote(""); setAddPaymentBankRef(""); }}>Cancel</Button>
                <Button
                  size="sm"
                  loading={addingPayment}
                  disabled={!addPaymentAmount || Number(addPaymentAmount) <= 0 || paymentAmountMax <= 0}
                  onClick={handleAddPayment}
                >
                  Register payment
                </Button>
              </div>
            </>
          )}

        </div>
      </Modal>

      <Modal
        open={partnerModalOpen}
        onClose={() => { setPartnerModalOpen(false); setPartnerPickerOpen(false); }}
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
                className="mt-1.5 w-full max-h-[min(50vh,320px)] min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card py-1 shadow-lg ring-1 ring-black/5 dark:ring-white/10 [-webkit-overflow-scrolling:touch]"
                role="listbox"
                aria-label="Partners"
              >
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover ${!selectedPartnerId ? "bg-primary/8" : ""}`}
                onClick={() => { setSelectedPartnerId(""); setPartnerPickerOpen(false); }}
              >
                <span className="flex-1 text-text-secondary font-medium">No partner</span>
                {!selectedPartnerId && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
              <div className="mx-2 h-px bg-border-light" />
              {partners.map((p) => {
                const name = p.company_name?.trim() || p.contact_name || "Partner";
                const isSel = selectedPartnerId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover ${isSel ? "bg-primary/8" : ""}`}
                    onClick={() => { setSelectedPartnerId(p.id); setPartnerPickerOpen(false); }}
                  >
                    <Avatar name={name} size="sm" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary truncate">{name}</p>
                      {p.trade ? <p className="text-[11px] text-text-tertiary truncate">{p.trade}</p> : null}
                    </div>
                    {isSel && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })}
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
                  if (selectedPartnerId && job.status === "unassigned") {
                    partnerPatch.status = "scheduled";
                  }
                  if (!selectedPartnerId && job.status === "scheduled") {
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
