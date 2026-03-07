"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Plus, Filter, MapPin, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import type { ServiceRequest } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listRequests, createRequest, updateRequestStatus } from "@/services/requests";
import { logAudit, logBulkAction } from "@/services/audit";
import { getStatusCounts, getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { LocationMiniMap } from "@/components/ui/location-picker";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { AuditTimeline } from "@/components/ui/audit-timeline";

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  new: { label: "New", variant: "primary" },
  qualified: { label: "Qualified", variant: "info" },
  in_review: { label: "In Review", variant: "warning" },
  converted: { label: "Converted", variant: "success" },
  declined: { label: "Declined", variant: "danger" },
};

const priorityConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  low: { label: "Low", variant: "default" },
  medium: { label: "Medium", variant: "info" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "danger" },
};

const serviceColors: Record<string, string> = {
  "HVAC Installation": "bg-blue-50 text-blue-700 ring-blue-200/50",
  "HVAC Maintenance": "bg-blue-50 text-blue-700 ring-blue-200/50",
  Electrical: "bg-purple-50 text-purple-700 ring-purple-200/50",
  Plumbing: "bg-teal-50 text-teal-700 ring-teal-200/50",
  Painting: "bg-amber-50 text-amber-700 ring-amber-200/50",
  Carpentry: "bg-emerald-50 text-emerald-700 ring-emerald-200/50",
  "General Maintenance": "bg-stone-100 text-stone-700 ring-stone-200/50",
};

