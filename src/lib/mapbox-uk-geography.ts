/**
 * UK-only helpers for Mapbox Geocoding v5 ({@link https://docs.mapbox.com/api/search/geocoding/ }).
 * Quotes routing drawer & Requests preview use these — GB-focused for now.
 */

import { extractUkPostcode } from "@/lib/uk-postcode";

/** London — default focal point when biasing autocomplete/forward lookups. */
export const MAPBOX_UK_CENTER_LON_LAT: [number, number] = [-0.1276, 51.5074];

/** [[west, south], [east, north]] constraining picker pan — GB + NI + northern isles. */
export const MAPBOX_UK_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-8.74, 49.75],
  [2.5, 60.96],
];

/** Restrict results to GB only (no proximity bias). Best for postcode / full-address strings. */
export const MAPBOX_GB_COUNTRY_APPEND = "&country=gb";

/**
 * Append after other query params (`access_token=` etc. already present).
 * Limits forward geocode results to GB and biases toward {@link MAPBOX_UK_CENTER_LON_LAT}.
 */
export const MAPBOX_GB_FORWARD_GEO_APPEND = `${MAPBOX_GB_COUNTRY_APPEND}&proximity=${encodeURIComponent(
  `${MAPBOX_UK_CENTER_LON_LAT[0]},${MAPBOX_UK_CENTER_LON_LAT[1]}`,
)}`;

/** When the query contains a UK postcode, omit London proximity so Mapbox does not skew results (e.g. UB7 vs EC1). */
export function mapboxGbForwardBiasAppend(raw: string): string {
  if (extractUkPostcode(raw.trim())) return MAPBOX_GB_COUNTRY_APPEND;
  return MAPBOX_GB_FORWARD_GEO_APPEND;
}

/** Forward geocode types that include UK postcodes (plus streets & places). */
export const MAPBOX_GB_FORWARD_TYPES =
  "postcode,address,district,place,locality,neighborhood" as const;

/** Append for reverse lookups — restricts interpretation to GB contexts. */
export const MAPBOX_GB_REVERSE_GEO_APPEND = MAPBOX_GB_COUNTRY_APPEND;
