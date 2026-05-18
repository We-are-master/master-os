import type { CatalogService, ServicePricingAddon, ServicePricingPreset } from "@/types/database";

export type { ServicePricingPreset, ServicePricingAddon };

/** Parse DB jsonb into add-on list; invalid entries dropped. */
export function parsePricingAddons(raw: unknown): ServicePricingAddon[] {
  if (!Array.isArray(raw)) return [];
  const out: ServicePricingAddon[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!id || !label) continue;
    const sort_order = typeof o.sort_order === "number" && Number.isFinite(o.sort_order) ? o.sort_order : 0;
    const fixed_price =
      typeof o.fixed_price === "number" && Number.isFinite(o.fixed_price) ? o.fixed_price : null;
    if (fixed_price == null) continue;
    const addon: ServicePricingAddon = { id, label, sort_order, fixed_price };
    if (typeof o.partner_cost === "number" && Number.isFinite(o.partner_cost)) addon.partner_cost = o.partner_cost;
    out.push(addon);
  }
  return out;
}

export function sortPricingAddonsDisplay(addons: ServicePricingAddon[]): ServicePricingAddon[] {
  return [...addons].sort((a, b) => {
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

/** Parse DB jsonb into preset list; invalid entries dropped. */
export function parsePricingPresets(raw: unknown): ServicePricingPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ServicePricingPreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!id || !label) continue;
    const sort_order = typeof o.sort_order === "number" && Number.isFinite(o.sort_order) ? o.sort_order : 0;
    const preset: ServicePricingPreset = { id, label, sort_order };
    if (o.pricing_mode === "fixed" || o.pricing_mode === "hourly") preset.pricing_mode = o.pricing_mode;
    if (typeof o.fixed_price === "number" && Number.isFinite(o.fixed_price)) preset.fixed_price = o.fixed_price;
    if (typeof o.hourly_rate === "number" && Number.isFinite(o.hourly_rate)) preset.hourly_rate = o.hourly_rate;
    if (typeof o.default_hours === "number" && Number.isFinite(o.default_hours)) preset.default_hours = o.default_hours;
    if (typeof o.partner_cost === "number" && Number.isFinite(o.partner_cost)) preset.partner_cost = o.partner_cost;
    out.push(preset);
  }
  return out;
}

export function sortPricingPresetsDisplay(presets: ServicePricingPreset[]): ServicePricingPreset[] {
  return [...presets].sort((a, b) => {
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

/**
 * Deep-enough clone of catalog with preset fields overlaid for resolveJobPricing.
 * Only numeric fields present on the preset replace the parent value.
 */
export function mergeCatalogWithPricingPreset(
  catalog: CatalogService,
  presetId: string | null | undefined,
): CatalogService {
  const trimmed = presetId?.trim();
  if (!trimmed) return catalog;
  const presets = sortPricingPresetsDisplay(parsePricingPresets(catalog.pricing_presets));
  const p = presets.find((x) => x.id === trimmed);
  if (!p) return catalog;

  const out: CatalogService = { ...catalog };
  if (p.pricing_mode === "fixed" || p.pricing_mode === "hourly") out.pricing_mode = p.pricing_mode;
  if (typeof p.fixed_price === "number") out.fixed_price = p.fixed_price;
  if (typeof p.hourly_rate === "number") out.hourly_rate = p.hourly_rate;
  if (typeof p.default_hours === "number") out.default_hours = p.default_hours;
  if (typeof p.partner_cost === "number") out.partner_cost = p.partner_cost;
  return out;
}

/** Infer charge type for a preset (explicit mode, else from which price fields are set). */
export function presetPricingMode(p: ServicePricingPreset): "fixed" | "hourly" {
  if (p.pricing_mode === "fixed" || p.pricing_mode === "hourly") return p.pricing_mode;
  if (p.hourly_rate != null && p.fixed_price == null) return "hourly";
  return "fixed";
}

/** Choose default preset id when service has presets (first by sort). */
export function defaultPricingPresetId(catalog: Pick<CatalogService, "pricing_presets">): string {
  const sorted = sortPricingPresetsDisplay(parsePricingPresets(catalog.pricing_presets));
  return sorted[0]?.id ?? "";
}
