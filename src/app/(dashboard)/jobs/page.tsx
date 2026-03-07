"use client";

import { useState, useCallback, useEffect } from "react";
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
  Play, Pause, CheckCircle2, RotateCcw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listJobs, createJob, updateJob } from "@/services/jobs";
import { getSupabase, getStatusCounts } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import type { Job } from "@/types/database";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { logAudit, logBulkAction } from "@/services/audit";
import { AuditTimeline } from "@/components/ui/audit-timeline";

const JOB_STATUSES = ["pending_schedule", "in_progress", "on_hold", "completed", "cancelled"] as const;

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  pending_schedule: { label: "Pending Schedule", variant: "warning", dot: true },
  in_progress: { label: "In Progress", variant: "primary", dot: true },
  on_hold: { label: "On Hold", variant: "danger", dot: true },
  completed: { label: "Completed", variant: "success", dot: true },
  cancelled: { label: "Cancelled", variant: "default" },
};

export default function JobsPage() {
  const {
    data,
    loading,
    page,
    totalPages,
    totalItems,
    setPage,
    search,
    setSearch,
    status,
    setStatus,
    refresh,
  } = useSupabaseList<Job>({ fetcher: listJobs });

  const { profile } = useProfile();
  const [viewMode, setViewMode] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("jobs", [...JOB_STATUSES]);
      setTabCounts(counts);
    } catch {
      // counts are cosmetic
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const tabs = [
    { id: "all", label: "All Jobs", count: tabCounts.all ?? 0 },
    { id: "pending_schedule", label: "Pending Schedule", count: tabCounts.pending_schedule ?? 0 },
    { id: "in_progress", label: "In Progress", count: tabCounts.in_progress ?? 0 },
    { id: "on_hold", label: "On Hold", count: tabCounts.on_hold ?? 0 },
    { id: "completed", label: "Completed", count: tabCounts.completed ?? 0 },
  ];

  const handleCreate = useCallback(
    async (formData: Partial<Job>) => {
      const clientPrice = formData.client_price ?? 0;
      const partnerCost = formData.partner_cost ?? 0;
      const materialsCost = formData.materials_cost ?? 0;
      const margin =
        clientPrice > 0
          ? Math.round(((clientPrice - partnerCost - materialsCost) / clientPrice) * 1000) / 10
          : 0;

      try {
        const result = await createJob({
          title: formData.title ?? "",
          client_name: formData.client_name ?? "",
          property_address: formData.property_address ?? "",
          partner_name: formData.partner_name,
          partner_id: formData.partner_id,
          owner_id: formData.owner_id,
          owner_name: formData.owner_name,
          status: "pending_schedule",
          progress: 0,
          current_phase: 0,
          total_phases: formData.total_phases ?? 3,
          client_price: clientPrice,
          partner_cost: partnerCost,
          materials_cost: materialsCost,
          margin_percent: margin,
        });
        await logAudit({
          entityType: "job",
          entityId: result.id,
          entityRef: result.reference,
          action: "created",
          userId: profile?.id,
          userName: profile?.full_name,
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
          entityType: "job",
          entityId: job.id,
          entityRef: job.reference,
          action: "status_changed",
          fieldName: "status",
          oldValue: job.status,
          newValue: newStatus,
          userId: profile?.id,
          userName: profile?.full_name,
        });
        setSelectedJob(updated);
        toast.success(`Job moved to ${statusConfig[newStatus].label}`);
        refresh();
        loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update status");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const handleProgressUpdate = useCallback(
    async (job: Job, newPhase: number) => {
      const totalPhases = job.total_phases || 1;
      const progress = Math.round((newPhase / totalPhases) * 100);
      const isComplete = newPhase >= totalPhases;
      try {
        const updated = await updateJob(job.id, {
          current_phase: newPhase,
          progress,
          ...(isComplete ? { status: "completed" } : {}),
        });
        await logAudit({
          entityType: "job",
          entityId: job.id,
          entityRef: job.reference,
          action: "phase_advanced",
          fieldName: "current_phase",
          oldValue: String(job.current_phase),
          newValue: String(newPhase),
          userId: profile?.id,
          userName: profile?.full_name,
        });
        setSelectedJob(updated);
        toast.success(isComplete ? "Job completed!" : `Progress updated to phase ${newPhase}/${totalPhases}`);
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
    } catch {
      toast.error("Failed to update jobs");
    }
  };

  const columns: Column<Job>[] = [
    {
      key: "reference",
      label: "Job",
      width: "180px",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
          <p className="text-[11px] text-text-tertiary">{item.title}</p>
        </div>
      ),
    },
    {
      key: "client_name",
      label: "Client / Property",
      render: (item) => (
        <div>
          <p className="text-sm font-medium text-text-primary">{item.client_name}</p>
          <p className="text-[11px] text-text-tertiary truncate max-w-[180px]">{item.property_address}</p>
        </div>
      ),
    },
    {
      key: "partner_name",
      label: "Partner",
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
      key: "owner_name",
      label: "Owner",
      render: (item) =>
        item.owner_name ? (
          <div className="flex items-center gap-1.5">
            <Avatar name={item.owner_name} size="xs" />
            <span className="text-xs font-medium text-text-primary">{item.owner_name}</span>
          </div>
        ) : (
          <span className="text-xs text-text-tertiary italic">No owner</span>
        ),
    },
    {
      key: "progress",
      label: "Progress",
      render: (item) => (
        <div className="space-y-1 w-28">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-tertiary">
              Phase {item.current_phase}/{item.total_phases}
            </span>
            <span className="text-[11px] font-semibold text-text-primary">{item.progress}%</span>
          </div>
          <Progress value={item.progress} size="sm" color={item.progress === 100 ? "emerald" : "primary"} />
        </div>
      ),
    },
    {
      key: "margin_percent",
      label: "Financial",
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
      key: "status",
      label: "Status",
      render: (item) => {
        const config = statusConfig[item.status];
        return <Badge variant={config.variant} dot={config.dot}>{config.label}</Badge>;
      },
    },
    {
      key: "actions",
      label: "",
      width: "40px",
      render: () => (
        <ArrowRight className="h-4 w-4 text-stone-300 hover:text-primary transition-colors" />
      ),
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Jobs Management" subtitle="Track and manage all active jobs and operations.">
          <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Job</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard title="Active Jobs" value={tabCounts.in_progress ?? 0} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="Total Jobs" value={tabCounts.all ?? 0} format="number" icon={DollarSign} accent="emerald" />
          <KpiCard title="Completed" value={tabCounts.completed ?? 0} format="number" icon={Clock} accent="primary" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-surface-tertiary rounded-lg p-0.5">
                {[
                  { id: "list", icon: List },
                  { id: "kanban", icon: LayoutGrid },
                  { id: "calendar", icon: Calendar },
                  { id: "map", icon: Map },
                ].map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setViewMode(id)}
                    className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
                      viewMode === id ? "bg-card shadow-sm text-text-primary" : "text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <SearchInput
                placeholder="Search jobs..."
                className="w-52"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <DataTable
            columns={columns}
            data={data}
            loading={loading}
            getRowId={(item) => item.id}
            selectedId={selectedJob?.id}
            onRowClick={setSelectedJob}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={setPage}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            bulkActions={
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/80">{selectedIds.size} selected</span>
                <BulkBtn label="In Progress" onClick={() => handleBulkStatusChange("in_progress")} variant="success" />
                <BulkBtn label="On Hold" onClick={() => handleBulkStatusChange("on_hold")} variant="warning" />
                <BulkBtn label="Complete" onClick={() => handleBulkStatusChange("completed")} variant="success" />
                <BulkBtn label="Cancel" onClick={() => handleBulkStatusChange("cancelled")} variant="danger" />
              </div>
            }
          />
        </motion.div>
      </div>

      <JobDetailDrawer
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onStatusChange={handleStatusChange}
        onProgressUpdate={handleProgressUpdate}
      />

      <CreateJobModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </PageTransition>
  );
}

function JobDetailDrawer({
  job,
  onClose,
  onStatusChange,
  onProgressUpdate,
}: {
  job: Job | null;
  onClose: () => void;
  onStatusChange: (job: Job, status: Job["status"]) => void;
  onProgressUpdate: (job: Job, phase: number) => void;
}) {
  const [tab, setTab] = useState("details");

  useEffect(() => {
    setTab("details");
  }, [job?.id]);

  if (!job) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const config = statusConfig[job.status];
  const profit = job.client_price - job.partner_cost - job.materials_cost;
  const canAdvancePhase = job.current_phase < job.total_phases && job.status === "in_progress";

  const statusActions = getStatusActions(job.status);

  const drawerTabs = [
    { id: "details", label: "Details" },
    { id: "history", label: "History" },
  ];

  return (
    <Drawer
      open={!!job}
      onClose={onClose}
      title={job.reference}
      subtitle={job.title}
      width="w-[520px]"
    >
      <div className="flex flex-col h-full">
        <Tabs
          tabs={drawerTabs}
          activeTab={tab}
          onChange={setTab}
          className="px-6 pt-2"
        />
        {tab === "details" && (
      <div className="p-6 space-y-6 flex-1 overflow-auto">
        {/* Status & Progress */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-surface-hover">
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
            <div className="mt-1.5">
              <Badge variant={config.variant} dot={config.dot} size="md">{config.label}</Badge>
            </div>
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

        {/* Client & Property */}
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
            <div className="flex items-center gap-3 mt-2">
              <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">{job.client_name}</p>
              </div>
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

        {/* Partner & Owner */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-surface-hover">
            <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner</label>
            {job.partner_name ? (
              <div className="flex items-center gap-2 mt-2">
                <Avatar name={job.partner_name} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{job.partner_name}</p>
                  <p className="text-[11px] text-text-tertiary">Assigned</p>
                </div>
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
                <div>
                  <p className="text-sm font-semibold text-text-primary">{job.owner_name}</p>
                  <p className="text-[11px] text-text-tertiary">Commission</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-tertiary italic mt-2">No owner</p>
            )}
          </div>
        </div>

        {/* Financial Breakdown */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100/50 border border-border-light">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-text-tertiary" />
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Financial Breakdown</label>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Client Price</span>
              <span className="text-sm font-semibold text-text-primary">{formatCurrency(job.client_price)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Partner Cost</span>
              <span className="text-sm font-medium text-red-600">-{formatCurrency(job.partner_cost)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Materials Cost</span>
              <span className="text-sm font-medium text-red-600">-{formatCurrency(job.materials_cost)}</span>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text-primary">Profit</span>
                <span className={`text-lg font-bold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {formatCurrency(profit)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-text-tertiary">Margin</span>
                <span className={`text-xs font-semibold ${job.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>
                  {job.margin_percent}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Phase Progress */}
        {canAdvancePhase && (
          <div className="p-4 rounded-xl bg-primary/[0.03] border border-primary/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">Advance to Phase {job.current_phase + 1}</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {job.current_phase + 1 === job.total_phases ? "This will mark the job as completed" : `${job.total_phases - job.current_phase - 1} phases remaining`}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => onProgressUpdate(job, job.current_phase + 1)}
                icon={<TrendingUp className="h-3.5 w-3.5" />}
              >
                Advance
              </Button>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
          <span>Created {new Date(job.created_at).toLocaleDateString()}</span>
          <span>Updated {new Date(job.updated_at).toLocaleDateString()}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-border-light">
          {statusActions.map((action) => (
            <Button
              key={action.status}
              variant={action.primary ? "primary" : "outline"}
              className="flex-1"
              size="sm"
              icon={<action.icon className="h-3.5 w-3.5" />}
              onClick={() => onStatusChange(job, action.status)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
        )}
        {tab === "history" && (
          <div className="p-6">
            <AuditTimeline entityType="job" entityId={job.id} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function getStatusActions(currentStatus: string) {
  switch (currentStatus) {
    case "pending_schedule":
      return [
        { label: "Start Job", status: "in_progress" as Job["status"], icon: Play, primary: true },
        { label: "Cancel", status: "cancelled" as Job["status"], icon: RotateCcw, primary: false },
      ];
    case "in_progress":
      return [
        { label: "Put On Hold", status: "on_hold" as Job["status"], icon: Pause, primary: false },
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
        { label: "Reopen", status: "pending_schedule" as Job["status"], icon: RotateCcw, primary: false },
      ];
    default:
      return [];
  }
}

function CreateJobModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<Job>) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    client_name: "",
    property_address: "",
    partner_name: "",
    client_price: "",
    partner_cost: "",
    materials_cost: "",
    total_phases: "3",
  });

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.client_name || !form.property_address) {
      toast.error("Please fill in all required fields");
      return;
    }
    onCreate({
      title: form.title,
      client_name: form.client_name,
      property_address: form.property_address,
      partner_name: form.partner_name || undefined,
      client_price: form.client_price ? Number(form.client_price) : 0,
      partner_cost: form.partner_cost ? Number(form.partner_cost) : 0,
      materials_cost: form.materials_cost ? Number(form.materials_cost) : 0,
      total_phases: form.total_phases ? Number(form.total_phases) : 3,
    });
    setForm({ title: "", client_name: "", property_address: "", partner_name: "", client_price: "", partner_cost: "", materials_cost: "", total_phases: "3" });
  };

  return (
    <Modal open={open} onClose={onClose} title="New Job" subtitle="Create a new job and assign to a partner" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Job Title *</label>
            <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. HVAC Installation" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Name *</label>
            <Input value={form.client_name} onChange={(e) => update("client_name", e.target.value)} placeholder="Company name" required />
          </div>
        </div>
        <AddressAutocomplete
          label="Property Address *"
          value={form.property_address}
          onSelect={(parts) => update("property_address", parts.full_address)}
          placeholder="Start typing address or postcode..."
        />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Name</label>
            <Input value={form.partner_name} onChange={(e) => update("partner_name", e.target.value)} placeholder="Assigned partner" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Total Phases</label>
            <Input type="number" value={form.total_phases} onChange={(e) => update("total_phases", e.target.value)} placeholder="3" min="1" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Price</label>
            <Input type="number" value={form.client_price} onChange={(e) => update("client_price", e.target.value)} placeholder="0.00" min="0" step="0.01" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Cost</label>
            <Input type="number" value={form.partner_cost} onChange={(e) => update("partner_cost", e.target.value)} placeholder="0.00" min="0" step="0.01" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Materials Cost</label>
            <Input type="number" value={form.materials_cost} onChange={(e) => update("materials_cost", e.target.value)} placeholder="0.00" min="0" step="0.01" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Job</Button>
        </div>
      </form>
    </Modal>
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
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
