import type { CatalogPricingMode } from "@/types/database";
import { DEFAULT_HOURLY_BILLED_HOURS } from "@/lib/job-hourly-billing";

export type CatalogPricingStructure = "single" | "variable" | "base_plus_addons";

/** Editor / structure picker labels. */
export const CATALOG_PRICING_STRUCTURE_LABELS: Record<CatalogPricingStructure, string> = {
  single: "Standard price",
  variable: "Multiple options",
  base_plus_addons: "Package + add-ons",
};

export function catalogPricingStructureLabel(structure: CatalogPricingStructure): string {
  return CATALOG_PRICING_STRUCTURE_LABELS[structure];
}

/** Table column "Pricing model" labels. */
export function catalogPricingModelLabel(opts: {
  missing: boolean;
  stackable: boolean;
  variable: boolean;
  pricingMode: CatalogPricingMode;
}): string {
  if (opts.missing) return "Price on request";
  if (opts.stackable) return "Package + add-ons";
  if (opts.variable) return "Multiple options";
  if (opts.pricingMode === "hourly") return "Hourly rate";
  return "Fixed price";
}

/** Subline under service name in list/cards. */
export function catalogPricingSubline(opts: {
  missing: boolean;
  stackable: boolean;
  variable: boolean;
  pricingMode: CatalogPricingMode;
  defaultHours?: number | null;
  addonCount?: number;
  bandCount?: number;
}): string {
  if (opts.missing) return "no price set";
  if (opts.stackable && (opts.addonCount ?? 0) > 0) {
    const n = opts.addonCount ?? 0;
    return `Base price · ${n} add-on${n === 1 ? "" : "s"}`;
  }
  if (opts.stackable) return "Base price";
  if (opts.variable) {
    const n = opts.bandCount ?? 0;
    return `Pricing bands (${n})`;
  }
  if (opts.pricingMode === "hourly") {
    const hours = opts.defaultHours ?? DEFAULT_HOURLY_BILLED_HOURS;
    return `Hourly rate · default ${hours}h`;
  }
  return "Fixed price";
}

/** Charge type within a pricing line (catalog context only). */
export function catalogChargeTypeLabel(mode: CatalogPricingMode): string {
  return mode === "hourly" ? "Hourly rate" : "Fixed price";
}

/** Badge label for overview cards (structure without hourly/fixed split for single). */
export function catalogOverviewStructureBadge(opts: {
  stackable: boolean;
  variable: boolean;
  pricingMode?: CatalogPricingMode;
}): string {
  if (opts.stackable) return "Package + add-ons";
  if (opts.variable) return "Multiple options";
  if (opts.pricingMode === "hourly") return "Hourly rate";
  if (opts.pricingMode === "fixed") return "Fixed price";
  return "Standard price";
}
