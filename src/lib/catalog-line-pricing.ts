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
  let client = mode === "fixed" ? Number(eff.fixed_price) || 0 : estimatedValueFromCatalog(eff);
  let partner = Number(eff.partner_cost) || 0;
  let clientSource: "standard" | "custom" = "standard";
  let partnerSource: "standard" | "custom" = "standard";

  if (account && !account.use_standard) {
    const presetOvr = parseOverridesMap<CatalogPresetOverridesMap>(account.preset_overrides)[presetId];
    if (presetOvr?.fixed_price != null) {
      client = Number(presetOvr.fixed_price) || 0;
      clientSource = "custom";
    } else if (account.fixed_price != null) {
      client = Number(account.fixed_price) || 0;
      clientSource = "custom";
    }
    if (presetOvr?.partner_cost != null) {
      partner = Number(presetOvr.partner_cost) || 0;
      partnerSource = "custom";
    }
  }

  return { client, partner, clientSource, partnerSource };
}

function pickAddonLine(
  addon: ServicePricingAddon,
  account: AccountServicePrice | null,
): { client: number; partner: number; clientSource: "standard" | "custom"; partnerSource: "standard" | "custom" } {
  let client = Number(addon.fixed_price) || 0;
  let partner = addon.partner_cost != null ? Number(addon.partner_cost) || 0 : 0;
  let clientSource: "standard" | "custom" = "standard";
  let partnerSource: "standard" | "custom" = "standard";

  if (account && !account.use_standard) {
    const addonOvr = parseOverridesMap<CatalogAddonOverridesMap>(account.addon_overrides)[addon.id];
    if (addonOvr?.fixed_price != null) {
      client = Number(addonOvr.fixed_price) || 0;
      clientSource = "custom";
    }
    if (addonOvr?.partner_cost != null) {
      partner = Number(addonOvr.partner_cost) || 0;
      partnerSource = "custom";
    }
  }

  return { client, partner, clientSource, partnerSource };
}

/**
 * Resolve stacked catalog pricing: one base preset + optional add-ons.
 * Account maps override per preset/addon id; partner override replaces base partner pay when set.
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

  if (input.partnerPrice && !input.partnerPrice.use_standard && input.partnerPrice.fixed_partner_cost != null) {
    basePartner = Number(input.partnerPrice.fixed_partner_cost) || 0;
  }

  const lines: CatalogPricingLine[] = [
    {
      id: presetId,
      label: preset?.label ?? input.catalog.name,
      kind: "base",
      clientAmount: base.client,
      partnerAmount: basePartner,
      clientSource: base.clientSource,
      partnerSource:
        input.partnerPrice && !input.partnerPrice.use_standard && input.partnerPrice.fixed_partner_cost != null
          ? "custom"
          : base.partnerSource,
    },
  ];

  for (const addon of addons) {
    if (!addonIdSet.has(addon.id)) continue;
    const row = pickAddonLine(addon, input.accountPrice ?? null);
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

/** Catalog stackable additionals with client/partner amounts (account overrides when set). */
export function resolveCatalogAddonChargeOptions(
  catalog: CatalogService,
  accountPrice?: AccountServicePrice | null,
): CatalogAddonChargeOption[] {
  if (!catalogHasStackableAddons(catalog)) return [];
  return sortPricingAddonsDisplay(parsePricingAddons(catalog.pricing_addons)).map((addon) => {
    const row = pickAddonLine(addon, accountPrice ?? null);
    return {
      id: addon.id,
      label: addon.label,
      clientAmount: row.client,
      partnerAmount: row.partner,
    };
  });
}
