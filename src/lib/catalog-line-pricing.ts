import type {
  AccountServicePrice,
  CatalogAddonOverridesMap,
  CatalogPresetOverridesMap,
  CatalogService,
  PartnerServicePrice,
  ServicePricingAddon,
} from "@/types/database";
import { estimatedValueFromCatalog } from "@/lib/catalog-service-defaults";
import {
  mergeCatalogWithPricingPreset,
  parsePricingAddons,
  parsePricingPresets,
  presetPricingMode,
  sortPricingAddonsDisplay,
  sortPricingPresetsDisplay,
} from "@/lib/catalog-pricing-presets";
import { resolveAccountSell, resolvePartnerPay } from "@/lib/catalog-pricing-floor-ceiling";

export type CatalogLineKind = "base" | "addon";

export type CatalogPricingLine = {
  id: string;
  label: string;
  kind: CatalogLineKind;
  clientAmount: number;
  partnerAmount: number;
  clientSource: "standard" | "custom";
  partnerSource: "standard" | "custom";
};

export type ResolvedCatalogLinePricing = {
  clientTotal: number;
  partnerTotal: number;
  lines: CatalogPricingLine[];
};

export function catalogHasStackableAddons(
  row: Pick<CatalogService, "pricing_addons">,
): boolean {
  return parsePricingAddons(row.pricing_addons).length > 0;
}

function parseOverridesMap<T extends Record<string, { fixed_price?: number | null; partner_cost?: number | null }>>(
  raw: unknown,
): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {} as T;
  return raw as T;
}

function pickClientBase(
  catalog: CatalogService,
  presetId: string,
  account: AccountServicePrice | null,
): { client: number; partner: number; clientSource: "standard" | "custom"; partnerSource: "standard" | "custom" } {
  const eff = mergeCatalogWithPricingPreset(catalog, presetId);
  const mode = presetPricingMode(
    sortPricingPresetsDisplay(parsePricingPresets(catalog.pricing_presets)).find((p) => p.id === presetId) ?? {
      id: presetId,
      label: "",
      pricing_mode: eff.pricing_mode,
      fixed_price: eff.fixed_price,
      hourly_rate: eff.hourly_rate,
    },
  );
  const floorClient = mode === "fixed" ? Number(eff.fixed_price) || 0 : estimatedValueFromCatalog(eff);
  const ceilingPartner = Number(eff.partner_cost) || 0;
  let clientOverride: number | null = null;
  let partnerOverride: number | null = null;
  let clientSource: "standard" | "custom" = "standard";
  let partnerSource: "standard" | "custom" = "standard";

  if (account && !account.use_standard) {
    const presetOvr = parseOverridesMap<CatalogPresetOverridesMap>(account.preset_overrides)[presetId];
    if (presetOvr?.fixed_price != null) {
      clientOverride = Number(presetOvr.fixed_price) || 0;
      clientSource = "custom";
    } else if (account.fixed_price != null) {
      clientOverride = Number(account.fixed_price) || 0;
      clientSource = "custom";
    }
    if (presetOvr?.partner_cost != null) {
      partnerOverride = Number(presetOvr.partner_cost) || 0;
      partnerSource = "custom";
    }
  }

  const client = resolveAccountSell(floorClient, clientOverride);
  const partner = resolvePartnerPay(ceilingPartner, partnerOverride);
  if (clientSource === "custom" && client <= floorClient) clientSource = "standard";
  if (partnerSource === "custom" && partner >= ceilingPartner) partnerSource = "standard";

  return { client, partner, clientSource, partnerSource };
}

function pickAddonLine(
  addon: ServicePricingAddon,
  account: AccountServicePrice | null,
  partnerPrice?: PartnerServicePrice | null,
): { client: number; partner: number; clientSource: "standard" | "custom"; partnerSource: "standard" | "custom" } {
  const floorClient = Number(addon.fixed_price) || 0;
  const ceilingPartner = addon.partner_cost != null ? Number(addon.partner_cost) || 0 : 0;
  let clientOverride: number | null = null;
  let partnerOverride: number | null = null;
  let clientSource: "standard" | "custom" = "standard";
  let partnerSource: "standard" | "custom" = "standard";

  if (account && !account.use_standard) {
    const addonOvr = parseOverridesMap<CatalogAddonOverridesMap>(account.addon_overrides)[addon.id];
    if (addonOvr?.fixed_price != null) {
      clientOverride = Number(addonOvr.fixed_price) || 0;
      clientSource = "custom";
    }
    if (addonOvr?.partner_cost != null) {
      partnerOverride = Number(addonOvr.partner_cost) || 0;
      partnerSource = "custom";
    }
  }

  if (partnerPrice && !partnerPrice.use_standard) {
    const partnerAddonOvr = parseOverridesMap<CatalogAddonOverridesMap>(partnerPrice.addon_overrides)[addon.id];
    if (partnerAddonOvr?.partner_cost != null) {
      partnerOverride = Number(partnerAddonOvr.partner_cost) || 0;
      partnerSource = "custom";
    }
  }

  const client = resolveAccountSell(floorClient, clientOverride);
  const partner = resolvePartnerPay(ceilingPartner, partnerOverride);
  if (clientSource === "custom" && client <= floorClient) clientSource = "standard";
  if (partnerSource === "custom" && partner >= ceilingPartner) partnerSource = "standard";

  return { client, partner, clientSource, partnerSource };
}

