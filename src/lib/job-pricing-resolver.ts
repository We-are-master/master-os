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

import type {
  AccountServicePrice,
  CatalogPricingMode,
  CatalogService,
  PartnerServicePrice,
} from "@/types/database";

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
  if (override && !override.use_standard && override.fixed_price != null) {
    return { value: Number(override.fixed_price), source: "custom" };
  }
  return { value: catalog.fixed_price ?? null, source: "standard" };
}

function pickClientHourly(
  catalog: Pick<CatalogService, "hourly_rate">,
  override: Pick<AccountServicePrice, "use_standard" | "hourly_rate"> | null,
): { value: number | null; source: PriceSource } {
  if (override && !override.use_standard && override.hourly_rate != null) {
    return { value: Number(override.hourly_rate), source: "custom" };
  }
  return { value: catalog.hourly_rate ?? null, source: "standard" };
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
  if (override && !override.use_standard && override.fixed_partner_cost != null) {
    return { value: Number(override.fixed_partner_cost), source: "custom" };
  }
  return { value: catalog.partner_cost ?? null, source: "standard" };
}

function pickPartnerHourly(
  /** Partner hourly rate has no dedicated catalog column today — derived from
   *  partner_cost / default_hours when in hourly mode. */
  catalog: Pick<CatalogService, "partner_cost" | "default_hours" | "pricing_mode">,
  override: Pick<PartnerServicePrice, "use_standard" | "hourly_partner_rate"> | null,
): { value: number | null; source: PriceSource } {
  if (override && !override.use_standard && override.hourly_partner_rate != null) {
    return { value: Number(override.hourly_partner_rate), source: "custom" };
  }
  // Fall back to derived: partner_cost / default_hours when hourly.
  if (catalog.pricing_mode === "hourly" && catalog.partner_cost != null) {
    const hours = catalog.default_hours && catalog.default_hours > 0 ? catalog.default_hours : 1;
    return { value: Number(catalog.partner_cost) / hours, source: "standard" };
  }
  return { value: null, source: "standard" };
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
