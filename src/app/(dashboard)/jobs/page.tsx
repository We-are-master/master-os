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
import { TimeSelect } from "@/components/ui/time-select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import {
  Plus, Filter, List, LayoutGrid, Calendar, Map as MapIcon,
  ArrowRight, Briefcase, DollarSign, Clock,
  MapPin, Building2, TrendingUp,
  CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listJobs, createJob, updateJob, getJob } from "@/services/jobs";
import { createSelfBillFromJob } from "@/services/self-bills";
import { getSupabase, getStatusCounts, softDeleteById } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import type { Job, Partner } from "@/types/database";
import { listPartners } from "@/services/partners";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { ClientAddressPicker, type ClientAndAddressValue } from "@/components/ui/client-address-picker";
import { logAudit, logBulkAction } from "@/services/audit";
import { KanbanBoard } from "@/components/shared/kanban-board";
import { canAdvanceJob, isJobInProgressStatus, normalizeTotalPhases } from "@/lib/job-phases";
import { getPartnerAssignmentBlockReason, jobHasPartnerSet } from "@/lib/job-partner-assign";
import { jobFinishYmd, jobScheduleYmd } from "@/lib/schedule-calendar";

const JOB_STATUSES = ["scheduled", "late", "in_progress_phase1", "in_progress_phase2", "in_progress_phase3", "final_check", "awaiting_payment", "need_attention", "completed", "cancelled"] as const;

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
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

function JobsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data, loading, page, totalPages, totalItems, setPage, search, setSearch, status, setStatus, refresh } = useSupabaseList<Job>({ fetcher: listJobs, realtimeTable: "jobs" });
  const { profile } = useProfile();
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterPartner, setFilterPartner] = useState<"all" | "with" | "without">("all");
  const [filterScheduled, setFilterScheduled] = useState<"all" | "scheduled" | "unscheduled">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [clientAccountMap, setClientAccountMap] = useState<Record<string, string>>({});

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
    const ids = ["scheduled", "late", "in_progress", "awaiting_payment", "need_attention", "completed", "cancelled"] as const;
    return ids.map((id) => {
      if (id === "in_progress") {
        return {
          id,
          title: "In progress",
          color: "bg-primary",
          items: filteredData.filter((j) => isJobInProgressStatus(j.status)),
        };
      }
      return {
        id,
        title: statusConfig[id]?.label ?? id,
        color: id === "completed" ? "bg-emerald-500" : id === "late" ? "bg-red-500" : id === "need_attention" ? "bg-amber-500" : id === "awaiting_payment" ? "bg-amber-500" : "bg-primary",
        items: filteredData.filter((j) => j.status === id),
      };
    });
  }, [filteredData]);

  const jobIdFromUrl = searchParams.get("jobId");
  useEffect(() => { if (jobIdFromUrl) router.replace(`/jobs/${jobIdFromUrl}`); }, [jobIdFromUrl, router]);

  const loadCounts = useCallback(async () => {
    try { const counts = await getStatusCounts("jobs", [...JOB_STATUSES]); setTabCounts(counts); } catch { /* cosmetic */ }
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const inProgressTabCount =
    (tabCounts.in_progress_phase1 ?? 0) +
    (tabCounts.in_progress_phase2 ?? 0) +
    (tabCounts.in_progress_phase3 ?? 0) +
    (tabCounts.final_check ?? 0);

  const tabs = [
    { id: "all", label: "All Jobs", count: tabCounts.all ?? 0 },
    { id: "scheduled", label: "Scheduled", count: tabCounts.scheduled ?? 0 },
    { id: "late", label: "Late", count: tabCounts.late ?? 0 },
    { id: "in_progress", label: "In progress", count: inProgressTabCount },
    { id: "awaiting_payment", label: "Awaiting Payment", count: tabCounts.awaiting_payment ?? 0 },
    { id: "need_attention", label: "Need attention", count: tabCounts.need_attention ?? 0 },
    { id: "completed", label: "Completed", count: tabCounts.completed ?? 0 },
    { id: "cancelled", label: "Cancelled", count: tabCounts.cancelled ?? 0 },
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
      const { data: clients } = await supabase.from("clients").select("id, source_account_id").in("id", ids);
      const accountIds = [...new Set((clients ?? []).map((c: { source_account_id?: string | null }) => c.source_account_id).filter(Boolean))] as string[];
      const { data: accounts } = accountIds.length > 0
        ? await supabase.from("accounts").select("id, company_name").in("id", accountIds)
        : { data: [] as Array<{ id: string; company_name: string }> };
      if (cancelled) return;
      const accountById = new Map((accounts ?? []).map((a: { id: string; company_name: string }) => [a.id, a.company_name]));
      const next: Record<string, string> = {};
      (clients ?? []).forEach((c: { id: string; source_account_id?: string | null }) => {
        if (c.source_account_id) {
          const name = accountById.get(c.source_account_id);
          if (name) next[c.id] = name;
        }
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
    try {
      const result = await createJob({
        title: formData.title ?? "",
        client_id: formData.client_id,
        client_address_id: formData.client_address_id,
        client_name: formData.client_name ?? "",
        property_address: formData.property_address ?? "",
        partner_name: formData.partner_name, partner_id: formData.partner_id,
        partner_ids: formData.partner_ids,
        owner_id: formData.owner_id ?? profile?.id,
        owner_name: formData.owner_name ?? profile?.full_name,
        status: "scheduled",
        progress: 0,
        current_phase: 0,
        total_phases: normalizeTotalPhases(formData.total_phases),
        client_price: cp,
        extras_amount: 0,
        partner_cost: pc,
        materials_cost: mc,
        margin_percent: margin,
        scheduled_date: formData.scheduled_date, scheduled_start_at: formData.scheduled_start_at, scheduled_end_at: formData.scheduled_end_at,
        job_type: formData.job_type ?? "fixed",
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
        customer_final_payment: cp, customer_final_paid: false,
        scope: formData.scope?.trim() || undefined,
      });
      await logAudit({ entityType: "job", entityId: result.id, entityRef: result.reference, action: "created", userId: profile?.id, userName: profile?.full_name });
      setCreateOpen(false);
      toast.success("Job created"); refresh(); loadCounts();
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
    const ids = Array.from(selectedIds);
    try {
      if (newStatus === "completed") {
        const { data: jobRows, error: jobErr } = await supabase.from("jobs").select("*").in("id", ids);
        if (jobErr) throw jobErr;
        if (!jobRows?.length) {
          toast.error("No jobs found for selection.");
          return;
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
            return;
          }
          const pays = byJob.get(j.id) ?? [];
          const customerPayments = pays.filter((p) => p.type === "customer_deposit" || p.type === "customer_final");
          const partnerPayments = pays.filter((p) => p.type === "partner");
          const check = canAdvanceJob(j, "completed", { customerPayments, partnerPayments });
          if (!check.ok) {
            toast.error(`${j.reference}: ${check.message ?? "Cannot complete"}`);
            return;
          }
        }
        const found = new Set((jobRows as Job[]).map((j) => j.id));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length) {
          toast.error(`${missing.length} selected job(s) not found.`);
          return;
        }
      }
      const { error } = await supabase.from("jobs").update({ status: newStatus }).in("id", ids);
      if (error) throw error;
      await logBulkAction("job", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${ids.length} jobs updated`);
      setSelectedIds(new Set());
      refresh();
    } catch {
      toast.error("Failed");
    }
  };

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => softDeleteById("jobs", id, profile?.id)));
      await logBulkAction("job", Array.from(selectedIds), "deleted", "deleted_at", "archived", profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} jobs archived`);
      setSelectedIds(new Set());
      refresh();
      loadCounts();
    } catch {
      toast.error("Failed to archive jobs");
    }
  }, [selectedIds, profile?.id, profile?.full_name, refresh, loadCounts]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${selectedIds.size} selected jobs permanently?`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("jobs").delete().in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} jobs deleted`);
      setSelectedIds(new Set());
      refresh();
      loadCounts();
    } catch {
      toast.error("Failed to delete jobs");
    }
  }, [selectedIds, refresh, loadCounts]);

  const columns: Column<Job>[] = [
    { key: "reference", label: "Job", width: "180px", render: (item) => (<div><p className="text-sm font-semibold text-text-primary">{item.reference}</p><p className="text-[11px] text-text-tertiary">{item.title}</p></div>) },
    { key: "client_name", label: "Client / Property", render: (item) => (<div><p className="text-sm font-medium text-text-primary">{item.client_name}</p><p className="text-[11px] text-text-tertiary truncate max-w-[180px]">{item.property_address}</p></div>) },
    { key: "partner_name", label: "Partner", render: (item) => item.partner_name ? (<div className="flex items-center gap-2"><Avatar name={item.partner_name} size="xs" /><span className="text-sm text-text-secondary">{item.partner_name}</span></div>) : <span className="text-xs text-text-tertiary italic">Unassigned</span> },
    { key: "status", label: "Status", render: (item) => { const c = statusConfig[item.status] ?? { label: item.status, variant: "default" as const }; return <Badge variant={c.variant} dot={c.dot}>{c.label}</Badge>; } },
    { key: "account", label: "Account", render: (item) => item.client_id && clientAccountMap[item.client_id] ? <span className="text-sm text-text-primary">{clientAccountMap[item.client_id]}</span> : <span className="text-xs text-text-tertiary italic">No account</span> },
    { key: "margin_percent", label: "Job Amount", render: (item) => (<div><p className="text-sm font-semibold text-text-primary">{formatCurrency(item.client_price + Number(item.extras_amount ?? 0))}</p><span className={`text-[11px] font-medium ${item.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>{item.margin_percent}% margin</span></div>) },
    {
      key: "amount_due",
      label: "Amount Due",
      render: (item) => {
        const paid = (item.customer_deposit_paid ? Number(item.customer_deposit ?? 0) : 0) + (item.customer_final_paid ? Number(item.customer_final_payment ?? 0) : 0);
        const due = Math.max(0, Number(item.client_price ?? 0) + Number(item.extras_amount ?? 0) - paid);
        return <span className="text-sm font-semibold text-text-primary">{formatCurrency(due)}</span>;
      },
    },
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
          <KpiCard title="Active Jobs" value={inProgressTabCount + (tabCounts.scheduled ?? 0)} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="Awaiting Payment" value={tabCounts.awaiting_payment ?? 0} format="number" icon={DollarSign} accent="amber" />
          <KpiCard title="Completed" value={tabCounts.completed ?? 0} format="number" icon={CheckCircle2} accent="emerald" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[{ id: "list", icon: List }, { id: "kanban", icon: LayoutGrid }, { id: "calendar", icon: Calendar }, { id: "map", icon: MapIcon }].map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}><Icon className="h-3.5 w-3.5" /></button>
                ))}
              </div>
              <SearchInput placeholder="Search jobs..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {viewMode === "list" && <DataTable columns={columns} data={data} loading={loading} getRowId={(item) => item.id} onRowClick={(job) => router.push(`/jobs/${job.id}`)} page={page} totalPages={totalPages} totalItems={totalItems} onPageChange={setPage} selectable selectedIds={selectedIds} onSelectionChange={setSelectedIds} bulkActions={<div className="flex items-center gap-2"><span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span><BulkBtn label="Phase 1" onClick={() => handleBulkStatusChange("in_progress_phase1")} variant="success" /><BulkBtn label="Completed" onClick={() => handleBulkStatusChange("completed")} variant="success" /><BulkBtn label="Archive" onClick={handleBulkArchive} variant="warning" /><BulkBtn label="Delete" onClick={handleBulkDelete} variant="danger" /></div>} />}
          {viewMode === "kanban" && <div className="min-h-[400px]">{loading ? <div className="flex items-center justify-center py-20 text-text-tertiary">Loading...</div> : <KanbanBoard columns={kanbanColumns} getCardId={(j) => j.id} onCardClick={(j) => router.push(`/jobs/${j.id}`)} renderCard={(j) => { const sc = statusConfig[j.status] ?? { label: j.status }; return (<div className="p-3 rounded-xl border border-border bg-card shadow-sm hover:border-primary/30 transition-colors cursor-pointer"><p className="text-sm font-semibold text-text-primary truncate">{j.reference}</p><p className="text-xs text-text-tertiary truncate">{j.title}</p><p className="text-[10px] text-text-tertiary mt-1 truncate">{sc.label}</p><p className="text-[11px] text-text-secondary mt-0.5">{j.client_name}</p><p className="text-xs font-medium text-primary mt-1">{formatCurrency(j.client_price)}</p></div>); }} />}</div>}
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

/* ========== CREATE JOB MODAL ========== */
function CreateJobModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (data: Partial<Job>) => void }) {
  const [form, setForm] = useState({
    title: "", partner_id: "", partner_ids: [] as string[], client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", scheduled_time: "", finish_date: "", finish_time: "", total_phases: "3", job_type: "fixed", scope: "",
  });
  const [partners, setPartners] = useState<Partner[]>([]);
  const [clientAddress, setClientAddress] = useState<ClientAndAddressValue>({ client_name: "", property_address: "" });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  useEffect(() => {
    if (!open) return;
    listPartners({ pageSize: 200, status: "all" })
      .then((r) => setPartners(r.data ?? []))
      .catch(() => setPartners([]));
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) { toast.error("Job title is required"); return; }
    if (!clientAddress.client_id || !clientAddress.property_address?.trim()) { toast.error("Select a client from the list (click the name) and choose or add a property address."); return; }
    if ((form.scheduled_date && !form.finish_date) || (!form.scheduled_date && form.finish_date)) {
      toast.error("Arrival window requires both start and finish dates.");
      return;
    }
    if ((form.scheduled_time && !form.finish_time) || (!form.scheduled_time && form.finish_time)) {
      toast.error("Arrival window requires both start and finish times.");
      return;
    }
    if (form.scheduled_date && form.scheduled_time && form.finish_date && form.finish_time) {
      const start = new Date(`${form.scheduled_date}T${form.scheduled_time}:00`);
      const end = new Date(`${form.finish_date}T${form.finish_time}:00`);
      if (!(end > start)) {
        toast.error("Finish date and time must be after start date and time.");
        return;
      }
    }
    if (form.scheduled_date && form.finish_date && !form.scheduled_time && !form.finish_time) {
      const start = new Date(`${form.scheduled_date}T09:00:00`);
      const end = new Date(`${form.finish_date}T17:00:00`);
      if (!(end > start)) {
        toast.error("Finish date and time must be after start date and time.");
        return;
      }
    }
    if ((form.scheduled_date || form.finish_date) && (!form.scheduled_time || !form.finish_time)) {
      toast.error("Please set both start and finish times.");
      return;
    }
    const scheduled_date = form.scheduled_date || undefined;
    const scheduled_start_at = form.scheduled_date && form.scheduled_time ? `${form.scheduled_date}T${form.scheduled_time}:00` : form.scheduled_date ? `${form.scheduled_date}T09:00:00` : undefined;
    const scheduled_end_at = form.finish_date && form.finish_time ? `${form.finish_date}T${form.finish_time}:00` : undefined;
    const selectedPartner = partners.find((p) => p.id === form.partner_id);
    onCreate({
      title: form.title,
      client_id: clientAddress.client_id,
      client_address_id: clientAddress.client_address_id,
      client_name: clientAddress.client_name,
      property_address: clientAddress.property_address,
      partner_id: form.partner_id || undefined,
      partner_ids: form.partner_ids.length > 0 ? form.partner_ids : undefined,
      partner_name: selectedPartner ? (selectedPartner.company_name?.trim() || selectedPartner.contact_name) : undefined,
      job_type: (form.job_type as Job["job_type"]) ?? "fixed",
      client_price: Number(form.client_price) || 0,
      partner_cost: Number(form.partner_cost) || 0,
      materials_cost: Number(form.materials_cost) || 0,
      scheduled_date,
      scheduled_start_at,
      scheduled_end_at,
      total_phases: normalizeTotalPhases(Number(form.total_phases)),
      scope: form.scope.trim() || undefined,
    });
    setForm({ title: "", partner_id: "", partner_ids: [], client_price: "", partner_cost: "", materials_cost: "", scheduled_date: "", scheduled_time: "", finish_date: "", finish_time: "", total_phases: "3", job_type: "fixed", scope: "" });
    setClientAddress({ client_name: "", property_address: "" });
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo Job" subtitle="Criar um novo job" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Job title *</label><Input value={form.title} onChange={(e) => update("title", e.target.value)} required /></div>
        <Select
          label="Work phases *"
          value={form.total_phases}
          onChange={(e) => update("total_phases", e.target.value)}
          options={[
            { value: "2", label: "2 phases — start & final (reports 1 & 2)" },
          ]}
        />
        <p className="text-[10px] text-text-tertiary -mt-2">Report 1 is for start day; Report 2 unlocks the final step.</p>
        <ClientAddressPicker value={clientAddress} onChange={setClientAddress} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Arrival date</label><Input type="date" className="h-9 text-sm" value={form.scheduled_date} onChange={(e) => update("scheduled_date", e.target.value)} /></div>
          <div><TimeSelect label="Arrival from" value={form.scheduled_time} onChange={(v) => update("scheduled_time", v)} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Finish date</label><Input type="date" className="h-9 text-sm" value={form.finish_date} onChange={(e) => update("finish_date", e.target.value)} /></div>
          <div><TimeSelect label="Arrival to" value={form.finish_time} onChange={(v) => update("finish_time", v)} /></div>
        </div>
        <p className="text-[10px] text-text-tertiary -mt-2">Arrival range: from (start) to (finish).</p>
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
        <Select
          label="Job type"
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "hourly", label: "Hourly" },
          ]}
          value={form.job_type}
          onChange={(e) => update("job_type", e.target.value)}
        />
        <Select
          label="Partner"
          options={[
            { value: "", label: "No partner" },
            ...partners.map((p) => ({
              value: p.id,
              label: p.company_name?.trim() || p.contact_name || "Partner",
            })),
          ]}
          value={form.partner_id}
          onChange={(e) => update("partner_id", e.target.value)}
        />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Partners (multiple)</label>
          <select
            multiple
            value={form.partner_ids}
            onChange={(e) => setForm((prev) => ({ ...prev, partner_ids: Array.from(e.target.selectedOptions).map((o) => o.value) }))}
            className="w-full min-h-[96px] rounded-lg border border-border bg-card text-sm text-text-primary px-2 py-1.5"
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.company_name?.trim() || p.contact_name || "Partner"}</option>
            ))}
          </select>
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
                    {kind === "start" ? "Start" : kind === "end" ? "Finish" : "In progress"} · {job.reference}
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
