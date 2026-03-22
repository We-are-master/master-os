import type { CatalogService } from "@/types/database";

/** Suggested estimated value for a request lead (fixed price, or hourly × default hours). */
export function estimatedValueFromCatalog(s: CatalogService): number {
  if (s.pricing_mode === "fixed") return Number(s.fixed_price) || 0;
  const hours = Math.max(0.25, Number(s.default_hours) || 1);
  return (Number(s.hourly_rate) || 0) * hours;
}

/** First quote line from catalog defaults (user can edit qty, price, text). */
export function lineItemDefaultsFromCatalog(s: CatalogService): {
  description: string;
  quantity: number;
  unitPrice: number;
} {
  if (s.pricing_mode === "fixed") {
    return {
      description: s.default_description?.trim() || s.name,
      quantity: 1,
      unitPrice: Number(s.fixed_price) || 0,
    };
  }
  const hours = Math.max(0.25, Number(s.default_hours) || 1);
  return {
    description: s.default_description?.trim() || `${s.name} (labour)`,
    quantity: hours,
    unitPrice: Number(s.hourly_rate) || 0,
  };
}
