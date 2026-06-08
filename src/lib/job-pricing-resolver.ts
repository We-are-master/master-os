/**
 * Resolves the auto-fill prices for a NEW job given the
 * (account, partner, catalog service) triple. Migs 159 + 160.
 *
 * Pure function — no I/O. The caller fetches the catalog row and the
 * optional overrides, then passes them in. This keeps it cheap to test and
 * deterministic.
 *
 *   - Source order for client-side prices:
 *       account override (use_standard=false, field set) → catalog default
 *
 *   - Source order for partner-side prices:
 *       partner override (use_standard=false, field set) → catalog default
 *
 * `pricing_mode` is always sourced from the catalog (not overridable).
 *
 * Each resolved field reports whether it came from a custom override or the
 * catalog standard, so the UI can render Standard / Custom chips.
 */

import { resolveCatalogLinePricing } from "@/lib/catalog-line-pricing";
import { presetPricingMode, parsePricingPresets, sortPricingPresetsDisplay } from "@/lib/catalog-pricing-presets";
import type {
  AccountServicePrice,
  CatalogPricingMode,
  CatalogService,
  PartnerServicePrice,
} from "@/types/database";
import {
  catalogPartnerHourlyRate,
  resolveAccountSell,
  resolvePartnerPay,
} from "@/lib/catalog-pricing-floor-ceiling";

export type PriceSource = "standard" | "custom";

export interface ResolvedJobPricing {
  pricing_mode: CatalogPricingMode;
  // Client-side
  client: {
    fixed_price: number | null;
    fixed_price_source: PriceSource;
    hourly_rate: number | null;
    hourly_rate_source: PriceSource;
    default_hours: number | null;
    default_hours_source: PriceSource;
    /** True when ANY client field is overridden vs catalog. */
    has_custom: boolean;
  };
  // Partner-side
  partner: {
    fixed_partner_cost: number | null;
    fixed_partner_cost_source: PriceSource;
    hourly_partner_rate: number | null;
    hourly_partner_rate_source: PriceSource;
    default_hours: number | null;
    default_hours_source: PriceSource;
    has_custom: boolean;
  };
}

function pickClientFixed(
  catalog: Pick<CatalogService, "fixed_price">,
  override: Pick<AccountServicePrice, "use_standard" | "fixed_price"> | null,
): { value: number | null; source: PriceSource } {
  const floor = catalog.fixed_price ?? 0;
  const custom =
    override && !override.use_standard && override.fixed_price != null
      ? Number(override.fixed_price)
      : null;
  const value = resolveAccountSell(floor, custom);
  const source: PriceSource =
    custom != null && value > floor ? "custom" : "standard";
  return { value: value > 0 ? value : null, source };
}

function pickClientHourly(
  catalog: Pick<CatalogService, "hourly_rate">,
  override: Pick<AccountServicePrice, "use_standard" | "hourly_rate"> | null,
): { value: number | null; source: PriceSource } {
  const floor = catalog.hourly_rate ?? 0;
  const custom =
    override && !override.use_standard && override.hourly_rate != null
      ? Number(override.hourly_rate)
      : null;
  const value = resolveAccountSell(floor, custom);
  const source: PriceSource =
    custom != null && value > floor ? "custom" : "standard";
  return { value: value > 0 ? value : null, source };
}

function pickClientDefaultHours(
  catalog: Pick<CatalogService, "default_hours">,
  override: Pick<AccountServicePrice, "use_standard" | "default_hours"> | null,
): { value: number | null; source: PriceSource } {
  if (override && !override.use_standard && override.default_hours != null) {
    return { value: Number(override.default_hours), source: "custom" };
  }
  return { value: catalog.default_hours ?? null, source: "standard" };
}

function pickPartnerFixed(
  catalog: Pick<CatalogService, "partner_cost">,
  override: Pick<PartnerServicePrice, "use_standard" | "fixed_partner_cost"> | null,
): { value: number | null; source: PriceSource } {
  const ceiling = catalog.partner_cost ?? 0;
  const custom =
    override && !override.use_standard && override.fixed_partner_cost != null
      ? Number(override.fixed_partner_cost)
      : null;
  const value = resolvePartnerPay(ceiling, custom);
  const source: PriceSource =
    custom != null && value < ceiling ? "custom" : "standard";
  return { value: value > 0 ? value : null, source };
}