/**
 * Resolve stacked catalog pricing: one base preset + optional add-ons.
 * Account maps override per preset/addon id for client (and account partner where set).
 * Partner maps preset_overrides / addon_overrides partner_cost when use_standard is false;
 * otherwise legacy fixed_partner_cost replaces the base partner amount when set.
 */
export function resolveCatalogLinePricing(input: {
  catalog: CatalogService;
  presetId: string;
  addonIds?: string[] | null;
  accountPrice?: AccountServicePrice | null;
  partnerPrice?: PartnerServicePrice | null;
}): ResolvedCatalogLinePricing | null {
  const presetId = input.presetId?.trim();
  if (!presetId) return null;

  const presets = sortPricingPresetsDisplay(parsePricingPresets(input.catalog.pricing_presets));
  const preset = presets.find((p) => p.id === presetId);
  if (!preset && presets.length > 0) return null;

  const addons = sortPricingAddonsDisplay(parsePricingAddons(input.catalog.pricing_addons));
  const addonIdSet = new Set((input.addonIds ?? []).map((id) => id.trim()).filter(Boolean));

  const base = pickClientBase(input.catalog, presetId, input.accountPrice ?? null);
  let basePartner = base.partner;
  let basePartnerSource = base.partnerSource;

  const ceilingPartner = base.partner;
  const pp = input.partnerPrice;
  let partnerOverride: number | null = null;
  if (pp && !pp.use_standard) {
    const partnerPresetOvr = parseOverridesMap<CatalogPresetOverridesMap>(pp.preset_overrides)[presetId];
    if (partnerPresetOvr?.partner_cost != null) {
      partnerOverride = Number(partnerPresetOvr.partner_cost) || 0;
      basePartnerSource = "custom";
    } else if (pp.fixed_partner_cost != null) {
      partnerOverride = Number(pp.fixed_partner_cost) || 0;
      basePartnerSource = "custom";
    }
  }
  basePartner = resolvePartnerPay(ceilingPartner, partnerOverride);
  if (basePartnerSource === "custom" && basePartner >= ceilingPartner) {
    basePartnerSource = "standard";
  }

  const lines: CatalogPricingLine[] = [
    {
      id: presetId,
      label: preset?.label ?? input.catalog.name,
      kind: "base",
      clientAmount: base.client,
      partnerAmount: basePartner,
      clientSource: base.clientSource,
      partnerSource: basePartnerSource,
    },
  ];

  for (const addon of addons) {
    if (!addonIdSet.has(addon.id)) continue;
    const row = pickAddonLine(addon, input.accountPrice ?? null, input.partnerPrice ?? null);
    lines.push({
      id: addon.id,
      label: addon.label,
      kind: "addon",
      clientAmount: row.client,
      partnerAmount: row.partner,
      clientSource: row.clientSource,
      partnerSource: row.partnerSource,
    });
  }

  const clientTotal = lines.reduce((s, l) => s + l.clientAmount, 0);
  const partnerTotal = lines.reduce((s, l) => s + l.partnerAmount, 0);

  return { clientTotal, partnerTotal, lines };
}

export type CatalogAddonChargeOption = {
  id: string;
  label: string;
  clientAmount: number;
  partnerAmount: number;
};

/** Catalog stackable additionals with client/partner amounts (account + optional partner overrides). */
export function resolveCatalogAddonChargeOptions(
  catalog: CatalogService,
  accountPrice?: AccountServicePrice | null,
  partnerPrice?: PartnerServicePrice | null,
): CatalogAddonChargeOption[] {
  if (!catalogHasStackableAddons(catalog)) return [];
  return sortPricingAddonsDisplay(parsePricingAddons(catalog.pricing_addons)).map((addon) => {
    const row = pickAddonLine(addon, accountPrice ?? null, partnerPrice ?? null);
    return {
      id: addon.id,
      label: addon.label,
      clientAmount: row.client,
      partnerAmount: row.partner,
    };
  });
}
