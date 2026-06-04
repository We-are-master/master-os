/**
 * Catalogue of cities for postcode-based partner coverage.
 * Add new cities here — UI picks city then outward districts within it.
 */

export type CoverageCity = {
  id: string;
  label: string;
  outwardCodes: readonly string[];
};

function range(prefix: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${prefix}${i}`);
  return out;
}

/** Greater London outward districts (representative set for matching & office picker). */
const LONDON_OUTWARD: string[] = [
  ...range("E", 1, 20),
  ...range("EC", 1, 4),
  ...range("N", 1, 22),
  ...range("NW", 1, 11),
  ...range("SE", 1, 28),
  ...range("SW", 1, 20),
  ...range("W", 1, 14),
  ...range("WC", 1, 2),
  ...range("BR", 1, 8),
  ...range("CR", 0, 9),
  ...range("DA", 1, 18),
  ...range("EN", 1, 5),
  ...range("HA", 0, 9),
  ...range("IG", 1, 11),
  ...range("KT", 1, 24),
  ...range("RM", 1, 20),
  ...range("SM", 1, 7),
  ...range("TW", 1, 20),
  ...range("UB", 1, 11),
  ...range("WD", 1, 25),
];

export const COVERAGE_CITY_LONDON_ID = "london";

export const COVERAGE_CITIES: readonly CoverageCity[] = [
  {
    id: COVERAGE_CITY_LONDON_ID,
    label: "London",
    outwardCodes: [...new Set(LONDON_OUTWARD.map((c) => c.toUpperCase()))].sort((a, b) =>
      a.localeCompare(b),
    ),
  },
] as const;

export function coverageCityById(id: string): CoverageCity | undefined {
  return COVERAGE_CITIES.find((c) => c.id === id);
}

export function defaultLondonIncludedPostcodes(): string[] {
  return [...(coverageCityById(COVERAGE_CITY_LONDON_ID)?.outwardCodes ?? [])];
}

export function normalizeOutwardCode(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return "";
  return s.length > 3 ? s.slice(0, s.length - 3) : s;
}
