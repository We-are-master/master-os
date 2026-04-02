import type { Partner } from "@/types/database";

/** Legacy DB value — stripped on read; no longer selectable in UI. */
export const UK_COVERAGE_WHOLE = "__whole_uk__";

export const UK_COVERAGE_REGIONS: readonly string[] = [
  "London",
  "Outside London",
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

/** @deprecated Legacy rows only; UI no longer sets Whole UK. */
export function isWholeUk(regions: string[] | null | undefined): boolean {
  return !!regions?.includes(UK_COVERAGE_WHOLE);
}

export function normalizeUkCoverageRegions(regions: string[]): string[] {
  const u = [...new Set(regions.filter(Boolean).filter((x) => x !== UK_COVERAGE_WHOLE))];
  return u.length ? u : defaultUkCoverage();
}

export function formatUkCoverageLabel(
  regions: string[] | null | undefined,
  legacyLocation?: string | null
): string {
  if (regions?.length) {
    const cleaned = regions.filter((r) => r !== UK_COVERAGE_WHOLE);
    if (cleaned.length) return cleaned.join(", ");
    return defaultUkCoverage().join(", ");
  }
  return (legacyLocation ?? "").trim();
}

export function partnerCoverageToForm(p: Partner): string[] {
  const r = p.uk_coverage_regions;
  if (r?.length) return normalizeUkCoverageRegions([...r]);
  return defaultUkCoverage();
}
