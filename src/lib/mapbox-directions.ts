/**
 * Thin wrapper around the Mapbox Directions API used by the Live View map's
 * "route partner → next job" affordance. Only fires on explicit user intent
 * (partner pin click) so the cost stays predictable.
 *
 * Docs: https://docs.mapbox.com/api/navigation/directions/
 */

export type Coord = { latitude: number; longitude: number };

export type DrivingRoute = {
  /** GeoJSON LineString geometry — pass directly into a Mapbox source. */
  geometry: { type: "LineString"; coordinates: [number, number][] };
  /** Total driving duration in seconds. */
  durationSec: number;
  /** Total distance in metres. */
  distanceM: number;
};

const ENDPOINT = "https://api.mapbox.com/directions/v5/mapbox/driving";

/**
 * Fetch a driving route between two points. Returns `null` when:
 *   - the env token is missing
 *   - the coordinates are invalid
 *   - Mapbox returns zero routes
 *   - the network call fails
 *
 * Caller decides UX on null (e.g. fall back to a straight line + great-circle
 * distance), so this never throws.
 */
export async function getDrivingRoute(from: Coord, to: Coord): Promise<DrivingRoute | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  if (!Number.isFinite(from.latitude) || !Number.isFinite(from.longitude)) return null;
  if (!Number.isFinite(to.latitude) || !Number.isFinite(to.longitude)) return null;

  const path = `${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}`;
  const url = `${ENDPOINT}/${path}?geometries=geojson&overview=simplified&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{
        geometry?: { type: string; coordinates: [number, number][] };
        duration?: number;
        distance?: number;
      }>;
    };
    const route = json.routes?.[0];
    if (!route?.geometry || !Array.isArray(route.geometry.coordinates)) return null;
    return {
      geometry: { type: "LineString", coordinates: route.geometry.coordinates },
      durationSec: Number(route.duration ?? 0),
      distanceM: Number(route.distance ?? 0),
    };
  } catch {
    return null;
  }
}

/** Human-friendly duration formatter: 47s → "1 min", 1230s → "21 min", 7320s → "2 h 2 min". */
export function formatDuration(sec: number): string {
  const totalMin = Math.max(0, Math.round(sec / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Human-friendly distance formatter in miles (UK convention). 5230m → "3.2 mi". */
export function formatDistanceMiles(metres: number): string {
  const miles = metres / 1609.344;
  if (miles < 0.1) return "< 0.1 mi";
  return `${miles.toFixed(1)} mi`;
}
