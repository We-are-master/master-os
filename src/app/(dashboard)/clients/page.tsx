"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  FileText, CheckCircle2, Clock, Loader2, PlusCircle, Star as StarIcon,
  ChevronDown, ChevronRight, ExternalLink,
} from "lucide-react";
import { formatCurrency, formatDate, formatRelativeTime, isUuid } from "@/lib/utils";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";
import { CREATE_LINKED_ACCOUNT_OPTION } from "@/lib/client-linked-account";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { toast } from "sonner";
import type { Client, ClientType, ClientSource, ClientStatus } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import { listClients, createClient, updateClient, getClient } from "@/services/clients";
import {
  createClientAddress,
  listAddressesByClient,
  setDefaultClientAddress,
  deleteClientAddress,
} from "@/services/client-addresses";
import type { ClientAddress } from "@/types/database";
import { listClientSourceAccounts, createClientSourceAccount } from "@/services/client-source-accounts";
import { getStatusCounts, getSupabase } from "@/services/base";
import { clientsJobHistorySelectColumns } from "@/lib/job-schema-compat";
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

function OpenClientFromQuery({ setSelectedClient }: { setSelectedClient: (c: Client | null) => void }) {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await getClient(clientId);
        if (!cancelled && row) setSelectedClient(row);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, setSelectedClient]);

  return null;
}

