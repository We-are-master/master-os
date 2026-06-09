"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CatalogService, CatalogPricingMode, ServicePricingAddon, ServicePricingPreset } from "@/types/database";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { useProfile } from "@/hooks/use-profile";
import {
  listCatalogServices,
  createCatalogService,
  updateCatalogService,
  deleteCatalogService,
} from "@/services/catalog-services";
import { estimatedValueFromCatalog } from "@/lib/catalog-service-defaults";
import {
  parsePricingAddons,
  parsePricingPresets,
  presetPricingMode,
  sortPricingAddonsDisplay,
  sortPricingPresetsDisplay,
} from "@/lib/catalog-pricing-presets";
import { catalogHasStackableAddons } from "@/lib/catalog-line-pricing";
import { pricingModeLabel } from "@/lib/pricing-mode-labels";
import { catalogPricingStructureLabel } from "@/lib/catalog-pricing-labels";
import { getSupabase } from "@/services/base";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Copy } from "lucide-react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { ServiceCatalogOverview } from "./service-catalog-overview";
import {
  entryForSlug,
  serviceDisplayIconSelectOptions,
  suggestSlugFromServiceName,
  SERVICE_ICON_CELL_CLASSES,
  SERVICE_ICON_INNER_CLASSES,
} from "@/lib/service-display-icons";
import {
  catalogPartnerBundleFromHourlyRate,
  catalogPartnerTotalForDisplay,
  DEFAULT_HOURLY_BILLED_HOURS,
  partnerHourlyRateFromCatalogBundle,
} from "@/lib/job-hourly-billing";

type CatalogPricingStructure = "single" | "variable" | "base_plus_addons";

const emptyForm = {
  name: "",
  pricing_structure: "single" as CatalogPricingStructure,
  pricing_mode: "fixed" as CatalogPricingMode,
  fixed_price: "",
  hourly_rate: "",
  default_hours: "2",
  partner_cost: "",
  default_description: "",
  partner_email_notes_hourly: "",
  partner_email_notes_fixed: "",
  partner_email_notes_default: "",
  sort_order: "0",
  is_active: true,
  display_icon_key: "",
  accepts_smart_price: false,
};

type PresetFormRow = {
  id: string;
  label: string;
  pricing_mode: CatalogPricingMode;
  sell_price: string;
  default_hours: string;
  partner_cost: string;
};

type AddonFormRow = {
  id: string;
  label: string;
  fixed_price: string;
  partner_cost: string;
};

function catalogHasVariablePricing(row: Pick<CatalogService, "pricing_presets" | "pricing_addons">): boolean {
  return parsePricingPresets(row.pricing_presets).length > 0 && !catalogHasStackableAddons(row);
}

function addonIdFromLabel(label: string, ord: number): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (base || `addon_${ord}`).slice(0, 48);
}

