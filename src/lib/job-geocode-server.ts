/**
 * Server-only UK geocode for matching / assignment (OpenCage).
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
  if (!apiKey) return null;

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
