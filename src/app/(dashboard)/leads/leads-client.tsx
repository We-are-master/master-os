"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { LeadOffersCard } from "@/components/leads/lead-offers-card";
import { Modal } from "@/components/ui/modal";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { Plus, Loader2, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CatalogService, Lead, LeadStatus, LeadUrgency } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import { listLeads, createLead, updateLead, deleteLead, countJobsForClient } from "@/services/leads";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { getStatusCounts, type ListResult } from "@/services/base";
import { cn, formatYmdUkDisplay } from "@/lib/utils";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";
import { validateLeadForm, type LeadFieldErrors } from "@/lib/lead-validation";

function mapboxPartsToLeadFields(parts: AddressParts) {
  const address =
    parts.full_address?.trim() ||
    [parts.address, parts.city, parts.postcode].filter(Boolean).join(", ");
  return {
    address,
    city: parts.city?.trim() ?? "",
    postcode: parts.postcode?.trim() ?? "",
  };
}

/** Single line for Mapbox field — merges stored address / city / postcode when needed. */
function leadAddressDisplay(lead: { address: string; city?: string | null; postcode?: string | null }): string {
  const line = lead.address?.trim() ?? "";
  const city = lead.city?.trim();
  const pc = lead.postcode?.trim();
  if (!city && !pc) return line;
  const lower = line.toLowerCase();
  if (pc && lower.includes(pc.toLowerCase())) {
    if (!city || lower.includes(city.toLowerCase())) return line;
    return `${line}, ${city}`;
  }
  return [line, city, pc].filter(Boolean).join(", ");
}

type LeadFormState = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  urgency: LeadUrgency;
  scope: string;
  status: LeadStatus;
  /** service_catalog.id — required so the Trade Portal can target matching partners. */
  catalog_service_id: string;
};

function emptyLeadForm(status: LeadStatus = "new"): LeadFormState {
  return {
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postcode: "",
    urgency: "medium",
    scope: "",
    status,
    catalog_service_id: "",
  };
}

