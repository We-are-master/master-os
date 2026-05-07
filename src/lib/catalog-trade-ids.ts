import type { CatalogService } from "@/types/database";

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
