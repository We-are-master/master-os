"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { CatalogService, CatalogPricingMode } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import { useAdminConfig } from "@/hooks/use-admin-config";
import {
  listCatalogServices,
  createCatalogService,
  updateCatalogService,
  deleteCatalogService,
} from "@/services/catalog-services";
import { estimatedValueFromCatalog } from "@/lib/catalog-service-defaults";
import { getSupabase } from "@/services/base";
import { Plus, Pencil, Trash2 } from "lucide-react";

const emptyForm = {
  name: "",
  pricing_mode: "fixed" as CatalogPricingMode,
  fixed_price: "",
  hourly_rate: "",
  default_hours: "1",
  partner_cost: "",
  default_description: "",
  sort_order: "0",
  is_active: true,
};

export default function ServicesCatalogPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const { can, loading: configLoading } = useAdminConfig();
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
  } = useSupabaseList<CatalogService>({ fetcher: listCatalogServices, realtimeTable: "service_catalog", pageSize: 15 });

  const [counts, setCounts] = useState({ all: 0, active: 0, inactive: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<CatalogService | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const loadCounts = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [a, b, c] = await Promise.all([
        supabase.from("service_catalog").select("*", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("service_catalog").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true),
        supabase.from("service_catalog").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", false),
      ]);
      setCounts({ all: a.count ?? 0, active: b.count ?? 0, inactive: c.count ?? 0 });
    } catch {
      /* cosmetic */
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts, data.length]);

  useEffect(() => {
    if (configLoading) return;
    if (!can("service_catalog")) {
      toast.error("You don’t have permission to access the service catalogue.");
      router.replace("/");
    }
  }, [configLoading, can, router]);

  if (configLoading) {
    return (
      <PageTransition>
        <div className="p-12 text-center text-text-tertiary text-sm">A carregar…</div>
      </PageTransition>
    );
  }
  if (!can("service_catalog")) {
    return null;
  }

  const tabs = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "inactive", label: "Inactive", count: counts.inactive },
  ];

  const openCreate = () => {
    setForm(emptyForm);
    setCreateOpen(true);
  };

  const openEdit = (row: CatalogService) => {
    setEditRow(row);
    setForm({
      name: row.name,
      pricing_mode: row.pricing_mode,
      fixed_price: String(row.fixed_price ?? 0),
      hourly_rate: String(row.hourly_rate ?? 0),
      default_hours: String(row.default_hours ?? 1),
      partner_cost: String(row.partner_cost ?? 0),
      default_description: row.default_description ?? "",
      sort_order: String(row.sort_order ?? 0),
      is_active: row.is_active,
    });
  };

  const parsePayload = () => ({
    name: form.name.trim(),
    pricing_mode: form.pricing_mode,
    fixed_price: Number(form.fixed_price) || 0,
    hourly_rate: Number(form.hourly_rate) || 0,
    default_hours: Math.max(0.25, Number(form.default_hours) || 1),
    partner_cost: Math.max(0, Number(form.partner_cost) || 0),
    default_description: form.default_description.trim() || null,
    sort_order: Math.floor(Number(form.sort_order) || 0),
    is_active: form.is_active,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      await createCatalogService(parsePayload());
      toast.success("Service saved to catalog");
      setCreateOpen(false);
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRow || !form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      await updateCatalogService(editRow.id, parsePayload());
      toast.success("Service updated");
      setEditRow(null);
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row: CatalogService) => {
    if (!confirm(`Remove "${row.name}" from the catalog?`)) return;
    try {
      await deleteCatalogService(row.id, profile?.id);
      toast.success("Service removed");
      refresh();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const columns: Column<CatalogService>[] = [
    {
      key: "name",
      label: "Service",
      render: (item) => (
        <div>
          <p className="text-sm font-semibold text-text-primary">{item.name}</p>
          {item.default_description && (
            <p className="text-[11px] text-text-tertiary line-clamp-2 mt-0.5">{item.default_description}</p>
          )}
        </div>
      ),
    },
    {
      key: "pricing_mode",
      label: "Pricing",
      render: (item) => (
        <div className="text-xs text-text-secondary">
          <Badge variant="outline" size="sm" className="mb-1">
            {item.pricing_mode === "fixed" ? "Fixed" : "Hourly"}
          </Badge>
          <p>
            {item.pricing_mode === "fixed"
              ? formatCurrency(item.fixed_price)
              : `${formatCurrency(item.hourly_rate)}/h · default ${item.default_hours ?? 1}h`}
          </p>
        </div>
      ),
    },
    {
      key: "margin",
      label: "Margin",
      render: (item) => {
        const sell = estimatedValueFromCatalog(item);
        const pc = Number(item.partner_cost) || 0;
        const m = sell - pc;
        const pct = sell > 0 ? (m / sell) * 100 : 0;
        return (
          <div className="text-xs">
            <p className={`font-medium tabular-nums ${m >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(m)}</p>
            <p className="text-[10px] text-text-tertiary">{pct.toFixed(0)}% of sell</p>
          </div>
        );
      },
    },
    { key: "sort_order", label: "Order", render: (item) => <span className="text-sm text-text-secondary">{item.sort_order}</span> },
    {
      key: "is_active",
      label: "Status",
      render: (item) => (
        <Badge variant={item.is_active ? "success" : "default"} size="sm">
          {item.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "",
      width: "100px",
      render: (item) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(item)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600" onClick={() => handleDelete(item)} aria-label="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const sellerTotal =
    form.pricing_mode === "fixed"
      ? Number(form.fixed_price) || 0
      : (() => {
          const h = Math.max(0.25, Number(form.default_hours) || 1);
          return (Number(form.hourly_rate) || 0) * h;
        })();
  const partnerCostNum = Math.max(0, Number(form.partner_cost) || 0);
  const marginValue = sellerTotal - partnerCostNum;
  const marginPercent = sellerTotal > 0 ? (marginValue / sellerTotal) * 100 : 0;

  const FormFields = (
    <>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Name *</label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Boiler service" />
      </div>
      <Select
        label="Pricing mode"
        value={form.pricing_mode}
        onChange={(e) => setForm((f) => ({ ...f, pricing_mode: e.target.value as CatalogPricingMode }))}
        options={[
          { value: "fixed", label: "Fixed price" },
          { value: "hourly", label: "Per hour" },
        ]}
      />
      {form.pricing_mode === "fixed" ? (
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Seller price *</label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={form.fixed_price}
            onChange={(e) => setForm((f) => ({ ...f, fixed_price: e.target.value }))}
            placeholder="0"
          />
          <p className="text-[10px] text-text-tertiary mt-1">Price to the customer for this service.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Seller hourly rate *</label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={form.hourly_rate}
                onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Default hours *</label>
              <Input
                type="number"
                step="0.25"
                min={0.25}
                value={form.default_hours}
                onChange={(e) => setForm((f) => ({ ...f, default_hours: e.target.value }))}
                placeholder="1"
              />
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary -mt-2">Seller total = rate × hours (used for margin and quote defaults).</p>
        </>
      )}
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner cost</label>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={form.partner_cost}
          onChange={(e) => setForm((f) => ({ ...f, partner_cost: e.target.value }))}
          placeholder="0"
        />
        <p className="text-[10px] text-text-tertiary mt-1">
          {form.pricing_mode === "fixed"
            ? "What you pay the partner to deliver this job."
            : "Total partner cost for the default hours bundle (same scope as seller total)."}
        </p>
      </div>
      <div className="p-4 rounded-xl border border-border bg-surface-hover">
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Margin (profit)</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-text-tertiary">Seller total</span>
            <p className="font-semibold text-text-primary tabular-nums">{formatCurrency(sellerTotal)}</p>
          </div>
          <div>
            <span className="text-text-tertiary">Partner cost</span>
            <p className="font-semibold text-text-primary tabular-nums">{formatCurrency(partnerCostNum)}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border-light">
          <p className="text-xs text-text-tertiary">Seller total − partner cost</p>
          <p className={`text-lg font-bold tabular-nums ${marginValue >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(marginValue)}</p>
          <p className="text-[11px] text-text-secondary mt-0.5">
            {sellerTotal > 0 ? `${marginPercent.toFixed(1)}% margin on seller price` : "—"}
          </p>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Default description (optional)</label>
        <textarea
          value={form.default_description}
          onChange={(e) => setForm((f) => ({ ...f, default_description: e.target.value }))}
          rows={3}
          placeholder="Prefills request/quote text; staff can always edit."
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Sort order</label>
          <Input type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-border"
            />
            Active in pickers
          </label>
        </div>
      </div>
    </>
  );

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Service catalog" subtitle="Fixed and hourly templates — requests and quotes stay fully editable.">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
            New service
          </Button>
        </PageHeader>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Tabs tabs={tabs} activeTab={status} onChange={setStatus} />
          <SearchInput placeholder="Search services…" className="w-full sm:w-56" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <DataTable
          columns={columns}
          data={data}
          getRowId={(r) => r.id}
          loading={loading}
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          onPageChange={setPage}
        />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New catalog service" subtitle="Defaults only — each request/quote can override.">
        <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
          {FormFields}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Saving…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit service" subtitle={editRow?.name}>
        <form onSubmit={handleUpdate} className="px-6 py-5 space-y-4">
          {FormFields}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
    </PageTransition>
  );
}
