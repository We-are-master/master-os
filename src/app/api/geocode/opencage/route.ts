import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";

type OpenCageGeometry = { lat: number; lng: number };

type OpenCageResponse = {
  results?: Array<{ geometry?: OpenCageGeometry }>;
  status?: { code: number; message?: string };
};

/**
 * POST { "q": "full UK address" } → { latitude, longitude } | 404 when not found.
 * Uses OPENCAGE_API_KEY (server-only). https://opencagedata.com/api
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
    return NextResponse.json(
      { error: "Geocoding is not configured", message: "Set OPENCAGE_API_KEY on the server." },
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
    return NextResponse.json({ error: "No coordinates for this address" }, { status: 404 });
  }

  return NextResponse.json({
    latitude: geom.lat,
    longitude: geom.lng,
  });
}