function FieldBlock({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label}</label>
      {children}
      {error ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

const LEAD_STATUSES: LeadStatus[] = ["new", "interested"];

const statusConfig: Record<
  LeadStatus,
  { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }
> = {
  new: { label: "New", variant: "primary" },
  interested: { label: "Interested", variant: "success" },
};

const urgencyConfig: Record<
  LeadUrgency,
  { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }
> = {
  low: { label: "Low", variant: "default" },
  medium: { label: "Medium", variant: "info" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "danger" },
};

interface LeadsClientProps {
  initialData?: ListResult<Lead> | null;
}

export function LeadsClient({ initialData }: LeadsClientProps = {}) {
  const { profile } = useProfile();
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
  } = useSupabaseList<Lead>({
    fetcher: listLeads,
    realtimeTable: "leads",
    initialData,
    initialStatus: "new",
  });

  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState(() => emptyLeadForm());
  const [createErrors, setCreateErrors] = useState<LeadFieldErrors>({});
  const [editForm, setEditForm] = useState(() => emptyLeadForm());
  const [editErrors, setEditErrors] = useState<LeadFieldErrors>({});
  const [linkedJobsCount, setLinkedJobsCount] = useState<number | null>(null);

  // Service catalog rows for the Type of Work picker. Loaded once on mount —
  // the list is small (canonical trade names + custom services) and the
  // picker is only used in the New Lead modal.
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  useEffect(() => {
    let active = true;
    listCatalogServicesForPicker()
      .then((rows) => {
        if (active) setCatalogServices(rows);
      })
      .catch((err) => {
        console.error("[leads] failed to load service_catalog:", err);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const counts = await getStatusCounts("leads", LEAD_STATUSES);
      setStatusCounts(counts);
    } catch {
      setStatusCounts({});
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts, data.length, status]);

  const handleDelete = useCallback(
    async (lead: Lead) => {
      const label = lead.reference?.trim() || lead.name?.trim() || "this lead";
      if (
        !confirm(
          `Delete ${label}? It will be removed from Leads, Pulse, and the Trade Portal. The linked Fixfy client contact is kept.`,
        )
      ) {
        return;
      }
      setDeletingId(lead.id);
      try {
        await deleteLead(lead.id, profile?.id);
        toast.success("Lead deleted");
        setSelectedLead((current) => (current?.id === lead.id ? null : current));
        await refresh();
        await loadCounts();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not delete lead");
      } finally {
        setDeletingId(null);
      }
    },
    [loadCounts, profile?.id, refresh],
  );

  useEffect(() => {
    if (!selectedLead) {
      setLinkedJobsCount(null);
      return;
    }
    setEditErrors({});
    setEditForm({
      name: selectedLead.name,
      email: selectedLead.email ?? "",
      phone: selectedLead.phone ?? "",
      address: leadAddressDisplay(selectedLead),
      city: selectedLead.city ?? "",
      postcode: selectedLead.postcode ?? "",
      urgency: selectedLead.urgency,
      scope: selectedLead.scope ?? "",
      status: selectedLead.status,
      catalog_service_id: selectedLead.catalog_service_id ?? "",
    });

    const clientId = selectedLead.client_id;
    if (!clientId) {
      setLinkedJobsCount(0);
      return;
    }
    setLinkedJobsCount(null);
    let cancelled = false;
    countJobsForClient(clientId).then((n) => {
      if (!cancelled) setLinkedJobsCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedLead]);

  const tabs = useMemo(
    () =>
      LEAD_STATUSES.map((st) => ({
        id: st,
        label: statusConfig[st].label,
        count: statusCounts[st] ?? 0,
      })),
    [statusCounts],
  );

  const columns: Column<Lead>[] = useMemo(
    () => [
      {
        key: "reference",
        label: "Ref",
        sortable: true,
        minWidth: "6.5rem",
        headerClassName: "hidden sm:table-cell",
        cellClassName: "hidden sm:table-cell",
        render: (item) => (
          <span className="font-mono text-xs text-text-secondary tabular-nums whitespace-nowrap">
            {item.reference}
          </span>
        ),
      },
      {
        key: "name",
        label: "Lead",
        sortable: true,
        minWidth: "10rem",
        cellClassName: "min-w-[9rem] max-w-[min(100vw-8rem,22rem)] sm:max-w-xs lg:max-w-sm",
        render: (item) => {
          const urgency = urgencyConfig[item.urgency] ?? urgencyConfig.medium;
          const scopePreview = item.scope?.trim();
          return (
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
              <p className="font-mono text-[10px] text-text-tertiary tabular-nums sm:hidden">{item.reference}</p>
              <div className="flex flex-wrap items-center gap-1.5 md:hidden">
                <Badge variant={urgency.variant} className="text-[10px] px-1.5 py-0">
                  {urgency.label}
                </Badge>
                <Badge variant={statusConfig[item.status].variant} className="text-[10px] px-1.5 py-0">
                  {statusConfig[item.status].label}
                </Badge>
              </div>
              {item.email ? (
                <p className="text-[11px] text-text-tertiary truncate md:hidden">{item.email}</p>
              ) : null}
              {scopePreview ? (
                <p className="text-[11px] text-text-tertiary line-clamp-2 whitespace-pre-wrap lg:hidden">
                  {scopePreview}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "email",
        label: "Email",
        minWidth: "9rem",
        headerClassName: "hidden md:table-cell",
        cellClassName: "hidden md:table-cell max-w-[12rem]",
        render: (item) => (
          <span className="text-xs text-text-secondary truncate block">{item.email ?? "—"}</span>
        ),
      },
      {
        key: "phone",
        label: "Phone",
        minWidth: "7rem",
        headerClassName: "hidden lg:table-cell",
        cellClassName: "hidden lg:table-cell whitespace-nowrap",
        render: (item) => (
          <span className="text-xs text-text-secondary tabular-nums">{item.phone ?? "—"}</span>
        ),
      },
      {
        key: "urgency",
        label: "Urgency",
        minWidth: "5.5rem",
        headerClassName: "hidden md:table-cell",
        cellClassName: "hidden md:table-cell",
        render: (item) => {
          const cfg = urgencyConfig[item.urgency] ?? urgencyConfig.medium;
          return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
        },
      },
      {
        key: "scope",
        label: "Scope",
        minWidth: "12rem",
        headerClassName: "hidden lg:table-cell",
        cellClassName: "hidden lg:table-cell max-w-md",
        render: (item) => (
          <p className="text-xs text-text-secondary line-clamp-2 whitespace-pre-wrap">
            {item.scope?.trim() || "—"}
          </p>
        ),
      },
      {
        key: "status",
        label: "Status",
        minWidth: "5.5rem",
        headerClassName: "hidden md:table-cell",
        cellClassName: "hidden md:table-cell",
        render: (item) => {
          const cfg = statusConfig[item.status] ?? statusConfig.new;
          return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
        },
      },
      {
        key: "created_at",
        label: "Created",
        sortable: true,
        minWidth: "5.5rem",
        headerClassName: "hidden sm:table-cell",
        cellClassName: "hidden sm:table-cell",
        render: (item) => (
          <span className="text-xs text-text-tertiary tabular-nums whitespace-nowrap">
            {formatYmdUkDisplay(item.created_at.slice(0, 10))}
          </span>
        ),
      },
      {
        key: "actions",
        label: "",
        width: "2.75rem",
        align: "right",
        headerClassName: "w-11",
        cellClassName: "w-11",
        render: (item) => (
          <button
            type="button"
            title="Delete lead"
            aria-label={`Delete ${item.reference ?? item.name}`}
            disabled={deletingId === item.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(item);
            }}
            className="rounded-lg p-1.5 text-text-tertiary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {deletingId === item.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        ),
      },
    ],
    [deletingId, handleDelete],
  );

  const handleCreate = async () => {
    const errors = validateLeadForm(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(Object.values(errors)[0] ?? "Check the form");
      return;
    }
    // Type of Work is required so the Trade Portal can target matching
    // partners. validateLeadForm doesn't cover it (catalog-aware fields aren't
    // in the validator's responsibility), so we gate it here.
    if (!createForm.catalog_service_id.trim()) {
      toast.error("Select a Type of Work");
      return;
    }
    setCreating(true);
    try {
      const lead = await createLead({
        name: createForm.name,
        email: createForm.email,
        phone: createForm.phone,
        address: createForm.address,
        city: createForm.city,
        postcode: createForm.postcode,
        urgency: createForm.urgency,
        scope: createForm.scope,
        status: "new",
        catalog_service_id: createForm.catalog_service_id,
      });
      toast.success(`Lead ${lead.reference} created and linked to Fixfy clients`);
      setCreateOpen(false);
      setCreateForm(emptyLeadForm());
      setCreateErrors({});
      setStatus("new");
      await refresh();
      await loadCounts();
      setSelectedLead(lead);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create lead");
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedLead) return;
    const errors = validateLeadForm(editForm);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(Object.values(errors)[0] ?? "Check the form");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateLead(selectedLead.id, {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        address: editForm.address,
        city: editForm.city,
        postcode: editForm.postcode,
        urgency: editForm.urgency,
        scope: editForm.scope,
        status: editForm.status,
      });
      toast.success("Lead updated");
      setSelectedLead(updated);
      await refresh();
      await loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lead");
    } finally {
      setSaving(false);
    }
  };

  const markInterested = async () => {
    if (!selectedLead || selectedLead.status === "interested") return;
    setSaving(true);
    try {
      const updated = await updateLead(selectedLead.id, { status: "interested" });
      toast.success("Marked as Interested");
      setSelectedLead(updated);
      setEditForm((f) => ({ ...f, status: "interested" }));
      setStatus("interested");
      await refresh();
      await loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!selectedLead) return;
    const next = selectedLead.published_at ? null : new Date().toISOString();
    setSaving(true);
    try {
      const updated = await updateLead(selectedLead.id, { published_at: next });
      toast.success(next ? "Lead published — now live in the Trade Portal" : "Lead unpublished");
      setSelectedLead(updated);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update publish state");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTransition>
      <div className="min-w-0 space-y-4 sm:space-y-5">
        <PageHeader
          title="Leads"
          subtitle="Capture opportunities before quoting — offer interested leads to partners."
          className="!flex-col !items-stretch gap-3 sm:!flex-row sm:!items-end sm:!justify-between sm:gap-6"
        >
          <Button
            type="button"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            aria-label="Add lead"
            title="Add lead"
            onClick={() => setCreateOpen(true)}
            className={cn(
              "!flex-nowrap shrink-0 self-end sm:self-auto",
              "h-9 w-9 p-0 justify-center",
              "sm:h-auto sm:min-h-8 sm:w-auto sm:min-w-[8.75rem] sm:px-3 sm:py-1.5 sm:justify-center",
              "[&>span:last-child]:whitespace-nowrap",
            )}
          >
            <span className="hidden sm:inline">Add lead</span>
          </Button>
        </PageHeader>

        <div className="min-w-0 -mx-1 px-1 overflow-x-auto">
          <Tabs tabs={tabs} activeTab={status} onChange={setStatus} className="min-w-max sm:min-w-0" />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ref, scope…"
            className="w-full min-w-0 sm:max-w-md"
          />
          <p className="text-xs text-text-tertiary tabular-nums shrink-0 sm:text-right">
            {totalItems} lead{totalItems === 1 ? "" : "s"}
          </p>
        </div>

        <div className="min-w-0 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
          <DataTable
            className="min-w-[20rem]"
            columns={columns}
            data={data}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            onRowClick={setSelectedLead}
            emptyMessage={
              status === "new"
                ? "No new leads yet — add one to get started."
                : "No interested leads yet."
            }
          />
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateErrors({});
        }}
        title="Add lead"
        subtitle="Contact is saved under the Fixfy account in Clients. New leads start in the New tab."
        size="md"
        className="max-w-[min(100vw-1.5rem,32rem)] sm:max-w-lg"
      >
        <div className="px-4 pb-4 pt-4 space-y-3.5 sm:px-5 sm:pb-5 max-h-[min(75dvh,640px)] overflow-y-auto">
          <FieldBlock label="Name" error={createErrors.name}>
            <Input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Client or job title"
              autoFocus
              className={cn(createErrors.name && "border-red-400")}
            />
          </FieldBlock>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <FieldBlock label="Email" error={createErrors.email}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
                className={cn(createErrors.email && "border-red-400")}
              />
            </FieldBlock>
            <FieldBlock label="Phone" error={createErrors.phone}>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="07xxx xxxxxx"
                className={cn(createErrors.phone && "border-red-400")}
              />
            </FieldBlock>
          </div>
          <FieldBlock label="Address" error={createErrors.address}>
            <AddressAutocomplete
              placeholder="Start typing address or postcode…"
              value={createForm.address}
              onChange={(v) =>
                setCreateForm((f) => ({ ...f, address: v, city: "", postcode: "" }))
              }
              onSelect={(parts) => setCreateForm((f) => ({ ...f, ...mapboxPartsToLeadFields(parts) }))}
            />
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Choose a Mapbox suggestion — city and postcode are filled automatically.
            </p>
          </FieldBlock>
          <FieldBlock label="Type of Work">
            <Select
              value={createForm.catalog_service_id}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, catalog_service_id: e.target.value }))
              }
              options={[
                { value: "", label: "Select a type of work…" },
                ...catalogServices.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Drives Trade Portal targeting — only partners covering this trade will see the lead.
            </p>
          </FieldBlock>
          <FieldBlock label="Urgency">
            <Select
              value={createForm.urgency}
              onChange={(e) => setCreateForm((f) => ({ ...f, urgency: e.target.value as LeadUrgency }))}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
            />
          </FieldBlock>
          <FieldBlock label="Scope" error={createErrors.scope}>
            <textarea
              value={createForm.scope}
              onChange={(e) => setCreateForm((f) => ({ ...f, scope: e.target.value }))}
              rows={4}
              placeholder="Describe the work, access, and any constraints…"
              className={cn(
                "w-full min-h-[5.5rem] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary",
                "placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30",
                createErrors.scope && "border-red-400",
              )}
            />
          </FieldBlock>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating} className="w-full sm:w-auto">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create lead"}
            </Button>
          </div>
        </div>
      </Modal>

      <Drawer
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        title={selectedLead?.reference ?? "Lead"}
        subtitle={selectedLead?.name}
        width="w-full sm:w-[min(100vw-2rem,30rem)] lg:w-[min(100vw-3rem,38rem)]"
        footer={
          selectedLead ? (
            <div className="flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
              {selectedLead.status === "new" ? (
                <Button variant="secondary" onClick={markInterested} disabled={saving} className="w-full sm:w-auto">
                  Mark interested
                </Button>
              ) : null}
              <Button
                variant={selectedLead.published_at ? "ghost" : "secondary"}
                onClick={togglePublish}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                {selectedLead.published_at ? "Unpublish" : "Publish to partners"}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="w-full sm:ml-auto sm:w-auto">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
              </Button>
            </div>
          ) : null
        }
      >
        {selectedLead ? (
          <div className="px-4 py-4 space-y-4 sm:px-5 sm:py-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={statusConfig[selectedLead.status].variant}>
                {statusConfig[selectedLead.status].label}
              </Badge>
              <Badge variant={urgencyConfig[selectedLead.urgency].variant}>
                {urgencyConfig[selectedLead.urgency].label} urgency
              </Badge>
              {selectedLead.client_id ? (
                <Badge variant="info">Fixfy client linked</Badge>
              ) : null}
              {linkedJobsCount === 0 ? (
                <span title="No job available yet — labour-only lead" className="inline-flex">
                  <Badge variant="warning">Lead only</Badge>
                </span>
              ) : linkedJobsCount && linkedJobsCount > 0 ? (
                <Badge variant="success">
                  {linkedJobsCount} job{linkedJobsCount === 1 ? "" : "s"} linked
                </Badge>
              ) : null}
              {selectedLead.published_at ? (
                <Badge variant="default">Offered to partners</Badge>
              ) : null}
            </div>

            <LeadOffersCard leadId={selectedLead.id} published={!!selectedLead.published_at} />

            {selectedLead.client_id ? (
              <Link
                href="/clients"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                Open Clients directory
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : null}

            <FieldBlock label="Name" error={editErrors.name}>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(editErrors.name && "border-red-400")}
              />
            </FieldBlock>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <FieldBlock label="Email" error={editErrors.email}>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className={cn(editErrors.email && "border-red-400")}
                />
              </FieldBlock>
              <FieldBlock label="Phone" error={editErrors.phone}>
                <Input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className={cn(editErrors.phone && "border-red-400")}
                />
              </FieldBlock>
            </div>

            <FieldBlock label="Address" error={editErrors.address}>
              <AddressAutocomplete
                placeholder="Start typing address or postcode…"
                value={editForm.address}
                onChange={(v) =>
                  setEditForm((f) => ({ ...f, address: v, city: "", postcode: "" }))
                }
                onSelect={(parts) => setEditForm((f) => ({ ...f, ...mapboxPartsToLeadFields(parts) }))}
              />
              <p className="mt-1.5 text-[11px] text-text-tertiary">
                Choose a Mapbox suggestion — city and postcode are filled automatically.
              </p>
            </FieldBlock>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <FieldBlock label="Urgency">
                <Select
                  value={editForm.urgency}
                  onChange={(e) => setEditForm((f) => ({ ...f, urgency: e.target.value as LeadUrgency }))}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                />
              </FieldBlock>
              <FieldBlock label="Status">
                <Select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as LeadStatus }))}
                  options={[
                    { value: "new", label: "New" },
                    { value: "interested", label: "Interested" },
                  ]}
                />
              </FieldBlock>
            </div>

            <FieldBlock label="Scope" error={editErrors.scope}>
              <textarea
                value={editForm.scope}
                onChange={(e) => setEditForm((f) => ({ ...f, scope: e.target.value }))}
                rows={6}
                className={cn(
                  "w-full min-h-[6rem] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30",
                  editErrors.scope && "border-red-400",
                )}
              />
            </FieldBlock>

            <p className="text-[11px] text-text-tertiary leading-snug">
              Lead saved under the Fixfy account (matched by email). Interested leads can be offered to partners as
              labour-only when no job is available yet.
            </p>

            <div className="pt-4 mt-2 border-t border-dashed border-border-light">
              <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">
                Danger zone
              </p>
              <p className="text-xs text-text-tertiary mb-3">
                Permanently removes this lead from the OS and partner portal. Partner interest records stay in the audit
                trail but the lead no longer appears anywhere.
              </p>
              <Button
                type="button"
                variant="danger"
                className="w-full sm:w-auto"
                disabled={deletingId === selectedLead.id || saving}
                icon={
                  deletingId === selectedLead.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )
                }
                onClick={() => void handleDelete(selectedLead)}
              >
                Delete lead
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </PageTransition>
  );
}