export default function RequestsPage() {
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
  } = useSupabaseList<ServiceRequest>({ fetcher: listRequests });

  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [drawerTab, setDrawerTab] = useState("details");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("service_requests", [
        "new",
        "qualified",
        "in_review",
        "converted",
        "declined",
      ]);
      setStatusCounts(counts);
    } catch {
      // non-critical — tabs will show 0
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    setDrawerTab("details");
  }, [selectedRequest?.id]);

  const tabs = [
    { id: "all", label: "All Requests", count: statusCounts.all ?? 0 },
    { id: "new", label: "New", count: statusCounts.new ?? 0 },
    { id: "qualified", label: "Qualified", count: statusCounts.qualified ?? 0 },
    { id: "in_review", label: "In Review", count: statusCounts.in_review ?? 0 },
    { id: "converted", label: "Converted", count: statusCounts.converted ?? 0 },
  ];

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("service_requests").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("request", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} requests updated to ${newStatus}`);
      setSelectedIds(new Set());
      refresh();
    } catch { toast.error("Failed to update requests"); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("service_requests").update({ status: "declined" }).in("id", Array.from(selectedIds));
      if (error) throw error;
      toast.success(`${selectedIds.size} requests declined`);
      setSelectedIds(new Set());
      refresh();
    } catch { toast.error("Failed to update requests"); }
  };

  const handleStatusChange = useCallback(
    async (id: string, newStatus: string, oldStatus?: string) => {
      try {
        await updateRequestStatus(id, newStatus);
        await logAudit({
          entityType: "request",
          entityId: id,
          action: "status_changed",
          fieldName: "status",
          oldValue: oldStatus,
          newValue: newStatus,
          userId: profile?.id,
          userName: profile?.full_name,
        });
        setSelectedRequest(null);
        refresh();
        await loadCounts();
        toast.success(`Request updated to ${statusConfig[newStatus]?.label ?? newStatus}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update request status");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const handleCreate = useCallback(
    async (formData: Partial<ServiceRequest>) => {
      try {
        const result = await createRequest({
          client_name: formData.client_name ?? "",
          client_email: formData.client_email ?? "",
          client_phone: formData.client_phone,
          property_address: formData.property_address ?? "",
          service_type: formData.service_type ?? "",
          description: formData.description ?? "",
          status: "new",
          priority: formData.priority ?? "medium",
          owner_id: formData.owner_id,
          owner_name: formData.owner_name,
          assigned_to: formData.assigned_to,
          estimated_value: formData.estimated_value,
        });
        await logAudit({
          entityType: "request",
          entityId: result.id,
          entityRef: result.reference,
          action: "created",
          userId: profile?.id,
          userName: profile?.full_name,
        });
        setCreateOpen(false);
        refresh();
        await loadCounts();
        toast.success("Request created successfully");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create request");
      }
    },
    [refresh, loadCounts, profile?.id, profile?.full_name]
  );

  const columns: Column<ServiceRequest>[] = [
    {
      key: "reference", label: "Request ID", width: "140px",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{item.reference}</p>
          <p className="text-[11px] text-text-tertiary truncate max-w-[200px]">{item.description}</p>
        </div>
      ),
    },
    {
      key: "client_name", label: "Client",
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={item.client_name} size="sm" />
          <div>
            <p className="text-sm font-medium text-text-primary">{item.client_name}</p>
            <p className="text-[11px] text-text-tertiary">{item.client_email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "property_address", label: "Property",
      render: (item) => (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary max-w-[200px]">
          <MapPin className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
          <span className="truncate">{item.property_address}</span>
        </div>
      ),
    },
    {
      key: "service_type", label: "Service",
      render: (item) => (
        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ring-1 ring-inset ${serviceColors[item.service_type] || "bg-stone-100 text-stone-700 ring-stone-200/50"}`}>
          {item.service_type}
        </span>
      ),
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const config = statusConfig[item.status];
        return <Badge variant={config.variant} dot>{config.label}</Badge>;
      },
    },
    {
      key: "priority", label: "Priority",
      render: (item) => {
        const config = priorityConfig[item.priority];
        return <Badge variant={config.variant} size="sm">{config.label}</Badge>;
      },
    },
    {
      key: "owner_name", label: "Owner",
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
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Requests" subtitle="Manage incoming service requests and leads.">
          <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Request</Button>
        </PageHeader>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <SearchInput
              placeholder="Search requests..."
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <DataTable
            columns={columns}
            data={data}
            loading={loading}
            getRowId={(item) => item.id}
            selectedId={selectedRequest?.id}
            onRowClick={setSelectedRequest}
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
                <BulkBtn label="Mark Qualified" onClick={() => handleBulkStatusChange("qualified")} variant="success" />
                <BulkBtn label="In Review" onClick={() => handleBulkStatusChange("in_review")} variant="warning" />
                <BulkBtn label="Convert" onClick={() => handleBulkStatusChange("converted")} variant="success" />
                <BulkBtn label="Decline" onClick={() => handleBulkDelete()} variant="danger" />
              </div>
            }
          />
        </motion.div>
      </div>

      <Drawer
        open={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title={selectedRequest?.reference}
        subtitle={selectedRequest?.service_type}
      >
        {selectedRequest && (
          <div className="flex flex-col h-full">
            <Tabs
              tabs={[
                { id: "details", label: "Details" },
                { id: "history", label: "History" },
              ]}
              activeTab={drawerTab}
              onChange={setDrawerTab}
              className="px-6 pt-2"
            />
            {drawerTab === "details" && (
              <div className="p-6 space-y-6 flex-1 overflow-auto">
                <div className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
                <div className="flex items-center gap-3 mt-2">
                  <Avatar name={selectedRequest.client_name} size="lg" />
                  <div>
                    <p className="text-base font-semibold text-text-primary">{selectedRequest.client_name}</p>
                    <p className="text-sm text-text-secondary">{selectedRequest.client_email}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-stone-50">
                  <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
                  <div className="mt-1">
                    <Badge variant={statusConfig[selectedRequest.status].variant} dot size="md">
                      {statusConfig[selectedRequest.status].label}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-stone-50">
                  <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Priority</label>
                  <div className="mt-1">
                    <Badge variant={priorityConfig[selectedRequest.priority].variant} size="md">
                      {priorityConfig[selectedRequest.priority].label}
                    </Badge>
                  </div>
                </div>
              </div>
              {selectedRequest.owner_name && (
                <div className="p-3 rounded-xl bg-stone-50">
                  <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Job Owner (Commission)</label>
                  <div className="flex items-center gap-2.5 mt-2">
                    <Avatar name={selectedRequest.owner_name} size="sm" />
                    <p className="text-sm font-semibold text-text-primary">{selectedRequest.owner_name}</p>
                  </div>
                </div>
              )}
              <div>
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Property</label>
                <div className="flex items-start gap-2 mt-1.5">
                  <MapPin className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
                  <p className="text-sm text-text-primary">{selectedRequest.property_address}</p>
                </div>
                <LocationMiniMap address={selectedRequest.property_address} className="mt-2" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Description</label>
                <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{selectedRequest.description}</p>
              </div>
              {selectedRequest.estimated_value && (
                <div className="p-4 rounded-xl bg-primary/[0.03] border border-primary/10">
                  <label className="text-[10px] font-semibold text-primary uppercase tracking-wide">Estimated Value</label>
                  <p className="text-2xl font-bold text-text-primary mt-1">
                    ${selectedRequest.estimated_value.toLocaleString()}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Mail className="h-4 w-4" />
                {selectedRequest.client_email}
              </div>
              {selectedRequest.client_phone && (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Phone className="h-4 w-4" />
                  {selectedRequest.client_phone}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-4 border-t border-stone-100">
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => handleStatusChange(selectedRequest.id, "converted", selectedRequest?.status)}
              >
                Convert to Quote
              </Button>
              <Button
                variant="outline"
                onClick={() => handleStatusChange(selectedRequest.id, "declined", selectedRequest?.status)}
              >
                Decline
              </Button>
            </div>
          </div>
            )}
            {drawerTab === "history" && (
              <div className="p-6 flex-1 overflow-auto">
                <AuditTimeline entityType="request" entityId={selectedRequest.id} />
              </div>
            )}
          </div>
        )}
      </Drawer>

      <CreateRequestModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </PageTransition>
  );
}

function CreateRequestModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<ServiceRequest>) => void;
}) {
  const [form, setForm] = useState({
    client_name: "",
    client_email: "",
    client_phone: "",
    property_address: "",
    service_type: "HVAC Installation",
    description: "",
    priority: "medium",
    estimated_value: "",
  });

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.client_name || !form.client_email || !form.property_address) {
      toast.error("Please fill in all required fields");
      return;
    }
    onCreate({
      ...form,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : undefined,
      priority: form.priority as ServiceRequest["priority"],
    });
    setForm({ client_name: "", client_email: "", client_phone: "", property_address: "", service_type: "HVAC Installation", description: "", priority: "medium", estimated_value: "" });
  };

  return (
    <Modal open={open} onClose={onClose} title="New Service Request" subtitle="Create a new incoming request" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Name *</label>
            <Input value={form.client_name} onChange={(e) => update("client_name", e.target.value)} placeholder="Company name" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Client Email *</label>
            <Input type="email" value={form.client_email} onChange={(e) => update("client_email", e.target.value)} placeholder="email@company.com" required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
            <Input value={form.client_phone} onChange={(e) => update("client_phone", e.target.value)} placeholder="+1 212-555-0100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Estimated Value</label>
            <Input type="number" value={form.estimated_value} onChange={(e) => update("estimated_value", e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <AddressAutocomplete
          label="Property Address *"
          value={form.property_address}
          onSelect={(parts) => update("property_address", parts.full_address)}
          placeholder="Start typing address or postcode..."
        />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Service Type" value={form.service_type} onChange={(e) => update("service_type", e.target.value)} options={[
            { value: "HVAC Installation", label: "HVAC Installation" },
            { value: "HVAC Maintenance", label: "HVAC Maintenance" },
            { value: "Electrical", label: "Electrical" },
            { value: "Plumbing", label: "Plumbing" },
            { value: "Painting", label: "Painting" },
            { value: "Carpentry", label: "Carpentry" },
            { value: "General Maintenance", label: "General Maintenance" },
          ]} />
          <Select label="Priority" value={form.priority} onChange={(e) => update("priority", e.target.value)} options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ]} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
            placeholder="Describe the service needed..."
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 hover:border-stone-300 transition-all resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit">Create Request</Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkBtn({ label, onClick, variant }: { label: string; onClick: () => void; variant: "success" | "danger" | "warning" | "default" }) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
    danger: "text-red-700 bg-red-50 hover:bg-red-100 border-red-200",
    warning: "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200",
    default: "text-stone-700 bg-stone-50 hover:bg-stone-100 border-stone-200",
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${colors[variant]}`}>
      {label}
    </button>
  );
}
