/** PostgREST `.in()` filters blow up URL length past ~100 UUIDs — batch to stay under limits. */
export const SUPABASE_IN_CHUNK_SIZE = 80;

export function chunkIds(ids: string[], size = SUPABASE_IN_CHUNK_SIZE): string[][] {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}
