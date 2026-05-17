import type { CatalogService } from "@/types/database";

/** Canonical label for general repairs / maintenance work (Partners, Requests, Quotes, Jobs). */
export const GENERAL_MAINTENANCE_LABEL = "General Maintenance" as const;

/**
 * Canonical type-of-work names — **must match** rows seeded into `service_catalog`
 * (see migration `174_service_catalog_complete_canonical_types.sql`). The Services
 * admin table is the place to set prices per line; this array is for matching, map
 * colours, and backfill only.
 */
export const CANONICAL_TYPE_OF_WORK_NAMES = [
  "Painter",
  GENERAL_MAINTENANCE_LABEL,
  "Plumber",
  "Electrician",
  "Builder",
  "Carpenter",
  "Cleaning",
  "Gardener",
  "Boiler Service",
  "Electrical Installation Condition Report (EICR)",
  "Portable Appliance Testing (PAT)",
  "Gas Safety Certificate (GSC)",
  "Fire Risk Assessment (FRA)",
  "Fire Alarm Certificate",
  "Emergency Lighting Certificate",
  "Fire Extinguisher Service (FES)",
] as const;

/** @deprecated Use {@link CANONICAL_TYPE_OF_WORK_NAMES}; alias kept for older imports. */
export const TYPE_OF_WORK_OPTIONS = CANONICAL_TYPE_OF_WORK_NAMES;

/** Exact legacy labels (UI + DB) → canonical TYPE_OF_WORK string. */
const TYPE_OF_WORK_ALIASES: Record<string, string> = {
  "general maintenance": GENERAL_MAINTENANCE_LABEL,
  handyman: GENERAL_MAINTENANCE_LABEL,
  gardener: "Gardener",
  garderner: "Gardener",
  boiler: "Boiler Service",
  "boiler service": "Boiler Service",
  eicr: "Electrical Installation Condition Report (EICR)",
  "electrical installation condition report": "Electrical Installation Condition Report (EICR)",
  "electrical installation condition report (eicr)": "Electrical Installation Condition Report (EICR)",
  "pat testing": "Portable Appliance Testing (PAT)",
  "portable appliance testing": "Portable Appliance Testing (PAT)",
  "portable appliance testing (pat)": "Portable Appliance Testing (PAT)",
  "pat eicr": "Portable Appliance Testing (PAT)",
  "gas safety certificate": "Gas Safety Certificate (GSC)",
  "gas safety certificate (gsc)": "Gas Safety Certificate (GSC)",
  "fire risk assessment": "Fire Risk Assessment (FRA)",
  "fire risk assessment (fra)": "Fire Risk Assessment (FRA)",
  "fire extinguisher service": "Fire Extinguisher Service (FES)",
  "fire extinguisher service (fes)": "Fire Extinguisher Service (FES)",
};

/**
 * Canonical type-of-work / trade label for storage and display.
 * Legacy DB values and free text may still say “handyman”; they are merged into {@link GENERAL_MAINTENANCE_LABEL}
 * without dropping the rest of the phrase (e.g. title suffixes).
 */
export function normalizeTypeOfWork(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const alias = TYPE_OF_WORK_ALIASES[lower];
  if (alias) return alias;
  const replaced = raw
    .replace(/\bhandyman\b/gi, GENERAL_MAINTENANCE_LABEL)
    .replace(/\s{2,}/g, " ")
    .trim();
  return replaced;
}

export function mergeTypeOfWorkOptions(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTypeOfWork(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

/**
 * Labels for “type of work” pickers: **active Services catalog only**, plus any
 * `current` value so existing jobs/quotes with legacy titles still appear when editing.
 * Add or edit services in Settings (Service catalog tab) — there is no built-in static list anymore.
 */
export function typeOfWorkLabelsFromCatalog(
  catalog: Pick<CatalogService, "name">[],
  current?: string | null,
): string[] {
  const names = catalog.map((c) => c.name?.trim()).filter(Boolean) as string[];
  if (names.length > 0) {
    return mergeTypeOfWorkOptions([...names, current]).sort((a, b) => a.localeCompare(b));
  }
  return mergeTypeOfWorkOptions([current]).sort((a, b) => a.localeCompare(b));
}

/** Resolve catalog row id from a picker label (exact name, then normalized type-of-work). */
export function catalogServiceIdForTypeOfWorkLabel(
  label: string,
  catalog: Pick<CatalogService, "id" | "name">[],
): string | null {
  const t = label?.trim();
  if (!t || catalog.length === 0) return null;
  const exact = catalog.find((s) => (s.name ?? "").trim() === t);
  if (exact) return exact.id;
  const n = normalizeTypeOfWork(t);
  if (!n) return null;
  const byNorm = catalog.find((s) => normalizeTypeOfWork(s.name) === n);
  return byNorm?.id ?? null;
}

/** @deprecated Prefer {@link typeOfWorkLabelsFromCatalog} with rows from `listCatalogServicesForPicker`. */
export function withTypeOfWorkFallback(current?: string | null): string[] {
  return typeOfWorkLabelsFromCatalog([], current);
}
