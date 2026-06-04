import type { CatalogService } from "@/types/database";

/**
 * Trade categories (Plumber, Electrician, …) vs certificate SKUs "(GSC) Gas Safety …".
 * Matches TradesPortal onboarding: trades grid uses category rows only.
 */
export function isCatalogTradeCategoryLabel(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (/^\([^)]+\)\s/.test(n)) return false;
  return true;
}

export function tradeCategoryCatalogRows(catalog: readonly CatalogService[]): CatalogService[] {
  return catalog.filter((s) => isCatalogTradeCategoryLabel(s.name));
}

export function tradeCategoryLabelsFromCatalog(
  catalog: readonly Pick<CatalogService, "name">[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of tradeCategoryCatalogRows(catalog as CatalogService[])) {
    const name = row.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
