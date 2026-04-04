"use client";

import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, List, LayoutGrid, Calendar, Map as MapIcon,
  ArrowRight, Briefcase, Receipt,
  MapPin, Building2, TrendingUp,
  AlertTriangle, XCircle, PoundSterling, Undo2,
} from "lucide-react";
import { cn, formatCurrency, formatCurrencyPrecise, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listJobs, createJob, updateJob, getJob, fetchAllJobsFinancialKpiRows } from "@/services/jobs";
import { refreshSelfBillPayoutState, refreshSelfBillPayoutStatesForJobIds } from "@/services/self-bills";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import { statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { notifyAssignedPartnerAboutJob } from "@/lib/notify-partner-job-push";
import { createSelfBillFromJob } from "@/services/self-bills";
import { getSupabase, getStatusCounts, softDeleteById, type ListParams } from "@/services/base";
import { sumCustomerCollectionsByJobIds } from "@/services/job-payments";
import { softDeleteInvoicesForArchivedJobs, cancelOpenInvoicesForJobCancellation } from "@/services/invoices";
import { useProfile } from "@/hooks/use-profile";
import type { Job, Partner } from "@/types/database";
import { listPartners } from "@/services/partners";
import { isPartnerEligibleForWork } from "@/lib/partner-status";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { logAudit, logBulkAction } from "@/services/audit";
import { findDuplicateJobs, formatJobDuplicateLines } from "@/lib/duplicate-create-warnings";
import { useDuplicateConfirm } from "@/contexts/duplicate-confirm-context";
import { KanbanBoard } from "@/components/shared/kanban-board";
import { canAdvanceJob, getPreviousJobStatus, isJobOnSiteWorkStatus, normalizeTotalPhases } from "@/lib/job-phases";
import { getPartnerAssignmentBlockReason, jobHasPartnerSet } from "@/lib/job-partner-assign";
import { applyJobDbCompat, prepareJobRowForUpdate } from "@/lib/job-schema-compat";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import {
  formatJobScheduleLine,
  jobFinishYmd,
  jobScheduleYmd,
  formatLocalYmd,
  addLocalCalendarDays,
  startOfLocalWeekMonday,
  endOfLocalWeekSunday,
  startOfLocalMonth,
  endOfLocalMonth,
} from "@/lib/schedule-calendar";
import { TYPE_OF_WORK_OPTIONS, normalizeTypeOfWork } from "@/lib/type-of-work";
import { resolveJobModalSchedule } from "@/lib/job-modal-schedule";
import { JobModalScheduleFields } from "@/components/shared/job-modal-schedule-fields";
import {
  jobBillableRevenue,
  jobCustomerBillableRevenueForCollections,
  jobMarginPercent,
  jobProfit,
} from "@/lib/job-financials";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import type { CatalogService } from "@/types/database";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import {
  computeHourlyTotals,
  partnerHourlyRateFromCatalogBundle,
} from "@/lib/job-hourly-billing";
import { computeAccessSurcharge, effectiveInCczForAddress, isLikelyCczAddress } from "@/lib/ccz";
import { safePartnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";

const JOB_STATUSES = ["unassigned", "auto_assigning", "scheduled", "late", "in_progress_phase1", "in_progress_phase2", "in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed", "cancelled"] as const;

const NO_SCHEDULE_LIST_PARAMS: Partial<ListParams> = {};

type ScheduleDatePreset = "all" | "today" | "tomorrow" | "week" | "month" | "custom";

function formatMediumYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function scheduleFilterSubtitle(
  preset: ScheduleDatePreset,
  range: { from: string; to: string } | null
): string | null {
  if (!range || preset === "all") return null;
  if (range.from === range.to) return `Scheduled ${formatMediumYmd(range.from)} · tabs & KPIs match this window`;
  return `Scheduled ${formatMediumYmd(range.from)} – ${formatMediumYmd(range.to)} · tabs & KPIs match this window`;
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

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  unassigned: { label: "Unassigned", variant: "warning", dot: true },
  auto_assigning: { label: "Assigning", variant: "info", dot: true },
  scheduled: { label: "Scheduled", variant: "info", dot: true },
  late: { label: "Late", variant: "danger", dot: true },
  in_progress_phase1: { label: "In Progress", variant: "primary", dot: true },
  in_progress_phase2: { label: "In Progress", variant: "primary", dot: true },
  in_progress_phase3: { label: "In Progress", variant: "primary", dot: true },
  final_check: { label: "Final Check", variant: "warning", dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: "danger", dot: true },
  need_attention: { label: "Final Check", variant: "warning", dot: true },
  completed: { label: "Paid & Completed", variant: "success", dot: true },
  cancelled: { label: "Lost & Cancelled", variant: "danger", dot: true },
};

function JobsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { confirmDespiteDuplicates } = useDuplicateConfirm();
  const anchorDayKey = formatLocalYmd(new Date());
  const [scheduleDatePreset, setScheduleDatePreset] = useState<ScheduleDatePreset>("all");
  const [customScheduleFrom, setCustomScheduleFrom] = useState(() => formatLocalYmd(new Date()));
  const [customScheduleTo, setCustomScheduleTo] = useState(() => formatLocalYmd(new Date()));
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const dateFilterRef = useRef<HTMLDivElement>(null);

  const scheduleRange = useMemo((): { from: string; to: string } | null => {
    if (scheduleDatePreset === "all") return null;
    const anchor = new Date();
    if (scheduleDatePreset === "today") {
      const d = formatLocalYmd(anchor);
      return { from: d, to: d };
    }
    if (scheduleDatePreset === "tomorrow") {
      const t = formatLocalYmd(addLocalCalendarDays(anchor, 1));
      return { from: t, to: t };
    }
    if (scheduleDatePreset === "week") {
      const a = startOfLocalWeekMonday(anchor);
      const b = endOfLocalWeekSunday(anchor);
      return { from: formatLocalYmd(a), to: formatLocalYmd(b) };
    }
    if (scheduleDatePreset === "month") {
      const a = startOfLocalMonth(anchor);
      const b = endOfLocalMonth(anchor);
      return { from: formatLocalYmd(a), to: formatLocalYmd(b) };
    }
    let from = customScheduleFrom;
    let to = customScheduleTo;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }, [scheduleDatePreset, customScheduleFrom, customScheduleTo, anchorDayKey]);

  const listParams = useMemo<Partial<ListParams>>(() => {
    if (!scheduleRange) return NO_SCHEDULE_LIST_PARAMS;
    return { scheduleRange };
  }, [scheduleRange]);

  const { data, loading, page, totalPages, totalItems, setPage, search, setSearch, status, setStatus, refresh, refreshSilent } = useSupabaseList<Job>({
    fetcher: listJobs,
    realtimeTable: "jobs",
    listParams,
  });
  const { profile } = useProfile();
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterPartner, setFilterPartner] = useState<"all" | "with" | "without">("all");
  const [filterScheduled, setFilterScheduled] = useState<"all" | "scheduled" | "unscheduled">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionModal, setBulkActionModal] = useState<null | "start_job" | "cancel" | "mark_paid" | "archive">(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [kpiFinancialLoading, setKpiFinancialLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [avgTicket, setAvgTicket] = useState(0);
  const [avgMarginPct, setAvgMarginPct] = useState(0);
  const [clientAccountMap, setClientAccountMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === "archived" && viewMode !== "list") setViewMode("list");
  }, [status, viewMode]);

  useEffect(() => {
    if (status === "archived") setSelectedIds(new Set());
  }, [status]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (filterOpen && filterRef.current && !filterRef.current.contains(t)) setFilterOpen(false);
      if (dateFilterOpen && dateFilterRef.current && !dateFilterRef.current.contains(t)) setDateFilterOpen(false);
    }
    if (filterOpen || dateFilterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen, dateFilterOpen]);

  const filteredData = useMemo(() => {
    return data.filter((j) => {
      if (filterPartner === "with" && !j.partner_id && !j.partner_name) return false;
      if (filterPartner === "without" && (j.partner_id || j.partner_name)) return false;
      const hasDate = !!(j.scheduled_date || j.scheduled_start_at || j.scheduled_finish_date);
      if (filterScheduled === "scheduled" && !hasDate) return false;
      if (filterScheduled === "unscheduled" && hasDate) return false;
      return true;
    });
  }, [data, filterPartner, filterScheduled]);

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

  const kanbanColumns = useMemo(() => {
    const ids = [
      "unassigned",
      "scheduled",
      "in_progress",
      "final_check",
      "awaiting_payment",
      "completed",
      "cancelled",
    ] as const;
    return ids.map((id) => {
      if (id === "in_progress") {
        return {
          id,
          title: "In progress",
          color: "bg-primary",
          items: filteredData.filter((j) => isJobOnSiteWorkStatus(j.status)),
        };
      }
      if (id === "scheduled") {
        return {
          id,
          title: "Scheduled",
          color: "bg-sky-600",
          items: filteredData.filter((j) => j.status === "scheduled" || j.status === "late"),
        };
      }
      if (id === "final_check") {
        return {
          id,
          title: "Final checks",
          color: "bg-amber-500",
          items: filteredData.filter((j) => j.status === "final_check" || j.status === "need_attention"),
        };
      }
      return {
        id,
        title: statusConfig[id]?.label ?? id,
        color:
          id === "completed"
            ? "bg-emerald-500"
            : id === "cancelled"
              ? "bg-stone-500"
                : id === "awaiting_payment"
                  ? "bg-amber-600"
                    : id === "unassigned"
                      ? "bg-slate-500"
                      : "bg-primary",
        items: filteredData.filter((j) =>
          id === "unassigned"
            ? j.status === "unassigned" || j.status === "auto_assigning"
            : j.status === id,
        ),
      };
    });
  }, [filteredData]);

  const jobIdFromUrl = searchParams.get("jobId");
  useEffect(() => { if (jobIdFromUrl) router.replace(`/jobs/${jobIdFromUrl}`); }, [jobIdFromUrl, router]);

  const loadDashboardStats = useCallback(async () => {
    setKpiFinancialLoading(true);
    try {
      const countOpts = scheduleRange ? { scheduleRange } : undefined;
      const supabase = getSupabase();
      const [counts, rows, archivedHead] = await Promise.all([
        getStatusCounts("jobs", [...JOB_STATUSES], "status", countOpts),
        fetchAllJobsFinancialKpiRows(scheduleRange),
        supabase.from("jobs").select("*", { count: "exact", head: true }).not("deleted_at", "is", null),
      ]);
      const archivedCount = archivedHead.error ? 0 : archivedHead.count ?? 0;
      setTabCounts({ ...counts, archived: archivedCount });
      const pipelineRows = rows.filter((r) => r.status !== "cancelled");
      const ticketSum = pipelineRows.reduce((s, r) => s + jobBillableRevenue(r), 0);
      setTotalRevenue(ticketSum);
      setAvgTicket(pipelineRows.length ? ticketSum / pipelineRows.length : 0);
      const activeRows = rows.filter((r) => r.status !== "cancelled" && r.status !== "completed");
      const margins = activeRows.map((r) => jobMarginPercent(r));
      const avgM = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
      setAvgMarginPct(Math.round(avgM * 10) / 10);
    } catch {
      /* cosmetic */
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
    (tabCounts.in_progress_phase1 ?? 0) + (tabCounts.in_progress_phase2 ?? 0) + (tabCounts.in_progress_phase3 ?? 0);

  const scheduledTabCount = (tabCounts.scheduled ?? 0) + (tabCounts.late ?? 0);

  const finalChecksTabCount = (tabCounts.final_check ?? 0) + (tabCounts.need_attention ?? 0);

  const unassignedTabCount = (tabCounts.unassigned ?? 0) + (tabCounts.auto_assigning ?? 0);

  const activeJobsKpiCount = useMemo(() => {
    const onSite =
      (tabCounts.in_progress_phase1 ?? 0) +
      (tabCounts.in_progress_phase2 ?? 0) +
      (tabCounts.in_progress_phase3 ?? 0);
    return (
      (tabCounts.unassigned ?? 0) +
      (tabCounts.auto_assigning ?? 0) +
      (tabCounts.scheduled ?? 0) +
      (tabCounts.late ?? 0) +
      onSite +
      (tabCounts.final_check ?? 0) +
      (tabCounts.awaiting_payment ?? 0)
    );
  }, [tabCounts]);

  const tabs = [
    { id: "all", label: "All Jobs", count: tabCounts.all ?? 0 },
    { id: "unassigned", label: "Unassigned", count: unassignedTabCount },
    { id: "scheduled", label: "Scheduled", count: scheduledTabCount },
    { id: "in_progress", label: "In Progress", count: inProgressTabCount },
    { id: "final_check", label: "Final Checks", count: finalChecksTabCount },
    { id: "awaiting_payment", label: "Awaiting Payment", count: tabCounts.awaiting_payment ?? 0 },
    { id: "completed", label: "Paid & Completed", count: tabCounts.completed ?? 0 },
    { id: "cancelled", label: "Lost & Cancelled", count: tabCounts.cancelled ?? 0 },
    { id: "archived", label: "Archived", count: tabCounts.archived ?? 0 },
  ];

  useEffect(() => {
    const ids = [...new Set(data.map((j) => j.client_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setClientAccountMap({});
      return;
    }
    const supabase = getSupabase();
    let cancelled = false;
    (async () => {
      const labels = await batchResolveLinkedAccountLabels(supabase, ids);
      if (cancelled) return;
      const next: Record<string, string> = {};
      labels.forEach((label, clientId) => {
        next[clientId] = label;
      });
      setClientAccountMap(next);
    })();
    return () => { cancelled = true; };
  }, [data]);

  const handleCreate = useCallback(async (formData: Partial<Job>) => {
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
        });
    try {
      const dupJobs = await findDuplicateJobs({
        clientId: formData.client_id,
        propertyAddress: formData.property_address ?? "",
      });
      if (!(await confirmDespiteDuplicates(formatJobDuplicateLines(dupJobs)))) return;

      const result = await createJob({
        title: formData.title ?? "",
        catalog_service_id: formData.catalog_service_id ?? null,
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
      });
      await Promise.all([
        logAudit({ entityType: "job", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name }),
        loadDashboardStats(),
      ]);
      setCreateOpen(false);
      toast.success("Job created");
      refreshSilent();
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
      }
      router.push(`/jobs/${result.id}`);
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
        const allowedFrom = new Set<string>(["awaiting_payment", "need_attention"]);
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

      for (const j of rows) {
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
        toast.error(`${missing.length} selected job(s) not found or archived.`);
        return false;
      }
      const ns = "in_progress_phase1" as const;
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
    const reason = "Cancelled in bulk from Jobs list.";
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
  }, [selectedIds, profile?.id, profile?.full_name, refresh, loadDashboardStats]);

  const handleBulkArchive = useCallback(async (): Promise<boolean> => {
    if (selectedIds.size === 0) return false;
    try {
      const ids = Array.from(selectedIds);
      const supabase = getSupabase();
      const { data: jobRows, error: jobFetchErr } = await supabase
        .from("jobs")
        .select("reference, invoice_id, self_bill_id")
        .in("id", ids)
        .is("deleted_at", null);
      if (jobFetchErr) throw jobFetchErr;
      const forInvoices = (jobRows ?? []) as { reference: string; invoice_id?: string | null }[];
      const selfBillIds = [
        ...new Set(
          (jobRows ?? [])
            .map((r) => (r as { self_bill_id?: string | null }).self_bill_id)
            .filter((x): x is string => Boolean(x && String(x).trim())),
        ),
      ];
      await softDeleteInvoicesForArchivedJobs(forInvoices, profile?.id);
      await Promise.all(ids.map((id) => softDeleteById("jobs", id, profile?.id)));
      await Promise.all(selfBillIds.map((bid) => refreshSelfBillPayoutState(bid)));
      await logBulkAction("job", ids, "deleted", "deleted_at", "archived", profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} jobs archived`);
      setSelectedIds(new Set());
      refresh();
      loadDashboardStats();
      return true;
    } catch {
      toast.error("Failed to archive jobs");
      return false;
    }
  }, [selectedIds, profile?.id, profile?.full_name, refresh, loadDashboardStats]);

  const columns: Column<Job>[] = [
    {
      key: "reference",
      label: "Job",
      minWidth: "132px",
      cellClassName: "min-w-[8rem]",
      render: (item) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{item.reference}</p>
          <p className="text-[11px] text-text-tertiary line-clamp-2 break-words">{normalizeTypeOfWork(item.title) || item.title}</p>
        </div>
      ),
    },
    {
      key: "client_name",
      label: "Client / Property",
      minWidth: "160px",
      cellClassName: "min-w-[10rem] max-w-[14rem] sm:max-w-[16rem]",
      render: (item) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{item.client_name}</p>
          <p className="text-[11px] text-text-tertiary line-clamp-2 break-words">{item.property_address}</p>
        </div>
      ),
    },
    {
      key: "partner_name",
      label: "Partner",
      minWidth: "120px",
      cellClassName: "whitespace-nowrap",
      render: (item) =>
        item.partner_name ? (
          <div className="flex items-center gap-2 min-w-0">
            <Avatar name={item.partner_name} size="xs" />
            <span className="text-sm text-text-secondary truncate max-w-[7rem] sm:max-w-[9rem]">{item.partner_name}</span>
          </div>
        ) : (
          <span className="text-xs text-text-tertiary italic">Unassigned</span>
        ),
    },
    {
      key: "schedule",
      label: "Schedule",
      minWidth: "200px",
      cellClassName: "min-w-[12.5rem] max-w-[16rem]",
      render: (item) => {
        const line = formatJobScheduleLine(item);
        return line ? (
          <span className="text-xs text-text-secondary leading-snug block whitespace-normal break-words">{line}</span>
        ) : (
          <span className="text-xs text-text-tertiary">—</span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      minWidth: "118px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap",
      render: (item) => {
        const c = statusConfig[item.status] ?? { label: item.status, variant: "default" as const };
        return <Badge variant={c.variant} dot={c.dot}>{c.label}</Badge>;
      },
    },
    {
      key: "account",
      label: "Account",
      minWidth: "100px",
      cellClassName: "min-w-[6.25rem] max-w-[8rem]",
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
      headerClassName: "whitespace-nowrap",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{formatCurrency(item.client_price + Number(item.extras_amount ?? 0))}</p>
          <span className={`text-[11px] font-medium ${item.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>{item.margin_percent}% margin</span>
        </div>
      ),
    },
    {
      key: "amount_due",
      label: "Amount Due",
      minWidth: "96px",
      cellClassName: "whitespace-nowrap",
      headerClassName: "whitespace-nowrap",
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
      headerClassName: "whitespace-nowrap",
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
      headerClassName: "w-11",
      render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors inline-block" />,
    },
  ];

  const scheduleSubtitleText = scheduleFilterSubtitle(scheduleDatePreset, scheduleRange);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Jobs Management" subtitle="Track and manage all active jobs.">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative flex items-center gap-2" ref={filterRef}>
              <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>Filter</Button>
              {(filterPartner !== "all" || filterScheduled !== "all") && <span className="text-[10px] font-medium text-primary">Active</span>}
              {filterOpen && (
                <div className="absolute top-full right-0 mt-1 w-56 rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Partner</p>
                  <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value as "all" | "with" | "without")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                    <option value="all">All</option><option value="with">With partner</option><option value="without">Without partner</option>
                  </select>
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Scheduled</p>
                  <select value={filterScheduled} onChange={(e) => setFilterScheduled(e.target.value as "all" | "scheduled" | "unscheduled")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                    <option value="all">All</option><option value="scheduled">Has date</option><option value="unscheduled">No date</option>
                  </select>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFilterPartner("all"); setFilterScheduled("all"); }}>Clear filters</Button>
                </div>
              )}
            </div>
            <div className="relative" ref={dateFilterRef}>
              <Button
                variant="outline"
                size="sm"
                icon={<Calendar className="h-3.5 w-3.5" />}
                onClick={() => setDateFilterOpen((o) => !o)}
                className={cn(scheduleRange && "border-primary/40 bg-primary/5")}
              >
                {scheduleDatePreset === "all"
                  ? "Dates"
                  : scheduleDatePreset === "today"
                    ? "Today"
                    : scheduleDatePreset === "tomorrow"
                      ? "Tomorrow"
                      : scheduleDatePreset === "week"
                        ? "This week"
                        : scheduleDatePreset === "month"
                          ? "This month"
                          : "Custom range"}
              </Button>
              {dateFilterOpen && (
                <div className="absolute top-full right-0 mt-1 w-[min(calc(100vw-2rem),280px)] rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Schedule window</p>
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
                        variant={scheduleDatePreset === id ? "secondary" : "ghost"}
                        size="sm"
                        className="h-8 justify-center px-2 text-[11px] font-medium"
                        onClick={() => {
                          setScheduleDatePreset(id);
                          if (id === "custom") setDateFilterOpen(true);
                          else setDateFilterOpen(false);
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  {scheduleDatePreset === "custom" ? (
                    <div className="space-y-2 pt-1 border-t border-border-light">
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">From · to</p>
                      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
                        <Input type="date" value={customScheduleFrom} onChange={(e) => setCustomScheduleFrom(e.target.value)} className="h-9 text-sm" />
                        <Input type="date" value={customScheduleTo} onChange={(e) => setCustomScheduleTo(e.target.value)} className="h-9 text-sm" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Job</Button>
          </div>
        </PageHeader>

        {scheduleSubtitleText ? <p className="text-xs text-text-tertiary -mt-2">{scheduleSubtitleText}</p> : null}

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
          <KpiCard className="min-h-[128px] h-full" title="Active Jobs" value={activeJobsKpiCount} format="number" icon={Briefcase} accent="blue" />
          <KpiCard
            className="min-h-[128px] h-full"
            title="Revenue"
            value={kpiFinancialLoading ? "—" : formatCurrencyPrecise(totalRevenue)}
            format="none"
            icon={PoundSterling}
            accent="emerald"
          />
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
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
            <div className="min-w-0 flex-1 pb-1 -mb-1">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: MapIcon }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}><Icon className="h-3.5 w-3.5" /></button>
                ))}
              </div>
              <SearchInput placeholder="Search jobs..." className="w-full min-w-[10rem] sm:w-52 flex-1 sm:flex-none" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {viewMode === "list" && (
            <DataTable
              columns={columns}
              data={data}
              loading={loading}
              getRowId={(item) => item.id}
              onRowClick={(job) => router.push(`/jobs/${job.id}`)}
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              onPageChange={setPage}
              selectable={status !== "archived"}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                status === "archived" ? undefined : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <BulkBtn label="Start Job" onClick={() => setBulkActionModal("start_job")} variant="success" />
                    <BulkBtn label="Cancel" onClick={() => setBulkActionModal("cancel")} variant="danger" />
                    <BulkBtn label="Mark as Paid" onClick={() => setBulkActionModal("mark_paid")} variant="success" />
                    <BulkBtn label="Archive" onClick={() => setBulkActionModal("archive")} variant="warning" />
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
                  onCardClick={(j) => router.push(`/jobs/${j.id}`)}
                  renderCard={(j) => {
                    const sc = statusConfig[j.status] ?? { label: j.status };
                    const sched = formatJobScheduleLine(j);
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
                          <p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p>
                          <p className="text-xs text-text-tertiary truncate">{normalizeTypeOfWork(j.title) || j.title}</p>
                          <p className="text-[10px] text-text-tertiary mt-1 truncate">{sc.label}</p>
                          {sched ? <p className="text-[10px] text-text-secondary mt-1 line-clamp-2 leading-snug">{sched}</p> : null}
                          <p className="text-[11px] text-text-secondary mt-0.5 truncate">{j.client_name}</p>
                          <JobCardFinanceRow job={j} />
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
          {viewMode === "calendar" && <JobsCalendarView jobs={filteredData} loading={loading} onSelectJob={(j) => router.push(`/jobs/${j.id}`)} />}
          {viewMode === "map" && <JobsMapView jobs={filteredData} loading={loading} onSelectJob={(j) => router.push(`/jobs/${j.id}`)} />}
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
              ? "Cancel selected jobs?"
              : bulkActionModal === "mark_paid"
                ? "Mark selected jobs as paid?"
                : bulkActionModal === "archive"
                  ? "Archive selected jobs?"
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
                You are about to <strong className="text-text-primary">cancel</strong>{" "}
                <strong className="text-text-primary">{selectedIds.size}</strong> job(s). Completed jobs cannot be cancelled this way.
                Partners will be notified where applicable. Are you sure?
              </>
            )}
            {bulkActionModal === "mark_paid" && (
              <>
                You are about to mark <strong className="text-text-primary">{selectedIds.size}</strong> job(s) as{" "}
                <strong className="text-text-primary">paid and completed</strong>. Only jobs in{" "}
                <strong className="text-text-primary">Awaiting payment</strong> or <strong className="text-text-primary">Need attention</strong>{" "}
                with full customer and partner settlements will be updated. Are you sure?
              </>
            )}
            {bulkActionModal === "archive" && (
              <>
                You are about to <strong className="text-text-primary">archive</strong>{" "}
                <strong className="text-text-primary">{selectedIds.size}</strong> job(s). Linked invoices will be cancelled and hidden from
                the Invoices list. This cannot be undone from the list. Are you sure?
              </>
            )}
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={bulkRunning} onClick={() => setBulkActionModal(null)}>
              Go back
            </Button>
            <Button
              type="button"
              variant={bulkActionModal === "cancel" || bulkActionModal === "archive" ? "danger" : "primary"}
              loading={bulkRunning}
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
                  ? "Yes, cancel jobs"
                  : bulkActionModal === "mark_paid"
                    ? "Yes, mark as paid"
                    : bulkActionModal === "archive"
                      ? "Yes, archive"
                      : "Confirm"}
            </Button>
          </div>
        </div>
      </Modal>

      <CreateJobModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
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

/* ========== CREATE JOB MODAL ========== */
function CreateJobModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (data: Partial<Job>) => void }) {
  const requiredFieldClass = "border-red-300 focus:border-red-400 focus:ring-red-100 hover:border-red-300";
  const [form, setForm] = useState({
    title: "",
    catalog_service_id: "",
    partner_id: "",
    partner_ids: [] as string[],
    client_price: "",
    partner_cost: "",
    materials_cost: "",
    scheduled_date: "",
    arrival_from: "09:00",
    arrival_window_mins: "180",
    expected_finish_date: "",
    job_type: "fixed",
    scope: "",
    hourly_client_rate: "",
    hourly_partner_rate: "",
    billed_hours: "1",
    in_ccz: false,
    has_free_parking: true,
    assignment_mode: "manual",
  });
  const [partners, setPartners] = useState<Partner[]>([]);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const selectedCatalogService = catalogServices.find((s) => s.id === form.catalog_service_id);
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
    const aMatch = targetWorkType ? safePartnerMatchesTypeOfWork(a, targetWorkType) : false;
    const bMatch = targetWorkType ? safePartnerMatchesTypeOfWork(b, targetWorkType) : false;
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    return (a.company_name ?? a.contact_name ?? "").localeCompare(b.company_name ?? b.contact_name ?? "");
  });

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.job_type !== "hourly" && !form.title) { toast.error("Type of work is required"); return; }
    if (form.job_type === "hourly" && !form.catalog_service_id) {
      toast.error("For hourly jobs, select a Call Out type from Services.");
      return;
    }
    if (!clientAddress.client_id || !clientAddress.property_address?.trim()) { toast.error("Select a client from the list (click the name) and choose or add a property address."); return; }
    const isAutoAssign = form.assignment_mode === "auto";
    const hasPartner = !isAutoAssign && !!form.partner_id;
    const sched = resolveJobModalSchedule({
      scheduled_date: form.scheduled_date,
      arrival_from: form.arrival_from,
      arrival_window_mins: form.arrival_window_mins,
      hasPartner,
    });
    if (!sched.ok) {
      toast.error(sched.error);
      return;
    }
    const scheduled_date = sched.scheduled_date;
    const scheduled_start_at = sched.scheduled_start_at;
    const scheduled_end_at = sched.scheduled_end_at;
    const expected_finish = form.expected_finish_date?.trim() || undefined;
    if (expected_finish && scheduled_date && expected_finish < scheduled_date) {
      toast.error("Expected finish date must be on or after the arrival date.");
      return;
    }
    const scheduled_finish_date = expected_finish ?? null;
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

    onCreate({
      title: form.job_type === "hourly"
        ? (selectedCatalogService?.name ? (normalizeTypeOfWork(selectedCatalogService.name) || selectedCatalogService.name) : (normalizeTypeOfWork(form.title.trim()) || form.title.trim()))
        : (normalizeTypeOfWork(form.title.trim()) || form.title.trim()),
      catalog_service_id: form.catalog_service_id || null,
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
      total_phases: normalizeTotalPhases(2),
      scope: form.scope.trim() || undefined,
    });
    setForm({
      title: "",
      catalog_service_id: "",
      partner_id: "",
      partner_ids: [],
      client_price: "",
      partner_cost: "",
      materials_cost: "",
      scheduled_date: "",
      arrival_from: "09:00",
      arrival_window_mins: "180",
      expected_finish_date: "",
      job_type: "fixed",
      scope: "",
      hourly_client_rate: "",
      hourly_partner_rate: "",
      billed_hours: "1",
      in_ccz: false,
      has_free_parking: true,
      assignment_mode: "manual",
    });
    setClientAddress({ client_name: "", property_address: "" });
  };

  const cczEligible = !isHousekeepJob && isLikelyCczAddress(clientAddress.property_address);
  const inCczPreview = cczEligible && form.in_ccz;
  const accessSurchargePreview = isHousekeepJob ? 0 : computeAccessSurcharge({ inCcz: inCczPreview, hasFreeParking: form.has_free_parking });
  const hourlyPreview = computeHourlyTotals({
    elapsedSeconds: Math.max(1, Number(form.billed_hours) || 1) * 3600,
    clientHourlyRate: Math.max(0, Number(form.hourly_client_rate) || 0),
    partnerHourlyRate: Math.max(0, Number(form.hourly_partner_rate) || 0),
  });
  const hourlyMarginPct = hourlyPreview.clientTotal > 0
    ? Math.round(((hourlyPreview.clientTotal - hourlyPreview.partnerTotal) / hourlyPreview.clientTotal) * 1000) / 10
    : 0;

  return (
    <Modal open={open} onClose={onClose} title="New Job" subtitle="Create a new job" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <Select
          label="Job type"
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "hourly", label: "Hourly" },
          ]}
          value={form.job_type}
          onChange={(e) => update("job_type", e.target.value)}
          className={requiredFieldClass}
        />
        {form.job_type === "hourly" && (
          <ServiceCatalogSelect
            label="Call Out type *"
            emptyOptionLabel="Select from Services..."
            catalog={catalogServices}
            value={form.catalog_service_id}
            className={requiredFieldClass}
            onChange={(id, service) => {
              const hrs = Math.max(1, Number(service?.default_hours) || 1);
              const clientRate = Number(service?.hourly_rate) || 0;
              const partnerRate = partnerHourlyRateFromCatalogBundle(service?.partner_cost, service?.default_hours);
              const totals = computeHourlyTotals({
                elapsedSeconds: hrs * 3600,
                clientHourlyRate: clientRate,
                partnerHourlyRate: partnerRate,
              });
              setForm((prev) => ({
                ...prev,
                catalog_service_id: id,
                title: service ? (normalizeTypeOfWork(service.name) || service.name) : prev.title,
                scope: service?.default_description?.trim() || prev.scope,
                hourly_client_rate: String(clientRate || ""),
                hourly_partner_rate: String(partnerRate || ""),
                billed_hours: String(hrs),
                client_price: String(totals.clientTotal),
                partner_cost: String(totals.partnerTotal),
              }));
            }}
          />
        )}
        {form.job_type !== "hourly" && (
          <Select
            label="Type of work *"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            className={requiredFieldClass}
            options={[
              { value: "", label: "Select type of work..." },
              ...TYPE_OF_WORK_OPTIONS.map((name) => ({ value: name, label: name })),
            ]}
          />
        )}
        <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
        <JobModalScheduleFields
          scheduledDate={form.scheduled_date}
          arrivalFrom={form.arrival_from}
          arrivalWindowMins={form.arrival_window_mins}
          expectedFinishDate={form.expected_finish_date}
          onChange={(field, v) => update(field, v)}
          requiredFieldClassName={requiredFieldClass}
        />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Scope of work {form.partner_id || form.partner_ids.length > 0 ? "*" : ""}</label>
          <textarea
            value={form.scope}
            onChange={(e) => update("scope", e.target.value)}
            rows={3}
            placeholder="Required if you assign a partner (with schedule and address above)."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-y min-h-[72px]"
          />
        </div>
        <div className="rounded-xl border border-border-light bg-surface-hover/30 p-3 sm:p-4 space-y-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Access & parking</p>
          {isHousekeepJob ? (
            <p className="text-xs text-text-tertiary">
              Housekeep: CCZ/Parking is included in the service price. Extra access surcharge is disabled.
            </p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isHousekeepJob || !cczEligible}
              onClick={() => cczEligible && setForm((prev) => ({ ...prev, in_ccz: !prev.in_ccz }))}
              className={cn(
                "text-left rounded-lg border px-3 py-2 text-sm transition-colors",
                (isHousekeepJob || !cczEligible) && "opacity-50 cursor-not-allowed",
                form.in_ccz && cczEligible ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card text-text-secondary",
              )}
            >
              <p className="font-medium">
                {!cczEligible && !isHousekeepJob
                  ? "CCZ (Congestion Charge — central London)"
                  : inCczPreview
                    ? "CCZ fee applied"
                    : "Apply CCZ"}
              </p>
              <p className="text-xs opacity-80">
                {!cczEligible && !isHousekeepJob
                  ? "Only jobs with EC1–4, WC1–2, W1, SW1 or SE1 in the address can turn CCZ on"
                  : inCczPreview
                    ? "+£15 applied"
                    : "Turn on only inside the central CCZ postcode list"}
              </p>
            </button>
            <button
              type="button"
              disabled={isHousekeepJob}
              onClick={() => setForm((prev) => ({ ...prev, has_free_parking: !prev.has_free_parking }))}
              className={cn(
                "text-left rounded-lg border px-3 py-2 text-sm transition-colors",
                isHousekeepJob && "opacity-50 cursor-not-allowed",
                !form.has_free_parking ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card text-text-secondary",
              )}
            >
              <p className="font-medium">{form.has_free_parking ? "Add parking" : "Parking fee applied"}</p>
              <p className="text-xs opacity-80">{form.has_free_parking ? "No charge applied" : "+£15 applied"}</p>
            </button>
          </div>
          <p className="text-xs text-text-tertiary">If the customer doesn&apos;t have free parking, click here to charge: <span className="font-semibold text-text-primary">{formatCurrency(accessSurchargePreview)}</span></p>
        </div>
        <div className="rounded-xl border border-border-light bg-surface-hover/30 p-3 sm:p-4 space-y-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner allocation</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, assignment_mode: "manual" }))}
              className={cn(
                "text-left rounded-lg border px-3 py-2 text-sm transition-colors",
                form.assignment_mode === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-text-secondary",
              )}
            >
              <p className="font-medium">Allocate partner</p>
              <p className="text-xs opacity-80">Pick a specific partner now</p>
            </button>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, assignment_mode: "auto", partner_id: "" }))}
              className={cn(
                "text-left rounded-lg border px-3 py-2 text-sm transition-colors",
                form.assignment_mode === "auto" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-text-secondary",
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
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border-light bg-card p-1.5 space-y-1.5">
                <label
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                    !form.partner_id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30",
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
                    onChange={() => update("partner_id", "")}
                  />
                </label>
                {filteredPartners.map((p) => {
                  const pid = p.id;
                  const selected = form.partner_id === pid;
                  const match = targetWorkType ? safePartnerMatchesTypeOfWork(p, targetWorkType) : false;
                  return (
                    <label
                      key={pid}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : match
                            ? "border-amber-400 bg-amber-50/90 dark:border-amber-500/70 dark:bg-amber-950/50 hover:border-primary/30"
                            : "border-border hover:border-primary/30",
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
                          {p.trade ?? "—"} · {p.location ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {match ? <Badge variant="warning" size="sm">Match</Badge> : null}
                        <input
                          type="radio"
                          name="partner-select"
                          className="h-4 w-4"
                          checked={selected}
                          onChange={() => update("partner_id", pid)}
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
        </div>
        {form.job_type === "hourly" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-lg border border-border-light bg-card px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-tertiary">Price</p>
                <p className="text-sm font-semibold text-text-primary">{formatCurrency(hourlyPreview.clientTotal + accessSurchargePreview)}</p>
              </div>
              <div className="rounded-lg border border-border-light bg-card px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-tertiary">Cost</p>
                <p className="text-sm font-semibold text-text-primary">{formatCurrency(hourlyPreview.partnerTotal)}</p>
              </div>
              <div className="rounded-lg border border-border-light bg-card px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-tertiary">Margin</p>
                <p className="text-sm font-semibold text-text-primary">{hourlyMarginPct}%</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner hourly rate</label><Input type="number" value={form.hourly_partner_rate} onChange={(e) => update("hourly_partner_rate", e.target.value)} min="0" step="0.01" /></div>
              <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Initial billed hours</label><Input type="number" value={form.billed_hours} onChange={(e) => update("billed_hours", e.target.value)} min="1" step="0.5" /></div>
            </div>
            <p className="text-[11px] text-text-tertiary">Client hourly rate is loaded from Call Out type: {formatCurrency(Number(form.hourly_client_rate) || 0)}/h.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Client Price</label><Input type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} min="0" step="0.01" /></div>
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Cost</label><Input type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} min="0" step="0.01" /></div>
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Materials Cost</label><Input type="number" value={form.materials_cost} onChange={(e) => update("materials_cost", e.target.value)} min="0" step="0.01" /></div>
          </div>
        )}
        {form.job_type === "hourly" && (
          <p className="text-[11px] text-text-tertiary -mt-2">
            Billing rule: up to 1h = 1h minimum, then rounds up in 30-minute increments from timer logs.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Job</Button>
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
      const finish = jobFinishYmd(job);
      const startsThisMonth = start.y === year && start.m === month + 1;
      const finishesThisMonth = !!finish && finish.y === year && finish.m === month + 1;

      if (startsThisMonth) {
        if (!map[start.d]) map[start.d] = [];
        map[start.d].push({ job, kind: "start" });
      }
      if (finishesThisMonth) {
        if (!map[finish!.d]) map[finish!.d] = [];
        map[finish!.d].push({ job, kind: "end" });
      }

      if (!finish) continue;
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
        const mapSched = formatJobScheduleLine(j);
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
              <p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p>
              <p className="text-xs text-text-tertiary truncate mt-0.5">{normalizeTypeOfWork(j.title) || j.title}</p>
              <p className="text-xs text-text-tertiary truncate mt-1">{j.property_address}</p>
              {mapSched ? <p className="text-[10px] text-text-secondary mt-1.5 line-clamp-2 leading-snug">{mapSched}</p> : null}
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
  return <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>{label}</button>;
}
