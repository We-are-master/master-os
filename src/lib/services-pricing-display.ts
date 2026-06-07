import type { CatalogService, ServicePricingAddon, ServicePricingPreset } from "@/types/database";
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
import { suggestSlugFromServiceName } from "@/lib/service-display-icons";

export type MarginTier = "good" | "thin" | "bad";

export type PricingLineRow = {
  id: string;
  label: string;
  sub: string;
  pay: number;
  charge: number;
  unit?: string;
  note?: string;
  tier: MarginTier;
  marginPct: number;
  isAddon?: boolean;
};

export type ServicePricingView = {
  id: string;
  service: CatalogService;
  slug: string;
  name: string;
  model: string;
  missing: boolean;
  isActive: boolean;
  stackable: boolean;
  variable: boolean;
  single?: PricingLineRow;
  base: PricingLineRow[];
  addons: PricingLineRow[];
  headline: { pay: number; charge: number; unit?: string } | null;
  subline: string;
  hasThinMargin: boolean;
};

export type ServicesPricingKpis = {
  activeCount: number;
  inactiveCount: number;
  totalCount: number;
  avgMarginPct: number;
  thinMarginLineCount: number;
  missingPriceCount: number;
  missingPriceNames: string[];
};

export type ServicesStatusFilter = "active" | "all" | "thin";

export function marginPct(pay: number, charge: number): number {
  return charge > 0 ? ((charge - pay) / charge) * 100 : 0;
}

export function marginTier(pct: number): MarginTier {
  if (pct >= 40) return "good";
  if (pct >= 30) return "thin";
  return "bad";
}

function presetSellTotal(p: ServicePricingPreset): number {
  const mode = presetPricingMode(p);
  if (mode === "fixed") return Number(p.fixed_price) || 0;
  const hours = Math.max(0.25, Number(p.default_hours) || 1);
  return (Number(p.hourly_rate) || 0) * hours;
}

function lineFromPreset(p: ServicePricingPreset, partnerBase: number, subPrefix: string): PricingLineRow {
  const mode = presetPricingMode(p);
  const charge = presetSellTotal(p);
  const pay = p.partner_cost != null ? Number(p.partner_cost) : partnerBase;
  const pct = marginPct(pay, charge);
  return {
    id: p.id,
    label: p.label,
    sub: `${subPrefix} · ${pricingModeLabel(mode)}`,
    pay,
    charge,
    unit: mode === "hourly" ? "/h" : undefined,
    note:
      mode === "hourly"
        ? `Default ${p.default_hours ?? 1}h · £${charge.toFixed(2)} total`
        : undefined,
    tier: marginTier(pct),
    marginPct: pct,
  };
}

function lineFromAddon(a: ServicePricingAddon): PricingLineRow {
  const charge = Number(a.fixed_price) || 0;
  const pay = a.partner_cost != null ? Number(a.partner_cost) : 0;
  const pct = marginPct(pay, charge);
  return {
    id: a.id,
    label: a.label,
    sub: "Additional",
    pay,
    charge,
    tier: marginTier(pct),
    marginPct: pct,
    isAddon: true,
  };
}

function serviceHasAnyPrice(service: CatalogService): boolean {
  const presets = parsePricingPresets(service.pricing_presets);
  const addons = parsePricingAddons(service.pricing_addons);
  if (presets.length > 0) {
    return presets.some((p) => presetSellTotal(p) > 0);
  }
  if (addons.length > 0) {
    return addons.some((a) => Number(a.fixed_price) > 0);
  }
  return estimatedValueFromCatalog(service) > 0;
}

