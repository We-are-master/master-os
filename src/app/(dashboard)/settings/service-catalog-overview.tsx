"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
import type { CatalogService, ServicePricingPreset } from "@/types/database";
import { listCatalogServices } from "@/services/catalog-services";
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
import {
  entryForSlug,
  suggestSlugFromServiceName,
  SERVICE_ICON_CELL_CLASSES,
  SERVICE_ICON_INNER_CLASSES,
} from "@/lib/service-display-icons";
import { Loader2 } from "lucide-react";

function presetSellTotal(p: ServicePricingPreset): number {
  const mode = presetPricingMode(p);
  if (mode === "fixed") return Number(p.fixed_price) || 0;
  const hours = Math.max(0.25, Number(p.default_hours) || 1);
  return (Number(p.hourly_rate) || 0) * hours;
}

function MarginCell({ sell, partner }: { sell: number; partner: number }) {
  const m = sell - partner;
  const pct = sell > 0 ? (m / sell) * 100 : 0;
  return (
    <div className="text-right tabular-nums">
      <p
        className={cn(
          "text-sm font-semibold",
          m >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
        )}
      >
        {formatCurrency(m)}
      </p>
      <p className="text-[10px] text-text-tertiary">{sell > 0 ? `${pct.toFixed(1)}% margin` : "—"}</p>
    </div>
  );
}

function PriceRow({
  label,
  chargeType,
  sellPrimary,
  sellDetail,
  partner,
  sellTotal,
}: {
  label: string;
  chargeType: string;
  sellPrimary: string;
  sellDetail?: string;
  partner: number;
  sellTotal: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-y-1 py-2.5 border-b border-border-light/80 last:border-0 @sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem] @sm:gap-x-3 @sm:items-center text-xs">
      <div className="min-w-0">
        <p className="font-medium text-text-primary leading-snug">{label}</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">{chargeType}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">Sell</p>
        <p className="font-medium text-text-primary tabular-nums">{sellPrimary}</p>
        {sellDetail ? <p className="text-[10px] text-text-tertiary mt-0.5">{sellDetail}</p> : null}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">Partner</p>
        <p className="font-medium text-text-primary tabular-nums">{formatCurrency(partner)}</p>
      </div>
      <MarginCell sell={sellTotal} partner={partner} />
    </div>
  );
}

function ServiceOverviewCard({ service }: { service: CatalogService }) {
  const slug = service.display_icon_key?.trim() || suggestSlugFromServiceName(service.name);
  const Icon = entryForSlug(slug).Icon;
  const presets = sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets));
  const addons = sortPricingAddonsDisplay(parsePricingAddons(service.pricing_addons));
  const stackable = catalogHasStackableAddons(service);
  const variable = presets.length > 0 && !stackable;
  const partnerBase = Number(service.partner_cost) || 0;

  return (
    <article className="rounded-xl border border-border-light bg-card overflow-hidden">
      <header className="flex items-start gap-3 px-4 py-3 bg-surface-hover/30 border-b border-border-light">
        <span className={cn(SERVICE_ICON_CELL_CLASSES, "shrink-0")}>
          <Icon className={SERVICE_ICON_INNER_CLASSES} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{service.name}</h3>
            <Badge variant={service.is_active ? "success" : "default"} size="sm">
              {service.is_active ? "Active" : "Inactive"}
            </Badge>
            <Badge variant="outline" size="sm">
              {stackable ? "Base + add-ons" : variable ? "Variable" : "Single value"}
            </Badge>
          </div>
          {service.default_description ? (
            <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">{service.default_description}</p>
          ) : null}
        </div>
      </header>

      <div className="px-4 py-1">
        {stackable || variable ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary py-2">
              {stackable ? `Base options (${presets.length})` : `Pricing bands (${presets.length})`}
            </p>
            {presets.map((p) => {
              const mode = presetPricingMode(p);
              const sellTotal = presetSellTotal(p);
              const partner = p.partner_cost != null ? Number(p.partner_cost) : partnerBase;
              const sellPrimary =
                mode === "fixed"
                  ? formatCurrency(p.fixed_price ?? 0)
                  : `${formatCurrency(p.hourly_rate ?? 0)}/h`;
              const sellDetail =
                mode === "hourly"
                  ? `${p.default_hours ?? 1}h billed · ${formatCurrency(sellTotal)} total`
                  : undefined;
              return (
                <PriceRow
                  key={p.id}
                  label={p.label}
                  chargeType={pricingModeLabel(mode)}
                  sellPrimary={sellPrimary}
                  sellDetail={sellDetail}
                  partner={partner}
                  sellTotal={sellTotal}
                />
              );
            })}
            {stackable && addons.length > 0 ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary py-2 mt-1 border-t border-border-light/80">
                  Additionals — stackable ({addons.length})
                </p>
                {addons.map((a) => {
                  const partner = a.partner_cost != null ? Number(a.partner_cost) : 0;
                  return (
                    <PriceRow
                      key={a.id}
                      label={a.label}
                      chargeType="Additional"
                      sellPrimary={formatCurrency(a.fixed_price)}
                      partner={partner}
                      sellTotal={Number(a.fixed_price) || 0}
                    />
                  );
                })}
              </>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary py-2">
              Default pricing
            </p>
            {service.pricing_mode === "fixed" ? (
              <PriceRow
                label="Standard"
                chargeType={pricingModeLabel("fixed")}
                sellPrimary={formatCurrency(service.fixed_price ?? 0)}
                partner={partnerBase}
                sellTotal={Number(service.fixed_price) || 0}
              />
            ) : (
              <PriceRow
                label="Standard"
                chargeType={pricingModeLabel("hourly")}
                sellPrimary={`${formatCurrency(service.hourly_rate ?? 0)}/h`}
                sellDetail={`Default ${service.default_hours ?? 1}h · ${formatCurrency(estimatedValueFromCatalog(service))} total`}
                partner={partnerBase}
                sellTotal={estimatedValueFromCatalog(service)}
              />
            )}
          </>
        )}
      </div>
    </article>
  );
}

export function ServiceCatalogOverview() {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listCatalogServices({
        page: 1,
        pageSize: 500,
        status: "all",
        sortBy: "sort_order",
        sortDir: "asc",
      });
      setServices(data);
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (statusFilter === "active" && !s.is_active) return false;
      if (statusFilter === "inactive" && s.is_active) return false;
      if (!q) return true;
      const desc = (s.default_description ?? "").toLowerCase();
      return s.name.toLowerCase().includes(q) || desc.includes(q);
    });
  }, [services, search, statusFilter]);

  const statusTabs = [
    { id: "active" as const, label: "Active", count: services.filter((s) => s.is_active).length },
    { id: "all" as const, label: "All", count: services.length },
    { id: "inactive" as const, label: "Inactive", count: services.filter((s) => !s.is_active).length },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Read-only view of sell prices, partner costs and pricing bands. Edit services in the Manage tab.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {statusTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatusFilter(t.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === t.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-light bg-card text-text-secondary hover:border-primary/30",
              )}
            >
              {t.label}
              <span className="ml-1 tabular-nums opacity-70">({t.count})</span>
            </button>
          ))}
        </div>
        <SearchInput
          placeholder="Search services…"
          className="w-full sm:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-12 text-center">No services match your filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {filtered.map((s) => (
            <ServiceOverviewCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}
