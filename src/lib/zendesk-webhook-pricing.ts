/**
 * Zendesk POST /api/jobs pricing — bands, floor/ceiling, Smart Price.
 */

import { isValidUUID } from "@/lib/uuid";
import { resolveCatalogLinePricing } from "@/lib/catalog-line-pricing";
import {
  catalogPartnerHourlyRate,
  resolveAccountSell,
  resolvePartnerPay,
} from "@/lib/catalog-pricing-floor-ceiling";
import {
  parsePricingPresets,
  presetPricingMode,
  sortPricingPresetsDisplay,
  type ServicePricingPreset,
} from "@/lib/catalog-pricing-presets";
import { resolveJobPricing } from "@/lib/job-pricing-resolver";
import type { AccountServicePrice, CatalogService, PartnerServicePrice } from "@/types/database";

export function normalizeBandId(
  bandIdRaw: unknown,
  catalogPricingPresetIdRaw?: unknown,
): string | null {
  const candidates = [bandIdRaw, catalogPricingPresetIdRaw];
  for (const raw of candidates) {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) continue;
    const stripped = s.replace(/^band_/i, "");
    if (isValidUUID(stripped)) return stripped;
  }
  return null;
}

export type BandValidationResult =
  | { ok: true; hasBands: false; band: null }
  | { ok: true; hasBands: true; band: ServicePricingPreset }
  | { ok: false; status: number; error: string };

export function validateServiceBand(
  service: Pick<CatalogService, "name" | "pricing_presets">,
  bandId: string | null,
): BandValidationResult {
  const presets = sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets));
  const hasBands = presets.length > 0;

  if (!hasBands) {
    if (bandId) {
      console.warn(
        `[api/jobs] band_id sent for service "${service.name}" with no bands — ignoring`,
      );
    }
    return { ok: true, hasBands: false, band: null };
  }

  if (!bandId) {
    return {
      ok: false,
      status: 400,
      error: `Service ${service.name} requires a band selection for Smart Pricing. Send band_id in payload.`,
    };
  }

  const band = presets.find((p) => p.id === bandId);
  if (!band) {
    return {
      ok: false,
      status: 400,
      error: `band_id ${bandId} does not belong to service ${service.name}.`,
    };
  }

  return { ok: true, hasBands: true, band };
}

export type WebhookFixedPricingInput = {
  clientPriceFromBody: number;
  clientPriceSent: boolean;
  partnerCostFromBody: number;
  partnerCostSent: boolean;
  catalog: CatalogService | null;
  band: ServicePricingPreset | null;
  accountOverride: AccountServicePrice | null;
};

export type WebhookFixedPricingResult = {
  clientPrice: number;
  partnerCost: number;
  bandId: string | null;
  bandLabel: string | null;
};

export function resolveWebhookFixedPricing(input: WebhookFixedPricingInput): WebhookFixedPricingResult {
  let clientPrice = input.clientPriceFromBody;
  let partnerCost = input.partnerCostFromBody;
  const bandId = input.band?.id ?? null;
  const bandLabel = input.band?.label ?? null;

  if (input.band && input.catalog) {
    const resolved = resolveCatalogLinePricing({
      catalog: input.catalog,
      presetId: input.band.id,
      addonIds: [],
      accountPrice: input.accountOverride,
      partnerPrice: null,
    });
    if (resolved) {
      if (!input.clientPriceSent || clientPrice <= 0) {
        clientPrice = resolved.clientTotal;
      }
      if (!input.partnerCostSent) {
        partnerCost = resolved.partnerTotal;
      }
    }
  } else if (input.catalog && (!input.clientPriceSent || clientPrice <= 0)) {
    const floor = Number(input.catalog.fixed_price) || 0;
    const custom =
      input.accountOverride && !input.accountOverride.use_standard && input.accountOverride.fixed_price != null
        ? Number(input.accountOverride.fixed_price)
        : null;
    clientPrice = resolveAccountSell(floor, custom);
    if (!input.partnerCostSent) {
      const ceiling = Number(input.catalog.partner_cost) || 0;
      partnerCost = resolvePartnerPay(ceiling, null);
    }
  }

  return { clientPrice, partnerCost, bandId, bandLabel };
}

