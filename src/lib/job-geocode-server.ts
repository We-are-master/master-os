/**
 * Server-only UK geocode for matching / assignment.
 *
 * OpenCage quando a chave existe; SEM ela, cai no Mapbox Geocoding com o
 * token que o mapa já usa (NEXT_PUBLIC_MAPBOX_TOKEN). Foi a ausência do
 * OPENCAGE_API_KEY no ambiente local que deixou meses de jobs sem coordenada
 * ("4 no location" no Live View) — o fallback fecha esse buraco de vez.
 */

const GEOCODE_CACHE_MAX = 500;
const geocodeCache = new Map<string, { latitude: number; longitude: number }>();

function cacheKey(address: string): string {
  return address.trim().toLowerCase();
}

export async function geocodeUkAddressServer(
  address: string | null | undefined,
): Promise<{ latitude: number; longitude: number } | null> {
  const q = typeof address === "string" ? address.trim() : "";
  if (q.length < 3) return null;

  const key = cacheKey(q);
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const apiKey = process.env.OPENCAGE_API_KEY?.trim();
  if (!apiKey) {
    const viaMapbox = await geocodeViaMapbox(q);
    if (viaMapbox) {
      if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
        const first = geocodeCache.keys().next().value;
        if (first) geocodeCache.delete(first);
      }
      geocodeCache.set(key, viaMapbox);
    }
    return viaMapbox;
  }

  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("q", q);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycode", "gb");
  url.searchParams.set("no_annotations", "1");

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const oc = (await res.json()) as {
      results?: Array<{ geometry?: { lat?: number; lng?: number } }>;
    };
    const geom = oc.results?.[0]?.geometry;
    if (geom && typeof geom.lat === "number" && typeof geom.lng === "number") {
      const coords = { latitude: geom.lat, longitude: geom.lng };
      if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
        const first = geocodeCache.keys().next().value;
        if (first) geocodeCache.delete(first);
      }
      geocodeCache.set(key, coords);
      return coords;
    }
  } catch {
    return null;
  }
  return null;
}

/** Mapbox Geocoding v5 — o fallback que roda em qualquer ambiente com o token do mapa. */
async function geocodeViaMapbox(
  q: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  if (!token) return null;
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "gb");
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const mb = (await res.json()) as { features?: Array<{ center?: [number, number] }> };
    const center = mb.features?.[0]?.center;
    if (center && typeof center[0] === "number" && typeof center[1] === "number") {
      return { latitude: center[1], longitude: center[0] };
    }
  } catch {
    return null;
  }
  return null;
}
