import type { Account, CatalogService, Partner } from "@/types/database";

/** Map trade labels (matching service_catalog.name) to catalog row ids. */
export function catalogServiceIdsForTradeLabels(trades: string[], catalog: CatalogService[]): string[] {
  const out = new Set<string>();
  for (const t of trades) {
    const tl = String(t ?? "").trim().toLowerCase();
    if (!tl) continue;
    const row = catalog.find((c) => (c.name ?? "").trim().toLowerCase() === tl);
    if (row) out.add(row.id);
  }
  return Array.from(out);
}

/**
 * Catalog rows this partner offers — union of:
 * - `catalog_service_ids` (saved catalogue picks), and
 * - any catalogue row whose `name` matches a profile trade label.
 *
 * Union avoids missing lines when ids are stale or trades were added without re-saving ids.
 */
export function filterCatalogServicesForPartner(
  catalog: CatalogService[],
  partner: Pick<Partner, "catalog_service_ids" | "trades" | "trade">,
): CatalogService[] {
  const explicitIds = (partner.catalog_service_ids ?? []).map((id) => id.trim()).filter(Boolean);
  const trades =
    partner.trades?.length ? partner.trades : partner.trade?.trim() ? [partner.trade] : [];

  const idSet = new Set<string>();
  for (const id of explicitIds) idSet.add(id);
  for (const id of catalogServiceIdsForTradeLabels(trades, catalog)) {
    idSet.add(id);
  }
  if (idSet.size === 0) return [];
  return catalog.filter((s) => idSet.has(s.id));
}

/** Resolve catalogue row names for icon strip / subtitles (preserves id order). */
export function catalogServiceLabelsForIds(
  ids: string[] | null | undefined,
  catalog: readonly CatalogService[],
): string[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids ?? []) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    const name = byId.get(id)?.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Catalogue rows offered to this account — from `catalog_service_ids` only. */
export function filterCatalogServicesForAccount(
  catalog: CatalogService[],
  account: Pick<Account, "catalog_service_ids">,
): CatalogService[] {
  const explicitIds = (account.catalog_service_ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (explicitIds.length === 0) return [];
  const idSet = new Set(explicitIds);
  return catalog.filter((s) => idSet.has(s.id));
}
