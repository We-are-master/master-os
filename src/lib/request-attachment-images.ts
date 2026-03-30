/** Normalise `jsonb` / API values to a list of image URLs. */
export function normalizeJsonImageArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
  }
  return [];
}

/** Dedupe while preserving order. */
export function mergeImageUrlLists(...lists: (string[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list?.length) continue;
    for (const u of list) {
      const t = typeof u === "string" ? u.trim() : "";
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}