/** Normalise Zendesk rate_type / job_type tag to OS job_type. */
export function normalizeWebhookRateType(raw: unknown): "fixed" | "hourly" | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;
  const stripped = s.replace(/^job[_-]type[_-]/, "");
  if (stripped === "fixed" || stripped === "fixed_price") return "fixed";
  if (
    stripped === "hourly"
    || stripped === "smart_price"
    || stripped === "smart price"
  ) {
    return "hourly";
  }
  return null;
}

export type SmartPriceRatesInput = {
  hourlyClientRateFromBody: number;
  hourlyClientRateSent: boolean;
  hourlyPartnerRateFromBody: number;
  hourlyPartnerRateSent: boolean;
  catalog: CatalogService;
  accountOverride: AccountServicePrice | null;
  partnerOverride?: PartnerServicePrice | null;
  band?: ServicePricingPreset | null;
  setupMarginPct: number;
};

function smartPriceBilledHours(
  catalog: Pick<CatalogService, "default_hours">,
  band?: ServicePricingPreset | null,
): number {
  const fromBand = band?.default_hours != null ? Number(band.default_hours) : null;
  const fromCatalog = catalog.default_hours != null ? Number(catalog.default_hours) : null;
  return Math.max(0.25, fromBand ?? fromCatalog ?? 2);
}

/**
 * Smart Price: account + partner rate cards; bands (EPC/FRA/…) pick the price tier.
 * Partner £/h from partner rate card when override is known (invite/accept);
 * otherwise catalog/band placeholder on webhook create.
 */
export function resolveSmartPriceRates(input: SmartPriceRatesInput): {
  hourlyClientRate: number;
  hourlyPartnerRate: number;
} {
  if (input.band) {
    const resolved = resolveCatalogLinePricing({
      catalog: input.catalog,
      presetId: input.band.id,
      addonIds: [],
      accountPrice: input.accountOverride,
      partnerPrice: input.partnerOverride ?? null,
    });
    if (resolved) {
      const hours = smartPriceBilledHours(input.catalog, input.band);
      const mode = presetPricingMode(input.band);
      if (mode === "hourly" && Number(input.band.hourly_rate) > 0) {
        const floorH = Number(input.band.hourly_rate) || 0;
        const customClient =
          input.accountOverride
          && !input.accountOverride.use_standard
          && input.accountOverride.hourly_rate != null
            ? Number(input.accountOverride.hourly_rate)
            : null;
        const hourlyClientRate = input.hourlyClientRateSent
          ? input.hourlyClientRateFromBody
          : resolveAccountSell(floorH, customClient);
        let hourlyPartnerRate = input.hourlyPartnerRateSent
          ? input.hourlyPartnerRateFromBody
          : resolved.partnerTotal / hours;
        if (!(hourlyPartnerRate > 0) && hourlyClientRate > 0) {
          hourlyPartnerRate = autoMarginFromPct(hourlyClientRate, input.setupMarginPct);
        }
        return { hourlyClientRate, hourlyPartnerRate };
      }
      const hourlyClientRate = input.hourlyClientRateSent
        ? input.hourlyClientRateFromBody
        : resolved.clientTotal / hours;
      let hourlyPartnerRate = input.hourlyPartnerRateSent
        ? input.hourlyPartnerRateFromBody
        : resolved.partnerTotal / hours;
      if (!(hourlyPartnerRate > 0) && hourlyClientRate > 0) {
        hourlyPartnerRate = autoMarginFromPct(hourlyClientRate, input.setupMarginPct);
      }
      return { hourlyClientRate, hourlyPartnerRate };
    }
  }

  const floorHourly = Number(input.catalog.hourly_rate) || 0;
  const customClient =
    input.accountOverride && !input.accountOverride.use_standard && input.accountOverride.hourly_rate != null
      ? Number(input.accountOverride.hourly_rate)
      : null;
  const hourlyClientRate = input.hourlyClientRateSent
    ? input.hourlyClientRateFromBody
    : resolveAccountSell(floorHourly, customClient);

  if (input.partnerOverride) {
    const pricing = resolveJobPricing({
      catalog: input.catalog,
      accountOverride: input.accountOverride,
      partnerOverride: input.partnerOverride,
    });
    const partnerRate = pricing.partner.hourly_partner_rate ?? 0;
    return {
      hourlyClientRate,
      hourlyPartnerRate: input.hourlyPartnerRateSent
        ? input.hourlyPartnerRateFromBody
        : partnerRate,
    };
  }

  return resolveWebhookHourlyRates({
    hourlyClientRateFromBody: input.hourlyClientRateFromBody,
    hourlyClientRateSent: input.hourlyClientRateSent,
    hourlyPartnerRateFromBody: input.hourlyPartnerRateFromBody,
    hourlyPartnerRateSent: input.hourlyPartnerRateSent,
    catalog: input.catalog,
    accountOverride: input.accountOverride,
    setupMarginPct: input.setupMarginPct,
  });
}

