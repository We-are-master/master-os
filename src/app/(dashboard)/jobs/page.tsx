"use client";

import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import { Progress } from "@/components/ui/progress";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, List, LayoutGrid, Calendar, Map,
  ArrowRight, Briefcase, DollarSign, Clock,
  MapPin, User, Building2, Wrench, TrendingUp,
  Play, Pause, CheckCircle2, RotateCcw, Send,
  FileText, Receipt, CreditCard, AlertTriangle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listJobs, createJob, updateJob, getJob } from "@/services/jobs";
import { getSupabase, getStatusCounts } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import type { Job } from "@/types/database";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { KanbanBoard } from "@/components/shared/kanban-board";

const JOB_STATUSES = ["ready_to_start", "in_progress", "final_check", "send_report", "awaiting_payment", "paid", "on_hold", "completed", "cancelled"] as const;

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  ready_to_start: { label: "Ready to Start", variant: "info", dot: true },
  in_progress: { label: "In Progress", variant: "primary", dot: true },
  final_check: { label: "Final Check", variant: "warning", dot: true },
  send_report: { label: "Send Report", variant: "warning", dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: "danger", dot: true },
  paid: { label: "Paid", variant: "success", dot: true },
  on_hold: { label: "On Hold", variant: "danger", dot: true },
  completed: { label: "Completed", variant: "success", dot: true },
  cancelled: { label: "Cancelled", variant: "default" },
  pending_schedule: { label: "Pending Schedule", variant: "warning", dot: true },
};

