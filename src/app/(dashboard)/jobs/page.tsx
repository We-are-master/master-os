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
  Plus, Filter, List, LayoutGrid, Calendar, Map,
  ArrowRight, Briefcase, DollarSign, Clock,
  MapPin, Building2, TrendingUp,
  Play, Pause, CheckCircle2, RotateCcw,
  CreditCard, AlertTriangle, ShieldCheck, XCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listJobs, createJob, updateJob, getJob } from "@/services/jobs";
import { createSelfBillFromJob } from "@/services/self-bills";
import { getSupabase, getStatusCounts } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import type { Job } from "@/types/database";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { logAudit, logBulkAction } from "@/services/audit";
import { KanbanBoard } from "@/components/shared/kanban-board";

const JOB_STATUSES = ["scheduled", "in_progress_phase1", "in_progress_phase2", "in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed"] as const;

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  scheduled: { label: "Scheduled", variant: "info", dot: true },
  in_progress_phase1: { label: "In Progress — Phase 1", variant: "primary", dot: true },
  in_progress_phase2: { label: "In Progress — Phase 2", variant: "primary", dot: true },
  in_progress_phase3: { label: "In Progress — Phase 3", variant: "primary", dot: true },
  final_check: { label: "Final Check", variant: "warning", dot: true },
  awaiting_payment: { label: "Awaiting Payment", variant: "danger", dot: true },
  need_attention: { label: "Need attention", variant: "warning", dot: true },
  completed: { label: "Completed", variant: "success", dot: true },
};

function JobsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data, loading, page, totalPages, totalItems, setPage, search, setSearch, status, setStatus, refresh } = useSupabaseList<Job>({ fetcher: listJobs });
  const { profile } = useProfile();
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterPartner, setFilterPartner] = useState<"all" | "with" | "without">("all");
  const [filterScheduled, setFilterScheduled] = useState<"all" | "scheduled" | "unscheduled">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false); }
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
    const ids = ["scheduled", "in_progress_phase1", "in_progress_phase2", "in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed"];
    return ids.map((id) => ({
      id, title: statusConfig[id]?.label ?? id,
      color: id === "completed" ? "bg-emerald-500" : id === "need_attention" ? "bg-amber-500" : id === "awaiting_payment" ? "bg-amber-500" : "bg-primary",
      items: filteredData.filter((j) => j.status === id),
    }));
  }, [filteredData]);

  const jobIdFromUrl = searchParams.get("jobId");
  useEffect(() => { if (jobIdFromUrl) router.replace(`/jobs/${jobIdFromUrl}`); }, [jobIdFromUrl, router]);

  const loadCounts = useCallback(async () => {
    try { const counts = await getStatusCounts("jobs", [...JOB_STATUSES]); setTabCounts(counts); } catch { /* cosmetic */ }
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const tabs = [
    { id: "all", label: "All Jobs", count: tabCounts.all ?? 0 },
    { id: "scheduled", label: "Scheduled", count: tabCounts.scheduled ?? 0 },
    { id: "in_progress_phase1", label: "Phase 1", count: tabCounts.in_progress_phase1 ?? 0 },
    { id: "in_progress_phase2", label: "Phase 2", count: tabCounts.in_progress_phase2 ?? 0 },
    { id: "in_progress_phase3", label: "Phase 3", count: tabCounts.in_progress_phase3 ?? 0 },
    { id: "final_check", label: "Final Check", count: tabCounts.final_check ?? 0 },
    { id: "awaiting_payment", label: "Awaiting Payment", count: tabCounts.awaiting_payment ?? 0 },
    { id: "need_attention", label: "Need attention", count: tabCounts.need_attention ?? 0 },
    { id: "completed", label: "Completed", count: tabCounts.completed ?? 0 },
  ];

  const handleCreate = useCallback(async (formData: Partial<Job>) => {
    const cp = formData.client_price ?? 0;
    const pc = formData.partner_cost ?? 0;
    const mc = formData.materials_cost ?? 0;
    const margin = cp > 0 ? Math.round(((cp - pc - mc) / cp) * 1000) / 10 : 0;
    try {
      const result = await createJob({
        title: formData.title ?? "",
        client_id: formData.client_id,
        client_address_id: formData.client_address_id,
        client_name: formData.client_name ?? "",
        property_address: formData.property_address ?? "",
        partner_name: formData.partner_name, partner_id: formData.partner_id,
        owner_id: formData.owner_id, owner_name: formData.owner_name,
        status: "scheduled", progress: 0, current_phase: 0, total_phases: 3,
        client_price: cp, partner_cost: pc, materials_cost: mc, margin_percent: margin,
        scheduled_date: formData.scheduled_date, scheduled_start_at: formData.scheduled_start_at,
        cash_in: 0, cash_out: 0, expenses: 0, commission: 0, vat: 0,
        partner_agreed_value: 0, finance_status: "unpaid", service_value: cp,
        report_submitted: false,
        report_1_uploaded: false, report_1_approved: false,
        report_2_uploaded: false, report_2_approved: false,
        report_3_uploaded: false, report_3_approved: false,
        partner_payment_1: 0, partner_payment_1_paid: false,
        partner_payment_2: 0, partner_payment_2_paid: false,
        partner_payment_3: 0, partner_payment_3_paid: false,
        customer_deposit: 0, customer_deposit_paid: false,
        customer_final_payment: 0, customer_final_paid: false,
      });
      await logAudit({ entityType: "job", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name });
      setCreateOpen(false);
      toast.success("Job created"); refresh(); loadCounts();
      router.push(`/jobs/${result.id}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create job"); }
  }, [refresh, loadCounts, profile?.id, profile?.full_name, router]);

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
      const updated = await updateJob(job.id, { status: newStatus, ...(selfBillId ? { self_bill_id: selfBillId } : {}) });
      await logAudit({ entityType: "job", entityId: job.id, entityRef: job.reference, action: "status_changed", fieldName: "status", oldValue: job.status, newValue: newStatus, userId: profile?.id, userName: profile?.full_name });
      toast.success(selfBillId ? `Self-bill created. Job moved to ${statusConfig[newStatus]?.label ?? newStatus}` : `Job moved to ${statusConfig[newStatus]?.label ?? newStatus}`);
      refresh(); loadCounts();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  }, [refresh, loadCounts, profile?.id, profile?.full_name]);

  const handleJobUpdate = useCallback(async (jobId: string, updates: Partial<Job>) => {
    try {
      await updateJob(jobId, updates);
      toast.success("Job updated"); refresh(); loadCounts();
    } catch { toast.error("Failed to update"); }
  }, [refresh, loadCounts]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("jobs").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("job", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} jobs updated`); setSelectedIds(new Set()); refresh();
    } catch { toast.error("Failed"); }
  };

  const columns: Column<Job>[] = [
    { key: "reference", label: "Job", width: "180px", render: (item) => (<div><p className="text-sm font-semibold text-text-primary">{item.reference}</p><p className="text-[11px] text-text-tertiary">{item.title}</p></div>) },
    { key: "client_name", label: "Client / Property", render: (item) => (<div><p className="text-sm font-medium text-text-primary">{item.client_name}</p><p className="text-[11px] text-text-tertiary truncate max-w-[180px]">{item.property_address}</p></div>) },
    { key: "partner_name", label: "Partner", render: (item) => item.partner_name ? (<div className="flex items-center gap-2"><Avatar name={item.partner_name} size="xs" /><span className="text-sm text-text-secondary">{item.partner_name}</span></div>) : <span className="text-xs text-text-tertiary italic">Unassigned</span> },
    { key: "status", label: "Status", render: (item) => { const c = statusConfig[item.status] ?? { label: item.status, variant: "default" as const }; return <Badge variant={c.variant} dot={c.dot}>{c.label}</Badge>; } },
    { key: "margin_percent", label: "Financial", render: (item) => (<div><p className="text-sm font-semibold text-text-primary">{formatCurrency(item.client_price)}</p><span className={`text-[11px] font-medium ${item.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>{item.margin_percent}% margin</span></div>) },
    { key: "finance_status", label: "Finance", render: (item) => { const fs = item.finance_status ?? "unpaid"; return <Badge variant={fs === "paid" ? "success" : fs === "partial" ? "warning" : "default"} size="sm">{fs === "paid" ? "Paid" : fs === "partial" ? "Partial" : "Unpaid"}</Badge>; } },
    { key: "actions", label: "", width: "40px", render: () => <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors" /> },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Jobs Management" subtitle="Track and manage all active jobs.">
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
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Job</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard title="Active Jobs" value={(tabCounts.in_progress_phase1 ?? 0) + (tabCounts.in_progress_phase2 ?? 0) + (tabCounts.in_progress_phase3 ?? 0) + (tabCounts.scheduled ?? 0)} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="Awaiting Payment" value={tabCounts.awaiting_payment ?? 0} format="number" icon={DollarSign} accent="amber" />
          <KpiCard title="Completed" value={tabCounts.completed ?? 0} format="number" icon={CheckCircle2} accent="emerald" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: Map }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}><Icon className="h-3.5 w-3.5" /></button>
                ))}
              </div>
              <SearchInput placeholder="Search jobs..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {viewMode === "list" && <DataTable columns={columns} data={data} loading={loading} getRowId={(item) => item.id} onRowClick={(job) => router.push(`/jobs/${job.id}`)} page={page} totalPages={totalPages} totalItems={totalItems} onPageChange={setPage} selectable selectedIds={selectedIds} onSelectionChange={setSelectedIds} bulkActions={<div className="flex items-center gap-2"><span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span><BulkBtn label="Phase 1" onClick={() => handleBulkStatusChange("in_progress_phase1")} variant="success" /><BulkBtn label="Completed" onClick={() => handleBulkStatusChange("completed")} variant="success" /></div>} />}
          {viewMode === "kanban" && <div className="min-h-[400px]">{loading ? <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div> : <KanbanBoard columns={kanbanColumns} getCardId={(j) => j.id} onCardClick={(j) => router.push(`/jobs/${j.id}`)} renderCard={(j) => (<div className="p-3 rounded-xl border border-border bg-card shadow-sm hover:border-primary/30 transition-colors cursor-pointer"><p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p><p className="text-xs text-text-tertiary truncate">{j.title}</p><p className="text-[11px] text-text-secondary mt-1">{j.client_name}</p><p className="text-xs font-medium text-primary mt-1">{formatCurrency(j.client_price)}</p></div>)} />}</div>}
          {viewMode === "calendar" && <JobsCalendarView jobs={filteredData} loading={loading} onSelectJob={(j) => router.push(`/jobs/${j.id}`)} />}
          {viewMode === "map" && <JobsMapView jobs={filteredData} loading={loading} onSelectJob={(j) => router.push(`/jobs/${j.id}`)} />}
        </motion.div>
      </div>

      <CreateJobModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
    </PageTransition>
  );
}

export default function JobsPage() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-text-tertiary">Loading...</div>}><JobsPageContent /></Suspense>;
}

/** 7 statuses with blocks: Ready to Book → Scheduled (partner+date); In Progress → Final Check (≥1 report); Final Check → Awaiting Payment (report approved). */
function canAdvanceJob(job: Job, nextStatus: string): { ok: boolean; message?: string } {
  if (nextStatus === "in_progress_phase1") {
    if (!job.partner_id && !job.partner_name?.trim()) return { ok: false, message: "Assign a partner before starting the job." };
    if (!job.scheduled_date && !job.scheduled_start_at) return { ok: false, message: "Set scheduled date before starting the job." };
  }
  if (nextStatus === "final_check") {
    const hasReport = job.report_1_uploaded || job.report_2_uploaded || job.report_3_uploaded;
    if (!hasReport) return { ok: false, message: "Upload at least one post-job report/photo before Final Check." };
  }
  if (nextStatus === "awaiting_payment") {
    const approved = job.report_1_approved || job.report_2_approved || job.report_3_approved;
    if (!approved) return { ok: false, message: "Ops must approve at least one report before Awaiting Payment." };
  }
  return { ok: true };
}

function getStatusActions(currentStatus: string) {
  switch (currentStatus) {
    case "scheduled":
      return [{ label: "Start Phase 1", status: "in_progress_phase1", icon: Play, primary: true }];
    case "in_progress_phase1":
      return [
        { label: "Advance to Phase 2", status: "in_progress_phase2", icon: TrendingUp, primary: true },
        { label: "Pause", status: "scheduled", icon: Pause, primary: false },
      ];
    case "in_progress_phase2":
      return [
        { label: "Advance to Phase 3", status: "in_progress_phase3", icon: TrendingUp, primary: true },
        { label: "Back to Phase 1", status: "in_progress_phase1", icon: RotateCcw, primary: false },
      ];
    case "in_progress_phase3":
      return [
        { label: "Final Check", status: "final_check", icon: CheckCircle2, primary: true },
        { label: "Back to Phase 2", status: "in_progress_phase2", icon: RotateCcw, primary: false },
      ];
    case "final_check":
      return [
        { label: "Awaiting Payment", status: "awaiting_payment", icon: CreditCard, primary: true },
        { label: "Back to Phase 3", status: "in_progress_phase3", icon: RotateCcw, primary: false },
      ];
    case "awaiting_payment":
      return [
        { label: "Mark Completed", status: "completed", icon: CheckCircle2, primary: true },
      ];
    case "need_attention":
      return [
        { label: "Validate & complete", status: "completed", icon: ShieldCheck, primary: true },
        { label: "Back to Phase 3", status: "in_progress_phase3", icon: RotateCcw, primary: false },
      ];
    case "completed":
      return [
        { label: "Reopen", status: "scheduled", icon: RotateCcw, primary: false },
      ];
    default:
      return [];
  }
}

/* ========== CREATE JOB MODAL ========== */
function CreateJobModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (data: Partial<Job>) => void }) {
  const [form, setForm] = useState({ title: "", partner_name: "", client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", scheduled_time: "" });
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) { toast.error("Job title is required"); return; }
    if (!clientAddress.client_id || !clientAddress.property_address) { toast.error("Please select a client and property address"); return; }
    const scheduled_date = form.scheduled_date || undefined;
    const scheduled_start_at = form.scheduled_date && form.scheduled_time ? `${form.scheduled_date}T${form.scheduled_time}:00` : form.scheduled_date ? `${form.scheduled_date}T09:00:00` : undefined;
    onCreate({
      title: form.title,
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      property_address: clientAddress.property_address,
      partner_name: form.partner_name || undefined,
      client_price: Number(form.client_price) || 0,
      partner_cost: Number(form.partner_cost) || 0,
      materials_cost: Number(form.materials_cost) || 0,
      scheduled_date,
      scheduled_start_at,
    });
    setForm({ title: "", partner_name: "", client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", scheduled_time: "" });
    setClientAddress({ client_name: "", property_address: "" });
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo Job" subtitle="Criar um novo job" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Job title *</label><Input value={form.title} onChange={(e) => update("title", e.target.value)} required /></div>
        <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Date</label><Input type="date" value={form.scheduled_date} onChange={(e) => update("scheduled_date", e.target.value)} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Scheduled Time</label><Input type="time" value={form.scheduled_time} onChange={(e) => update("scheduled_time", e.target.value)} /></div>
        </div>
        <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Name</label><Input value={form.partner_name} onChange={(e) => update("partner_name", e.target.value)} /></div>
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
                {(jobsByDay[day] ?? []).slice(0, 2).map((j) => (
                  <button key={j.id} type="button" onClick={() => onSelectJob(j)} className="block w-full text-left mt-1 px-1.5 py-1 rounded bg-primary/10 text-primary text-[10px] font-medium truncate">{j.reference}</button>
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
          <div className="mt-2 h-24 rounded-lg overflow-hidden bg-surface-hover"><LocationMiniMap address={j.property_address} className="h-full w-full" /></div>
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
  return <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>{label}</button>;
}
