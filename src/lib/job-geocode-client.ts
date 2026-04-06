/**
 * Browser-side helper: calls the authenticated API route so OpenCage key stays server-only.
 */
export async function resolveJobGeocode(
  address: string | null | undefined,
): Promise<{ latitude: number; longitude: number } | null> {
  const q = typeof address === "string" ? address.trim() : "";
  if (q.length < 3) return null;
  try {
    const res = await fetch("/api/geocode/opencage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q }),
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { latitude?: number; longitude?: number };
    const lat = data.latitude;
    const lng = data.longitude;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  } catch {
    /* network / parse */
  }
  return null;
}
