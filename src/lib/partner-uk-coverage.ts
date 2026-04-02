import type { Partner } from "@/types/database";

/** Sentinel stored in `uk_coverage_regions` when partner covers all of the UK. */
export const UK_COVERAGE_WHOLE = "__whole_uk__";

/** UK regions for partner coverage (London default in UI). Order is display order. */
export const UK_COVERAGE_REGIONS: readonly string[] = [
  "London",
  "South East",
  "South West",
  "East of England",
  "West Midlands",
  "East Midlands",
  "Yorkshire & Humber",
  "North West",
  "North East",
  "Scotland",
  "Wales",
  "Northern Ireland",
] as const;

export function defaultUkCoverage(): string[] {
  return ["London"];
}

export function isWholeUk(regions: string[] | null | undefined): boolean {
  return !!regions?.includes(UK_COVERAGE_WHOLE);
}

/** Dedupe; if whole UK is present, return only that. */
export function normalizeUkCoverageRegions(regions: string[]): string[] {
  const u = [...new Set(regions.filter(Boolean))];
  if (u.includes(UK_COVERAGE_WHOLE)) return [UK_COVERAGE_WHOLE];
  return u.length ? u : defaultUkCoverage();
}

export function formatUkCoverageLabel(
  regions: string[] | null | undefined,
  legacyLocation?: string | null
): string {
  if (regions?.length) {
    if (isWholeUk(regions)) return "Whole UK";
    return regions.filter((r) => r !== UK_COVERAGE_WHOLE).join(", ");
  }
  return (legacyLocation ?? "").trim();
}

export function partnerCoverageToForm(p: Partner): string[] {
  const r = p.uk_coverage_regions;
  if (r?.length) return normalizeUkCoverageRegions([...r]);
  return defaultUkCoverage();
}