export function buildServicePricingView(service: CatalogService): ServicePricingView {
  const stackable = catalogHasStackableAddons(service);
  const presets = sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets));
  const addons = sortPricingAddonsDisplay(parsePricingAddons(service.pricing_addons));
  const variable = presets.length > 0 && !stackable;
  const partnerBase = Number(service.partner_cost) || 0;
  const missing = !serviceHasAnyPrice(service);

  let model: string;
  if (missing) model = "Custom price";
  else if (stackable) model = "Base + add-ons";
  else if (variable) model = "Variable";
  else if (service.pricing_mode === "hourly") model = "Single value · hourly";
  else model = "Single value · fixed";

  const base = stackable || variable
    ? presets.map((p) =>
        lineFromPreset(p, partnerBase, stackable ? "Base · per job" : pricingModeLabel(presetPricingMode(p))),
      )
    : [];

  const addonRows = stackable ? addons.map(lineFromAddon) : [];

  let single: PricingLineRow | undefined;
  if (!stackable && !variable && !missing) {
    const charge = estimatedValueFromCatalog(service);
    const pay = partnerBase;
    const pct = marginPct(pay, charge);
    single = {
      id: "standard",
      label: "Standard",
      sub: `Smart pricing · ${pricingModeLabel(service.pricing_mode)}`,
      pay,
      charge,
      unit: service.pricing_mode === "hourly" ? "/h" : undefined,
      note:
        service.pricing_mode === "hourly"
          ? `Default ${service.default_hours ?? 1}h · £${charge.toFixed(2)} total`
          : undefined,
      tier: marginTier(pct),
      marginPct: pct,
    };
  }

  const headline = missing
    ? null
    : single
      ? { pay: single.pay, charge: single.charge, unit: single.unit }
      : base[0]
        ? { pay: base[0].pay, charge: base[0].charge, unit: base[0].unit }
        : null;

  const subline = missing
    ? "no price set"
    : single
      ? single.sub
      : stackable && addonRows.length > 0
        ? `Base price · ${addonRows.length} add-on${addonRows.length === 1 ? "" : "s"}`
        : variable
          ? `Pricing bands (${base.length})`
          : "Base price";

  const allLines = [
    ...(single ? [single] : base),
    ...addonRows,
  ];
  const hasThinMargin = allLines.some((l) => l.charge > 0 && l.tier !== "good");

  return {
    id: service.id,
    service,
    slug: service.display_icon_key?.trim() || suggestSlugFromServiceName(service.name),
    name: service.name,
    model,
    missing,
    isActive: service.is_active,
    stackable,
    variable,
    single,
    base,
    addons: addonRows,
    headline,
    subline,
    hasThinMargin,
  };
}

export function buildAllServicePricingViews(services: CatalogService[]): ServicePricingView[] {
  return services.map(buildServicePricingView);
}

export function computeServicesPricingKpis(views: ServicePricingView[]): ServicesPricingKpis {
  const active = views.filter((v) => v.isActive);
  const inactiveCount = views.length - active.length;

  const marginSamples: number[] = [];
  let thinMarginLineCount = 0;
  const missingViews = views.filter((v) => v.missing);

  for (const v of views) {
    const lines = [...(v.single ? [v.single] : v.base), ...v.addons];
    for (const line of lines) {
      if (line.charge <= 0) continue;
      marginSamples.push(line.marginPct);
      if (line.tier !== "good") thinMarginLineCount += 1;
    }
  }

  const avgMarginPct =
    marginSamples.length > 0
      ? marginSamples.reduce((a, b) => a + b, 0) / marginSamples.length
      : 0;

  return {
    activeCount: active.length,
    inactiveCount,
    totalCount: views.length,
    avgMarginPct,
    thinMarginLineCount,
    missingPriceCount: missingViews.length,
    missingPriceNames: missingViews.map((v) => v.name),
  };
}

export function filterServicePricingViews(
  views: ServicePricingView[],
  status: ServicesStatusFilter,
  search: string,
): ServicePricingView[] {
  const q = search.trim().toLowerCase();
  return views.filter((v) => {
    if (status === "active" && !v.isActive) return false;
    if (status === "thin" && !v.hasThinMargin && !v.missing) return false;
    if (!q) return true;
    const desc = (v.service.default_description ?? "").toLowerCase();
    return v.name.toLowerCase().includes(q) || desc.includes(q) || v.model.toLowerCase().includes(q);
  });
}

export function tierPctClass(tier: MarginTier): string {
  if (tier === "good") return "is-green";
  if (tier === "thin") return "is-coral";
  return "is-red";
}