function JobsPageContent() {
  const searchParams = useSearchParams();
  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refresh,
  } = useSupabaseList<Job>({ fetcher: listJobs });

  const { profile } = useProfile();
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterPartner, setFilterPartner] = useState<"all" | "with" | "without">("all");
  const [filterScheduled, setFilterScheduled] = useState<"all" | "scheduled" | "unscheduled">("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const filteredData = useMemo(() => {
    return data.filter((j) => {
      if (filterPartner === "with" && !j.partner_id && !j.partner_name) return false;
      if (filterPartner === "without" && (j.partner_id || j.partner_name)) return false;
      const hasDate = !!(j.scheduled_date || j.scheduled_start_at);
      if (filterScheduled === "scheduled" && !hasDate) return false;
      if (filterScheduled === "unscheduled" && hasDate) return false;
      return true;
    });
  }, [data, filterPartner, filterScheduled]);

  const kanbanColumns = useMemo(() => {
    const statusIds = ["ready_to_start", "in_progress", "final_check", "awaiting_payment", "paid"];
    return statusIds.map((id) => ({
      id,
      title: statusConfig[id]?.label ?? id,
      color: id === "paid" ? "bg-emerald-500" : id === "awaiting_payment" ? "bg-amber-500" : "bg-primary",
      items: filteredData.filter((j) => j.status === id),
    }));
  }, [filteredData]);

  const jobIdFromUrl = searchParams.get("jobId");
  useEffect(() => {
    if (!jobIdFromUrl) return;
    getJob(jobIdFromUrl).then((job) => { if (job) setSelectedJob(job); });
  }, [jobIdFromUrl]);

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("jobs", [...JOB_STATUSES]);
      setTabCounts(counts);
    } catch { /* cosmetic */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const tabs = [
    { id: "all", label: "All Jobs", count: tabCounts.all ?? 0 },
    { id: "ready_to_start", label: "Ready to Start", count: tabCounts.ready_to_start ?? 0 },
    { id: "in_progress", label: "In Progress", count: tabCounts.in_progress ?? 0 },
    { id: "final_check", label: "Final Check", count: tabCounts.final_check ?? 0 },
    { id: "send_report", label: "Send Report", count: tabCounts.send_report ?? 0 },
    { id: "awaiting_payment", label: "Awaiting Payment", count: tabCounts.awaiting_payment ?? 0 },
    { id: "paid", label: "Paid", count: tabCounts.paid ?? 0 },
  ];

  const handleCreate = useCallback(
    async (formData: Partial<Job>) => {
      const clientPrice = formData.client_price ?? 0;
      const partnerCost = formData.partner_cost ?? 0;
      const materialsCost = formData.materials_cost ?? 0;
      const margin = clientPrice > 0 ? Math.round(((clientPrice - partnerCost - materialsCost) / clientPrice) * 1000) / 10 : 0;
      try {
        const result = await createJob({
          title: formData.title ?? "", client_name: formData.client_name ?? "",
          property_address: formData.property_address ?? "",
          partner_name: formData.partner_name, partner_id: formData.partner_id,
          owner_id: formData.owner_id, owner_name: formData.owner_name,
          status: "ready_to_start", progress: 0, current_phase: 0,
          total_phases: formData.total_phases ?? 3,
          client_price: clientPrice, partner_cost: partnerCost,
          materials_cost: materialsCost, margin_percent: margin,
          scheduled_date: formData.scheduled_date,
          scheduled_start_at: formData.scheduled_start_at,
          cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
          partner_agreed_value: 0, finance_status: "unpaid", report_submitted: false,
        });
        await logAudit({
          entityType: "job", entityId: result.id, entityRef: result.reference,
          action: "created", userId: profile?.id, userName: profile?.full_name,
        });
        setCreateOpen(false);
        toast.success("Job created successfully");
        refresh();
        loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create job");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const handleStatusChange = useCallback(
    async (job: Job, newStatus: Job["status"]) => {
      try {
        const updated = await updateJob(job.id, { status: newStatus });
        await logAudit({
          entityType: "job", entityId: job.id, entityRef: job.reference,
          action: "status_changed", fieldName: "status",
          oldValue: job.status, newValue: newStatus,
          userId: profile?.id, userName: profile?.full_name,
        });
        setSelectedJob(updated);
        toast.success(`Job moved to ${statusConfig[newStatus]?.label ?? newStatus}`);
        refresh();
        loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update status");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const handleFinanceUpdate = useCallback(
    async (jobId: string, updates: Partial<Job>) => {
      try {
        const autoStatusUpdate: Partial<Job> = {};
        if (updates.finance_status === "paid") {
          autoStatusUpdate.status = "paid";
        }
        const updated = await updateJob(jobId, { ...updates, ...autoStatusUpdate });
        setSelectedJob(updated);
        if (autoStatusUpdate.status) {
          toast.success("Finance marked as paid — status automatically updated to Paid");
        } else {
          toast.success("Finance updated");
        }
        refresh();
        loadCounts();
      } catch {
        toast.error("Failed to update finance");
      }
    },
    [refresh, loadCounts]
  );

  const handleScheduleUpdate = useCallback(
    async (jobId: string, updates: { scheduled_start_at?: string; scheduled_date?: string }) => {
      try {
        const updated = await updateJob(jobId, updates);
        setSelectedJob(updated);
        toast.success("Schedule updated");
      } catch { toast.error("Failed to update schedule"); }
    },
    []
  );

  const handleProgressUpdate = useCallback(
    async (job: Job, newPhase: number) => {
      const totalPhases = job.total_phases || 1;
      const progress = Math.round((newPhase / totalPhases) * 100);
      const isComplete = newPhase >= totalPhases;
      try {
        const updated = await updateJob(job.id, {
          current_phase: newPhase, progress,
          ...(isComplete ? { status: "final_check" as Job["status"] } : {}),
        });
        await logAudit({
          entityType: "job", entityId: job.id, entityRef: job.reference,
          action: "phase_advanced", fieldName: "current_phase",
          oldValue: String(job.current_phase), newValue: String(newPhase),
          userId: profile?.id, userName: profile?.full_name,
        });
        setSelectedJob(updated);
        toast.success(isComplete ? "All phases complete — moved to Final Check" : `Progress updated to phase ${newPhase}/${totalPhases}`);
        refresh();
        if (isComplete) loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update progress");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("jobs").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("job", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} jobs updated to ${newStatus}`);
      setSelectedIds(new Set());
      refresh();
    } catch { toast.error("Failed to update jobs"); }
  };

  const columns: Column<Job>[] = [
    {
      key: "reference", label: "Job", width: "180px",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
          <p className="text-[11px] text-text-tertiary">{item.title}</p>
        </div>
      ),
    },
    {
      key: "client_name", label: "Client / Property",
      render: (item) => (
        <div>
          <p className="text-sm font-medium text-text-primary">{item.client_name}</p>
          <p className="text-[11px] text-text-tertiary truncate max-w-[180px]">{item.property_address}</p>
        </div>
      ),
    },
    {
      key: "partner_name", label: "Partner",
      render: (item) =>
        item.partner_name ? (
          <div className="flex items-center gap-2">
            <Avatar name={item.partner_name} size="xs" />
            <span className="text-sm text-text-secondary">{item.partner_name}</span>
          </div>
        ) : (
          <span className="text-xs text-text-tertiary italic">Unassigned</span>
        ),
    },
    {
      key: "scheduled", label: "Scheduled",
      render: (item) =>
        item.scheduled_start_at ? (
          <div>
            <p className="text-xs font-medium text-text-primary">{new Date(item.scheduled_start_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
            <p className="text-[11px] text-text-tertiary">{new Date(item.scheduled_start_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        ) : item.scheduled_date ? (
          <p className="text-xs text-text-primary">{new Date(item.scheduled_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
        ) : (
          <span className="text-xs text-text-tertiary italic">—</span>
        ),
    },
    {
      key: "margin_percent", label: "Financial",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{formatCurrency(item.client_price)}</p>
          <span className={`text-[11px] font-medium ${item.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>
            {item.margin_percent}% margin
          </span>
        </div>
      ),
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const config = statusConfig[item.status] ?? { label: item.status, variant: "default" as const };
        return <Badge variant={config.variant} dot={config.dot}>{config.label}</Badge>;
      },
    },
    {
      key: "finance_status", label: "Finance",
      render: (item) => {
        const fs = item.finance_status ?? "unpaid";
        return (
          <Badge variant={fs === "paid" ? "success" : fs === "partial" ? "warning" : "default"} size="sm">
            {fs === "paid" ? "Paid" : fs === "partial" ? "Partial" : "Unpaid"}
          </Badge>
        );
      },
    },
    {
      key: "actions", label: "", width: "40px",
      render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors" />,
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Jobs Management" subtitle="Track and manage all active jobs and operations.">
          <div className="relative flex items-center gap-2" ref={filterRef}>
            <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setFilterOpen((o) => !o)}>Filter</Button>
            {(filterPartner !== "all" || filterScheduled !== "all") && (
              <span className="text-[10px] font-medium text-primary">Active</span>
            )}
            {filterOpen && (
              <div className="absolute top-full right-0 mt-1 w-56 rounded-xl border border-border bg-card shadow-lg z-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Partner</p>
                <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value as "all" | "with" | "without")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                  <option value="all">All</option>
                  <option value="with">With partner</option>
                  <option value="without">Without partner</option>
                </select>
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Scheduled</p>
                <select value={filterScheduled} onChange={(e) => setFilterScheduled(e.target.value as "all" | "scheduled" | "unscheduled")} className="w-full h-8 rounded-lg border border-border bg-card text-sm text-text-primary px-2">
                  <option value="all">All</option>
                  <option value="scheduled">Has date</option>
                  <option value="unscheduled">No date</option>
                </select>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFilterPartner("all"); setFilterScheduled("all"); }}>Clear filters</Button>
              </div>
            )}
          </div>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Job</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard title="Active Jobs" value={(tabCounts.in_progress ?? 0) + (tabCounts.ready_to_start ?? 0)} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="Awaiting Payment" value={tabCounts.awaiting_payment ?? 0} format="number" icon={DollarSign} accent="amber" />
          <KpiCard title="Paid" value={tabCounts.paid ?? 0} format="number" icon={CheckCircle2} accent="emerald" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[
                  { id: "list", icon: List }, { id: "kanban", icon: LayoutGrid },
                  { id: "calendar", icon: Calendar }, { id: "map", icon: Map },
                ].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)}
                    className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <SearchInput placeholder="Search jobs..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {viewMode === "list" && (
            <DataTable
              columns={columns} data={data} loading={loading}
              getRowId={(item) => item.id} selectedId={selectedJob?.id}
              onRowClick={setSelectedJob}
              page={page} totalPages={totalPages} totalItems={totalItems} onPageChange={setPage}
              selectable selectedIds={selectedIds} onSelectionChange={setSelectedIds}
              bulkActions={
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                  <BulkBtn label="In Progress" onClick={() => handleBulkStatusChange("in_progress")} variant="success" />
                  <BulkBtn label="On Hold" onClick={() => handleBulkStatusChange("on_hold")} variant="warning" />
                  <BulkBtn label="Final Check" onClick={() => handleBulkStatusChange("final_check")} variant="warning" />
                  <BulkBtn label="Paid" onClick={() => handleBulkStatusChange("paid")} variant="success" />
                  <BulkBtn label="Cancel" onClick={() => handleBulkStatusChange("cancelled")} variant="danger" />
                </div>
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
                  onCardClick={setSelectedJob}
                  renderCard={(j) => (
                    <div className="p-3 rounded-xl border border-border bg-card shadow-sm hover:border-primary/30 transition-colors">
                      <p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p>
                      <p className="text-xs text-text-tertiary truncate">{j.title}</p>
                      <p className="text-[11px] text-text-secondary mt-1">{j.client_name}</p>
                      <p className="text-xs font-medium text-primary mt-1">{formatCurrency(j.client_price)}</p>
                    </div>
                  )}
                />
              )}
            </div>
          )}
          {viewMode === "calendar" && (
            <JobsCalendarView jobs={filteredData} loading={loading} onSelectJob={setSelectedJob} />
          )}
          {viewMode === "map" && (
            <JobsMapView jobs={filteredData} loading={loading} onSelectJob={setSelectedJob} />
          )}
        </motion.div>
      </div>

      <JobDetailDrawer
        job={selectedJob} onClose={() => setSelectedJob(null)}
        onStatusChange={handleStatusChange}
        onProgressUpdate={handleProgressUpdate}
        onScheduleUpdate={handleScheduleUpdate}
        onFinanceUpdate={handleFinanceUpdate}
      />

      <CreateJobModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
    </PageTransition>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-text-tertiary">Loading...</div>}>
      <JobsPageContent />
    </Suspense>
  );
}

function JobDetailDrawer({
  job, onClose, onStatusChange, onProgressUpdate, onScheduleUpdate, onFinanceUpdate,
}: {
  job: Job | null;
  onClose: () => void;
  onStatusChange: (job: Job, status: Job["status"]) => void;
  onProgressUpdate: (job: Job, phase: number) => void;
  onScheduleUpdate: (jobId: string, updates: { scheduled_start_at?: string; scheduled_date?: string }) => void;
  onFinanceUpdate: (jobId: string, updates: Partial<Job>) => void;
}) {
  const [tab, setTab] = useState("details");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [financeForm, setFinanceForm] = useState({
    cash_in: "", cash_out: "", expenses: "", partner_cost: "", commission: "", vat: "", partner_agreed_value: "",
  });

  useEffect(() => {
    if (job?.scheduled_start_at) {
      const d = new Date(job.scheduled_start_at);
      setScheduleDate(d.toISOString().slice(0, 10));
      setScheduleTime(d.toTimeString().slice(0, 5));
    } else if (job?.scheduled_date) {
      setScheduleDate(job.scheduled_date);
      setScheduleTime("");
    } else { setScheduleDate(""); setScheduleTime(""); }
  }, [job?.id, job?.scheduled_start_at, job?.scheduled_date]);

  useEffect(() => {
    if (job) {
      setFinanceForm({
        cash_in: String(job.cash_in ?? 0),
        cash_out: String(job.cash_out ?? 0),
        expenses: String(job.expenses ?? 0),
        partner_cost: String(job.partner_cost ?? 0),
        commission: String(job.commission ?? 0),
        vat: String(job.vat ?? 0),
        partner_agreed_value: String(job.partner_agreed_value ?? 0),
      });
    }
  }, [job?.id, job?.cash_in, job?.cash_out, job?.expenses, job?.partner_cost, job?.commission, job?.vat, job?.partner_agreed_value]);

  const handleScheduleChange = (date: string, time: string) => {
    if (!job) return;
    const scheduled_date = date || undefined;
    const scheduled_start_at = date && time ? `${date}T${time}:00` : date ? `${date}T09:00:00` : undefined;
    onScheduleUpdate(job.id, { scheduled_start_at, scheduled_date });
  };

  useEffect(() => { setTab("details"); }, [job?.id]);

  if (!job) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[job.status] ?? { label: job.status, variant: "default" as const };
  const profit = job.client_price - job.partner_cost - job.materials_cost;
  const canAdvancePhase = job.current_phase < job.total_phases && job.status === "in_progress";
  const statusActions = getStatusActions(job.status);

  const cashIn = Number(financeForm.cash_in) || 0;
  const cashOut = Number(financeForm.cash_out) || 0;
  const expenses = Number(financeForm.expenses) || 0;
  const partnerCostFin = Number(financeForm.partner_cost) || 0;
  const commission = Number(financeForm.commission) || 0;
  const vat = Number(financeForm.vat) || 0;
  const totalRevenue = cashIn;
  const totalCost = cashOut + expenses + partnerCostFin + commission;
  const finMargin = totalRevenue - totalCost;
  const finMarginPct = totalRevenue > 0 ? Math.round((finMargin / totalRevenue) * 1000) / 10 : 0;

  const drawerTabs = [
    { id: "details", label: "Details" },
    { id: "finance", label: "Finance" },
    { id: "timeline", label: "Timeline" },
    { id: "history", label: "History" },
  ];

  return (
    <Drawer open={!!job} onClose={onClose} title={job.reference} subtitle={job.title} width="w-[560px]">
      <div className="flex flex-col h-full">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} className="px-6 pt-2" />

        {/* DETAILS TAB */}
        {tab === "details" && (
          <div className="p-6 space-y-6 flex-1 overflow-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
                <div className="mt-1.5"><Badge variant={config.variant} dot={config.dot} size="md">{config.label}</Badge></div>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Progress</label>
                <div className="mt-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-text-primary">{job.progress}%</span>
                    <span className="text-xs text-text-tertiary">Phase {job.current_phase}/{job.total_phases}</span>
                  </div>
                  <Progress value={job.progress} size="md" color={job.progress === 100 ? "emerald" : "primary"} className="mt-1.5" />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
                <div className="flex items-center gap-3 mt-2">
                  <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-sm font-semibold text-text-primary">{job.client_name}</p>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Property</label>
                <div className="flex items-start gap-2 mt-1.5">
                  <MapPin className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
                  <p className="text-sm text-text-primary">{job.property_address}</p>
                </div>
                <LocationMiniMap address={job.property_address} className="mt-2" />
              </div>
            </div>

            {job.scope && (
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scope</label>
                <p className="text-sm text-text-primary mt-1">{job.scope}</p>
              </div>
            )}

            {job.internal_notes && (
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Internal Notes</label>
                <p className="text-sm text-text-primary mt-1">{job.internal_notes}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner</label>
                {job.partner_name ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar name={job.partner_name} size="sm" />
                    <p className="text-sm font-semibold text-text-primary">{job.partner_name}</p>
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary italic mt-2">Unassigned</p>
                )}
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job Owner</label>
                {job.owner_name ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar name={job.owner_name} size="sm" />
                    <p className="text-sm font-semibold text-text-primary">{job.owner_name}</p>
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary italic mt-2">No owner</p>
                )}
              </div>
            </div>

            {/* Scheduled */}
            <div className="p-3 rounded-xl bg-surface-hover">
              <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Scheduled</label>
              {job.scheduled_start_at ? (
                <p className="text-sm font-semibold text-text-primary mt-1.5">
                  {new Date(job.scheduled_start_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                  {" · "}
                  {new Date(job.scheduled_start_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </p>
              ) : job.scheduled_date ? (
                <p className="text-sm font-semibold text-text-primary mt-1.5">{new Date(job.scheduled_date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
              ) : (
                <p className="text-sm text-text-tertiary italic mt-1.5">Not scheduled</p>
              )}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-[10px] text-text-tertiary mb-0.5">Date</label>
                  <Input type="date" value={scheduleDate} onChange={(e) => { setScheduleDate(e.target.value); handleScheduleChange(e.target.value, scheduleTime); }} className="text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] text-text-tertiary mb-0.5">Time</label>
                  <Input type="time" value={scheduleTime} onChange={(e) => { setScheduleTime(e.target.value); handleScheduleChange(scheduleDate, e.target.value); }} className="text-xs" />
                </div>
              </div>
            </div>

            {/* Quick Financial */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-border-light">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-text-tertiary" />
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Financial Summary</label>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-sm text-text-secondary">Client Price</span><span className="text-sm font-semibold">{formatCurrency(job.client_price)}</span></div>
                <div className="flex justify-between"><span className="text-sm text-text-secondary">Partner Cost</span><span className="text-sm font-medium text-red-600">-{formatCurrency(job.partner_cost)}</span></div>
                <div className="flex justify-between"><span className="text-sm text-text-secondary">Materials</span><span className="text-sm font-medium text-red-600">-{formatCurrency(job.materials_cost)}</span></div>
                <div className="border-t border-border pt-2 mt-2">
                  <div className="flex justify-between"><span className="text-sm font-semibold">Profit</span><span className={`text-lg font-bold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(profit)}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-xs text-text-tertiary">Margin</span><span className={`text-xs font-semibold ${job.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>{job.margin_percent}%</span></div>
                </div>
              </div>
            </div>

            {/* Phase Progress */}
            {canAdvancePhase && (
              <div className="p-4 rounded-xl bg-primary/[0.03] border border-primary/10">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Advance to Phase {job.current_phase + 1}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{job.current_phase + 1 === job.total_phases ? "This will move job to Final Check" : `${job.total_phases - job.current_phase - 1} phases remaining`}</p>
                  </div>
                  <Button size="sm" onClick={() => onProgressUpdate(job, job.current_phase + 1)} icon={<TrendingUp className="h-3.5 w-3.5" />}>Advance</Button>
                </div>
              </div>
            )}

            {/* Report Status */}
            {job.report_submitted && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700">Report submitted {job.report_submitted_at ? `on ${new Date(job.report_submitted_at).toLocaleDateString()}` : ""}</p>
                </div>
                {job.report_notes && <p className="text-xs text-emerald-600 mt-1">{job.report_notes}</p>}
              </div>
            )}

            <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
              <span>Created {new Date(job.created_at).toLocaleDateString()}</span>
              <span>Updated {new Date(job.updated_at).toLocaleDateString()}</span>
            </div>

            <div className="flex gap-2 pt-4 border-t border-border-light">
              {statusActions.map((action) => (
                <Button key={action.status} variant={action.primary ? "primary" : "outline"} className="flex-1" size="sm"
                  icon={<action.icon className="h-3.5 w-3.5" />} onClick={() => onStatusChange(job, action.status)}>
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* FINANCE TAB */}
        {tab === "finance" && (
          <div className="p-6 space-y-6 flex-1 overflow-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100">
                <p className="text-[10px] font-semibold text-emerald-700 uppercase">Total Revenue</p>
                <p className="text-xl font-bold text-emerald-700 mt-1">{formatCurrency(totalRevenue)}</p>
              </div>
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-100">
                <p className="text-[10px] font-semibold text-red-700 uppercase">Total Cost</p>
                <p className="text-xl font-bold text-red-700 mt-1">{formatCurrency(totalCost)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Margin</p>
                <p className={`text-xl font-bold mt-1 ${finMargin >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(finMargin)}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase">Margin %</p>
                <p className={`text-xl font-bold mt-1 ${finMarginPct >= 20 ? "text-emerald-600" : "text-amber-600"}`}>{finMarginPct}%</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Cash In</label>
                  <Input type="number" value={financeForm.cash_in} onChange={(e) => setFinanceForm((p) => ({ ...p, cash_in: e.target.value }))} min={0} step="0.01" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Cash Out</label>
                  <Input type="number" value={financeForm.cash_out} onChange={(e) => setFinanceForm((p) => ({ ...p, cash_out: e.target.value }))} min={0} step="0.01" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Expenses</label>
                  <Input type="number" value={financeForm.expenses} onChange={(e) => setFinanceForm((p) => ({ ...p, expenses: e.target.value }))} min={0} step="0.01" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Partner Cost</label>
                  <Input type="number" value={financeForm.partner_cost} onChange={(e) => setFinanceForm((p) => ({ ...p, partner_cost: e.target.value }))} min={0} step="0.01" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Commission</label>
                  <Input type="number" value={financeForm.commission} onChange={(e) => setFinanceForm((p) => ({ ...p, commission: e.target.value }))} min={0} step="0.01" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">VAT</label>
                  <Input type="number" value={financeForm.vat} onChange={(e) => setFinanceForm((p) => ({ ...p, vat: e.target.value }))} min={0} step="0.01" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Partner Agreed Value</label>
                <Input type="number" value={financeForm.partner_agreed_value} onChange={(e) => setFinanceForm((p) => ({ ...p, partner_agreed_value: e.target.value }))} min={0} step="0.01" />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => onFinanceUpdate(job.id, {
                  cash_in: Number(financeForm.cash_in) || 0,
                  cash_out: Number(financeForm.cash_out) || 0,
                  expenses: Number(financeForm.expenses) || 0,
                  partner_cost: Number(financeForm.partner_cost) || 0,
                  commission: Number(financeForm.commission) || 0,
                  vat: Number(financeForm.vat) || 0,
                  partner_agreed_value: Number(financeForm.partner_agreed_value) || 0,
                })}
                icon={<DollarSign className="h-3.5 w-3.5" />}
              >
                Save Finance
              </Button>
              <Button
                variant={job.finance_status === "paid" ? "outline" : "primary"}
                onClick={() => onFinanceUpdate(job.id, { finance_status: "paid" })}
                icon={<CreditCard className="h-3.5 w-3.5" />}
              >
                Mark as Paid
              </Button>
            </div>

            {job.finance_status === "paid" && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700">Finance is marked as Paid</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TIMELINE TAB */}
        {tab === "timeline" && (
          <div className="p-6 space-y-4 flex-1 overflow-auto">
            <p className="text-sm font-semibold text-text-primary">Job Timeline</p>
            <div className="space-y-3">
              <TimelineItem label="Created" date={job.created_at} active />
              {job.scheduled_date && <TimelineItem label="Scheduled" date={job.scheduled_date} active />}
              {job.status !== "ready_to_start" && job.status !== "cancelled" && (
                <TimelineItem label="In Progress" date={job.updated_at} active={["in_progress", "final_check", "send_report", "awaiting_payment", "paid", "completed"].includes(job.status)} />
              )}
              {["final_check", "send_report", "awaiting_payment", "paid", "completed"].includes(job.status) && (
                <TimelineItem label="Final Check" date={job.updated_at} active />
              )}
              {job.report_submitted && <TimelineItem label="Report Submitted" date={job.report_submitted_at ?? job.updated_at} active />}
              {["awaiting_payment", "paid", "completed"].includes(job.status) && (
                <TimelineItem label="Awaiting Payment" date={job.updated_at} active />
              )}
              {job.status === "paid" && <TimelineItem label="Paid" date={job.updated_at} active />}
              {job.status === "completed" && <TimelineItem label="Completed" date={job.completed_date ?? job.updated_at} active />}
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === "history" && (
          <div className="p-6">
            <AuditTimeline entityType="job" entityId={job.id} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function TimelineItem({ label, date, active }: { label: string; date: string; active: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-1 h-3 w-3 rounded-full border-2 ${active ? "border-primary bg-primary" : "border-border bg-card"}`} />
      <div>
        <p className={`text-sm font-medium ${active ? "text-text-primary" : "text-text-tertiary"}`}>{label}</p>
        <p className="text-[11px] text-text-tertiary">{new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
      </div>
    </div>
  );
}

function getStatusActions(currentStatus: string) {
  switch (currentStatus) {
    case "ready_to_start":
    case "pending_schedule":
      return [
        { label: "Start Job", status: "in_progress" as Job["status"], icon: Play, primary: true },
        { label: "Cancel", status: "cancelled" as Job["status"], icon: RotateCcw, primary: false },
      ];
    case "in_progress":
      return [
        { label: "Final Check", status: "final_check" as Job["status"], icon: CheckCircle2, primary: true },
        { label: "On Hold", status: "on_hold" as Job["status"], icon: Pause, primary: false },
      ];
    case "final_check":
      return [
        { label: "Send Report", status: "send_report" as Job["status"], icon: Send, primary: true },
        { label: "Back to Progress", status: "in_progress" as Job["status"], icon: RotateCcw, primary: false },
      ];
    case "send_report":
      return [
        { label: "Awaiting Payment", status: "awaiting_payment" as Job["status"], icon: CreditCard, primary: true },
        { label: "Back to Check", status: "final_check" as Job["status"], icon: RotateCcw, primary: false },
      ];
    case "awaiting_payment":
      return [
        { label: "Mark Paid", status: "paid" as Job["status"], icon: DollarSign, primary: true },
      ];
    case "paid":
      return [
        { label: "Complete", status: "completed" as Job["status"], icon: CheckCircle2, primary: true },
      ];
    case "on_hold":
      return [
        { label: "Resume", status: "in_progress" as Job["status"], icon: Play, primary: true },
        { label: "Cancel", status: "cancelled" as Job["status"], icon: RotateCcw, primary: false },
      ];
    case "completed":
      return [
        { label: "Reopen", status: "in_progress" as Job["status"], icon: RotateCcw, primary: false },
      ];
    case "cancelled":
      return [
        { label: "Reopen", status: "ready_to_start" as Job["status"], icon: RotateCcw, primary: false },
      ];
    default:
      return [];
  }
}

function CreateJobModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (data: Partial<Job>) => void }) {
  const [form, setForm] = useState({
    title: "", client_name: "", property_address: "", partner_name: "",
    client_price: "", partner_cost: "", materials_cost: "", total_phases: "3",
    scheduled_date: "", scheduled_time: "",
  });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.client_name || !form.property_address) { toast.error("Please fill in all required fields"); return; }
    const scheduled_date = form.scheduled_date || undefined;
    const scheduled_start_at = form.scheduled_date && form.scheduled_time ? `${form.scheduled_date}T${form.scheduled_time}:00` : form.scheduled_date ? `${form.scheduled_date}T09:00:00` : undefined;
    onCreate({
      title: form.title, client_name: form.client_name, property_address: form.property_address,
      partner_name: form.partner_name || undefined,
      client_price: form.client_price ? Number(form.client_price) : 0,
      partner_cost: form.partner_cost ? Number(form.partner_cost) : 0,
      materials_cost: form.materials_cost ? Number(form.materials_cost) : 0,
      total_phases: form.total_phases ? Number(form.total_phases) : 3,
      scheduled_date, scheduled_start_at,
    });
    setForm({ title: "", client_name: "", property_address: "", partner_name: "", client_price: "", partner_cost: "", materials_cost: "", total_phases: "3", scheduled_date: "", scheduled_time: "" });
  };

  return (
    <Modal open={open} onClose={onClose} title="New Job" subtitle="Create a new job" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Job Title *</label><Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. HVAC Installation" required /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Client Name *</label><Input value={form.client_name} onChange={(e) => update("client_name", e.target.value)} required /></div>
        </div>
        <AddressAutocomplete label="Property Address *" value={form.property_address} onSelect={(parts) => update("property_address", parts.full_address)} placeholder="Start typing address..." />
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Date</label><Input type="date" value={form.scheduled_date} onChange={(e) => update("scheduled_date", e.target.value)} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Time</label><Input type="time" value={form.scheduled_time} onChange={(e) => update("scheduled_time", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Name</label><Input value={form.partner_name} onChange={(e) => update("partner_name", e.target.value)} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Total Phases</label><Input type="number" value={form.total_phases} onChange={(e) => update("total_phases", e.target.value)} min="1" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Client Price</label><Input type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} min="0" step="0.01" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Cost</label><Input type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} min="0" step="0.01" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Materials Cost</label><Input type="number" value={form.materials_cost} onChange={(e) => update("materials_cost", e.target.value)} min="0" step="0.01" /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Job</Button>
        </div>
      </form>
    </Modal>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function JobsCalendarView({ jobs, loading, onSelectJob }: { jobs: Job[]; loading: boolean; onSelectJob: (j: Job) => void }) {
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

  const jobsByDay = useMemo(() => {
    const map: Record<number, Job[]> = {};
    for (const job of jobs) {
      const d = job.scheduled_date || (job.scheduled_start_at ? job.scheduled_start_at.slice(0, 10) : null);
      if (!d) continue;
      const [y, m, day] = d.split("-").map(Number);
      if (y !== year || m !== month + 1) continue;
      if (!map[day]) map[day] = [];
      map[day].push(job);
    }
    return map;
  }, [jobs, year, month]);

  if (loading) return <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div>;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button type="button" onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }} className="p-1 rounded-lg hover:bg-surface-hover">
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>
        <span className="text-sm font-semibold text-text-primary">{MONTHS[month]} {year}</span>
        <button type="button" onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }} className="p-1 rounded-lg hover:bg-surface-hover">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border p-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[10px] font-semibold text-text-tertiary text-center py-1">{d}</div>
        ))}
        {calendarDays.map((day, i) => (
          <div key={i} className="min-h-[80px] bg-card p-1.5">
            {day != null ? (
              <>
                <span className="text-xs font-medium text-text-secondary">{day}</span>
                {(jobsByDay[day] ?? []).slice(0, 2).map((j) => (
                  <button key={j.id} type="button" onClick={() => onSelectJob(j)} className="block w-full text-left mt-1 px-1.5 py-1 rounded bg-primary/10 text-primary text-[10px] font-medium truncate">
                    {j.reference}
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
      {withAddress.slice(0, 12).map((j) => (
        <button key={j.id} type="button" onClick={() => onSelectJob(j)} className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
          <p className="text-sm font-semibold text-text-primary">{j.reference}</p>
          <p className="text-xs text-text-tertiary truncate">{j.property_address}</p>
          <div className="mt-2 h-24 rounded-lg overflow-hidden bg-surface-hover">
            <LocationMiniMap address={j.property_address} className="h-full w-full" />
          </div>
        </button>
      ))}
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
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>{label}</button>
  );
}
