/**
 * Photo resolution for the Social Media Designer image bank.
 * Prefers owned photos (media_assets, source 'own'); falls back to Pexels stock
 * (licensed for commercial use), caching the pick back into media_assets.
 * Returns null when no photo is available → caller uses the graphic template.
 */
import { createServiceClient } from "@/lib/supabase/service";

export type Orientation = "square" | "portrait" | "landscape";

export type ResolvedPhoto = {
  url: string;
  alt: string | null;
  credit: string | null;
  source: "own" | "pexels";
};

/** Split a query/theme into lowercase search terms for tag overlap. */
function terms(query: string, theme?: string | null): string[] {
  return `${query} ${theme ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
}

async function fromOwnBank(
  admin: ReturnType<typeof createServiceClient>,
  query: string,
  theme: string | null,
  orientation: Orientation,
): Promise<ResolvedPhoto | null> {
  const tagTerms = terms(query, theme);
  let q = admin
    .from("media_assets")
    .select("url, alt, credit")
    .eq("source", "own")
    .eq("orientation", orientation)
    .limit(20);
  if (tagTerms.length) q = q.overlaps("tags", tagTerms);

  const { data } = await q;
  if (!data || data.length === 0) return null;
  const pick = data[Math.floor(Math.random() * data.length)];
  return { url: pick.url as string, alt: pick.alt as string | null, credit: pick.credit as string | null, source: "own" };
}

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  src: { large2x?: string; large?: string; original?: string };
};

async function fromPexels(
  admin: ReturnType<typeof createServiceClient>,
  query: string,
  orientation: Orientation,
): Promise<ResolvedPhoto | null> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return null;

  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("per_page", "15");
  url.searchParams.set("size", "medium");

  let photos: PexelsPhoto[] = [];
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: key } });
    if (!res.ok) return null;
    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    photos = json.photos ?? [];
  } catch {
    return null;
  }
  if (photos.length === 0) return null;

  const p = photos[Math.floor(Math.random() * photos.length)];
  const imgUrl = p.src.large2x || p.src.large || p.src.original;
  if (!imgUrl) return null;
  const credit = `Photo by ${p.photographer} on Pexels`;

  // Cache (best-effort, dedupe on source+external_id via unique index).
  try {
    await admin.from("media_assets").insert({
      url: imgUrl,
      source: "pexels",
      tags: terms(query, null),
      alt: p.alt || null,
      credit,
      width: p.width,
      height: p.height,
      orientation,
      external_id: String(p.id),
    });
  } catch {
    // ignore conflicts / insert failures — we still return the photo
  }

  return { url: imgUrl, alt: p.alt || null, credit, source: "pexels" };
}

/** Owned bank first, then Pexels. Null when nothing suitable / not configured. */
export async function resolvePhoto(opts: {
  query: string;
  theme?: string | null;
  orientation: Orientation;
}): Promise<ResolvedPhoto | null> {
  const query = (opts.query || "").trim();
  if (!query) return null;
  const admin = createServiceClient();
  const own = await fromOwnBank(admin, query, opts.theme ?? null, opts.orientation);
  if (own) return own;
  return fromPexels(admin, query, opts.orientation);
}
