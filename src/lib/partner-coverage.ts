import type { Partner, PartnerCoverageMode } from "@/types/database";
import {
  COVERAGE_CITY_LONDON_ID,
  coverageCityById,
  defaultLondonIncludedPostcodes,
  normalizeOutwardCode,
} from "@/lib/coverage-cities";

export const SERVICE_RADIUS_MILE_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50] as const;

export const DEFAULT_COVERAGE_MODE: PartnerCoverageMode = "postcodes";

export type PartnerCoverageFields = Pick<
  Partner,
  | "coverage_mode"
  | "service_radius_miles"
  | "coverage_latitude"
  | "coverage_longitude"
  | "coverage_base_postcode"
  | "included_postcodes"
  | "coverage_cities"
  | "excluded_postcodes"
  | "uk_coverage_regions"
  | "location"
>;

export type JobCoverageTarget = {
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/** UK outward from full postcode or outward token. */
export function outwardFromPostcode(pc?: string | null): string {
  return normalizeOutwardCode(pc);
}

export function isPartnerExcludedByPostcode(
  partner: Pick<PartnerCoverageFields, "excluded_postcodes">,
  jobOutward: string,
): boolean {
  if (!jobOutward || !Array.isArray(partner.excluded_postcodes)) return false;
  return partner.excluded_postcodes.some((ex) => {
    const e = normalizeOutwardCode(ex);
    return e.length > 0 && jobOutward.startsWith(e);
  });
}

/** Job outward matches at least one included outward (prefix either way). */
export function outwardMatchesIncluded(jobOutward: string, included: readonly string[]): boolean {
  if (!jobOutward || included.length === 0) return false;
  return included.some((raw) => {
    const inc = normalizeOutwardCode(raw);
    if (!inc) return false;
    return jobOutward.startsWith(inc) || inc.startsWith(jobOutward);
  });
}

export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function effectiveCoverageMode(partner: PartnerCoverageFields): PartnerCoverageMode | null {
  const m = partner.coverage_mode;
  if (m === "radius" || m === "postcodes") return m;

  const hasRadius =
    Number(partner.service_radius_miles ?? 0) > 0 &&
    partner.coverage_latitude != null &&
    partner.coverage_longitude != null;
  const hasPostcodes = (partner.included_postcodes?.length ?? 0) > 0;
  if (hasRadius && !hasPostcodes) return "radius";
  if (hasPostcodes && !hasRadius) return "postcodes";

  if (partner.uk_coverage_regions?.length || partner.location?.trim()) return "postcodes";
  return null;
}

/** Fields cleared on save so only one coverage method is stored. */
export function clearedCoverageFieldsForMode(
  mode: PartnerCoverageMode,
): Partial<PartnerCoverageFields> {
  if (mode === "radius") {
    return {
      coverage_mode: "radius",
      included_postcodes: null,
      coverage_cities: null,
      uk_coverage_regions: null,
    };
  }
  return {
    coverage_mode: "postcodes",
    service_radius_miles: null,
    coverage_latitude: null,
    coverage_longitude: null,
    coverage_base_postcode: null,
    uk_coverage_regions: null,
  };
}

export function effectiveIncludedPostcodes(partner: PartnerCoverageFields): string[] {
  const raw = partner.included_postcodes ?? [];
  const normalized = raw.map(normalizeOutwardCode).filter(Boolean);
  if (normalized.length > 0) return [...new Set(normalized)];
  const mode = effectiveCoverageMode(partner);
  if (mode !== "postcodes") return [];
  const cities = partner.coverage_cities ?? [];
  if (cities.includes(COVERAGE_CITY_LONDON_ID)) return defaultLondonIncludedPostcodes();
  if (
    partner.uk_coverage_regions?.some((r) => r.trim().toLowerCase() === "london") ||
    (partner.location ?? "").toLowerCase().includes("london")
  ) {
    return defaultLondonIncludedPostcodes();
  }
  return [];
}

export function partnerCoversByRadius(
  partner: PartnerCoverageFields,
  jobLat: number,
  jobLng: number,
): boolean {
  const miles = Number(partner.service_radius_miles ?? 0);
  const lat = partner.coverage_latitude;
  const lng = partner.coverage_longitude;
  if (!(miles > 0) || lat == null || lng == null) return false;
  if (!Number.isFinite(jobLat) || !Number.isFinite(jobLng)) return false;
  return haversineMiles(lat, lng, jobLat, jobLng) <= miles;
}

export function partnerCoversByPostcodes(
  partner: PartnerCoverageFields,
  jobOutward: string,
): boolean {
  const included = effectiveIncludedPostcodes(partner);
  const mode = effectiveCoverageMode(partner);
  if (included.length === 0) {
    if (mode === "postcodes") return false;
    return true;
  }
  if (!jobOutward) return false;
  return outwardMatchesIncluded(jobOutward, included);
}

/**
 * Whether this partner's configured coverage includes the job location.
 * When coverage is not configured, returns true (no geo block).
 */
export function partnerCoversJob(
  partner: PartnerCoverageFields,
  target: JobCoverageTarget,
): boolean {
  const outward = outwardFromPostcode(target.postcode);
  if (outward && isPartnerExcludedByPostcode(partner, outward)) return false;

  const mode = effectiveCoverageMode(partner);
  if (!mode) return true;

  if (mode === "postcodes") {
    return partnerCoversByPostcodes(partner, outward);
  }

  const lat = target.latitude;
  const lng = target.longitude;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return partnerCoversByRadius(partner, lat, lng);
  }
  if (outward && partner.coverage_base_postcode) {
    const base = outwardFromPostcode(partner.coverage_base_postcode);
    if (base && outward.startsWith(base)) return true;
  }
  return false;
}