function newAddonFormRow(): AddonFormRow {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `a_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return { id, label: "", fixed_price: "", partner_cost: "" };
}

function duplicateAddonFormRow(source: AddonFormRow): AddonFormRow {
  return {
    ...newAddonFormRow(),
    label: source.label,
    fixed_price: source.fixed_price,
    partner_cost: source.partner_cost,
  };
}

function addonRowsFromCatalogRow(row: CatalogService): AddonFormRow[] {
  return sortPricingAddonsDisplay(parsePricingAddons(row.pricing_addons)).map((a) => ({
    id: a.id,
    label: a.label,
    fixed_price: String(a.fixed_price ?? ""),
    partner_cost: a.partner_cost != null ? String(a.partner_cost) : "",
  }));
}

function buildPricingAddonsPayload(
  rows: AddonFormRow[],
): { ok: true; addons: ServicePricingAddon[] } | { ok: false; message: string } {
  const seen = new Set<string>();
  const out: ServicePricingAddon[] = [];
  let ord = 0;
  for (const r of rows) {
    const label = r.label.trim();
    if (!label) continue;
    let id = r.id.trim() || addonIdFromLabel(label, ord);
    if (seen.has(id)) id = `${id}_${ord}`;
    seen.add(id);
    if (r.fixed_price.trim() === "") {
      return { ok: false, message: `Each additional needs a client price ("${label || "unnamed"}").` };
    }
    const fixed_price = Number(r.fixed_price);
    if (!Number.isFinite(fixed_price) || fixed_price < 0) {
      return { ok: false, message: `Invalid client price in additional "${label}".` };
    }
    const addon: ServicePricingAddon = { id, label, sort_order: ord * 10, fixed_price };
    ord += 1;
    if (r.partner_cost.trim() !== "") {
      const n = Number(r.partner_cost);
      if (!Number.isFinite(n)) return { ok: false, message: `Invalid partner cost in additional "${label}".` };
      addon.partner_cost = n;
    }
    out.push(addon);
  }
  return { ok: true, addons: out };
}

function pricingStructureFromRow(row: CatalogService): CatalogPricingStructure {
  const presets = sortPricingPresetsDisplay(parsePricingPresets(row.pricing_presets));
  const hasAddons = catalogHasStackableAddons(row);
  if (presets.length === 0) return "single";
  if (!hasAddons) return "variable";
  const anyHourly = presets.some((p) => presetPricingMode(p) === "hourly");
  if (anyHourly) return "variable";
  return "base_plus_addons";
}

/** Stable preset id for storage — generated from label when not shown in UI. */
function presetIdFromLabel(label: string, ord: number): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (base || `preset_${ord}`).slice(0, 48);
}

function newPresetFormRow(): PresetFormRow {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return { id, label: "", pricing_mode: "fixed", sell_price: "", default_hours: "2", partner_cost: "" };
}

function catalogPartnerCostFormValue(
  mode: CatalogPricingMode,
  partnerCost: number | null | undefined,
  defaultHours: number | null | undefined,
): string {
  if (partnerCost == null) return "";
  if (mode === "hourly") {
    const rate = partnerHourlyRateFromCatalogBundle(partnerCost, defaultHours);
    return rate > 0 ? String(rate) : "";
  }
  return String(partnerCost);
}

function presetRowsFromCatalogRow(row: CatalogService): PresetFormRow[] {
  return sortPricingPresetsDisplay(parsePricingPresets(row.pricing_presets)).map((p) => {
    const mode = presetPricingMode(p);
    return {
      id: p.id,
      label: p.label,
      pricing_mode: mode,
      sell_price: String(mode === "fixed" ? (p.fixed_price ?? "") : (p.hourly_rate ?? "")),
      default_hours: p.default_hours != null ? String(p.default_hours) : String(DEFAULT_HOURLY_BILLED_HOURS),
      partner_cost: catalogPartnerCostFormValue(mode, p.partner_cost, p.default_hours),
    };
  });
}

function presetSellerTotal(row: PresetFormRow): number {
  const sell = Number(row.sell_price) || 0;
  if (row.pricing_mode === "fixed") return sell;
  const hours = Math.max(0.25, Number(row.default_hours) || 1);
  return sell * hours;
}

function buildPricingPresetsPayload(
  rows: PresetFormRow[],
): { ok: true; presets: ServicePricingPreset[] } | { ok: false; message: string } {
  const seen = new Set<string>();
  const out: ServicePricingPreset[] = [];
  let ord = 0;
  for (const r of rows) {
    const label = r.label.trim();
    if (!label) continue;
    let id = r.id.trim() || presetIdFromLabel(label, ord);
    if (seen.has(id)) {
      id = `${id}_${ord}`;
    }
    seen.add(id);
    if (r.sell_price.trim() === "") {
      return { ok: false, message: `Each row needs a client price ("${label || "unnamed"}").` };
    }
    const sell = Number(r.sell_price);
    if (!Number.isFinite(sell) || sell < 0) {
      return { ok: false, message: `Invalid sell price in preset "${label}".` };
    }

    const preset: ServicePricingPreset = {
      id,
      label,
      sort_order: ord * 10,
      pricing_mode: r.pricing_mode,
    };
    ord += 1;

    if (r.pricing_mode === "fixed") {
      preset.fixed_price = sell;
    } else {
      preset.hourly_rate = sell;
      const hours = Number(r.default_hours);
      if (!Number.isFinite(hours) || hours < 0.25) {
        return { ok: false, message: `Invalid hours in preset "${label}".` };
      }
      preset.default_hours = hours;
    }
    if (r.partner_cost.trim() !== "") {
      const n = Number(r.partner_cost);
      if (!Number.isFinite(n)) return { ok: false, message: `Invalid partner cost in preset "${label}".` };
      preset.partner_cost =
        r.pricing_mode === "hourly"
          ? catalogPartnerBundleFromHourlyRate(n, Number(r.default_hours) || DEFAULT_HOURLY_BILLED_HOURS)
          : n;
    }
    out.push(preset);
  }
  return { ok: true, presets: out };
}

export function ServiceCatalogTab() {
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
  } = useSupabaseList<CatalogService>({ fetcher: listCatalogServices, realtimeTable: "service_catalog", pageSize: 100 });

  const [counts, setCounts] = useState({ all: 0, active: 0, inactive: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<CatalogService | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [presetRows, setPresetRows] = useState<PresetFormRow[]>([]);
  const [addonRows, setAddonRows] = useState<AddonFormRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  /** When false, updating the service name also refreshes the suggested icon slug (until user picks Automatic or a manual icon). */
  const [catalogIconLocked, setCatalogIconLocked] = useState(false);
  const [catalogView, setCatalogView] = useState<"manage" | "overview">("manage");

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

  const statusTabs = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "inactive", label: "Inactive", count: counts.inactive },
  ];

  const viewTabs = [
    { id: "manage", label: "Manage" },
    { id: "overview", label: "Overview" },
  ];

  const openCreate = () => {
    setCatalogIconLocked(false);
    setForm({
      ...emptyForm,
      display_icon_key: suggestSlugFromServiceName(""),
    });
    setPresetRows([]);
    setAddonRows([]);
    setCreateOpen(true);
  };

  const openEdit = (row: CatalogService) => {
    const rawKey = row.display_icon_key?.trim();
    const explicit = rawKey && rawKey.length > 0;
    setCatalogIconLocked(Boolean(explicit));
    setEditRow(row);
    setPresetRows(presetRowsFromCatalogRow(row));
    setAddonRows(addonRowsFromCatalogRow(row));
    setForm({
      name: row.name,
      pricing_structure: pricingStructureFromRow(row),
      pricing_mode: row.pricing_mode,
      fixed_price: String(row.fixed_price ?? 0),
      hourly_rate: String(row.hourly_rate ?? 0),
      default_hours: String(row.default_hours ?? DEFAULT_HOURLY_BILLED_HOURS),
      partner_cost: catalogPartnerCostFormValue(row.pricing_mode, row.partner_cost, row.default_hours),
      default_description: row.default_description ?? "",
      partner_email_notes_hourly: row.partner_email_notes_hourly ?? "",
      partner_email_notes_fixed: row.partner_email_notes_fixed ?? "",
      partner_email_notes_default: row.partner_email_notes_default ?? "",
      sort_order: String(row.sort_order ?? 0),
      is_active: row.is_active,
      display_icon_key: explicit ? rawKey : "",
      accepts_smart_price: row.accepts_smart_price ?? false,
    });
  };

  const openDuplicate = (row: CatalogService) => {
    setEditRow(null);
    const rawKey = row.display_icon_key?.trim();
    const explicit = rawKey && rawKey.length > 0;
    setCatalogIconLocked(Boolean(explicit));
    setPresetRows(
      presetRowsFromCatalogRow(row).map((r) => ({
        ...r,
        id: newPresetFormRow().id,
      })),
    );
    setAddonRows(addonRowsFromCatalogRow(row).map((r) => duplicateAddonFormRow(r)));
    setForm({
      name: `${row.name.trim()} (copy)`,
      pricing_structure: pricingStructureFromRow(row),
      pricing_mode: row.pricing_mode,
      fixed_price: String(row.fixed_price ?? 0),
      hourly_rate: String(row.hourly_rate ?? 0),
      default_hours: String(row.default_hours ?? DEFAULT_HOURLY_BILLED_HOURS),
      partner_cost: catalogPartnerCostFormValue(row.pricing_mode, row.partner_cost, row.default_hours),
      default_description: row.default_description ?? "",
      partner_email_notes_hourly: row.partner_email_notes_hourly ?? "",
      partner_email_notes_fixed: row.partner_email_notes_fixed ?? "",
      partner_email_notes_default: row.partner_email_notes_default ?? "",
      sort_order: String(row.sort_order ?? 0),
      is_active: row.is_active,
      display_icon_key: explicit ? rawKey : "",
      accepts_smart_price: row.accepts_smart_price ?? false,
    });
    setCreateOpen(true);
  };

  const parsePayload = (presets: ServicePricingPreset[]) => {
    if ((form.pricing_structure === "variable" || form.pricing_structure === "base_plus_addons") && presets.length > 0) {
      const first = presets[0];
      const mode = presetPricingMode(first);
      return {
        name: form.name.trim(),
        pricing_mode: mode,
        fixed_price: mode === "fixed" ? Number(first.fixed_price) || 0 : 0,
        hourly_rate: mode === "hourly" ? Number(first.hourly_rate) || 0 : 0,
        default_hours:
          mode === "hourly"
            ? Math.max(0.25, Number(first.default_hours) || DEFAULT_HOURLY_BILLED_HOURS)
            : Math.max(0.25, Number(form.default_hours) || DEFAULT_HOURLY_BILLED_HOURS),
        partner_cost: Math.max(0, Number(first.partner_cost) || 0),
        default_description: form.default_description.trim() || null,
        partner_email_notes_hourly: form.partner_email_notes_hourly.trim() || null,
        partner_email_notes_fixed: form.partner_email_notes_fixed.trim() || null,
        partner_email_notes_default: form.partner_email_notes_default.trim() || null,
        sort_order: Math.floor(Number(form.sort_order) || 0),
        is_active: form.is_active,
        display_icon_key: form.display_icon_key.trim() === "" ? null : form.display_icon_key.trim(),
        accepts_smart_price: form.accepts_smart_price,
      };
    }
    return {
      name: form.name.trim(),
      pricing_mode: form.pricing_mode,
      fixed_price: Number(form.fixed_price) || 0,
      hourly_rate: Number(form.hourly_rate) || 0,
      default_hours: Math.max(0.25, Number(form.default_hours) || DEFAULT_HOURLY_BILLED_HOURS),
      partner_cost:
        form.pricing_mode === "hourly"
          ? catalogPartnerBundleFromHourlyRate(
              Number(form.partner_cost) || 0,
              Number(form.default_hours) || DEFAULT_HOURLY_BILLED_HOURS,
            )
          : Math.max(0, Number(form.partner_cost) || 0),
      default_description: form.default_description.trim() || null,
      partner_email_notes_hourly: form.partner_email_notes_hourly.trim() || null,
      partner_email_notes_fixed: form.partner_email_notes_fixed.trim() || null,
      partner_email_notes_default: form.partner_email_notes_default.trim() || null,
      sort_order: Math.floor(Number(form.sort_order) || 0),
      is_active: form.is_active,
      display_icon_key: form.display_icon_key.trim() === "" ? null : form.display_icon_key.trim(),
      accepts_smart_price: form.accepts_smart_price,
    };
  };

  const buildPresetsForSave = (): { ok: true; presets: ServicePricingPreset[] } | { ok: false; message: string } => {
    if (form.pricing_structure === "single") {
      return { ok: true, presets: [] };
    }
    if (presetRows.length === 0) {
      return {
        ok: false,
        message:
          form.pricing_structure === "base_plus_addons"
            ? "Add at least one base option (e.g. 1 bed 1 bath)."
            : "Add at least one pricing band for variable pricing.",
      };
    }
    return buildPricingPresetsPayload(presetRows);
  };

  const buildAddonsForSave = (): { ok: true; addons: ServicePricingAddon[] } | { ok: false; message: string } => {
    if (form.pricing_structure === "single") {
      return { ok: true, addons: [] };
    }
    return buildPricingAddonsPayload(addonRows);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const presetBuild = buildPresetsForSave();
    if (!presetBuild.ok) {
      toast.error(presetBuild.message);
      return;
    }
    const addonBuild = buildAddonsForSave();
    if (!addonBuild.ok) {
      toast.error(addonBuild.message);
      return;
    }
    setSubmitting(true);
    try {
      await createCatalogService({
        ...parsePayload(presetBuild.presets),
        pricing_presets: presetBuild.presets,
        pricing_addons: addonBuild.addons,
      });
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
    const presetBuild = buildPresetsForSave();
    if (!presetBuild.ok) {
      toast.error(presetBuild.message);
      return;
    }
    const addonBuild = buildAddonsForSave();
    if (!addonBuild.ok) {
      toast.error(addonBuild.message);
      return;
    }
    setSubmitting(true);
    try {
      await updateCatalogService(editRow.id, {
        ...parsePayload(presetBuild.presets),
        pricing_presets: presetBuild.presets,
        pricing_addons: addonBuild.addons,
      });
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
      minWidth: "280px",
      cellClassName: "align-top py-3",
      render: (item) => {
        const slug =
          item.display_icon_key?.trim() ?
            item.display_icon_key.trim()
          : suggestSlugFromServiceName(item.name);
        const TI = entryForSlug(slug).Icon;
        return (
          <div className="flex items-start gap-3 min-w-0 max-w-xl">
            <span className={cn(SERVICE_ICON_CELL_CLASSES, "shrink-0 mt-0.5")}>
              <TI className={SERVICE_ICON_INNER_CLASSES} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary leading-snug">{item.name}</p>
              {item.default_description && (
                <p className="text-[11px] text-text-tertiary line-clamp-2 mt-1 leading-relaxed">{item.default_description}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "pricing_mode",
      label: "Pricing",
      minWidth: "11.5rem",
      width: "18%",
      cellClassName: "align-top py-3",
      render: (item) => {
        const stackable = catalogHasStackableAddons(item);
        const variable = catalogHasVariablePricing(item);
        const presets = sortPricingPresetsDisplay(parsePricingPresets(item.pricing_presets));
        const addons = sortPricingAddonsDisplay(parsePricingAddons(item.pricing_addons));
        return (
          <div className="text-xs text-text-secondary space-y-1 max-w-[14rem]">
            <Badge variant="outline" size="sm" className="whitespace-nowrap">
              {stackable ? "Base + add-ons" : variable ? "Variable" : pricingModeLabel(item.pricing_mode)}
            </Badge>
            <p className="leading-snug tabular-nums">
              {stackable
                ? `${presets.length} base${presets.length === 1 ? "" : "s"} · ${addons.length} add-on${addons.length === 1 ? "" : "s"}`
                : variable
                  ? `${presets.length} band${presets.length === 1 ? "" : "s"}`
                  : item.pricing_mode === "fixed"
                    ? formatCurrency(item.fixed_price)
                    : `${formatCurrency(item.hourly_rate)}/h · default ${item.default_hours ?? 1}h`}
            </p>
          </div>
        );
      },
    },
    {
      key: "margin",
      label: "Margin",
      minWidth: "7.5rem",
      width: "11%",
      align: "right",
      headerClassName: "text-right",
      cellClassName: "align-top py-3 text-right",
      render: (item) => {
        const sell = estimatedValueFromCatalog(item);
        const pc = Number(item.partner_cost) || 0;
        const m = sell - pc;
        const pct = sell > 0 ? (m / sell) * 100 : 0;
        return (
          <div className="text-xs inline-block text-right tabular-nums">
            <p className={`font-semibold ${m >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}`}>{formatCurrency(m)}</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">{pct.toFixed(0)}% of sell</p>
          </div>
        );
      },
    },
    {
      key: "sort_order",
      label: "Order",
      minWidth: "4rem",
      width: "5rem",
      align: "center",
      headerClassName: "text-center",
      cellClassName: "align-top py-3 text-center",
      render: (item) => <span className="text-sm tabular-nums text-text-secondary font-medium">{item.sort_order}</span>,
    },
    {
      key: "is_active",
      label: "Status",
      minWidth: "6.75rem",
      width: "8rem",
      align: "center",
      headerClassName: "text-center",
      cellClassName: "align-top py-3 text-center",
      render: (item) => (
        <Badge variant={item.is_active ? "success" : "default"} size="sm">
          {item.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      width: "7.5rem",
      minWidth: "7.5rem",
      align: "right",
      headerClassName: "text-right",
      cellClassName: "align-top py-3",
      render: (item) => (
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(item)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openDuplicate(item)} aria-label="Duplicate">
            <Copy className="h-3.5 w-3.5" />
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
          const h = Math.max(0.25, Number(form.default_hours) || DEFAULT_HOURLY_BILLED_HOURS);
          return (Number(form.hourly_rate) || 0) * h;
        })();
  const partnerCostNum = catalogPartnerTotalForDisplay({
    pricingMode: form.pricing_mode,
    partnerFieldValue: Number(form.partner_cost) || 0,
    defaultHours: Number(form.default_hours) || DEFAULT_HOURLY_BILLED_HOURS,
  });
  const marginValue = sellerTotal - partnerCostNum;
  const marginPercent = sellerTotal > 0 ? (marginValue / sellerTotal) * 100 : 0;
  const iconPreviewSlug =
    form.display_icon_key.trim() === "" ? suggestSlugFromServiceName(form.name) : form.display_icon_key;
  const IconPreviewComp = entryForSlug(iconPreviewSlug).Icon;

  const additionalsFields = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-text-primary">Additionals</p>
          <FixfyHintIcon text="Optional extras stacked on the selected band (e.g. oven, windows). Operators tick these on the job — prices add automatically." />
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setAddonRows((r) => [...r, newAddonFormRow()])}>
          Add additional
        </Button>
      </div>
      {addonRows.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] text-text-tertiary italic">No additionals yet.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAddonRows((r) => [...r, newAddonFormRow()])}
          >
            Add line
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {addonRows.map((arow, idx) => (
            <div key={`${arow.id}-${idx}`} className="rounded-lg border border-border-light bg-card p-2">
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] gap-2 items-end">
                <div>
                  <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Label *</label>
                  <Input
                    value={arow.label}
                    onChange={(e) =>
                      setAddonRows((rows) => rows.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Oven deep clean"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Client £ *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={arow.fixed_price}
                    onChange={(e) =>
                      setAddonRows((rows) => rows.map((x, i) => (i === idx ? { ...x, fixed_price: e.target.value } : x)))
                    }
                    className="h-8 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Partner £</label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={arow.partner_cost}
                    onChange={(e) =>
                      setAddonRows((rows) => rows.map((x, i) => (i === idx ? { ...x, partner_cost: e.target.value } : x)))
                    }
                    className="h-8 text-xs tabular-nums"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-red-600 shrink-0"
                  onClick={() => setAddonRows((rows) => rows.filter((_, i) => i !== idx))}
                  aria-label="Remove additional"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={() =>
                setAddonRows((rows) => {
                  const last = rows[rows.length - 1];
                  return last ? [...rows, duplicateAddonFormRow(last)] : rows;
                })
              }
            >
              Duplicate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setAddonRows((r) => [...r, newAddonFormRow()])}
            >
              Add line
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const FormFields = (
    <>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Name *</label>
        <Input
          value={form.name}
          onChange={(e) => {
            const name = e.target.value;
            setForm((f) => {
              let dk = f.display_icon_key;
              if (!catalogIconLocked && dk !== "") {
                dk = suggestSlugFromServiceName(name);
              }
              return { ...f, name, display_icon_key: dk };
            });
          }}
          placeholder="e.g. Boiler service"
        />
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <Select
            label="Display Icon"
            value={form.display_icon_key}
            onChange={(e) => {
              setCatalogIconLocked(true);
              setForm((f) => ({ ...f, display_icon_key: e.target.value }));
            }}
            options={serviceDisplayIconSelectOptions()}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-text-tertiary">Preview</span>
            <span className={SERVICE_ICON_CELL_CLASSES}>
              <IconPreviewComp className={SERVICE_ICON_INNER_CLASSES} aria-hidden />
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setCatalogIconLocked(false);
                setForm((f) => ({
                  ...f,
                  display_icon_key: suggestSlugFromServiceName(f.name.trim()),
                }));
              }}
            >
              Align to name
            </Button>
          </div>
        </div>
      </div>
      <Select
        label="Pricing"
        value={form.pricing_structure}
        onChange={(e) => {
          const pricing_structure = e.target.value as CatalogPricingStructure;
          setForm((f) => ({ ...f, pricing_structure }));
          if (pricing_structure === "variable" || pricing_structure === "base_plus_addons") {
            setPresetRows((rows) => {
              const next = rows.length > 0 ? rows : [newPresetFormRow()];
              return pricing_structure === "base_plus_addons"
                ? next.map((r) => ({ ...r, pricing_mode: "fixed" as CatalogPricingMode }))
                : next;
            });
          } else {
            setPresetRows([]);
            setAddonRows([]);
          }
        }}
        options={[
          { value: "single", label: catalogPricingStructureLabel("single") },
          { value: "variable", label: catalogPricingStructureLabel("variable") },
          { value: "base_plus_addons", label: catalogPricingStructureLabel("base_plus_addons") },
        ]}
      />

      {form.pricing_structure === "single" ? (
        <>
          <Select
            label="Charge Type"
            value={form.pricing_mode}
            onChange={(e) => setForm((f) => ({ ...f, pricing_mode: e.target.value as CatalogPricingMode }))}
            options={[
              { value: "fixed", label: pricingModeLabel("fixed") },
              { value: "hourly", label: pricingModeLabel("hourly") },
            ]}
          />
          {form.pricing_mode === "hourly" ? (
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={form.accepts_smart_price}
                onChange={(e) => setForm((f) => ({ ...f, accepts_smart_price: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-border-light"
              />
              Accept Smart Price bookings (hourly)
            </label>
          ) : null}
          {form.pricing_mode === "fixed" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Seller Price *</label>
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
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner Cost</label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={form.partner_cost}
              onChange={(e) => setForm((f) => ({ ...f, partner_cost: e.target.value }))}
              placeholder="0"
            />
            <p className="text-[10px] text-text-tertiary mt-1">What you pay the partner to deliver this job.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Seller Hourly Rate *</label>
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
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Default Hours *</label>
              <Input
                type="number"
                step="0.25"
                min={0.25}
                value={form.default_hours}
                onChange={(e) => setForm((f) => ({ ...f, default_hours: e.target.value }))}
                placeholder="1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner hourly rate</label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={form.partner_cost}
                onChange={(e) => setForm((f) => ({ ...f, partner_cost: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary -mt-1">
            Seller and partner totals = hourly rate × default hours (used for margin and quote defaults).
          </p>
        </>
          )}
          <div className="rounded-xl border border-border bg-surface-secondary/40 p-3 sm:p-4">
            <p className="text-sm font-semibold text-text-primary mb-3">Margin (Profit)</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-card px-3 py-2.5 sm:flex-col sm:items-stretch sm:justify-start sm:border-0 sm:bg-transparent sm:p-0">
            <span className="text-xs text-text-secondary shrink-0">Seller Total</span>
            <p className="text-base font-semibold text-text-primary tabular-nums sm:mt-1">{formatCurrency(sellerTotal)}</p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-card px-3 py-2.5 sm:flex-col sm:items-stretch sm:justify-start sm:border-0 sm:bg-transparent sm:p-0">
            <span className="text-xs text-text-secondary shrink-0">Partner Cost</span>
            <p className="text-base font-semibold text-text-primary tabular-nums sm:mt-1">{formatCurrency(partnerCostNum)}</p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-card px-3 py-2.5 sm:flex-col sm:items-stretch sm:justify-start sm:border-0 sm:bg-transparent sm:p-0">
            <span className="text-xs text-text-secondary shrink-0">Margin</span>
            <p
              className={`text-base font-bold tabular-nums sm:mt-1 ${marginValue >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
            >
              {formatCurrency(marginValue)}
            </p>
          </div>
        </div>
            <p className="text-[11px] text-text-secondary mt-3 pt-3 border-t border-border-light">
              {sellerTotal > 0 ? `${marginPercent.toFixed(1)}% margin on seller price` : "Add seller pricing to see margin."}
            </p>
          </div>
        </>
      ) : form.pricing_structure === "base_plus_addons" ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-hover/40 p-3 space-y-4">
          <div>
            <p className="text-sm font-semibold text-text-primary">Base + additionals pricing</p>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Base = property size (one per job). Additionals stack on top — optional extras like oven or windows.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm font-medium text-text-primary">Base</p>
                <FixfyHintIcon text="Property size or package — operator picks one on the job (e.g. Studio flat, 1 bed 1 bath)." />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => setPresetRows((r) => [...r, { ...newPresetFormRow(), pricing_mode: "fixed" }])}
              >
                Add base
              </Button>
            </div>
            {presetRows.length === 0 ? (
              <p className="text-[11px] text-text-tertiary italic">Add at least one base (e.g. Studio flat).</p>
            ) : (
              <div className="space-y-1.5">
                {presetRows.map((prow, idx) => {
                  const bandSeller = Math.max(0, Number(prow.sell_price) || 0);
                  const bandPartner = Math.max(0, Number(prow.partner_cost) || 0);
                  const bandMargin = bandSeller - bandPartner;
                  const bandMarginPct = bandSeller > 0 ? (bandMargin / bandSeller) * 100 : 0;
                  return (
                    <div key={`${prow.id}-${idx}`} className="rounded-lg border border-border-light bg-card p-2 space-y-1">
                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] gap-2 items-end">
                        <div>
                          <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Label *</label>
                          <Input
                            value={prow.label}
                            onChange={(e) =>
                              setPresetRows((rows) =>
                                rows.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                              )
                            }
                            placeholder="Studio flat"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Client £ *</label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={prow.sell_price}
                            onChange={(e) =>
                              setPresetRows((rows) =>
                                rows.map((x, i) => (i === idx ? { ...x, sell_price: e.target.value } : x)),
                              )
                            }
                            placeholder="0"
                            className="h-8 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Partner £</label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={prow.partner_cost}
                            onChange={(e) =>
                              setPresetRows((rows) =>
                                rows.map((x, i) => (i === idx ? { ...x, partner_cost: e.target.value } : x)),
                              )
                            }
                            placeholder="0"
                            className="h-8 text-xs tabular-nums"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-600 shrink-0"
                          onClick={() => setPresetRows((rows) => rows.filter((_, i) => i !== idx))}
                          aria-label="Remove base"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p
                        className={cn(
                          "text-[10px] tabular-nums pl-0.5",
                          bandMargin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                        )}
                      >
                        Margin {formatCurrency(bandMargin)}
                        {bandSeller > 0 ? ` (${bandMarginPct.toFixed(1)}%)` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border-light" role="separator" />

          {additionalsFields}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-surface-hover/40 p-3 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-semibold text-text-primary">Pricing Bands</p>
              <FixfyHintIcon text="Each band is a price option (e.g. Studio flat, 1–2 rooms). Pick fixed or hourly per band, then set sell price and partner cost." />
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setPresetRows((r) => [...r, newPresetFormRow()])}>
              Add Band
            </Button>
          </div>
          {presetRows.length === 0 ? (
            <p className="text-[11px] text-text-tertiary italic">Add at least one band.</p>
          ) : (
            <div className="max-h-[min(52vh,28rem)] overflow-y-auto space-y-1.5 pr-0.5 -mr-0.5">
              {presetRows.map((prow, idx) => {
                const bandSeller = presetSellerTotal(prow);
                const bandPartner = catalogPartnerTotalForDisplay({
                  pricingMode: prow.pricing_mode,
                  partnerFieldValue: Number(prow.partner_cost) || 0,
                  defaultHours: Number(prow.default_hours) || DEFAULT_HOURLY_BILLED_HOURS,
                });
                const bandMargin = bandSeller - bandPartner;
                const bandMarginPct = bandSeller > 0 ? (bandMargin / bandSeller) * 100 : 0;
                const isHourly = prow.pricing_mode === "hourly";
                return (
                  <div key={`${prow.id}-${idx}`} className="rounded-lg border border-border-light bg-card p-2">
                    <div className="flex gap-1.5 items-start">
                      <div className="flex shrink-0 flex-col gap-0 pt-5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={idx === 0}
                          onClick={() =>
                            setPresetRows((rows) => {
                              const next = [...rows];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              return next;
                            })
                          }
                          aria-label="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={idx === presetRows.length - 1}
                          onClick={() =>
                            setPresetRows((rows) => {
                              const next = [...rows];
                              [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                              return next;
                            })
                          }
                          aria-label="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div>
                          <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Label *</label>
                          <Input
                            value={prow.label}
                            onChange={(e) =>
                              setPresetRows((rows) =>
                                rows.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                              )
                            }
                            placeholder="Studio flat"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div
                          className={cn(
                            "grid gap-1.5",
                            isHourly ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
                          )}
                        >
                          <div className="min-w-0">
                            <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Type</label>
                            <select
                              value={prow.pricing_mode}
                              onChange={(e) =>
                                setPresetRows((rows) =>
                                  rows.map((x, i) =>
                                    i === idx ? { ...x, pricing_mode: e.target.value as CatalogPricingMode } : x,
                                  ),
                                )
                              }
                              className="h-8 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-xs text-text-primary appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/15"
                            >
                              <option value="fixed">Fixed</option>
                              <option value="hourly">Hourly</option>
                            </select>
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[10px] font-medium text-text-secondary mb-0.5 truncate">
                              {isHourly ? "Rate *" : "Sell *"}
                            </label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={prow.sell_price}
                              onChange={(e) =>
                                setPresetRows((rows) =>
                                  rows.map((x, i) => (i === idx ? { ...x, sell_price: e.target.value } : x)),
                                )
                              }
                              placeholder="0"
                              className="h-8 text-xs tabular-nums"
                            />
                          </div>
                          {isHourly && (
                            <div className="min-w-0">
                              <label className="block text-[10px] font-medium text-text-secondary mb-0.5">Hrs *</label>
                              <Input
                                type="number"
                                step="0.25"
                                min={0.25}
                                value={prow.default_hours}
                                onChange={(e) =>
                                  setPresetRows((rows) =>
                                    rows.map((x, i) => (i === idx ? { ...x, default_hours: e.target.value } : x)),
                                  )
                                }
                                placeholder="1"
                                className="h-8 text-xs tabular-nums"
                              />
                            </div>
                          )}
                          <div className="min-w-0">
                            <label className="block text-[10px] font-medium text-text-secondary mb-0.5 truncate">Partner</label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={prow.partner_cost}
                              onChange={(e) =>
                                setPresetRows((rows) =>
                                  rows.map((x, i) => (i === idx ? { ...x, partner_cost: e.target.value } : x)),
                                )
                              }
                              placeholder="0"
                              className="h-8 text-xs tabular-nums"
                            />
                          </div>
                        </div>
                        <p
                          className={cn(
                            "text-[10px] tabular-nums",
                            bandMargin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                          )}
                        >
                          Margin {formatCurrency(bandMargin)}
                          {bandSeller > 0 ? ` (${bandMarginPct.toFixed(1)}%)` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 pt-5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-600"
                          onClick={() => setPresetRows((rows) => rows.filter((_, i) => i !== idx))}
                          aria-label="Remove band"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t border-border-light" role="separator" />
          {additionalsFields}
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">Default Description (Optional)</label>
        <textarea
          value={form.default_description}
          onChange={(e) => setForm((f) => ({ ...f, default_description: e.target.value }))}
          rows={3}
          placeholder="Prefills request/quote text; staff can always edit."
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
        />
      </div>
      <div className="space-y-3 rounded-xl border border-border-light bg-muted/30 p-4">
        <div>
          <p className="text-xs font-semibold text-text-primary">Partner job email notes</p>
          <p className="mt-1 text-[11px] text-text-tertiary leading-relaxed">
            Shown in job offer and booked emails. Leave hourly/fixed blank to use the OS default. Type-of-work note is appended after the hourly/fixed rule.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Hourly override (optional)</label>
          <textarea
            value={form.partner_email_notes_hourly}
            onChange={(e) => setForm((f) => ({ ...f, partner_email_notes_hourly: e.target.value }))}
            rows={3}
            placeholder="Blank = global hourly default (3 hours max, call office…)"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Fixed override (optional)</label>
          <textarea
            value={form.partner_email_notes_fixed}
            onChange={(e) => setForm((f) => ({ ...f, partner_email_notes_fixed: e.target.value }))}
            rows={3}
            placeholder="Blank = global fixed default (VAT included, max cost…)"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Type-of-work note (optional)</label>
          <textarea
            value={form.partner_email_notes_default}
            onChange={(e) => setForm((f) => ({ ...f, partner_email_notes_default: e.target.value }))}
            rows={3}
            placeholder="Extra rules for this trade only (e.g. Gardener bag rate)"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Sort Order</label>
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Services</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Master list of types of work and default sell / partner pay.
          </p>
        </div>
        {catalogView === "manage" ? (
          <Button size="sm" className="shrink-0" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
            New service
          </Button>
        ) : null}
      </div>

      <Tabs tabs={viewTabs} activeTab={catalogView} onChange={(id) => setCatalogView(id as "manage" | "overview")} />

      {catalogView === "overview" ? (
        <ServiceCatalogOverview />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <Tabs tabs={statusTabs} activeTab={status} onChange={setStatus} />
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
            tableClassName="table-fixed w-full min-w-[960px]"
          />
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Catalog Service" subtitle="Defaults only — each request/quote can override.">
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

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Service" subtitle={editRow?.name}>
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
    </div>
  );
}
