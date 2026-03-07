"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";
import { motion } from "framer-motion";
import { fadeInUp, staggerItem } from "@/lib/motion";
import {
  Plus, Filter, Download, UserPlus, Users, Star,
  DollarSign, Briefcase, ArrowRight, MapPin,
  Mail, Phone, Calendar, Tag, Edit3, Trash2,
  Home, Building2, Key, UserCheck, Ban, Crown,
  FileText, CheckCircle2, Clock, Loader2,
} from "lucide-react";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/utils";
import { toast } from "sonner";
import type { Client, ClientType, ClientSource, ClientStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import { listClients, createClient, updateClient } from "@/services/clients";
import { getStatusCounts, getSupabase } from "@/services/base";
import { logAudit, logBulkAction } from "@/services/audit";

const CLIENT_STATUSES = ["active", "inactive", "vip", "blocked"] as const;

const statusConfig: Record<string, { variant: "default" | "primary" | "success" | "warning" | "danger" | "info"; dot?: boolean }> = {
  active: { variant: "success", dot: true },
  inactive: { variant: "default", dot: true },
  vip: { variant: "primary", dot: true },
  blocked: { variant: "danger", dot: true },
};

const typeLabels: Record<ClientType, { label: string; icon: typeof Home }> = {
  residential: { label: "Residential", icon: Home },
  landlord: { label: "Landlord", icon: Key },
  tenant: { label: "Tenant", icon: UserCheck },
  commercial: { label: "Commercial", icon: Building2 },
  other: { label: "Other", icon: Users },
};

const sourceLabels: Record<ClientSource, string> = {
  direct: "Direct", referral: "Referral", website: "Website",
  partner: "Partner", corporate: "Corporate", other: "Other",
};

export default function ClientsPage() {
  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refresh,
  } = useSupabaseList<Client>({ fetcher: listClients });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [totalSpent, setTotalSpent] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("clients", [...CLIENT_STATUSES]);
      setStatusCounts(counts);
    } catch { /* cosmetic */ }
  }, []);

  const loadAggregates = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data: rows } = await supabase.from("clients").select("total_spent");
      const total = (rows ?? []).reduce((s, r) => s + Number((r as { total_spent: number }).total_spent), 0);
      setTotalSpent(total);
    } catch { /* cosmetic */ }
  }, []);

  useEffect(() => { loadCounts(); loadAggregates(); }, [loadCounts, loadAggregates]);

  const tabs = [
    { id: "all", label: "All", count: statusCounts.all ?? 0 },
    { id: "active", label: "Active", count: statusCounts.active ?? 0 },
    { id: "vip", label: "VIP", count: statusCounts.vip ?? 0 },
    { id: "inactive", label: "Inactive", count: statusCounts.inactive ?? 0 },
    { id: "blocked", label: "Blocked", count: statusCounts.blocked ?? 0 },
  ];

  const handleCreate = useCallback(async (formData: Partial<Client>) => {
    try {
      const result = await createClient({
        full_name: formData.full_name ?? "",
        email: formData.email ?? undefined,
        phone: formData.phone ?? undefined,
        address: formData.address ?? undefined,
        city: formData.city ?? undefined,
        postcode: formData.postcode ?? undefined,
        client_type: formData.client_type ?? "residential",
        source: formData.source ?? "direct",
        status: "active",
        notes: formData.notes ?? undefined,
        tags: [],
      });
      await logAudit({
        entityType: "account",
        entityId: result.id,
        action: "created",
        userId: profile?.id,
        userName: profile?.full_name,
        metadata: { type: "client" },
      });
      setCreateOpen(false);
      toast.success("Client created");
      refresh(); loadCounts(); loadAggregates();
    } catch { toast.error("Failed to create client"); }
  }, [refresh, loadCounts, loadAggregates, profile?.id, profile?.full_name]);

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("clients").update({ status: newStatus }).in("id", Array.from(selectedIds));
      if (error) throw error;
      await logBulkAction("account", Array.from(selectedIds), "status_changed", "status", newStatus, profile?.id, profile?.full_name);
      toast.success(`${selectedIds.size} clients updated`);
      setSelectedIds(new Set());
      refresh(); loadCounts();
    } catch { toast.error("Failed to update"); }
  };

  const handleExport = useCallback(() => {
    const csv = ["Name,Email,Phone,Type,Status,City,Total Spent,Jobs"]
      .concat(data.map((c) => `"${c.full_name}","${c.email ?? ""}","${c.phone ?? ""}",${c.client_type},${c.status},"${c.city ?? ""}",${c.total_spent},${c.jobs_count}`))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "clients_export.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Clients exported");
  }, [data]);

  const columns: Column<Client>[] = [
    {
      key: "full_name", label: "Client", width: "260px",
      render: (item) => (
        <div className="flex items-center gap-3">
          <Avatar name={item.full_name} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-text-primary truncate">{item.full_name}</p>
              {item.status === "vip" && <Crown className="h-3 w-3 text-amber-500" />}
            </div>
            {item.email && <p className="text-[11px] text-text-tertiary truncate">{item.email}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "client_type", label: "Type",
      render: (item) => {
        const cfg = typeLabels[item.client_type];
        return (
          <div className="flex items-center gap-1.5">
            <cfg.icon className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-xs font-medium text-text-primary">{cfg.label}</span>
          </div>
        );
      },
    },
    {
      key: "phone", label: "Contact",
      render: (item) => (
        <div className="space-y-0.5">
          {item.phone && <p className="text-xs text-text-primary">{item.phone}</p>}
          {item.city && <p className="text-[11px] text-text-tertiary">{item.city}</p>}
        </div>
      ),
    },
    {
      key: "status", label: "Status",
      render: (item) => {
        const cfg = statusConfig[item.status];
        return <Badge variant={cfg.variant} dot={cfg.dot} size="sm">{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</Badge>;
      },
    },
    {
      key: "total_spent", label: "Total Spent", align: "right" as const,
      render: (item) => <span className="text-sm font-semibold text-text-primary">{formatCurrency(item.total_spent)}</span>,
    },
    {
      key: "jobs_count", label: "Jobs", align: "center" as const,
      render: (item) => (
        <div className="text-center">
          <span className="text-sm font-bold text-text-primary">{item.jobs_count}</span>
          {item.last_job_date && <p className="text-[10px] text-text-tertiary">{formatRelativeTime(item.last_job_date)}</p>}
        </div>
      ),
    },
    {
      key: "source", label: "Source",
      render: (item) => <span className="text-xs text-text-secondary">{sourceLabels[item.source]}</span>,
    },
    {
      key: "actions", label: "", width: "40px",
      render: () => <ArrowRight className="h-4 w-4 text-text-tertiary hover:text-primary transition-colors" />,
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Clients" subtitle="Manage individual clients and their service history.">
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>Export</Button>
          <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>New Client</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Clients" value={statusCounts.all ?? 0} format="number" icon={Users} accent="blue" />
          <KpiCard title="VIP Clients" value={statusCounts.vip ?? 0} format="number" icon={Star} accent="amber" />
          <KpiCard title="Lifetime Value" value={totalSpent} format="currency" icon={DollarSign} accent="emerald" />
          <KpiCard title="Active" value={statusCounts.active ?? 0} format="number" description="Currently active clients" icon={UserCheck} accent="primary" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
            <div className="flex items-center gap-2">
              <SearchInput placeholder="Search clients..." className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={data}
            getRowId={(item) => item.id}
            loading={loading}
            selectedId={selectedClient?.id}
            onRowClick={setSelectedClient}
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
                <BulkBtn label="Activate" onClick={() => handleBulkStatusChange("active")} variant="success" />
                <BulkBtn label="VIP" onClick={() => handleBulkStatusChange("vip")} variant="warning" />
                <BulkBtn label="Deactivate" onClick={() => handleBulkStatusChange("inactive")} variant="default" />
                <BulkBtn label="Block" onClick={() => handleBulkStatusChange("blocked")} variant="danger" />
              </div>
            }
          />
        </motion.div>
      </div>

      <ClientDetailDrawer
        client={selectedClient}
        onClose={() => setSelectedClient(null)}
        onUpdate={(updated) => { setSelectedClient(updated); refresh(); loadCounts(); loadAggregates(); }}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Client" subtitle="Add an individual client" size="lg">
        <CreateClientForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </PageTransition>
  );
}

/* ============ DETAIL DRAWER ============ */
function ClientDetailDrawer({
  client,
  onClose,
  onUpdate,
}: {
  client: Client | null;
  onClose: () => void;
  onUpdate: (c: Client) => void;
}) {
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; reference: string; title: string; status: string; client_price: number; scheduled_date?: string }[]>([]);
  const [quotes, setQuotes] = useState<{ id: string; reference: string; title: string; status: string; total_value: number }[]>([]);
  const [requests, setRequests] = useState<{ id: string; reference: string; service_type: string; status: string; created_at: string }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const { profile } = useProfile();

  useEffect(() => {
    if (!client) return;
    setTab("overview");
    setEditing(false);
    setLoadingHistory(true);

    const supabase = getSupabase();
    Promise.all([
      supabase.from("jobs").select("id, reference, title, status, client_price, scheduled_date").ilike("client_name", `%${client.full_name}%`).order("created_at", { ascending: false }).limit(20),
      supabase.from("quotes").select("id, reference, title, status, total_value").ilike("client_name", `%${client.full_name}%`).order("created_at", { ascending: false }).limit(20),
      supabase.from("service_requests").select("id, reference, service_type, status, created_at").ilike("client_name", `%${client.full_name}%`).order("created_at", { ascending: false }).limit(20),
    ]).then(([jobsRes, quotesRes, reqsRes]) => {
      setJobs((jobsRes.data ?? []) as typeof jobs);
      setQuotes((quotesRes.data ?? []) as typeof quotes);
      setRequests((reqsRes.data ?? []) as typeof requests);
    }).finally(() => setLoadingHistory(false));
  }, [client]);

  if (!client) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const cfg = statusConfig[client.status];
  const typeCfg = typeLabels[client.client_type];

  const handleSave = async (form: Partial<Client>) => {
    setSaving(true);
    try {
      const updated = await updateClient(client.id, form);
      await logAudit({
        entityType: "account",
        entityId: client.id,
        action: "updated",
        userId: profile?.id,
        userName: profile?.full_name,
        metadata: { type: "client" },
      });
      toast.success("Client updated");
      setEditing(false);
      onUpdate(updated);
    } catch { toast.error("Failed to update"); }
    finally { setSaving(false); }
  };

  const drawerTabs = [
    { id: "overview", label: "Overview" },
    { id: "history", label: `History (${jobs.length + quotes.length + requests.length})` },
    { id: "edit", label: "Edit" },
  ];

  const totalJobValue = jobs.reduce((s, j) => s + Number(j.client_price), 0);
  const totalQuoteValue = quotes.reduce((s, q) => s + Number(q.total_value), 0);

  return (
    <Drawer open={!!client} onClose={onClose} title={client.full_name} subtitle={typeCfg.label + (client.city ? ` — ${client.city}` : "")} width="w-[540px]">
      <div className="flex flex-col h-full">
        <div className="px-6 pt-2 border-b border-border-light">
          <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "overview" && (
            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center gap-4">
                <Avatar name={client.full_name} size="xl" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-text-primary">{client.full_name}</h3>
                    {client.status === "vip" && <Crown className="h-4 w-4 text-amber-500" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={cfg.variant} dot={cfg.dot} size="sm">{client.status}</Badge>
                    <Badge size="sm" className="bg-surface-tertiary text-text-primary">{typeCfg.label}</Badge>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-2">
                {client.email && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Mail className="h-4 w-4 text-text-tertiary" />{client.email}
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Phone className="h-4 w-4 text-text-tertiary" />{client.phone}
                  </div>
                )}
                {(client.address || client.city) && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <MapPin className="h-4 w-4 text-text-tertiary" />
                    {[client.address, client.city, client.postcode].filter(Boolean).join(", ")}
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Calendar className="h-4 w-4 text-text-tertiary" />
                  Client since {formatDate(client.created_at)}
                </div>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30/60 border border-emerald-100">
                  <p className="text-[10px] font-semibold text-emerald-700 uppercase">Total Spent</p>
                  <p className="text-lg font-bold text-emerald-700 mt-1">{formatCurrency(client.total_spent)}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30/60 border border-blue-100">
                  <p className="text-[10px] font-semibold text-blue-700 uppercase">Jobs</p>
                  <p className="text-lg font-bold text-blue-700 mt-1">{client.jobs_count}</p>
                </div>
                <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30/60 border border-purple-100">
                  <p className="text-[10px] font-semibold text-purple-700 uppercase">Quotes</p>
                  <p className="text-lg font-bold text-purple-700 mt-1">{quotes.length}</p>
                </div>
              </div>

              {/* Value Summary */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-wide">Lifetime Value</p>
                <p className="text-2xl font-bold text-text-primary mt-1">{formatCurrency(totalJobValue)}</p>
                <p className="text-xs text-text-tertiary mt-1">
                  {formatCurrency(totalQuoteValue)} in quotes · {sourceLabels[client.source]} source
                </p>
              </div>

              {/* Tags */}
              {client.tags && client.tags.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {client.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-md bg-surface-tertiary text-xs font-medium text-text-secondary">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {client.notes && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30/60 border-l-3 border-amber-400">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase mb-1">Notes</p>
                  <p className="text-sm text-text-secondary">{client.notes}</p>
                </div>
              )}

              {/* Last Job */}
              {client.last_job_date && (
                <p className="text-xs text-text-tertiary">Last job: {formatRelativeTime(client.last_job_date)}</p>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="p-6 space-y-5">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
                </div>
              ) : (
                <>
                  {/* Jobs */}
                  {jobs.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                        Jobs ({jobs.length})
                      </p>
                      <div className="space-y-1.5">
                        {jobs.map((job) => (
                          <motion.div key={job.id} variants={staggerItem} className="flex items-center justify-between p-3 rounded-xl bg-surface-hover hover:bg-surface-tertiary transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                                <Briefcase className="h-4 w-4 text-emerald-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-text-primary">{job.reference}</p>
                                <p className="text-[11px] text-text-tertiary truncate max-w-[200px]">{job.title}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-text-primary">{formatCurrency(job.client_price)}</p>
                              <Badge variant={job.status === "completed" ? "success" : job.status === "in_progress" ? "info" : "default"} size="sm">
                                {job.status.replace(/_/g, " ")}
                              </Badge>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quotes */}
                  {quotes.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                        Quotes ({quotes.length})
                      </p>
                      <div className="space-y-1.5">
                        {quotes.map((q) => (
                          <motion.div key={q.id} variants={staggerItem} className="flex items-center justify-between p-3 rounded-xl bg-surface-hover hover:bg-surface-tertiary transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                                <FileText className="h-4 w-4 text-blue-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-text-primary">{q.reference}</p>
                                <p className="text-[11px] text-text-tertiary truncate max-w-[200px]">{q.title}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-text-primary">{formatCurrency(q.total_value)}</p>
                              <Badge variant={q.status === "approved" ? "success" : q.status === "sent" ? "info" : "default"} size="sm">
                                {q.status.replace(/_/g, " ")}
                              </Badge>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Requests */}
                  {requests.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                        Requests ({requests.length})
                      </p>
                      <div className="space-y-1.5">
                        {requests.map((r) => (
                          <motion.div key={r.id} variants={staggerItem} className="flex items-center justify-between p-3 rounded-xl bg-surface-hover hover:bg-surface-tertiary transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <FileText className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-text-primary">{r.reference}</p>
                                <p className="text-[11px] text-text-tertiary">{r.service_type}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge variant={r.status === "converted" ? "success" : r.status === "new" ? "primary" : "default"} size="sm">
                                {r.status.replace(/_/g, " ")}
                              </Badge>
                              <p className="text-[10px] text-text-tertiary mt-0.5">{formatDate(r.created_at)}</p>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {jobs.length === 0 && quotes.length === 0 && requests.length === 0 && (
                    <div className="text-center py-12">
                      <Clock className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
                      <p className="text-sm text-text-tertiary">No service history yet</p>
                      <p className="text-xs text-text-tertiary mt-1">Jobs, quotes and requests will appear here</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "edit" && (
            <EditClientForm
              client={client}
              saving={saving}
              onSave={handleSave}
              onCancel={() => setTab("overview")}
            />
          )}
        </div>
      </div>
    </Drawer>
  );
}

/* ============ EDIT FORM ============ */
function EditClientForm({
  client,
  saving,
  onSave,
  onCancel,
}: {
  client: Client;
  saving: boolean;
  onSave: (data: Partial<Client>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    full_name: client.full_name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    postcode: client.postcode ?? "",
    client_type: client.client_type,
    source: client.source,
    status: client.status,
    notes: client.notes ?? "",
  });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Full Name *</label>
          <Input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
          <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
          <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
        </div>
        <Select
          label="Type"
          value={form.client_type}
          onChange={(e) => update("client_type", e.target.value)}
          options={[
            { value: "residential", label: "Residential" },
            { value: "landlord", label: "Landlord" },
            { value: "tenant", label: "Tenant" },
            { value: "commercial", label: "Commercial" },
            { value: "other", label: "Other" },
          ]}
        />
      </div>
      <AddressAutocomplete
        label="Address"
        value={form.address}
        onSelect={(parts) => {
          setForm((p) => ({ ...p, address: parts.address || parts.full_address, city: parts.city || p.city, postcode: parts.postcode || p.postcode }));
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">City</label>
          <Input value={form.city} onChange={(e) => update("city", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Postcode</label>
          <Input value={form.postcode} onChange={(e) => update("postcode", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Source"
          value={form.source}
          onChange={(e) => update("source", e.target.value)}
          options={[
            { value: "direct", label: "Direct" },
            { value: "referral", label: "Referral" },
            { value: "website", label: "Website" },
            { value: "partner", label: "Partner" },
            { value: "corporate", label: "Corporate" },
            { value: "other", label: "Other" },
          ]}
        />
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => update("status", e.target.value)}
          options={[
            { value: "active", label: "Active" },
            { value: "vip", label: "VIP" },
            { value: "inactive", label: "Inactive" },
            { value: "blocked", label: "Blocked" },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none h-20"
          placeholder="Internal notes about this client..."
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

/* ============ CREATE FORM ============ */
function CreateClientForm({ onSubmit, onCancel }: { onSubmit: (d: Partial<Client>) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", address: "", city: "", postcode: "",
    client_type: "residential" as ClientType, source: "direct" as ClientSource, notes: "",
  });
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name) { toast.error("Name is required"); return; }
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Full Name *</label>
          <Input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} placeholder="John Smith" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
          <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="john@email.com" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
          <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+44 7700 900000" />
        </div>
        <Select
          label="Client Type"
          value={form.client_type}
          onChange={(e) => update("client_type", e.target.value)}
          options={[
            { value: "residential", label: "Residential" },
            { value: "landlord", label: "Landlord" },
            { value: "tenant", label: "Tenant" },
            { value: "commercial", label: "Commercial" },
            { value: "other", label: "Other" },
          ]}
        />
      </div>
      <AddressAutocomplete
        label="Address"
        value={form.address}
        onSelect={(parts) => {
          setForm((p) => ({ ...p, address: parts.address || parts.full_address, city: parts.city || p.city, postcode: parts.postcode || p.postcode }));
        }}
        placeholder="Start typing address or postcode..."
      />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">City</label>
          <Input value={form.city} onChange={(e) => update("city", e.target.value)} placeholder="London" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Postcode</label>
          <Input value={form.postcode} onChange={(e) => update("postcode", e.target.value)} placeholder="EC1A 1BB" />
        </div>
      </div>
      <Select
        label="Source"
        value={form.source}
        onChange={(e) => update("source", e.target.value)}
        options={[
          { value: "direct", label: "Direct" },
          { value: "referral", label: "Referral" },
          { value: "website", label: "Website" },
          { value: "partner", label: "Via Partner" },
          { value: "corporate", label: "Corporate Account" },
          { value: "other", label: "Other" },
        ]}
      />
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none h-20"
          placeholder="Any additional notes..."
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
        <Button type="submit" icon={<UserPlus className="h-3.5 w-3.5" />}>Create Client</Button>
      </div>
    </form>
  );
}

/* ============ BULK BUTTON ============ */
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