function ClientsPageInner() {
  const {
    data, loading, page, totalPages, totalItems,
    setPage, search, setSearch, status, setStatus, refresh,
  } = useSupabaseList<Client>({ fetcher: listClients, realtimeTable: "clients" });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { profile } = useProfile();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [totalSpent, setTotalSpent] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [sourceAccounts, setSourceAccounts] = useState<Array<{ id: string; name: string }>>([]);

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
  const loadSourceAccounts = useCallback(() => {
    listClientSourceAccounts()
      .then((list) => setSourceAccounts(list.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSourceAccounts();
  }, [loadSourceAccounts]);

  useEffect(() => {
    if (createOpen) loadSourceAccounts();
  }, [createOpen, loadSourceAccounts]);

  const tabs = [
    { id: "all", label: "All", count: statusCounts.all ?? 0 },
    { id: "active", label: "Active", count: statusCounts.active ?? 0 },
    { id: "vip", label: "VIP", count: statusCounts.vip ?? 0 },
    { id: "inactive", label: "Inactive", count: statusCounts.inactive ?? 0 },
    { id: "blocked", label: "Blocked", count: statusCounts.blocked ?? 0 },
  ];

  const handleCreate = useCallback(async (formData: Partial<Client> & { property_address_parts?: AddressParts }) => {
    try {
      const sid = formData.source_account_id?.trim() ?? "";
      if (!sid || sid === CREATE_LINKED_ACCOUNT_OPTION || !isUuid(sid)) {
        toast.error(
          "Pick an account from the list, or choose “Create new account”, fill company/contact/email, then click Create client."
        );
        return;
      }
      // If the user filled the "Property address" section but left the main address
      // blank, backfill the client record so it doesn't appear empty in the edit form.
      const parts = formData.property_address_parts;
      const mainAddress = formData.address?.trim() || parts?.address || parts?.full_address || undefined;
      const mainCity = formData.city?.trim() || parts?.city || undefined;
      const mainPostcode = formData.postcode?.trim() || parts?.postcode || undefined;

      const result = await createClient({
        source_account_id: sid,
        full_name: formData.full_name ?? "",
        email: formData.email ?? undefined,
        phone: formData.phone ?? undefined,
        address: mainAddress,
        city: mainCity,
        postcode: mainPostcode,
        client_type: formData.client_type ?? "residential",
        source: formData.source ?? "direct",
        status: "active",
        notes: formData.notes ?? undefined,
        tags: [],
      });
      if (parts) {
        await createClientAddress({
          client_id: result.id,
          address: parts.address || parts.full_address,
          city: parts.city,
          postcode: parts.postcode,
          country: parts.country || "gb",
          is_default: true,
        });
      }
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
      loadSourceAccounts();
      refresh(); loadCounts(); loadAggregates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create client");
    }
  }, [refresh, loadCounts, loadAggregates, profile?.id, profile?.full_name, loadSourceAccounts]);

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
      key: "source_account_id", label: "Account",
      render: (item) => {
        const aid = item.source_account_id?.trim();
        if (!aid) return <span className="text-xs text-text-tertiary">—</span>;
        const name = sourceAccounts.find((a) => a.id === aid)?.name;
        return (
          <span className="text-xs text-text-secondary" title={aid}>
            {name ?? `Linked (${aid.slice(0, 8)}…)`}
          </span>
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
      <OpenClientFromQuery setSelectedClient={setSelectedClient} />
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
        sourceAccounts={sourceAccounts}
        onClose={() => setSelectedClient(null)}
        onUpdate={(updated) => { setSelectedClient(updated); refresh(); loadCounts(); loadAggregates(); }}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New client" subtitle="Link the client to an account from Accounts (or create one)" size="lg">
        <CreateClientForm sourceAccounts={sourceAccounts} onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </PageTransition>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <ClientsPageInner />
    </Suspense>
  );
}

/* ============ JOB HISTORY CARD ============ */
function JobHistoryCard({ job }: {
  job: {
    id: string;
    reference: string;
    title: string;
    status: string;
    client_price: number;
    customer_deposit_paid?: boolean;
    customer_final_payment?: number;
    scheduled_date?: string;
    scheduled_start_at?: string;
    scheduled_end_at?: string;
    scheduled_finish_date?: string | null;
    property_address?: string;
    partner_name?: string;
    job_type?: string;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const scheduleLine = formatJobScheduleLine(job);

  const statusVariant =
    job.status === "completed" ? "success" :
    job.status === "cancelled" ? "danger" :
    job.status === "in_progress" || job.status === "in_progress_phase1" || job.status === "in_progress_phase2" ? "info" :
    job.status === "late" ? "danger" :
    job.status === "unassigned" ? "warning" :
    job.status === "scheduled" ? "warning" : "default";

  return (
    <motion.div variants={staggerItem} className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 hover:bg-surface-hover transition-colors text-left"
      >
        <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center shrink-0">
          <Briefcase className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">{job.reference}</p>
          <p className="text-[11px] text-text-tertiary truncate">{job.title}</p>
        </div>
        <div className="text-right shrink-0 mr-1">
          <p className="text-sm font-semibold text-text-primary">{formatCurrency(job.client_price)}</p>
          <Badge variant={statusVariant} size="sm">{job.status.replace(/_/g, " ")}</Badge>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-tertiary shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border-light px-3 py-3 bg-surface-hover/40 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {scheduleLine ? (
              <>
                <span className="text-text-tertiary flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Schedule
                </span>
                <span className="text-text-secondary font-medium leading-snug">{scheduleLine}</span>
              </>
            ) : null}
            {job.partner_name && (
              <>
                <span className="text-text-tertiary">Partner</span>
                <span className="text-text-secondary font-medium">{job.partner_name}</span>
              </>
            )}
            {job.job_type && (
              <>
                <span className="text-text-tertiary">Type</span>
                <span className="text-text-secondary font-medium capitalize">{job.job_type}</span>
              </>
            )}
            {job.property_address && (
              <>
                <span className="text-text-tertiary flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Address
                </span>
                <span className="text-text-secondary font-medium truncate">{job.property_address}</span>
              </>
            )}
            {(() => {
              const total = job.customer_final_payment ?? job.client_price ?? 0;
              const amountDue = job.status === "completed" ? 0 : total;
              return amountDue > 0 ? (
                <>
                  <span className="text-text-tertiary">Amount due</span>
                  <span className="text-amber-500 font-semibold">{formatCurrency(amountDue)}</span>
                </>
              ) : null;
            })()}
          </div>
          <div className="pt-1">
            <a
              href={`/jobs/${job.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open job card
            </a>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ============ ADDRESSES TAB ============ */
function AddressesTab({ client }: { client: Client }) {
  const [addresses, setAddresses] = useState<ClientAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({ label: "", address: "", city: "", postcode: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAddresses(await listAddressesByClient(client.id));
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    if (!newForm.address.trim()) { toast.error("Address is required"); return; }
    setSaving(true);
    try {
      await createClientAddress({
        client_id: client.id,
        label: newForm.label.trim() || undefined,
        address: newForm.address.trim(),
        city: newForm.city.trim() || undefined,
        postcode: newForm.postcode.trim() || undefined,
        country: "gb",
        is_default: addresses.length === 0,
      });
      setNewForm({ label: "", address: "", city: "", postcode: "" });
      setAdding(false);
      toast.success("Address saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultClientAddress(client.id, id);
      toast.success("Default address updated");
      await load();
    } catch {
      toast.error("Failed to update default");
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteClientAddress(id);
      toast.success("Address removed");
      await load();
    } catch {
      toast.error("Failed to remove address");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-surface-tertiary animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3">
      {addresses.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-border bg-surface-hover/50 px-4 py-6 text-center">
          <MapPin className="h-6 w-6 mx-auto text-text-tertiary mb-2" />
          <p className="text-sm text-text-secondary font-medium">No addresses yet</p>
          <p className="text-xs text-text-tertiary mt-0.5">Add the first address for this client</p>
        </div>
      )}

      {addresses.map((addr) => (
        <div
          key={addr.id}
          className="rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3"
        >
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <MapPin className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {addr.label && (
                <span className="text-xs font-semibold text-text-primary">{addr.label}</span>
              )}
              {addr.is_default && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <StarIcon className="h-2.5 w-2.5" /> Default
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary mt-0.5 truncate">{addr.address}</p>
            {(addr.city || addr.postcode) && (
              <p className="text-xs text-text-tertiary">
                {[addr.city, addr.postcode].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!addr.is_default && (
              <button
                type="button"
                onClick={() => handleSetDefault(addr.id)}
                title="Set as default"
                className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-primary transition-colors"
              >
                <StarIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDelete(addr.id)}
              disabled={deletingId === addr.id}
              title="Remove address"
              className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-red-500 transition-colors disabled:opacity-50"
            >
              {deletingId === addr.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-primary/30 bg-card px-4 py-4 space-y-3">
          <p className="text-xs font-semibold text-text-primary">New address</p>
          <Input
            placeholder="Label (e.g. Home, Office, Property 1)"
            value={newForm.label}
            onChange={(e) => setNewForm((p) => ({ ...p, label: e.target.value }))}
          />
          <AddressAutocomplete
            label=""
            placeholder="Start typing address or postcode..."
            value={newForm.address}
            onChange={(v) => setNewForm((p) => ({ ...p, address: v }))}
            onSelect={(parts) =>
              setNewForm((p) => ({
                ...p,
                address: parts.address || parts.full_address,
                city: parts.city || p.city,
                postcode: parts.postcode || p.postcode,
              }))
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="City"
              value={newForm.city}
              onChange={(e) => setNewForm((p) => ({ ...p, city: e.target.value }))}
            />
            <Input
              placeholder="Postcode"
              value={newForm.postcode}
              onChange={(e) => setNewForm((p) => ({ ...p, postcode: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAdding(false); setNewForm({ label: "", address: "", city: "", postcode: "" }); }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save address"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-hover/40 py-3 text-sm text-text-secondary hover:border-primary/40 hover:text-text-primary transition-colors"
        >
          <PlusCircle className="h-4 w-4" />
          Add address
        </button>
      )}
    </div>
  );
}

/* ============ DETAIL DRAWER ============ */
function ClientDetailDrawer({
  client,
  sourceAccounts,
  onClose,
  onUpdate,
}: {
  client: Client | null;
  sourceAccounts: Array<{ id: string; name: string }>;
  onClose: () => void;
  onUpdate: (c: Client) => void;
}) {
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; reference: string; title: string; status: string; client_price: number; customer_deposit_paid?: boolean; customer_final_payment?: number; scheduled_date?: string; scheduled_start_at?: string; scheduled_end_at?: string; scheduled_finish_date?: string | null; property_address?: string; partner_name?: string; job_type?: string }[]>([]);
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
    const jobFields = clientsJobHistorySelectColumns();

    // Two queries per entity: by client_id (reliable FK) + by client_name (legacy/fallback).
    // Merged and deduplicated client-side to avoid PostgREST OR filter issues with names
    // that contain spaces or special characters.
    Promise.all([
      supabase.from("jobs").select(jobFields).eq("client_id", client.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      supabase.from("jobs").select(jobFields).ilike("client_name", `%${client.full_name}%`).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      supabase.from("quotes").select("id, reference, title, status, total_value").eq("client_id", client.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      supabase.from("quotes").select("id, reference, title, status, total_value").ilike("client_name", `%${client.full_name}%`).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      supabase.from("service_requests").select("id, reference, service_type, status, created_at").eq("client_id", client.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      supabase.from("service_requests").select("id, reference, service_type, status, created_at").ilike("client_name", `%${client.full_name}%`).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    ]).then(([jobsById, jobsByName, quotesById, quotesByName, reqsById, reqsByName]) => {
      const mergeById = <T extends { id: string }>(a: T[], b: T[]) =>
        Array.from(new Map([...a, ...b].map((x) => [x.id, x])).values());

      setJobs(
        mergeById(
          (jobsById.data ?? []) as unknown as typeof jobs,
          (jobsByName.data ?? []) as unknown as typeof jobs
        )
      );
      setQuotes(mergeById((quotesById.data ?? []) as typeof quotes, (quotesByName.data ?? []) as typeof quotes));
      setRequests(mergeById((reqsById.data ?? []) as typeof requests, (reqsByName.data ?? []) as typeof requests));
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally { setSaving(false); }
  };

  const drawerTabs = [
    { id: "overview", label: "Overview" },
    { id: "history", label: `History (${jobs.length + quotes.length + requests.length})` },
    { id: "addresses", label: "Addresses" },
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
                  {formatCurrency(totalQuoteValue)} in quotes
                  {client.source_account_id && sourceAccounts.length > 0 && (
                    <> · Source: {sourceAccounts.find((a) => a.id === client.source_account_id)?.name ?? "—"}</>
                  )}
                  {!client.source_account_id && <> · {sourceLabels[client.source]} source</>}
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
                          <JobHistoryCard key={job.id} job={job} />
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
                                <p className="text-[11px] text-text-tertiary">{normalizeTypeOfWork(r.service_type) || r.service_type}</p>
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

          {tab === "addresses" && (
            <AddressesTab client={client} />
          )}

          {tab === "edit" && (
            <EditClientForm
              client={client}
              sourceAccounts={sourceAccounts}
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
  sourceAccounts,
  saving,
  onSave,
  onCancel,
}: {
  client: Client;
  sourceAccounts: Array<{ id: string; name: string }>;
  saving: boolean;
  onSave: (data: Partial<Client>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const linkedAccountSelectOptions = useMemo(() => {
    const fromList = sourceAccounts.map((a) => ({ value: a.id, label: a.name }));
    const cid = client.source_account_id?.trim();
    if (cid && isUuid(cid) && !fromList.some((o) => o.value === cid)) {
      return [{ value: cid, label: `Current link (${cid.slice(0, 8)}…)` }, ...fromList];
    }
    return fromList;
  }, [sourceAccounts, client.source_account_id]);

  const [form, setForm] = useState({
    full_name: client.full_name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    postcode: client.postcode ?? "",
    client_type: client.client_type,
    source_account_id: client.source_account_id ?? "",
    source: client.source,
    status: client.status,
    notes: client.notes ?? "",
  });

  useEffect(() => {
    const base = {
      full_name: client.full_name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      city: client.city ?? "",
      postcode: client.postcode ?? "",
      client_type: client.client_type,
      source_account_id: client.source_account_id ?? "",
      source: client.source,
      status: client.status,
      notes: client.notes ?? "",
    };
    queueMicrotask(() => setForm(base));

    // If the client has no address saved, try to backfill from their default property address.
    // This fixes clients created before the create-form backfill was added.
    if (!client.address?.trim()) {
      getSupabase()
        .from("client_addresses")
        .select("address, city, postcode")
        .eq("client_id", client.id)
        .eq("is_default", true)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.address) {
            setForm((prev) => ({
              ...prev,
              address: prev.address || data.address,
              city: prev.city || data.city || "",
              postcode: prev.postcode || data.postcode || "",
            }));
          }
        });
    }
  }, [client.id, client.updated_at]);

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
      <Select
        label="Linked account (Accounts) *"
        value={form.source_account_id}
        onChange={(e) => update("source_account_id", e.target.value)}
        options={[
          { value: "", label: "— Where did the client come from? —" },
          ...linkedAccountSelectOptions,
        ]}
      />
      <AddressAutocomplete
        label="Address"
        value={form.address}
        onChange={(v) => update("address", v)}
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
        <Button
          type="button"
          onClick={() => {
            const sid = form.source_account_id.trim();
            if (sid !== "" && !isUuid(sid)) {
              toast.error("Choose a valid account from the list under Accounts.");
              return;
            }
            const { source_account_id: _drop, ...rest } = form;
            onSave({
              ...rest,
              source_account_id: sid === "" ? null : sid,
            });
          }}
          disabled={saving}
          icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        >
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

/* ============ CREATE FORM ============ */
function CreateClientForm({
  sourceAccounts,
  onSubmit,
  onCancel,
}: {
  sourceAccounts: Array<{ id: string; name: string }>;
  onSubmit: (d: Partial<Client> & { property_address_parts?: AddressParts }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", address: "", city: "", postcode: "",
    source_account_id: "",
    client_type: "residential" as ClientType, source: "direct" as ClientSource, notes: "",
  });
  const [newSourceForm, setNewSourceForm] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    industry: "Residential Services",
    payment_terms: "Net 30",
  });
  const [creatingSource, setCreatingSource] = useState(false);
  const [propertyAddressParts, setPropertyAddressParts] = useState<AddressParts | null>(null);
  const [propertyAddressRaw, setPropertyAddressRaw] = useState("");
  const update = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name) { toast.error("Full name is required"); return; }
    if (!form.source_account_id) { toast.error("Please select the linked account (Accounts)"); return; }
    let sourceAccountId = form.source_account_id;
    if (sourceAccountId === CREATE_LINKED_ACCOUNT_OPTION) {
      if (!newSourceForm.company_name.trim() || !newSourceForm.contact_name.trim() || !newSourceForm.email.trim()) {
        toast.error("Fill company name, contact and email to create the linked account");
        return;
      }
      setCreatingSource(true);
      try {
        const createdAccount = await createClientSourceAccount({
          name: newSourceForm.company_name.trim(),
          contact_name: newSourceForm.contact_name.trim(),
          email: newSourceForm.email.trim(),
          industry: newSourceForm.industry,
          payment_terms: newSourceForm.payment_terms,
        });
        sourceAccountId = createdAccount.id;
        toast.success(`Account "${createdAccount.name}" created and linked`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create account");
        return;
      } finally {
        setCreatingSource(false);
      }
    }
    if (sourceAccountId === CREATE_LINKED_ACCOUNT_OPTION || !isUuid(sourceAccountId)) {
      toast.error("Resolve the linked account first (create it with the fields above or pick an existing one).");
      return;
    }
    const typedProperty = propertyAddressRaw.trim();
    const property_address_parts =
      propertyAddressParts ??
      (typedProperty
        ? { full_address: typedProperty, address: typedProperty, city: "", postcode: "", country: "gb" }
        : undefined);
    await onSubmit({ ...form, source_account_id: sourceAccountId, property_address_parts });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <Select
        label="Linked account (Accounts) *"
        value={form.source_account_id}
        onChange={(e) => {
          const value = e.target.value;
          update("source_account_id", value);
          if (value === CREATE_LINKED_ACCOUNT_OPTION) {
            setNewSourceForm((prev) => ({
              ...prev,
              contact_name: prev.contact_name || form.full_name || "Client Team",
              email: prev.email || form.email || "",
            }));
          }
        }}
        options={[
          { value: "", label: "— Where did the client come from? —" },
          ...sourceAccounts.map((a) => ({ value: a.id, label: a.name })),
          { value: CREATE_LINKED_ACCOUNT_OPTION, label: "+ Create new account" },
        ]}
      />
      {form.source_account_id === CREATE_LINKED_ACCOUNT_OPTION && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
          <p className="text-[11px] font-medium text-text-secondary">Create account (saved in Accounts)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Company name *</label>
              <Input
                value={newSourceForm.company_name}
                onChange={(e) => setNewSourceForm((p) => ({ ...p, company_name: e.target.value }))}
                placeholder="Lead source company"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Contact name *</label>
              <Input
                value={newSourceForm.contact_name}
                onChange={(e) => setNewSourceForm((p) => ({ ...p, contact_name: e.target.value }))}
                placeholder="Source owner"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Email *</label>
              <Input
                type="email"
                value={newSourceForm.email}
                onChange={(e) => setNewSourceForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="source@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Industry</label>
              <Input
                value={newSourceForm.industry}
                onChange={(e) => setNewSourceForm((p) => ({ ...p, industry: e.target.value }))}
                placeholder="Residential Services"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Payment terms</label>
            <Input
              value={newSourceForm.payment_terms}
              onChange={(e) => setNewSourceForm((p) => ({ ...p, payment_terms: e.target.value }))}
              placeholder="Net 30"
            />
          </div>
        </div>
      )}
      <p className="text-[10px] text-text-tertiary -mt-2">Options come from Accounts in the database. The client row stores the selected account ID.</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Full name *</label>
          <Input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} placeholder="Client name" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
          <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="email@example.com" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Phone</label>
          <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+44 7700 900000" />
        </div>
        <Select
          label="Client type"
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
        onChange={(v) => update("address", v)}
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
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Property address (optional)</label>
        <p className="text-[10px] text-text-tertiary mb-2">Select an existing address or add a new one. For a new client there are no addresses yet.</p>
        <select
          disabled
          className="w-full h-9 rounded-lg border border-border bg-surface-hover px-3 text-sm text-text-tertiary cursor-not-allowed"
          title="No addresses yet for new client"
        >
          <option>— No addresses yet —</option>
        </select>
        <div className="mt-2">
          <p className="text-[10px] font-medium text-text-secondary mb-1.5">Add new address</p>
          <AddressAutocomplete
            value={propertyAddressRaw}
            onChange={(v) => {
              setPropertyAddressRaw(v);
              setPropertyAddressParts(null);
            }}
            onSelect={(parts) => {
              setPropertyAddressParts(parts);
              setPropertyAddressRaw(parts.full_address);
            }}
            placeholder="Type address or postcode..."
          />
          {propertyAddressParts && (
            <p className="text-[10px] text-primary mt-1">This address will be saved as a property linked to the client.</p>
          )}
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
        <Button type="submit" disabled={creatingSource} icon={<UserPlus className="h-3.5 w-3.5" />}>
          {creatingSource ? "Creating source..." : "Create client"}
        </Button>
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