export function partnerCoverageIsComplete(partner: PartnerCoverageFields): boolean {
  const mode = effectiveCoverageMode(partner) ?? DEFAULT_COVERAGE_MODE;
  if (mode === "radius") {
    const miles = Number(partner.service_radius_miles ?? 0);
    return (
      miles > 0 &&
      partner.coverage_latitude != null &&
      partner.coverage_longitude != null &&
      Number.isFinite(partner.coverage_latitude) &&
      Number.isFinite(partner.coverage_longitude)
    );
  }
  return effectiveIncludedPostcodes(partner).length > 0;
}

/** City line for postcode coverage — includes legacy rows with postcodes but no `coverage_cities`. */
export function resolveCoverageCityLabels(partner: PartnerCoverageFields): string {
  const fromIds = (partner.coverage_cities ?? [])
    .map((id) => coverageCityById(id)?.label ?? id)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromIds.length) return fromIds.join(", ");

  const loc = partner.location?.trim();
  if (loc && /london/i.test(loc)) return "London";

  if (partner.uk_coverage_regions?.some((r) => r.trim().toLowerCase() === "london")) {
    return "London";
  }

  const rawIncluded = partner.included_postcodes ?? [];
  if (rawIncluded.length > 0) {
    const londonSet = new Set(defaultLondonIncludedPostcodes().map(normalizeOutwardCode));
    const overlap = rawIncluded.filter((c) => londonSet.has(normalizeOutwardCode(c))).length;
    if (overlap > 0 && overlap / rawIncluded.length >= 0.25) return "London";
  }

  const effective = effectiveIncludedPostcodes(partner);
  if (effective.length > 0) {
    const londonSet = new Set(defaultLondonIncludedPostcodes().map(normalizeOutwardCode));
    const overlap = effective.filter((c) => londonSet.has(normalizeOutwardCode(c))).length;
    if (overlap > 0 && overlap / effective.length >= 0.25) return "London";
  }

  return "";
}

export type PartnerCoverageDisplay = {
  primary: string;
  secondary: string;
};

/** Two-line coverage label for directory tables (city/pick on top, detail below). */
export function formatPartnerCoverageDisplay(partner: PartnerCoverageFields): PartnerCoverageDisplay {
  const mode = effectiveCoverageMode(partner);
  if (mode === "radius") {
    const miles = partner.service_radius_miles;
    const pick =
      partner.coverage_base_postcode?.trim() ||
      partner.location?.trim() ||
      "";
    if (miles != null && miles > 0) {
      return {
        primary: pick || "Radius",
        secondary: `${miles} mi`,
      };
    }
    return { primary: "Radius (not set)", secondary: "" };
  }
  if (mode === "postcodes") {
    const n = effectiveIncludedPostcodes(partner).length;
    const cities = resolveCoverageCityLabels(partner);
    if (n === 0) {
      if (cities) return { primary: cities, secondary: "Postcodes (not set)" };
      return { primary: "Postcodes (not set)", secondary: "" };
    }
    if (cities) return { primary: cities, secondary: `${n} districts` };
    return { primary: "Postcodes", secondary: `${n} districts` };
  }
  return { primary: "", secondary: "" };
}

export function formatPartnerCoverageSummary(partner: PartnerCoverageFields): string {
  const { primary, secondary } = formatPartnerCoverageDisplay(partner);
  if (!primary) return "";
  return secondary ? `${primary} · ${secondary}` : primary;
}

export function defaultCoveragePatchForNewPartner(): Partial<Partner> {
  return {
    coverage_mode: "postcodes",
    coverage_cities: [COVERAGE_CITY_LONDON_ID],
    included_postcodes: defaultLondonIncludedPostcodes(),
    location: "London",
  };
}
