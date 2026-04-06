import type { Quote } from "@/types/database";
import { getRequest } from "@/services/requests";

/** Normalise DB/UI values to a list of HTTPS URLs. */
export function coerceJobImagesArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  }
  return [];
}

/** Prefer quote images; if empty and linked to a request, load request images (dashboard client). */
export async function resolveImagesForJobFromQuote(quote: Quote): Promise<string[]> {
  const fromQuote = coerceJobImagesArray(quote.images);
  if (fromQuote.length) return fromQuote;
  const rid = quote.request_id?.trim();
  if (!rid) return [];
  const req = await getRequest(rid, { enrich: false });
  return coerceJobImagesArray(req?.images);
}
