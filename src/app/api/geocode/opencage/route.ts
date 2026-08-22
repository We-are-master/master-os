import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import {
  MAPBOX_GB_FORWARD_TYPES,
  mapboxGbForwardBiasAppend,
} from "@/lib/mapbox-uk-geography";

type OpenCageGeometry = { lat: number; lng: number };

type OpenCageResponse = {
  results?: Array<{ geometry?: OpenCageGeometry }>;
  status?: { code: number; message?: string };
};

/**
 * Mapbox forward geocode, GB-only. Used when OpenCage isn't configured.
 * The map token is already required for the app to render a map at all, so
 * this keeps job coordinates working on one key instead of two.
 */
async function geocodeWithMapbox(q: string): Promise<{ latitude: number; longitude: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  if (!token) return null;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?access_token=${encodeURIComponent(token)}&limit=1&types=${MAPBOX_GB_FORWARD_TYPES}` +
    mapboxGbForwardBiasAppend(q);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("[geocode/mapbox] HTTP", res.status);
      return null;
    }
    const data = (await res.json()) as { features?: Array<{ center?: [number, number] }> };
    const center = data.features?.[0]?.center;
    if (!center || typeof center[0] !== "number" || typeof center[1] !== "number") return null;
    return { latitude: center[1], longitude: center[0] };
  } catch (e) {
    console.error("[geocode/mapbox] fetch", e);
    return null;
  }
}

/**
 * POST { "q": "full UK address" } → { latitude, longitude } | 404 when not found.
 * Prefers OPENCAGE_API_KEY (server-only, https://opencagedata.com/api) and falls
 * back to Mapbox. Without the fallback an unset OpenCage key answered 503 to
 * every lookup, and jobs were saved with no coordinates at all: 58 of the 75
 * open jobs in Aug/2026 have a full address and no pin on the map.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const q = typeof (body as { q?: unknown }).q === "string" ? (body as { q: string }).q.trim() : "";
  if (q.length < 3) {
    return NextResponse.json({ error: "Address too short" }, { status: 400 });
  }

  const key = process.env.OPENCAGE_API_KEY?.trim();
  if (!key) {
    const viaMapbox = await geocodeWithMapbox(q);
    if (viaMapbox) return NextResponse.json(viaMapbox);
    return NextResponse.json(
      {
        error: "Geocoding is not configured",
        message: "Set OPENCAGE_API_KEY, or NEXT_PUBLIC_MAPBOX_TOKEN for the fallback.",
      },
      { status: 503 },
    );
  }

  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycode", "gb");
  url.searchParams.set("no_annotations", "1");

  let oc: OpenCageResponse;
  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[geocode/opencage] HTTP", res.status, text.slice(0, 200));
      return NextResponse.json({ error: "Geocoding provider error" }, { status: 502 });
    }
    oc = (await res.json()) as OpenCageResponse;
  } catch (e) {
    console.error("[geocode/opencage] fetch", e);
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }

  const geom = oc.results?.[0]?.geometry;
  if (!geom || typeof geom.lat !== "number" || typeof geom.lng !== "number") {
    const viaMapbox = await geocodeWithMapbox(q);
    if (viaMapbox) return NextResponse.json(viaMapbox);
    return NextResponse.json({ error: "No coordinates for this address" }, { status: 404 });
  }

  return NextResponse.json({
    latitude: geom.lat,
    longitude: geom.lng,
  });
}