/** @deprecated Use resolveWebhookFixedPricing — kept as alias for clarity in docs. */
export const resolveFixedJobPricing = resolveWebhookFixedPricing;

export function resolveWebhookHourlyRates(input: {
  hourlyClientRateFromBody: number;
  hourlyClientRateSent: boolean;
  hourlyPartnerRateFromBody: number;
  hourlyPartnerRateSent: boolean;
  catalog: CatalogService;
  accountOverride: AccountServicePrice | null;
  setupMarginPct: number;
}): { hourlyClientRate: number; hourlyPartnerRate: number } {
  const floorHourly = Number(input.catalog.hourly_rate) || 0;
  const customClient =
    input.accountOverride && !input.accountOverride.use_standard && input.accountOverride.hourly_rate != null
      ? Number(input.accountOverride.hourly_rate)
      : null;
  let hourlyClientRate = input.hourlyClientRateSent
    ? input.hourlyClientRateFromBody
    : resolveAccountSell(floorHourly, customClient);

  const ceilingHourly = catalogPartnerHourlyRate(
    input.catalog.partner_cost,
    input.catalog.default_hours,
  );

  let hourlyPartnerRate = input.hourlyPartnerRateSent
    ? input.hourlyPartnerRateFromBody
    : resolvePartnerPay(ceilingHourly, null);

  if (!input.hourlyPartnerRateSent && !(hourlyPartnerRate > 0) && hourlyClientRate > 0) {
    const clamped = Math.max(0, Math.min(100, input.setupMarginPct));
    hourlyPartnerRate = Math.round(hourlyClientRate * (100 - clamped)) / 100;
  }

  return { hourlyClientRate, hourlyPartnerRate };
}

/** Partner side of margin target when catalog has no partner hourly. */
export function autoMarginFromPct(clientSide: number, targetPct: number): number {
  const clamped = Math.max(0, Math.min(100, targetPct));
  return Math.round(clientSide * (100 - clamped)) / 100;
}

/** Fixed: manual client_price only; partner_cost from Setup margin (ignores bands/catalog). */
export function resolveFixedManualPricing(input: {
  clientPrice: number;
  partnerCostSent: boolean;
  partnerCost: number;
  targetMarginPct: number;
}): { clientPrice: number; partnerCost: number } {
  let partnerCost = input.partnerCost;
  if (!input.partnerCostSent && input.clientPrice > 0) {
    partnerCost = autoMarginFromPct(input.clientPrice, input.targetMarginPct);
  }
  return { clientPrice: input.clientPrice, partnerCost };
}