function pickPartnerHourly(
  catalog: Pick<CatalogService, "partner_cost" | "default_hours" | "pricing_mode">,
  override: Pick<PartnerServicePrice, "use_standard" | "hourly_partner_rate"> | null,
): { value: number | null; source: PriceSource } {
  const ceiling =
    catalog.pricing_mode === "hourly"
      ? catalogPartnerHourlyRate(catalog.partner_cost, catalog.default_hours)
      : 0;
  const custom =
    override && !override.use_standard && override.hourly_partner_rate != null
      ? Number(override.hourly_partner_rate)
      : null;
  const value = resolvePartnerPay(ceiling, custom);
  const source: PriceSource =
    custom != null && value < ceiling ? "custom" : "standard";
  return { value: value > 0 ? value : null, source };
}

function pickPartnerDefaultHours(
  catalog: Pick<CatalogService, "default_hours">,
  override: Pick<PartnerServicePrice, "use_standard" | "default_hours"> | null,
): { value: number | null; source: PriceSource } {
  if (override && !override.use_standard && override.default_hours != null) {
    return { value: Number(override.default_hours), source: "custom" };
  }
  return { value: catalog.default_hours ?? null, source: "standard" };
}

/** Partner £/h for Smart Price jobs (rate card → catalog/band ceiling). */
export function resolvePartnerHourlyForJob(input: {
  catalog: Pick<CatalogService, "partner_cost" | "default_hours" | "pricing_mode" | "pricing_presets">;
  partnerOverride: Pick<
    PartnerServicePrice,
    "use_standard" | "hourly_partner_rate" | "fixed_partner_cost" | "preset_overrides"
  > | null;
  presetId?: string | null;
}): { value: number | null; source: PriceSource; fixedPartnerTotal?: number | null } {
  const presetId = input.presetId?.trim();
  if (presetId && "pricing_presets" in input.catalog) {
    const fullCatalog = input.catalog as CatalogService;
    const resolved = resolveCatalogLinePricing({
      catalog: fullCatalog,
      presetId,
      partnerPrice: (input.partnerOverride as PartnerServicePrice | null) ?? null,
    });
    if (resolved && resolved.partnerTotal > 0) {
      const preset = sortPricingPresetsDisplay(parsePricingPresets(fullCatalog.pricing_presets))
        .find((p) => p.id === presetId);
      const hours = Math.max(
        0.25,
        Number(preset?.default_hours ?? fullCatalog.default_hours) || 2,
      );
      const isFixedBand = preset ? presetPricingMode(preset) === "fixed" : false;
      return {
        value: resolved.partnerTotal / hours,
        source: resolved.lines[0]?.partnerSource ?? "standard",
        fixedPartnerTotal: isFixedBand ? resolved.partnerTotal : null,
      };
    }
  }
  const hourly = pickPartnerHourly(input.catalog, input.partnerOverride);
  return { ...hourly, fixedPartnerTotal: null };
}

export function formatPartnerJobPriceDisplay(
  jobType: "hourly" | "fixed" | null | undefined,
  hourlyPartnerRate: number | null | undefined,
  partnerCost: number | null | undefined,
  fixedBandTotal?: number | null,
): string {
  if (jobType === "hourly" && fixedBandTotal != null && fixedBandTotal > 0) {
    return `£${fixedBandTotal.toFixed(2)}`;
  }
  if (jobType === "hourly") {
    return `£${Number(hourlyPartnerRate ?? 0).toFixed(2)}/hr`;
  }
  return `£${Number(partnerCost ?? 0).toFixed(2)}`;
}

export function resolveJobPricing(input: {
  catalog: CatalogService;
  accountOverride: AccountServicePrice | null;
  partnerOverride: PartnerServicePrice | null;
}): ResolvedJobPricing {
  const cat = input.catalog;
  const cf  = pickClientFixed(cat, input.accountOverride);
  const ch  = pickClientHourly(cat, input.accountOverride);
  const cdh = pickClientDefaultHours(cat, input.accountOverride);
  const pf  = pickPartnerFixed(cat, input.partnerOverride);
  const ph  = pickPartnerHourly(cat, input.partnerOverride);
  const pdh = pickPartnerDefaultHours(cat, input.partnerOverride);

  return {
    pricing_mode: cat.pricing_mode,
    client: {
      fixed_price: cf.value, fixed_price_source: cf.source,
      hourly_rate: ch.value, hourly_rate_source: ch.source,
      default_hours: cdh.value, default_hours_source: cdh.source,
      has_custom:
        cf.source === "custom" || ch.source === "custom" || cdh.source === "custom",
    },
    partner: {
      fixed_partner_cost: pf.value, fixed_partner_cost_source: pf.source,
      hourly_partner_rate: ph.value, hourly_partner_rate_source: ph.source,
      default_hours: pdh.value, default_hours_source: pdh.source,
      has_custom:
        pf.source === "custom" || ph.source === "custom" || pdh.source === "custom",
    },
  };
}
